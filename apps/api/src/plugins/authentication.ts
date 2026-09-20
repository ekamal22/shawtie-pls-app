import type { FastifyRequest } from "fastify";
import {
  findSessionByVerifier,
  touchSession,
  type AuthenticatedSession,
  type DatabasePool,
} from "@shawtie/db";
import type { ApiConfig } from "../config.ts";
import { ApiError } from "../lib/api-error.ts";
import { AuthKeyRing } from "../security/auth-key-ring.ts";
import { cookieNames } from "../security/cookies.ts";

export interface AuthContext {
  readonly session: AuthenticatedSession;
  readonly rawToken: string;
}

export async function requireAuthentication(
  request: FastifyRequest,
  database: DatabasePool,
  config: ApiConfig,
  keys: AuthKeyRing,
): Promise<AuthContext> {
  const rawToken = request.cookies[cookieNames(config).session];
  if (!rawToken) throw new ApiError(401, "AUTH_REQUIRED");

  let session: AuthenticatedSession | null = null;
  for (const version of keys.versions) {
    session = await findSessionByVerifier(
      database.pool,
      keys.verifier("session-verifier", rawToken, version),
    );
    if (session) break;
  }
  if (!session) throw new ApiError(401, "AUTH_REQUIRED");

  const now = new Date();
  if (
    session.accountStatus !== "active" ||
    session.deviceRevokedAt !== null ||
    now.getTime() >= session.expiresAt.getTime() ||
    now.getTime() >= session.idleExpiresAt.getTime()
  ) {
    throw new ApiError(401, "AUTH_REQUIRED");
  }

  if (!session.lastSeenAt || now.getTime() - session.lastSeenAt.getTime() >= 5 * 60_000) {
    await touchSession(
      database.pool,
      session.sessionId,
      now,
      new Date(now.getTime() + 7 * 24 * 60 * 60_000),
    );
  }

  return { session, rawToken };
}

export function requireRecentReauthentication(session: AuthenticatedSession, now = new Date()): void {
  if (
    !session.reauthenticatedAt ||
    now.getTime() - session.reauthenticatedAt.getTime() > 10 * 60_000
  ) {
    throw new ApiError(403, "REAUTH_REQUIRED");
  }
}
