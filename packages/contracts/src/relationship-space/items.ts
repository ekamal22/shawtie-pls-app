import { z } from "zod";
import {
  encryptedProtectedContentProjectionSchema,
  encryptedProtectedContentSchema,
} from "../crypto/protected-content.ts";

const uuid = z.string().uuid();
const timestamp = z.string().min(20).max(40);
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const version = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const MAX_TEXT = 16_384;
const MAX_SHORT = 512;

export const relationshipItemKindSchema = z.enum([
  "memory",
  "remember_this",
  "first",
  "place",
  "for_you",
  "future_us",
  "love",
  "someday",
  "our_year",
  "anniversary",
  "surprise",
  "reunion",
  "proposal",
  "relationship_signal",
]);

export type RelationshipItemKindInput = z.infer<typeof relationshipItemKindSchema>;

const occurrenceDaySchema = z
  .object({
    precision: z.literal("day"),
    year: z.number().int().min(1900).max(9999),
    month: z.number().int().min(1).max(12),
    day: z.number().int().min(1).max(31),
  })
  .strict();

const occurrenceMonthSchema = z
  .object({
    precision: z.literal("month"),
    year: z.number().int().min(1900).max(9999),
    month: z.number().int().min(1).max(12),
    day: z.null().default(null),
  })
  .strict();

const occurrenceYearSchema = z
  .object({
    precision: z.literal("year"),
    year: z.number().int().min(1900).max(9999),
    month: z.null().default(null),
    day: z.null().default(null),
  })
  .strict();

const occurrenceUnknownSchema = z
  .object({
    precision: z.literal("unknown"),
    year: z.null().default(null),
    month: z.null().default(null),
    day: z.null().default(null),
  })
  .strict();

export const relationshipOccurrenceSchema = z
  .union([
    occurrenceDaySchema,
    occurrenceMonthSchema,
    occurrenceYearSchema,
    occurrenceUnknownSchema,
  ])
  .nullable();

export type RelationshipOccurrenceInput = z.infer<typeof relationshipOccurrenceSchema>;

const immediateReleaseSchema = z
  .object({
    mode: z.literal("immediate"),
    unlockAt: z.null().default(null),
  })
  .strict();

const scheduledReleaseSchema = z
  .object({
    mode: z.literal("scheduled"),
    unlockAt: timestamp,
  })
  .strict();

const recipientOpenReleaseSchema = z
  .object({
    mode: z.literal("recipient_open"),
    unlockAt: z.null().default(null),
  })
  .strict();

const creatorRevealReleaseSchema = z
  .object({
    mode: z.literal("creator_reveal"),
    unlockAt: z.null().default(null),
  })
  .strict();

export const relationshipReleaseInputSchema = z.union([
  immediateReleaseSchema,
  scheduledReleaseSchema,
  recipientOpenReleaseSchema,
  creatorRevealReleaseSchema,
]);

export type RelationshipReleaseInput = z.infer<typeof relationshipReleaseInputSchema>;

export const relationshipReferenceSchema = z.discriminatedUnion("referenceType", [
  z
    .object({
      referenceType: z.literal("message"),
      referenceId: uuid,
      role: z.literal("source"),
      position: z.number().int().min(0).max(31),
    })
    .strict(),
  z
    .object({
      referenceType: z.literal("media"),
      referenceId: uuid,
      role: z.enum(["attachment", "voice_letter"]),
      position: z.number().int().min(0).max(31),
    })
    .strict(),
]);

export type RelationshipReferenceInput = z.infer<typeof relationshipReferenceSchema>;

export const relationshipLinkSchema = z
  .object({
    linkType: z.enum(["curation", "prepared_content"]),
    targetItemId: uuid,
    position: z.number().int().min(0).max(99),
  })
  .strict();

export type RelationshipLinkInput = z.infer<typeof relationshipLinkSchema>;

const somedayFeatureStateSchema = z
  .object({
    type: z.literal("someday"),
    state: z.enum(["someday", "soon", "completed"]),
  })
  .strict();

const signalFeatureStateSchema = z
  .object({
    type: z.literal("relationship_signal"),
    signalKind: z.enum([
      "i_need_you",
      "call_me_when_you_can",
      "i_need_reassurance",
      "shared_feeling",
      "thinking_of_you",
      "kiss",
      "hug",
    ]),
  })
  .strict();

const reunionFeatureStateSchema = z
  .object({
    type: z.literal("reunion"),
    targetDate: calendarDate,
  })
  .strict();

