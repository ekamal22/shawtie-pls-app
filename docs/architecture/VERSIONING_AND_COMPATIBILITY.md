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
```

Additional feature-specific protocol versions may be added when needed.

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
