# Data Classification and Handling Matrix

## Status

Accepted data-handling baseline for foundation implementation.

This document classifies the major data handled by Shawtie pls and defines how it may be stored, logged, backed up, exposed to providers, encrypted, and deleted.

The final implementation must not silently weaken these rules.

## Classification levels

### PUBLIC

Information intentionally exposed to other users or the public repository.

Examples:

- public source code
- public documentation
- username
- display name
- avatar if enabled
- short bio if provided
- derived current age in username search

PUBLIC does not mean unrestricted internal logging or indefinite retention.

### INTERNAL

Operational data that is not intended as user-visible private content but can reveal system behavior.

Examples:

- opaque request IDs
- deployment version
- queue depth
- non-sensitive aggregate metrics
- schema versions

### SENSITIVE

Account, security, or metadata whose exposure may create privacy or abuse risk.

Examples:

- email address
- exact date of birth
- IP address
- push token
- device metadata
- partnership membership metadata
- timestamps
- call metadata

### HIGHLY_SENSITIVE

Private user content or security state that requires the strongest application protections.

Examples:

- message plaintext
- media plaintext
- relationship-object plaintext
- private notes
- historical decryption material
- encrypted recovery material
- session tokens

### SECRET

Credentials or cryptographic secrets that must never be exposed through normal application responses, logs, repository content, analytics, or third-party telemetry.

Examples:

- password plaintext
- production database password
- API secrets
- private device keys
- recovery secret
- signing secrets
- provider credentials
- static deployment secrets

## Handling principles

1. collect only data required by product behavior
2. prefer derived values over exposing source data
3. E2EE protected plaintext exists only on authorized clients
4. application logs use an allowlist approach
5. raw unkeyed hashes of HIGHLY_SENSITIVE relationship request bodies are not persisted; equality fingerprints use a server-keyed domain-separated construction
6. providers receive the minimum data needed for their function
7. deletion behavior is defined per data category
8. backups do not override product deletion semantics
9. synthetic data only in the public repository
10. secret material never enters source control
10. cryptographic recovery secrets remain client-held

## Data matrix