const curationFeatureStateSchema = z
  .object({
    type: z.literal("curation"),
    curationType: z.enum(["our_year", "anniversary"]),
    anchorYear: z.number().int().min(1900).max(9999),
  })
  .strict();

export const relationshipFeatureStateSchema = z.union([
  somedayFeatureStateSchema,
  signalFeatureStateSchema,
  reunionFeatureStateSchema,
  curationFeatureStateSchema,
]);

export type RelationshipFeatureStateInput = z.infer<typeof relationshipFeatureStateSchema>;

const simpleContentSchema = z
  .object({
    title: z.string().min(1).max(MAX_SHORT),
    note: z.string().max(MAX_TEXT).nullable().optional(),
  })
  .strict();

const rememberContentSchema = z
  .object({
    title: z.string().max(MAX_SHORT).nullable().optional(),
    snapshotText: z.string().max(MAX_TEXT).nullable().optional(),
    note: z.string().max(MAX_TEXT).nullable().optional(),
  })
  .strict()
  .refine(
    (value) =>
      Boolean(value.title?.trim()) ||
      Boolean(value.snapshotText?.trim()) ||
      Boolean(value.note?.trim()),
    { message: "remember_this content cannot be empty" },
  );

const placeContentSchema = z
  .object({
    title: z.string().min(1).max(MAX_SHORT),
    note: z.string().max(MAX_TEXT).nullable().optional(),
    latitude: z.number().min(-90).max(90).nullable().optional(),
    longitude: z.number().min(-180).max(180).nullable().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const hasLatitude = value.latitude !== undefined && value.latitude !== null;
    const hasLongitude = value.longitude !== undefined && value.longitude !== null;
    if (hasLatitude !== hasLongitude) {
      context.addIssue({
        code: "custom",
        message: "latitude and longitude must be supplied together",
      });
    }
  });

const deliveryPreviewSchema = z
  .object({
    title: z.string().max(MAX_SHORT).nullable().optional(),
    conditionLabel: z.string().max(MAX_SHORT).nullable().optional(),
  })
  .strict();

const deliveryContentSchema = z
  .object({
    body: z.string().min(1).max(MAX_TEXT),
  })
  .strict();

const loveContentSchema = z
  .object({
    category: z.enum(["reason", "noticed", "remembered"]),
    text: z.string().min(1).max(MAX_TEXT),
  })
  .strict();

const curationContentSchema = z
  .object({
    title: z.string().max(MAX_SHORT).nullable().optional(),
    note: z.string().max(MAX_TEXT).nullable().optional(),
  })
  .strict();

const reunionContentSchema = z
  .object({
    title: z.string().max(MAX_SHORT).nullable().optional(),
    note: z.string().max(MAX_TEXT).nullable().optional(),
  })
  .strict();

const sequencePreviewSchema = z
  .object({
    title: z.string().max(MAX_SHORT).nullable().optional(),
  })
  .strict();

const sequenceStepSchema = z
  .object({
    type: z.literal("text"),
    text: z.string().min(1).max(MAX_TEXT),
  })
  .strict();

const sequenceContentSchema = z
  .object({
    intro: z.string().max(MAX_TEXT).nullable().optional(),
    steps: z.array(sequenceStepSchema).max(50).default([]),
  })
  .strict();

const signalContentSchema = z
  .object({
    sharedFeelingText: z.string().max(MAX_TEXT).nullable().optional(),
  })
  .strict();

function baseShape() {
  return {
    contentSchemaVersion: z.literal(1),
    occurrence: relationshipOccurrenceSchema.default(null),
    storyIncluded: z.boolean().default(false),
    references: z.array(relationshipReferenceSchema).max(32).default([]),
    links: z.array(relationshipLinkSchema).max(100).default([]),
  };
}

const memoryCreateSchema = z
  .object({
    ...baseShape(),
    kind: z.literal("memory"),
    preview: z.null().default(null),
    content: simpleContentSchema,
    release: z.null().default(null),
    featureState: z.null().default(null),
  })
  .strict();

const rememberCreateSchema = z
  .object({
    ...baseShape(),
    kind: z.literal("remember_this"),
    preview: z.null().default(null),
    content: rememberContentSchema,
    release: z.null().default(null),
    featureState: z.null().default(null),
  })
  .strict();

const firstCreateSchema = z
  .object({
    ...baseShape(),
    kind: z.literal("first"),
    preview: z.null().default(null),
    content: simpleContentSchema,
    release: z.null().default(null),
    featureState: z.null().default(null),
  })
  .strict();

