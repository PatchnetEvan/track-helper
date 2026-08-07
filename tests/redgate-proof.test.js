import assert from "node:assert/strict";

// TEMPORARY. Proves the Workers Builds gate fails red on a failing suite.
// Removed in the next commit on this branch.
assert.equal(1, 2, "deliberate red-gate proof");
