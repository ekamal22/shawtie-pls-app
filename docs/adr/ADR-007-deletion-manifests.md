# ADR-007: Durable Deletion Manifests

## Status

Accepted.

## Context

Partnership dissolution and permanent account deletion require cleanup across PostgreSQL, object storage, local clients, push state, realtime authorization, cryptographic state, and backups.

These systems cannot participate in one atomic transaction.

## Decision

Use durable deletion manifests and target records.

On final destructive transition:

1. revoke authorization
2. invalidate cryptographic access where applicable
3. prevent new writes
4. create deletion manifest
5. process each deletion target idempotently
6. retry failed targets until complete
7. record backup-expiration obligations

Authorization revocation must not wait for asynchronous physical cleanup.

## Consequences

Benefits:

- deletion is crash-safe
- partial provider failure does not restore access
- cleanup progress is observable
- offline clients can be instructed to purge later

Costs:

- deletion becomes a workflow rather than a single transaction
- operational tooling must track incomplete manifests
- backup policy must be explicit
