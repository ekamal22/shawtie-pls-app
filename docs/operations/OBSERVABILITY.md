# Production Observability

R2 observability is metadata-only. Do not export message, media, relationship, recovery-secret, password, verification-code, session-token, or provider-secret content to monitoring systems.

## Operational status command

```text
node scripts/operations/operational-status.mjs
```

It emits aggregate counts and ages for:

- pending/processing/failed outbox work
- pending/processing/failed scheduled actions
- incomplete/failed deletion manifests and targets
- pending or expired-undelivered security email
- open support reports

Default failure thresholds:

- failed durable work: any count greater than zero
- oldest pending outbox: 5 minutes
- oldest due scheduled action: 5 minutes
- oldest incomplete deletion manifest: 1 hour
- expired undelivered security email: any count greater than zero

Thresholds may be tuned with the documented `R2_ALERT_*` environment values after production evidence exists.

## Required external monitors

The deployment platform must also provide:

- public HTTPS availability
- API health
- web health
- PostgreSQL availability/storage pressure
- worker process liveness
- object-storage failures
- TURN availability
- Web Push provider failures
- Brevo delivery failures/rate limiting
- deployment/restart events

Alerts must route to an operator capable of taking action. Do not call R2 observability accepted until a test alert has been received.
