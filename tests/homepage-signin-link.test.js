import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// A returning approved rider landing on the marketing homepage
// (mototrack.app) had no way back into Track Agent Pro - "Open MotoTrack
// Log" and "Request Beta Access" both exist, but neither is a sign-in
// path, and the header nav named no sign-in option at all. Adds a
// persistent "Sign In" link to the canonical Track Agent Pro auth surface.
test("homepage header nav includes a Sign In link to the canonical auth surface", () => {
  const homepage = readFileSync(join(import.meta.dirname, "..", "public", "index.html"), "utf8");
  assert.match(homepage, /<a class="nav-signin" href="https:\/\/agent\.mototrack\.app\/login">Sign In<\/a>/,
    "the header nav links Sign In to the real Track Agent Pro login page");
});

test("the Sign In link stays visible in the mobile-collapsed header nav", () => {
  const css = readFileSync(join(import.meta.dirname, "..", "public", "homepage.css"), "utf8");
  assert.match(css, /\.site-header nav a:not\(\.nav-cta\):not\(\.nav-signin\) \{ display:none; \}/,
    "the mobile nav-collapse rule keeps both the primary CTA and Sign In visible");
  assert.match(css, /\.nav-signin \{ white-space:nowrap; \}/,
    "Sign In stays on one line rather than wrapping awkwardly next to the primary CTA");
});
