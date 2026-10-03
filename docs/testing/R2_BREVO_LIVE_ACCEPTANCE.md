# R2 Brevo Live Acceptance

Status: PENDING LIVE PROVIDER EXECUTION

Executable candidate: `03bf9bfd1d137ec6cae42a66a450a846aad5e397`

Canonical ledger: `docs/testing/R2_MANUAL_ACCEPTANCE_EVIDENCE.json`

Operational runbook: `docs/operations/TRANSACTIONAL_EMAIL.md`

## Purpose

This document is the canonical evidence checklist for the four Brevo-specific R2 live acceptance gates.

Repository implementation is already complete. This procedure must not redesign authentication, challenge persistence, outbox semantics, worker retry behavior, email templates, or privacy boundaries unless a real provider test exposes a defect.

Never commit, paste into documentation, or log the Brevo API key, DNS-provider credentials, authentication codes, recovery secrets, session tokens, or user data.

Use only controlled test accounts and recipient addresses approved for release acceptance.

## Gate 1: brevoSenderDomainVerified

Pass only when the intended Shawtie sending identity is verified in the actual Brevo project.

Required evidence:

- sender email or sending domain identifier, with secrets omitted
- Brevo verification state
- DKIM/domain-authentication state
- DNS records confirmed by Brevo as verified
- date/time of verification
- evidence reference such as provider screenshot identifier, exported status, or concise operator note

Do not mark this gate passed merely because DNS records were entered. Brevo must report the required identity/domain authentication as verified.

## Gate 2: brevoSmokeSendPassed

Use the repository-owned smoke path:

```text
npm run test:brevo:smoke
```

The worker-only environment must provide:

```text
EMAIL_PROVIDER=brevo
BREVO_API_KEY=<secret>
BREVO_SENDER_EMAIL=<verified sender>
BREVO_SENDER_NAME=Shawtie pls
BREVO_TIMEOUT_MS=10000
BREVO_SMOKE_CONFIRM=SEND
BREVO_TEST_RECIPIENT=<controlled recipient>
```

Pass only when:

- the command succeeds
- Brevo accepts the send
- the controlled recipient receives the message
- provider/request identifiers recorded as evidence contain no secret material
- the sender identity matches the verified production-intended identity

Record command result, UTC timestamp, sender, recipient classification such as controlled test mailbox, and provider delivery reference. Do not record the API key or delivered verification credential.

## Gate 3: brevoRegistrationAndResendPassed

Exercise the real application path with the real worker and Brevo provider configuration.

Required scenarios:

1. new registration creates the durable authentication challenge
2. worker sends the registration verification email through Brevo
3. delivered code verifies successfully
4. resend creates the expected superseding challenge behavior
5. the superseded code is rejected
6. the replacement code is delivered and accepted
7. provider delivery remains asynchronous through the durable outbox
8. no raw verification code appears in PostgreSQL outbox JSON, application logs, browser state, or committed evidence

Pass only when every scenario succeeds against the executable candidate or an evidence-only descendant with no release-impacting drift.

Record synthetic account identifiers only when needed. Redact email addresses where possible.

## Gate 4: brevoSeriousEventPassed

Exercise representative approved serious-event messages through the real `auth.security_email` worker family.

Minimum representative coverage:

- password reset or password-security event
- email-change old-address notice
- account-deletion lifecycle notice
- partnership lifecycle notice such as breakup start, restoration, dissolution, or partner-account deletion

Confirm for each representative family:

- the durable event reaches the worker
- Brevo accepts the send
- the controlled recipient receives the message
- rendered content contains only approved security/lifecycle information
- no message, media, relationship-object plaintext, partner display name, Recovery Master Secret material, password, session token, or cryptographic key is disclosed
- retry/idempotency behavior does not create uncontrolled duplicate mail

`breakup_cancelled` remains intentionally in-app only and is not a missing email case.

## Failure handling

If any live test exposes a source defect:

1. do not mark the affected gate passed
2. record the defect without secrets or real user data
3. stop treating `03bf9bfd1d137ec6cae42a66a450a846aad5e397` as the executable release candidate if a release-impacting source/config/workflow fix is required
4. implement the smallest reviewed fix
5. rerun the required repository and R2 hosted verification on the new candidate
6. update the ledger only after the corrected candidate passes the live scenario

If the issue is provider configuration only, correct the provider state and repeat the live acceptance without changing product source.

## Ledger update

After a gate passes, update only the matching entry in `docs/testing/R2_MANUAL_ACCEPTANCE_EVIDENCE.json`:

- `brevoSenderDomainVerified`
- `brevoSmokeSendPassed`
- `brevoRegistrationAndResendPassed`
- `brevoSeriousEventPassed`

Each passed entry must contain a concise evidence string with enough information for an independent reviewer to identify what executed and when. Do not place credentials, verification codes, raw email bodies, or personal data in the ledger.

Keep `candidateSha` fixed at `03bf9bfd1d137ec6cae42a66a450a846aad5e397` unless a release-impacting change forces a new executable candidate.

## Completion marker

Only after all four gates are evidenced may this document state:

```text
R2_BREVO_LIVE_ACCEPTANCE_PASS candidate=03bf9bfd1d137ec6cae42a66a450a846aad5e397
```

Brevo acceptance alone does not close R2. All non-Brevo live/manual gates remain governed by the canonical R2 audit and manual acceptance ledger.
