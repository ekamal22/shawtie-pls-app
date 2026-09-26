import { base64UrlDecode, base64UrlEncode } from "./bytes.ts";
import { S1_CRYPTO_PROFILE, S1_MLS_CIPHERSUITE } from "./profile.ts";

export interface MlsTransition {
  readonly state: Uint8Array<ArrayBuffer>;
  readonly groupId: Uint8Array<ArrayBuffer>;
  readonly epoch: number;
  readonly controlMessage: Uint8Array<ArrayBuffer> | null;
  readonly welcome: Uint8Array<ArrayBuffer> | null;
  readonly applicationMessage: Uint8Array<ArrayBuffer> | null;
}

export interface HpkeRecoveryKeyPair {
  readonly privateKey: Uint8Array<ArrayBuffer>;
  readonly publicKey: Uint8Array<ArrayBuffer>;
}

export interface HpkeCiphertext {
  readonly encapsulation: Uint8Array<ArrayBuffer>;
  readonly ciphertext: Uint8Array<ArrayBuffer>;
}

export interface MlsEngine {
  readonly cryptoProfile: typeof S1_CRYPTO_PROFILE;
  readonly ciphersuite: typeof S1_MLS_CIPHERSUITE;
  readonly cryptoDeviceId: string;
  readonly mlsSigningPublicKey: Uint8Array<ArrayBuffer>;
  readonly contentSigningPublicKey: Uint8Array<ArrayBuffer>;

  exportState(): Uint8Array<ArrayBuffer>;
  keyPackage(): Uint8Array<ArrayBuffer>;
  createGroup(groupId: Uint8Array): MlsTransition;
  addMember(groupId: Uint8Array, keyPackage: Uint8Array): MlsTransition;
  removeMember(groupId: Uint8Array, leafIndex: number): MlsTransition;
  joinWelcome(welcome: Uint8Array): MlsTransition;
  memberLeafIndex(groupId: Uint8Array, cryptoDeviceId: string): number | null;
  createApplicationMessage(groupId: Uint8Array, plaintext: Uint8Array): MlsTransition;
  processMessage(groupId: Uint8Array, message: Uint8Array): MlsTransition;
  signContent(payload: Uint8Array): Uint8Array<ArrayBuffer>;
  verifyContent(
    publicKey: Uint8Array,
    payload: Uint8Array,
    signature: Uint8Array,
  ): boolean;
  deriveRecoveryKeyPair(ikm: Uint8Array): HpkeRecoveryKeyPair;
  hpkeSeal(
    publicKey: Uint8Array,
    info: Uint8Array,
    aad: Uint8Array,
    plaintext: Uint8Array,
  ): HpkeCiphertext;
  hpkeOpen(
    privateKey: Uint8Array,
    info: Uint8Array,
    aad: Uint8Array,
    ciphertext: HpkeCiphertext,
  ): Uint8Array<ArrayBuffer>;
}

interface WasmBytes {
  readonly length: number;
  readonly [index: number]: number;
}

interface WasmTransition {
  state(): WasmBytes;
  group_id(): WasmBytes;
  epoch(): bigint | number;
  control_message(): WasmBytes | undefined;
  welcome(): WasmBytes | undefined;
  application_message(): WasmBytes | undefined;
}

interface WasmHpkeKeyPair {
  private_key(): WasmBytes;
  public_key(): WasmBytes;
}

interface WasmHpkeCiphertext {
  encapsulation(): WasmBytes;
  ciphertext(): WasmBytes;
}

interface WasmClient {
  crypto_device_id(): string;
  mls_signing_public_key(): WasmBytes;
  content_signing_public_key(): WasmBytes;
  export_state(): WasmBytes;
  key_package(): WasmBytes;
  create_group(groupId: Uint8Array): WasmTransition;
  add_member(groupId: Uint8Array, keyPackage: Uint8Array): WasmTransition;
  remove_member(groupId: Uint8Array, leafIndex: number): WasmTransition;
  join_welcome(welcome: Uint8Array): WasmTransition;
  member_leaf_index(groupId: Uint8Array, cryptoDeviceId: string): number | undefined;
  create_application_message(groupId: Uint8Array, plaintext: Uint8Array): WasmTransition;
  process_message(groupId: Uint8Array, message: Uint8Array): WasmTransition;
  sign_content(payload: Uint8Array): WasmBytes;
  verify_content(publicKey: Uint8Array, payload: Uint8Array, signature: Uint8Array): boolean;
  derive_recovery_key_pair(ikm: Uint8Array): WasmHpkeKeyPair;
  hpke_seal(
    publicKey: Uint8Array,
    info: Uint8Array,
    aad: Uint8Array,
    plaintext: Uint8Array,
  ): WasmHpkeCiphertext;
  hpke_open(
    privateKey: Uint8Array,
    info: Uint8Array,
    aad: Uint8Array,
    encapsulation: Uint8Array,
    ciphertext: Uint8Array,
  ): WasmBytes;
}

export interface OpenMlsWasmModule {
  readonly ShawtieMlsClient: {
    new (cryptoDeviceId: string): WasmClient;
    import_state(state: Uint8Array): WasmClient;
  };
}

function copy(value: WasmBytes | undefined): Uint8Array<ArrayBuffer> | null {
  if (!value) return null;
  const output = new Uint8Array(new ArrayBuffer(value.length));
  for (let index = 0; index < value.length; index += 1) {
    output[index] = value[index] ?? 0;
  }
  return output;
}

