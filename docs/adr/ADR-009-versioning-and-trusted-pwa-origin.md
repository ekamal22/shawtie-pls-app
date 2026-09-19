# ADR-009: Explicit Versioning and Trusted PWA Origin

## Status

Accepted.

## Context

A PWA can remain cached while server contracts and cryptographic formats evolve.

The trusted browser origin also handles decrypted data, so arbitrary third-party JavaScript would weaken the E2EE boundary.

## Decision

Track explicit:

- client version
- API version
- crypto protocol version
- local IndexedDB schema version
- realtime schema version where needed

Unsupported critical versions fail closed.

The trusted application origin must not load:

- advertising scripts
- arbitrary remote JavaScript
- third-party analytics capable of arbitrary execution in the app origin

Use strict browser hardening, controlled service-worker updates, dependency pinning, and minimal runtime dependencies.

## Consequences

Benefits:

- safer PWA upgrades
- explicit crypto migration behavior
- lower XSS and supply-chain exposure
- predictable local-schema migrations

Costs:

- compatibility policy becomes an ongoing maintenance responsibility
- forced refresh or update flows may occasionally be required
