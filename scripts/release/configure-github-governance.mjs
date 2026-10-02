const token = process.env.GITHUB_ADMIN_TOKEN?.trim();
const repository = process.env.GITHUB_REPOSITORY?.trim() || "ekamal22/shawtie-pls-app";
if (!token) throw new Error("GITHUB_ADMIN_TOKEN is required");

const headers = {
  accept: "application/vnd.github+json",
  authorization: "Bearer " + token,
  "x-github-api-version": "2022-11-28",
  "content-type": "application/json",
};

async function request(method, path, body) {
  const response = await fetch("https://api.github.com/repos/" + repository + path, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    throw new Error(method + " " + path + " failed with HTTP " + response.status);
  }
  return response.status === 204 ? null : response.json();
}

await request("PUT", "/branches/main/protection", {
  required_status_checks: {
    strict: true,
    contexts: ["Repository foundation"],
  },
  enforce_admins: true,
  required_pull_request_reviews: null,
  restrictions: null,
  required_linear_history: true,
  allow_force_pushes: false,
  allow_deletions: false,
  block_creations: false,
  required_conversation_resolution: true,
  lock_branch: false,
  allow_fork_syncing: true,
});

if (process.env.R2_DELETE_OBSOLETE_M3_BRANCH === "1") {
  const ref = encodeURIComponent("heads/design/m3-media-voice");
  const response = await fetch(
    "https://api.github.com/repos/" + repository + "/git/refs/" + ref,
    { method: "DELETE", headers },
  );
  if (!response.ok && response.status !== 404) {
    throw new Error("Deleting obsolete design/m3-media-voice failed with HTTP " + response.status);
  }
}

console.log("R2_REPOSITORY_GOVERNANCE_APPLIED repository=" + repository);
