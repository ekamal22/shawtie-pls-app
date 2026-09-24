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

## R1 relationship-content compatibility

R1 adds `contentSchemaVersion` per relationship item and interprets it together with item kind.

Unknown kind or content schema version fails closed.

Pre-S1 server plaintext validation uses the registered kind/version schema. S1 keeps outer kind/version metadata while plaintext validation moves to the authorized client before encryption.

Preview and main envelopes use the same content schema version but distinct authenticated payload roles. The reviewed encryption design must prevent preview/main substitution.

Release durable payload version is independent of content schema version. Release generation is also independent and fences schedule identity, not serialization.

A client that cannot render a supported server item version must show an update-required state rather than guessing.

## Realtime compatibility

Realtime messages contain a schema or protocol version.

Unknown critical event versions must trigger canonical resynchronization rather than unsafe interpretation.

## M2 concrete compatibility policy

M2 starts with:

- realtimeProtocolVersion = 1
- localSchemaVersion = 1
- API namespace = /api/v1
- pre-S1 local content context = pre-s1

The pre-S1 content context is a local storage discriminator only. It is not a cryptographic epoch and must not be represented as encryption.

The client may enter live realtime mode only when the negotiated realtime protocol is supported and the race-free dirty-counter/high-water reconciliation barrier closes for the current in-memory connection generation.

The client may replay offline mutations only when:

- the authenticated session is current
- the client/API compatibility state is supported
- the IndexedDB schema version is supported
- the current local namespace matches the authoritative account and partnership
- the operation schema is recognized

A waiting service worker does not activate blindly when that could mix incompatible application code, local schema, and mutation semantics. M2 pauses replay, checkpoints local state, activates the compatible worker, reloads, validates IndexedDB, validates the session, performs canonical resynchronization, and only then resumes replay.

An IndexedDB migration failure is a fail-closed state. The client must not guess field meanings or replay operations under an unknown schema. Before S1, a cold start or hard reload while offline also remains locked until server-session validation because local protected content is development plaintext rather than reviewed encrypted offline state.

Future C1 signaling or S1 cryptographic changes that require incompatible realtime semantics must introduce an explicitly reviewed protocol-version transition rather than silently changing version 1. M2 scope identity is immutable per socket, so a compatibility or authority transition that changes partnership/conversation identity closes and re-establishes the connection rather than mutating the old scope in place.

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
- unknown R1 content schema version fails closed
- preview/main payload-role mismatch fails closed after S1

## C1 call compatibility

C1 introduces two independently versioned protocols.

`shawtie.realtime.v2` preserves the M2 v1 semantics and adds the content-free `call.changed` server invalidation. Server rollout supports v1 and v2 during transition. A browser that negotiated only v1 is not C1-capable and the call UI must remain disabled rather than silently receiving an unknown v1 frame.

`shawtie.call.v1` is the transient accepted-call signaling protocol. SDP/ICE semantic changes that old call clients cannot safely ignore require a new call-signaling version.

The service-worker/client compatibility gate must prevent stale application code from being treated as C1-capable after the server enables realtime v2.

The shared WebSocket server does not implicitly negotiate across protocol families. A connection offers exactly one application subprotocol; the global handler rejects unknown or multiple offers; the route verifies the exact protocol it owns. Realtime v1/v2 keep the 4 KiB M2 application-frame limit even if the transport ceiling increases for `shawtie.call.v1` SDP.

C1 durable scheduled/outbox payloads remain independently versioned and unknown payload versions fail closed.
