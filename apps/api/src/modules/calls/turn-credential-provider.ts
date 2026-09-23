import { createHash, createHmac } from "node:crypto";

export interface TurnCredential {
  readonly urls: readonly string[];
  readonly username: string;
  readonly credential: string;
  readonly expiresAt: Date;
  readonly iceTransportPolicy: "relay";
}

export interface TurnCredentialProvider {
  readonly available: boolean;
  issue(input: {
    readonly accountId: string;
    readonly callId: string;
    readonly now: Date;
  }): Promise<TurnCredential>;
}

export class DisabledTurnCredentialProvider implements TurnCredentialProvider {
  readonly available = false;

  async issue(): Promise<TurnCredential> {
    throw new Error("TURN_PROVIDER_UNAVAILABLE");
  }
}

export class HmacTurnCredentialProvider implements TurnCredentialProvider {
  readonly available = true;

  constructor(
    private readonly urls: readonly string[],
    private readonly sharedSecret: string,
    private readonly ttlMs: number,
  ) {
    if (urls.length === 0 || urls.some((url) => !/^turns?:/i.test(url))) {
      throw new Error("TURN_PROVIDER_URLS_INVALID");
    }
    if (!sharedSecret) throw new Error("TURN_PROVIDER_SECRET_REQUIRED");
    if (!Number.isInteger(ttlMs) || ttlMs <= 0 || ttlMs > 15 * 60_000) {
      throw new Error("TURN_PROVIDER_TTL_INVALID");
    }
  }

  async issue(input: {
    readonly accountId: string;
    readonly callId: string;
    readonly now: Date;
  }): Promise<TurnCredential> {
    const expiresAt = new Date(input.now.getTime() + this.ttlMs);
    const expirySeconds = Math.floor(expiresAt.getTime() / 1000);
    const opaqueSubject = createHash("sha256")
      .update(input.accountId + "\0" + input.callId)
      .digest("base64url")
      .slice(0, 32);
    const username = `${expirySeconds}:${opaqueSubject}`;
    const credential = createHmac("sha1", this.sharedSecret)
      .update(username)
      .digest("base64");

    return {
      urls: this.urls,
      username,
      credential,
      expiresAt,
      iceTransportPolicy: "relay",
    };
  }
}
