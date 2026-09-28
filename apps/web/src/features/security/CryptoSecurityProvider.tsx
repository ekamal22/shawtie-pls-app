import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ApiClientError } from "../../lib/api-client.ts";
import {
  loadCryptoPartnershipState,
  loadCryptoRecoveryBundle,
  type CryptoDeviceProjection,
  type CryptoPartnershipState,
} from "../../lib/crypto/crypto-api.ts";
import { useS1CryptoRuntime } from "../../lib/crypto/runtime-context.tsx";
import {
  deriveCryptoSecurityViewModel,
  type CryptoSecurityViewModel,
  type LocalGroupStatus,
  type LocalRecoveryStatus,
} from "./crypto-security-model.ts";
import {
  assertSecurityAuthorityCurrent,
  isCurrentSecurityRefresh,
  runScopedSecurityMutation,
  type SecurityAuthoritySnapshot,
} from "./security-authority.ts";

interface RecoveryServerState {
  readonly configured: boolean;
  readonly recoveryKeyVersion: number | null;
}

interface CryptoSecurityState {
  readonly model: CryptoSecurityViewModel;
  readonly devices: readonly CryptoDeviceProjection[];
  readonly partnershipState: CryptoPartnershipState | null;
  readonly localRecovery: LocalRecoveryStatus | null;
  readonly serverRecovery: RecoveryServerState | null;
  readonly localGroup: LocalGroupStatus | null;
  readonly refreshError: string | null;
  readonly refreshing: boolean;
}

interface CryptoSecurityActions {
  readonly refresh: () => Promise<void>;
  readonly approveDevice: (cryptoDeviceId: string) => Promise<void>;
  readonly setupRecovery: () => Promise<{
    readonly recoveryMasterSecret: string;
    readonly recoveryKeyVersion: number;
  }>;
  readonly recoverWithMasterSecret: (secret: string) => Promise<void>;
  readonly repairPartnership: () => Promise<void>;
}

export interface CryptoSecurityContextValue extends CryptoSecurityState, CryptoSecurityActions {
  readonly partnershipId: string | null;
  readonly partnershipCryptoRequired: boolean;
}

const EMPTY_MODEL = deriveCryptoSecurityViewModel({
  runtimePresent: false,
  runtimeStatus: {
    available: false,
    cryptoDeviceId: null,
    trustState: null,
    errorCode: "CRYPTO_STARTING",
  },
  serverRecovery: null,
  localRecovery: null,
  partnershipId: null,
  lifecycleState: null,
  interactionMode: null,
  partnershipState: null,
  localGroup: null,
  partnershipRefreshError: null,
  reconciliationComplete: false,
  revision: "initial",
});

const CryptoSecurityContext = createContext<CryptoSecurityContextValue | null>(null);

