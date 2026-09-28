# UX8 Encrypted UX Integration Design

Status: DESIGN HARDENED AND FROZEN; UX8 AUTOMATED CLOSURE PASS, PHYSICAL ANDROID 25/25 PASS. UX8 IS DONE AND MERGED TO `main` AT `a029169`.

Implementation branch: `feat/ux8-encrypted-ux-integration`.

Implementation baseline: `main @ 2b36c6258f43a39b2661ee1f48994a46945a4929`.

S1 authority: DONE and merged. Final corrective executable `cde73a1a789b0768aa67f95e8f542fe98a8dfc8b`; final evidence merge anchor `71569cf68f785315c9d0f0d052639b46aad9caf9`; Android acceptance 30/30.

UX8 integrates the verified S1 cryptographic states into the accepted Home, Talk, Ours, and Us experience. Automated closure re-passed at final corrective executable `43ff9b1ec319703f3d9270ae8053ab196ca54419` after a physical-run defect fix, and the mandatory Redmi Note 9S 25/25 gate is closed; this document remains the frozen design authority. It does not redesign the cryptographic protocol, create new security authority, add persistence, or change product lifecycle semantics.

## 1. Authority and inputs

UX8 is bound by the following existing authorities:

- `docs/design/UX0_IMPLEMENTATION_SPEC.md`
- `docs/design/UX1_FOUNDATION.md`
- `docs/design/ROMANTIC_UX_DIRECTION.md`
- `docs/architecture/S1_E2EE_CRYPTO_RECOVERY_DESIGN.md`
- `docs/security/E2EE_ARCHITECTURE.md`
- `docs/security/DEVICE_AND_RECOVERY.md`
- `docs/security/SECURITY_MODEL.md`
- A1 account/session/device authority
- P3 lifecycle/deletion authority
- M1 message authority
- R1 release/visibility authority
- M2 realtime/offline authority
- M3 media authority
- C1/C2 call authority

When these authorities disagree with presentation convenience, the authority wins.

UX8 may add:

- presentation state
- client-side status composition
- local-only ephemeral form state
- new React components and feature-local styles
- safe client-side helpers that expose non-secret S1 status already present in the local vault or server projections
- browser tests and physical Android acceptance harnesses

UX8 may not add without separate architecture approval:

- a new API route
- a new database table, column, or migration
- a new cryptographic protocol
- new recovery semantics
- new durable lifecycle state
- new device authority
- automatic server-side trust promotion
- plaintext fallback
- a new call-encryption claim
- analytics containing security-sensitive values

## 2. Product goal

Make verified S1 behavior understandable and recoverable without turning Shawtie pls into a security dashboard.

A user should be able to answer:

1. Is this device allowed to use protected sharing?
2. Is protected history recoverable on this device?
3. Does another device need approval?
4. Is sending temporarily blocked because device access is being updated?
5. Is old protected content unavailable only on this device, or is the whole account broken?
6. What does email/account recovery restore, and what does it not restore?
7. When a destructive repair creates a new group generation, what changes and what does not?

Healthy cryptography should be quiet. Security state becomes prominent only when the user needs to act or when content cannot be safely shown.

## 3. Non-goals

UX8 does not:

- create a generic security center unrelated to S1
- expose MLS epochs, group IDs, ciphersuite names, key package counts, or crypto-device UUIDs in normal UI
- ask users to understand cryptographic terminology
- add QR device linking
- add trusted-device recovery-capability transfer that S1 does not currently implement
- add recovery-key rotation UI
- add recovery-key cloud backup
- add automatic clipboard or file backup of the Recovery Master Secret
- promise that device approval restores historical protected content
- promise that email recovery restores protected history
- display plaintext after signature, ciphertext, or integrity verification fails
- add an end-to-end-encrypted badge to calls
- change C1/C2 relay-only call semantics

Recovery-key rotation is deliberately not exposed in UX8. S1 versions recovery material, but the current product documents do not define a user-facing rotation guarantee for historical capsules. A future rotation flow requires a dedicated security review.

## 4. Security truth shown to users

UX8 may truthfully say:

> Messages, relationship content, and shared media are end-to-end encrypted after S1 activation. Shawtie's server stores ciphertext and required metadata, not the protected plaintext.

UX8 must also preserve this limitation:

> Approved devices and someone who possesses the user's Recovery Master Secret may be able to restore recoverable historical content.

Do not use:

- "Only you two can ever read this"
- "Nobody else can ever access this"
- "Perfect forward secrecy"
- "Your calls are protected by S1"
- "Account recovery restores everything"
- "Device approval restores your old messages"

Calls remain governed by C1/C2. Existing copy such as "Private relay calling" may remain. UX8 does not claim S1 cryptographic identity authentication for calls.

## 5. UX8 state model

UX8 composes existing A1 and S1 state into a presentation-only model.

### 5.1 Runtime state

```text
starting
ready
unavailable
```

Sources:

- `S1CryptoRuntimeProvider`
- `S1RuntimeStatus.available`
- `S1RuntimeStatus.errorCode`

`CRYPTO_STARTING` is loading, not failure.

A startup failure shows Retry and Sign out. It does not delete local crypto state automatically.

### 5.2 Current crypto-device trust

```text
pending
trusted
revoked
unavailable
```

Source:

- `CryptoDeviceProjection.trustState`

Meaning:

- `pending`: authenticated A1 device exists, but this cryptographic identity cannot yet write protected content
- `trusted`: current device may participate in S1 according to current partnership/group state
- `revoked`: fail closed; A1 session revocation is authoritative and normal sign-out/revocation handling follows
- `unavailable`: no usable S1 device identity/runtime

### 5.3 Recovery state

UX8 needs a client presentation projection derived from:

