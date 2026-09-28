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
        C2 Video Calling ✅
                |
                v
     UX0 through UX7 Romantic UX ✅
     physical Redmi acceptance 22/22
     final executable: ca7cd35
     merged to main @ 9f0bea4
                |
                v
        S1 E2EE + Crypto Recovery ✅
        non-physical privacy/review PASS @ e254c3c
        final closure PASS @ cde73a1, Android 30/30, merged main @ 71569cf
                |
                v
        UX8 Encrypted UX 🟢 DONE, Android 25/25, merged main @ a029169
                |
                v
        SEC1 Pre-V1 Security Hardening ✅ DONE + MERGED @ a2badf7 (executable 91ca920d)
                |
                v
        Pre-V1 follow-up hardening 🔧
        local S1 purge + HTTP boundary fixes
             |
             v
        V1 Hosted CI Verification 🔒 awaiting fixes, coverage expansion, and Actions capacity
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

V1 Hosted CI Verification 🔒 remains a separate verification milestone. SEC1 is DONE, but the 2026-09-29 follow-up audit added two mandatory source repairs before V1: account-wide S1 local-crypto lifecycle deletion and S1 HTTP request-size/framework-client-error handling. After those fixes and hosted security-coverage expansion, V1 can run when Actions capacity is available and must finish before R2 can close.
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
    C1 --> C2["C2 Video Calling ✅ merged"]

    C2 --> UX0["UX0 Romantic Experience Spec ✅"]
    UX0 --> UX1["UX1 Design Foundation ✅"]
    UX1 --> UX2["UX2 Home ✅"]
    UX1 --> UX3["UX3 Talk ✅"]
    UX1 --> UX4["UX4 Ours ✅"]
    UX1 --> UX5["UX5 Calls UX ✅"]
    UX1 --> UX6["UX6 Memories + Letters ✅"]
    UX2 --> UX7["UX7 Signature Moments ✅"]
    UX3 --> UX7
    UX4 --> UX7
    UX5 --> UX7
    UX6 --> UX7

    M3 --> S1["S1 E2EE + Crypto Recovery ✅"]
    C2 --> S1
    UX7 --> UX8["UX8 Encrypted UX Integration ✅ DONE @ 43ff9b1, Android 25/25"]
    S1 --> UX8

    UX8 --> SEC1["SEC1 Pre-V1 Security Hardening 🟡"]
    SEC1 --> V1["V1 Hosted CI Verification 🔒"]
    V1 --> R2["R2 Public Readiness ⚪"]

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
C1 ✅ DONE and merged to `main @ d44c595`; final executable `b29aaa1`; full physical acceptance complete
   ->
C2 Video Calling ✅ DONE and fast-forward merged to `main @ fed2db7`; final executable SHA `ecbb2e1` with automated closure and mandatory Redmi acceptance complete
   ->
UX0 through UX7 ✅ DONE, Redmi 22/22, merged to `main @ 9f0bea4`
   ->
S1 E2EE + Crypto Recovery ✅ DONE, final executable `cde73a1`, Redmi 30/30, merged to `main @ 71569cf`
   ->
UX8 Encrypted UX Integration ✅ DONE, final executable `43ff9b1`, Redmi 25/25, merged to `main @ a029169`

SEC1 Pre-V1 Security Hardening ✅ DONE + MERGED, merge anchor `a2badf7`, final executable `91ca920d`

V1 Hosted CI Verification 🔒 NEXT, blocked by follow-up source repairs, hosted security-coverage expansion, and Actions capacity
~~~

P3 is locally closed at 22/22 gates and its verified code baseline `9820801` is merged into `main`. Its lifecycle domain/contracts suite passes 28/28, security passes 6/6, all ten migrations apply from zero with database invariants green, and the disposable PostgreSQL/API/worker integration matrix passes 39/39 with `P3_LOCAL_POSTGRES_PASS`. Full repository health and the high-severity dependency audit pass.

M1 is DONE at 18/18 gates, with runtime closure anchored at `aa40a2c` and source head `b29b095`. R1 source head `9bc9ba4` is also DONE. Both are source-integrated at `01fa182` and exhaustively validated together on `integration/m1-r1 @ 5db7a94`; canonical migrations, full health, audit, and git hygiene are green.

## Most recently fully completed milestone

### UX8 Encrypted UX Integration

Verified historical branch: `feat/ux8-encrypted-ux-integration`.

UX8 is DONE and fast-forward merged to `main @ a029169`. The final corrective executable is `43ff9b1ec319703f3d9270ae8053ab196ca54419`: automated closure re-passed after the physical-run defect fix, mandatory Redmi Note 9S acceptance closed 25/25, recovery-secret storage inspection passed, and the focused Scenario 18 follow-up physically proved a real recovery-backed group repair from generation 1 to 2 with new protected content working afterward. Canonical evidence is in `docs/testing/UX8_AUTOMATED_CLOSURE_EVIDENCE.md` and `docs/testing/UX8_ANDROID_ACCEPTANCE_EVIDENCE.md`. S1 remains DONE and merged to `main @ 71569cf`.

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
main (UX8 merged @ a029169)
  |
  +--> feat/m3-media-voice             historical DONE; merged to main @ 1d3535f
  +--> feat/c1-voice-calling          historical DONE; merged to main @ d44c595
  +--> feat/c2-video-calling          historical DONE; merged to main @ fed2db7
  +--> integration/ux-romantic        historical DONE; merged to main @ 9f0bea4
  +--> feat/s1-e2ee-crypto-recovery   DONE; final executable cde73a1; merged to main @ 71569cf
  +--> feat/ux8-encrypted-ux-integration DONE; final executable 43ff9b1; Redmi 25/25; merged to main @ a029169

M3 owns real migrations 0015/0016.
C1 owns 0017/0018 on its branch and used only documented 0015/0016 reservations for isolated closure.
C1 is reconciled onto main containing real M3 0015/0016. Real migrations 0001-0018 passed with `reserved=0`; after the stale media-owner fix, integrated closure re-passed at `b29aaa1`. Redmi physical acceptance and all follow-up evidence, including audible bidirectional audio, are complete.
C2 Video Calling is DONE and fast-forward merged to `main @ fed2db7`; source implementation and automated/local closure are complete (first at `94e0e93`, final executable SHA `ecbb2e1`) and physical Redmi Note 9S acceptance is complete. Evidence: `docs/testing/C2_ANDROID_ACCEPTANCE_EVIDENCE.md`.

S1 is DONE and merged to `main @ 71569cf`. The final corrective executable `cde73a1` passed full automated closure and 30/30 physical Android acceptance.
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
| UX8 Encrypted UX Integration | Yes, mandatory 25/25 after automated closure |
| SEC1 Pre-V1 Security Hardening | No by default; focused device regression only if a remediation is device-specific |
| V1 Hosted CI Verification | No |
| R2 Public Readiness | Yes, final acceptance |

## Release path

With UX8 and SEC1 merged, and SEC1 locally closed, the remaining dependency path to stable release is:

~~~text
UX8 ✅
 -> SEC1 Pre-V1 Security Hardening ✅
 -> V1 Hosted CI Verification
 -> R2 Public Readiness
 -> Stable Release
~~~

SEC1 is DONE and merged to `main @ a2badf7`; final executable `91ca920d`. The active next engineering work is the two documented pre-V1 follow-up source repairs. V1 Hosted CI Verification follows those fixes and hosted security-coverage expansion when Actions capacity becomes available.
