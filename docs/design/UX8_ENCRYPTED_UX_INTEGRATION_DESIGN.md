# UX8 Encrypted UX Integration Design

Status: DESIGN FROZEN, IMPLEMENTATION NOT STARTED.

Branch: `design/ux8-encrypted-ux-integration`.

Baseline: `main @ b1acbd692fbe02b9a04f270a960e1d61afa6964e`.

S1 authority: DONE and merged. Final corrective executable `cde73a1a789b0768aa67f95e8f542fe98a8dfc8b`; final evidence merge anchor `71569cf68f785315c9d0f0d052639b46aad9caf9`; Android acceptance 30/30.

UX8 integrates the verified S1 cryptographic states into the accepted Home, Talk, Ours, and Us experience. It does not redesign the cryptographic protocol, create new security authority, add persistence, or change product lifecycle semantics.

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

- focused browser tests
- retained S1 regression suites
- full repository health
- mandatory physical Android acceptance
- repo-wide documentation reconciliation

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
- evidence is committed at the exact final executable SHA
- repository documentation is reconciled

Until then, UX8 remains implementation-incomplete even though this design is frozen.
