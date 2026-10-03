const token = process.env.GITHUB_ADMIN_TOKEN?.trim();
const repository = process.env.GITHUB_REPOSITORY?.trim() || "ekamal22/shawtie-pls-app";
if (!token) throw new Error("GITHUB_ADMIN_TOKEN is required");

const response = await fetch(
  "https://api.github.com/repos/" + repository + "/branches/main/protection",
  {
    headers: {
      accept: "application/vnd.github+json",
      authorization: "Bearer " + token,
      "x-github-api-version": "2022-11-28",
    },
  },
);
if (!response.ok) {
  throw new Error("Reading main protection failed with HTTP " + response.status);
}
const protection = await response.json();
const contexts = protection.required_status_checks?.contexts ?? [];
const failures = [];

if (protection.required_status_checks?.strict !== true) failures.push("strict_status_checks");
if (!contexts.includes("Repository foundation")) failures.push("repository_foundation_check");
if (protection.enforce_admins?.enabled !== true) failures.push("admin_enforcement");
if (protection.required_linear_history?.enabled !== true) failures.push("linear_history");
if (protection.allow_force_pushes?.enabled === true) failures.push("force_push_allowed");
if (protection.allow_deletions?.enabled === true) failures.push("branch_deletion_allowed");
if (protection.required_conversation_resolution?.enabled !== true) {
  failures.push("conversation_resolution");
}

if (failures.length > 0) {
  console.error("R2_REPOSITORY_GOVERNANCE_VERIFY_FAIL gates=" + failures.join(","));
  process.exit(1);
}

console.log(
  "R2_REPOSITORY_GOVERNANCE_VERIFY_PASS repository=" +
    repository +
    " checks=" +
    contexts.join(","),
);
