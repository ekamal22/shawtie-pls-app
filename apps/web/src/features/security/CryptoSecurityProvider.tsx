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
  readonly interactionMode:
    | "normal"
    | "breakup_restricted"
    | "account_deletion_view_only"
    | null;
  readonly cryptoRequiredHint: boolean;
  readonly children: ReactNode;
}) {
  const { runtime, status, retry: retryRuntime } = useS1CryptoRuntime();
  const requestGeneration = useRef(0);
  const revisionCounter = useRef(0);
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

  const refresh = useCallback(async () => {
    const ticket = ++requestGeneration.current;
    const revision = String(++revisionCounter.current);
    const currentRuntime = runtime;

    if (!currentRuntime) {
      if (ticket !== requestGeneration.current) return;
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
      return;
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
            ticket === requestGeneration.current
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

    if (ticket !== requestGeneration.current) return;

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
  }, [runtime, status, partnershipId, lifecycleState, interactionMode]);

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

  const refreshAfterAction = useCallback(
    async (capturedPartnershipScope: string) => {
      if (capturedPartnershipScope !== partnershipScopeRef.current) return;
      await refresh();
    },
    [refresh],
  );

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
        const capturedAccountScope = accountScopeRef.current;
        const capturedPartnershipScope = partnershipScopeRef.current;
        await runtime.approveDevice(cryptoDeviceId);
        if (capturedAccountScope !== accountScopeRef.current) return;
        await refreshAfterAction(capturedPartnershipScope);
      },
      setupRecovery: async () => {
        if (!runtime) throw new Error("CRYPTO_UNAVAILABLE");
        const capturedAccountScope = accountScopeRef.current;
        const capturedPartnershipScope = partnershipScopeRef.current;
        const result = await runtime.setupRecovery();
        if (capturedAccountScope === accountScopeRef.current) {
          await refreshAfterAction(capturedPartnershipScope);
        }
        return result;
      },
      recoverWithMasterSecret: async (secret) => {
        if (!runtime) throw new Error("CRYPTO_UNAVAILABLE");
        const capturedAccountScope = accountScopeRef.current;
        const capturedPartnershipScope = partnershipScopeRef.current;
        await runtime.recoverWithMasterSecret(secret);
        if (capturedAccountScope !== accountScopeRef.current) return;
        await refreshAfterAction(capturedPartnershipScope);
      },
      repairPartnership: async () => {
        const capturedPartnershipScope = partnershipScopeRef.current;
        if (
          !runtime ||
          !partnershipId ||
          lifecycleState !== "active" ||
          interactionMode !== "normal"
        ) {
          throw new Error("CRYPTO_GROUP_RESET_REQUIRED");
        }

        // Re-evaluate the destructive predicate from current authority immediately before reset.
        // A cached model is never enough to authorize repair.
        const [authoritative, localRecovery, localGroup] = await Promise.all([
          runtime.partnershipState(partnershipId),
          runtime.localRecoveryStatus(),
          runtime.localGroupStatus(partnershipId),
        ]);
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

        if (capturedPartnershipScope !== partnershipScopeRef.current) {
          throw new Error("CRYPTO_GROUP_RESET_REQUIRED");
        }
        await runtime.resetPartnershipGroup(partnershipId);
        await refreshAfterAction(capturedPartnershipScope);
      },
    }),
    [
      runtime,
      status.errorCode,
      retryRuntime,
      refresh,
      refreshAfterAction,
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
