// Shared wait-list token helpers.
//
// Extracted so the invitation batch can mint a REAL unsubscribe link with the
// same semantics as the welcome email, rather than either duplicating the
// logic or importing the Worker (which would create a cycle, since the Worker
// imports the batch module's retention sweep).
//
// Raw tokens are never stored - only their digests - so "resend the link"
// always means "mint a fresh token and supersede the old one".

export function tokenId(prefix) { return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`; }

export function mintToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function mintAndStoreToken(db, signupId, purpose, ttlMinutes) {
  const raw = mintToken();
  await db.prepare(`UPDATE waitlist_tokens SET superseded_at = datetime('now')
    WHERE signup_id = ? AND purpose = ? AND used_at IS NULL AND superseded_at IS NULL`).bind(signupId, purpose).run();
  await db.prepare(`INSERT INTO waitlist_tokens (id, signup_id, token_digest, purpose, expires_at)
    VALUES (?, ?, ?, ?, ${ttlMinutes ? `datetime('now', '+${ttlMinutes} minutes')` : "NULL"})`)
    .bind(tokenId("wlt"), signupId, await sha256Hex(raw), purpose).run();
  return raw;
}

/** A usable unsubscribe token. Every wait-list email carries a working one. */
export async function activeUnsubscribeToken(db, signupId) {
  return mintAndStoreToken(db, signupId, "unsubscribe", 0);
}