| Data | Class | Server readable | E2EE target | Log policy | Backup policy | Third-party exposure | Primary deletion trigger |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Username | PUBLIC | Yes | No | May log normalized ID reference sparingly, not search history by default | Standard account backup | Visible to searched users | Permanent account deletion or username change |
| Display name | PUBLIC | Yes | No | Avoid routine logs | Standard account backup | Visible in search | Permanent account deletion |
| Avatar | PUBLIC when enabled | Yes or encrypted depending final design | Optional | Never log binary | According to profile retention | Object-storage provider if stored there | Removal or permanent account deletion |
| Short bio | PUBLIC when provided | Yes | No | Do not log content | Standard account backup | Visible in search | Removal or permanent account deletion |
| Current age | PUBLIC in search | Derived | No | Avoid routine logs | Recomputed | Visible in search | Derived from account state |
| Exact date of birth | SENSITIVE | Yes | No | Never log | Account backup with restricted access | No external exposure except infrastructure processor where unavoidable | Permanent account deletion subject to legal minimum retention |
| Verified email | SENSITIVE | Yes | No | Never log full address in routine app logs | Account backup with restricted access | Email provider necessarily receives destination | Permanent account deletion |
| Password plaintext | SECRET | Only transiently during verification | No | Never | Never | No provider exposure | Immediately after authentication operation |
| Password hash | HIGHLY_SENSITIVE | Yes | No | Never log | Restricted account backup | No ordinary third-party exposure | Permanent account deletion |
| Email verification code plaintext | SECRET | Only transiently before send and verification | No | Never | Never | Email provider receives delivered code | Expiry or successful consumption |
| Verification code keyed verifier | HIGHLY_SENSITIVE | Yes | No | Never log | No long-term backup need | No | Expiry or consumption |
| Session token or cookie value | SECRET | Server validates | No | Never | Prefer no backup requirement | Browser receives own token only | Logout, expiry, revocation, sensitive security event |
| Session metadata | SENSITIVE | Yes | No | Minimal security logs allowed | Short bounded retention | No ordinary provider exposure | Expiry plus bounded security retention |
| IP address | SENSITIVE | Infrastructure may observe | No | Security-only bounded retention | Avoid long backup retention | Hosting, TURN, email, or CDN may observe depending request | Bounded security retention |
| Device ID | SENSITIVE | Yes | No | May log opaque ID | Account backup | No ordinary provider exposure | Device removal or permanent account deletion |
| Device display name | SENSITIVE | Yes | No | Avoid routine logs | Account backup | No | Device removal or permanent account deletion |
| Device public crypto key | SENSITIVE | Yes | No | Never log raw key by default | Required crypto backup/state | No ordinary provider exposure | Device revocation plus required protocol retention |
| Device private crypto key | SECRET | No | Client-side protected state | Never | Only client-encrypted recovery design if approved | Never plaintext to provider | Device removal, revocation, permanent account deletion |
| High-entropy recovery secret | SECRET | No | Client-only | Never | Never server-side | Never | User destroys or account permanently deleted |
| Encrypted recovery material | HIGHLY_SENSITIVE | Yes as ciphertext | Already encrypted | Never log payload | Restricted encrypted backup | Storage provider may hold ciphertext | Permanent account deletion |
| Partnership ID | SENSITIVE | Yes | No | Opaque ID may appear in structured logs | Operational backup | Push or realtime systems may receive opaque ID where required | Final dissolution subject to bounded audit retention |
| Partnership membership | SENSITIVE | Yes | No | Minimal audit only | Operational backup | No unnecessary provider exposure | Final dissolution subject to bounded lifecycle-event retention |
| Relationship start date | SENSITIVE | Yes unless later encrypted by design | Optional | Never routine log | Partnership backup before deletion | No unnecessary provider exposure | Final dissolution |
| Account notification event/routing metadata | SENSITIVE | Yes | No | Avoid routine log; event ID only where needed | Operational backup | Future push may receive only minimal opaque routing/event data | Product notification retention or partnership/account deletion policy |
| Breakup initiator and timestamps | SENSITIVE | Yes | No | Security/lifecycle audit allowed | Bounded lifecycle backup | Minimal email/push event may reveal event occurrence | Final dissolution plus bounded audit retention |
| Restore intent timestamps | SENSITIVE | Yes | No | Lifecycle audit allowed | Bounded lifecycle backup | Minimal notification event | Final dissolution plus bounded audit retention |
| Cooldown timestamp | SENSITIVE | Yes | No | May log opaque state transition | Operational backup | No | Cooldown expiry plus bounded lifecycle retention |
| Block relationship | SENSITIVE | Yes | No | Security audit only | Operational backup | No | Block removal or account deletion |
| Message plaintext | HIGHLY_SENSITIVE | Pre-S1 development only; No after stable E2EE | Yes | Never | Never server plaintext backup | Never provider plaintext | User delete, final dissolution, permanent account deletion |
| Message ciphertext | HIGHLY_SENSITIVE | Yes as ciphertext | Yes | Never log payload | Encrypted application backup until deletion | Hosting/database provider may hold ciphertext | Message deletion or final dissolution |
| Message mutation change metadata | SENSITIVE | Yes | Metadata only | Opaque IDs/cursors only where operationally required; never content | Operational backup only while conversation exists | Realtime delivery may receive opaque IDs/cursors | Conversation or final partnership deletion |
| Private mutation keyed fingerprint | HIGHLY_SENSITIVE | Yes as verifier only | No | Never log | Bounded operational retention only | No | Idempotency retention expiry, message/account/partnership deletion as applicable |
| Partnership chat nickname | HIGHLY_SENSITIVE | Pre-S1 server-readable; S1 representation requires explicit review | Yes target | Never log content | Partnership-scoped backup before S1; encrypted target after S1 | No unnecessary provider exposure | Clear nickname or final dissolution |
| Message sender and server timestamp | SENSITIVE | Yes | Metadata only | Minimal structured logging if needed | Operational backup | Push provider should not need sender identity unless explicitly required | Message or partnership lifecycle plus bounded operational retention |
| Read receipt | SENSITIVE | Yes where required | Metadata | Avoid routine logs | Minimal operational backup | Push provider should not receive unnecessary detail | Conversation or partnership deletion |
| Typing indicator | SENSITIVE | Transiently | Metadata | Never persist in logs | No backup | Realtime provider if external, preferably none | Immediate expiry |
| Online presence | SENSITIVE | Transiently | Metadata | Avoid history logs | No long-term backup | Realtime infrastructure only | Immediate or short expiry; disclosure is limited to the current partnership and cannot reveal pre-partnership last-seen activity |
| Reaction content | HIGHLY_SENSITIVE or SENSITIVE depending final crypto design | Prefer encrypted | Yes where practical | Never log content | Encrypted backup with message | No provider plaintext | Reaction deletion or final dissolution |
| Original filename | HIGHLY_SENSITIVE | Prefer no | Encrypt where practical | Never log | Inside encrypted descriptor only | Never provider plaintext | Media deletion or final dissolution |
| Attachment MIME type | SENSITIVE | Minimize, encrypt where practical | Prefer yes | Avoid routine logs | Minimal | Storage may infer some properties from transport unless normalized | Media deletion or final dissolution |
| Media plaintext | HIGHLY_SENSITIVE | No | Yes | Never | Never plaintext server backup | Never provider plaintext | Media deletion or final dissolution |
| Media ciphertext | HIGHLY_SENSITIVE | Yes as ciphertext | Yes | Never log payload | Encrypted object backup only until deletion | Object-storage provider holds ciphertext | Media deletion or final dissolution |
| Media object key | SENSITIVE | Yes | No, random opaque value | May log only in tightly controlled storage diagnostics | Operational metadata backup | Object-storage provider receives key | Media deletion or final dissolution |
| M3 development wrapped media key envelope | HIGHLY_SENSITIVE | Yes, wrapped only | Client holds raw key transiently | Never log | Restricted operational backup only while pre-S1 media exists | No ordinary provider exposure | S1 client re-encryption/wipe, media deletion, or final dissolution |
| M3 development media wrapping key | SECRET | No database storage | No | Never | Secret manager/environment only, versioned rotation | Never | Retire only after no envelope requires that version |
| Signed media upload/read URL | SECRET-like bearer capability | Generated transiently | Transient only | Never log full URL | Never | Object-storage provider necessarily receives capability | Short expiry |
| Voice-message plaintext | HIGHLY_SENSITIVE | No | Yes | Never | Never plaintext server backup | Never provider plaintext | Message or partnership deletion |
| Call audio/video plaintext | HIGHLY_SENSITIVE | No | Yes | Never | No server recording in MVP | Endpoint only | End of call |
| Call signaling state | SENSITIVE | Yes | Metadata | Minimal structured logs | Short operational retention | TURN does not need application signaling detail | Bounded operational retention |
| Call start/end/duration | SENSITIVE | Yes | Metadata | Minimal | Partnership-scoped backup until deletion | TURN may infer network timing | Final dissolution |
| TURN username/credential | SECRET | Issued transiently | No | Never log credential | No backup | TURN receives credential | Short expiry |
| Push token | SENSITIVE | Yes | No | Never log full token | Restricted operational backup | Push provider receives token | Token invalidation, device revocation, account deletion |
| Push payload | SENSITIVE | Yes during send | No content plaintext | Log event type only | No payload backup | Push provider receives payload | Delivery completion |
| R1 development preview plaintext | HIGHLY_SENSITIVE | Yes before S1 only | Yes, preview envelope after S1 | Never | Development-only restricted backup policy | Never provider plaintext | Item deletion, final dissolution, or S1 migration/wipe |
| R1 development main plaintext | HIGHLY_SENSITIVE | Yes before S1 only | Yes, sealed envelope after S1 | Never | Development-only restricted backup policy | Never provider plaintext | Item deletion, final dissolution, or S1 migration/wipe |
| Memory plaintext | HIGHLY_SENSITIVE | No after E2EE | Yes | Never | Never server plaintext backup | Never provider plaintext | Item deletion or final dissolution |
| For You plaintext | HIGHLY_SENSITIVE | No after E2EE | Yes | Never | Never server plaintext backup | Never provider plaintext | Final dissolution |
| Future Us plaintext | HIGHLY_SENSITIVE | No after E2EE | Yes | Never | Never server plaintext backup | Never provider plaintext | Final dissolution |
| Relationship preview ciphertext | HIGHLY_SENSITIVE | Yes as ciphertext | Yes | Never log payload | Encrypted application backup until deletion | Database provider may hold ciphertext | Item deletion or final dissolution |
| Relationship sealed-content ciphertext | HIGHLY_SENSITIVE | Yes as ciphertext but withheld from intended recipient until release | Yes | Never log payload | Encrypted application backup until deletion | Database provider may hold ciphertext | Item deletion or final dissolution |
| Scheduled unlock timestamp | SENSITIVE | Yes where worker requires it | No | Minimal operational log | Operational backup | No unnecessary exposure | Item or partnership deletion |
| R1 idempotency keyed fingerprint | SENSITIVE | Yes | No | Never log value | Bounded operational backup | No | Receipt expiry or final dissolution |
| Location memory coordinates | HIGHLY_SENSITIVE | Prefer encrypted | Yes | Never log | Encrypted backup only | Map provider exposure must be separately reviewed if introduced | Item deletion or final dissolution |
| Lifecycle event record | SENSITIVE | Yes | No | It is itself bounded audit metadata | Bounded backup | No unnecessary provider exposure | Retention schedule after event no longer operationally required |
| Outbox event | INTERNAL or SENSITIVE | Yes | No | Event type and status only | Short operational backup | Provider receives only its intended minimal projection | Successful delivery plus bounded retention |
| Scheduled action | INTERNAL or SENSITIVE | Yes | No | Type, ID, timing, status | Operational backup | No | Completion plus bounded retention |
| Deletion manifest | SENSITIVE | Yes | No | IDs, state, error codes only | Keep until deletion proof and bounded audit period | No | Completion plus bounded audit retention |
| Security log | SENSITIVE | Yes | No | Content must be allowlisted | Bounded security retention | Logging provider only if approved | Security retention expiry |
| Application error trace | INTERNAL or SENSITIVE | Yes | No | Must be scrubbed of secrets and private content | Bounded operational retention | Error provider only if approved | Operational retention expiry |
| CI secret | SECRET | Only CI runtime | No | Never | Secret store only | CI provider necessarily holds encrypted secret | Rotation or removal |
| Database credential | SECRET | Only trusted runtime | No | Never | Secret manager only | Hosting provider as infrastructure | Rotation |
| Storage credential | SECRET | Only trusted runtime | No | Never | Secret manager only | Storage provider as infrastructure | Rotation |
| Email-provider credential | SECRET | Only worker/runtime | No | Never | Secret manager only | Email provider | Rotation |
| Production backup | HIGHLY_SENSITIVE | Infrastructure readable according to encryption model | Mixed | Never inspect casually | Encrypted, access-restricted, bounded retention | Backup provider may hold encrypted copy | Retention expiry with deletion obligations |