- `GET /api/v1/crypto/recovery/bundle`
- the local crypto vault's recovery state
- current crypto-device trust

Presentation states:

```text
not_configured
configured_here
configured_elsewhere
pending_can_recover
unavailable
```

Definitions:

- `not_configured`: server has no recovery bundle
- `configured_here`: server recovery exists and this device has matching local recovery private state
- `configured_elsewhere`: server recovery exists but this trusted device does not hold matching local recovery state
- `pending_can_recover`: current device is pending and a server recovery bundle exists, so RMS recovery may both trust this device and restore recovery capability
- `unavailable`: status could not be established safely

Implementation may add a safe runtime helper such as:

```ts
interface S1LocalRecoveryStatus {
  configured: boolean;
  recoveryKeyVersion: number | null;
}
```

This helper exposes no secret bytes.

No server API change is needed.

### 5.4 Partnership crypto state

Derived from `CryptoPartnershipState`, runtime synchronization, and local group availability:

```text
none
preparing
waiting_for_recovery
ready
rekeying
repair_required
unavailable
```

Definitions:

- `none`: no current partnership
- `preparing`: legitimate short-lived group bootstrap/join state
- `waiting_for_recovery`: crypto-required activation or protected writes are blocked because recovery recipients are incomplete
- `ready`: normal protected operation
- `rekeying`: `group.rekeyRequired === true`
- `repair_required`: server has a crypto-required active group but this trusted device has irrecoverable current local group state and has valid local recovery capability
- `unavailable`: safe state could not be established

The implementation must not infer `repair_required` from a timeout alone. It must be based on a deterministic failure path such as persistent `CRYPTO_GROUP_NOT_READY` after authoritative state/control reconciliation on a trusted device where local recovery capability is available.

### 5.5 Content availability

Content availability is per protected object, not an account-wide boolean.

```text
available
history_unavailable
integrity_failed
not_released
deleted
```

These must remain distinct.

- `history_unavailable`: `CRYPTO_HISTORY_UNAVAILABLE`; show a protected-content placeholder for that object
- `integrity_failed`: ciphertext/signature verification failure; do not show plaintext and do not silently downgrade
- `not_released`: R1 authority has not supplied main protected content yet; keep the existing sealed experience
- `deleted`: existing M1/R1 deletion behavior

A single unavailable old message must not make the whole conversation disappear.

### 5.6 Canonical composed presentation model

All UX8 surfaces consume one derived presentation model. Home, Talk, Ours, Us, and Auth must not independently reinterpret raw A1 or S1 state.

The implementation contract is:

```ts
type SecurityTaskKind =
  | "none"
  | "session_invalid"
  | "runtime_unavailable"
  | "device_pending"
  | "recovery_not_configured"
  | "partnership_waiting_for_recovery"
  | "rekeying"
  | "repair_required";

type ProtectedWriteState =
  | "allowed"
  | "blocked_session"
  | "blocked_runtime"
  | "blocked_device_pending"
  | "blocked_recovery_prerequisite"
  | "blocked_rekey"
  | "blocked_repair";

interface CryptoSecurityViewModel {
  runtime: "starting" | "ready" | "unavailable";
  currentDeviceTrust: "pending" | "trusted" | "revoked" | "unavailable";
  recovery:
    | "not_configured"
    | "configured_here"
    | "configured_elsewhere"
    | "pending_can_recover"
    | "unavailable";
  partnership:
    | "none"
    | "preparing"
    | "waiting_for_recovery"
    | "ready"
    | "rekeying"
    | "repair_required"
    | "unavailable";
  primaryTask: SecurityTaskKind;
  protectedWrites: ProtectedWriteState;
  canApproveOtherDevices: boolean;
  canUseRecoveryKeyHere: boolean;
  canOfferGroupRepair: boolean;
  securityStateRevision: string;
}
```

`securityStateRevision` is an opaque client reconciliation revision used only to reject stale async UI results. It is not a new server authority, database field, or security credential.

A surface may render content-specific availability in addition to this model, but it must not invent a second account or partnership crypto state machine.

### 5.7 Deterministic resolution precedence

The composed model resolves top-level conditions in this order:

1. invalid authentication or A1 current-device revocation
2. S1 runtime unavailable after startup has conclusively failed
3. current cryptographic device pending
4. trusted device with recovery not configured
5. partnership waiting for required recovery recipients
6. rekey in progress
7. deterministic repair required
8. healthy

`starting` and `preparing` are bounded progress states, not warning states by themselves.

When several raw inputs are true at once, only the highest-priority actionable state becomes `primaryTask`. Lower-priority facts remain available in the detailed Us surface but must not create stacked global banners.

### 5.8 Blocking semantics

The view model freezes operational behavior rather than leaving it to screen copy:

| Condition | Protected writes | Existing readable protected content | Historical unavailable item | Primary action |
| --- | --- | --- | --- | --- |
| healthy | allowed | available | per-item placeholder only | none |
| runtime starting/preparing | temporarily blocked only where runtime cannot safely encrypt | keep already verified content visible | unchanged | wait/retry only if bounded startup fails |
| runtime unavailable | blocked | keep only already verified in-memory content for the current session; never decrypt new content | unchanged | Retry or Sign out |
| device pending | blocked | no newly decrypted protected history until authorized path succeeds | per-item | Recover or wait for trusted-device approval |
| recovery not configured | allowed if existing S1 authority permits writes | available | unchanged | Save recovery key |
| waiting for recovery recipients | blocked where S1 activation requires recipients | readable verified content remains | unchanged | Complete recovery setup |
| rekeying | blocked | readable verified content remains | unchanged | automatic, no destructive action |
| repair required | blocked | readable verified content remains where keys exist | per-item | explicit protected-sharing repair |
| integrity failed content | account state unchanged | unaffected items stay visible | affected item fails closed | none or retry fetch, never plaintext fallback |

