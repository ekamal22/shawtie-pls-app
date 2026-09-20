# Call Architecture

## Scope

Voice and video calls are part of MVP.

Built-in call recording is deferred beyond the first stable release and beyond the initial post-stable maturity period.

## Transport

Use WebRTC for media.

Use the authenticated WebSocket channel for call signaling.

## Media path

Preferred privacy behavior:

```text
caller
  |
encrypted WebRTC
  |
TURN relay
  |
encrypted WebRTC
  |
callee
```

Use relay-first behavior where supported to reduce direct peer IP exposure.

TURN should support practical fallbacks such as:

- UDP
- TCP
- TLS on port 443

The final provider choice may be self-hosted or managed.

## TURN credentials

TURN credentials must be short-lived.

The PWA must never contain a permanent TURN username and password.

The authenticated API issues temporary TURN credentials only after:

- validating the caller session
- validating partnership membership
- evaluating call capability
- applying signaling and abuse rate limits

Expired credentials cannot be refreshed without new authorization.

## Encryption

WebRTC transport encryption is required.

The E2EE architecture must ensure the selected call design does not expose plaintext call media to application servers or media relay infrastructure.

If a future architecture introduces an SFU, the encryption model must be reviewed again before deployment.

## Signaling

Persist or transmit only what is needed for call state.

Logical states include:

```text
ringing
accepted
connected
ended
missed
rejected
cancelled
failed
```

## Partnership authorization

A call may be initiated only inside an authorized partnership.

During `breakup_pending`, every call still requires explicit acceptance by the other partner before media begins.

Calls never auto-answer.

During account-deletion recovery from an active partnership, calls are disabled because the partnership is view-only and one account has no access.

## Call history

Store partnership-scoped metadata:

- voice or video
- incoming or outgoing
- start time
- end time or duration
- missed status
- partnership ID

Call history is deleted with the partnership.

## Network privacy

TURN relay reduces peer IP exposure but the relay necessarily observes connection metadata.

The privacy policy and E2EE documentation must distinguish encrypted call content from network metadata.

## Relay policy

Relay-first behavior is preferred for privacy.

If the implementation ever permits direct peer connectivity, the privacy impact must be documented explicitly and user expectations must not imply that peer IP addresses are always hidden.

## Failure handling

The client must handle:

- denied microphone or camera permission
- unavailable TURN
- network change
- signaling reconnect
- unanswered call
- call rejection
- peer disconnect
- app backgrounding where browser behavior permits

## Deferred post-stable call recording

Call recording is not an automatic post-release milestone.

Before implementation, post-stable production evidence must justify the storage and bandwidth cost, retention model, deletion and backup-expiry obligations, legal and privacy burden, user demand, and E2EE-compatible recording architecture.

The chosen design may be cloud-hosted, quota-limited, paid, local-only, audio-only, short-retention export, or omitted entirely if the economics or privacy model are not acceptable.

Call recording remains outside MVP and stable release.

Future recording requires:

- explicit consent from both participants for every recording session
- clear recording indicator
- E2EE-compatible recording design
- both-partner access
- partnership-scoped authorization
- deletion at final partnership dissolution
- deletion when permanent account deletion destroys partnership data
- separate privacy, legal, security, retention, export, and consent review

Consent from a previous recording session must never carry over automatically.
