import { decryptMedia, encryptMedia, mediaCryptoAvailable } from "../src/lib/media/crypto-port.ts";
import {
  deleteMediaDraft,
  listMediaDrafts,
  purgeMediaAccountData,
  purgeMediaPartnershipData,
  saveMediaDraft,
} from "../src/lib/media/media-local-db.ts";
import type { LocalMediaDraft } from "../src/lib/media/media-types.ts";

async function sha256(blob: Blob): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const api = {
  cryptoAvailable() {
    return mediaCryptoAvailable();
  },
  async encryptRoundTrip(text: string) {
    const source = new Blob([text], { type: "text/plain" });
    const encrypted = await encryptMedia(source);
    const decrypted = await decryptMedia(encrypted.ciphertext, encrypted.protocolVersion);
    const ciphertext = new Uint8Array(await encrypted.ciphertext.arrayBuffer());
    return {
      protocolVersion: encrypted.protocolVersion,
      ciphertextBytes: encrypted.ciphertext.size,
      ciphertextHex: [...ciphertext].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
      plaintext: await decrypted.text(),
    };
  },
  async seedDraft(input: {
    accountId: string;
    partnershipId: string;
    ownerContext: "chat" | "relationship";
    draftId: string;
    plaintext: string;
  }) {
    const encrypted = await encryptMedia(new Blob([input.plaintext], { type: "text/plain" }));
    const now = Date.now();
    const draft: LocalMediaDraft = {
      draftId: input.draftId,
      accountId: input.accountId,
      partnershipId: input.partnershipId,
      ownerContext: input.ownerContext,
      kind: "file",
      formatCode: "text",
      role: "attachment",
      ciphertext: encrypted.ciphertext,
      ciphertextBytes: encrypted.ciphertext.size,
      ciphertextSha256: await sha256(encrypted.ciphertext),
      cryptoProtocolVersion: encrypted.protocolVersion,
      contentEnvelope: null,
      durationSeconds: null,
      idempotencyKey: "m3-e2e-" + input.draftId,
      mediaId: null,
      uploadGeneration: null,
      state: "prepared",
      createdAt: now,
      updatedAt: now,
      errorCode: null,
    };
    await saveMediaDraft(draft);
  },
  async list(accountId: string, partnershipId: string, ownerContext?: "chat" | "relationship") {
    const drafts = await listMediaDrafts(accountId, partnershipId, ownerContext);
    return Promise.all(
      drafts.map(async (draft) => ({
        ...draft,
        ciphertext: undefined,
        ciphertextText: await draft.ciphertext.text(),
      })),
    );
  },
  async remove(accountId: string, draftId: string) {
    await deleteMediaDraft(accountId, draftId);
  },
  async purgePartnership(accountId: string, partnershipId: string) {
    await purgeMediaPartnershipData(accountId, partnershipId);
  },
  async purgeAccount(accountId: string) {
    await purgeMediaAccountData(accountId);
  },
};

declare global {
  interface Window {
    m3Harness: typeof api;
  }
}

window.m3Harness = api;
document.querySelector("#status")!.textContent = "ready";
