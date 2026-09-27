import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  deriveCryptoSecurityViewModel,
  type CryptoSecurityInputs,
} from "../src/features/security/crypto-security-model.ts";

async function source(relative: string): Promise<string> {
  return readFile(new URL(relative, import.meta.url), "utf8");
}

const EM_DASH = String.fromCodePoint(0x2014);

const READY_PARTNERSHIP = {
  cryptoProfile: "shawtie.mls.v1",
  cryptoRequired: true,
  cryptoRequiredFrom: "2026-09-27T00:00:00.000Z",
  currentCryptoDeviceId: "crypto-current",
  group: {
    partnershipId: "partnership",
    groupGeneration: 1,
    groupId: "group",
    ciphersuite: "MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519",
    currentEpoch: 2,
    controlSequence: 3,
    rekeyRequired: false,
  },
  devices: [
    {
      cryptoDeviceId: "crypto-current",
      deviceId: "device-current",
      accountId: "account-me",
      cryptoProfile: "shawtie.mls.v1",
      credentialPublicKey: "credential",
      contentSigningPublicKey: "signing",
      trustState: "trusted",
      approvedAt: "2026-09-27T00:00:00.000Z",
      createdAt: "2026-09-27T00:00:00.000Z",
      revokedAt: null,
    },
    {
      cryptoDeviceId: "crypto-partner",
      deviceId: "device-partner",
      accountId: "account-partner",
      cryptoProfile: "shawtie.mls.v1",
      credentialPublicKey: "credential-partner",
      contentSigningPublicKey: "signing-partner",
      trustState: "trusted",
      approvedAt: "2026-09-27T00:00:00.000Z",
      createdAt: "2026-09-27T00:00:00.000Z",
      revokedAt: null,
    },
  ],
  members: [],
  keyPackages: [],
  recoveryRecipients: [
    {
      accountId: "account-me",
      recoveryKeyVersion: 1,
      recoveryHpkePublicKey: "recovery-me",
    },
    {
      accountId: "account-partner",
      recoveryKeyVersion: 1,
      recoveryHpkePublicKey: "recovery-partner",
    },
  ],
  legacyPlaintextBlocker: false,
} as const;

function inputs(
  overrides: Partial<CryptoSecurityInputs> = {},
): CryptoSecurityInputs {
  return {
    runtimePresent: true,
    runtimeStatus: {
      available: true,
      cryptoDeviceId: "crypto-current",
      trustState: "trusted",
      errorCode: null,
    },
    serverRecovery: { configured: true, recoveryKeyVersion: 1 },
    localRecovery: { configured: true, recoveryKeyVersion: 1 },
    partnershipId: "partnership",
    lifecycleState: "active",
    interactionMode: "normal",
    partnershipState: READY_PARTNERSHIP,
    localGroup: {
      available: true,
      groupGeneration: 1,
      cryptoRequired: true,
      rekeyRequired: false,
    },
    partnershipRefreshError: null,
    revision: "r1",
    ...overrides,
  } as CryptoSecurityInputs;
}

test("UX8 healthy trusted state is quiet and writable", () => {
  const model = deriveCryptoSecurityViewModel(inputs());
  assert.equal(model.primaryTask, "none");
  assert.equal(model.partnership, "ready");
  assert.equal(model.protectedWrites, "allowed");
  assert.equal(model.canApproveOtherDevices, true);
});

test("UX8 pending device takes precedence and can recover only with server recovery", () => {
  const model = deriveCryptoSecurityViewModel(
    inputs({
      runtimeStatus: {
        available: true,
        cryptoDeviceId: "crypto-current",
        trustState: "pending",
        errorCode: null,
      },
      partnershipState: null,
      localGroup: null,
      localRecovery: { configured: false, recoveryKeyVersion: null },
    }),
  );
  assert.equal(model.primaryTask, "device_pending");
  assert.equal(model.currentDeviceTrust, "pending");
  assert.equal(model.recovery, "pending_can_recover");
  assert.equal(model.canUseRecoveryKeyHere, true);
  assert.equal(model.canApproveOtherDevices, false);
  assert.equal(model.protectedWrites, "blocked_device_pending");
});

test("UX8 recovery setup is an actionable task without broadening pre-S1 authority", () => {
  const model = deriveCryptoSecurityViewModel(
    inputs({
      serverRecovery: { configured: false },
      localRecovery: { configured: false, recoveryKeyVersion: null },
      partnershipState: {
        ...READY_PARTNERSHIP,
        cryptoRequired: false,
        cryptoRequiredFrom: null,
      },
      localGroup: {
        available: true,
        groupGeneration: 1,
        cryptoRequired: false,
        rekeyRequired: false,
      },
    }),
  );
  assert.equal(model.primaryTask, "recovery_not_configured");
  assert.equal(model.protectedWrites, "allowed");
});

test("UX8 rekey pauses protected writes while leaving recovery healthy", () => {
  const model = deriveCryptoSecurityViewModel(
    inputs({
      partnershipState: {
        ...READY_PARTNERSHIP,
        group: { ...READY_PARTNERSHIP.group, rekeyRequired: true },
      },
      localGroup: {
        available: true,
        groupGeneration: 1,
        cryptoRequired: true,
        rekeyRequired: true,
      },
    }),
  );
  assert.equal(model.primaryTask, "rekeying");
  assert.equal(model.partnership, "rekeying");
  assert.equal(model.protectedWrites, "blocked_rekey");
});