No surface may convert an informational condition into a broader write block than the S1 runtime actually enforces.

### 5.9 Transition and stabilization contract

UX8 state changes may be triggered only by:

- authenticated A1 session/device refresh
- S1 runtime startup or authoritative refresh
- realtime invalidation followed by canonical HTTP/S1 reconciliation
- foreground/resume reconciliation
- explicit trusted-device approval result
- explicit RMS recovery result
- A1 device revocation
- S1 rekey completion/failure
- deterministic group-repair completion/failure
- partnership lifecycle changes already authorized by P3

Realtime events are hints, not direct authority. A realtime frame may schedule refresh, but the visible security state must be committed only from canonical reconciled state.

Every async action captures the current `securityStateRevision`. Its result may update UI only if it still applies to the current account, A1 device, crypto device, partnership generation, and revision. Otherwise the result is discarded and a fresh reconciliation runs.

To avoid flicker:

- `starting` does not become `unavailable` from a single transient fetch failure
- `rekeying` does not become `repair_required` because of elapsed time alone
- a temporary missing device row during refresh does not become `revoked` without authoritative A1/S1 evidence
- success screens do not remain visible after a later authoritative revoke, dissolution, or session invalidation

### 5.10 Lifecycle composition

P3 remains authoritative. UX8 does not create lifecycle permissions.

| Partnership/account lifecycle | UX8 behavior |
| --- | --- |
| active | normal S1-derived behavior |
| breakup_pending | preserve P3 read/write capabilities exactly; crypto warnings must not imply restoration or relationship pressure |
| restored partnership | reconcile current S1 group/generation before protected writes resume |
| finalized/terminated partnership | remove partnership-scoped security actions and purge local partnership crypto projections according to S1/P3 behavior |
| account_deletion_pending | account access restrictions win; UX8 does not offer recovery/approval actions that bypass A1 deletion state |
| account restored before deletion deadline | sign-in/account restoration does not imply historical crypto recovery; normal device trust/recovery evaluation runs again |

A partnership lifecycle transition always outranks stale UX8 action completion.

## 6. Security task priority

When multiple security conditions exist, UX8 surfaces only the highest actionable task first:

1. current device revoked or authentication invalid
2. runtime cannot start safely
3. current device pending
4. this account has no recovery setup
5. current partnership is waiting for one or both recovery recipients
6. rekey in progress
7. repair required
8. isolated historical content unavailable
9. healthy

Do not stack multiple red banners.

Healthy state is intentionally quiet.

## 7. Surface architecture

UX8 integrates into existing surfaces.

### Home

Home may show one compact security task card only when user action is required.

Examples:

- "Finish protected sharing on this device"
- "Save a recovery key"
- "Protected sharing is updating after a device change"

No healthy lock card belongs on Home.

The action navigates to Us -> Protected sharing.

### Talk

Talk owns inline operational crypto state that affects conversation use:

- pending device
- recovery prerequisite
- rekeying
- temporary preparing state
- per-message history unavailable
- per-message integrity failure

Healthy Talk has no persistent lock icon.

### Ours

Ours mirrors Talk's operational state but preserves R1 semantics:

- sealed unreleased items remain sealed for release reasons
- cryptographically unavailable released content gets a different placeholder
- creator/capability authority does not change
- no hidden-item metadata is revealed by crypto error copy

### Us

Us becomes the primary management surface for:

- current protected-sharing status
- recovery setup
- new-device recovery
- pending-device approval
- A1 device revocation plus crypto status
- repair flow when current MLS state is irrecoverable

It remains part of the existing Us screen. UX8 does not add a fourth bottom-nav destination.

### Auth recovery seam

After verified-email account recovery, AuthScreen must explicitly say:

> Account access recovered. Protected history is separate and may still need your recovery key after you sign in.

After the next sign-in, a pending crypto device routes the user toward Us -> Protected sharing without claiming history is restored.

## 8. Us -> Protected sharing

Add a new security block before the existing generic "Security confirmation" block.

Suggested heading:

**Protected sharing**

Healthy summary:

> Ready on this device.

Secondary copy:

> Messages, Ours content, and shared media are protected between approved devices. Recovery is separate from email account recovery.

Do not show technical IDs by default.

### 8.1 Current-device row

Show:

- A1 device display name
- "This device"
- protected-access status:
  - Pending
  - Approved
  - Revoked
  - Unavailable

Do not display the crypto-device UUID unless a debug/development surface explicitly needs it.

### 8.2 Recovery status row

Possible copy:

**Recovery key not set up**

> Create a recovery key so your protected history can be restored on a new device. Shawtie pls cannot retrieve this key for you.

Action: **Create recovery key**

**Recovery ready on this device**

> This device can use your recovery key material for recoverable history.

No secret is displayed.

**Recovery configured, not available here**

> This device can use protected sharing, but older protected history may be unavailable here.

Do not offer RMS recovery on an already-trusted device because the current S1 recovery proof intentionally requires a pending crypto device. Do not fake a recovery path.

If restoring old history on an already-approved device without existing recovery state becomes a product requirement, stop and report `S1_EXTENSION_REQUIRED`.

## 9. Recovery-key setup flow

Recovery setup uses the existing `S1CryptoRuntime.setupRecovery()`.

Server route already requires recent A1 reauthentication.

### Step 1: readiness

Before generating the secret, explain:

> Your recovery key can restore recoverable protected history on a new device. Shawtie pls does not receive or store the key itself.

> You will see it once after it is created. Save it somewhere private outside this device.

Actions:

- Cancel
- Continue

If recent reauthentication is missing, navigate/focus the existing Security confirmation flow. Do not ask for the password in a second competing component.

### Step 2: generate

