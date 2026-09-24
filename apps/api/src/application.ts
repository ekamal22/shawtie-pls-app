import { randomUUID } from "node:crypto";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import websocket from "@fastify/websocket";
import {
  C1_REALTIME_SUBPROTOCOL,
  C1_SIGNALING_MAX_FRAME_BYTES,
  C1_SIGNALING_SUBPROTOCOL,
  M2_REALTIME_MAX_FRAME_BYTES,
  M2_REALTIME_SUBPROTOCOL,
} from "@shawtie/contracts";
import type { MediaObjectStore } from "@shawtie/media-storage";
import Fastify, { type FastifyInstance } from "fastify";
import {
  bindMediaObject,
  insertScheduledAction,
  loadCurrentConversationReadModel,
  lockMediaObject,
  markMediaDeletionPending,
  messageExistsInConversation,
  type DatabasePool,
} from "@shawtie/db";
import { mediaRoleAllowed } from "@shawtie/domain";
import { resolveCallingConfig, resolveMediaApiConfig, type ApiConfig } from "./config.ts";
import { AccountService } from "./modules/accounts/account-service.ts";
import { CallingService } from "./modules/calls/calling-service.ts";
import { registerCallingRoutes } from "./modules/calls/routes.ts";
import { CallSignalingHub } from "./modules/calls/signaling-hub.ts";
import {
  DisabledTurnCredentialProvider,
  HmacTurnCredentialProvider,
} from "./modules/calls/turn-credential-provider.ts";
import {
  PartnerRequestService,
  type PartnershipFormationCoordinator,
} from "./modules/partner-requests/partner-request-service.ts";
import { registerPartnerRequestRoutes } from "./modules/partner-requests/routes.ts";
import { registerAccountRoutes } from "./modules/auth/routes.ts";
import { MessagingService } from "./modules/messages/messaging-service.ts";
import { registerMessagingRoutes } from "./modules/messages/routes.ts";
import { MediaService } from "./modules/media/media-service.ts";
import { registerMediaRoutes } from "./modules/media/routes.ts";
import { NotificationService } from "./modules/notifications/notification-service.ts";
import { RealtimeHub } from "./modules/realtime/realtime-hub.ts";
import { RealtimeListener } from "./modules/realtime/realtime-listener.ts";
import {
  createRealtimeClientFrameHandler,
  registerRealtimeRoutes,
} from "./modules/realtime/routes.ts";
import { RealtimeTransientPublisher } from "./modules/realtime/transient-publisher.ts";
import { registerNotificationRoutes } from "./modules/notifications/routes.ts";
import { createP2PartnershipFormationCoordinator } from "./modules/partnerships/partnership-formation-coordinator.ts";
import { PartnershipService } from "./modules/partnerships/partnership-service.ts";
import { registerPartnershipRoutes } from "./modules/partnerships/routes.ts";
import { RelationshipSpaceService } from "./modules/relationship-space/relationship-space-service.ts";
import { registerRelationshipSpaceRoutes } from "./modules/relationship-space/routes.ts";
import { installErrorHandler } from "./plugins/errors.ts";
import { installM2Compatibility, installMutationSecurity } from "./plugins/request-security.ts";
import { AuthKeyRing } from "./security/auth-key-ring.ts";
import { PasswordHasher } from "./security/password-hasher.ts";

export interface ApiApplicationDependencies {
  readonly database: DatabasePool;
  readonly config: ApiConfig;
  readonly partnershipFormationCoordinator?: PartnershipFormationCoordinator;
  readonly mediaObjectStore?: MediaObjectStore | null;
}