const placeCreateSchema = z
  .object({
    ...baseShape(),
    kind: z.literal("place"),
    preview: z.null().default(null),
    content: placeContentSchema,
    release: z.null().default(null),
    featureState: z.null().default(null),
  })
  .strict();

const forYouCreateSchema = z
  .object({
    ...baseShape(),
    kind: z.literal("for_you"),
    preview: deliveryPreviewSchema.nullable().default(null),
    content: deliveryContentSchema,
    release: z.union([immediateReleaseSchema, scheduledReleaseSchema, recipientOpenReleaseSchema]),
    featureState: z.null().default(null),
  })
  .strict();

const futureUsCreateSchema = z
  .object({
    ...baseShape(),
    kind: z.literal("future_us"),
    preview: deliveryPreviewSchema.nullable().default(null),
    content: deliveryContentSchema,
    release: z.union([immediateReleaseSchema, scheduledReleaseSchema, recipientOpenReleaseSchema]),
    featureState: z.null().default(null),
  })
  .strict();

const loveCreateSchema = z
  .object({
    ...baseShape(),
    kind: z.literal("love"),
    preview: z.null().default(null),
    content: loveContentSchema,
    release: z.null().default(null),
    featureState: z.null().default(null),
  })
  .strict();

const somedayCreateSchema = z
  .object({
    ...baseShape(),
    kind: z.literal("someday"),
    preview: z.null().default(null),
    content: simpleContentSchema,
    release: z.null().default(null),
    featureState: somedayFeatureStateSchema,
  })
  .strict();

const ourYearCreateSchema = z
  .object({
    ...baseShape(),
    kind: z.literal("our_year"),
    preview: z.null().default(null),
    content: curationContentSchema,
    release: z.null().default(null),
    featureState: curationFeatureStateSchema.extend({ curationType: z.literal("our_year") }),
  })
  .strict();

const anniversaryCreateSchema = z
  .object({
    ...baseShape(),
    kind: z.literal("anniversary"),
    preview: z.null().default(null),
    content: curationContentSchema,
    release: z.null().default(null),
    featureState: curationFeatureStateSchema.extend({ curationType: z.literal("anniversary") }),
  })
  .strict();

const surpriseCreateSchema = z
  .object({
    ...baseShape(),
    kind: z.literal("surprise"),
    preview: sequencePreviewSchema.nullable().default(null),
    content: sequenceContentSchema,
    release: z.union([immediateReleaseSchema, creatorRevealReleaseSchema]),
    featureState: z.null().default(null),
  })
  .strict();

const reunionCreateSchema = z
  .object({
    ...baseShape(),
    kind: z.literal("reunion"),
    preview: z.null().default(null),
    content: reunionContentSchema,
    release: z.null().default(null),
    featureState: reunionFeatureStateSchema,
  })
  .strict();

const proposalCreateSchema = z
  .object({
    ...baseShape(),
    kind: z.literal("proposal"),
    preview: sequencePreviewSchema.nullable().default(null),
    content: sequenceContentSchema,
    release: z.union([immediateReleaseSchema, creatorRevealReleaseSchema]),
    featureState: z.null().default(null),
  })
  .strict();

const signalCreateSchema = z
  .object({
    ...baseShape(),
    kind: z.literal("relationship_signal"),
    preview: z.null().default(null),
    content: signalContentSchema,
    occurrence: z.null().default(null),
    storyIncluded: z.literal(false).default(false),
    release: z.null().default(null),
    featureState: signalFeatureStateSchema,
    references: z.array(z.never()).max(0).default([]),
    links: z.array(z.never()).max(0).default([]),
  })
  .strict();

const plaintextRelationshipItemCreateSchema = z.discriminatedUnion("kind", [
  memoryCreateSchema,
  rememberCreateSchema,
  firstCreateSchema,
  placeCreateSchema,
  forYouCreateSchema,
  futureUsCreateSchema,
  loveCreateSchema,
  somedayCreateSchema,
  ourYearCreateSchema,
  anniversaryCreateSchema,
  surpriseCreateSchema,
  reunionCreateSchema,
  proposalCreateSchema,
  signalCreateSchema,
]);

