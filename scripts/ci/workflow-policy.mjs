export function validateGithubAutomationFile(relative, content) {
  const failures = [];
  const isWorkflow =
    relative.startsWith(".github/workflows/") && /\.ya?ml$/.test(relative);
  const isComposite =
    relative.startsWith(".github/actions/") && /\.ya?ml$/.test(relative);

  if (!isWorkflow && !isComposite) return failures;

  if (isWorkflow) {
    if (/pull_request_target\s*:/.test(content)) {
      failures.push(
        `pull_request_target is forbidden without an accepted security review: ${relative}`,
      );
    }

    if (/permissions\s*:\s*write-all/.test(content)) {
      failures.push(`write-all workflow permissions are forbidden: ${relative}`);
    }

    if (!/^permissions\s*:/m.test(content)) {
      failures.push(`Workflow must declare explicit permissions: ${relative}`);
    }

    if (!/timeout-minutes\s*:/.test(content)) {
      failures.push(`Workflow jobs must declare timeout-minutes: ${relative}`);
    }
  }

  for (const match of content.matchAll(/^\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/gm)) {
    const reference = match[1];

    if (reference.startsWith("./")) continue;

    const atIndex = reference.lastIndexOf("@");
    const ref = atIndex >= 0 ? reference.slice(atIndex + 1) : "";

    if (!/^[0-9a-f]{40}$/i.test(ref)) {
      failures.push(
        `External GitHub Action must be pinned to a full commit SHA: ${relative}: ${reference}`,
      );
    }
  }

  return failures;
}