Call `setupRecovery()` only after the user explicitly continues and recent reauthentication is valid.

No automatic setup.

### Step 3: one-time reveal

Title:

**Save your recovery key**

Body:

> Keep this somewhere private. You may need it to restore protected history on a new device. Shawtie pls cannot show this exact key again.

Controls:

- masked/unmasked key field
- **Copy recovery key**
- acknowledgement checkbox: "I saved this recovery key"
- **Done** disabled until acknowledged

The value:

- exists only in React memory after setup returns
- is never written to localStorage, sessionStorage, IndexedDB, Cache API, M2 outbox, logs, analytics, URL, history state, or clipboard automatically
- is cleared from component state when the flow completes
- may enter the system clipboard only after an explicit Copy action

Do not add a Download button in UX8.

Do not encourage screenshots.

### Step 4: completion

After acknowledgement:

> Recovery is ready.

The secret is removed from the rendered DOM and component state.

## 10. New-device flow

A newly authenticated device may auto-enroll into S1 as `pending`.

This is not an error.

The user gets two conceptually separate paths.

### Path A: Restore with recovery key

Available when:

- current crypto device is pending
- server recovery bundle exists

Copy:

> Restore this device with your recovery key.

> This approves this device for protected sharing and restores the recovery capability used for recoverable history.

Input:

- password-style by default
- optional Show/Hide
- paste allowed
- no autocomplete persistence
- no local persistence

Action calls `recoverWithMasterSecret()`.

On success:

- current device becomes trusted
- local recovery state is installed
- current partnership joins/self-heals through existing S1 runtime
- available historical protected content can decrypt through recovery capsules

Success:

> Protected history restored on this device.

On wrong secret:

> That recovery key could not unlock your protected history.

The device remains pending.

Clear the entered secret after each attempt.

### Path B: Approve from another trusted device

On the pending device show:

> Or approve this device from another device that already has protected access.

Do not imply the pending device can approve itself.

On an already trusted device, the device list shows pending crypto identities and action:

**Approve protected access**

Confirmation:

> Approve [device name] for protected sharing?

> This lets that device participate in future protected sharing. It does not promise that older protected history will be available there.

Action calls `S1CryptoRuntime.approveDevice(targetCryptoDeviceId)`.

The existing S1 group self-healing logic handles membership.

### Recovery and approval truth table

The user-facing promises are frozen:

| Path | Trusts pending crypto device | Future protected content | Recoverable historical content | Restores local recovery capability |
| --- | --- | --- | --- | --- |
| trusted-device approval | yes | yes after normal S1 reconciliation | not guaranteed | no |
| correct RMS recovery | yes | yes after normal S1 reconciliation | yes where S1 recovery capsules make it recoverable | yes |
| email/account recovery | no by itself | no by itself | no | no |
| password reset only | no by itself | no by itself | no | no |

Copy and tests must preserve this distinction. In particular, successful trusted-device approval must never say that old messages or memories were restored.

### Important sequencing rule

A pending device that needs historical recovery should use the recovery-key path before it is separately approved.

The current server recovery proof accepts only a pending crypto device. UX8 must not present approval and recovery as interchangeable actions.

## 11. Device list integration

Merge A1 device metadata and S1 crypto-device projections by A1 `deviceId`.

Each active A1 device can show a quiet secondary protected-access state:

- Approved for protected sharing
- Waiting for protected approval
- Protected access revoked
- Protected sharing unavailable

Existing A1 device revocation remains the only user-facing revoke action.

When the user revokes a device:

- existing A1 DELETE remains authoritative
- S1 revocation trigger invalidates the crypto identity and KeyPackages
- partnership rekey follows existing S1 behavior

Confirmation copy should add:

> This also removes the device from future protected sharing. Other approved devices may briefly update protected access afterward.

Do not add a separate "revoke crypto device" button.

## 12. Rekey UX

When `rekeyRequired` is true:

Talk/Ours banner:

**Updating protected access**

> A device changed. You can read content that is available here. Sending will resume when protected access is ready.

Behavior:

- protected writes disabled
- reads remain available where keys exist
- runtime reconciliation continues automatically
- no manual retry button during normal short rekey
- after a bounded visible delay, a quiet **Retry** action may call the existing runtime retry/reconciliation path

Do not say "your messages are unsafe."

Do not queue new plaintext drafts into a new UX8 store. Existing M2 protected-operation rules remain authoritative.

## 13. Group repair UX

Group reset is a recovery action, not a normal settings action.

It is shown only when the deterministic `repair_required` condition is established.

Title:

**Repair protected sharing**

Body:

> This device can recover your protected history, but its current protected-sharing session cannot be repaired normally.

> Repair starts a new protected-sharing generation for future content. Recoverable older history stays tied to its existing encrypted history.

Confirmation:

- Cancel, initially focused
- **Repair protected sharing**

Action calls `S1CryptoRuntime.resetPartnershipGroup(partnershipId)`.

After success:

> Protected sharing repaired.

The UI must not promise that all historical content will be recoverable. Per-content availability remains authoritative.

### 13.1 Deterministic repair eligibility predicate

UX8 may expose a destructive protected-sharing repair action only when all of the following are true at the same reconciled revision:

1. the authenticated A1 session is valid
2. the current A1 device is not revoked
3. the current S1 crypto device is trusted
4. the partnership is active under P3
5. the authoritative S1 partnership group is crypto-required and has a current active generation
6. authoritative control-message and group-state reconciliation has completed
7. protected writes still fail with the S1 equivalent of `CRYPTO_GROUP_NOT_READY`
8. the client has determined that the required current local group state is absent or unusable, rather than merely delayed
9. valid local recovery capability exists on this device
10. no rekey is currently making forward progress
11. a fresh reconciliation immediately before rendering the destructive action reaches the same conclusion

