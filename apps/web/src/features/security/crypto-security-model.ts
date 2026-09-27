import type { CryptoPartnershipState } from "../../lib/crypto/crypto-api.ts";
import type { S1RuntimeStatus } from "../../lib/crypto/crypto-runtime.ts";

export type CryptoRuntimeViewState = "starting" | "ready" | "unavailable";
export type CryptoDeviceTrustViewState = "pending" | "trusted" | "revoked" | "unavailable";
export type CryptoRecoveryViewState =
  | "not_configured"
  | "configured_here"
  | "configured_elsewhere"
  | "pending_can_recover"
  | "unavailable";
export type CryptoPartnershipViewState =
  | "none"
  | "preparing"
  | "waiting_for_recovery"
  | "ready"
  | "rekeying"
  | "repair_required"
  | "unavailable";
export type SecurityTaskKind =
  | "none"
  | "session_invalid"
  | "runtime_unavailable"
  | "device_pending"
  | "recovery_not_configured"
  | "partnership_waiting_for_recovery"
  | "rekeying"
  | "repair_required";
export type ProtectedWriteState =
  | "allowed"
  | "blocked_session"
  | "blocked_runtime"
  | "blocked_device_pending"
  | "blocked_recovery_prerequisite"
  | "blocked_rekey"
  | "blocked_repair";

export interface LocalRecoveryStatus {
  readonly configured: boolean;
  readonly recoveryKeyVersion: number | null;
}

export interface LocalGroupStatus {
  readonly available: boolean;
  readonly groupGeneration: number | null;
  readonly cryptoRequired: boolean;
  readonly rekeyRequired: boolean;
}

export interface CryptoSecurityInputs {
  readonly runtimePresent: boolean;
  readonly runtimeStatus: S1RuntimeStatus;
  readonly serverRecovery:
    | { readonly configured: true; readonly recoveryKeyVersion: number }
    | { readonly configured: false }
    | null;
  readonly localRecovery: LocalRecoveryStatus | null;
  readonly partnershipId: string | null;
  readonly lifecycleState: "active" | "breakup_pending" | null;
  readonly interactionMode:
    | "normal"
    | "breakup_restricted"
    | "account_deletion_view_only"
    | null;
  readonly partnershipState: CryptoPartnershipState | null;
  readonly localGroup: LocalGroupStatus | null;
  readonly partnershipRefreshError: string | null;
  readonly reconciliationComplete: boolean;
  readonly revision: string;
}

export interface CryptoSecurityViewModel {
  readonly runtime: CryptoRuntimeViewState;
  readonly currentDeviceTrust: CryptoDeviceTrustViewState;
  readonly recovery: CryptoRecoveryViewState;
  readonly partnership: CryptoPartnershipViewState;
  readonly primaryTask: SecurityTaskKind;
  readonly protectedWrites: ProtectedWriteState;
  readonly canApproveOtherDevices: boolean;
  readonly canUseRecoveryKeyHere: boolean;
  readonly canOfferGroupRepair: boolean;
  readonly securityStateRevision: string;
}

function runtimeState(input: CryptoSecurityInputs): CryptoRuntimeViewState {
  if (input.runtimeStatus.errorCode === "CRYPTO_STARTING") return "starting";
  if (!input.runtimePresent || !input.runtimeStatus.available) return "unavailable";
  return "ready";
}

function trustState(input: CryptoSecurityInputs): CryptoDeviceTrustViewState {
  const trust = input.runtimeStatus.trustState;
  if (trust === "pending" || trust === "trusted" || trust === "revoked") return trust;
  return "unavailable";
}

function recoveryState(
  input: CryptoSecurityInputs,
  trust: CryptoDeviceTrustViewState,
): CryptoRecoveryViewState {
  if (!input.serverRecovery || !input.localRecovery) {
    if (input.serverRecovery?.configured === false && input.localRecovery) return "not_configured";
    return "unavailable";
  }
  if (!input.serverRecovery.configured) return "not_configured";
  if (
    input.localRecovery.configured &&
    input.localRecovery.recoveryKeyVersion === input.serverRecovery.recoveryKeyVersion
  ) {
    return "configured_here";
  }
  return trust === "pending" ? "pending_can_recover" : "configured_elsewhere";
}

