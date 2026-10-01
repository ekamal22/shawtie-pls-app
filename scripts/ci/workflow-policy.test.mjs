import assert from "node:assert/strict";
import test from "node:test";
import { validateGithubAutomationFile } from "./workflow-policy.mjs";

const fullSha = "0123456789abcdef0123456789abcdef01234567";

test("composite actions reject unpinned external actions", () => {
  const failures = validateGithubAutomationFile(
    ".github/actions/example/action.yml",
    `runs:
  using: composite
  steps:
    - uses: actions/setup-node@v4
`,
  );

  assert.equal(failures.length, 1);
  assert.match(failures[0], /pinned to a full commit SHA/);
});

test("composite actions accept pinned external and local actions", () => {
  const failures = validateGithubAutomationFile(
    ".github/actions/example/action.yml",
    `runs:
  using: composite
  steps:
    - uses: actions/setup-node@${fullSha}
    - uses: ./.github/actions/another
`,
  );

  assert.deepEqual(failures, []);
});

test("workflows retain permission timeout and pinning policy", () => {
  const failures = validateGithubAutomationFile(
    ".github/workflows/example.yml",
    `name: Example
on: workflow_dispatch
jobs:
  example:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v4
`,
  );

  assert.equal(failures.some((failure) => failure.includes("explicit permissions")), true);
  assert.equal(failures.some((failure) => failure.includes("timeout-minutes")), true);
  assert.equal(failures.some((failure) => failure.includes("full commit SHA")), true);
});