A timer, retry count, network failure, tab suspension, backgrounding, or one failed IndexedDB read is never sufficient.

Immediately before confirmation and again before execution, UX8 rechecks the predicate. If any input changed, the repair action aborts without mutation and the UI returns to reconciled state.

The confirmation copy must state that repair creates a new protected-sharing generation for future protected content and may not make unavailable older content recoverable.

## 14. Talk content behavior

Current projection decryption throws for one unavailable historical item and can therefore fail the whole page.

UX8 must change presentation plumbing so recoverable per-content failures do not collapse the entire conversation.

Introduce a view result such as:

```ts
type ProtectedViewState =
  | { kind: "available" }
  | { kind: "history_unavailable" }
  | { kind: "integrity_failed" };
```

Messages with `CRYPTO_HISTORY_UNAVAILABLE` render their envelope metadata and normal message topology without plaintext body:

> This older protected message is not available on this device.

If recovery is actionable on the current pending device, offer:

**Restore protected history**

Otherwise do not offer a dead action.

Reply context whose original body is unavailable shows:

> Protected reply unavailable on this device.

Reactions whose protected value is unavailable do not invent an emoji. They may be omitted with an accessible note in message details if necessary.

`CRYPTO_CIPHERTEXT_INVALID` or `CRYPTO_SIGNATURE_INVALID` renders:

> This protected message could not be verified. It was not displayed.

Integrity failures do not show a recovery CTA unless a separate recovery state independently requires one.

## 15. Ours content behavior

Released relationship items with unavailable historical keys render:

> This protected memory is not available on this device.

or context-specific noun:

- memory
- letter
- reason
- moment

Do not reveal hidden R1 main content merely because crypto failed.

For an unreleased item:

- existing R1 sealed presentation wins
- do not say "history unavailable"
- do not expose whether main ciphertext exists
- do not expose sender preparation metadata beyond existing R1 projection authority

Integrity failures render a neutral protected-content verification error and no plaintext.

## 16. Media behavior

If a protected media content key is unavailable:

> This protected attachment is not available on this device.

If the current device is pending and RMS recovery is available, link to the recovery flow.

If the media ciphertext or signature fails integrity verification:

> This protected attachment could not be verified.

Never fall back to a server preview or unencrypted object.

## 17. Account recovery separation

The existing verified-email recovery flow restores account access only.

UX8 adds explicit separation at two points.

### After email account recovery

> Account access recovered. Protected history is separate and may still need your recovery key after you sign in.

### After sign-in on a new device

If current crypto device is pending:

> You're signed in. This device still needs protected access.

Actions:

- Restore with recovery key
- Review device approval

Never show:

> Everything is restored.

until cryptographic recovery has actually succeeded for the relevant history.

## 18. Runtime failure copy

Stable mappings:

| Code/state | User-facing copy | Action |
| --- | --- | --- |
| `CRYPTO_STARTING` | "Preparing protected sharing..." | none |
| `CRYPTO_DEVICE_UNAVAILABLE` | "Protected sharing is unavailable on this browser session." | Retry, Sign out |
| `CRYPTO_DEVICE_UNTRUSTED` | "This device still needs protected access." | Go to Protected sharing |
| `CRYPTO_GROUP_NOT_READY` | "Protected sharing is still preparing for this relationship." | automatic retry; later Retry |
| `CRYPTO_REKEY_REQUIRED` | "Updating protected access after a device change." | automatic retry |
| `CRYPTO_RECOVERY_REQUIRED` | "Recovery setup is required before protected sharing can continue." | Go to Protected sharing |
| `CRYPTO_HISTORY_UNAVAILABLE` | per-content placeholder | Restore only when actually actionable |
| `CRYPTO_RECOVERY_FAILED` | "That recovery key could not unlock your protected history." | Try again |
| `CRYPTO_CIPHERTEXT_INVALID` | "This protected content could not be verified. It was not displayed." | none |
| `CRYPTO_SIGNATURE_INVALID` | "This protected content could not be verified. It was not displayed." | none |
| unsupported protocol/ciphersuite | "This version of Shawtie pls cannot safely open this protected content." | Update/retry when available |

Do not expose raw crypto error codes in normal UI.

### 18.1 Security copy contract

Security-sensitive copy is semantic product behavior. Implementations may make small grammatical adjustments for layout or localization, but must preserve these meanings:

| State/action | Required meaning |
| --- | --- |
| device pending | this device cannot use protected sharing yet; recover with the recovery key or have another trusted device approve it |
| trusted-device approval success | this device is trusted for protected sharing; old protected history is not promised |
| recovery setup | the recovery key can restore recoverable protected history on a new device; Shawtie does not store the readable key for the user |
| wrong RMS | the key did not verify; nothing was restored and the device remains pending |
| account recovery | account access was restored; protected history still requires crypto-device trust and, where needed, the recovery key |
| history unavailable | this specific older protected item cannot be opened on this device |
| integrity failure | the protected item could not be safely verified and will not be shown |
| rekeying | protected sharing is updating after a device/security change; existing verified content remains readable where available |
| repair | create a new protected-sharing generation for future content; this may not recover older unavailable content |
| revoke device | revocation removes that device's future account/protected access according to A1/S1; do not imply remote deletion of already seen plaintext |

Forbidden copy includes claims that approval restores history, account recovery restores encryption keys, all devices share one identity, calls use S1 E2EE, or a repair guarantees historical recovery.

## 19. Visual design

Reuse UX1 tokens and primitives.

Do not add a security-themed visual language.

Specifically:

- no shield-heavy dashboard
- no lock icon repeated beside every message
- no green "secure" score
- no security percentage
- no key-strength meter
- no dramatic warning red for pending approval or ordinary rekeying

Use:

