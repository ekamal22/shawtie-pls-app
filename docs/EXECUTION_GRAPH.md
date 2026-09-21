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
             P2 Partnership Formation 🟡
                        |
                        v
             P3 Lifecycle + Deletion 🟡
                        |
                +-------+--------+
                |                |
                v                v
          M1 Messaging ⚪    R1 Relationship Space ⚪
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

    A1 --> P2["P2 Partnership Formation 🟡"]
    P1 --> P2

    P2 --> P3["P3 Lifecycle + Deletion 🟡"]

    P3 --> M1["M1 Messaging Core ⚪"]
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
P2 🟡 ACTIVE
~~~

P3 already has a verified pure-domain layer, but its persistence, API, worker, race, notification, and deletion closure remain incomplete. It therefore remains IN_PROGRESS rather than DONE.

## Current active milestone

### P2 Partnership Formation and Relationship Date

Active branch:

~~~text
feat/p2-partnership-formation
~~~

Source implementation state:

1. P2-A domain and contracts are committed
2. P2-B migration 0009 plus formation and notification repositories are committed
3. P2-C explicit accept plus the shared formation coordinator are committed
4. P2-D reciprocal integration into P1 `paired` mode is committed
5. P2-E current partnership read model, relationship-date metadata mutation, durable notifications, and client flow are committed
6. P2-F local PostgreSQL/API/race/security and full-P1 paired regression harnesses are committed

Remaining closure work is to execute the P2 local suite, full health, and dependency audit, then record verified acceptance evidence.

P2 must not rewrite verified P1 migration `0008_partner_discovery_requests_runtime.sql`.

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
main
  |
  +--> feat/p2-partnership-formation
          |
          +--> implement
          +--> verify every P2 acceptance gate
          +--> reconcile documentation
          +--> merge to main
                    |
                    +--> create the next dependent milestone branch
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

The future messaging branch will be:

~~~text
feat/m1-messaging-core
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

The shortest dependency path from the current active milestone to stable release is:

~~~text
P2
 -> P3
 -> M1
 -> M2
 -> M3/C1
 -> S1
 -> R2
 -> Stable Release
~~~

R1 can progress alongside M1 once P2 and the required P3 capability boundaries are stable.

V1 remains a separate verification track and must be complete before R2 closes.