function transition(value: WasmTransition): MlsTransition {
  const state = copy(value.state());
  const groupId = copy(value.group_id());
  if (!state || !groupId) throw new Error("OpenMLS binding returned an incomplete transition");
  const epoch = Number(value.epoch());
  if (!Number.isSafeInteger(epoch) || epoch < 0) throw new Error("Invalid MLS epoch");
  return {
    state,
    groupId,
    epoch,
    controlMessage: copy(value.control_message()),
    welcome: copy(value.welcome()),
    applicationMessage: copy(value.application_message()),
  };
}

class WasmMlsEngine implements MlsEngine {
  readonly cryptoProfile = S1_CRYPTO_PROFILE;
  readonly ciphersuite = S1_MLS_CIPHERSUITE;
  readonly #client: WasmClient;

  constructor(client: WasmClient) {
    this.#client = client;
  }

  get cryptoDeviceId(): string {
    return this.#client.crypto_device_id();
  }

  get mlsSigningPublicKey(): Uint8Array<ArrayBuffer> {
    const value = copy(this.#client.mls_signing_public_key());
    if (!value) throw new Error("Missing MLS public key");
    return value;
  }

  get contentSigningPublicKey(): Uint8Array<ArrayBuffer> {
    const value = copy(this.#client.content_signing_public_key());
    if (!value) throw new Error("Missing content signing key");
    return value;
  }

  exportState(): Uint8Array<ArrayBuffer> {
    const value = copy(this.#client.export_state());
    if (!value) throw new Error("Missing MLS state");
    return value;
  }

  keyPackage(): Uint8Array<ArrayBuffer> {
    const value = copy(this.#client.key_package());
    if (!value) throw new Error("Missing KeyPackage");
    return value;
  }

  createGroup(groupId: Uint8Array): MlsTransition {
    return transition(this.#client.create_group(groupId));
  }

  addMember(groupId: Uint8Array, keyPackage: Uint8Array): MlsTransition {
    return transition(this.#client.add_member(groupId, keyPackage));
  }

  removeMember(groupId: Uint8Array, leafIndex: number): MlsTransition {
    return transition(this.#client.remove_member(groupId, leafIndex));
  }

  joinWelcome(welcome: Uint8Array): MlsTransition {
    return transition(this.#client.join_welcome(welcome));
  }

  memberLeafIndex(groupId: Uint8Array, cryptoDeviceId: string): number | null {
    const value = this.#client.member_leaf_index(groupId, cryptoDeviceId);
    return value === undefined ? null : value;
  }

  createApplicationMessage(groupId: Uint8Array, plaintext: Uint8Array): MlsTransition {
    return transition(this.#client.create_application_message(groupId, plaintext));
  }

  processMessage(groupId: Uint8Array, message: Uint8Array): MlsTransition {
    return transition(this.#client.process_message(groupId, message));
  }

  signContent(payload: Uint8Array): Uint8Array<ArrayBuffer> {
    const value = copy(this.#client.sign_content(payload));
    if (!value) throw new Error("Missing content signature");
    return value;
  }

  verifyContent(publicKey: Uint8Array, payload: Uint8Array, signature: Uint8Array): boolean {
    return this.#client.verify_content(publicKey, payload, signature);
  }

  deriveRecoveryKeyPair(ikm: Uint8Array): HpkeRecoveryKeyPair {
    const value = this.#client.derive_recovery_key_pair(ikm);
    const privateKey = copy(value.private_key());
    const publicKey = copy(value.public_key());
    if (!privateKey || !publicKey) throw new Error("Invalid recovery key pair");
    return { privateKey, publicKey };
  }

  hpkeSeal(
    publicKey: Uint8Array,
    info: Uint8Array,
    aad: Uint8Array,
    plaintext: Uint8Array,
  ): HpkeCiphertext {
    const value = this.#client.hpke_seal(publicKey, info, aad, plaintext);
    const encapsulation = copy(value.encapsulation());
    const ciphertext = copy(value.ciphertext());
    if (!encapsulation || !ciphertext) throw new Error("Invalid HPKE ciphertext");
    return { encapsulation, ciphertext };
  }

  hpkeOpen(
    privateKey: Uint8Array,
    info: Uint8Array,
    aad: Uint8Array,
    ciphertext: HpkeCiphertext,
  ): Uint8Array<ArrayBuffer> {
    const value = copy(
      this.#client.hpke_open(
        privateKey,
        info,
        aad,
        ciphertext.encapsulation,
        ciphertext.ciphertext,
      ),
    );
    if (!value) throw new Error("Invalid HPKE plaintext");
    return value;
  }
}

export function createMlsEngine(module: OpenMlsWasmModule, cryptoDeviceId: string): MlsEngine {
  return new WasmMlsEngine(new module.ShawtieMlsClient(cryptoDeviceId));
}

export function restoreMlsEngine(module: OpenMlsWasmModule, state: Uint8Array): MlsEngine {
  return new WasmMlsEngine(module.ShawtieMlsClient.import_state(state));
}

export function encodeBinary(value: Uint8Array): string {
  return base64UrlEncode(value);
}

export function decodeBinary(value: string): Uint8Array<ArrayBuffer> {
  return base64UrlDecode(value);
}