- `Notice` for non-destructive security tasks
- `LifecycleBanner` style for persistent operational state
- `ErrorNotice` for actual fail-closed errors
- `ConfirmDialog` for device approval/revocation consequences and group repair
- `Card` or existing `us-block` for Protected sharing management

Tone:

- calm
- exact
- non-technical
- non-coercive

Healthy state uses normal ink, not success green everywhere.

## 20. Accessibility

Mandatory:

- all security actions keyboard accessible
- 48px Android touch targets
- no status communicated by color alone
- all notices use appropriate `role=status` or `role=alert`
- recovery secret Show/Hide control has explicit accessible name
- copied state is announced without rereading the secret
- 200 percent text scaling without clipped recovery controls
- reduced-motion behavior from UX1
- focus returns correctly after sheets/dialogs
- destructive repair confirmation initially focuses Cancel
- pending/rekey banners do not steal focus on realtime updates

The Recovery Master Secret must not be duplicated into hidden ARIA text.

### 20.1 Security-flow accessibility contract

In addition to global UX1 accessibility rules:

- recovery and repair dialogs place initial focus on the dialog heading, not the destructive action
- validation failures move screen-reader attention to a concise error summary while preserving the entered non-secret context
- after device approval or recovery succeeds, focus moves to the updated status heading
- rekey completion uses a polite live-region announcement only when the user is currently on an affected surface
- copy/reveal controls have explicit accessible names that distinguish "reveal recovery key" from "copy recovery key"
- the RMS reveal view remains usable at 200 percent text without horizontal scrolling of surrounding controls; the secret itself may wrap or use a dedicated scrollable code field
- destructive repair requires an explicit labeled confirmation control and cannot be triggered by Enter on initial dialog open
- reduced-motion mode removes celebratory/security transition motion but not progress/state feedback
- touch targets meet the existing UX1 Android target rules
- color is never the only distinction between unavailable history, integrity failure, pending trust, and healthy state

## 21. Sensitive-data handling

UX8 introduces no secret persistence.

Recovery Master Secret handling rules:

- setup output held only in component memory until acknowledgement
- recovery input held only in component memory during the attempt
- clear after success, failure, cancel, or component unmount
- never include in errors
- never include in analytics
- never include in DOM attributes
- never include in URL
- never include in navigation state
- never put into localStorage/sessionStorage
- never put into IndexedDB
- never put into M2 durable queues
- never put into Cache API
- never log
- clipboard write only after explicit user action

Browser password managers should not be encouraged to store the RMS field. Use a neutral field name and disable ordinary credential autofill where practical.

### 21.1 Recovery secret lifetime contract

The RMS is treated as ephemeral secret material throughout UX8.

Allowed lifetime:

1. returned from explicit S1 recovery-key generation or entered by the user
2. held only in the narrow in-memory flow that needs it
3. passed directly to the S1 runtime action
4. cleared from component/runtime references as soon as the flow completes, is cancelled, loses account/device scope, or unmounts

UX8 must not intentionally write the RMS to:

- localStorage
- sessionStorage
- IndexedDB
- Cache API
- M2 queues
- URL/query/hash state
- React persistence libraries
- analytics
- logs
- error-report payloads
- clipboard automatically
- downloaded files automatically

Clipboard copy is allowed only after an explicit user action. UX8 cannot guarantee clipboard erasure across operating systems, so copy must not claim automatic deletion. The UI should advise the user to store the key somewhere they control and clear the clipboard when practical.

Browser refresh or process loss during one-time reveal is not a reason to persist the RMS. If the existing S1 operation cannot safely re-reveal it, UX8 must fail closed and explain that the one-time reveal ended.

The closure scanner must inspect browser durable storage, Cache API, M2 outbox/queues, accessible logs, URL state, and production bundles for recovery-secret leakage.

### 21.2 Telemetry and diagnostics boundary

UX8 diagnostics may record only non-secret operational categories needed for reliability, such as:

- coarse state name
- safe S1/A1 error code
- success/failure class
- retry count
- anonymized local timing bucket where existing telemetry policy allows it

Diagnostics must never include:

- RMS or derived recovery secrets
- private device key material
- protected plaintext
- decrypted filenames or captions
- ciphertext bodies solely for debugging
- recovery bundle private material
- raw crypto-device identifiers unless an existing security logging policy explicitly authorizes a safe pseudonymous form

## 22. Client implementation architecture

No backend or migration work is expected.

Recommended new surface:

```text
apps/web/src/features/security/
  CryptoSecurityPanel.tsx
  CryptoRecoveryFlow.tsx
  CryptoDeviceList.tsx
  crypto-security-model.ts
  crypto-copy.ts
  security.css
```

Recommended safe runtime additions:

```ts
S1CryptoRuntime.localRecoveryStatus()
S1CryptoRuntime.refreshSecurityState()
```

These expose status only, never private recovery bytes.

Recommended shell seam:

- UsScreen renders `CryptoSecurityPanel`
- Home consumes a compact derived `securityTask`
- Talk and Ours consume derived operational state and per-content availability
- AuthScreen adds account-vs-crypto recovery copy only
- no new global router destination

A small provider may compose:

- A1 current device
- A1 device list
- S1 current runtime/status
- S1 crypto device list
- recovery bundle existence/version
- local recovery status
- current partnership crypto state

Do not duplicate S1 state machines inside multiple feature panels.

The provider/reducer is the sole owner of:

- precedence resolution
- protected-write blocking classification
- approval/recovery action eligibility
- repair eligibility
- stale async result rejection
- reconciliation revision changes

Presentation components receive already-derived values and action capabilities.

### 22.1 UX8 implementation dependency graph

