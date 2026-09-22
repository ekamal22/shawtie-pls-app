# Offline Architecture

## M2 concrete implementation

The concrete implementation is defined in `M2_REALTIME_OFFLINE_DESIGN.md`.

Implementation status: M2 offline source is complete through `6e3c019371edd96a081c71ff178b6ee82f406566`; executed local and physical-device closure are pending.

M2 local schema version 1 uses an account-bound IndexedDB database with explicit partnership and conversation keys. Before S1, the content context marker is the literal development namespace `pre-s1`; it is not a fake crypto epoch.

M2 provides separate chat and R1 queues. Release/open/reveal and scheduled-release transitions remain online-only. The SyncCoordinator does not start canonical reconciliation or replay while `navigator.onLine` is false; queued work remains persisted and resumes only after connectivity returns.

Final dissolution removes old partnership data from UI before replay and then purges messages, R1 cache, queues, sync metadata, and future media/crypto namespace state.

Explicit logout, account switch, or observed revocation closes the active M2 runtime before deleting the account-bound IndexedDB database, then purges pre-S1 local protected plaintext. A temporary network failure does not. However, before S1, a cold start or hard reload while offline must not unlock cached protected plaintext because the HttpOnly server session cannot be revalidated; the app shows a locked offline shell until online validation succeeds.

## Goals

The PWA should remain usable across temporary disconnects without leaking data between accounts or partnerships.

## Local storage boundary

IndexedDB data must be partitioned by:

```text
accountId
partnershipId
conversationId
cryptoEpoch
localSchemaVersion
cryptoProtocolVersion
```

Do not use one unscoped global message cache.

A conceptual local layout is:

```text
account
  partnership
    conversation cache
      latest_server_sequence
      latest_change_sequence
    relationship cache
    media metadata
    chat outbox
    relationship outbox
    crypto state
```

For messaging, `latest_server_sequence` tracks immutable message creation/history order while `latest_change_sequence` tracks durable send/edit/delete/reaction reconciliation. A client must not treat the message-order cursor as sufficient mutation synchronization.

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

A cryptographic epoch transition also creates a distinct key namespace inside the same partnership.

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
expected_content_version nullable
created_at
retry_count
```

M2 may queue only operations whose feature policy explicitly permits offline replay. Message edits must preserve the M1 `expectedContentVersion` contract so reconnect cannot silently overwrite a newer edit.

### Relationship outbox

For relationship-object mutations that are explicitly designed to support offline writes.

M2 version 1 queues only:

- item create when release is null or immediate and all references are already-authoritative/currently supported
- item patch when the release field is omitted and expectedVersion is preserved
- item delete with expectedVersion

M2 version 1 does not queue manual release, scheduled/recipient-open/creator-reveal create, any patch that carries a release field, or media/Voice Letter references. The design-complete M3 path keeps binary-dependent work in dedicated media drafts, upload jobs, and pending parent bundles rather than widening the generic M2 R1 queue.

Do not silently reuse the chat outbox schema.


### M3 media drafts and upload jobs

M3 binary data does not enter the M2 JSON chat outbox.

The planned M3 local-schema upgrade adds account/partnership-scoped stores for:

- media draft metadata
- media draft blobs
- media upload jobs
- pending message bundles

A pending message bundle contains the stable eventual M1 message idempotency key plus ordered local media draft IDs.

Replay uploads and finalizes every required media asset first. Only then is the normal M2 message-send operation materialized with ready server media IDs.

A network loss after provider PUT, after media completion, or before message send must be resumable without creating duplicate media or duplicate messages.

If authoritative lifecycle later rejects the message, ready unreferenced media becomes orphan cleanup work.

Queueing succeeds only after the IndexedDB transaction containing the draft/job/bundle commits. `navigator.storage.estimate()` is advisory only. Quota or transaction failure must remain visible and cannot be represented as queued.

Pre-S1 local media drafts follow the same cold-start lock as other M2 protected development plaintext. S1 must migrate or wipe incompatible local drafts.

## Idempotency

Every queued server mutation carries a stable client idempotency key. A locally queued message is rendered as pending and never receives a fake server sequence; authoritative sequence is assigned only by M1 after server acceptance. Multi-tab replay additionally uses local claim owner/generation/expiry metadata so a stale tab cannot remove work reclaimed by a newer tab; server idempotency remains the correctness backstop.

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

Before replaying queued mutations, the M2 SyncCoordinator serializes one authority refresh and must refresh:

- account state
- partnership state
- authorization
- durable messaging changes after the last committed `change_sequence`
- any required message-history gaps by `server_sequence`
- cooldown state where relevant

If the partnership has entered a state that disallows the queued action, the operation is rejected locally and server-side.

## Service worker

The service worker may cache:

- application shell
- static assets
- explicitly safe public resources

It must not create a separate uncontrolled cache of decrypted private content.

Private data caching belongs in the application-controlled IndexedDB layer. The PWA requests persistent storage when supported, but does not claim that browser/OS eviction or user-cleared site data can never remove local state. An operation is shown as queued only after its IndexedDB transaction commits; quota or storage failure leaves it unqueued and preserves the user's unsent text where practical.

## Device revocation

When the server reports that the current device is revoked:

- stop mutation replay
- stop realtime and call signaling
- discard usable partnership key state for that revoked authorization according to the E2EE design
- require fresh authorized enrollment before protected content can be decrypted again

## Compatibility

Before replaying offline state, verify supported:

- client version
- API version
- local schema version
- crypto protocol version

An incompatible client must fail closed rather than submitting mutations under an unknown state or encryption format.

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
