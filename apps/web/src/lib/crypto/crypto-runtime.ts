import { cryptoResetProofText } from "@shawtie/contracts";
import type {
  EncryptedProtectedContentInput,
  EncryptedProtectedContentProjection,
  ProtectedContentEnvelopeInput,
} from "@shawtie/contracts";
import {
  S1_CRYPTO_PROFILE,
  S1_MLS_CIPHERSUITE,
  base64UrlDecode,
  base64UrlEncode,
  canonicalBytes,
  contentSignatureInput,
  createMlsEngine,
  decodeRecoveryMasterSecret,
  decryptBytes,
  decryptRecoveryBundle,
  encodeRecoveryMasterSecret,
  encryptBytes,
  encryptRecoveryBundle,
  envelopeContext,
  generateRecoveryMasterSecret,
  restoreMlsEngine,
  sha256,
  utf8,
  utf8Decode,
  withCryptoLock,
  CryptoLocalVault,
  type EncryptedRecoveryBundle,
  type EnvelopeContext,
  type MlsEngine,
  type OpenMlsWasmModule,
  type ProtectedContentType,
  type ProtectedPayloadRole,
  type StoredGroupState,
  type StoredRecoveryState,
} from "@shawtie/crypto";
import { ApiClientError, ApiNetworkError } from "../api-client.ts";
import {
  approveCryptoDevice,
  bootstrapCryptoPartnership,
  commitCryptoPartnership,
  createCryptoRecoveryChallenge,
  enrollCryptoDevice,
  listCryptoDevices,
  loadCryptoControls,
  loadCryptoPartnershipState,
  loadCryptoRecoveryBundle,
  loadCurrentCryptoDevice,
  proveCryptoRecovery,
  setupCryptoRecovery,
  type CryptoDeviceProjection,
  type CryptoPartnershipState,
} from "./crypto-api.ts";
import { loadOpenMlsModule } from "./openmls-loader.ts";

const INITIAL_KEY_PACKAGE_COUNT = 5;
const CONTROL_PAGE_SIZE = 100;
const RECOVERY_BUNDLE_VERSION = 1;

interface RecoveryBundlePlaintext {
  readonly version: 1;
  readonly cryptoProfile: typeof S1_CRYPTO_PROFILE;
  readonly recoveryKeyVersion: number;
  readonly recoveryHpkePrivateKey: string;
  readonly recoveryHpkePublicKey: string;
  readonly recoveryAuthPrivateKeyPkcs8: string;
  readonly recoveryAuthPublicKey: string;
}

interface PendingControlBody {
  readonly type: "bootstrap" | "control";
  readonly body: Record<string, unknown>;
}

export interface S1ProtectionContext {
  readonly partnershipId: string;
  readonly contentType: ProtectedContentType;
  readonly contentId: string;
  readonly contentVersion: number;
  readonly payloadRole: ProtectedPayloadRole;
  readonly schemaVersion: number;
}

export interface S1DecryptionContext {
  readonly partnershipId: string;
  readonly contentType: ProtectedContentType;
  readonly contentId: string;
  readonly payloadRole: ProtectedPayloadRole;
}

