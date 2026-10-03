# Historical Branch Authority

## Purpose

This file prevents completed or abandoned design branches from being mistaken for current architecture.

## Current rule

`main` and the current milestone branch are authoritative for implemented architecture. Historical branches may preserve design history, but they are not merge inputs unless a new architecture review explicitly adopts their content.

## design/m3-media-voice

Status: HISTORICAL ONLY

This branch predates the accepted S1 E2EE architecture. It contains a stranded ADR-012 describing a server-recoverable media-key bridge that was not adopted by current `main`.

Rules:

- do not merge `design/m3-media-voice` into current `main`
- do not treat ADR-012 on that branch as current cryptographic authority
- current M3 media behavior is governed by the code and architecture already integrated with S1
- deletion of the branch is optional repository hygiene, not required to preserve correctness once this historical-only status is recorded

The R2 governance helper can delete the obsolete branch when explicitly invoked with:

```text
R2_DELETE_OBSOLETE_M3_BRANCH=1
```

No destructive branch deletion should be performed merely because R2 source implementation exists.

## Other milestone branches

Completed milestone branches are evidence/history. Their closure SHAs remain useful, but later merged `main` is the product source of truth.
