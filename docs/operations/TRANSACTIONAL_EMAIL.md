# Transactional Email

## Status

R2 implements real transactional email delivery through the existing provider-neutral `EmailDeliveryPort`.

The Brevo adapter now serves two reviewed families:

Authentication challenges:

- registration verification and resend
- password recovery
- account recovery
- email-change verification and resend

Minimal serious security/lifecycle notices:

- password reset completed
- old-address notice after email change
- account deletion requested
- partner account deletion started
- account permanently deleted
- breakup started
- restoration requested
- partnership restored
- breakup deadline reminder
- partnership dissolved
- partner account deleted

`breakup_cancelled` remains intentionally in-app only.

Serious-event email does not include message/media/relationship-object plaintext, partner names, recovery secrets, or cryptographic material. Live provider acceptance remains an R2 release gate.

## Architecture

The repository already had the correct durable boundary before Brevo was selected.

~~~text
Auth challenge service                  Account / partnership lifecycle
        |                                         |
        v                                         v
email_verifications                     security_email_deliveries
+ auth.email_challenge outbox            + auth.security_email outbox
        |                                         |
        +-------------------+---------------------+
                            |
                            v
                      durable worker
                            |
                            v
                    EmailDeliveryPort
                            |
                            v
                    BrevoEmailDelivery
                            |
                            v
                Brevo Transactional Email API
~~~

The API never calls Brevo synchronously.

Challenge creation and the outbox insert happen inside the same PostgreSQL transaction. A provider outage therefore cannot partially commit account state or roll back a successfully created challenge.

Authentication outbox payloads contain only the challenge ID. Immediately before challenge delivery, the worker reloads authoritative challenge state, verifies that the challenge is still active, derives the current short-lived code, renders the email, and calls the provider.

Serious-event outbox payloads contain only the durable delivery ID. The worker reloads the corresponding `security_email_deliveries` row, renders the approved template from its bounded event parameters, and sends it through the same provider-neutral port.

Authentication challenge delivery reuses the existing A1 persistence. R2 adds no provider-specific email table. Other R2 migrations serve notification preferences, public-readiness/support state, and erasure safety rather than Brevo itself.

## Challenge security

The existing A1 challenge design remains authoritative.

For every challenge:

- a new UUID identifies the challenge
- a cryptographically random 32-byte nonce is generated
- the 8-digit code is derived with the versioned authentication key ring
- a separate keyed verifier is stored
- the raw code is not stored in PostgreSQL
- the raw code is not stored in the outbox
- the raw code is not returned by authentication HTTP endpoints
- normal worker errors do not contain the raw code
- the challenge expires 10 minutes after creation
- the default maximum verification-attempt count is 5
- successful verification consumes the challenge
- consumed challenges cannot be reused
- a replacement challenge supersedes the previous active challenge
- superseded challenges cannot be used or delivered

Registration intent lifetime remains separate from challenge lifetime. Registration intents last 24 hours, while each verification code lasts 10 minutes.

Registration resend keeps the existing minimum 60-second resend interval and durable network and registration-intent budgets. Creating the new challenge supersedes the prior challenge.

## Delivery content

Authentication mail is intentionally minimal.

A verification email includes:

- Shawtie pls authentication subject
- the 8-digit verification credential
- the authoritative remaining expiry in minutes
- a short instruction to ignore the email if the request was not made by the recipient

It does not include:

- password
- session token
- device secret
- Recovery Master Secret
- message content
- relationship-space content
- partner identity
- breakup or relationship state
- marketing content

The renderer produces both a plain-text representation and an HTML representation so template behavior can be tested independently of the provider.

Brevo's transactional send API accepts one inline content mode for a single send request. The current adapter therefore sends the HTML representation through Brevo while retaining and testing the plain-text representation in the provider-neutral renderer. If the provider contract later supports multipart content through a supported mechanism, the adapter can add it without changing A1 challenge semantics.

## Brevo configuration

The provider is disabled by default in local development.

Production worker startup fails closed if no email provider is configured.

Required worker environment when Brevo is enabled:

~~~text
EMAIL_PROVIDER=brevo
BREVO_API_KEY=<secret from deployment secret store>
BREVO_SENDER_EMAIL=auth@example.com
AUTH_HMAC_KEYS=<same authentication key ring used by the API>
AUTH_HMAC_ACTIVE_VERSION=1
~~~

Optional:

~~~text
BREVO_SENDER_NAME=Shawtie pls
BREVO_TIMEOUT_MS=10000
~~~

`BREVO_TIMEOUT_MS` is bounded from 1000 to 30000 milliseconds.

The worker and API must use the same `AUTH_HMAC_KEYS` versions. The worker derives the short-lived code for delivery and the API independently derives the verifier used to validate the submitted code.

The repository includes `.env.example` with placeholders only. Real provider credentials belong in process environment or the deployment secret store. Do not commit a populated `.env` file.

The Brevo API key must never be placed in:

- frontend code
- browser runtime configuration
- PostgreSQL
- outbox payloads
- migrations
- logs
- test fixtures
- documentation
- GitHub commits

## Manual Brevo sender and domain setup

Before a real production send, configure Brevo manually.

Required operational work:

1. register the intended Shawtie sender identity in Brevo
2. verify the sender if Brevo requires sender-level verification
3. use a domain owned by the project for production mail
4. add the exact domain-authentication records generated by Brevo
5. verify DKIM in Brevo
6. configure or verify DMARC for the sending domain
7. follow Brevo's current domain-authentication guidance for SPF rather than adding a duplicate SPF record
8. choose the final production sender address, for example `auth@<shawtie-domain>`

For Brevo shared-IP sending, follow the provider's current generated DNS records. Do not add a second SPF or DMARC record merely because this document mentions those standards.

