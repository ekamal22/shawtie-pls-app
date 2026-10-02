import { spawnSync } from "node:child_process";

function run(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
  });
  if (result.status !== 0) {
    throw new Error(command + " " + args.join(" ") + " failed");
  }
}

run("npm", ["run", "health"]);
run("npm", ["run", "test:r2:security"]);
run("npm", ["run", "secret:scan"]);
run("npm", ["audit", "--audit-level=high"]);
run("git", ["diff", "--check"]);
run("node", ["scripts/ci/r2-manual-evidence.mjs"]);

console.log("R2_AUTOMATED_AND_MANUAL_GATE_PASS");