## Repository data policy

The public repository may contain:

- synthetic usernames
- synthetic account IDs
- synthetic messages
- synthetic media fixtures created for testing
- non-secret local development defaults

The public repository must never contain:

- real private messages
- real relationship data
- real private media
- production emails
- production dates of birth
- production IP addresses
- production push tokens
- production session values
- real cryptographic private keys
- recovery secrets
- production provider credentials
- production database dumps
- backup exports containing user data

## Logging allowlist

Routine request logs may include:

- request ID
- route template
- HTTP method
- response status
- duration
- deployment version
- opaque authenticated account ID where justified
- opaque device ID where justified
- error code

Routine logs must not include:

- full request body by default
- message content
- relationship content
- media content
- password
- verification code
- session token
- cookies
- Authorization header
- private keys
- recovery secrets
- full push tokens
- full signed media URLs
- provider credentials

## Analytics policy

Initial analytics should be operational, not behavioral.

Acceptable examples:

- API latency
- job lateness
- outbox depth
- failed upload count
- call-setup failure count
- reconnect failure count
- aggregate feature error rate

Do not collect:

- message text
- message sentiment
- relationship content
- private media
- detailed relationship behavior for advertising
- contact graph expansion beyond product requirements

## Provider review rule

Before introducing a provider that receives SENSITIVE, HIGHLY_SENSITIVE, or SECRET data, document:

- exact fields sent
- purpose
- retention
- region where relevant
- provider access model
- encryption
- deletion support
- breach implications
- whether a lower-exposure design is practical

## Retention defaults

Exact retention periods remain to be set during infrastructure implementation.

Until specific periods are approved:

- private content follows product deletion rules
- transient presence and typing data should not become historical records
- verification codes use short expiry
- TURN credentials use short expiry
- outbox and completed scheduled actions use bounded operational retention
- lifecycle and security audit records use bounded retention
- backups use documented bounded retention
- no category receives indefinite retention merely because deletion has not yet been implemented

## Data-classification review triggers

Update this matrix when:

- E2EE protocol is selected
- provider selection changes
- new data fields are added
- new analytics are proposed
- location features gain external map providers
- native clients are added
- moderation workflows change
- deferred post-stable call recording is approved for implementation
- data export is implemented
- backup policy changes
- legal retention requirements become applicable
