import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// The homepage walkthrough video is served same-origin from public/assets.
// Every CSP that governs the homepage defaults to 'none', so the video only
// plays if each one grants media-src 'self' - and nothing broader.
const root = join(import.meta.dirname, "..");
const read = (...p) => readFileSync(join(root, ...p), "utf8");
const homepage = read("public", "index.html");

test("homepage embeds the walkthrough video from same-origin assets", () => {
  const video = homepage.match(/<video\b[^>]*>[\s\S]*?<\/video>/)?.[0] ?? "";
  assert.ok(video, "the homepage has a <video> element");
  assert.match(video, /<source src="assets\/track-day-walkthrough\.mp4" type="video\/mp4" \/>/);
  assert.match(video, /poster="assets\/track-day-walkthrough-poster\.webp"/);
  assert.match(video, /\scontrols\b/, "the rider controls playback");
  assert.match(video, /\splaysinline\b/, "iOS plays inline instead of forcing fullscreen");
  assert.match(video, /preload="none"/, "the ~10 MB file is not fetched until the rider presses play");
  assert.doesNotMatch(video, /\sautoplay\b/, "the video never starts on its own");
  for (const asset of ["track-day-walkthrough.mp4", "track-day-walkthrough-poster.webp"]) {
    const path = join(root, "public", "assets", asset);
    assert.ok(existsSync(path), `public/assets/${asset} exists`);
    // Workers Static Assets rejects any single file over 25 MiB.
    assert.ok(statSync(path).size < 25 * 1024 * 1024, `${asset} fits the static-asset size limit`);
  }
});

test("the walkthrough section sits after the workflow section", () => {
  const workflow = homepage.indexOf('id="workflow"');
  const walkthrough = homepage.indexOf('id="walkthrough"');
  assert.ok(workflow > 0 && walkthrough > workflow, "walkthrough follows the workflow section");
});

test("every homepage CSP grants media-src 'self' and nothing broader", () => {
  const meta = homepage.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1] ?? "";
  const headers = read("public", "_headers").match(/^\/\*\n\s*Content-Security-Policy: (.+)$/m)?.[1] ?? "";
  const vercel = JSON.parse(read("vercel.json")).headers[0].headers
    .find((h) => h.key === "Content-Security-Policy")?.value ?? "";
  for (const [name, csp] of [["index.html meta", meta], ["_headers /*", headers], ["vercel.json", vercel]]) {
    assert.match(csp, /default-src 'none'/, `${name}: restrictive default preserved`);
    assert.match(csp, /(^|; )media-src 'self';/, `${name}: grants same-origin media`);
    assert.doesNotMatch(csp, /media-src[^;]*(\*|https?:|data:|blob:)/, `${name}: media is same-origin only`);
  }
  assert.match(headers, /connect-src 'none'/, "_headers /*: connect-src stays 'none'");
  assert.match(vercel, /connect-src 'none'/, "vercel.json: connect-src stays 'none'");
});
