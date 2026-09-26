import type { FastifyInstance } from "fastify";
import {
  cryptoBootstrapSchema,
  cryptoCommitSchema,
  cryptoControlQuerySchema,
  cryptoDeviceApprovalSchema,
  cryptoDeviceEnrollSchema,
  cryptoDeviceIdParamsSchema,
  cryptoKeyPackageUploadSchema,
  cryptoPartnershipIdParamsSchema,
  cryptoRecoveryChallengeSchema,
  cryptoRecoveryProofSchema,
  cryptoRecoverySetupSchema,
  parseAtBoundary,
} from "@shawtie/contracts";
import type { DatabasePool } from "@shawtie/db";
import type { ApiConfig } from "../../config.ts";
import {
  requireAuthentication,
  requireRecentReauthentication,
} from "../../plugins/authentication.ts";
import type { AuthKeyRing } from "../../security/auth-key-ring.ts";
import type { CryptoService } from "./crypto-service.ts";

interface CryptoRouteDependencies {
  readonly database: DatabasePool;
  readonly config: ApiConfig;
  readonly keys: AuthKeyRing;
  readonly service: CryptoService;
}

function privateNoStore(reply: { header(name: string, value: string): unknown }): void {
  reply.header("cache-control", "private, no-store");
}

export function registerCryptoRoutes(
  app: FastifyInstance,
  deps: CryptoRouteDependencies,
): void {
  const { database, config, keys, service } = deps;

  app.get("/api/v1/crypto/devices/current", async (request, reply) => {
    const auth = await requireAuthentication(request, database, config, keys);
    privateNoStore(reply);
    return service.currentDevice(auth);
  });

  app.get("/api/v1/crypto/devices", async (request, reply) => {
    const auth = await requireAuthentication(request, database, config, keys);
    privateNoStore(reply);
    return service.devices(auth);
  });

  app.post("/api/v1/crypto/devices/enroll", async (request, reply) => {
    const auth = await requireAuthentication(request, database, config, keys);
    await requireRecentReauthentication(auth.session, database);
    const input = parseAtBoundary(cryptoDeviceEnrollSchema, request.body);
    privateNoStore(reply);
    return service.enroll(auth, input);
  });

  app.post("/api/v1/crypto/devices/:cryptoDeviceId/key-packages", async (request, reply) => {
    const auth = await requireAuthentication(request, database, config, keys);
    const params = parseAtBoundary(cryptoDeviceIdParamsSchema, request.params);
    const input = parseAtBoundary(cryptoKeyPackageUploadSchema, request.body);
    privateNoStore(reply);
    return service.uploadKeyPackages(auth, params.cryptoDeviceId, input);
  });

  app.post("/api/v1/crypto/devices/:cryptoDeviceId/approve", async (request, reply) => {
    const auth = await requireAuthentication(request, database, config, keys);
    const params = parseAtBoundary(cryptoDeviceIdParamsSchema, request.params);
    const input = parseAtBoundary(cryptoDeviceApprovalSchema, request.body);
    privateNoStore(reply);
    return service.approveDevice(auth, params.cryptoDeviceId, input);
  });

  app.get("/api/v1/crypto/partnerships/:partnershipId/state", async (request, reply) => {
    const auth = await requireAuthentication(request, database, config, keys);
    const params = parseAtBoundary(cryptoPartnershipIdParamsSchema, request.params);
    privateNoStore(reply);
    return service.partnershipState(auth, params.partnershipId);
  });

  app.get("/api/v1/crypto/partnerships/:partnershipId/control", async (request, reply) => {
    const auth = await requireAuthentication(request, database, config, keys);
    const params = parseAtBoundary(cryptoPartnershipIdParamsSchema, request.params);
    const query = parseAtBoundary(cryptoControlQuerySchema, request.query);
    privateNoStore(reply);
    return service.controls(auth, params.partnershipId, query);
  });

  app.post("/api/v1/crypto/partnerships/:partnershipId/bootstrap", async (request, reply) => {
    const auth = await requireAuthentication(request, database, config, keys);
    const params = parseAtBoundary(cryptoPartnershipIdParamsSchema, request.params);
    const input = parseAtBoundary(cryptoBootstrapSchema, request.body);
    privateNoStore(reply);
    return service.bootstrap(auth, params.partnershipId, input);
  });

  app.post("/api/v1/crypto/partnerships/:partnershipId/commits", async (request, reply) => {
    const auth = await requireAuthentication(request, database, config, keys);
    const params = parseAtBoundary(cryptoPartnershipIdParamsSchema, request.params);
    const input = parseAtBoundary(cryptoCommitSchema, request.body);
    privateNoStore(reply);
    return service.commit(auth, params.partnershipId, input);
  });

  app.post("/api/v1/crypto/recovery/setup", async (request, reply) => {
    const auth = await requireAuthentication(request, database, config, keys);
    await requireRecentReauthentication(auth.session, database);
    const input = parseAtBoundary(cryptoRecoverySetupSchema, request.body);
    privateNoStore(reply);
    return service.setupRecovery(auth, input);
  });

  app.get("/api/v1/crypto/recovery/bundle", async (request, reply) => {
    const auth = await requireAuthentication(request, database, config, keys);
    privateNoStore(reply);
    return service.recoveryBundle(auth);
  });

  app.post("/api/v1/crypto/recovery/challenge", async (request, reply) => {
    const auth = await requireAuthentication(request, database, config, keys);
    const input = parseAtBoundary(cryptoRecoveryChallengeSchema, request.body);
    privateNoStore(reply);
    return service.createRecoveryChallenge(auth, input);
  });

  app.post("/api/v1/crypto/recovery/prove", async (request, reply) => {
    const auth = await requireAuthentication(request, database, config, keys);
    const input = parseAtBoundary(cryptoRecoveryProofSchema, request.body);
    privateNoStore(reply);
    return service.proveRecovery(auth, input);
  });
}