function repairEligible(
  input: CryptoSecurityInputs,
  trust: CryptoDeviceTrustViewState,
  recovery: CryptoRecoveryViewState,
): boolean {
  const state = input.partnershipState;
  if (
    trust !== "trusted" ||
    recovery !== "configured_here" ||
    input.lifecycleState !== "active" ||
    input.interactionMode !== "normal" ||
    !state?.cryptoRequired ||
    !state.group ||
    !input.reconciliationComplete ||
    input.partnershipRefreshError ||
    !input.localGroup ||
    input.localGroup.available
  ) {
    return false;
  }

  const localVersion = input.localRecovery?.recoveryKeyVersion;
  return (
    localVersion !== null &&
    localVersion !== undefined &&
    state.recoveryRecipients.some(
      (recipient) =>
        recipient.accountId === state.devices.find(
          (device) => device.cryptoDeviceId === state.currentCryptoDeviceId,
        )?.accountId && recipient.recoveryKeyVersion === localVersion,
    )
  );
}

function partnershipState(
  input: CryptoSecurityInputs,
  trust: CryptoDeviceTrustViewState,
  canRepair: boolean,
): CryptoPartnershipViewState {
  if (!input.partnershipId) return "none";
  if (trust !== "trusted") return "unavailable";
  if (input.partnershipRefreshError || !input.partnershipState) return "unavailable";
  if (canRepair) return "repair_required";

  const state = input.partnershipState;
  if (!state.group) return "preparing";
  if (state.group.rekeyRequired) return "rekeying";
  if (state.cryptoRequired && state.recoveryRecipients.length < 2) {
    return "waiting_for_recovery";
  }
  return state.cryptoRequired ? "ready" : "preparing";
}

function primaryTask(
  input: CryptoSecurityInputs,
  runtime: CryptoRuntimeViewState,
  trust: CryptoDeviceTrustViewState,
  recovery: CryptoRecoveryViewState,
  partnership: CryptoPartnershipViewState,
): SecurityTaskKind {
  if (trust === "revoked") {
    return "session_invalid";
  }
  if (runtime === "unavailable") return "runtime_unavailable";
  if (runtime === "starting") return "none";
  if (trust === "pending") return "device_pending";
  if (recovery === "not_configured") return "recovery_not_configured";
  if (partnership === "waiting_for_recovery") return "partnership_waiting_for_recovery";
  if (partnership === "rekeying") return "rekeying";
  if (partnership === "repair_required") return "repair_required";
  return "none";
}

function writeState(
  input: CryptoSecurityInputs,
  runtime: CryptoRuntimeViewState,
  trust: CryptoDeviceTrustViewState,
  partnership: CryptoPartnershipViewState,
): ProtectedWriteState {
  if (trust === "revoked") {
    return "blocked_session";
  }
  if (runtime !== "ready") return "blocked_runtime";
  if (trust === "pending" || trust === "unavailable") return "blocked_device_pending";

  // Before S1 activation the existing product may still write through its pre-S1 authority.
  // UX8 must not broaden the runtime's block merely because recovery setup is incomplete.
  if (input.partnershipState && !input.partnershipState.cryptoRequired) return "allowed";

  if (partnership === "waiting_for_recovery") return "blocked_recovery_prerequisite";
  if (partnership === "rekeying") return "blocked_rekey";
  if (partnership === "repair_required") return "blocked_repair";
  if (partnership === "unavailable" && input.partnershipId) return "blocked_runtime";
  return "allowed";
}

export function deriveCryptoSecurityViewModel(
  input: CryptoSecurityInputs,
): CryptoSecurityViewModel {
  const runtime = runtimeState(input);
  const currentDeviceTrust = trustState(input);
  const recovery = recoveryState(input, currentDeviceTrust);
  const canOfferGroupRepair = repairEligible(input, currentDeviceTrust, recovery);
  const partnership = partnershipState(input, currentDeviceTrust, canOfferGroupRepair);
  const primary = primaryTask(input, runtime, currentDeviceTrust, recovery, partnership);

  return {
    runtime,
    currentDeviceTrust,
    recovery,
    partnership,
    primaryTask: primary,
    protectedWrites: writeState(input, runtime, currentDeviceTrust, partnership),
    canApproveOtherDevices:
      runtime === "ready" &&
      currentDeviceTrust === "trusted",
    canUseRecoveryKeyHere:
      runtime === "ready" &&
      currentDeviceTrust === "pending" &&
      input.serverRecovery?.configured === true,
    canOfferGroupRepair,
    securityStateRevision: input.revision,
  };
}