export function CryptoSecurityProvider({
  partnershipId,
  lifecycleState,
  interactionMode,
  cryptoRequiredHint,
  children,
}: {
  readonly partnershipId: string | null;
  readonly lifecycleState: "active" | "breakup_pending" | null;
  readonly interactionMode: "normal" | "breakup_restricted" | "account_deletion_view_only" | null;
  readonly cryptoRequiredHint: boolean;
  readonly children: ReactNode;
}) {
  const { runtime, status, retry: retryRuntime } = useS1CryptoRuntime();
  const requestGeneration = useRef(0);
  const revisionCounter = useRef(0);
  const activeRef = useRef(true);
  const accountScopeRef = useRef("");
  const partnershipScopeRef = useRef("");
  const accountScope = runtime
    ? [runtime.accountId, runtime.deviceId, runtime.currentDevice().cryptoDeviceId].join(":")
    : "runtime-unavailable";
  const partnershipScope = [
    accountScope,
    partnershipId ?? "none",
    lifecycleState ?? "none",
    interactionMode ?? "none",
  ].join(":");
  accountScopeRef.current = accountScope;
  partnershipScopeRef.current = partnershipScope;
  const [state, setState] = useState<CryptoSecurityState>({
    model: EMPTY_MODEL,
    devices: [],
    partnershipState: null,
    localRecovery: null,
    serverRecovery: null,
    localGroup: null,
    refreshError: null,
    refreshing: true,
  });

  const currentAuthority = useCallback(
    (): SecurityAuthoritySnapshot => ({
      active: activeRef.current,
      accountScope: accountScopeRef.current,
      partnershipScope: partnershipScopeRef.current,
      revision: revisionCounter.current,
    }),
    [],
  );

  const refresh = useCallback(async (): Promise<boolean> => {
    const ticket = ++requestGeneration.current;
    const revision = String(++revisionCounter.current);
    const currentRuntime = runtime;

    if (!currentRuntime) {
      if (!isCurrentSecurityRefresh(ticket, requestGeneration.current, activeRef.current)) {
        return false;
      }
      setState({
        model: deriveCryptoSecurityViewModel({
          runtimePresent: false,
          runtimeStatus: status,
          serverRecovery: null,
          localRecovery: null,
          partnershipId,
          lifecycleState,
          interactionMode,
          partnershipState: null,
          localGroup: null,
          partnershipRefreshError: status.errorCode,
          reconciliationComplete: false,
          revision,
        }),
        devices: [],
        partnershipState: null,
        localRecovery: null,
        serverRecovery: null,
        localGroup: null,
        refreshError: status.errorCode,
        refreshing: status.errorCode === "CRYPTO_STARTING",
      });
      return true;
    }

    setState((previous) => ({ ...previous, refreshing: true }));

    let serverRecovery: RecoveryServerState | null = null;
    let localRecovery: LocalRecoveryStatus | null = null;
    let devices: readonly CryptoDeviceProjection[] = [];
    let partnershipState: CryptoPartnershipState | null = null;
    let localGroup: LocalGroupStatus | null = null;
    let refreshError: string | null = null;

    try {
      await currentRuntime.refreshDevice();
      const [deviceRows, recoveryLocal, recoveryServer] = await Promise.all([
        currentRuntime.devices(),
        currentRuntime.localRecoveryStatus(),
        loadCryptoRecoveryBundle()
          .then((bundle) => ({
            configured: true as const,
            recoveryKeyVersion: bundle.recoveryKeyVersion,
          }))
          .catch((error: unknown) => {
            if (error instanceof ApiClientError && error.code === "CRYPTO_RECOVERY_UNAVAILABLE") {
              return { configured: false as const, recoveryKeyVersion: null };
            }
            throw error;
          }),
      ]);
      devices = deviceRows;
      localRecovery = recoveryLocal;
      serverRecovery = recoveryServer;

      if (partnershipId && currentRuntime.status().trustState === "trusted") {
        try {
          const authoritativeBeforeReconcile = await loadCryptoPartnershipState(partnershipId);
          localGroup = await currentRuntime.localGroupStatus(partnershipId);

          // Preserve the real server rekey state long enough for the user-facing model to
          // observe it before S1 performs its normal automatic membership reconciliation.
          if (
            authoritativeBeforeReconcile.group?.rekeyRequired &&
            isCurrentSecurityRefresh(ticket, requestGeneration.current, activeRef.current)
          ) {
            const interimModel = deriveCryptoSecurityViewModel({
              runtimePresent: true,
              runtimeStatus: currentRuntime.status(),
              serverRecovery:
                serverRecovery?.configured === true
                  ? {
                      configured: true,
                      recoveryKeyVersion: serverRecovery.recoveryKeyVersion ?? 0,
                    }
                  : serverRecovery?.configured === false
                    ? { configured: false }
                    : null,
              localRecovery,
              partnershipId,
              lifecycleState,
              interactionMode,
              partnershipState: authoritativeBeforeReconcile,
              localGroup,
              partnershipRefreshError: null,
              reconciliationComplete: false,
              revision: revision + ":rekey",
            });
            setState({
              model: interimModel,
              devices,
              partnershipState: authoritativeBeforeReconcile,
              localRecovery,
              serverRecovery,
              localGroup,
              refreshError: null,
              refreshing: true,
            });
          }

          partnershipState = await currentRuntime.partnershipState(partnershipId);
          localGroup = await currentRuntime.localGroupStatus(partnershipId);

          // A single reconciliation pass can land only part of a pending join (for example,
          // right after RMS recovery trusts this device but an MLS membership commit is
          // still in-flight elsewhere). Retry a bounded number of times, spaced out, before
          // concluding the local group is genuinely unusable: this is a delayed-but-recoverable
          // join, not a repair condition, and premature repair_required classification would
          // surface a destructive action for an ordinary transient reconciliation gap. Running
          // out of retries with the group still unavailable genuinely reflects the current
          // authoritative state.
          for (
            let attempt = 0;
            !localGroup.available &&
            attempt < 6 &&
            isCurrentSecurityRefresh(ticket, requestGeneration.current, activeRef.current);
            attempt += 1
          ) {
            await new Promise((resolve) => setTimeout(resolve, 800));
            if (!isCurrentSecurityRefresh(ticket, requestGeneration.current, activeRef.current)) break;
            partnershipState = await currentRuntime.partnershipState(partnershipId);
            localGroup = await currentRuntime.localGroupStatus(partnershipId);
          }
        } catch (error) {
          refreshError = error instanceof Error ? error.message : "CRYPTO_UNAVAILABLE";
          localGroup = await currentRuntime.localGroupStatus(partnershipId).catch(() => null);
        }
      }
    } catch (error) {
      refreshError = error instanceof Error ? error.message : "CRYPTO_UNAVAILABLE";
      localRecovery = await currentRuntime.localRecoveryStatus().catch(() => null);
      devices = await currentRuntime.devices().catch(() => []);
    }

    if (!isCurrentSecurityRefresh(ticket, requestGeneration.current, activeRef.current)) {
      return false;
    }

    const latestStatus = currentRuntime.status();
    const model = deriveCryptoSecurityViewModel({
      runtimePresent: true,
      runtimeStatus: latestStatus,
      serverRecovery:
        serverRecovery === null
          ? null
          : serverRecovery.configured
            ? {
                configured: true,
                recoveryKeyVersion: serverRecovery.recoveryKeyVersion ?? 0,
              }
            : { configured: false },
      localRecovery,
      partnershipId,
      lifecycleState,
      interactionMode,
      partnershipState,
      localGroup,
      partnershipRefreshError: refreshError,
      reconciliationComplete:
        !partnershipId ||
        latestStatus.trustState !== "trusted" ||
        (partnershipState !== null && refreshError === null),
      revision,
    });

    setState({
      model,
      devices,
      partnershipState,
      localRecovery,
      serverRecovery,
      localGroup,
      refreshError,
      refreshing: false,
    });
    return true;
  }, [runtime, status, partnershipId, lifecycleState, interactionMode]);

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      requestGeneration.current += 1;
    };
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const refreshFromSignal = () => void refresh();
    const onVisibility = () => {
      if (document.visibilityState === "visible") refreshFromSignal();
    };
    const events = [
      "shawtie:security-changed",
      "shawtie:partnership-changed",
      "online",
      "focus",
    ] as const;
    for (const event of events) window.addEventListener(event, refreshFromSignal);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      for (const event of events) window.removeEventListener(event, refreshFromSignal);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  const actions = useMemo<CryptoSecurityActions>(
    () => ({
      refresh: async () => {
        if (!runtime && status.errorCode && status.errorCode !== "CRYPTO_STARTING") {
          retryRuntime();
          return;
        }
        await refresh();
      },
      approveDevice: async (cryptoDeviceId) => {
        if (!runtime) throw new Error("CRYPTO_UNAVAILABLE");
        const captured = currentAuthority();
        await runScopedSecurityMutation({
          captured,
          current: currentAuthority,
          mutate: () => runtime.approveDevice(cryptoDeviceId),
          reconcile: refresh,
          resultIsCurrent: () => runtime.status().trustState === "trusted",
        });
      },
      setupRecovery: async () => {
        if (!runtime) throw new Error("CRYPTO_UNAVAILABLE");
        const captured = currentAuthority();
        return runScopedSecurityMutation({
          captured,
          current: currentAuthority,
          mutate: () => runtime.setupRecovery(),
          reconcile: refresh,
          resultIsCurrent: () => runtime.status().trustState === "trusted",
        });
      },
      recoverWithMasterSecret: async (secret) => {
        if (!runtime) throw new Error("CRYPTO_UNAVAILABLE");
        const captured = currentAuthority();
        await runScopedSecurityMutation({
          captured,
          current: currentAuthority,
          mutate: () => runtime.recoverWithMasterSecret(secret),
          reconcile: refresh,
          resultIsCurrent: () => runtime.status().trustState === "trusted",
        });
      },
      repairPartnership: async () => {
        if (
          !runtime ||
          !partnershipId ||
          lifecycleState !== "active" ||
          interactionMode !== "normal"
        ) {
          throw new Error("CRYPTO_GROUP_RESET_REQUIRED");
        }
        const captured = currentAuthority();

        await runScopedSecurityMutation({
          captured,
          current: currentAuthority,
          mutate: async () => {
            // Re-evaluate the destructive predicate from current authority immediately before
            // reset. A cached model is never enough to authorize repair.
            const [authoritative, localRecovery, localGroup] = await Promise.all([
              runtime.partnershipState(partnershipId),
              runtime.localRecoveryStatus(),
              runtime.localGroupStatus(partnershipId),
            ]);
            assertSecurityAuthorityCurrent(captured, currentAuthority());
            const currentAccountId = runtime.accountId;
            const matchingRecovery = authoritative.recoveryRecipients.some(
              (recipient) =>
                recipient.accountId === currentAccountId &&
                localRecovery.recoveryKeyVersion !== null &&
                recipient.recoveryKeyVersion === localRecovery.recoveryKeyVersion,
            );
            if (
              runtime.status().trustState !== "trusted" ||
              !authoritative.cryptoRequired ||
              !authoritative.group ||
              !localRecovery.configured ||
              !matchingRecovery ||
              localGroup.available
            ) {
              throw new Error("CRYPTO_GROUP_RESET_REQUIRED");
            }
            return runtime.resetPartnershipGroup(partnershipId);
          },
          reconcile: refresh,
          resultIsCurrent: () => runtime.status().trustState === "trusted",
        });
      },
    }),
    [
      runtime,
      status.errorCode,
      retryRuntime,
      refresh,
      currentAuthority,
      partnershipId,
      lifecycleState,
      interactionMode,
    ],
  );

  const value = useMemo<CryptoSecurityContextValue>(
    () => ({
      ...state,
      ...actions,
      partnershipId,
      partnershipCryptoRequired: state.partnershipState?.cryptoRequired ?? cryptoRequiredHint,
    }),
    [state, actions, partnershipId, cryptoRequiredHint],
  );

  return <CryptoSecurityContext.Provider value={value}>{children}</CryptoSecurityContext.Provider>;
}

export function useCryptoSecurity(): CryptoSecurityContextValue {
  const value = useContext(CryptoSecurityContext);
  if (!value) throw new Error("CryptoSecurityProvider is missing");
  return value;
}