test("UX8 repair requires active lifecycle, recovery and missing local group", () => {
  const repair = deriveCryptoSecurityViewModel(
    inputs({
      localGroup: {
        available: false,
        groupGeneration: null,
        cryptoRequired: false,
        rekeyRequired: false,
      },
    }),
  );
  assert.equal(repair.primaryTask, "repair_required");
  assert.equal(repair.canOfferGroupRepair, true);
  assert.equal(repair.protectedWrites, "blocked_repair");

  const breakup = deriveCryptoSecurityViewModel(
    inputs({
      lifecycleState: "breakup_pending",
      interactionMode: "breakup_restricted",
      localGroup: {
        available: false,
        groupGeneration: null,
        cryptoRequired: false,
        rekeyRequired: false,
      },
    }),
  );
  assert.equal(breakup.canOfferGroupRepair, false);
  assert.notEqual(breakup.primaryTask, "repair_required");
});

test("UX8 shared account-deletion view-only does not impersonate a revoked session", () => {
  const model = deriveCryptoSecurityViewModel(
    inputs({ interactionMode: "account_deletion_view_only" }),
  );
  assert.notEqual(model.primaryTask, "session_invalid");
  assert.equal(model.currentDeviceTrust, "trusted");
});

test("UX8 revoked crypto device outranks lower-priority recovery state", () => {
  const model = deriveCryptoSecurityViewModel(
    inputs({
      runtimeStatus: {
        available: true,
        cryptoDeviceId: "crypto-current",
        trustState: "revoked",
        errorCode: null,
      },
      serverRecovery: { configured: false },
      localRecovery: { configured: false, recoveryKeyVersion: null },
      partnershipState: null,
      localGroup: null,
    }),
  );
  assert.equal(model.primaryTask, "session_invalid");
  assert.equal(model.protectedWrites, "blocked_session");
});

test("UX8 runtime starting is progress, not a false failure banner", () => {
  const model = deriveCryptoSecurityViewModel(
    inputs({
      runtimePresent: false,
      runtimeStatus: {
        available: false,
        cryptoDeviceId: null,
        trustState: null,
        errorCode: "CRYPTO_STARTING",
      },
      serverRecovery: null,
      localRecovery: null,
      partnershipState: null,
      localGroup: null,
    }),
  );
  assert.equal(model.runtime, "starting");
  assert.equal(model.primaryTask, "none");
});

test("UX8 provider reconciles the cached crypto device before deriving state", async () => {
  const provider = await source("../src/features/security/CryptoSecurityProvider.tsx");
  assert.equal(provider.includes("await currentRuntime.refreshDevice()"), true);
  assert.equal(provider.includes('"shawtie:security-changed"'), true);
  assert.equal(provider.includes("loadCryptoPartnershipState(partnershipId)"), true);
  assert.equal(provider.includes("authoritativeBeforeReconcile.group?.rekeyRequired"), true);
});

test("UX8 recovery UI never persists the readable RMS", async () => {
  const flow = await source("../src/features/security/CryptoRecoveryFlow.tsx");
  for (const forbidden of [
    "localStorage",
    "sessionStorage",
    "indexedDB",
    "caches.",
    "URLSearchParams",
    "download=",
  ]) {
    assert.equal(flow.includes(forbidden), false, forbidden);
  }
  assert.equal(flow.includes("navigator.clipboard"), true);
  assert.equal(flow.includes("Create recovery key"), true);
  assert.equal(flow.includes("I saved this recovery key somewhere I control."), true);
});

test("UX8 device approval does not introduce a second revoke authority", async () => {
  const deviceList = await source("../src/features/security/CryptoDeviceList.tsx");
  assert.equal(deviceList.includes("approveDevice"), true);
  assert.equal(deviceList.includes('method: "DELETE"'), false);
  assert.equal(deviceList.includes("revoke"), false);
});

test("UX8 protected content failures are per item and integrity failures fail closed", async () => {
  const decrypt = await source("../src/lib/crypto/projection-decryption.ts");
  const talk = await source("../src/features/messaging/TalkBubble.tsx");
  const ours = await source("../src/features/ours/OursItems.tsx");
  const media = await source("../src/features/media/MediaAttachment.tsx");

  assert.equal(decrypt.includes('"history_unavailable"'), true);
  assert.equal(decrypt.includes('"integrity_failed"'), true);
  assert.equal(decrypt.includes("protectedContentStateForError"), true);
  assert.equal(talk.includes("talk-text--protected-unavailable"), true);
  assert.equal(ours.includes("ours-crypto-unavailable"), true);
  assert.equal(media.includes("This protected attachment could not be safely verified."), true);
});

test("UX8 sealed R1 items never fall back to an internal kind label for recipients", async () => {
  const ours = await source("../src/features/ours/OursItems.tsx");
  assert.equal(
    ours.includes('sealedForMe ? "For later" : kindLabel(item.kind)'),
    true,
  );
});

test("UX8 account recovery copy explicitly separates protected history recovery", async () => {
  const app = await source("../src/app/App.tsx");
  assert.equal(
    app.includes(
      "Protected history still requires a trusted crypto device and, where needed, your recovery key.",
    ),
    true,
  );
});

test("UX8 calls do not gain an S1 E2EE claim", async () => {
  const calls = await source("../src/features/calling/CallingPanel.tsx");
  assert.equal(/end-to-end|e2ee/i.test(calls), false);
  assert.equal(calls.includes("Private relay calling"), true);
});

test("UX8 source additions contain no Unicode em dash", async () => {
  for (const file of [
    "../src/features/security/crypto-security-model.ts",
    "../src/features/security/crypto-copy.ts",
    "../src/features/security/CryptoSecurityProvider.tsx",
    "../src/features/security/CryptoRecoveryFlow.tsx",
    "../src/features/security/CryptoDeviceList.tsx",
    "../src/features/security/CryptoSecurityPanel.tsx",
    "../src/features/security/SecurityTaskCard.tsx",
    "./ux8.security.test.ts",
  ]) {
    assert.equal((await source(file)).includes(EM_DASH), false, file);
  }
});
