import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// The MotoTrack Pro landing page (agent.mototrack.app, private repository)
// embeds this walkthrough video and poster from mototrack.app, the same way it
// loads every other image under assets/track-agent/. Moving or renaming either
// file breaks that page, so the paths are pinned here.
const dir = join(import.meta.dirname, "..", "public", "assets", "track-agent");

test("the Pro landing walkthrough video and poster stay published", () => {
  for (const asset of ["track-day-walkthrough.mp4", "track-day-walkthrough-poster.webp"]) {
    const path = join(dir, asset);
    assert.ok(existsSync(path), `public/assets/track-agent/${asset} exists`);
    // Workers Static Assets rejects any single file over 25 MiB.
    assert.ok(statSync(path).size < 25 * 1024 * 1024, `${asset} fits the static-asset size limit`);
  }
  const mp4 = readFileSync(join(dir, "track-day-walkthrough.mp4"));
  assert.equal(mp4.subarray(4, 8).toString("latin1"), "ftyp", "the video is an MP4 container");
});

test("the public homepage does not embed the Pro walkthrough", () => {
  const homepage = readFileSync(join(import.meta.dirname, "..", "public", "index.html"), "utf8");
  assert.doesNotMatch(homepage, /<video\b|track-day-walkthrough/);
});