export function createApiApplication(dependencies?: ApiApplicationDependencies): FastifyInstance {
  const app = Fastify({
    logger: false,
    trustProxy: dependencies?.config.trustedProxy ?? false,
  });

  app.get("/health", async () => ({ status: "ok" }));
  if (!dependencies) return app;

  app.register(cookie);
  app.register(websocket, {
    options: {
      maxPayload: Math.max(C1_SIGNALING_MAX_FRAME_BYTES, M2_REALTIME_MAX_FRAME_BYTES),
      perMessageDeflate: false,
      handleProtocols(protocols) {
        if (protocols.size !== 1) return false;
        const [protocol] = [...protocols];
        return protocol === M2_REALTIME_SUBPROTOCOL ||
          protocol === C1_REALTIME_SUBPROTOCOL ||
          protocol === C1_SIGNALING_SUBPROTOCOL
          ? protocol
          : false;
      },
    },
  });
  app.register(helmet);
  installErrorHandler(app);
  installM2Compatibility(app);
  installMutationSecurity(app, dependencies.config);

  const keys = new AuthKeyRing(dependencies.config.authKeys);
  const service = new AccountService(dependencies.database, keys, new PasswordHasher());
  registerAccountRoutes(app, {
    database: dependencies.database,
    config: dependencies.config,
    keys,
    service,
  });

  const partnerRequestMode = dependencies.config.partnerRequestMode ?? "disabled";
  const builtInFormationCoordinator = createP2PartnershipFormationCoordinator();
  const partnerRequestService = new PartnerRequestService(dependencies.database, service, {
    mode: partnerRequestMode,
    coordinator: dependencies.partnershipFormationCoordinator ?? builtInFormationCoordinator,
  });
  registerPartnerRequestRoutes(app, {
    database: dependencies.database,
    config: dependencies.config,
    keys,
    service: partnerRequestService,
    mode: partnerRequestMode,
  });

  const partnershipService = new PartnershipService(dependencies.database);
  registerPartnershipRoutes(app, {
    database: dependencies.database,
    config: dependencies.config,
    keys,
    service: partnershipService,
  });

  const notificationService = new NotificationService(dependencies.database);
  registerNotificationRoutes(app, {
    database: dependencies.database,
    config: dependencies.config,
    keys,
    service: notificationService,
  });

  const messagingService = new MessagingService(
    dependencies.database,
    keys,
    resolveMediaApiConfig(dependencies.config).bindingEnabled,
  );
  const mediaService = new MediaService(
    dependencies.database,
    keys,
    dependencies.config,
    dependencies.mediaObjectStore ?? null,
  );
  registerMessagingRoutes(app, {
    database: dependencies.database,
    config: dependencies.config,
    keys,
    service: messagingService,
  });
  registerMediaRoutes(app, {
    database: dependencies.database,
    config: dependencies.config,
    keys,
    service: mediaService,
  });

  const realtimePublisher = new RealtimeTransientPublisher(dependencies.database);
  const realtimeHub = new RealtimeHub(
    dependencies.database,
    keys,
    createRealtimeClientFrameHandler(messagingService, realtimePublisher),
  );
  const realtimeListener = new RealtimeListener(dependencies.database, realtimeHub);
  app.register(async function realtimeRoutes(realtimeApp) {
    registerRealtimeRoutes(realtimeApp, {
      database: dependencies.database,
      config: dependencies.config,
      keys,
      hub: realtimeHub,
    });
  });
  app.addHook("onReady", async () => {
    await realtimeListener.start();
  });
  app.addHook("onClose", async () => {
    await realtimeListener.stop();
    realtimeHub.close();
  });

  const callingConfig = resolveCallingConfig(dependencies.config);
  const turnProvider =
    callingConfig.turnUrls.length > 0 && callingConfig.turnSharedSecret
      ? new HmacTurnCredentialProvider(
          callingConfig.turnUrls,
          callingConfig.turnSharedSecret,
          callingConfig.turnCredentialTtlMs,
        )
      : new DisabledTurnCredentialProvider();
  const callingService = new CallingService(
    dependencies.database,
    dependencies.config,
    turnProvider,
    keys,
  );
  const callSignalingHub = new CallSignalingHub(dependencies.database, keys);
  app.register(async function callingRoutes(callingApp) {
    registerCallingRoutes(callingApp, {
      database: dependencies.database,
      config: dependencies.config,
      keys,
      service: callingService,
      signalingHub: callSignalingHub,
    });
  });
  app.addHook("onClose", async () => {
    callSignalingHub.close();
  });

  const relationshipSpaceService = new RelationshipSpaceService(dependencies.database, keys, {
    messageReferenceResolver: {
      async authorize(executor, input) {
        const conversation = await loadCurrentConversationReadModel(
          executor,
          input.actorAccountId,
          new Date(),
        );
        if (!conversation || conversation.partnershipId !== input.partnershipId) return false;
        return messageExistsInConversation(
          executor,
          conversation.conversationId,
          input.referenceId,
        );
      },
    },
    mediaReferenceResolver: {
      async authorize(executor, input) {
        if (!resolveMediaApiConfig(dependencies.config).bindingEnabled) return false;
        if (input.role !== "attachment" && input.role !== "voice_letter") return false;
        const media = await lockMediaObject(executor, input.referenceId);
        if (
          !media ||
          media.partnershipId !== input.partnershipId ||
          media.uploaderAccountId !== input.actorAccountId ||
          media.deletedAt !== null ||
          !mediaRoleAllowed(media.mediaKind, input.role)
        ) {
          return false;
        }
        if (media.state === "ready_unbound" && media.bindingId === null) return true;
        return Boolean(
          input.ownerItemId &&
          media.state === "bound" &&
          media.bindingType === "relationship_item" &&
          media.bindingId === input.ownerItemId &&
          media.bindingRole === input.role &&
          media.bindingPosition === input.position,
        );
      },
      async bind(executor, input) {
        if (!resolveMediaApiConfig(dependencies.config).bindingEnabled) return false;
        return bindMediaObject(executor, {
          mediaId: input.referenceId,
          bindingType: "relationship_item",
          bindingId: input.itemId,
          bindingRole: input.role,
          position: input.position,
        });
      },
      async revoke(executor, input) {
        const media = await lockMediaObject(executor, input.referenceId);
        if (
          !media ||
          media.partnershipId !== input.partnershipId ||
          media.bindingType !== "relationship_item" ||
          media.bindingId !== input.itemId ||
          media.state !== "bound"
        ) {
          return;
        }
        const generation = await markMediaDeletionPending(executor, media.id, input.at);
        if (generation === null) return;
        await insertScheduledAction(executor, {
          id: randomUUID(),
          actionType: "m3.media_delete",
          aggregateType: "media_object",
          aggregateId: media.id,
          executeAt: input.at,
          expectedGeneration: generation,
          deduplicationKey: "m3-media-delete:" + media.id + ":g:" + generation,
          payload: {},
          payloadVersion: 1,
        });
      },
    },
  });
  registerRelationshipSpaceRoutes(app, {
    database: dependencies.database,
    config: dependencies.config,
    keys,
    service: relationshipSpaceService,
  });

  return app;
}