export interface S1RuntimeStatus {
  readonly available: boolean;
  readonly cryptoDeviceId: string | null;
  readonly trustState: "pending" | "trusted" | "revoked" | null;
  readonly errorCode: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function serverMetadata(state: CryptoPartnershipState) {
  return {
    cryptoRequired: state.cryptoRequired,
    rekeyRequired: state.group?.rekeyRequired ?? false,
    devices: state.devices.map((device) => ({
      cryptoDeviceId: device.cryptoDeviceId,
      contentSigningPublicKey: device.contentSigningPublicKey,
      trustState: device.trustState,
    })),
    recoveryRecipients: state.recoveryRecipients.map((recipient) => ({
      accountId: recipient.accountId,
      recoveryKeyVersion: recipient.recoveryKeyVersion,
      recoveryHpkePublicKey: recipient.recoveryHpkePublicKey,
    })),
    serverSyncedAt: Date.now(),
  } as const;
}

function currentGroupState(
  state: CryptoPartnershipState,
  candidateState: Uint8Array<ArrayBuffer>,
  epoch: number,
  controlCursor: number,
): StoredGroupState {
  if (!state.group) throw new Error("CRYPTO_GROUP_NOT_READY");
  return {
    partnershipId: state.group.partnershipId,
    cryptoProfile: S1_CRYPTO_PROFILE,
    groupGeneration: state.group.groupGeneration,
    mlsEpoch: epoch,
    groupId: base64UrlDecode(state.group.groupId),
    state: candidateState,
    controlCursor,
    ...serverMetadata(state),
    updatedAt: Date.now(),
  };
}

function sameBytes(left: string, right: string): boolean {
  try {
    const a = base64UrlDecode(left);
    const b = base64UrlDecode(right);
    if (a.byteLength !== b.byteLength) return false;
    let different = 0;
    for (let index = 0; index < a.byteLength; index += 1) {
      different |= (a[index] ?? 0) ^ (b[index] ?? 0);
    }
    return different === 0;
  } catch {
    return false;
  }
}

function enrollmentProofPayload(
  accountId: string,
  deviceId: string,
  input: {
    readonly cryptoDeviceId: string;
    readonly cryptoProfile: string;
    readonly mlsSigningPublicKey: string;
    readonly contentSigningPublicKey: string;
  },
): Uint8Array<ArrayBuffer> {
  return utf8(
    [
      "shawtie-device-enrollment-v1",
      accountId,
      deviceId,
      input.cryptoDeviceId,
      input.cryptoProfile,
      input.mlsSigningPublicKey,
      input.contentSigningPublicKey,
    ].join("\0"),
  );
}

function approvalPayload(
  accountId: string,
  target: CryptoDeviceProjection,
): Uint8Array<ArrayBuffer> {
  return utf8(
    [
      "shawtie-device-approval-v1",
      accountId,
      target.cryptoDeviceId,
      target.cryptoProfile,
      target.mlsSigningPublicKey,
      target.contentSigningPublicKey,
    ].join("\0"),
  );
}

function recoveryProofPayload(
  accountId: string,
  targetCryptoDeviceId: string,
  challengeId: string,
  challenge: Uint8Array,
  recoveryKeyVersion: number,
): Uint8Array<ArrayBuffer> {
  const prefix = utf8(
    [
      "shawtie-recovery-proof-v1",
      accountId,
      targetCryptoDeviceId,
      challengeId,
      String(recoveryKeyVersion),
    ].join("\0") + "\0",
  );
  const output = new Uint8Array(prefix.byteLength + challenge.byteLength);
  output.set(prefix);
  output.set(challenge, prefix.byteLength);
  return output;
}

function recoveryCapsuleInfo(
  context: EnvelopeContext,
  contentKeyId: string,
  accountId: string,
  recoveryKeyVersion: number,
): Uint8Array<ArrayBuffer> {
  return canonicalBytes({
    accountId,
    contentId: context.contentId,
    contentKeyId,
    contentType: context.contentType,
    contentVersion: context.contentVersion,
    cryptoProfile: context.cryptoProfile,
    partnershipId: context.partnershipId,
    payloadRole: context.payloadRole,
    recoveryKeyVersion,
    version: 1,
  });
}

function recoveryCapsuleAad(
  context: EnvelopeContext,
  contentKeyId: string,
): Uint8Array<ArrayBuffer> {
  return canonicalBytes({
    contentId: context.contentId,
    contentKeyId,
    contentType: context.contentType,
    contentVersion: context.contentVersion,
    cryptoProfile: context.cryptoProfile,
    groupGeneration: context.groupGeneration,
    mlsEpoch: context.mlsEpoch,
    partnershipId: context.partnershipId,
    payloadRole: context.payloadRole,
    schemaVersion: context.schemaVersion,
    senderCryptoDeviceId: context.senderCryptoDeviceId,
  });
}

function keyDistributionBytes(
  context: EnvelopeContext,
  contentKeyId: string,
  contentKey: Uint8Array,
): Uint8Array<ArrayBuffer> {
  return canonicalBytes({
    contentId: context.contentId,
    contentKey: base64UrlEncode(contentKey),
    contentKeyId,
    contentType: context.contentType,
    contentVersion: context.contentVersion,
    cryptoProfile: context.cryptoProfile,
    groupGeneration: context.groupGeneration,
    mlsEpoch: context.mlsEpoch,
    partnershipId: context.partnershipId,
    payloadRole: context.payloadRole,
    schemaVersion: context.schemaVersion,
    senderCryptoDeviceId: context.senderCryptoDeviceId,
    version: 1,
  });
}

function parseKeyDistribution(
  bytes: Uint8Array,
  expected: {
    readonly context: EnvelopeContext;
    readonly contentKeyId: string;
  },
): Uint8Array<ArrayBuffer> {
  let value: unknown;
  try {
    value = JSON.parse(utf8Decode(bytes));
  } catch {
    throw new Error("CRYPTO_CIPHERTEXT_INVALID");
  }
  const row = asRecord(value);
  if (
    !row ||
    row.version !== 1 ||
    row.cryptoProfile !== expected.context.cryptoProfile ||
    row.partnershipId !== expected.context.partnershipId ||
    row.groupGeneration !== expected.context.groupGeneration ||
    row.mlsEpoch !== expected.context.mlsEpoch ||
    row.contentType !== expected.context.contentType ||
    row.contentId !== expected.context.contentId ||
    row.contentVersion !== expected.context.contentVersion ||
    row.payloadRole !== expected.context.payloadRole ||
    row.senderCryptoDeviceId !== expected.context.senderCryptoDeviceId ||
    row.schemaVersion !== expected.context.schemaVersion ||
    row.contentKeyId !== expected.contentKeyId ||
    typeof row.contentKey !== "string"
  ) {
    throw new Error("CRYPTO_CIPHERTEXT_INVALID");
  }
  const key = base64UrlDecode(row.contentKey);
  if (key.byteLength !== 32) throw new Error("CRYPTO_CIPHERTEXT_INVALID");
  return key;
}

async function exportEd25519RecoveryKeys(): Promise<{
  readonly privateKeyPkcs8: Uint8Array<ArrayBuffer>;
  readonly publicKey: Uint8Array<ArrayBuffer>;
}> {
  const pair = (await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  return {
    privateKeyPkcs8: new Uint8Array(
      await crypto.subtle.exportKey("pkcs8", pair.privateKey),
    ),
    publicKey: new Uint8Array(
      await crypto.subtle.exportKey("raw", pair.publicKey),
    ),
  };
}

async function signRecoveryProof(
  privateKeyPkcs8: Uint8Array,
  payload: Uint8Array,
): Promise<Uint8Array<ArrayBuffer>> {
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    privateKeyPkcs8,
    "Ed25519",
    false,
    ["sign"],
  );
  return new Uint8Array(
    await crypto.subtle.sign("Ed25519", privateKey, payload),
  );
}

export class S1CryptoRuntime {
  readonly accountId: string;
  readonly deviceId: string;
  readonly #vault: CryptoLocalVault;
  readonly #module: OpenMlsWasmModule;
  #device: CryptoDeviceProjection;
  #statusError: string | null = null;

  private constructor(
    accountId: string,
    deviceId: string,
    vault: CryptoLocalVault,
    module: OpenMlsWasmModule,
    device: CryptoDeviceProjection,
  ) {
    this.accountId = accountId;
    this.deviceId = deviceId;
    this.#vault = vault;
    this.#module = module;
    this.#device = device;
  }

