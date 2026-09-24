# Execution Graph

## Purpose

This document is the compact dependency and branch-flow view of the Shawtie pls roadmap.

Use:

- `ROADMAP.md` for the canonical milestone execution sequence
- `ROADMAP_EPICS.md` for acceptance gates
- `PROJECT_STATE.md` for verified current implementation state
- this document for a quick visual answer to "what depends on what, and what comes next?"

## Status legend

| Symbol | Meaning |
| --- | --- |
| ✅ | DONE with verified evidence |
| 🟡 | IN_PROGRESS |
| ⚪ | PLANNED |
| 🔒 | BLOCKED |
| ⏸ | DEFERRED |

## Current execution graph

~~~text
F0 Governance + Security ✅
          |
          v
F1 Repository Foundation ✅
          |
          v
F2 Persistence + Worker ✅
          |
          +---------------------------+
          |                           |
          v                           v
A1 Accounts + Devices ✅      P1 Discovery + Requests ✅
          |                           |
          +-------------+-------------+
                        |
                        v
             P2 Partnership Formation ✅
                        |
                        v
             P3 Lifecycle + Deletion ✅
                        |
                +-------+--------+
                |                |
                v                v
          M1 Messaging ✅    R1 Relationship Space ✅
                |
                v
          M2 Realtime + Offline ✅
                |
            +---+---+
            |       |
            v       v
       M3 Media ✅  C1 Voice ✅
M3 status: DONE and fast-forward merged to `main @ 1d3535f`: automated closure green and physical Android acceptance 20/20 at final code SHA `ee59850`. Canonical design: `docs/architecture/M3_MEDIA_VOICE_DESIGN.md`.
            |       |
            +---+---+
                |
                v
        S1 E2EE + Crypto Recovery ⚪
                |
                v
        R2 Public Readiness ⚪
                |
                v
          STABLE RELEASE 🔒
                |
                v
        X1 Post-stable Maturity ⚪
                |
                v
        X2 Deferred Heavy Features ⏸

V1 Hosted CI Verification 🔒 runs as a separate track
and must be DONE before R2 can close.
~~~

## Mermaid dependency view

~~~mermaid
flowchart TD
    F0["F0 Governance + Security ✅"] --> F1["F1 Repository Foundation ✅"]
    F1 --> F2["F2 Persistence + Worker ✅"]

    F2 --> A1["A1 Accounts + Devices ✅"]
    F2 --> P1["P1 Discovery + Requests ✅"]

    A1 --> P2["P2 Partnership Formation ✅"]
    P1 --> P2

    P2 --> P3["P3 Lifecycle + Deletion ✅"]

    P3 --> M1["M1 Messaging Core ✅"]
    P3 --> R1["R1 Relationship Space ✅"]

    M1 --> M2["M2 Realtime + Offline ✅"]

    M2 --> M3["M3 Media + Voice Messages ✅"]
    M2 --> C1["C1 Voice Calling ✅"]
    C1 --> C2["C2 Video Calling ⚪"]

    M3 --> S1["S1 E2EE + Crypto Recovery ⚪"]
    C2 --> S1

    S1 --> R2["R2 Public Readiness ⚪"]
    V1["V1 Hosted CI Verification 🔒"] -. required before close .-> R2

    R2 --> RELEASE["Stable Release 🔒"]
    RELEASE --> X1["X1 Post-stable Maturity ⚪"]
    X1 --> X2["X2 Deferred Heavy Features ⏸"]
~~~

## Current position

The verified implementation frontier is:

~~~text
Foundation ✅
   ->
A1 ✅
   ->
P1 ✅
   ->
P2 ✅
   ->
P3 ✅
   ->
M1 ✅ + R1 ✅ merged to main
   ->
M2 ✅ DONE, merged to `main @ b6183158`; automated/local closure PASS, physical Android acceptance 14/14 at `b83102f`
   ->
M3 ✅ DONE, merged to `main @ 1d3535f`; Android 20/20 at `ee59850`
   +
C1 ✅ DONE and merged to `main @ d44c595`; final executable `b29aaa1`; integrated closure re-passed with `reserved=0`; Redmi 25/25 plus rejected-notification, stale-owner and audible bidirectional-audio follow-ups complete
~~~

P3 is locally closed at 22/22 gates and its verified code baseline `9820801` is merged into `main`. Its lifecycle domain/contracts suite passes 28/28, security passes 6/6, all ten migrations apply from zero with database invariants green, and the disposable PostgreSQL/API/worker integration matrix passes 39/39 with `P3_LOCAL_POSTGRES_PASS`. Full repository health and the high-severity dependency audit pass.

M1 is DONE at 18/18 gates, with runtime closure anchored at `aa40a2c` and source head `b29b095`. R1 source head `9bc9ba4` is also DONE. Both are source-integrated at `01fa182` and exhaustively validated together on `integration/m1-r1 @ 5db7a94`; canonical migrations, full health, audit, and git hygiene are green.

