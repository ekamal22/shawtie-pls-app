# Shawtie OpenMLS WASM binding

This crate is the thin browser binding used by S1. It does not implement MLS. It delegates MLS, Ed25519, and RFC 9180 HPKE operations to pinned OpenMLS 0.9.0 and openmls_rust_crypto 0.6.0.

The supported MLS ciphersuite is:

`MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519`

Build with Rust 1.91.0 or newer and wasm-pack:

```text
wasm-pack build packages/crypto/openmls-wasm --target web --release --out-dir ../wasm-generated
```

Generated artifacts are build outputs. Source review, Cargo.lock review, cargo audit, and OpenMLS advisory review are mandatory before a production S1 closure build.

The binding returns candidate state snapshots for outbound MLS operations. The browser must persist a candidate snapshot together with the frozen outbound request before network transmission, and must not invent protocol state transitions outside OpenMLS.
