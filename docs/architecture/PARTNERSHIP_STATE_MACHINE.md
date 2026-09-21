# Partnership State Machine

## Purpose

Partnership lifecycle behavior is a domain state machine. It must not be recreated independently in UI code, API handlers, and worker jobs.

The authoritative rules belong in `packages/domain`.

The centralized capability engine derives allowed operations from account state, partnership state, breakup state, deletion state, cooldown state, device authorization, and trusted server time.

## State dimensions

Do not encode every possible combination into one giant enum.

Use separate state dimensions:

### Account state

```text
active
deletion_pending
deleted
```

### Partnership lifecycle

```text
active
breakup_pending
terminated
```

### Effective interaction mode

Derived from account and partnership state:

```text
normal
breakup_restricted
account_deletion_view_only
none
```

This avoids combinatorial state explosion.

## Capability evaluation

Every lifecycle-sensitive mutation follows this pattern:

1. authenticate
2. load authoritative state
3. lock required rows
4. evaluate capability in `packages/domain`
5. reject with a stable denial code or continue
6. mutate transactionally
7. append lifecycle event where applicable
8. write outbox and scheduled actions in the same transaction

Client-side capability state is never authoritative.

## Partnership creation

Requirements:

- both accounts are eligible
- neither account occupies another partnership slot
- neither account has blocked the other
- both accounts consent
- all checks occur inside one transaction

Mutual pending requests count as consent from both sides and create the partnership automatically.

After creation:

- incompatible pending requests are invalidated
- one current membership row exists per member
- a fresh immutable partnership ID creates the new server/local namespace; S1 later binds reviewed cryptographic state to that namespace
- the relationship start date is manually entered through the request consent flow and may differ from activation date

## Active partnership

Normal capabilities include:

- text and media messaging
- message reactions
- shared nicknames
- relationship-space creation and edits
- voice and video calls
- relationship start-date edits with partner notification

Username changes remain blocked while partnered.

## Breakup initiation

Either partner may initiate breakup.

Transactionally:

1. validate current state
2. record initiator and server timestamp
3. set lifecycle to `breakup_pending`
4. set one-hour initiator cancellation deadline
5. set seven-day base deadline
6. create scheduled actions
7. increment or establish the breakup process generation
8. append lifecycle event
9. create outbox events

The interface must identify the initiator.

## One-hour initiator cancellation

Only the breakup initiator may cancel unilaterally during the first hour.

If cancelled:

- lifecycle returns to active
- scheduled breakup finalization is invalidated
- no cooldown begins
- data remains intact
- partner is notified

After the hour expires, unilateral cancellation is rejected.

## Breakup restrictions

During `breakup_pending`:

Allowed:

- new messages
- replies
- new supported media
- voice and video call requests
- calls after explicit acceptance
- shared nickname changes
- scheduled For You releases
- scheduled Future Us releases
- email changes for accessible accounts
- relationship start-date changes with partner notification

Restricted:

- edits to messages that existed before breakup
- deletes of messages that existed before breakup
- reactions to messages that existed before breakup
- relationship-object creation and editing, except scheduled releases that were already configured; this does not prohibit the separate partnership metadata field `relationship_start_date`
- blocking
- new partnership formation

Existing relationship objects remain view-only.

## Restoration

Restoration intent opens only after the unilateral cancellation window closes.

Exact trusted-server boundaries:

- while `now < initiator_cancel_until`, only the breakup initiator may use unilateral cancellation and restore intent is not yet available
- at `now = initiator_cancel_until`, unilateral cancellation is expired and restore intent becomes available
- restore intent remains available only while `now < final_deadline`
- at `now = final_deadline`, restoration is expired and the finalizer may proceed

Each partner may submit restoration intent once during that restoration window.

Properties:

- intent is irreversible for the current breakup process
- first intent extends the final deadline from day 7 to day 10
- extension happens once
- first intent alone does not restore
- second intent before the applicable deadline restores the same partnership
- the first extension advances breakup-process generation so the old day-seven finalizer is stale

Restoration returns the lifecycle to active and preserves all partnership data.

## Final dissolution

Final dissolution occurs:

- at day 7 if neither partner submitted restoration intent
- at day 10 if exactly one partner submitted restoration intent

Finalization is a durable worker action and must be idempotent.

The scheduled finalization carries the expected breakup-process generation. If the current breakup generation differs when the worker runs, or the process is already cancelled, restored, dissolved, or superseded, the job is stale and must not dissolve the partnership.

P3 uses one canonical dissolution kernel for both normal breakup finalization and permanent partner-account deletion. Lifecycle-only transitions increment partnership `generation` and do not increment partnership metadata `version`.

Effects:

- partnership becomes terminated
- membership slots are released
- messaging authorization ends
- realtime authorization ends
- push routing for the partnership ends
- partnership data is deleted
- partnership media is purged
- local partnership namespaces must be invalidated
- partnership cryptographic state is destroyed according to the E2EE design
- both former partners receive a three-calendar-month cooldown
- blocking becomes available

## Account deletion from active partnership

When one active partner requests account deletion:

- deleting account access is immediately revoked
- all sessions are revoked
- partnership enters account-deletion view-only mode
- remaining partner may view existing shared data
- neither partner can create new shared data
- remaining partner cannot form another partnership
- seven-day recovery timer begins

If deletion is cancelled before the deadline:

- account access returns
- previous partnership state returns exactly
- no cooldown begins solely because deletion was requested

If deletion becomes permanent:

- account is deleted
- partnership data is deleted
- remaining partner is notified
- remaining partner receives a one-calendar-month cooldown
- deleted email becomes available for new registration

## Account deletion during breakup_pending

The existing breakup deadline is never reset or extended by account deletion.

If account deletion is later cancelled before the breakup deadline:

- account access returns
- original breakup continues
- original deadline remains unchanged
- existing restoration intent remains valid

If breakup finalization happens before the account-deletion recovery deadline:

- breakup dissolution happens at the breakup deadline
- shared partnership data is deleted then
- three-calendar-month breakup cooldown applies
- account-deletion recovery continues independently
- later account recovery does not recreate the dissolved partnership or deleted data

The earliest valid destructive partnership deadline wins.

## Blocking

Blocking is unavailable while active or `breakup_pending`.

After final dissolution, either former partner may block the other.

An active block prevents future discovery, requests, and partnership formation until removed.

## Lifecycle ledger

Every sensitive transition appends a lifecycle event after the transition is validated and inside the same database transaction.

The ledger supports audit, debugging, race analysis, and deletion verification without storing private content.

## Database protection

The database must enforce one occupied partnership slot per account.

Application checks alone are insufficient.

## Race handling

Transactions that involve two accounts use a shared helper and acquire locks in deterministic account-ID order.

This protects against cases such as:

- one account accepting two requests concurrently
- reciprocal requests arriving at the same time
- breakup and restoration racing
- scheduled finalization racing with a last-moment valid restore

The transaction must re-check authoritative state after locks are acquired.
