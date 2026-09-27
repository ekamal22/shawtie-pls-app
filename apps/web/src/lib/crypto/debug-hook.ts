/*
 * S1 has no UX8 device/recovery management screen yet. Physical Android acceptance still
 * needs to exercise the real production runtime (recovery setup, device approval, recovery
 * restoration, group reset) end to end on the device, so this narrow debug surface exists
 * strictly for that purpose. It is only ever imported from a branch a production build
 * cannot reach; see `runtime-context.tsx` and `scripts/security/s1-production-scan.mjs`.
 */
import type { S1CryptoRuntime } from "./crypto-runtime.ts";

declare global {
  interface Window {
    __s1Debug?: {
      readonly runtime: () => S1CryptoRuntime | null;
    };
  }
}

export function installS1DebugHook(runtime: () => S1CryptoRuntime | null): void {
  window.__s1Debug = { runtime };
}
