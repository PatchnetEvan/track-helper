import { userHasPremiumAccess } from "./premium-access.js";
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

async function requirePremium(request, body) {
  const userId = request.headers.get("x-user-id") || body.user_id || body.userId || "anonymous";
  const allowed = await userHasPremiumAccess(userId);
  return { allowed, userId };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === "GET" && pathname === "/health") {
      return json({ ok: true, service: "track-agent" });
    }

    if (request.method === "POST" && pathname === "/track-agent/parse") {
      const body = await readJson(request);
      const access = await requirePremium(request, body);
      if (!access.allowed) return json({ error: "premium_access_required" }, 403);

      const rawNote = body.raw_note || body.rawNote || body.note || "";
      const parsed = parseTrackSessionNote(rawNote, {
        user_id: access.userId,
        motorcycle_ref: body.motorcycle_ref || null,
        track_ref: body.track_ref || null,
        event_ref: body.event_ref || null,
        app_session_ref: body.app_session_ref || null,
      });
      return json({ parsed });
    }

    if (request.method === "POST" && pathname === "/track-agent/save") {
      const body = await readJson(request);
      const access = await requirePremium(request, body);
      if (!access.allowed) return json({ error: "premium_access_required" }, 403);

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
      const access = await requirePremium(request, {});
      if (!access.allowed) return json({ error: "premium_access_required" }, 403);

      const sessions = await getTrackAgentSessions(env, access.userId);
      return json({ sessions });
    }

    const sessionParts = routeParams(pathname, "/track-agent/session");
    if (request.method === "GET" && sessionParts && sessionParts.length === 1) {
      const access = await requirePremium(request, {});
      if (!access.allowed) return json({ error: "premium_access_required" }, 403);

      const session = await getTrackAgentSession(env, access.userId, sessionParts[0]);
      if (!session) return json({ error: "not_found" }, 404);
      return json({ session });
    }

    const summaryParts = routeParams(pathname, "/track-agent/summary");
    if (request.method === "GET" && summaryParts && summaryParts.length === 1) {
      const access = await requirePremium(request, {});
      if (!access.allowed) return json({ error: "premium_access_required" }, 403);

      const summary = await summarizeTrackAgentDay(env, access.userId, summaryParts[0]);
      return json({ summary });
    }

    return json({ error: "not_found" }, 404);
  },
};
