import type {
  CryptoRecoveryViewState,
  ProtectedWriteState,
  SecurityTaskKind,
} from "./crypto-security-model.ts";

export interface SecurityTaskCopy {
  readonly title: string;
  readonly body: string;
  readonly actionLabel: string | null;
  readonly tone: "info" | "warning" | "error";
}

const TASK_COPY: Record<SecurityTaskKind, SecurityTaskCopy | null> = {
  none: null,
  session_invalid: {
    title: "Protected sharing is unavailable",
    body: "This device or account session no longer has protected-sharing access.",
    actionLabel: "Open protected sharing",
    tone: "error",
  },
  runtime_unavailable: {
    title: "Protected sharing could not start",
    body: "Shawtie could not safely open protected sharing on this device.",
    actionLabel: "Open protected sharing",
    tone: "error",
  },
  device_pending: {
    title: "Finish protected sharing on this device",
    body: "Recover with your recovery key, or approve this device from another trusted device.",
    actionLabel: "Finish setup",
    tone: "warning",
  },
  recovery_not_configured: {
    title: "Save a recovery key",
    body: "A recovery key can restore recoverable protected history on a new device.",
    actionLabel: "Set up recovery",
    tone: "warning",
  },
  partnership_waiting_for_recovery: {
    title: "Protected sharing is waiting for recovery setup",
    body: "Protected sharing can finish preparing after both accounts have recovery configured.",
    actionLabel: "Open protected sharing",
    tone: "warning",
  },
  rekeying: {
    title: "Protected sharing is updating",
    body: "Device access changed. Existing verified content stays readable while protected writes pause.",
    actionLabel: "View status",
    tone: "info",
  },
  repair_required: {
    title: "Protected sharing needs repair",
    body: "This device cannot restore the current group state normally. A recovery-backed repair is available.",
    actionLabel: "Review repair",
    tone: "warning",
  },
};

export function securityTaskCopy(kind: SecurityTaskKind): SecurityTaskCopy | null {
  return TASK_COPY[kind];
}

export function protectedWriteReason(state: ProtectedWriteState): string | null {
  const copy: Record<ProtectedWriteState, string | null> = {
    allowed: null,
    blocked_session: "Protected sharing is unavailable for this session.",
    blocked_runtime: "Protected sharing is not ready on this device.",
    blocked_device_pending:
      "Finish protected sharing on this device before sending protected content.",
    blocked_recovery_prerequisite:
      "Protected sharing is waiting for recovery setup before protected content can be changed.",
    blocked_rekey:
      "Protected sharing is updating device access. Protected writes will resume shortly.",
    blocked_repair: "Protected sharing needs repair before protected content can be changed.",
  };
  return copy[state];
}

export function recoveryStatusCopy(state: CryptoRecoveryViewState): string {
  const copy: Record<CryptoRecoveryViewState, string> = {
    not_configured: "No recovery key has been saved yet.",
    configured_here: "Recovery is configured on this device.",
    configured_elsewhere:
      "Recovery is configured for this account, but this device does not hold the matching recovery capability.",
    pending_can_recover:
      "This device can be restored with the recovery key. Another trusted device can also approve it for future protected sharing.",
    unavailable: "Recovery status could not be verified safely.",
  };
  return copy[state];
}

export function cryptoErrorCopy(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  const copy: Record<string, string> = {
    CRYPTO_STARTING: "Protected sharing is still starting.",
    CRYPTO_UNAVAILABLE: "Protected sharing is unavailable on this device.",
    CRYPTO_DEVICE_UNAVAILABLE: "This session does not have a usable device for protected sharing.",
    CRYPTO_DEVICE_UNTRUSTED:
      "This device must be approved or recovered before it can use protected sharing.",
    CRYPTO_RECOVERY_UNAVAILABLE: "No recovery key is configured for this account.",
    REAUTH_REQUIRED: "Confirm your password again before changing protected-sharing recovery.",
    CRYPTO_RECOVERY_FAILED: "That recovery key could not be verified. Nothing was restored.",
    CRYPTO_RECOVERY_REQUIRED:
      "Recovery must be configured before this protected action can continue.",
    CRYPTO_GROUP_NOT_READY: "Protected sharing is still preparing for this relationship.",
    CRYPTO_GROUP_RESET_REQUIRED: "Protected sharing could not be repaired from the current state.",
    CRYPTO_REKEY_REQUIRED: "Protected sharing is updating device access.",
    CRYPTO_HISTORY_UNAVAILABLE: "This older protected content is unavailable on this device.",
    CRYPTO_CIPHERTEXT_INVALID: "This protected content could not be safely verified.",
    CRYPTO_SIGNATURE_INVALID: "This protected content could not be safely verified.",
  };
  return copy[code] ?? "Protected sharing could not complete that action.";
}
