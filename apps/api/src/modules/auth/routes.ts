import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  accountRecoveryCompleteSchema,
  dateOfBirthCorrectionSchema,
  deviceIdParamsSchema,
  deviceRenameSchema,
  emailChangeCompleteSchema,
  emailChangeStartSchema,
  loginSchema,
  parseAtBoundary,
  passwordRecoveryCompleteSchema,
  profileUpdateSchema,
  reauthenticateSchema,
  recoveryStartSchema,
  registrationResendSchema,
  registrationStartSchema,
  registrationVerifySchema,
  usernameChangeSchema,
} from "@shawtie/contracts";
import type { DatabasePool } from "@shawtie/db";
import type { ApiConfig } from "../../config.ts";
import { requireAuthentication, requireRecentReauthentication } from "../../plugins/authentication.ts";
import { AuthKeyRing } from "../../security/auth-key-ring.ts";
import {
  clearDeviceCookie,
  clearSessionCookie,
  cookieNames,
  setDeviceCookie,
  setSessionCookie,
} from "../../security/cookies.ts";
import { networkPrefix } from "../../security/normalization.ts";
import { AccountService } from "../accounts/account-service.ts";

interface RouteDependencies {
  readonly database: DatabasePool;
  readonly config: ApiConfig;
  readonly keys: AuthKeyRing;
  readonly service: AccountService;
}

function network(request: FastifyRequest): string {
  return networkPrefix(request.ip);
}

function deviceHandle(request: FastifyRequest, config: ApiConfig): string | undefined {
  return request.cookies[cookieNames(config).device];
}

function writeSessionCookies(
  reply: FastifyReply,
  config: ApiConfig,
  sessionToken: string,
  deviceToken?: string,
): void {
  setSessionCookie(reply, config, sessionToken);
  if (deviceToken) setDeviceCookie(reply, config, deviceToken);
}

