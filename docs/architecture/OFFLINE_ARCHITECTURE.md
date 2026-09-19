# Offline Architecture

## Goals

The PWA should remain usable across temporary disconnects without leaking data between accounts or partnerships.

## Local storage boundary

IndexedDB data must be partitioned by:

```text
accountId
partnershipId
conversationId
cryptoEpoch
```

Do not use one unscoped global message cache.

A conceptual local layout is:

```text
account
  partnership
    conversation cache
    relationship cache
    media metadata
    chat outbox
    relationship outbox
    crypto state
```

## Partnership isolation

A partnership is a local data boundary as well as a server boundary.

At final dissolution:

- purge partnership message cache
- purge relationship cache
- purge media metadata
- delete queued operations
- delete local decryption state
- delete partnership keys according to the E2EE design
- remove partnership-specific push and realtime state

A future partnership between the same two accounts still receives a new local namespace and new cryptographic context.

## Offline queues

Use separate typed queues.

### Chat outbox

For:

- text sends
- replies
- media-send finalization where safe

Representative operation fields:

```text
client_operation_id
account_id
partnership_id
conversation_id
operation_type
payload
created_at
retry_count
```

### Relationship outbox

For relationship-object mutations that are explicitly designed to support offline writes.

Do not silently reuse the chat outbox schema.

## Idempotency

Every queued server mutation carries a stable client idempotency key.

Retries must not create duplicates.

## Version conflicts

Shared mutable state uses expected-version checks.

When reconnecting after offline edits:

- if expected version still matches, apply
- if it does not match, return conflict
- client refetches canonical state
- UI presents or resolves the conflict according to feature-specific policy

Do not silently overwrite partner changes.

## State changes while offline

Before replaying queued mutations, the client must refresh:

- account state
- partnership state
- authorization
- cooldown state where relevant

If the partnership has entered a state that disallows the queued action, the operation is rejected locally and server-side.

## Service worker

The service worker may cache:

- application shell
- static assets
- explicitly safe public resources

It must not create a separate uncontrolled cache of decrypted private content.

Private data caching belongs in the application-controlled IndexedDB layer.

## Logout and account switch

Logout or account switch must:

- remove session-scoped in-memory state
- stop realtime connections
- stop call signaling
- clear sensitive decrypted caches
- ensure one account cannot render another account's partnership data

Persistent encrypted local state may remain only if the security model explicitly allows it and the user is expected to sign back into the same account.

## Failure behavior

The UI must distinguish:

- queued locally
- accepted by server
- delivered
- read

A locally queued message must not be represented as delivered.
