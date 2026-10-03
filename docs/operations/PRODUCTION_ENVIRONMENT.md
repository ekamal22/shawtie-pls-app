# Production Environment Contract

R2 owns three deployment roles: API, worker, and web adapter.

Use `infra/deployment/production.env.example` as a names-only reference. Never copy real values into the repository.

Before deploying a service role, validate its environment:

```text
R2_SERVICE_ROLE=api node scripts/release/verify-production-contract.mjs
R2_SERVICE_ROLE=worker node scripts/release/verify-production-contract.mjs
R2_SERVICE_ROLE=web node scripts/release/verify-production-contract.mjs
```

## API

Stable Release requires:

- production HTTPS `APP_ORIGIN`
- private PostgreSQL
- authentication HMAC key ring
- paired partner-request mode
- media upload, binding, and download grants enabled
- complete private S3-compatible storage credentials
- voice calling, relay transport, and video enabled
- TURN URLs and shared secret
- VAPID public key for subscription exposure

## Worker

Stable Release requires:

- the same production origin, database, and authentication key ring
- complete media storage credentials for deletion work
- Brevo configured with a verified sender
- complete VAPID subject/public/private key material

The worker already refuses production startup when email delivery or Web Push configuration is absent.

## Web adapter

Stable Release requires:

- HTTPS public origin
- exact trusted ingress proxy ranges
- the object-storage connect origin in CSP
- HTTPS to the API unless the hop is an explicitly reviewed private network path

Plaintext to an untrusted backend is mechanically refused by `apps/web/server.mjs`.

## Secrets

Provider credentials belong only in the deployment platform secret store. They must not be used as build arguments, committed environment files, Docker image layers, GitHub Actions output, screenshots, or release artifacts.

## Release identity

`SHAWTIE_RELEASE_ID` is not a secret. It must equal the exact source SHA used for the web release build so service-worker cache rotation follows the release.
