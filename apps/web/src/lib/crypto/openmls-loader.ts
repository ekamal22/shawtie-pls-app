import type { OpenMlsWasmModule } from "@shawtie/crypto";

interface ViteCryptoEnv {
  readonly VITE_S1_OPENMLS_MODULE?: string;
}

type GeneratedOpenMlsModule = OpenMlsWasmModule & {
  readonly default?: (input?: unknown) => Promise<unknown> | unknown;
};

let modulePromise: Promise<OpenMlsWasmModule> | null = null;

function configuredModuleUrl(): string {
  const env = ((import.meta as ImportMeta & { readonly env?: ViteCryptoEnv }).env ??
    {}) as ViteCryptoEnv;
  return env.VITE_S1_OPENMLS_MODULE ?? "/crypto/openmls/shawtie_openmls_wasm.js";
}

async function loadGeneratedModule(): Promise<OpenMlsWasmModule> {
  const url = configuredModuleUrl();
  let loaded: GeneratedOpenMlsModule;
  try {
    loaded = (await import(/* @vite-ignore */ url)) as GeneratedOpenMlsModule;
  } catch {
    throw new Error("CRYPTO_WASM_UNAVAILABLE");
  }

  if (typeof loaded.default === "function") {
    await loaded.default();
  }
  if (!loaded.ShawtieMlsClient) {
    throw new Error("CRYPTO_WASM_INVALID");
  }
  return loaded;
}

export function loadOpenMlsModule(): Promise<OpenMlsWasmModule> {
  modulePromise ??= loadGeneratedModule();
  return modulePromise;
}

export function resetOpenMlsModuleForTests(): void {
  modulePromise = null;
}
