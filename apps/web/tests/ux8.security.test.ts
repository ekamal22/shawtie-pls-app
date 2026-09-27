import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { MessageProjection } from "@shawtie/contracts";
import {
  deriveCryptoSecurityViewModel,
  type CryptoSecurityInputs,
} from "../src/features/security/crypto-security-model.ts";
import {
  assertSecurityAuthorityCurrent,
  hasRecentReauthentication,
  isCurrentSecurityRefresh,
  isStaleSecurityAuthority,
  runScopedSecurityMutation,
  type SecurityAuthoritySnapshot,
} from "../src/features/security/security-authority.ts";
import type { S1CryptoRuntime } from "../src/lib/crypto/crypto-runtime.ts";
import { decryptMessageProjectionForView } from "../src/lib/crypto/projection-decryption.ts";

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

function inputs(overrides: Partial<CryptoSecurityInputs> = {}): CryptoSecurityInputs {
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
    reconciliationComplete: true,
    revision: "r1",
    ...overrides,
  } as CryptoSecurityInputs;
}

function authority(overrides: Partial<SecurityAuthoritySnapshot> = {}): SecurityAuthoritySnapshot {
  return {
    active: true,
    accountScope: "account:device:crypto-device",
    partnershipScope: "account:device:crypto-device:partnership:active:normal",
    revision: 4,
    ...overrides,
  };
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
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

test("UX8 shows rekey before reconciliation, then repair if rekey cannot progress", () => {
  const reconciling = deriveCryptoSecurityViewModel(
    inputs({
      partnershipState: {
        ...READY_PARTNERSHIP,
        group: { ...READY_PARTNERSHIP.group, rekeyRequired: true },
      },
      localGroup: {
        available: false,
        groupGeneration: null,
        cryptoRequired: false,
        rekeyRequired: false,
      },
      reconciliationComplete: false,
    }),
  );
  assert.equal(reconciling.partnership, "rekeying");
  assert.equal(reconciling.canOfferGroupRepair, false);

  const stalled = deriveCryptoSecurityViewModel(
    inputs({
      partnershipState: {
        ...READY_PARTNERSHIP,
        group: { ...READY_PARTNERSHIP.group, rekeyRequired: true },
      },
      localGroup: {
        available: false,
        groupGeneration: null,
        cryptoRequired: false,
        rekeyRequired: false,
      },
      reconciliationComplete: true,
    }),
  );
  assert.equal(stalled.partnership, "repair_required");
  assert.equal(stalled.canOfferGroupRepair, true);
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

test("UX8 recovery setup accepts only the A1 ten-minute reauthentication window", () => {
  const now = Date.parse("2026-09-27T12:00:00.000Z");
  assert.equal(hasRecentReauthentication(null, now), false);
  assert.equal(hasRecentReauthentication("invalid", now), false);
  assert.equal(hasRecentReauthentication("2026-09-27T11:50:00.000Z", now), true);
  assert.equal(hasRecentReauthentication("2026-09-27T11:49:59.999Z", now), false);
});

test("UX8 stale approval result cannot survive a newer revoke refresh", async () => {
  const pendingApproval = deferred<string>();
  const captured = authority();
  let current = captured;
  let reconciled = false;
  const result = runScopedSecurityMutation({
    captured,
    current: () => current,
    mutate: () => pendingApproval.promise,
    reconcile: async () => {
      reconciled = true;
      return true;
    },
  });

  current = authority({ revision: captured.revision + 1 });
  pendingApproval.resolve("approved");
  await assert.rejects(result, isStaleSecurityAuthority);
  assert.equal(reconciled, false);
});

test("UX8 recovery racing approval discards the stale RMS result", async () => {
  const pendingRecovery = deferred<{ recoveryMasterSecret: string }>();
  const captured = authority();
  let current = captured;
  const result = runScopedSecurityMutation({
    captured,
    current: () => current,
    mutate: () => pendingRecovery.promise,
    reconcile: async () => true,
  });

  current = authority({ revision: captured.revision + 1 });
  pendingRecovery.resolve({ recoveryMasterSecret: "must-not-reach-the-next-state" });
  await assert.rejects(result, isStaleSecurityAuthority);

  const canonical = deriveCryptoSecurityViewModel(inputs());
  assert.equal(canonical.currentDeviceTrust, "trusted");
  assert.equal(canonical.recovery, "configured_here");
});

test("UX8 account teardown clears action authority before an RMS can be revealed", async () => {
  const pendingSetup = deferred<{ recoveryMasterSecret: string }>();
  const captured = authority();
  let current = captured;
  const result = runScopedSecurityMutation({
    captured,
    current: () => current,
    mutate: () => pendingSetup.promise,
    reconcile: async () => true,
  });

  current = authority({ active: false, accountScope: "next-account" });
  pendingSetup.resolve({ recoveryMasterSecret: "old-account-secret" });
  await assert.rejects(result, isStaleSecurityAuthority);
});

test("UX8 partnership finalization discards approval and recovery results", async () => {
  const captured = authority();
  const finalized = authority({ partnershipScope: "account:device:crypto-device:none:none:none" });
  assert.throws(
    () => assertSecurityAuthorityCurrent(captured, finalized),
    isStaleSecurityAuthority,
  );
});

test("UX8 revoke and P3 lifecycle authority win while rekey is in flight", () => {
  const rekey = {
    ...READY_PARTNERSHIP,
    group: { ...READY_PARTNERSHIP.group, rekeyRequired: true },
  };
  const revoked = deriveCryptoSecurityViewModel(
    inputs({
      runtimeStatus: {
        available: true,
        cryptoDeviceId: "crypto-current",
        trustState: "revoked",
        errorCode: null,
      },
      partnershipState: rekey,
    }),
  );
  assert.equal(revoked.primaryTask, "session_invalid");
  assert.equal(revoked.protectedWrites, "blocked_session");

  const breakup = deriveCryptoSecurityViewModel(
    inputs({
      lifecycleState: "breakup_pending",
      interactionMode: "breakup_restricted",
      partnershipState: rekey,
    }),
  );
  assert.equal(breakup.partnership, "rekeying");
  assert.equal(breakup.canOfferGroupRepair, false);
});

test("UX8 foreground reconciliation restores pending and rekey states without reload", () => {
  const pending = deriveCryptoSecurityViewModel(
    inputs({
      runtimeStatus: {
        available: true,
        cryptoDeviceId: "crypto-current",
        trustState: "pending",
        errorCode: null,
      },
      partnershipState: null,
      localGroup: null,
    }),
  );
  const rekey = deriveCryptoSecurityViewModel(
    inputs({
      partnershipState: {
        ...READY_PARTNERSHIP,
        group: { ...READY_PARTNERSHIP.group, rekeyRequired: true },
      },
    }),
  );
  const ready = deriveCryptoSecurityViewModel(inputs({ revision: "resume-current" }));
  assert.equal(pending.primaryTask, "device_pending");
  assert.equal(rekey.primaryTask, "rekeying");
  assert.equal(ready.primaryTask, "none");
  assert.equal(ready.securityStateRevision, "resume-current");
});

test("UX8 request tickets reject stale device lists and older network projections", () => {
  assert.equal(isCurrentSecurityRefresh(7, 8), false);
  assert.equal(isCurrentSecurityRefresh(8, 8), true);
  assert.equal(isCurrentSecurityRefresh(8, 8, false), false);
});

test("UX8 repair aborts before mutation after reconciliation or lifecycle authority changes", async () => {
  for (const next of [
    authority({ revision: 5 }),
    authority({ partnershipScope: "account:device:crypto-device:partnership:breakup_pending" }),
  ]) {
    const preflight = deferred<void>();
    const captured = authority();
    let current = captured;
    let resets = 0;
    const action = runScopedSecurityMutation({
      captured,
      current: () => current,
      mutate: async () => {
        await preflight.promise;
        assertSecurityAuthorityCurrent(captured, current);
        resets += 1;
      },
      reconcile: async () => true,
    });
    current = next;
    preflight.resolve();
    await assert.rejects(action, isStaleSecurityAuthority);
    assert.equal(resets, 0);
  }
});

test("UX8 a newer verified message revision never reuses failed plaintext", async () => {
  let decryptAttempt = 0;
  const runtime = {
    decryptProtectedBytes: async () => {
      decryptAttempt += 1;
      if (decryptAttempt === 1) throw new Error("CRYPTO_SIGNATURE_INVALID");
      return new TextEncoder().encode("verified-new-revision");
    },
  } as unknown as S1CryptoRuntime;
  const protectedBody = {
    ciphertext: "ciphertext",
    envelope: {},
  } as MessageProjection["protectedBody"];
  const base = {
    messageId: "10000000-0000-4000-8000-000000000001",
    conversationId: "10000000-0000-4000-8000-000000000002",
    senderAccountId: "10000000-0000-4000-8000-000000000003",
    senderDeviceId: null,
    serverSequence: 1,
    contentVersion: 1,
    lastChangeSequence: 1,
    replyToMessageId: null,
    replyContext: null,
    body: "unverified-plaintext-must-not-render",
    protectedBody,
    createdAt: "2026-09-27T00:00:00.000Z",
    editedAt: null,
    deletedAt: null,
    reactions: [],
    attachments: [],
  } as MessageProjection;

  const failed = await decryptMessageProjectionForView(runtime, "partnership", base);
  assert.equal(failed.protectedContentState, "integrity_failed");
  assert.equal(failed.body, null);

  const verified = await decryptMessageProjectionForView(runtime, "partnership", {
    ...base,
    contentVersion: 2,
    lastChangeSequence: 2,
  });
  assert.equal(verified.protectedContentState, "available");
  assert.equal(verified.body, "verified-new-revision");
  assert.notEqual(verified.body, base.body);
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
  assert.equal(deviceList.includes("revokeCryptoDevice"), false);
  assert.equal(/onClick[^\n]*revoke/i.test(deviceList), false);
});

test("UX8 protected content failures are per item and integrity failures fail closed", async () => {
  const decrypt = await source("../src/lib/crypto/projection-decryption.ts");
  const relationshipApi = await source("../src/features/relationship-space/api.ts");
  const talk = await source("../src/features/messaging/TalkBubble.tsx");
  const ours = await source("../src/features/ours/OursItems.tsx");
  const media = await source("../src/features/media/MediaAttachment.tsx");

  assert.equal(decrypt.includes('"history_unavailable"'), true);
  assert.equal(decrypt.includes('"integrity_failed"'), true);
  assert.equal(decrypt.includes("protectedContentStateForError"), true);
  assert.equal(relationshipApi.includes('cryptoPreviewState: "available" as const'), true);
  assert.equal(relationshipApi.includes('cryptoContentState: "available" as const'), true);
  assert.equal(talk.includes("talk-text--protected-unavailable"), true);
  assert.equal(ours.includes("ours-crypto-unavailable"), true);
  assert.equal(media.includes("This protected attachment could not be safely verified."), true);
});

test("UX8 sealed R1 items never fall back to an internal kind label for recipients", async () => {
  const ours = await source("../src/features/ours/OursItems.tsx");
  assert.equal(ours.includes('sealedForMe ? "For later" : kindLabel(item.kind)'), true);
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
    "../src/features/security/security-authority.ts",
    "./ux8.security.test.ts",
  ]) {
    assert.equal((await source(file)).includes(EM_DASH), false, file);
  }
});
