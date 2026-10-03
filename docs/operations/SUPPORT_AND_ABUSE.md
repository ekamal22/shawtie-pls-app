# Support and Abuse Operations

## Scope

R2 provides a minimal launch support workflow for account compromise, abusive usernames, impersonation, partner-request harassment, suspected illegal use, and other support issues.

The product endpoint is:

```text
POST /api/v1/support/reports
```

Authentication is required. Account and canonical network rate limits apply.

## User-submitted data

A report may contain:

- category
- optional bounded username/account reference
- optional internal target account ID when supplied by an authorized product path
- user-written details up to 2,000 characters
- reporter identity and timestamps

The UI warns the reporter not to paste:

- protected message or media content
- passwords
- verification codes
- recovery keys

Shawtie does not ask the server to decrypt E2EE content for support.

## Operator queue

Operators use:

```text
R2_SUPPORT_ADMIN_CONFIRM=1 npm run ops:r2:support -- list
R2_SUPPORT_ADMIN_CONFIRM=1 npm run ops:r2:support -- resolve <report-uuid>
```

The command must be executed only in an authorized private operator environment with `DATABASE_URL` injected from the production secret store. Its output can contain user-submitted report text and must not be copied into public issue trackers, CI logs, or repository documentation.

## Category handling

### Abusive username

Review the reported username/account reference and account metadata that the service is authorized to inspect. Do not request protected conversation content merely to evaluate a username.

### Impersonation

Use account identity metadata and the reporter's supplied context. Do not claim identity verification capabilities that the product does not implement.

### Partner-request harassment

Review request metadata that Shawtie already stores, including sender/recipient identities, timing, and request lifecycle. Private message content is not required.

### Account compromise

Prioritize device/session revocation, password recovery, verified-email security, and recovery guidance. Never request the Recovery Master Secret or raw session credentials.

### Suspected illegal use

Preserve only authorized account/report metadata needed to handle the report. The E2EE boundary may prevent Shawtie from inspecting protected message or media plaintext. Escalation outside the service must follow applicable legal obligations and owner/legal review.

## E2EE limitation

Protected content is designed so the server cannot read application plaintext. Support staff must not promise content inspection that the architecture does not provide.

A user may voluntarily describe what happened in the support report, but that text becomes support data and is not the original protected content.

## Account deletion

Permanent account deletion removes:

- reports submitted by the deleting account
- notification preferences
- policy-acceptance rows

If another report targets the deleting account, its internal target account ID is cleared. The separately supplied subject reference may remain as part of the reporting user's support record until that report is resolved or its future retention policy removes it.

## Launch acceptance

Before Stable Release, execute at least one synthetic report for each operational path that materially differs:

- create
- list
- resolve
- account deletion cleanup

Record only synthetic identifiers and aggregate evidence in the R2 acceptance record.