export function registerAccountRoutes(app: FastifyInstance, deps: RouteDependencies): void {
  const { service, database, config, keys } = deps;

  app.post("/api/v1/auth/registration/start", async (request) => {
    const input = parseAtBoundary(registrationStartSchema, request.body);
    return service.startRegistration(input, network(request));
  });

  app.post("/api/v1/auth/registration/resend", async (request) => {
    const input = parseAtBoundary(registrationResendSchema, request.body);
    return service.resendRegistration(input.registrationIntentId, network(request));
  });

  app.post("/api/v1/auth/registration/verify", async (request, reply) => {
    const input = parseAtBoundary(registrationVerifySchema, request.body);
    const result = await service.verifyRegistration(input, deviceHandle(request, config));
    writeSessionCookies(
      reply,
      config,
      result.session.sessionToken,
      result.session.deviceToken,
    );
    return { accountId: result.accountId };
  });

  app.post("/api/v1/auth/login", async (request, reply) => {
    const input = parseAtBoundary(loginSchema, request.body);
    const result = await service.login(input, network(request), deviceHandle(request, config));
    writeSessionCookies(
      reply,
      config,
      result.session.sessionToken,
      result.session.deviceToken,
    );
    return { accountId: result.accountId };
  });

  app.get("/api/v1/auth/session", async (request) => {
    const auth = await requireAuthentication(request, database, config, keys);
    return {
      authenticated: true,
      accountId: auth.session.accountId,
      sessionId: auth.session.sessionId,
      deviceId: auth.session.deviceId,
      reauthenticatedAt: auth.session.reauthenticatedAt?.toISOString() ?? null,
    };
  });

  app.post("/api/v1/auth/logout", async (request, reply) => {
    const auth = await requireAuthentication(request, database, config, keys);
    await service.logout(auth);
    clearSessionCookie(reply, config);
    return { ok: true };
  });

  app.post("/api/v1/auth/reauthenticate", async (request, reply) => {
    const auth = await requireAuthentication(request, database, config, keys);
    const input = parseAtBoundary(reauthenticateSchema, request.body);
    const result = await service.reauthenticate(auth, input.password);
    setSessionCookie(reply, config, result.sessionToken);
    return { ok: true };
  });

  app.post("/api/v1/auth/password-recovery/start", async (request, reply) => {
    const input = parseAtBoundary(recoveryStartSchema, request.body);
    await service.startPasswordRecovery(input.identifier, network(request));
    void reply.status(202);
    return { accepted: true };
  });

  app.post("/api/v1/auth/password-recovery/complete", async (request) => {
    const input = parseAtBoundary(passwordRecoveryCompleteSchema, request.body);
    await service.completePasswordRecovery(input, network(request));
    return { ok: true };
  });

  app.post("/api/v1/auth/account-recovery/start", async (request, reply) => {
    const input = parseAtBoundary(recoveryStartSchema, request.body);
    await service.startAccountRecovery(input.identifier, network(request));
    void reply.status(202);
    return { accepted: true };
  });

  app.post("/api/v1/auth/account-recovery/complete", async (request) => {
    const input = parseAtBoundary(accountRecoveryCompleteSchema, request.body);
    await service.completeAccountRecovery(input, network(request));
    return { ok: true };
  });

  app.get("/api/v1/me", async (request) => {
    const auth = await requireAuthentication(request, database, config, keys);
    return service.getMe(auth.session.accountId);
  });

  app.patch("/api/v1/me/profile", async (request) => {
    const auth = await requireAuthentication(request, database, config, keys);
    const input = parseAtBoundary(profileUpdateSchema, request.body);
    await service.updateProfile(auth.session.accountId, input);
    return { ok: true };
  });

  app.post("/api/v1/me/email-change/start", async (request) => {
    const auth = await requireAuthentication(request, database, config, keys);
    await requireRecentReauthentication(auth.session, database);
    const input = parseAtBoundary(emailChangeStartSchema, request.body);
    await service.startEmailChange(auth, input, network(request));
    return { ok: true };
  });

  app.post("/api/v1/me/email-change/resend", async (request) => {
    const auth = await requireAuthentication(request, database, config, keys);
    await requireRecentReauthentication(auth.session, database);
    await service.resendEmailChange(auth, network(request));
    return { ok: true };
  });

  app.post("/api/v1/me/email-change/complete", async (request, reply) => {
    const auth = await requireAuthentication(request, database, config, keys);
    await requireRecentReauthentication(auth.session, database);
    const input = parseAtBoundary(emailChangeCompleteSchema, request.body);
    const result = await service.completeEmailChange(auth, input.code);
    setSessionCookie(reply, config, result.sessionToken);
    return { ok: true };
  });

  app.post("/api/v1/me/username", async (request) => {
    const auth = await requireAuthentication(request, database, config, keys);
    const input = parseAtBoundary(usernameChangeSchema, request.body);
    await service.changeUsername(auth, input);
    return { ok: true };
  });

  app.post("/api/v1/me/date-of-birth-correction", async (request) => {
    const auth = await requireAuthentication(request, database, config, keys);
    const input = parseAtBoundary(dateOfBirthCorrectionSchema, request.body);
    await service.correctDateOfBirth(auth, input);
    return { ok: true };
  });

  app.post("/api/v1/me/account-deletion", async (request, reply) => {
    const auth = await requireAuthentication(request, database, config, keys);
    await requireRecentReauthentication(auth.session, database);
    await service.requestDeletion(auth);
    clearSessionCookie(reply, config);
    return { ok: true };
  });

  app.get("/api/v1/me/devices", async (request) => {
    const auth = await requireAuthentication(request, database, config, keys);
    const devices = await service.listDevices(auth.session.accountId);
    return {
      devices: devices.map((device) => ({
        ...device,
        isCurrent: device.id === auth.session.deviceId,
      })),
    };
  });

  app.patch("/api/v1/me/devices/:deviceId", async (request) => {
    const auth = await requireAuthentication(request, database, config, keys);
    const params = parseAtBoundary(deviceIdParamsSchema, request.params);
    const input = parseAtBoundary(deviceRenameSchema, request.body);
    await service.renameDevice(auth.session.accountId, params.deviceId, input.displayName);
    return { ok: true };
  });

  app.delete("/api/v1/me/devices/:deviceId", async (request, reply) => {
    const auth = await requireAuthentication(request, database, config, keys);
    const params = parseAtBoundary(deviceIdParamsSchema, request.params);
    const result = await service.revokeDevice(auth, params.deviceId);
    if (result.currentDeviceRevoked) {
      clearSessionCookie(reply, config);
      clearDeviceCookie(reply, config);
    }
    return { ok: true };
  });
}
