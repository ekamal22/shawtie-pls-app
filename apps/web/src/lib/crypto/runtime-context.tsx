import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { S1CryptoRuntime, type S1RuntimeStatus } from "./crypto-runtime.ts";

interface S1CryptoContextValue {
  readonly runtime: S1CryptoRuntime | null;
  readonly status: S1RuntimeStatus;
  readonly retry: () => void;
}

const UNAVAILABLE: S1RuntimeStatus = {
  available: false,
  cryptoDeviceId: null,
  trustState: null,
  errorCode: null,
};

const S1CryptoContext = createContext<S1CryptoContextValue>({
  runtime: null,
  status: UNAVAILABLE,
  retry: () => undefined,
});

export function S1CryptoRuntimeProvider({
  accountId,
  deviceId,
  children,
}: {
  readonly accountId: string;
  readonly deviceId: string | null;
  readonly children: ReactNode;
}) {
  const [runtime, setRuntime] = useState<S1CryptoRuntime | null>(null);
  const [status, setStatus] = useState<S1RuntimeStatus>(
    deviceId ? { ...UNAVAILABLE, errorCode: "CRYPTO_STARTING" } : UNAVAILABLE,
  );
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let disposed = false;
    let active: S1CryptoRuntime | null = null;

    if (!deviceId) {
      setRuntime(null);
      setStatus({ ...UNAVAILABLE, errorCode: "CRYPTO_DEVICE_UNAVAILABLE" });
      return;
    }

    setStatus({ ...UNAVAILABLE, errorCode: "CRYPTO_STARTING" });
    void S1CryptoRuntime.start(accountId, deviceId)
      .then((created) => {
        if (disposed) {
          created.close();
          return;
        }
        active = created;
        setRuntime(created);
        setStatus(created.status());
      })
      .catch((error: unknown) => {
        if (disposed) return;
        setRuntime(null);
        setStatus({
          available: false,
          cryptoDeviceId: null,
          trustState: null,
          errorCode: error instanceof Error ? error.message : "CRYPTO_UNAVAILABLE",
        });
      });

    return () => {
      disposed = true;
      active?.close();
    };
  }, [accountId, deviceId, generation]);

  useEffect(() => {
    if (!runtime) return;
    const purge = (event: Event) => {
      const partnershipId = (
        event as CustomEvent<{ partnershipId?: string }>
      ).detail?.partnershipId;
      if (!partnershipId) return;
      void runtime.purgePartnership(partnershipId);
    };
    window.addEventListener("shawtie:crypto-namespace-revoked", purge);
    return () => {
      window.removeEventListener("shawtie:crypto-namespace-revoked", purge);
    };
  }, [runtime]);

  const value = useMemo<S1CryptoContextValue>(
    () => ({
      runtime,
      status,
      retry: () => setGeneration((current) => current + 1),
    }),
    [runtime, status],
  );

  return <S1CryptoContext.Provider value={value}>{children}</S1CryptoContext.Provider>;
}

export function useS1CryptoRuntime(): S1CryptoContextValue {
  return useContext(S1CryptoContext);
}
