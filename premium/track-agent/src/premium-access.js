function truthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());
}

function splitList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeToken(value) {
  return String(value || "").trim();
}

function parseCookies(cookieHeader) {
  const cookies = {};
  String(cookieHeader || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => {
      const separator = part.indexOf("=");
      if (separator === -1) return;
      const name = part.slice(0, separator).trim();
      const value = part.slice(separator + 1).trim();
      cookies[name] = decodeURIComponent(value);
    });
  return cookies;
}

function readAccessIdentity(request, body = {}) {
  const url = new URL(request.url);
  const cookies = parseCookies(request.headers.get("cookie"));
  const queryUserId = url.searchParams.get("user_id") || url.searchParams.get("userId");
  const queryInviteToken = url.searchParams.get("invite_token") || url.searchParams.get("inviteToken");
  const headerUserId = request.headers.get("x-user-id");
  const headerInviteToken = request.headers.get("x-track-agent-invite-token");
  return {
    userId: headerUserId || body.user_id || body.userId || queryUserId || cookies.track_agent_user_id || "anonymous",
    inviteToken: normalizeToken(headerInviteToken || body.invite_token || body.inviteToken || queryInviteToken || cookies.track_agent_invite_token),
    shouldSetCookie: Boolean(headerUserId || body.user_id || body.userId || queryUserId || headerInviteToken || body.invite_token || body.inviteToken || queryInviteToken),
    isHttps: url.protocol === "https:",
  };
}

function cookieOptions(identity) {
  return [
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=86400",
    identity.isHttps ? "Secure" : null,
  ].filter(Boolean).join("; ");
}

function accessResponse(message = "Track Agent is invitation-only right now.") {
  return new Response(JSON.stringify({
    error: "track_agent_access_required",
    message,
  }, null, 2), {
    status: 403,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export async function userHasPremiumAccess(userId, env = {}, accessContext = {}) {
  const inviteOnly = env.INVITE_ONLY == null ? true : truthy(env.INVITE_ONLY);
  if (!inviteOnly && truthy(env.TRACK_AGENT_ALLOW_OPEN_ACCESS)) return true;

  const allowedUsers = new Set(splitList(env.TRACK_AGENT_ALLOWED_USER_IDS));
  if (allowedUsers.has(userId)) return true;

  const devUsers = new Set(splitList(env.DEV_USER_ID));
  if (truthy(env.TRACK_AGENT_ENABLE_DEV_USER_ID) && devUsers.has(userId)) return true;

  const expectedToken = normalizeToken(env.TRACK_AGENT_INVITE_TOKEN);
  const providedToken = normalizeToken(accessContext.inviteToken);
  if (expectedToken && providedToken && providedToken === expectedToken) return true;

  return false;
}

export async function requireTrackAgentAccess(request, env = {}, body = {}) {
  const identity = readAccessIdentity(request, body);
  const allowed = await userHasPremiumAccess(identity.userId, env, identity);

  if (allowed) {
    console.log("track_agent_access_allowed", { user_id: identity.userId });
    const cookieHeaders = [];
    if (identity.shouldSetCookie && identity.userId && identity.userId !== "anonymous") {
      cookieHeaders.push(`track_agent_user_id=${encodeURIComponent(identity.userId)}; ${cookieOptions(identity)}`);
    }
    if (identity.shouldSetCookie && identity.inviteToken) {
      cookieHeaders.push(`track_agent_invite_token=${encodeURIComponent(identity.inviteToken)}; ${cookieOptions(identity)}`);
    }
    return {
      allowed: true,
      userId: identity.userId,
      cookieHeaders,
      response: null,
    };
  }

  console.log("track_agent_access_denied", { user_id: identity.userId });
  return {
    allowed: false,
    userId: identity.userId,
    cookieHeaders: [],
    response: accessResponse(),
  };
}
