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
          M1 Messaging ✅    R1 Relationship Space ⚪
                |
                v
          M2 Realtime + Offline ⚪
                |
            +---+---+
            |       |
            v       v
       M3 Media ⚪  C1 Calling ⚪
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
    P3 --> R1["R1 Relationship Space ⚪"]

    M1 --> M2["M2 Realtime + Offline ⚪"]

    M2 --> M3["M3 Media + Voice Messages ⚪"]
    M2 --> C1["C1 Voice + Video Calling ⚪"]

    M3 --> S1["S1 E2EE + Crypto Recovery ⚪"]
    C1 --> S1

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
M1 ✅ (local closure, merge pending)
~~~

P3 is locally closed at 22/22 gates and its verified code baseline `9820801` is merged into `main`. Its lifecycle domain/contracts suite passes 28/28, security passes 6/6, all ten migrations apply from zero with database invariants green, and the disposable PostgreSQL/API/worker integration matrix passes 39/39 with `P3_LOCAL_POSTGRES_PASS`. Full repository health and the high-severity dependency audit pass.

M1 is locally closed at 18/18 gates on `feat/m1-messaging-core` at `aa40a2cc74e8efb08bcefdbe3ae40e306cabe288`. Migrations 0001 through 0012 apply from zero with database invariants green, the disposable PostgreSQL/API/worker matrix passes 64/64 with `M1_LOCAL_POSTGRES_PASS`, M1 security passes 17/17, full repository health passes, and the high-severity dependency audit reports 0 vulnerabilities. Merge to `main` is pending and out of scope for branch closure.

## Most recently completed milestone

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

M1 is locally closed at 18/18 gates. Merge to `main` remains pending, so M2 must not branch from the shared mainline until verified M1 is reintegrated.

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
latest main containing verified P3
  |
  +--> feat/m1-messaging-core
  |
  +--> feat/r1-relationship-space

M1 and R1 may progress in parallel.
M1 is DONE locally on `feat/m1-messaging-core`; merge to `main` is pending.
M1 owns migrations 0011 and 0012.
R1 reserves migrations 0013 and 0014.
M2 waits for verified M1 to return to main.
~~~

From P2 onward:

1. create the milestone branch from the latest verified `main`
2. implement only that milestone and explicitly coordinated dependencies
3. close every required acceptance gate with evidence
4. reconcile repository documentation
5. merge the milestone branch to `main`
6. preserve the completed milestone branch
7. create the next dependent milestone branch from the newly updated `main`

The legacy `feat/m1-executable-foundation` branch is historical and is not the future M1 Messaging Core branch.

The next milestone branches are:

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
| C1 Voice + Video Calling | Yes, mandatory |
| S1 E2EE + Crypto Recovery | Yes, mandatory |
| R2 Public Readiness | Yes, final acceptance |

## Release path

The shortest dependency path from the current verified mainline to stable release is:

~~~text
M1
 -> M2
 -> M3/C1
 -> S1
 -> R2
 -> Stable Release
~~~

R1 progresses alongside M1 after the verified P3 merge and must be complete before R2.

R1 can progress alongside M1 once P2 and the required P3 capability boundaries are stable.

V1 remains a separate verification track and must be complete before R2 closes.