  static async start(accountId: string, deviceId: string): Promise<S1CryptoRuntime> {
    const [vault, module] = await Promise.all([
      CryptoLocalVault.open(accountId),
      loadOpenMlsModule(),
    ]);

    let stored = await vault.deviceState();
    let device: CryptoDeviceProjection;

    if (!stored) {
      const cryptoDeviceId = crypto.randomUUID();
      const engine = createMlsEngine(module, cryptoDeviceId);
      const keyPackages = Array.from(
        { length: INITIAL_KEY_PACKAGE_COUNT },
        () => ({
          keyPackageId: crypto.randomUUID(),
          keyPackage: base64UrlEncode(engine.keyPackage()),
        }),
      );
      const mlsSigningPublicKey = base64UrlEncode(engine.mlsSigningPublicKey);
      const contentSigningPublicKey = base64UrlEncode(engine.contentSigningPublicKey);
      const identityProofSignature = base64UrlEncode(
        engine.signContent(
          enrollmentProofPayload(accountId, deviceId, {
            cryptoDeviceId,
            cryptoProfile: S1_CRYPTO_PROFILE,
            mlsSigningPublicKey,
            contentSigningPublicKey,
          }),
        ),
      );
      stored = {
        key: "device",
        cryptoProfile: S1_CRYPTO_PROFILE,
        cryptoDeviceId,
        state: engine.exportState(),
        updatedAt: Date.now(),
      };
      await vault.putDeviceState(stored);
      const enrolled = await enrollCryptoDevice({
        cryptoDeviceId,
        cryptoProfile: S1_CRYPTO_PROFILE,
        mlsSigningPublicKey,
        contentSigningPublicKey,
        identityProofSignature,
        keyPackages,
      });
      device = enrolled.device;
    } else {
      try {
        device = (await loadCurrentCryptoDevice()).device;
      } catch (error) {
        if (
          error instanceof ApiClientError &&
          error.code === "CRYPTO_NOT_INITIALIZED"
        ) {
          const engine = restoreMlsEngine(module, stored.state);
          const keyPackage = engine.keyPackage();
          stored = {
            ...stored,
            state: engine.exportState(),
            updatedAt: Date.now(),
          };
          await vault.putDeviceState(stored);
          const mlsSigningPublicKey = base64UrlEncode(engine.mlsSigningPublicKey);
          const contentSigningPublicKey = base64UrlEncode(
            engine.contentSigningPublicKey,
          );
          const enrolled = await enrollCryptoDevice({
            cryptoDeviceId: stored.cryptoDeviceId,
            cryptoProfile: S1_CRYPTO_PROFILE,
            mlsSigningPublicKey,
            contentSigningPublicKey,
            identityProofSignature: base64UrlEncode(
              engine.signContent(
                enrollmentProofPayload(accountId, deviceId, {
                  cryptoDeviceId: stored.cryptoDeviceId,
                  cryptoProfile: S1_CRYPTO_PROFILE,
                  mlsSigningPublicKey,
                  contentSigningPublicKey,
                }),
              ),
            ),
            keyPackages: [
              {
                keyPackageId: crypto.randomUUID(),
                keyPackage: base64UrlEncode(keyPackage),
              },
            ],
          });
          device = enrolled.device;
        } else {
          vault.close();
          throw error;
        }
      }
    }

    if (device.deviceId !== deviceId || device.accountId !== accountId) {
      vault.close();
      throw new Error("CRYPTO_DEVICE_IDENTITY_CONFLICT");
    }
    return new S1CryptoRuntime(accountId, deviceId, vault, module, device);
  }

  close(): void {
    this.#vault.close();
  }

  status(): S1RuntimeStatus {
    return {
      available: this.#statusError === null,
      cryptoDeviceId: this.#device.cryptoDeviceId,
      trustState: this.#device.trustState,
      errorCode: this.#statusError,
    };
  }

  currentDevice(): CryptoDeviceProjection {
    return this.#device;
  }

  async refreshDevice(): Promise<CryptoDeviceProjection> {
    this.#device = (await loadCurrentCryptoDevice()).device;
    return this.#device;
  }

  async devices(): Promise<readonly CryptoDeviceProjection[]> {
    return (await listCryptoDevices()).devices;
  }

  async approveDevice(targetCryptoDeviceId: string): Promise<CryptoDeviceProjection> {
    if (this.#device.trustState !== "trusted") {
      throw new Error("CRYPTO_DEVICE_UNTRUSTED");
    }
    const target = (await this.devices()).find(
      (device) => device.cryptoDeviceId === targetCryptoDeviceId,
    );
    if (!target || target.accountId !== this.accountId) {
      throw new Error("CRYPTO_DEVICE_NOT_FOUND");
    }
    const engine = await this.#deviceEngine();
    const signature = engine.signContent(approvalPayload(this.accountId, target));
    return (
      await approveCryptoDevice(targetCryptoDeviceId, {
        approvalSignature: base64UrlEncode(signature),
      })
    ).device;
  }

  async #deviceEngine(): Promise<MlsEngine> {
    const stored = await this.#vault.deviceState();
    if (!stored || stored.cryptoDeviceId !== this.#device.cryptoDeviceId) {
      throw new Error("CRYPTO_LOCAL_STATE_INVALID");
    }
    return restoreMlsEngine(this.#module, stored.state);
  }

  async #groupEngine(partnershipId: string): Promise<{
    readonly engine: MlsEngine;
    readonly group: StoredGroupState;
  }> {
    const group = await this.#vault.group(partnershipId);
    if (!group) throw new Error("CRYPTO_GROUP_NOT_READY");
    return {
      engine: restoreMlsEngine(this.#module, group.state),
      group,
    };
  }

  async #promoteAcceptedPendingControl(
    partnershipId: string,
    state: CryptoPartnershipState,
    controls: Awaited<ReturnType<typeof loadCryptoControls>>["items"],
    local: StoredGroupState,
  ): Promise<StoredGroupState> {
    let current = local;
    const pending = await this.#vault.pendingOperations(partnershipId);
    for (const operation of pending) {
      const descriptor = asRecord(operation.requestBody) as PendingControlBody | null;
      if (!descriptor || descriptor.type !== "control") continue;
      const body = asRecord(descriptor.body);
      const controlMessage =
        body && typeof body.controlMessage === "string" ? body.controlMessage : null;
      const accepted = controlMessage
        ? controls.find((item) => sameBytes(item.controlMessage, controlMessage))
        : null;
      if (accepted) {
        current = currentGroupState(
          state,
          operation.candidateState,
          accepted.epochTo,
          accepted.controlSequence,
        );
        await this.#vault.promoteControlOperation(operation.operationId, current);
        continue;
      }
      const expectedEpoch =
        body && typeof body.expectedEpoch === "number" ? body.expectedEpoch : null;
      if (expectedEpoch !== null && expectedEpoch < state.group!.currentEpoch) {
        await this.#vault.completeOperation(operation.operationId);
      }
    }
    return current;
  }

