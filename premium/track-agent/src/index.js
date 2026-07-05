import { requireTrackAgentAccess } from "./premium-access.js";
import { TrackAgentProviderError } from "./providers/provider-errors.js";
import { renderTrackAgentClientScript, renderTrackAgentHtml, renderTrackAgentLandingHtml } from "./ui.js";
import {
  getTrackAgentSession,
  getTrackAgentSessions,
  parseTrackSessionNote,
  saveReviewedTrackAgentSession,
  summarizeTrackAgentDay,
  TrackAgentValidationError,
} from "./track-agent-service.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function html(body, status = 200, extraHeaders = {}) {
  const headers = new Headers({
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  Object.entries(extraHeaders).forEach(([name, value]) => {
    if (Array.isArray(value)) {
      value.forEach((item) => headers.append(name, item));
    } else if (value != null) {
      headers.set(name, value);
    }
  });
  return new Response(body, { status, headers });
}

function redirect(location, status = 302, extraHeaders = {}) {
  const headers = new Headers({
    "location": location,
    "cache-control": "no-store",
  });
  Object.entries(extraHeaders).forEach(([name, value]) => {
    if (Array.isArray(value)) {
      value.forEach((item) => headers.append(name, item));
    } else if (value != null) {
      headers.set(name, value);
    }
  });
  return new Response(null, { status, headers });
}

function accessPendingHtml() {
  return html(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Track Agent Access Pending</title>
  <style>
    :root { color-scheme: dark; --bg: #121212; --panel: #1d1d1d; --text: #f4f4f4; --muted: #a8a8a8; --accent: #ff6600; --border: #343434; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--text); font: 16px/1.45 system-ui, -apple-system, Segoe UI, sans-serif; }
    main { width: min(92vw, 560px); background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 24px; }
    h1 { margin: 0 0 8px; font-size: 1.35rem; }
    p { color: var(--muted); margin: 0; }
    strong { color: var(--accent); }
  </style>
</head>
<body>
  <main>
    <h1>Track Agent access pending</h1>
    <p><strong>agent.mototrack.app</strong> is invitation-only right now. Use an invited Track Agent user id or invite token to continue.</p>
  </main>
</body>
</html>`, 403);
}

function javascript(body) {
  return new Response(body, {
    headers: {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function readJson(request) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) return {};
  return request.json();
}

function routeParams(pathname, prefix) {
  if (!pathname.startsWith(prefix)) return null;
  const tail = pathname.slice(prefix.length).replace(/^\/+/, "");
  return tail ? tail.split("/") : [];
}

function isTrackAgentUiPage(method, pathname) {
  return method === "GET" && pathname === "/track-agent";
}

function isPublicLandingPage(method, pathname) {
  return method === "GET" && (pathname === "/" || pathname === "/request-invite");
}

function cleanAccessUrl(url) {
  const clean = new URL(url);
  const accessParams = ["invite_token", "inviteToken", "user_id", "userId"];
  let changed = false;
  accessParams.forEach((name) => {
    if (clean.searchParams.has(name)) {
      clean.searchParams.delete(name);
      changed = true;
    }
  });
  return changed ? `${clean.pathname}${clean.search}${clean.hash}` : null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (isPublicLandingPage(request.method, pathname)) {
      return html(renderTrackAgentLandingHtml());
    }

    if (isTrackAgentUiPage(request.method, pathname)) {
      const access = await requireTrackAgentAccess(request, env);
      if (!access.allowed) return accessPendingHtml();
      const cleanUrl = cleanAccessUrl(url);
      if (cleanUrl) return redirect(cleanUrl, 302, { "set-cookie": access.cookieHeaders });
      return html(renderTrackAgentHtml(), 200, { "set-cookie": access.cookieHeaders });
    }

    if (request.method === "GET" && pathname === "/track-agent/ui.js") {
      const access = await requireTrackAgentAccess(request, env);
      if (!access.allowed) return access.response;
      return javascript(renderTrackAgentClientScript());
    }

    if (request.method === "GET" && pathname === "/health") {
      return json({ ok: true, service: "track-agent" });
    }

    if (request.method === "POST" && pathname === "/track-agent/parse") {
      const body = await readJson(request);
      const access = await requireTrackAgentAccess(request, env, body);
      if (!access.allowed) return access.response;

      try {
        const rawNote = body.raw_note || body.rawNote || body.note || "";
        const parsed = await parseTrackSessionNote(rawNote, {
          user_id: access.userId,
          motorcycle_ref: body.motorcycle_ref || null,
          track_ref: body.track_ref || null,
          event_ref: body.event_ref || null,
          app_session_ref: body.app_session_ref || null,
        }, env);
        return json({ parsed });
      } catch (error) {
        if (error instanceof TrackAgentProviderError) {
          return json({
            error: error.code,
            provider: error.provider,
            message: error.message,
          }, error.status);
        }
        throw error;
      }
    }

    if (request.method === "POST" && pathname === "/track-agent/save") {
      const body = await readJson(request);
      const access = await requireTrackAgentAccess(request, env, body);
      if (!access.allowed) return access.response;

      if (body.confirmed !== true) {
        return json({
          error: "confirmation_required",
          message: "Track Agent parsed output is never saved until the rider confirms it.",
        }, 400);
      }

      try {
        const saved = await saveReviewedTrackAgentSession(env, {
          ...body,
          user_id: access.userId,
        });
        return json({ saved });
      } catch (error) {
        if (error instanceof TrackAgentValidationError) {
          return json({
            error: "validation_failed",
            message: error.message,
            details: error.details,
          }, 400);
        }
        throw error;
      }
    }

    if (request.method === "GET" && pathname === "/track-agent/sessions") {
      const access = await requireTrackAgentAccess(request, env);
      if (!access.allowed) return access.response;

      const sessions = await getTrackAgentSessions(env, access.userId);
      return json({ sessions });
    }

    const sessionParts = routeParams(pathname, "/track-agent/session");
    if (request.method === "GET" && sessionParts && sessionParts.length === 1) {
      const access = await requireTrackAgentAccess(request, env);
      if (!access.allowed) return access.response;

      const session = await getTrackAgentSession(env, access.userId, sessionParts[0]);
      if (!session) return json({ error: "not_found" }, 404);
      return json({ session });
    }

    const summaryParts = routeParams(pathname, "/track-agent/summary");
    if (request.method === "GET" && summaryParts && summaryParts.length === 1) {
      const access = await requireTrackAgentAccess(request, env);
      if (!access.allowed) return access.response;

      const summary = await summarizeTrackAgentDay(env, access.userId, summaryParts[0]);
      return json({ summary });
    }

    return json({ error: "not_found" }, 404);
  },
};
