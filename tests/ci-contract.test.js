import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

// The automated gate itself, asserted as a contract. `npm test` is the single
// command the deploy pipeline runs, so the things that make it trustworthy —
// zero installable dependencies, a Node version the manifest and the build
// image agree on, and executable suites that default `node --test` discovery
// actually finds — are checked here rather than left to convention. If this
// suite fails, the gate is no longer the gate it was authorized as.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (name) => JSON.parse(readFileSync(join(repoRoot, name), "utf8"));

const pkg = readJson("package.json");

// A pinned package identity. Without an explicit name npm derives one from the
// working directory, so the lockfile would churn between clones.
assert.equal(pkg.name, "mototrack", "the package name must be pinned, not derived from the checkout directory");
assert.equal(pkg.private, true, "the manifest must stay private so it can never be published");
assert.equal(pkg.type, "module", "every source and test file in this repo is ESM");
assert.equal(pkg.scripts.test, "node --test", "npm test is the canonical, auto-discovering gate");

// Nothing is installed to run the suites. An install step that can fetch code
// is an install step that can change what the gate executes.
for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
  assert.equal(field in pkg, false, `${field} must not exist: the test gate installs nothing`);
}

const lock = readJson("package-lock.json");
assert.equal(lock.name, "mototrack", "the lockfile must carry the pinned package name");
assert.equal(lock.packages?.[""]?.name, "mototrack", "the lockfile root package must be mototrack");
assert.deepEqual(
  Object.keys(lock.packages ?? {}),
  [""],
  "the lockfile must resolve to the root package only — no third-party code enters the gate",
);
assert.deepEqual(lock.dependencies ?? {}, {}, "the lockfile must declare no third-party packages");

// The gate is standardized on Node 24: `node:sqlite` is flagged on Node 22, and
// pinning one major keeps the build image and the manifest from drifting apart.
const nodeVersion = readFileSync(join(repoRoot, ".node-version"), "utf8").trim();
assert.equal(nodeVersion, "24", ".node-version must pin Node 24");

const satisfies = (version, range) => {
  const parse = (value) => {
    const [major = 0, minor = 0, patch = 0] = value.split(".").map(Number);
    return [major, minor, patch];
  };
  const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  const target = parse(version);
  return range
    .trim()
    .split(/\s+/)
    .every((comparator) => {
      const match = /^(>=|<=|>|<|=)?v?(\d+(?:\.\d+){0,2})$/.exec(comparator);
      assert.ok(match, `engines.node comparator not understood: ${comparator}`);
      const result = compare(target, parse(match[2]));
      switch (match[1] ?? "=") {
        case ">=": return result >= 0;
        case "<=": return result <= 0;
        case ">": return result > 0;
        case "<": return result < 0;
        default: return result === 0;
      }
    });
};

assert.ok(pkg.engines?.node, "engines.node must record the supported Node range");
for (const accepted of ["24.0.0", `${nodeVersion}.0.0`, "24.99.99"]) {
  assert.ok(satisfies(accepted, pkg.engines.node), `engines.node must accept Node ${accepted}`);
}

// Discovery contract:
//   Executable test files:                      **/*.test.js
//   Non-test JavaScript helpers/fixtures:       tests/helpers/** or tests/fixtures/**
// Default `node --test` discovery matches *.test.js, so an executable suite
// parked under any other name silently never runs. Helpers and fixtures are
// legitimately not suites, so they get the two designated homes above and are
// exempt there — and only there.
const EXEMPT_PREFIXES = [join("tests", "helpers"), join("tests", "fixtures")];
const SKIP_DIRS = new Set([".git", ".github", ".wrangler", "node_modules", "assets"]);

const testDirs = [];
(function findTestDirs(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.name === "test" || entry.name === "tests") testDirs.push(full);
    else findTestDirs(full);
  }
})(repoRoot);

assert.ok(testDirs.length >= 2, "the wait-list and Track Agent suites must both be present");

let discovered = 0;
for (const dir of testDirs) {
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".js")) continue;
    const path = relative(repoRoot, join(entry.parentPath ?? dir, entry.name));
    if (EXEMPT_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix + sep))) continue;
    assert.ok(
      entry.name.endsWith(".test.js"),
      `${path} is not discovered by node --test. Executable suites must be *.test.js; ` +
        "non-test helpers and fixtures belong in tests/helpers/ or tests/fixtures/.",
    );
    discovered += 1;
  }
}

assert.ok(discovered >= 13, `expected at least 13 discoverable suites, found ${discovered}`);

console.log(`ci-contract.test.js passed (${discovered} discoverable suites)`);
