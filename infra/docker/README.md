# Production Containers

These files define the repository-owned container boundary for R2.

## API and worker

`Dockerfile.api` and `Dockerfile.worker` build the required workspace packages from the committed lockfile and run with `NODE_ENV=production`.

Runtime credentials are never baked into an image. Inject them with the deployment platform secret store.

## Web

`Dockerfile.web` is intentionally a runtime-only image. Build the release web artifact before building this image:

```text
npm ci --ignore-scripts
npm run build --workspace @shawtie/crypto
npm run build:s1-wasm
SHAWTIE_RELEASE_ID=<exact-source-sha> npm run build --workspace @shawtie/web
docker build -f infra/docker/Dockerfile.web .
```

This keeps Rust/OpenMLS/WASM build tooling in the controlled release build rather than the public runtime image.

## Network boundaries

- public traffic terminates at the web adapter or a reviewed ingress immediately in front of it
- PostgreSQL, object storage, worker, and API are not public internet services
- the web-to-API HTTP hop is allowed only on a verified private transport with `WEB_ALLOW_PRIVATE_BACKEND_HTTP=1`; otherwise use HTTPS
- TURN is the only expected internet-facing relay service besides the public application origin
- object storage remains private and is reached through short-lived signed grants
