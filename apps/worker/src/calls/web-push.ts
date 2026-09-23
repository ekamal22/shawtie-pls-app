import {
  createCipheriv,
  createECDH,
  createHmac,
  createPrivateKey,
  randomBytes,
  sign,
} from "node:crypto";
import type { PushSubscriptionRecord } from "@shawtie/db";

export interface WebPushConfig {
  readonly subject: string;
  readonly publicKey: string;
  readonly privateKey: string;
}

const WEB_PUSH_REQUEST_TIMEOUT_MS = 10_000;

function base64url(value: Buffer): string {
  return value.toString("base64url");
}

function decodeBase64url(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

function hmac(key: Buffer, data: Buffer): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function hkdfExpand(prk: Buffer, info: Buffer, length: number): Buffer {
  const blocks: Buffer[] = [];
  let previous = Buffer.alloc(0);
  let counter = 1;
  while (Buffer.concat(blocks).length < length) {
    previous = hmac(
      prk,
      Buffer.concat([previous, info, Buffer.from([counter])]),
    );
    blocks.push(previous);
    counter += 1;
  }
  return Buffer.concat(blocks).subarray(0, length);
}

function vapidPrivateKey(config: WebPushConfig) {
  const publicBytes = decodeBase64url(config.publicKey);
  const privateBytes = decodeBase64url(config.privateKey);
  if (publicBytes.length !== 65 || publicBytes[0] !== 4 || privateBytes.length !== 32) {
    throw new Error("Invalid VAPID P-256 key material");
  }
  return createPrivateKey({
    key: {
      kty: "EC",
      crv: "P-256",
      x: base64url(publicBytes.subarray(1, 33)),
      y: base64url(publicBytes.subarray(33, 65)),
      d: base64url(privateBytes),
    },
    format: "jwk",
  });
}

function vapidAuthorization(
  endpoint: string,
  config: WebPushConfig,
  now: Date,
): string {
  const audience = new URL(endpoint).origin;
  const header = base64url(
    Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" }), "utf8"),
  );
  const payload = base64url(
    Buffer.from(
      JSON.stringify({
        aud: audience,
        exp: Math.floor(now.getTime() / 1000) + 12 * 60 * 60,
        sub: config.subject,
      }),
      "utf8",
    ),
  );
  const unsigned = `${header}.${payload}`;
  const signature = sign("sha256", Buffer.from(unsigned, "utf8"), {
    key: vapidPrivateKey(config),
    dsaEncoding: "ieee-p1363",
  });
  return `vapid t=${unsigned}.${base64url(signature)}, k=${config.publicKey}`;
}

function encryptPayload(
  subscription: PushSubscriptionRecord,
  payload: Buffer,
): Buffer {
  const receiverPublic = decodeBase64url(subscription.p256dh);
  const authSecret = decodeBase64url(subscription.auth);
  if (receiverPublic.length !== 65 || receiverPublic[0] !== 4 || authSecret.length < 16) {
    throw new Error("Invalid push subscription key material");
  }

  const sender = createECDH("prime256v1");
  sender.generateKeys();
  const senderPublic = sender.getPublicKey();
  const sharedSecret = sender.computeSecret(receiverPublic);

  const authPrk = hmac(authSecret, sharedSecret);
  const keyInfo = Buffer.concat([
    Buffer.from("WebPush: info\0", "utf8"),
    receiverPublic,
    senderPublic,
  ]);
  const ikm = hkdfExpand(authPrk, keyInfo, 32);

  const salt = randomBytes(16);
  const prk = hmac(salt, ikm);
  const cek = hkdfExpand(
    prk,
    Buffer.from("Content-Encoding: aes128gcm\0", "utf8"),
    16,
  );
  const nonce = hkdfExpand(
    prk,
    Buffer.from("Content-Encoding: nonce\0", "utf8"),
    12,
  );

  const plaintext = Buffer.concat([payload, Buffer.from([2])]);
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const ciphertext = Buffer.concat([encrypted, tag]);

  const recordSize = Buffer.alloc(4);
  recordSize.writeUInt32BE(4096, 0);
  return Buffer.concat([
    salt,
    recordSize,
    Buffer.from([senderPublic.length]),
    senderPublic,
    ciphertext,
  ]);
}

export async function sendWebPush(
  subscription: PushSubscriptionRecord,
  payload: unknown,
  config: WebPushConfig,
  signal: AbortSignal,
  now = new Date(),
): Promise<{ readonly delivered: boolean; readonly gone: boolean }> {
  const body = encryptPayload(
    subscription,
    Buffer.from(JSON.stringify(payload), "utf8"),
  );
  const requestController = new AbortController();
  const timeout = setTimeout(() => requestController.abort(), WEB_PUSH_REQUEST_TIMEOUT_MS);
  const abortFromWorker = () => requestController.abort(signal.reason);
  if (signal.aborted) abortFromWorker();
  else signal.addEventListener("abort", abortFromWorker, { once: true });

  let response: Response;
  try {
    response = await fetch(subscription.endpoint, {
      method: "POST",
      signal: requestController.signal,
      headers: {
        authorization: vapidAuthorization(subscription.endpoint, config, now),
        "content-encoding": "aes128gcm",
        "content-type": "application/octet-stream",
        ttl: "60",
        urgency: "high",
      },
      body,
    });
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abortFromWorker);
  }
  if (response.status === 404 || response.status === 410) {
    return { delivered: false, gone: true };
  }
  if (!response.ok) {
    throw new Error("WEB_PUSH_PROVIDER_FAILED_" + response.status);
  }
  return { delivered: true, gone: false };
}

export function webPushConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): WebPushConfig | null {
  const subject = env.C1_PUSH_VAPID_SUBJECT;
  const publicKey = env.C1_PUSH_VAPID_PUBLIC_KEY;
  const privateKey = env.C1_PUSH_VAPID_PRIVATE_KEY;
  if (!subject && !publicKey && !privateKey) return null;
  if (!subject || !publicKey || !privateKey) {
    throw new Error(
      "C1 push requires C1_PUSH_VAPID_SUBJECT, C1_PUSH_VAPID_PUBLIC_KEY, and C1_PUSH_VAPID_PRIVATE_KEY",
    );
  }
  if (!subject.startsWith("mailto:") && !subject.startsWith("https://")) {
    throw new Error("C1_PUSH_VAPID_SUBJECT must be mailto: or https:");
  }
  return { subject, publicKey, privateKey };
}