```text
UX8-A canonical state adapter
        |
        +-------------------+
        |                   |
        v                   v
UX8-B Us panel        UX8-E content states
        |
        v
UX8-C recovery setup
        |
        v
UX8-D new-device/account-recovery seam
        |
        +---------+---------+
                  |
                  v
          UX8-F rekey/repair
                  |
                  v
          UX8-G cross-surface polish
                  |
                  v
          UX8-H1 model/browser closure
                  |
                  v
          UX8-H2 retained S1/regression
                  |
                  v
          UX8-H3 health/audit/scans
                  |
                  v
          UX8-H4 Redmi 25/25
                  |
                  v
          UX8-H5 evidence/docs
```

UX8-E may begin after UX8-A because per-content availability is orthogonal to recovery flow UI. UX8-F waits for A through E because it depends on the final composed state and action eligibility rules.

## 23. Implementation slices

### UX8-A: security-state adapter

- typed presentation model
- safe local recovery status helper
- error/copy mapping
- exhaustive reducer/unit tests

### UX8-B: Us Protected sharing panel

- current status
- merged A1/S1 device rows
- pending-device approvals
- A1 revoke consequence copy

### UX8-C: recovery setup

- recent-reauth seam
- explicit generation
- one-time RMS reveal
- zero-persistence assertions

### UX8-D: new-device and account-recovery seam

- pending-device state
- RMS recovery
- approval alternative
- account-vs-history recovery copy

### UX8-E: Talk and Ours protected-content states

- per-content unavailable placeholders
- integrity failure placeholders
- no whole-surface collapse
- R1 sealed-state preservation

### UX8-F: rekey and group repair

- rekey banners
- automatic retry state
- deterministic repair-required condition
- explicit group-reset confirmation

### UX8-G: cross-surface polish

- Home task card
- media unavailable state
- calls copy audit
- accessibility
- reduced motion
- 200 percent text

### UX8-H: closure

UX8-H is sequential and cannot be collapsed into one "tests passed" claim.

#### UX8-H1: model and browser closure

- exhaustive composed-state reducer tests
- focused browser flows for recovery, approval, unavailable history, integrity failure, rekey, and repair
- stale-response and lifecycle race tests

#### UX8-H2: retained security regression

- retain all S1 closure suites
- retain relevant A1 device/session, P3 lifecycle, M2 offline/realtime, M3 protected-media, and UX accessibility regressions
- prove no production S1 debug hook

#### UX8-H3: repository and privacy closure

- full repository health
- dependency audit
- production bundle/security scans
- RMS durable-storage/log/URL leakage scans

#### UX8-H4: physical Android closure

- mandatory Redmi Note 9S matrix 25/25
- exact final executable SHA recorded
- any defect found on-device gets a focused automated regression before final re-run

#### UX8-H5: evidence and documentation

- commit physical evidence at the exact final executable SHA
- reconcile ROADMAP, ROADMAP_EPICS, PROJECT_STATE, EXECUTION_GRAPH, README, UX direction, and testing docs
- only then may UX8 be reported DONE

## 24. Automated acceptance matrix

At minimum, UX8 automated tests must prove:

1. healthy trusted device renders no global warning
2. pending device renders actionable protected-access state
3. a pending device cannot approve itself
4. a trusted device can approve another pending device
5. approval copy does not promise historical recovery
6. recovery setup requires recent reauthentication
7. setup RMS appears only after explicit generation
8. RMS is absent from local/session storage, IndexedDB, Cache API, durable queues, logs, and URL state
9. wrong RMS keeps the device pending and exposes no history
10. correct RMS trusts the pending device and enables recoverable history
11. email/account recovery does not claim protected history recovery
12. rekey disables protected writes but keeps readable content available
13. rekey clears through existing S1 reconciliation
14. repair action is not shown for ordinary startup delay
15. repair action requires a trusted device and valid local recovery capability
16. group repair creates a new generation through the existing runtime action
17. one old unavailable message does not blank the conversation
18. one old unavailable R1 item does not blank Ours
19. integrity/signature failure never falls back to plaintext
20. R1 unreleased content remains sealed and is not mislabeled as crypto-unavailable
21. protected media missing history key renders a safe placeholder
22. A1 device revoke remains the sole user-facing revoke action
23. call UI contains no false S1 E2EE claim
24. production S1 debug hook remains absent
25. all UX8 security controls remain usable at 200 percent text and reduced motion

Retain all existing S1 automated closure suites.

### 24.1 Required transition and race matrix

Automated integration coverage must include at least:

| Race/transition | Required result |
| --- | --- |
| pending-device approval races with A1 revoke | revoke wins; stale approval success cannot restore UI authority |
| RMS recovery races with trusted-device approval | reconcile to one authoritative trusted state; never duplicate recovery setup or claim more history than actually available |
| logout/account switch during RMS entry or reveal | secret references are cleared and no result can apply to the next account |
| realtime revoke arrives during rekey | canonical revoke/session authority wins |
| partnership enters breakup_pending during rekey | P3 capabilities remain authoritative; UX8 does not invent a lifecycle block or restore permission |
| partnership finalizes during approval/recovery | partnership-scoped action result is discarded; local partnership crypto projection follows S1/P3 cleanup |
| app backgrounds during pending/rekey and resumes | foreground reconciliation restores the correct actionable state without requiring reload |
| stale device-list response arrives after a newer approval/revoke refresh | stale revision is discarded |
| group repair confirmation races with successful normal reconciliation | repair aborts before mutation |
| group repair races with lifecycle termination | termination wins and repair does not execute |
| integrity failure followed by successful refetch of different revision | only newly verified content renders; failed plaintext is never reused |
| network retry returns an earlier crypto projection | monotonic/current revision guard prevents UI rollback |

These tests validate UI authority and stale-result handling. They do not create new backend concurrency semantics.

## 25. Mandatory physical Android acceptance