  async #processControls(
    partnershipId: string,
    state: CryptoPartnershipState,
    local: StoredGroupState,
  ): Promise<StoredGroupState> {
    let group = local;
    let hasMore = true;
    while (hasMore) {
      const page = await loadCryptoControls(
        partnershipId,
        group.controlCursor,
        CONTROL_PAGE_SIZE,
      );
      group = await this.#promoteAcceptedPendingControl(
        partnershipId,
        state,
        page.items,
        group,
      );

      for (const item of page.items) {
        if (item.controlSequence <= group.controlCursor) continue;
        if (item.kind === "reset") {
          group = {
            ...group,
            controlCursor: item.controlSequence,
            updatedAt: Date.now(),
          };
          await this.#vault.putGroup(group);
          continue;
        }
        const pending = await this.#vault.pendingOperations(partnershipId);
        const acceptedPending = pending.find((operation) => {
          const descriptor = asRecord(operation.requestBody) as PendingControlBody | null;
          const body = descriptor ? asRecord(descriptor.body) : null;
          return (
            descriptor?.type === "control" &&
            body &&
            typeof body.controlMessage === "string" &&
            sameBytes(body.controlMessage, item.controlMessage)
          );
        });
        if (acceptedPending) {
          group = currentGroupState(
            state,
            acceptedPending.candidateState,
            item.epochTo,
            item.controlSequence,
          );
          await this.#vault.promoteControlOperation(
            acceptedPending.operationId,
            group,
          );
          continue;
        }

        const engine = restoreMlsEngine(this.#module, group.state);
        const transition = engine.processMessage(
          group.groupId,
          base64UrlDecode(item.controlMessage),
        );
        group = {
          ...group,
          state: transition.state,
          mlsEpoch: transition.epoch,
          controlCursor: item.controlSequence,
          updatedAt: Date.now(),
        };
        await this.#vault.putGroup(group);
      }
      hasMore = page.hasMore;
    }
    return group;
  }

  async #joinFromWelcome(
    partnershipId: string,
    state: CryptoPartnershipState,
  ): Promise<StoredGroupState | null> {
    if (!state.group) return null;
    let after = 0;
    let hasMore = true;
    while (hasMore) {
      const page = await loadCryptoControls(
        partnershipId,
        after,
        CONTROL_PAGE_SIZE,
      );
      for (const item of page.items) {
        after = item.controlSequence;
        if (
          item.targetCryptoDeviceId === this.#device.cryptoDeviceId &&
          item.welcome
        ) {
          const engine = await this.#deviceEngine();
          const transition = engine.joinWelcome(base64UrlDecode(item.welcome));
          const joined: StoredGroupState = {
            partnershipId,
            cryptoProfile: S1_CRYPTO_PROFILE,
            groupGeneration: state.group.groupGeneration,
            mlsEpoch: transition.epoch,
            groupId: transition.groupId,
            state: transition.state,
            controlCursor: item.controlSequence,
            ...serverMetadata(state),
            updatedAt: Date.now(),
          };
          await this.#vault.putGroup(joined);
          return joined;
        }
      }
      hasMore = page.hasMore;
    }
    return null;
  }

  async #bootstrap(
    partnershipId: string,
    state: CryptoPartnershipState,
  ): Promise<StoredGroupState | null> {
    if (state.group) return null;
    const engine = await this.#deviceEngine();
    const groupId = crypto.getRandomValues(new Uint8Array(32));
    const transition = engine.createGroup(groupId);
    const candidate = restoreMlsEngine(this.#module, transition.state);
    const founderLeafIndex = candidate.memberLeafIndex(
      transition.groupId,
      this.#device.cryptoDeviceId,
    );
    if (founderLeafIndex === null) throw new Error("CRYPTO_GROUP_NOT_READY");

    const body = {
      cryptoProfile: S1_CRYPTO_PROFILE,
      ciphersuite: S1_MLS_CIPHERSUITE,
      groupGeneration: 1,
      groupId: base64UrlEncode(transition.groupId),
      epoch: transition.epoch,
      founderLeafIndex,
    };
    const operationId = crypto.randomUUID();
    await this.#vault.stageControlOutbound({
      operationId,
      partnershipId,
      cryptoProfile: S1_CRYPTO_PROFILE,
      requestBody: { type: "bootstrap", body } satisfies PendingControlBody,
      candidateState: transition.state,
      createdAt: Date.now(),
    });

    try {
      const accepted = await bootstrapCryptoPartnership(partnershipId, body);
      const group: StoredGroupState = {
        partnershipId,
        cryptoProfile: S1_CRYPTO_PROFILE,
        groupGeneration: accepted.groupGeneration,
        mlsEpoch: accepted.currentEpoch,
        groupId: transition.groupId,
        state: transition.state,
        controlCursor: accepted.controlSequence,
        cryptoRequired: accepted.cryptoRequired,
        rekeyRequired: false,
        devices: state.devices.map((device) => ({
          cryptoDeviceId: device.cryptoDeviceId,
          contentSigningPublicKey: device.contentSigningPublicKey,
          trustState: device.trustState,
        })),
        recoveryRecipients: state.recoveryRecipients,
        serverSyncedAt: Date.now(),
        updatedAt: Date.now(),
      };
      await this.#vault.promoteControlOperation(operationId, group);
      return group;
    } catch (error) {
      if (
        error instanceof ApiClientError &&
        error.code === "CRYPTO_GROUP_BOOTSTRAP_CONFLICT"
      ) {
        await this.#vault.completeOperation(operationId);
        return null;
      }
      throw error;
    }
  }

  async #recoverAcceptedBootstrap(
    partnershipId: string,
    state: CryptoPartnershipState,
  ): Promise<StoredGroupState | null> {
    if (!state.group) return null;
    const pending = await this.#vault.pendingOperations(partnershipId);
    for (const operation of pending) {
      const descriptor = asRecord(operation.requestBody) as PendingControlBody | null;
      const body = descriptor ? asRecord(descriptor.body) : null;
      if (
        descriptor?.type !== "bootstrap" ||
        !body ||
        typeof body.groupId !== "string" ||
        !sameBytes(body.groupId, state.group.groupId)
      ) {
        continue;
      }
      const recovered: StoredGroupState = {
        partnershipId,
        cryptoProfile: S1_CRYPTO_PROFILE,
        groupGeneration: state.group.groupGeneration,
        mlsEpoch: state.group.currentEpoch,
        groupId: base64UrlDecode(state.group.groupId),
        state: operation.candidateState,
        controlCursor: 0,
        ...serverMetadata(state),
        updatedAt: Date.now(),
      };
      await this.#vault.promoteControlOperation(operation.operationId, recovered);
      return recovered;
    }
    return null;
  }

  async #recoverAcceptedReset(
    partnershipId: string,
    state: CryptoPartnershipState,
  ): Promise<StoredGroupState | null> {
    if (!state.group) return null;
    const pending = await this.#vault.pendingOperations(partnershipId);
    for (const operation of pending) {
      const descriptor = asRecord(operation.requestBody) as PendingControlBody | null;
      const body = descriptor ? asRecord(descriptor.body) : null;
      if (
        descriptor?.type !== "control" ||
        body?.kind !== "reset" ||
        body.resetGroupGeneration !== state.group.groupGeneration ||
        typeof body.resetGroupId !== "string" ||
        !sameBytes(body.resetGroupId, state.group.groupId)
      ) {
        continue;
      }
      const recovered: StoredGroupState = {
        partnershipId,
        cryptoProfile: S1_CRYPTO_PROFILE,
        groupGeneration: state.group.groupGeneration,
        mlsEpoch: 0,
        groupId: base64UrlDecode(state.group.groupId),
        state: operation.candidateState,
        controlCursor: 1,
        ...serverMetadata(state),
        updatedAt: Date.now(),
      };
      await this.#vault.promoteControlOperation(operation.operationId, recovered);
      return recovered;
    }
    return null;
  }

  async #commitControl(
    partnershipId: string,
    state: CryptoPartnershipState,
    local: StoredGroupState,
    input:
      | {
          readonly kind: "add";
          readonly targetCryptoDeviceId: string;
          readonly keyPackageId: string;
          readonly keyPackage: string;
        }
      | {
          readonly kind: "remove";
          readonly targetCryptoDeviceId: string;
          readonly targetLeafIndex: number;
        },
  ): Promise<StoredGroupState> {
    const engine = restoreMlsEngine(this.#module, local.state);
    const transition =
      input.kind === "add"
        ? engine.addMember(local.groupId, base64UrlDecode(input.keyPackage))
        : engine.removeMember(local.groupId, input.targetLeafIndex);
    if (!transition.controlMessage) throw new Error("CRYPTO_GROUP_NOT_READY");

    const candidate = restoreMlsEngine(this.#module, transition.state);
    const targetLeafIndex =
      input.kind === "add"
        ? candidate.memberLeafIndex(local.groupId, input.targetCryptoDeviceId)
        : input.targetLeafIndex;
    if (targetLeafIndex === null) throw new Error("CRYPTO_GROUP_NOT_READY");

    const body = {
      expectedGroupGeneration: local.groupGeneration,
      expectedEpoch: local.mlsEpoch,
      newEpoch: transition.epoch,
      kind: input.kind,
      controlMessage: base64UrlEncode(transition.controlMessage),
      welcome:
        input.kind === "add" && transition.welcome
          ? base64UrlEncode(transition.welcome)
          : null,
      targetCryptoDeviceId: input.targetCryptoDeviceId,
      targetLeafIndex,
      keyPackageId: input.kind === "add" ? input.keyPackageId : null,
    };
    const operationId = crypto.randomUUID();
    await this.#vault.stageControlOutbound({
      operationId,
      partnershipId,
      cryptoProfile: S1_CRYPTO_PROFILE,
      requestBody: { type: "control", body } satisfies PendingControlBody,
      candidateState: transition.state,
      createdAt: Date.now(),
    });

    try {
      const accepted = await commitCryptoPartnership(partnershipId, body);
      const next: StoredGroupState = {
        ...local,
        state: transition.state,
        mlsEpoch: accepted.currentEpoch,
        controlCursor: accepted.controlSequence,
        updatedAt: Date.now(),
      };
      await this.#vault.promoteControlOperation(operationId, next);
      return next;
    } catch (error) {
      if (
        error instanceof ApiClientError &&
        ["CRYPTO_EPOCH_CONFLICT", "CRYPTO_KEY_PACKAGE_REQUIRED"].includes(
          error.code,
        )
      ) {
        await this.#vault.completeOperation(operationId);
      }
      throw error;
    }
  }

  async ensurePartnership(partnershipId: string): Promise<CryptoPartnershipState> {
    if (this.#device.trustState !== "trusted") {
      throw new Error("CRYPTO_DEVICE_UNTRUSTED");
    }
    return withCryptoLock(
      partnershipId,
      this.#device.cryptoDeviceId,
      async () => {
        let state = await loadCryptoPartnershipState(partnershipId);
        let local = await this.#vault.group(partnershipId);

        if (!state.group) {
          local = await this.#bootstrap(partnershipId, state);
          state = await loadCryptoPartnershipState(partnershipId);
        } else if (
          local &&
          (
            local.groupGeneration !== state.group.groupGeneration ||
            base64UrlEncode(local.groupId) !== state.group.groupId
          )
        ) {
          const reset = await this.#recoverAcceptedReset(partnershipId, state);
          if (reset) {
            local = reset;
          } else {
            await this.#vault.purgePartnership(partnershipId);
            local = null;
          }
        }

        if (state.group && !local) {
          local =
            (await this.#recoverAcceptedReset(partnershipId, state)) ??
            (await this.#recoverAcceptedBootstrap(partnershipId, state)) ??
            (await this.#joinFromWelcome(partnershipId, state));
        }
        if (!state.group || !local) {
          return state;
        }

        local = await this.#processControls(partnershipId, state, local);
        state = await loadCryptoPartnershipState(partnershipId);

        const trustedIds = new Set(
          state.devices
            .filter((device) => device.trustState === "trusted")
            .map((device) => device.cryptoDeviceId),
        );
        const revokedMembers = state.members.filter(
          (member) =>
            member.removedAt === null &&
            !trustedIds.has(member.cryptoDeviceId),
        );
        for (const member of revokedMembers) {
          if (member.cryptoDeviceId === this.#device.cryptoDeviceId) continue;
          local = await this.#commitControl(partnershipId, state, local, {
            kind: "remove",
            targetCryptoDeviceId: member.cryptoDeviceId,
            targetLeafIndex: member.leafIndex,
          });
          state = await loadCryptoPartnershipState(partnershipId);
        }

        if (!state.group?.rekeyRequired) {
          for (const target of state.keyPackages) {
            local = await this.#commitControl(partnershipId, state, local, {
              kind: "add",
              targetCryptoDeviceId: target.cryptoDeviceId,
              keyPackageId: target.keyPackageId,
              keyPackage: target.keyPackage,
            });
            state = await loadCryptoPartnershipState(partnershipId);
          }
        }

        local = {
          ...local,
          ...serverMetadata(state),
          updatedAt: Date.now(),
        };
        await this.#vault.putGroup(local);
        return state;
      },
    );
  }

  async resetPartnershipGroup(
    partnershipId: string,
  ): Promise<CryptoPartnershipState> {
    if (this.#device.trustState !== "trusted") {
      throw new Error("CRYPTO_DEVICE_UNTRUSTED");
    }

    await withCryptoLock(
      partnershipId,
      this.#device.cryptoDeviceId,
      async () => {
        let state = await loadCryptoPartnershipState(partnershipId);
        if (!state.group || !state.cryptoRequired) {
          throw new Error("CRYPTO_GROUP_RESET_REQUIRED");
        }

        const recovered = await this.#recoverAcceptedReset(partnershipId, state);
        if (recovered) return;

        const recovery = await this.#vault.recoveryState();
        const recipient = state.recoveryRecipients.find(
          (item) => item.accountId === this.accountId,
        );
        if (
          !recovery ||
          !recipient ||
          recipient.recoveryKeyVersion !== recovery.recoveryKeyVersion
        ) {
          throw new Error("CRYPTO_RECOVERY_REQUIRED");
        }

        const engine = await this.#deviceEngine();
        const requestedGroupId = crypto.getRandomValues(new Uint8Array(32));
        const transition = engine.createGroup(requestedGroupId);
        const candidate = restoreMlsEngine(this.#module, transition.state);
        const founderLeafIndex = candidate.memberLeafIndex(
          transition.groupId,
          this.#device.cryptoDeviceId,
        );
        if (founderLeafIndex === null) {
          throw new Error("CRYPTO_GROUP_RESET_REQUIRED");
        }

        const resetGroupGeneration = state.group.groupGeneration + 1;
        const resetGroupId = base64UrlEncode(transition.groupId);
        const proofText = cryptoResetProofText({
          accountId: this.accountId,
          partnershipId,
          cryptoDeviceId: this.#device.cryptoDeviceId,
          expectedGroupGeneration: state.group.groupGeneration,
          expectedEpoch: state.group.currentEpoch,
          resetGroupGeneration,
          resetGroupId,
          resetFounderLeafIndex: founderLeafIndex,
          recoveryKeyVersion: recovery.recoveryKeyVersion,
        });
        const recoverySignature = await signRecoveryProof(
          recovery.recoveryAuthPrivateKeyPkcs8,
          utf8(proofText),
        );
        const body = {
          expectedGroupGeneration: state.group.groupGeneration,
          expectedEpoch: state.group.currentEpoch,
          newEpoch: 0,
          kind: "reset" as const,
          controlMessage: base64UrlEncode(utf8(proofText)),
          welcome: null,
          targetCryptoDeviceId: null,
          targetLeafIndex: null,
          keyPackageId: null,
          resetGroupGeneration,
          resetGroupId,
          resetFounderLeafIndex: founderLeafIndex,
          recoveryKeyVersion: recovery.recoveryKeyVersion,
          recoverySignature: base64UrlEncode(recoverySignature),
        };
        const operationId = crypto.randomUUID();
        await this.#vault.stageControlOutbound({
          operationId,
          partnershipId,
          cryptoProfile: S1_CRYPTO_PROFILE,
          requestBody: { type: "control", body } satisfies PendingControlBody,
          candidateState: transition.state,
          createdAt: Date.now(),
        });

        try {
          const accepted = await commitCryptoPartnership(partnershipId, body);
          state = await loadCryptoPartnershipState(partnershipId);
          if (
            !state.group ||
            state.group.groupGeneration !== accepted.groupGeneration ||
            state.group.groupId !== resetGroupId
          ) {
            throw new Error("CRYPTO_GROUP_RESET_REQUIRED");
          }
          const next: StoredGroupState = {
            partnershipId,
            cryptoProfile: S1_CRYPTO_PROFILE,
            groupGeneration: accepted.groupGeneration,
            mlsEpoch: accepted.currentEpoch,
            groupId: transition.groupId,
            state: transition.state,
            controlCursor: accepted.controlSequence,
            ...serverMetadata(state),
            updatedAt: Date.now(),
          };
          await this.#vault.promoteControlOperation(operationId, next);
        } catch (error) {
          if (
            error instanceof ApiClientError &&
            [
              "CRYPTO_EPOCH_CONFLICT",
              "CRYPTO_RECOVERY_VERSION_CONFLICT",
              "CRYPTO_RECOVERY_FAILED",
            ].includes(error.code)
          ) {
            await this.#vault.completeOperation(operationId);
          }
          throw error;
        }
      },
    );

    return this.ensurePartnership(partnershipId);
  }

  async partnershipState(
    partnershipId: string,
  ): Promise<CryptoPartnershipState> {
    return this.ensurePartnership(partnershipId);
  }

  async cryptoRequiredForPartnership(partnershipId: string): Promise<boolean> {
    try {
      return (await this.ensurePartnership(partnershipId)).cryptoRequired;
    } catch (error) {
      if (!(error instanceof ApiNetworkError)) throw error;
      const cached = await this.#vault.group(partnershipId);
      if (!cached) throw new Error("CRYPTO_GROUP_NOT_READY");
      return cached.cryptoRequired;
    }
  }

  async purgePartnership(partnershipId: string): Promise<void> {
    await this.#vault.purgePartnership(partnershipId);
  }

  async setupRecovery(): Promise<{
    readonly recoveryMasterSecret: string;
    readonly recoveryKeyVersion: number;
  }> {
    if (this.#device.trustState !== "trusted") {
      throw new Error("CRYPTO_DEVICE_UNTRUSTED");
    }
    const existing = await this.#vault.recoveryState();
    const recoveryKeyVersion = (existing?.recoveryKeyVersion ?? 0) + 1;
    const rms = generateRecoveryMasterSecret();
    const engine = await this.#deviceEngine();
    const hpke = engine.deriveRecoveryKeyPair(rms);
    const auth = await exportEd25519RecoveryKeys();
    const plaintext: RecoveryBundlePlaintext = {
      version: RECOVERY_BUNDLE_VERSION,
      cryptoProfile: S1_CRYPTO_PROFILE,
      recoveryKeyVersion,
      recoveryHpkePrivateKey: base64UrlEncode(hpke.privateKey),
      recoveryHpkePublicKey: base64UrlEncode(hpke.publicKey),
      recoveryAuthPrivateKeyPkcs8: base64UrlEncode(auth.privateKeyPkcs8),
      recoveryAuthPublicKey: base64UrlEncode(auth.publicKey),
    };
    const encrypted = await encryptRecoveryBundle(
      utf8(JSON.stringify(plaintext)),
      rms,
    );
    await setupCryptoRecovery({
      cryptoProfile: S1_CRYPTO_PROFILE,
      recoveryKeyVersion,
      recoveryHpkePublicKey: plaintext.recoveryHpkePublicKey,
      recoveryAuthPublicKey: plaintext.recoveryAuthPublicKey,
      encryptedBundle: base64UrlEncode(
        utf8(JSON.stringify(encrypted)),
      ),
    });
    const stored: StoredRecoveryState = {
      key: "recovery",
      cryptoProfile: S1_CRYPTO_PROFILE,
      recoveryKeyVersion,
      recoveryHpkePrivateKey: hpke.privateKey,
      recoveryHpkePublicKey: hpke.publicKey,
      recoveryAuthPrivateKeyPkcs8: auth.privateKeyPkcs8,
      recoveryAuthPublicKey: auth.publicKey,
      updatedAt: Date.now(),
    };
    await this.#vault.putRecoveryState(stored);
    return {
      recoveryMasterSecret: encodeRecoveryMasterSecret(rms),
      recoveryKeyVersion,
    };
  }

  async recoverWithMasterSecret(encodedSecret: string): Promise<CryptoDeviceProjection> {
    const rms = decodeRecoveryMasterSecret(encodedSecret);
    const serverBundle = await loadCryptoRecoveryBundle();
    let encrypted: EncryptedRecoveryBundle;
    try {
      encrypted = JSON.parse(
        utf8Decode(base64UrlDecode(serverBundle.encryptedBundle)),
      ) as EncryptedRecoveryBundle;
    } catch {
      throw new Error("CRYPTO_RECOVERY_FAILED");
    }
    const decrypted = await decryptRecoveryBundle(encrypted, rms);
    let bundle: RecoveryBundlePlaintext;
    try {
      bundle = JSON.parse(utf8Decode(decrypted)) as RecoveryBundlePlaintext;
    } catch {
      throw new Error("CRYPTO_RECOVERY_FAILED");
    }
    if (
      bundle.version !== RECOVERY_BUNDLE_VERSION ||
      bundle.cryptoProfile !== S1_CRYPTO_PROFILE ||
      bundle.recoveryKeyVersion !== serverBundle.recoveryKeyVersion ||
      bundle.recoveryHpkePublicKey !== serverBundle.recoveryHpkePublicKey ||
      bundle.recoveryAuthPublicKey !== serverBundle.recoveryAuthPublicKey
    ) {
      throw new Error("CRYPTO_RECOVERY_FAILED");
    }

    const challenge = await createCryptoRecoveryChallenge({
      targetCryptoDeviceId: this.#device.cryptoDeviceId,
    });
    if (challenge.recoveryKeyVersion !== bundle.recoveryKeyVersion) {
      throw new Error("CRYPTO_RECOVERY_FAILED");
    }
    const signature = await signRecoveryProof(
      base64UrlDecode(bundle.recoveryAuthPrivateKeyPkcs8),
      recoveryProofPayload(
        this.accountId,
        this.#device.cryptoDeviceId,
        challenge.challengeId,
        base64UrlDecode(challenge.challenge),
        challenge.recoveryKeyVersion,
      ),
    );
    const recovered = await proveCryptoRecovery({
      challengeId: challenge.challengeId,
      recoverySignature: base64UrlEncode(signature),
    });
    this.#device = recovered.device;
    await this.#vault.putRecoveryState({
      key: "recovery",
      cryptoProfile: S1_CRYPTO_PROFILE,
      recoveryKeyVersion: bundle.recoveryKeyVersion,
      recoveryHpkePrivateKey: base64UrlDecode(bundle.recoveryHpkePrivateKey),
      recoveryHpkePublicKey: base64UrlDecode(bundle.recoveryHpkePublicKey),
      recoveryAuthPrivateKeyPkcs8: base64UrlDecode(
        bundle.recoveryAuthPrivateKeyPkcs8,
      ),
      recoveryAuthPublicKey: base64UrlDecode(bundle.recoveryAuthPublicKey),
      updatedAt: Date.now(),
    });
    return recovered.device;
  }

  async protectBytes(
    contextInput: S1ProtectionContext,
    plaintext: Uint8Array,
  ): Promise<EncryptedProtectedContentInput> {
    try {
      await this.ensurePartnership(contextInput.partnershipId);
    } catch (error) {
      if (!(error instanceof ApiNetworkError)) throw error;
    }
    const storedGroup = await this.#vault.group(contextInput.partnershipId);
    if (!storedGroup) throw new Error("CRYPTO_GROUP_NOT_READY");
    if (!storedGroup.cryptoRequired) throw new Error("CRYPTO_NOT_INITIALIZED");
    if (storedGroup.rekeyRequired) throw new Error("CRYPTO_REKEY_REQUIRED");
    if (storedGroup.recoveryRecipients.length !== 2) {
      throw new Error("CRYPTO_RECOVERY_REQUIRED");
    }

    return withCryptoLock(
      contextInput.partnershipId,
      this.#device.cryptoDeviceId,
      async () => {
        const { engine, group } = await this.#groupEngine(
          contextInput.partnershipId,
        );
        const context = envelopeContext({
          partnershipId: contextInput.partnershipId,
          groupGeneration: group.groupGeneration,
          mlsEpoch: group.mlsEpoch,
          contentType: contextInput.contentType,
          contentId: contextInput.contentId,
          contentVersion: contextInput.contentVersion,
          payloadRole: contextInput.payloadRole,
          senderCryptoDeviceId: this.#device.cryptoDeviceId,
          schemaVersion: contextInput.schemaVersion,
        });
        const contentKeyId = crypto.randomUUID();
        const encrypted = await encryptBytes(plaintext, context);
        const distribution = engine.createApplicationMessage(
          group.groupId,
          keyDistributionBytes(context, contentKeyId, encrypted.key),
        );
        if (!distribution.applicationMessage) {
          throw new Error("CRYPTO_GROUP_NOT_READY");
        }
        const candidate = restoreMlsEngine(this.#module, distribution.state);
        const signature = candidate.signContent(
          contentSignatureInput(
            context,
            contentKeyId,
            encrypted.nonce,
            encrypted.digest,
          ),
        );
        const recoveryCapsules = group.recoveryRecipients.map((recipient) => {
          const sealed = candidate.hpkeSeal(
            base64UrlDecode(recipient.recoveryHpkePublicKey),
            recoveryCapsuleInfo(
              context,
              contentKeyId,
              recipient.accountId,
              recipient.recoveryKeyVersion,
            ),
            recoveryCapsuleAad(context, contentKeyId),
            encrypted.key,
          );
          return {
            accountId: recipient.accountId,
            recoveryKeyVersion: recipient.recoveryKeyVersion,
            encapsulation: base64UrlEncode(sealed.encapsulation),
            ciphertext: base64UrlEncode(sealed.ciphertext),
          };
        });

        const nextGroup: StoredGroupState = {
          ...group,
          state: distribution.state,
          updatedAt: Date.now(),
        };
        await this.#vault.putGroup(nextGroup);
        await this.#vault.putContentKey(
          contentKeyId,
          contextInput.partnershipId,
          encrypted.key,
        );

        const envelope: ProtectedContentEnvelopeInput = {
          cryptoProfile: S1_CRYPTO_PROFILE,
          groupGeneration: context.groupGeneration,
          mlsEpoch: context.mlsEpoch,
          senderCryptoDeviceId: context.senderCryptoDeviceId,
          contentKeyId,
          nonce: base64UrlEncode(encrypted.nonce),
          ciphertextSha256: base64UrlEncode(encrypted.digest),
          keyDistributionMessage: base64UrlEncode(
            distribution.applicationMessage,
          ),
          contentSignature: base64UrlEncode(signature),
          recoveryCapsules,
        };
        return {
          ciphertext: base64UrlEncode(encrypted.ciphertext),
          envelope,
        };
      },
    );
  }

  async protectJson(
    context: S1ProtectionContext,
    value: unknown,
  ): Promise<EncryptedProtectedContentInput> {
    return this.protectBytes(context, utf8(JSON.stringify(value)));
  }

  async decryptProtectedBytes(
    contextInput: S1DecryptionContext,
    protectedContent: EncryptedProtectedContentProjection,
  ): Promise<Uint8Array<ArrayBuffer>> {
    const envelope = protectedContent.envelope;
    if (
      envelope.partnershipId !== contextInput.partnershipId ||
      envelope.contentType !== contextInput.contentType ||
      envelope.contentId !== contextInput.contentId ||
      envelope.payloadRole !== contextInput.payloadRole
    ) {
      throw new Error("CRYPTO_CIPHERTEXT_INVALID");
    }
    const context = envelopeContext({
      partnershipId: contextInput.partnershipId,
      groupGeneration: envelope.groupGeneration,
      mlsEpoch: envelope.mlsEpoch,
      contentType: envelope.contentType,
      contentId: envelope.contentId,
      contentVersion: envelope.contentVersion,
      payloadRole: envelope.payloadRole,
      senderCryptoDeviceId: envelope.senderCryptoDeviceId,
      schemaVersion: envelope.schemaVersion,
    });

    try {
      await this.ensurePartnership(contextInput.partnershipId);
    } catch (error) {
      if (!(error instanceof ApiNetworkError)) throw error;
    }
    const trustedGroup = await this.#vault.group(contextInput.partnershipId);
    if (!trustedGroup) throw new Error("CRYPTO_GROUP_NOT_READY");
    const sender = trustedGroup.devices.find(
      (device) => device.cryptoDeviceId === envelope.senderCryptoDeviceId,
    );
    if (!sender) throw new Error("CRYPTO_SIGNATURE_INVALID");
    const ciphertext = base64UrlDecode(protectedContent.ciphertext);
    const digest = await sha256(ciphertext);
    if (base64UrlEncode(digest) !== envelope.ciphertextSha256) {
      throw new Error("CRYPTO_CIPHERTEXT_INVALID");
    }
    const verifier = await this.#deviceEngine();
    if (
      !verifier.verifyContent(
        base64UrlDecode(sender.contentSigningPublicKey),
        contentSignatureInput(
          context,
          envelope.contentKeyId,
          base64UrlDecode(envelope.nonce),
          digest,
        ),
        base64UrlDecode(envelope.contentSignature),
      )
    ) {
      throw new Error("CRYPTO_SIGNATURE_INVALID");
    }

    let key = await this.#vault.contentKey(envelope.contentKeyId);

    if (!key) {
      try {
        await withCryptoLock(
          contextInput.partnershipId,
          this.#device.cryptoDeviceId,
          async () => {
            const current = await this.#vault.group(contextInput.partnershipId);
            if (!current) throw new Error("CRYPTO_GROUP_NOT_READY");
            const engine = restoreMlsEngine(this.#module, current.state);
            const transition = engine.processMessage(
              current.groupId,
              base64UrlDecode(envelope.keyDistributionMessage),
            );
            if (!transition.applicationMessage) {
              throw new Error("CRYPTO_CIPHERTEXT_INVALID");
            }
            key = parseKeyDistribution(transition.applicationMessage, {
              context,
              contentKeyId: envelope.contentKeyId,
            });
            await this.#vault.putGroup({
              ...current,
              state: transition.state,
              updatedAt: Date.now(),
            });
            await this.#vault.putContentKey(
              envelope.contentKeyId,
              contextInput.partnershipId,
              key,
            );
          },
        );
      } catch {
        const recovery = await this.#vault.recoveryState();
        if (!recovery || !envelope.recoveryCapsule) {
          throw new Error("CRYPTO_HISTORY_UNAVAILABLE");
        }
        if (
          envelope.recoveryCapsule.accountId !== this.accountId ||
          envelope.recoveryCapsule.recoveryKeyVersion !== recovery.recoveryKeyVersion
        ) {
          throw new Error("CRYPTO_HISTORY_UNAVAILABLE");
        }
        const engine = await this.#deviceEngine();
        key = engine.hpkeOpen(
          recovery.recoveryHpkePrivateKey,
          recoveryCapsuleInfo(
            context,
            envelope.contentKeyId,
            this.accountId,
            recovery.recoveryKeyVersion,
          ),
          recoveryCapsuleAad(context, envelope.contentKeyId),
          {
            encapsulation: base64UrlDecode(
              envelope.recoveryCapsule.encapsulation,
            ),
            ciphertext: base64UrlDecode(
              envelope.recoveryCapsule.ciphertext,
            ),
          },
        );
        await this.#vault.putContentKey(
          envelope.contentKeyId,
          contextInput.partnershipId,
          key,
        );
      }
    }

    return decryptBytes(
      {
        cryptoProfile: S1_CRYPTO_PROFILE,
        nonce: envelope.nonce,
        ciphertext: protectedContent.ciphertext,
        ciphertextSha256: envelope.ciphertextSha256,
      },
      key,
      context,
    );
  }

  async decryptProtectedJson<T>(
    context: S1DecryptionContext,
    protectedContent: EncryptedProtectedContentProjection,
  ): Promise<T> {
    return JSON.parse(
      utf8Decode(await this.decryptProtectedBytes(context, protectedContent)),
    ) as T;
  }
}