const protectedRelationshipItemCreateSchema = z
  .object({
    itemId: uuid,
    kind: relationshipItemKindSchema,
    contentSchemaVersion: z.literal(1),
    preview: z.null().default(null),
    content: z.null().default(null),
    protectedPreview: encryptedProtectedContentSchema.nullable().default(null),
    protectedContent: encryptedProtectedContentSchema,
    occurrence: relationshipOccurrenceSchema.default(null),
    storyIncluded: z.boolean().default(false),
    release: relationshipReleaseInputSchema.nullable().default(null),
    featureState: relationshipFeatureStateSchema.nullable().default(null),
    references: z.array(relationshipReferenceSchema).max(32).default([]),
    links: z.array(relationshipLinkSchema).max(100).default([]),
  })
  .strict()
  .superRefine((value, context) => {
    const previewAllowed = ["for_you", "future_us", "surprise", "proposal"].includes(value.kind);
    if (!previewAllowed && value.protectedPreview !== null) {
      context.addIssue({
        code: "custom",
        path: ["protectedPreview"],
        message: "protected preview is not allowed for this relationship item kind",
      });
    }

    if (value.kind === "for_you" || value.kind === "future_us") {
      if (
        !value.release ||
        !["immediate", "scheduled", "recipient_open"].includes(value.release.mode) ||
        value.featureState !== null
      ) {
        context.addIssue({ code: "custom", message: "invalid protected delivery-item state" });
      }
      return;
    }
    if (value.kind === "surprise" || value.kind === "proposal") {
      if (
        !value.release ||
        !["immediate", "creator_reveal"].includes(value.release.mode) ||
        value.featureState !== null
      ) {
        context.addIssue({ code: "custom", message: "invalid protected sequence-item state" });
      }
      return;
    }
    if (value.kind === "someday") {
      if (value.release !== null || value.featureState?.type !== "someday") {
        context.addIssue({ code: "custom", message: "invalid protected someday state" });
      }
      return;
    }
    if (value.kind === "our_year") {
      if (
        value.release !== null ||
        value.featureState?.type !== "curation" ||
        value.featureState.curationType !== "our_year"
      ) {
        context.addIssue({ code: "custom", message: "invalid protected Our Year state" });
      }
      return;
    }
    if (value.kind === "anniversary") {
      if (
        value.release !== null ||
        value.featureState?.type !== "curation" ||
        value.featureState.curationType !== "anniversary"
      ) {
        context.addIssue({ code: "custom", message: "invalid protected anniversary state" });
      }
      return;
    }
    if (value.kind === "reunion") {
      if (value.release !== null || value.featureState?.type !== "reunion") {
        context.addIssue({ code: "custom", message: "invalid protected reunion state" });
      }
      return;
    }
    if (value.kind === "relationship_signal") {
      if (
        value.release !== null ||
        value.featureState?.type !== "relationship_signal" ||
        value.occurrence !== null ||
        value.storyIncluded ||
        value.references.length > 0 ||
        value.links.length > 0
      ) {
        context.addIssue({ code: "custom", message: "invalid protected relationship signal state" });
      }
      return;
    }
    if (value.release !== null || value.featureState !== null) {
      context.addIssue({ code: "custom", message: "invalid protected relationship item state" });
    }
  });

export const relationshipItemCreateSchema = z.union([
  plaintextRelationshipItemCreateSchema,
  protectedRelationshipItemCreateSchema,
]);

export type RelationshipItemCreateInput = z.infer<typeof relationshipItemCreateSchema>;

