import type { CallTerminalReason, PublicCallOutcome } from "./types.ts";

export function publicCallOutcome(reason: CallTerminalReason | null): PublicCallOutcome | null {
  if (reason === null) return null;
  switch (reason) {
    case "rejected":
    case "cancelled":
    case "missed":
    case "completed":
    case "failed":
      return reason;
    case "authorization_revoked":
    case "partnership_terminated":
    case "account_deletion":
    case "session_revoked":
      return "unavailable";
  }
}
