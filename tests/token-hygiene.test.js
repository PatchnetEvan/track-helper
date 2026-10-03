import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// styles.css must name no colour, no font and no raw size of its own. Every
// value comes from shared/mt-tokens.css, which is the one file Free and Pro
// both read. A literal here is how the two apps drift apart again.
const CSS = readFileSync(join(import.meta.dirname, "..", "public", "styles.css"), "utf8");
const TOKENS = readFileSync(join(import.meta.dirname, "..", "public", "shared", "mt-tokens.css"), "utf8");

test("styles.css contains no hex colour", () => {
  const hits = CSS.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  assert.deepEqual(hits, [], `hex literals left: ${[...new Set(hits)].join(", ")}`);
});

test("styles.css contains no rgba()", () => {
  assert.equal((CSS.match(/rgba\(/g) || []).length, 0, "rgba() belongs in the token sheet");
});

test("styles.css names no font family", () => {
  const hits = (CSS.match(/font-family:\s*[^;]+;/g) || []).filter((d) => !d.includes("var("));
  assert.deepEqual(hits, [], `font-family literals left: ${hits.join(" | ")}`);
});

test("the old token names are gone", () => {
  for (const old of ["--bg", "--bg-elev", "--bg-elev-2", "--border", "--text-dim",
                     "--accent", "--accent-dim", "--tap", "--radius"]) {
    const used = new RegExp("var\\(" + old + "\\)").test(CSS);
    assert.equal(used, false, `${old} is still read; it should be an --mt-* token`);
  }
});

test("the token sheet carries both themes and the agreed overrides", () => {
  assert.match(TOKENS, /\[data-mt="dark"\]/, "the dark selector is data-mt=dark, not body[data-mt=sun]");
  // The SELECTOR, not the word: the header comment explains the rename.
  assert.ok(!/\[data-mt="sun"\]\s*\{/.test(TOKENS), '"sun" names the opposite of what it shows');
  assert.match(TOKENS, /--mt-tap:\s*48px/, "the smallest tap is raised to 48");
  assert.match(TOKENS, /--mt-text-label:\s*13px/, "the label step meets the 13px floor");
  assert.match(TOKENS, /--mt-glove:\s*72px/, "the glove size is named");
  assert.match(TOKENS, /--mt-shell-max:\s*430px/);
  assert.match(TOKENS, /edit here only/, "the header says this file is the source of truth");
});

test("the protected sizes are named, not retyped", () => {
  assert.match(CSS, /min-height: var\(--mt-glove\)/, "72px controls read the glove token");
  assert.match(CSS, /min-height: var\(--mt-cta\)/, "the dock reads the CTA token");
  assert.match(CSS, /var\(--mt-tap-primary\)/, "symptom cells and the unit switch read their own token");
});