export const relationshipItemPatchSchema = z
  .object({
    expectedVersion: version,
    preview: z.record(z.string(), z.unknown()).nullable().optional(),
    content: z.record(z.string(), z.unknown()).optional(),
    protectedPreview: encryptedProtectedContentSchema.nullable().optional(),
    protectedContent: encryptedProtectedContentSchema.optional(),
    occurrence: relationshipOccurrenceSchema.optional(),
    storyIncluded: z.boolean().optional(),
    release: relationshipReleaseInputSchema.nullable().optional(),
    featureState: relationshipFeatureStateSchema.nullable().optional(),
    references: z.array(relationshipReferenceSchema).max(32).optional(),
    links: z.array(relationshipLinkSchema).max(100).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.preview !== undefined ||
      value.content !== undefined ||
      value.protectedPreview !== undefined ||
      value.protectedContent !== undefined ||
      value.occurrence !== undefined ||
      value.storyIncluded !== undefined ||
      value.release !== undefined ||
      value.featureState !== undefined ||
      value.references !== undefined ||
      value.links !== undefined,
    { message: "at least one mutation field is required" },
  )
  .superRefine((value, context) => {
    if (value.preview !== undefined && value.protectedPreview !== undefined) {
      context.addIssue({
        code: "custom",
        message: "preview and protectedPreview cannot be mutated together",
      });
    }
    if (value.content !== undefined && value.protectedContent !== undefined) {
      context.addIssue({
        code: "custom",
        message: "content and protectedContent cannot be mutated together",
      });
    }
  });

export type RelationshipItemPatchInput = z.infer<typeof relationshipItemPatchSchema>;

export const relationshipItemDeleteSchema = z
  .object({
    expectedVersion: version,
  })
  .strict();

export type RelationshipItemDeleteInput = z.infer<typeof relationshipItemDeleteSchema>;

export const relationshipItemReleaseSchema = z
  .object({
    expectedVersion: version,
  })
  .strict();

export type RelationshipItemReleaseInput = z.infer<typeof relationshipItemReleaseSchema>;

export const relationshipItemIdParamsSchema = z
  .object({
    itemId: uuid,
  })
  .strict();

export type RelationshipItemIdParams = z.infer<typeof relationshipItemIdParamsSchema>;

export const relationshipItemListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(30),
    cursor: z.string().min(1).max(4096).optional(),
    kind: relationshipItemKindSchema.optional(),
    sort: z.enum(["created_desc", "occurred_asc"]).default("created_desc"),
    storyOnly: z
      .preprocess(
        (value) =>
          value === "true" ? true : value === "false" || value === undefined ? false : value,
        z.boolean(),
      )
      .default(false),
    year: z.coerce.number().int().min(1900).max(9999).optional(),
  })
  .strict();

export type RelationshipItemListQuery = z.infer<typeof relationshipItemListQuerySchema>;

export const relationshipCreatedCursorSchema = z
  .object({
    v: z.literal(1),
    sort: z.literal("created_desc"),
    snapshotAt: timestamp,
    createdAt: timestamp,
    itemId: uuid,
    queryShape: z.string().min(1).max(256),
    binding: z.string().min(16).max(256),
  })
  .strict();

export const relationshipOccurredCursorSchema = z
  .object({
    v: z.literal(1),
    sort: z.literal("occurred_asc"),
    snapshotAt: timestamp,
    occurredYear: z.number().int().min(1900).max(10000),
    occurredMonth: z.number().int().min(0).max(13),
    occurredDay: z.number().int().min(0).max(32),
    itemId: uuid,
    queryShape: z.string().min(1).max(256),
    binding: z.string().min(16).max(256),
  })
  .strict();

export const relationshipItemCursorSchema = z.union([
  relationshipCreatedCursorSchema,
  relationshipOccurredCursorSchema,
]);

export type RelationshipItemCursor = z.infer<typeof relationshipItemCursorSchema>;

export const thisDayQuerySchema = z
  .object({
    on: calendarDate,
  })
  .strict();

export type ThisDayQuery = z.infer<typeof thisDayQuerySchema>;

export const ourYearParamsSchema = z
  .object({
    year: z.coerce.number().int().min(1900).max(9999),
  })
  .strict();

export type OurYearParams = z.infer<typeof ourYearParamsSchema>;

export const anniversaryQuerySchema = z
  .object({
    on: calendarDate.optional(),
  })
  .strict();

export type AnniversaryQuery = z.infer<typeof anniversaryQuerySchema>;

export const relationshipItemProjectionSchema = z.object({
  itemId: uuid,
  kind: relationshipItemKindSchema,
  creatorAccountId: uuid,
  version,
  createdAt: timestamp,
  updatedAt: timestamp,
  occurrence: relationshipOccurrenceSchema,
  storyIncluded: z.boolean(),
  release: z
    .object({
      mode: z.enum(["immediate", "scheduled", "recipient_open", "creator_reveal"]),
      generation: version,
      unlockAt: timestamp.nullable(),
      releasedAt: timestamp.nullable(),
      state: z.enum(["locked", "released"]),
    })
    .nullable(),
  featureState: relationshipFeatureStateSchema.nullable(),
  contentSchemaVersion: version,
  preview: z.record(z.string(), z.unknown()).nullable(),
  protectedPreview: encryptedProtectedContentProjectionSchema.nullable().default(null),
  content: z.record(z.string(), z.unknown()).nullable(),
  protectedContent: encryptedProtectedContentProjectionSchema.nullable().default(null),
  references: z.array(relationshipReferenceSchema),
  links: z.array(relationshipLinkSchema),
});

export type RelationshipItemProjection = z.infer<typeof relationshipItemProjectionSchema>;
