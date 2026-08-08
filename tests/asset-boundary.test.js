import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, posix, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

// The public static-asset publication boundary (issue #36), asserted as a
// contract. Production must publish ONLY intentionally public web assets:
// everything is private by default, and a file becomes web-addressable solely
// by being placed in ./public AND listed in the manifest below. If this suite
// fails, either something private is about to be published or an intended
// public asset is about to disappear — both are deploy-blocking.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = join(repoRoot, "public");

// ---------------------------------------------------------------------------
// 1. The deployment mechanism itself: every environment's asset directory must
//    be ./public. Pointing any environment back at the repository root would
//    silently republish source, tests, and migrations.
const wranglerSource = readFileSync(join(repoRoot, "wrangler.jsonc"), "utf8");
const wrangler = JSON.parse(wranglerSource.replace(/^\s*\/\/.*$/gm, ""));
assert.equal(wrangler.assets?.directory, "./public", "production assets must publish ./public only");
for (const [envName, envConfig] of Object.entries(wrangler.env ?? {})) {
  assert.equal(
    envConfig.assets?.directory,
    "./public",
    `env ${envName} assets must publish ./public only — never the repository root`,
  );
}

// ---------------------------------------------------------------------------
// 2. The exact approved public asset set. Set equality in both directions:
//    a file added to ./public without being approved here fails the gate, and
//    an approved asset that goes missing fails it too. Directories are
//    approved as trees only where their entire content is public by intent.
const APPROVED_PUBLIC_FILES = [
  "_headers", // platform header config — consumed by Workers Assets, never served
  "app.js",
  "homepage.css",
  "index.html",
  "investor-preview.css",
  "investor-preview.html",
  "log.html",
  "log/index.html",
  "privacy.html",
  "storage.js",
  "styles.css",
  "terms.html",
  "tire-core.js",
  "waitlist-form.js",
  "waitlist.html",
];
const APPROVED_PUBLIC_TREES = ["assets"]; // images/icons only, checked below
const APPROVED_TREE_EXTENSIONS = new Set([".png", ".webp", ".ico", ".svg", ".woff2"]);

const actual = [];
(function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else actual.push(relative(publicRoot, full).split(sep).join(posix.sep));
  }
})(publicRoot);

const inApprovedTree = (path) =>
  APPROVED_PUBLIC_TREES.some((tree) => path.startsWith(tree + posix.sep));
for (const path of actual) {
  if (inApprovedTree(path)) {
    const ext = posix.extname(path);
    assert.ok(
      APPROVED_TREE_EXTENSIONS.has(ext),
      `public/${path}: only static media may live in an approved tree, not "${ext}" files`,
    );
  } else {
    assert.ok(
      APPROVED_PUBLIC_FILES.includes(path),
      `public/${path} is not an approved public asset. Publishing a new file is a ` +
        "deliberate act: add it to APPROVED_PUBLIC_FILES in this suite as part of the same change.",
    );
  }
}
for (const path of APPROVED_PUBLIC_FILES) {
  assert.ok(actual.includes(path), `approved public asset public/${path} is missing`);
}

// ---------------------------------------------------------------------------
// 3. Representative repository-internal artifacts: they must exist (so these
//    are real names, not fabricated ones) and must sit OUTSIDE the published
//    directory. This is the recurrence guard for the exposure this issue
//    fixes: /src/waitlist-worker.js, /tests/waitlist.test.js and friends were
//    publicly reachable before the boundary existed.
const FORBIDDEN_ARTIFACTS = [
  "src/waitlist-worker.js",
  "tests/waitlist.test.js",
  "migrations/0001_waitlist.sql",
  "wrangler.jsonc",
  "package.json",
  "package-lock.json",
  ".github",
  ".gitignore",
  ".node-version",
  "docs",
];
for (const artifact of FORBIDDEN_ARTIFACTS) {
  assert.ok(existsSync(join(repoRoot, artifact)), `expected repository artifact missing: ${artifact}`);
  assert.ok(
    !existsSync(join(publicRoot, artifact)),
    `${artifact} must never be inside the published directory`,
  );
}

// No implementation artifact type may appear anywhere under ./public,
// regardless of name — belt and braces on top of the manifest.
const FORBIDDEN_EXTENSIONS = new Set([".sql", ".jsonc", ".toml", ".md"]);
for (const path of actual) {
  assert.ok(!FORBIDDEN_EXTENSIONS.has(posix.extname(path)), `public/${path}: forbidden artifact type`);
  assert.ok(!path.endsWith(".test.js"), `public/${path}: test files must never be published`);
  assert.ok(!path.split(posix.sep).some((part) => part.startsWith(".git")), `public/${path}: repo metadata`);
}

// ---------------------------------------------------------------------------
// 4. Link integrity: every local src/href in a published HTML file must
//    resolve to a published asset, so moving the public set cannot silently
//    break a live page. URL paths are unchanged by the ./public move, but this
//    holds for any future restructuring too.
const resolveLocal = (fromHtml, ref) => {
  const clean = ref.split(/[?#]/)[0];
  if (clean === "") return null; // pure fragment/query
  let target = clean.startsWith("/")
    ? clean.slice(1)
    : posix.join(posix.dirname(fromHtml), clean);
  if (target === "" || target.endsWith("/")) target = posix.join(target, "index.html");
  return posix.normalize(target);
};
for (const page of actual.filter((p) => p.endsWith(".html"))) {
  const html = readFileSync(join(publicRoot, page), "utf8");
  for (const [, , ref] of html.matchAll(/(src|href)="([^"]+)"/g)) {
    if (/^(https?:|mailto:|#)/.test(ref)) continue;
    const target = resolveLocal(page, ref);
    if (target === null) continue;
    assert.ok(
      actual.includes(target),
      `public/${page} references "${ref}" -> public/${target}, which is not published`,
    );
  }
}

console.log(`asset-boundary.test.js passed (${actual.length} published assets, boundary ./public)`);
