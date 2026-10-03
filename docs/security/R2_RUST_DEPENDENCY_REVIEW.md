# R2 Rust Dependency Maintenance Review

## Reviewed warning

V1 hosted verification reported one RustSec maintenance warning, not a vulnerability failure:

- advisory: `RUSTSEC-2026-0173`
- crate: `proc-macro-error2 2.0.1`
- status reported by cargo-audit: unmaintained

## Dependency path

The current lockfile shows:

```text
OpenMLS / libcrux dependency chain
  -> hax-lib 0.3.7
  -> hax-lib-macros 0.3.7
  -> proc-macro-error2 2.0.1
```

The application does not directly depend on `proc-macro-error2`.

## R2 disposition

R2 does not replace or patch this transitive cryptographic dependency blindly.

The accepted disposition is:

1. continue to run pinned `cargo audit` on the exact committed OpenMLS WASM lockfile
2. treat any RustSec vulnerability as a release blocker
3. retain this maintenance-only warning while the reviewed OpenMLS/libcrux stack remains otherwise green
4. require a fresh E2EE review before changing the OpenMLS/libcrux dependency family solely to remove this warning
5. revisit the warning when the upstream dependency chain offers a reviewed replacement path

This is a conscious maintenance-risk acceptance, not a claim that an unmaintained crate is desirable. The security risk of an unreviewed cryptographic-stack upgrade is also material.

## Closure condition

The R2 dependency gate is satisfied when the final candidate's hosted `cargo audit` reports no vulnerability failure and this dependency path has not materially changed without review.