## Most recently completed milestone

### M3 Media and Voice Messages

Verified branch: `feat/m3-media-voice`.

Automated closure is green; all 20 mandatory physical Android scenarios passed at final code SHA `ee59850`. M3 is complete and fast-forward merged to `main @ 1d3535f`.

M3 real migrations 0015/0016 and C1 migrations 0017/0018 are on `main`. C1 final integrated `reserved=0` closure and mandatory Redmi Note 9S acceptance are complete. C1 is merged at `d44c595`; C2 is the next planned call milestone.

## Earlier completed milestone detail

### M1 Messaging Core

Verified closure branch:

~~~text
feat/m1-messaging-core
~~~

Verified closure commit:

~~~text
aa40a2cc74e8efb08bcefdbe3ae40e306cabe288
~~~

Verified implementation state:

1. M1-A through M1-H are implemented and locally verified
2. migrations 0001 through 0012 apply from zero
3. database invariants pass
4. M1 security passes 17/17
5. the disposable PostgreSQL/API/worker matrix passes 64/64 with `M1_LOCAL_POSTGRES_PASS`
6. P1, P2, P3, and A1 regression surfaces remain green
7. full repository health passes with Domain 51/51, Contracts 22/22, API unit/security 31/31, and Worker 4/4
8. `npm audit --audit-level=high` reports 0 vulnerabilities and `git diff --check` passes

M1 is closed at 18/18 gates and the combined M1/R1 integration is exhaustively green at `5db7a94`. The documentation-closed integration is merged to `main @ d7d95a6`, so M2 may now branch from the verified mainline.

M1 preserves verified migrations 0001 through 0010 and owns only migrations 0011 and 0012.

## Milestone branch flow

Completed milestone history is preserved with durable branch refs:

~~~text
milestone/f0-governance-security
milestone/f1-repository-foundation
milestone/f2-persistence-worker
milestone/a1-accounts-devices
milestone/p1-discovery-requests
~~~

Current flow:

~~~text
main @ 54b8659
  |
  +--> feat/m3-media-voice      DONE, Android 20/20, merged to main @ 1d3535f
  |
  +--> feat/c1-voice-calling   historical completed branch; merged to main @ d44c595

M3 owns real migrations 0015/0016.
C1 owns 0017/0018 on its branch and used only documented 0015/0016 reservations for isolated closure.
C1 is reconciled onto main containing real M3 0015/0016. Real migrations 0001-0018 passed with `reserved=0`; after the stale media-owner fix, integrated closure re-passed at `b29aaa1`. Redmi physical acceptance and all follow-up evidence, including audible bidirectional audio, are complete.
C2 Video Calling design is complete on `feat/c2-video-calling`; C1 is merged, so C2 source implementation is now unblocked.
~~~

From P2 onward:

1. create the milestone branch from the latest verified `main`
2. implement only that milestone and explicitly coordinated dependencies
3. close every required acceptance gate with evidence
4. reconcile repository documentation
5. merge the milestone branch to `main`
6. preserve the completed milestone branch
7. create the next dependent milestone branch from the newly updated `main`

The legacy `feat/m1-executable-foundation` branch is historical and is not the M1 Messaging Core branch.

The completed M3 milestone branch remains preserved as history:

~~~text
feat/m3-media-voice
~~~

The completed C1 implementation branch `feat/c1-voice-calling` is historical after fast-forward merge to `main @ d44c595`. Final executable baseline: `b29aaa1`; all physical evidence complete.

The completed parallel milestone branches remain historical:

~~~text
feat/m1-messaging-core
feat/r1-relationship-space
~~~

## Physical-device boundary

No physical Redmi acceptance is required to close P2 or P3.

Physical Android validation begins at M2 and becomes mandatory for the device-sensitive milestones:

| Milestone | Physical Android requirement |
| --- | --- |
| P2 Partnership Formation | No |
| P3 Lifecycle + Deletion | No |
| M1 Messaging Core | No for core closure |
| R1 Relationship Space | No for core closure |
| M2 Realtime + Offline | Yes |
| M3 Media + Voice Messages | Yes |
| C1 Voice Calling | Yes, mandatory |
| C2 Video Calling | Yes, mandatory |
| S1 E2EE + Crypto Recovery | Yes, mandatory |
| R2 Public Readiness | Yes, final acceptance |

## Release path

The shortest dependency path from the current verified mainline to stable release proceeds from the now-DONE M2 milestone merged at `main @ b6183158`:

~~~text
M1
 -> M2
 -> M3 + C1 Voice -> C2
 -> S1
 -> R2
 -> Stable Release
~~~

R1 progresses alongside M1 after the verified P3 merge and must be complete before R2.

R1 can progress alongside M1 once P2 and the required P3 capability boundaries are stable.

V1 remains a separate verification track and must be complete before R2 closes.
