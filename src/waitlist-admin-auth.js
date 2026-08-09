// Admin operator authentication (#49 PR 2). Cloudflare Access fronts
// /admin/* at the edge, but this module trusts NOTHING about how a request
// arrived: it independently verifies the Access JWT and only then applies
// the explicit operator allowlist. A request never becomes authorized
// because of its hostname, and no email-looking header, form field, query
// parameter, or body value is ever consulted as identity - the ONLY source
// of the operator identity is the verified `email` claim of a JWT whose
// signature checks out against the Access team's published keys.
//
// Fail-closed configuration contract: ALL of the following must be present
// and well-formed or every request is anonymous (and the routes 404):
//   WAITLIST_ADMIN_ENABLED   exactly "true" (checked by the route layer)
//   ADMIN_ACCESS_TEAM_DOMAIN https://<team>.cloudflareaccess.com
//   ADMIN_ACCESS_AUD         the Access application audience tag
//   ADMIN_OPERATOR_EMAILS    comma-separated finite allowlist of exact
//                            addresses; wildcard or domain-wide entries make
//                            the WHOLE configuration invalid (no *@domain
//                            authorization, ever - #49 ruling)
//
// Real operator identities are deployment configuration and are never
// committed to source; tests use synthetic identities with injected keys.

const JWKS_PATH = "/cdn-cgi/access/certs";

const base64UrlToBytes = (value) => {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
};

const decodeSegment = (segment) => {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment)));
  } catch {
    return null;
  }
};

// The finite allowlist. Returns null (config invalid -> fail closed) rather
// than a best-effort subset if ANY entry is not a plain single address.
export function parseOperatorAllowlist(raw) {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const entries = raw.split(",").map((e) => e.trim().toLowerCase()).filter((e) => e !== "");
  if (entries.length === 0) return null;
  for (const entry of entries) {
    if (entry.includes("*") || entry.startsWith("@") || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(entry)) return null;
  }
  return entries;
}

const teamDomainOf = (env) => {
  const raw = typeof env?.ADMIN_ACCESS_TEAM_DOMAIN === "string" ? env.ADMIN_ACCESS_TEAM_DOMAIN.trim().replace(/\/+$/, "") : "";
  return /^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(raw) ? raw : null;
};

async function defaultFetchJwks(teamDomain) {
  const response = await fetch(`${teamDomain}${JWKS_PATH}`);
  if (!response.ok) return null;
  return response.json();
}

// Verifies the Access JWT on the request and returns the operator identity
// `{ email }`, or null for ANY defect: missing/invalid configuration,
// missing token, unknown key, wrong algorithm, bad signature, wrong
// issuer/audience, expired/not-yet-valid, missing email claim, or an email
// outside the allowlist. Callers treat null uniformly (404) - this module
// never explains to the requester which check failed.
export async function authenticateOperator(request, env, { fetchJwks = defaultFetchJwks, now = () => Date.now() } = {}) {
  const teamDomain = teamDomainOf(env);
  const audience = typeof env?.ADMIN_ACCESS_AUD === "string" && env.ADMIN_ACCESS_AUD.trim() !== ""
    ? env.ADMIN_ACCESS_AUD.trim() : null;
  const allowlist = parseOperatorAllowlist(env?.ADMIN_OPERATOR_EMAILS);
  if (!teamDomain || !audience || !allowlist) return null;

  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) return null;
  const segments = token.split(".");
  if (segments.length !== 3) return null;

  const header = decodeSegment(segments[0]);
  const payload = decodeSegment(segments[1]);
  if (!header || !payload) return null;
  // Exact algorithm pin. "none", HS256, or anything else is an immediate no.
  if (header.alg !== "RS256" || typeof header.kid !== "string") return null;

  let jwks;
  try {
    jwks = await fetchJwks(teamDomain);
  } catch {
    return null;
  }
  const jwk = jwks?.keys?.find?.((k) => k?.kid === header.kid && k?.kty === "RSA");
  if (!jwk) return null;

  let valid = false;
  try {
    const key = await crypto.subtle.importKey(
      "jwk", { kty: jwk.kty, n: jwk.n, e: jwk.e },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"],
    );
    valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5", key,
      base64UrlToBytes(segments[2]),
      new TextEncoder().encode(`${segments[0]}.${segments[1]}`),
    );
  } catch {
    return null;
  }
  if (!valid) return null;

  const nowSeconds = Math.floor(now() / 1000);
  if (payload.iss !== teamDomain) return null;
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(audience)) return null;
  if (typeof payload.exp !== "number" || payload.exp <= nowSeconds) return null;
  if (typeof payload.nbf === "number" && payload.nbf > nowSeconds) return null;

  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (email === "" || !allowlist.includes(email)) return null;
  return { email };
}