No sender, DNS, DKIM, DMARC, SPF, or production-domain setup is considered complete until it is actually verified in Brevo and DNS.

## Provider request

The adapter calls Brevo directly from the durable backend worker:

~~~text
POST https://api.brevo.com/v3/smtp/email
~~~

The provider API key is carried only in the server-side `api-key` header.

The body contains only the information required for the approved transactional message:

- configured sender identity
- destination email
- rendered authentication or minimal serious-event subject/body
- a non-secret `shawtie-auth` or `shawtie-security` tag
- the opaque Shawtie delivery ID

The browser never sees the Brevo API key.

## Idempotency and duplicate delivery

Shawtie remains an at-least-once worker system.

The adapter sends the durable Shawtie delivery ID as Brevo's message-level idempotency key. If Brevo reports that the same idempotency key was already accepted, the worker treats the message as delivered rather than repeatedly sending it.

This protects the provider-success/worker-response-loss case.

Provider idempotency does not replace Shawtie challenge semantics. A challenge remains:

- short lived
- single use
- attempt limited
- supersedable

A user can still receive a stale email if delivery occurred immediately before a resend superseded that challenge. The stale code is harmless because verification and future worker delivery both fail closed against superseded challenge state.

## Failure handling

A Brevo outage cannot corrupt authentication state because provider I/O happens after the API transaction through the durable outbox.

Current failure classification:

- successful provider response: delivery succeeds
- duplicate idempotency response: treated as already delivered
- request timeout: retryable
- network failure: retryable
- HTTP 408: retryable
- HTTP 429: retryable
- HTTP 5xx: retryable
- other non-success responses: permanent provider rejection
- unsupported template or invalid template parameters: permanent internal delivery failure
- missing authentication key version: permanent delivery failure
- consumed, superseded, expired, or attempt-exhausted challenge: permanent delivery failure

The durable outbox currently allows up to 12 attempts. Retry delay uses the repository's existing deterministic exponential backoff with bounded jitter and a maximum delay of 15 minutes.

Because authentication challenges expire after 10 minutes, the handler rechecks the authoritative expiry before each retry. It will not deliver an expired code even if the outbox still has remaining attempts.

## Local development

Without a configured provider, local authentication behavior can still be exercised by automated tests using the existing fake provider and deterministic test key material.

There is no production HTTP route that returns a verification code.

Do not add a browser-visible development shortcut.

For a real local Brevo test, set the provider variables in the worker process only. Example PowerShell shape:

~~~powershell
$env:DATABASE_URL="<local PostgreSQL connection string>"
$env:EMAIL_PROVIDER="brevo"
$env:BREVO_API_KEY="<read from your local secret source>"
$env:BREVO_SENDER_EMAIL="<verified Brevo sender>"
$env:BREVO_SENDER_NAME="Shawtie pls"
$env:BREVO_TIMEOUT_MS="10000"
$env:AUTH_HMAC_KEYS="<same value used by the API>"
$env:AUTH_HMAC_ACTIVE_VERSION="1"

npm run start --workspace @shawtie/worker
~~~

Do not paste the API key into chat, source files, or shell-history screenshots.

## Opt-in provider smoke test

The normal automated suite never calls Brevo.

An explicit smoke helper exists for one provider-level send:

~~~text
npm run test:brevo:smoke
~~~

It refuses to send unless all required provider configuration is present and:

~~~text
BREVO_SMOKE_CONFIRM=SEND
BREVO_TEST_RECIPIENT=<address you control>
~~~

The smoke helper sends a synthetic authentication-style email. It does not create or mutate a Shawtie account.

This smoke is optional and must never run from the normal CI or repository-health path.

## Real end-to-end registration test

After the sender is verified and the local worker is configured:

1. run PostgreSQL and apply the repository migrations
2. start the API with the same `AUTH_HMAC_KEYS`
3. start the worker with `EMAIL_PROVIDER=brevo` and the Brevo secret in its process environment
4. start the web app
5. create a synthetic test account using an inbox you control
6. confirm the verification email arrives
7. enter the received 8-digit code
8. confirm account creation succeeds
9. confirm a second use of the code is rejected
10. use resend only after the existing resend window if a second challenge is needed
11. confirm the older challenge cannot complete registration after resend

## Automated verification

Focused provider tests cover:

- template rendering
- HTML and plain-text rendering
- authoritative expiry rendering
- official endpoint and payload construction
- idempotency header construction
- duplicate-provider response handling
- retryable provider failure
- permanent provider rejection
- timeout behavior
- invalid or unsupported template parameters
- configuration fail-closed behavior

Existing A1 integration and acceptance coverage continues to own:

- no raw code column
- no raw code in challenge outbox payload
- derivation from challenge state in the worker
- expiry
- attempt exhaustion
- consumed challenge replay rejection
- superseding and resend
- rate limiting
- generic recovery initiation
- verified-email uniqueness
- account/session security behavior

## Remaining R2 provider work

Repository delivery wiring for both authentication challenges and approved serious-event templates is implemented.

Still open before Stable Release:

- verify the real Brevo sender and project-owned sending domain
- complete provider-generated DNS authentication
- perform a real provider smoke test
- perform real registration and resend/supersede acceptance
- deliver representative serious-event templates through the real provider path
- verify provider failures and retries in the deployed worker
- configure provider/worker observability and prove a failure alert reaches an operator
- review whether delivery/bounce webhooks are necessary for the chosen production operations model
- complete final owner/legal/privacy review of the deployed provider disclosures

Canonical tracking: `R2_PUBLIC_READINESS_AUDIT.md`. Exact live-provider acceptance procedure and evidence requirements: `../testing/R2_BREVO_LIVE_ACCEPTANCE.md`.
