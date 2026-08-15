import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Route canonicalization (owner decision): the durable public acquisition URL
// is https://agent.mototrack.app/invite. Every homepage recruitment CTA must
// point at the canonical URL, and none may still name the legacy
// /request-invite path (which survives only as a permanent redirect on the
// agent host for links already published).
test("homepage recruitment CTAs use the canonical /invite URL", () => {
  const homepage = readFileSync(join(import.meta.dirname, "..", "public", "index.html"), "utf8");
  const canonical = (homepage.match(/https:\/\/agent\.mototrack\.app\/invite"/g) || []).length;
  assert.ok(canonical >= 3, `expected the recruitment CTAs to target /invite (found ${canonical})`);
  assert.ok(!homepage.includes("request-invite"), "no homepage link may still use the legacy /request-invite path");
  // Non-recruitment destinations stay untouched.
  assert.ok(homepage.includes('href="/log/"'), "the free app link is unchanged");
  assert.ok(homepage.includes('href="https://agent.mototrack.app/"'), "the Track Agent landing link is unchanged");
});
