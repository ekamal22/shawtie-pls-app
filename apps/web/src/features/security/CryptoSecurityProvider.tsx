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
  children,
}: {
  readonly partnershipId: string | null;
  readonly lifecycleState: "active" | "breakup_pending" | null;
  readonly interactionMode:
    | "normal"
    | "breakup_restricted"
    | "account_deletion_view_only"
    | null;
  readonly children: ReactNode;
}) {
  const { runtime, status, retry: retryRuntime } = useS1CryptoRuntime();
  const requestGeneration = useRef(0);
  const revisionCounter = useRef(0);
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

  const refreshAfterAction = useCallback(async () => {
    window.dispatchEvent(new CustomEvent("shawtie:ux8-security-changed"));
    await refresh();
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
        await runtime.approveDevice(cryptoDeviceId);
        await refreshAfterAction();
      },
      setupRecovery: async () => {
        if (!runtime) throw new Error("CRYPTO_UNAVAILABLE");
        const result = await runtime.setupRecovery();
        await refreshAfterAction();
        return result;
      },
      recoverWithMasterSecret: async (secret) => {
        if (!runtime) throw new Error("CRYPTO_UNAVAILABLE");
        await runtime.recoverWithMasterSecret(secret);
        await refreshAfterAction();
      },
      repairPartnership: async () => {
        if (!runtime || !partnershipId) throw new Error("CRYPTO_GROUP_RESET_REQUIRED");
        if (!state.model.canOfferGroupRepair) throw new Error("CRYPTO_GROUP_RESET_REQUIRED");
        await refresh();
        if (!state.model.canOfferGroupRepair) throw new Error("CRYPTO_GROUP_RESET_REQUIRED");
        await runtime.resetPartnershipGroup(partnershipId);
        await refreshAfterAction();
      },
    }),
    [
      runtime,
      status.errorCode,
      retryRuntime,
      refresh,
      refreshAfterAction,
      partnershipId,
      state.model.canOfferGroupRepair,
    ],
  );

  const value = useMemo<CryptoSecurityContextValue>(
    () => ({
      ...state,
      ...actions,
      partnershipId,
      partnershipCryptoRequired: state.partnershipState?.cryptoRequired ?? false,
    }),
    [state, actions, partnershipId],
  );

  return <CryptoSecurityContext.Provider value={value}>{children}</CryptoSecurityContext.Provider>;
}

export function useCryptoSecurity(): CryptoSecurityContextValue {
  const value = useContext(CryptoSecurityContext);
  if (!value) throw new Error("CryptoSecurityProvider is missing");
  return value;
}
