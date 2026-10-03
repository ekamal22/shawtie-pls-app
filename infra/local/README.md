# Local Infrastructure

Start the disposable local PostgreSQL and private object-storage services with:

```text
docker compose -f infra/local/compose.yml up -d
```

Default local PostgreSQL:

```text
postgresql://shawtie:shawtie@127.0.0.1:5432/shawtie
```

The values in this compose file are local-only development credentials and must never be reused in production.

TURN is intentionally not embedded here. Calling closure uses the existing dedicated harnesses and production TURN must be configured as a separate relay service with short-lived credentials.
