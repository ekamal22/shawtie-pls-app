import type { FastifyReply } from "fastify";
import type { ApiConfig } from "../config.ts";

export interface CookieNames {
  readonly session: string;
  readonly device: string;
}

export function cookieNames(config: ApiConfig): CookieNames {
  const insecure =
    config.environment !== "production" && config.allowInsecureLoopbackCookies;
  return insecure
    ? { session: "shawtie-session-dev", device: "shawtie-device-dev" }
    : { session: "__Host-shawtie-session", device: "__Host-shawtie-device" };
}

function secure(config: ApiConfig): boolean {
  return !(config.environment !== "production" && config.allowInsecureLoopbackCookies);
}

export function setSessionCookie(
  reply: FastifyReply,
  config: ApiConfig,
  value: string,
  maxAgeSeconds = 30 * 24 * 60 * 60,
): void {
  reply.setCookie(cookieNames(config).session, value, {
    path: "/",
    httpOnly: true,
    secure: secure(config),
    sameSite: "strict",
    maxAge: maxAgeSeconds,
  });
}

export function clearSessionCookie(reply: FastifyReply, config: ApiConfig): void {
  reply.clearCookie(cookieNames(config).session, {
    path: "/",
    httpOnly: true,
    secure: secure(config),
    sameSite: "strict",
  });
}

export function setDeviceCookie(
  reply: FastifyReply,
  config: ApiConfig,
  value: string,
): void {
  reply.setCookie(cookieNames(config).device, value, {
    path: "/",
    httpOnly: true,
    secure: secure(config),
    sameSite: "strict",
    maxAge: 365 * 24 * 60 * 60,
  });
}

export function clearDeviceCookie(reply: FastifyReply, config: ApiConfig): void {
  reply.clearCookie(cookieNames(config).device, {
    path: "/",
    httpOnly: true,
    secure: secure(config),
    sameSite: "strict",
  });
}