UX8 is security-critical UX. Physical Redmi Note 9S acceptance is mandatory.

Minimum matrix:

1. healthy trusted-device status
2. fresh trusted account with recovery not configured
3. recent reauthentication -> create recovery key
4. one-time RMS reveal, copy, acknowledgement, dismissal
5. post-dismissal scan proves RMS absent from browser durable storage/cache/outbox/logs
6. fresh pending device shows protected-access task
7. wrong RMS fails closed and device stays pending
8. correct RMS trusts device and restores real older protected history
9. trusted second device sees pending device and can approve it
10. approved-without-RMS copy does not claim old history
11. device revoke through A1 removes protected future access
12. remaining device observes real rekey state and returns to ready
13. Talk composer blocked correctly while pending/rekeying
14. old unavailable message renders a per-message placeholder, not a blank conversation
15. released Ours item with unavailable history renders a per-item placeholder
16. sealed R1 item remains sealed for release reasons
17. protected media unavailable state does not fall back to plaintext
18. deterministic group repair flow creates next generation and future content works
19. email/account recovery -> sign-in -> pending crypto recovery separation
20. offline/reconnect does not queue recovery secrets or approval operations as M2 user-content operations
21. 200 percent text and Android touch targets across recovery/device flows
22. reduced-motion recovery/repair dialogs
23. background/foreground during pending or rekey state does not lose the required action
24. real realtime device revocation/rekey updates the visible UX without reload
25. final raw scan for RMS, private recovery material, and protected plaintext leakage

Expected final markers:

```text
UX8_ANDROID_ACCEPTANCE_PASS scenarios=25/25
UX8_RECOVERY_SECRET_STORAGE_PASS
UX8_PHYSICAL_REDMINOTE9S_ACCEPTANCE_PASS
```

## 26. File ownership during implementation

Primary UX8 ownership:

- `apps/web/src/features/security/**`
- crypto status presentation helpers under `apps/web/src/lib/crypto/**`
- `apps/web/src/features/ours/us/UsScreen.tsx`
- UX8-specific scoped CSS
- focused Talk/Ours presentation adapters for per-content availability
- AuthScreen recovery copy
- Home compact security task presentation
- browser tests for UX8

Shared-file changes require deliberate review:

- `apps/web/src/app/App.tsx`
- `MessagingPanel.tsx`
- Ours content source/decryption layers
- UX1 primitives
- `styles.css`

UX8 must not modify unless a verified defect requires it:

- S1 server crypto protocol
- database migrations
- worker lifecycle authority
- M2 replay semantics
- M3 object crypto
- C1/C2 transport
- P3 lifecycle semantics

If implementation discovers a need for one of those changes, stop and report the boundary before coding it.

## 27. Frozen UX decisions

The following are decided for UX8:

1. Us is the primary protected-sharing management surface.
2. Home shows security only when action is required.
3. Healthy Talk/Ours do not show repetitive lock badges.
4. Device approval and historical recovery are separate.
5. RMS recovery on a pending device is the only UX8 path that restores recovery capability from the Recovery Master Secret.
6. Trusted-device approval alone must not promise old history.
7. No recovery rotation UI is included.
8. No trusted-device historical recovery transfer UI is included because that transfer is not currently implemented.
9. A1 device revocation remains the sole revoke action.
10. Rekey is mostly automatic and shown as a temporary operational state.
11. Group reset is hidden until deterministic repair-required state exists.
12. Historical decryption failure is per-content.
13. Integrity failure is fail-closed and visually distinct from missing history.
14. R1 sealed state always remains distinct from crypto unavailability.
15. Calls receive no S1 E2EE badge or claim.
16. RMS is never persisted by UX8.
17. UX8 adds no backend route, schema, migration, or durable product state.
18. Physical Redmi acceptance is mandatory before UX8 is DONE.
19. One canonical composed `CryptoSecurityViewModel` owns top-level UX8 state interpretation.
20. Realtime frames never directly grant or remove UX authority without canonical reconciliation.
21. Async action results are revision-scoped and stale results are discarded.
22. Repair eligibility uses the deterministic predicate in section 13.1 and never a timeout heuristic.
23. Security-sensitive semantic copy is part of the frozen UX contract.
24. Recovery-secret lifetime and diagnostics boundaries in section 21 are mandatory implementation constraints.
25. P3 lifecycle authority always outranks stale UX8 action completion.

## 28. Definition of done

UX8 is DONE only when:

- all UX8-A through UX8-H slices are implemented
- no product/security authority was silently changed
- device approval and recovery flows operate against the existing S1 runtime
- account recovery and cryptographic-history recovery remain clearly separated
- recovery setup is usable and does not persist the RMS
- per-content unavailable-history states work in Talk, Ours, and media
- integrity failures fail closed without plaintext fallback
- rekey and deterministic repair flows are understandable and safe
- R1 sealed content authority is unchanged
- A1 revocation authority is unchanged
- calls make no false S1 claim
- retained S1 tests are green
- full repository health is green
- dependency audit is green
- production crypto/debug scans remain green
- mandatory Redmi Note 9S UX8 acceptance passes 25/25
- composed-state precedence and stale-result guards are exhaustively tested
- required transition/race matrix is green
- deterministic repair eligibility is proven and timeout-only repair is impossible
- security-sensitive copy matches the frozen semantic contract
- RMS lifetime/storage/diagnostics invariants pass executable scans
- evidence is committed at the exact final executable SHA
- repository documentation is reconciled

Automated implementation scope closed at `39de742c8ab795137be95ecbaa685131b608e813` and re-closed after a physical-run fix at final corrective executable `43ff9b1ec319703f3d9270ae8053ab196ca54419`. The physical gate and final evidence reconciliation are complete; UX8 is DONE, and this design remains frozen.
