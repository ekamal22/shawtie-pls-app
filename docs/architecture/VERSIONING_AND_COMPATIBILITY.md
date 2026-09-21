# Versioning and Compatibility

## Purpose

A PWA can remain open or cached while the server and cryptographic protocol evolve.

Version compatibility must be explicit.

## Versions

Track at minimum:

```text
clientVersion
apiVersion
cryptoProtocolVersion
localSchemaVersion
durablePayloadVersion
```

Additional feature-specific protocol versions may be added when needed.

Durable work stored in PostgreSQL can outlive one process deployment, so scheduled-action and outbox payload compatibility must also be explicit.

## API version

Public application APIs should use a versioned namespace such as:

```text
/api/v1
```

Breaking API changes require an explicit compatibility plan.

## Client compatibility

The server may define:

- minimum supported client version
- recommended client version
- current client version

If a client is too old to safely mutate data, the server must reject unsafe operations and require refresh or update.

## Crypto compatibility

Every encrypted envelope must identify the cryptographic protocol version required to process it.

A client must never guess how to decrypt an unknown protocol version.

Protocol migration must define:

- read compatibility
- write compatibility
- device upgrade ordering
- recovery behavior
- rollback limitations

## Local schema compatibility

IndexedDB schema versions must be explicit.

Migrations must preserve partnership isolation.

A failed migration must not merge namespaces from different accounts, partnerships, conversations, or crypto epochs.

## Service worker

The service worker update flow must avoid serving an incompatible mix of old application code and new API assumptions.

Where safe operation cannot be guaranteed, fail closed and require an application refresh.

## Durable worker payload compatibility

Scheduled actions and outbox events carry an explicit payload version.

Workers dispatch by work type plus payload version.

Unknown durable payload versions must fail closed. A worker must not guess how to interpret a payload written by a newer deployment.

Before writing a new durable payload version, rollout planning must define:

- which deployed worker versions can read it
- whether the old payload version remains writable
- upgrade ordering between API and worker deployments
- retry behavior for already persisted older payloads
- rollback limitations

Durable payload versioning does not replace aggregate generation checks. Payload versions protect serialization compatibility, while aggregate generations protect lifecycle correctness.

## Partnership version versus generation

P2 formalizes two separate counters on partnership state:

- `version` protects optimistic concurrency for mutable partnership metadata such as `relationship_start_date`
- `generation` fences lifecycle and deadline-sensitive transitions such as breakup and account-deletion interactions

A relationship-date update increments `version` only. It must not invalidate a scheduled lifecycle action by incrementing `generation`. Lifecycle transitions may change generation according to their own state-machine rules.

P2 clients submit `expectedMetadataVersion` for relationship metadata updates and refetch on conflict.

## Realtime compatibility

Realtime messages contain a schema or protocol version.

Unknown critical event versions must trigger canonical resynchronization rather than unsafe interpretation.

## Testing

Compatibility testing must include:

- old client against new server
- supported new client against old local schema
- crypto protocol version mismatch
- interrupted service-worker update
- IndexedDB migration failure
- forced minimum-version upgrade
- old worker against a newer durable payload version
- new worker processing a supported older durable payload version
- unknown scheduled-action payload version fails closed
- unknown outbox payload version fails closed
