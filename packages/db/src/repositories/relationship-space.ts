import type { QueryExecutor } from "../types/query-executor.ts";

export type RelationshipItemKind =
  | "memory"
  | "remember_this"
  | "first"
  | "place"
  | "for_you"
  | "future_us"
  | "love"
  | "someday"
  | "our_year"
  | "anniversary"
  | "surprise"
  | "reunion"
  | "proposal"
  | "relationship_signal";

export type RelationshipReleaseMode =
  | "immediate"
  | "scheduled"
  | "recipient_open"
  | "creator_reveal";

export interface RelationshipItemRecord {
  readonly id: string;
  readonly partnershipId: string;
  readonly creatorAccountId: string;
  readonly kind: RelationshipItemKind;
  readonly version: bigint;
  readonly contentSchemaVersion: number;
  readonly developmentPreviewPayload: unknown | null;
  readonly developmentPlaintextPayload: unknown | null;
  readonly occurredPrecision: "day" | "month" | "year" | "unknown" | null;
  readonly occurredYear: number | null;
  readonly occurredMonth: number | null;
  readonly occurredDay: number | null;
  readonly releaseMode: RelationshipReleaseMode | null;
  readonly releaseGeneration: bigint;
  readonly unlockAt: Date | null;
  readonly releasedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly storyIncluded: boolean;
}

interface RelationshipItemRow {
  id: string;
  partnership_id: string;
  creator_account_id: string;
  kind: RelationshipItemKind;
  version: string | number | bigint;
  content_schema_version: number;
  development_preview_payload: unknown | null;
  development_plaintext_payload: unknown | null;
  occurred_precision: RelationshipItemRecord["occurredPrecision"];
  occurred_year: number | null;
  occurred_month: number | null;
  occurred_day: number | null;
  release_mode: RelationshipReleaseMode | null;
  release_generation: string | number | bigint;
  unlock_at: Date | null;
  released_at: Date | null;
  created_at: Date;
  updated_at: Date;
  story_included: boolean;
}

function mapItem(row: RelationshipItemRow): RelationshipItemRecord {
  return {
    id: row.id,
    partnershipId: row.partnership_id,
    creatorAccountId: row.creator_account_id,
    kind: row.kind,
    version: BigInt(row.version),
    contentSchemaVersion: row.content_schema_version,
    developmentPreviewPayload: row.development_preview_payload,
    developmentPlaintextPayload: row.development_plaintext_payload,
    occurredPrecision: row.occurred_precision,
    occurredYear: row.occurred_year,
    occurredMonth: row.occurred_month,
    occurredDay: row.occurred_day,
    releaseMode: row.release_mode,
    releaseGeneration: BigInt(row.release_generation),
    unlockAt: row.unlock_at,
    releasedAt: row.released_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    storyIncluded: row.story_included,
  };
}

const itemColumns = `
  item.id,
  item.partnership_id,
  item.creator_account_id,
  item.kind,
  item.version,
  item.content_schema_version,
  item.development_preview_payload,
  item.development_plaintext_payload,
  item.occurred_precision,
  item.occurred_year,
  item.occurred_month,
  item.occurred_day,
  item.release_mode,
  item.release_generation,
  item.unlock_at,
  item.released_at,
  item.created_at,
  item.updated_at,
  EXISTS (
    SELECT 1
    FROM relationship_story_members story
    WHERE story.partnership_id = item.partnership_id
      AND story.item_id = item.id
  ) AS story_included
`;

function occurredDate(input: {
  readonly precision: "day" | "month" | "year" | "unknown" | null;
  readonly year: number | null;
  readonly month: number | null;
  readonly day: number | null;
}): string | null {
  if (
    input.precision !== "day" ||
    input.year === null ||
    input.month === null ||
    input.day === null
  ) {
    return null;
  }
  return [
    String(input.year).padStart(4, "0"),
    String(input.month).padStart(2, "0"),
    String(input.day).padStart(2, "0"),
  ].join("-");
}

export async function insertRelationshipItem(
  executor: QueryExecutor,
  input: {
    readonly id: string;
    readonly partnershipId: string;
    readonly creatorAccountId: string;
    readonly kind: RelationshipItemKind;
    readonly contentSchemaVersion: number;
    readonly preview: unknown | null;
    readonly content: unknown | null;
    readonly occurredPrecision: RelationshipItemRecord["occurredPrecision"];
    readonly occurredYear: number | null;
    readonly occurredMonth: number | null;
    readonly occurredDay: number | null;
    readonly releaseMode: RelationshipReleaseMode | null;
    readonly releaseGeneration: bigint;
    readonly unlockAt: Date | null;
    readonly releasedAt: Date | null;
    readonly createdAt: Date;
  },
): Promise<void> {
  await executor.query(
    `INSERT INTO relationship_items (
       id, partnership_id, creator_account_id, kind, lifecycle, version,
       content_schema_version, development_preview_payload, development_plaintext_payload,
       occurred_date, occurred_precision, occurred_year, occurred_month, occurred_day,
       release_mode, release_generation, unlock_at, released_at, created_at, updated_at
     ) VALUES (
       $1,$2,$3,$4,'active',1,$5,$6::jsonb,$7::jsonb,$8::date,$9,$10,$11,$12,
       $13,$14,$15,$16,$17,$17
     )`,
    [
      input.id,
      input.partnershipId,
      input.creatorAccountId,
      input.kind,
      input.contentSchemaVersion,
      input.preview === null ? null : JSON.stringify(input.preview),
      input.content === null ? null : JSON.stringify(input.content),
      occurredDate({
        precision: input.occurredPrecision,
        year: input.occurredYear,
        month: input.occurredMonth,
        day: input.occurredDay,
      }),
      input.occurredPrecision,
      input.occurredYear,
      input.occurredMonth,
      input.occurredDay,
      input.releaseMode,
      input.releaseGeneration.toString(),
      input.unlockAt,
      input.releasedAt,
      input.createdAt,
    ],
  );
}

export async function loadRelationshipItem(
  executor: QueryExecutor,
  partnershipId: string,
  itemId: string,
): Promise<RelationshipItemRecord | null> {
  const result = await executor.query<RelationshipItemRow>(
    `SELECT ${itemColumns}
     FROM relationship_items item
     WHERE item.partnership_id = $1
       AND item.id = $2
       AND item.lifecycle = 'active'
     LIMIT 1`,
    [partnershipId, itemId],
  );
  const row = result.rows[0];
  return row ? mapItem(row) : null;
}

export async function lockRelationshipItemsByIds(
  executor: QueryExecutor,
  partnershipId: string,
  itemIds: readonly string[],
): Promise<readonly RelationshipItemRecord[]> {
  if (itemIds.length === 0) return [];
  const result = await executor.query<RelationshipItemRow>(
    `SELECT ${itemColumns}
     FROM relationship_items item
     WHERE item.partnership_id = $1
       AND item.id = ANY($2::uuid[])
       AND item.lifecycle = 'active'
     ORDER BY item.id
     FOR UPDATE OF item`,
    [partnershipId, [...itemIds]],
  );
  return result.rows.map(mapItem);
}

function visibilitySql(): string {
  return `(
    item.release_mode IS NULL
    OR item.released_at IS NOT NULL
    OR item.creator_account_id = $2
    OR item.development_preview_payload IS NOT NULL
    OR item.encrypted_preview_payload IS NOT NULL
  )`;
}

export async function listRelationshipItems(
  executor: QueryExecutor,
  input: {
    readonly partnershipId: string;
    readonly actorAccountId: string;
    readonly snapshotAt: Date;
    readonly kind?: RelationshipItemKind;
    readonly storyOnly: boolean;
    readonly year?: number;
    readonly sort: "created_desc" | "occurred_asc";
    readonly cursorCreatedAt?: Date;
    readonly cursorItemId?: string;
    readonly cursorOccurredYear?: number;
    readonly cursorOccurredMonth?: number;
    readonly cursorOccurredDay?: number;
    readonly limit: number;
  },
): Promise<readonly RelationshipItemRecord[]> {
  if (input.sort === "created_desc") {
    const result = await executor.query<RelationshipItemRow>(
      `SELECT ${itemColumns}
       FROM relationship_items item
       WHERE item.partnership_id = $1
         AND item.lifecycle = 'active'
         AND ${visibilitySql()}
         AND item.created_at <= $3
         AND ($4::text IS NULL OR item.kind = $4)
         AND (
           $5::boolean = false
           OR EXISTS (
             SELECT 1
             FROM relationship_story_members story
             WHERE story.partnership_id = item.partnership_id
               AND story.item_id = item.id
           )
         )
         AND ($6::integer IS NULL OR item.occurred_year = $6)
         AND (
           $7::timestamptz IS NULL
           OR (item.created_at, item.id) < ($7::timestamptz, $8::uuid)
         )
       ORDER BY item.created_at DESC, item.id DESC
       LIMIT $9`,
      [
        input.partnershipId,
        input.actorAccountId,
        input.snapshotAt,
        input.kind ?? null,
        input.storyOnly,
        input.year ?? null,
        input.cursorCreatedAt ?? null,
        input.cursorItemId ?? null,
        input.limit,
      ],
    );
    return result.rows.map(mapItem);
  }

  const result = await executor.query<RelationshipItemRow>(
    `SELECT ${itemColumns}
     FROM relationship_items item
     WHERE item.partnership_id = $1
       AND item.lifecycle = 'active'
       AND ${visibilitySql()}
       AND item.created_at <= $3
       AND ($4::text IS NULL OR item.kind = $4)
       AND (
         $5::boolean = false
         OR EXISTS (
           SELECT 1
           FROM relationship_story_members story
           WHERE story.partnership_id = item.partnership_id
             AND story.item_id = item.id
         )
       )
       AND ($6::integer IS NULL OR item.occurred_year = $6)
       AND (
         $7::integer IS NULL
         OR (
           COALESCE(item.occurred_year, 10000),
           COALESCE(item.occurred_month, 0),
           COALESCE(item.occurred_day, 0),
           item.id
         ) > ($7::integer, $8::integer, $9::integer, $10::uuid)
       )
     ORDER BY
       COALESCE(item.occurred_year, 10000),
       COALESCE(item.occurred_month, 0),
       COALESCE(item.occurred_day, 0),
       item.id
     LIMIT $11`,
    [
      input.partnershipId,
      input.actorAccountId,
      input.snapshotAt,
      input.kind ?? null,
      input.storyOnly,
      input.year ?? null,
      input.cursorOccurredYear ?? null,
      input.cursorOccurredMonth ?? null,
      input.cursorOccurredDay ?? null,
      input.cursorItemId ?? null,
      input.limit,
    ],
  );
  return result.rows.map(mapItem);
}

export async function updateRelationshipItemRoot(
  executor: QueryExecutor,
  input: {
    readonly partnershipId: string;
    readonly itemId: string;
    readonly expectedVersion: bigint;
    readonly preview: unknown | null;
    readonly content: unknown | null;
    readonly occurredPrecision: RelationshipItemRecord["occurredPrecision"];
    readonly occurredYear: number | null;
    readonly occurredMonth: number | null;
    readonly occurredDay: number | null;
    readonly releaseMode: RelationshipReleaseMode | null;
    readonly releaseGeneration: bigint;
    readonly unlockAt: Date | null;
    readonly releasedAt: Date | null;
    readonly updatedAt: Date;
  },
): Promise<bigint | null> {
  const result = await executor.query<{ version: string | number | bigint }>(
    `UPDATE relationship_items
     SET development_preview_payload = $4::jsonb,
         development_plaintext_payload = $5::jsonb,
         occurred_date = $6::date,
         occurred_precision = $7,
         occurred_year = $8,
         occurred_month = $9,
         occurred_day = $10,
         release_mode = $11,
         release_generation = $12,
         unlock_at = $13,
         released_at = $14,
         updated_at = $15,
         version = version + 1
     WHERE partnership_id = $1
       AND id = $2
       AND lifecycle = 'active'
       AND version = $3
     RETURNING version`,
    [
      input.partnershipId,
      input.itemId,
      input.expectedVersion.toString(),
      input.preview === null ? null : JSON.stringify(input.preview),
      input.content === null ? null : JSON.stringify(input.content),
      occurredDate({
        precision: input.occurredPrecision,
        year: input.occurredYear,
        month: input.occurredMonth,
        day: input.occurredDay,
      }),
      input.occurredPrecision,
      input.occurredYear,
      input.occurredMonth,
      input.occurredDay,
      input.releaseMode,
      input.releaseGeneration.toString(),
      input.unlockAt,
      input.releasedAt,
      input.updatedAt,
    ],
  );
  const row = result.rows[0];
  return row ? BigInt(row.version) : null;
}

export async function deleteRelationshipItem(
  executor: QueryExecutor,
  partnershipId: string,
  itemId: string,
  expectedVersion: bigint,
): Promise<boolean> {
  const result = await executor.query(
    `DELETE FROM relationship_items
     WHERE partnership_id = $1
       AND id = $2
       AND lifecycle = 'active'
       AND version = $3`,
    [partnershipId, itemId, expectedVersion.toString()],
  );
  return result.rowCount === 1;
}

export async function setRelationshipStoryIncluded(
  executor: QueryExecutor,
  input: {
    readonly partnershipId: string;
    readonly itemId: string;
    readonly actorAccountId: string;
    readonly included: boolean;
    readonly at: Date;
  },
): Promise<void> {
  if (input.included) {
    await executor.query(
      `INSERT INTO relationship_story_members (
         partnership_id, item_id, added_by_account_id, created_at
       ) VALUES ($1,$2,$3,$4)
       ON CONFLICT (partnership_id, item_id) DO NOTHING`,
      [input.partnershipId, input.itemId, input.actorAccountId, input.at],
    );
    return;
  }
  await executor.query(
    "DELETE FROM relationship_story_members WHERE partnership_id = $1 AND item_id = $2",
    [input.partnershipId, input.itemId],
  );
}

export type RelationshipFeatureState =
  | { readonly type: "someday"; readonly state: "someday" | "soon" | "completed"; readonly completedAt: Date | null }
  | { readonly type: "relationship_signal"; readonly signalKind: string }
  | { readonly type: "reunion"; readonly targetDate: string }
  | { readonly type: "curation"; readonly curationType: "our_year" | "anniversary"; readonly anchorYear: number };

export async function loadRelationshipFeatureState(
  executor: QueryExecutor,
  partnershipId: string,
  itemId: string,
): Promise<RelationshipFeatureState | null> {
  const someday = await executor.query<{ state: "someday" | "soon" | "completed"; completed_at: Date | null }>(
    "SELECT state, completed_at FROM relationship_someday_state WHERE partnership_id = $1 AND item_id = $2",
    [partnershipId, itemId],
  );
  if (someday.rows[0]) {
    return { type: "someday", state: someday.rows[0].state, completedAt: someday.rows[0].completed_at };
  }

  const signal = await executor.query<{ signal_kind: string }>(
    "SELECT signal_kind FROM relationship_signal_state WHERE partnership_id = $1 AND item_id = $2",
    [partnershipId, itemId],
  );
  if (signal.rows[0]) {
    return { type: "relationship_signal", signalKind: signal.rows[0].signal_kind };
  }

  const reunion = await executor.query<{ target_date: string }>(
    "SELECT target_date::text FROM relationship_reunion_state WHERE partnership_id = $1 AND item_id = $2",
    [partnershipId, itemId],
  );
  if (reunion.rows[0]) {
    return { type: "reunion", targetDate: reunion.rows[0].target_date };
  }

  const curation = await executor.query<{ curation_type: "our_year" | "anniversary"; anchor_year: number }>(
    "SELECT curation_type, anchor_year FROM relationship_curations WHERE partnership_id = $1 AND item_id = $2",
    [partnershipId, itemId],
  );
  return curation.rows[0]
    ? {
        type: "curation",
        curationType: curation.rows[0].curation_type,
        anchorYear: curation.rows[0].anchor_year,
      }
    : null;
}

export async function replaceRelationshipFeatureState(
  executor: QueryExecutor,
  input: {
    readonly partnershipId: string;
    readonly itemId: string;
    readonly state: RelationshipFeatureState | null;
  },
): Promise<void> {
  await executor.query("DELETE FROM relationship_someday_state WHERE item_id = $1", [input.itemId]);
  await executor.query("DELETE FROM relationship_signal_state WHERE item_id = $1", [input.itemId]);
  await executor.query("DELETE FROM relationship_reunion_state WHERE item_id = $1", [input.itemId]);
  await executor.query("DELETE FROM relationship_curations WHERE item_id = $1", [input.itemId]);

  if (!input.state) return;
  if (input.state.type === "someday") {
    await executor.query(
      "INSERT INTO relationship_someday_state (item_id, partnership_id, state, completed_at) VALUES ($1,$2,$3,$4)",
      [input.itemId, input.partnershipId, input.state.state, input.state.completedAt],
    );
    return;
  }
  if (input.state.type === "relationship_signal") {
    await executor.query(
      "INSERT INTO relationship_signal_state (item_id, partnership_id, signal_kind) VALUES ($1,$2,$3)",
      [input.itemId, input.partnershipId, input.state.signalKind],
    );
    return;
  }
  if (input.state.type === "reunion") {
    await executor.query(
      "INSERT INTO relationship_reunion_state (item_id, partnership_id, target_date) VALUES ($1,$2,$3::date)",
      [input.itemId, input.partnershipId, input.state.targetDate],
    );
    return;
  }
  await executor.query(
    "INSERT INTO relationship_curations (item_id, partnership_id, curation_type, anchor_year) VALUES ($1,$2,$3,$4)",
    [input.itemId, input.partnershipId, input.state.curationType, input.state.anchorYear],
  );
}

export interface RelationshipReferenceRecord {
  readonly referenceType: "message" | "media";
  readonly referenceId: string;
  readonly role: "source" | "attachment" | "voice_letter";
  readonly position: number;
}

export async function loadRelationshipReferences(
  executor: QueryExecutor,
  partnershipId: string,
  itemId: string,
): Promise<readonly RelationshipReferenceRecord[]> {
  const result = await executor.query<{
    reference_type: RelationshipReferenceRecord["referenceType"];
    reference_id: string;
    role: RelationshipReferenceRecord["role"];
    position: number;
  }>(
    `SELECT reference_type, reference_id, role, position
     FROM relationship_item_references
     WHERE partnership_id = $1 AND item_id = $2
     ORDER BY role, position, reference_id`,
    [partnershipId, itemId],
  );
  return result.rows.map((row) => ({
    referenceType: row.reference_type,
    referenceId: row.reference_id,
    role: row.role,
    position: row.position,
  }));
}

export async function replaceRelationshipReferences(
  executor: QueryExecutor,
  input: {
    readonly partnershipId: string;
    readonly itemId: string;
    readonly references: readonly (RelationshipReferenceRecord & { readonly id: string })[];
    readonly at: Date;
  },
): Promise<void> {
  await executor.query("DELETE FROM relationship_item_references WHERE item_id = $1", [input.itemId]);
  for (const reference of input.references) {
    await executor.query(
      `INSERT INTO relationship_item_references (
         id, partnership_id, item_id, reference_type, reference_id, role, position, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        reference.id,
        input.partnershipId,
        input.itemId,
        reference.referenceType,
        reference.referenceId,
        reference.role,
        reference.position,
        input.at,
      ],
    );
  }
}

export interface RelationshipLinkRecord {
  readonly linkType: "curation" | "prepared_content";
  readonly targetItemId: string;
  readonly position: number;
}

export async function loadRelationshipLinks(
  executor: QueryExecutor,
  partnershipId: string,
  itemId: string,
): Promise<readonly RelationshipLinkRecord[]> {
  const result = await executor.query<{
    link_type: RelationshipLinkRecord["linkType"];
    target_item_id: string;
    position: number;
  }>(
    `SELECT link_type, target_item_id, position
     FROM relationship_item_links
     WHERE partnership_id = $1 AND owner_item_id = $2
     ORDER BY link_type, position, target_item_id`,
    [partnershipId, itemId],
  );
  return result.rows.map((row) => ({
    linkType: row.link_type,
    targetItemId: row.target_item_id,
    position: row.position,
  }));
}

export async function replaceRelationshipLinks(
  executor: QueryExecutor,
  input: {
    readonly partnershipId: string;
    readonly ownerItemId: string;
    readonly links: readonly RelationshipLinkRecord[];
    readonly at: Date;
  },
): Promise<void> {
  await executor.query("DELETE FROM relationship_item_links WHERE owner_item_id = $1", [
    input.ownerItemId,
  ]);
  for (const link of input.links) {
    await executor.query(
      `INSERT INTO relationship_item_links (
         partnership_id, owner_item_id, target_item_id, link_type, position, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        input.partnershipId,
        input.ownerItemId,
        link.targetItemId,
        link.linkType,
        link.position,
        input.at,
      ],
    );
  }
}

export async function loadIncomingRelationshipLinkOwnerIds(
  executor: QueryExecutor,
  partnershipId: string,
  targetItemId: string,
): Promise<readonly string[]> {
  const result = await executor.query<{ owner_item_id: string }>(
    `SELECT DISTINCT owner_item_id
     FROM relationship_item_links
     WHERE partnership_id = $1
       AND target_item_id = $2
     ORDER BY owner_item_id`,
    [partnershipId, targetItemId],
  );
  return result.rows.map((row) => row.owner_item_id);
}

export async function deleteIncomingRelationshipLinks(
  executor: QueryExecutor,
  partnershipId: string,
  targetItemId: string,
): Promise<void> {
  await executor.query(
    "DELETE FROM relationship_item_links WHERE partnership_id = $1 AND target_item_id = $2",
    [partnershipId, targetItemId],
  );
}

export async function incrementRelationshipItemVersion(
  executor: QueryExecutor,
  partnershipId: string,
  itemId: string,
  updatedAt: Date,
): Promise<bigint> {
  const result = await executor.query<{ version: string | number | bigint }>(
    `UPDATE relationship_items
     SET version = version + 1, updated_at = $3
     WHERE partnership_id = $1 AND id = $2 AND lifecycle = 'active'
     RETURNING version`,
    [partnershipId, itemId, updatedAt],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Relationship item disappeared while incrementing version");
  return BigInt(row.version);
}

export async function appendRelationshipEvent(
  executor: QueryExecutor,
  input: {
    readonly id: string;
    readonly partnershipId: string;
    readonly itemId: string | null;
    readonly eventType: string;
    readonly actorAccountId: string | null;
    readonly itemVersion: bigint | null;
    readonly createdAt: Date;
  },
): Promise<void> {
  await executor.query(
    `INSERT INTO relationship_events (
       id, partnership_id, item_id, event_type, actor_account_id, item_version, created_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      input.id,
      input.partnershipId,
      input.itemId,
      input.eventType,
      input.actorAccountId,
      input.itemVersion?.toString() ?? null,
      input.createdAt,
    ],
  );
}

export async function listUpcomingRelationshipReleases(
  executor: QueryExecutor,
  input: {
    readonly partnershipId: string;
    readonly actorAccountId: string;
    readonly limit: number;
  },
): Promise<readonly RelationshipItemRecord[]> {
  const result = await executor.query<RelationshipItemRow>(
    `SELECT ${itemColumns}
     FROM relationship_items item
     WHERE item.partnership_id = $1
       AND item.lifecycle = 'active'
       AND item.kind IN ('for_you', 'future_us')
       AND item.release_mode = 'scheduled'
       AND item.released_at IS NULL
       AND ${visibilitySql()}
     ORDER BY item.unlock_at, item.id
     LIMIT $3`,
    [input.partnershipId, input.actorAccountId, input.limit],
  );
  return result.rows.map(mapItem);
}

export async function listRelationshipItemsForThisDay(
  executor: QueryExecutor,
  input: {
    readonly partnershipId: string;
    readonly actorAccountId: string;
    readonly month: number;
    readonly day: number;
    readonly limit: number;
  },
): Promise<readonly RelationshipItemRecord[]> {
  const result = await executor.query<RelationshipItemRow>(
    `SELECT ${itemColumns}
     FROM relationship_items item
     WHERE item.partnership_id = $1
       AND item.lifecycle = 'active'
       AND ${visibilitySql()}
       AND item.occurred_precision = 'day'
       AND (item.release_mode IS NULL OR item.released_at IS NOT NULL)
       AND item.occurred_month = $3
       AND item.occurred_day = $4
     ORDER BY item.occurred_year, item.id
     LIMIT $5`,
    [input.partnershipId, input.actorAccountId, input.month, input.day, input.limit],
  );
  return result.rows.map(mapItem);
}

export async function listRelationshipItemsForYear(
  executor: QueryExecutor,
  input: {
    readonly partnershipId: string;
    readonly actorAccountId: string;
    readonly year: number;
    readonly limit: number;
  },
): Promise<readonly RelationshipItemRecord[]> {
  const result = await executor.query<RelationshipItemRow>(
    `SELECT ${itemColumns}
     FROM relationship_items item
     WHERE item.partnership_id = $1
       AND item.lifecycle = 'active'
       AND ${visibilitySql()}
       AND item.occurred_year = $3
       AND (item.release_mode IS NULL OR item.released_at IS NOT NULL)
     ORDER BY
       COALESCE(item.occurred_month, 0),
       COALESCE(item.occurred_day, 0),
       item.id
     LIMIT $4`,
    [input.partnershipId, input.actorAccountId, input.year, input.limit],
  );
  return result.rows.map(mapItem);
}

export async function getRelationshipReleaseGeneration(
  executor: QueryExecutor,
  itemId: string,
): Promise<bigint> {
  const result = await executor.query<{ release_generation: string | number | bigint }>(
    `SELECT release_generation
     FROM relationship_items
     WHERE id = $1
       AND lifecycle = 'active'
       AND release_mode = 'scheduled'
       AND released_at IS NULL`,
    [itemId],
  );
  return BigInt(result.rows[0]?.release_generation ?? 0);
}

export async function loadRelationshipReleaseItem(
  executor: QueryExecutor,
  itemId: string,
): Promise<RelationshipItemRecord | null> {
  const result = await executor.query<RelationshipItemRow>(
    `SELECT ${itemColumns}
     FROM relationship_items item
     WHERE item.id = $1
       AND item.lifecycle = 'active'
     LIMIT 1`,
    [itemId],
  );
  const row = result.rows[0];
  return row ? mapItem(row) : null;
}

export async function markRelationshipItemReleased(
  executor: QueryExecutor,
  input: {
    readonly partnershipId: string;
    readonly itemId: string;
    readonly expectedGeneration: bigint;
    readonly releasedAt: Date;
  },
): Promise<bigint | null> {
  const result = await executor.query<{ version: string | number | bigint }>(
    `UPDATE relationship_items
     SET released_at = $4,
         version = version + 1,
         updated_at = $4
     WHERE partnership_id = $1
       AND id = $2
       AND release_generation = $3
       AND release_mode = 'scheduled'
       AND released_at IS NULL
       AND lifecycle = 'active'
     RETURNING version`,
    [
      input.partnershipId,
      input.itemId,
      input.expectedGeneration.toString(),
      input.releasedAt,
    ],
  );
  const row = result.rows[0];
  return row ? BigInt(row.version) : null;
}

export async function cancelPendingRelationshipReleaseActionsForPartnership(
  executor: QueryExecutor,
  partnershipId: string,
  at: Date,
): Promise<number> {
  const result = await executor.query(
    `UPDATE scheduled_actions action
     SET status = 'cancelled',
         completed_at = $2
     WHERE action.status = 'pending'
       AND action.action_type = 'relationship_item_release'
       AND action.aggregate_type = 'relationship_item'
       AND EXISTS (
         SELECT 1
         FROM relationship_items item
         WHERE item.id = action.aggregate_id
           AND item.partnership_id = $1
       )`,
    [partnershipId, at],
  );
  return result.rowCount ?? 0;
}

export async function pausePendingRelationshipReleaseActionsForPartnership(
  executor: QueryExecutor,
  partnershipId: string,
  recoverUntil: Date,
): Promise<number> {
  const result = await executor.query(
    `UPDATE scheduled_actions action
     SET available_at = GREATEST(action.available_at, $2)
     WHERE action.status = 'pending'
       AND action.action_type = 'relationship_item_release'
       AND action.aggregate_type = 'relationship_item'
       AND EXISTS (
         SELECT 1
         FROM relationship_items item
         WHERE item.id = action.aggregate_id
           AND item.partnership_id = $1
           AND item.release_mode = 'scheduled'
           AND item.released_at IS NULL
       )`,
    [partnershipId, recoverUntil],
  );
  return result.rowCount ?? 0;
}

export async function wakePendingRelationshipReleaseActionsForPartnership(
  executor: QueryExecutor,
  partnershipId: string,
  now: Date,
): Promise<number> {
  const result = await executor.query(
    `UPDATE scheduled_actions action
     SET available_at = GREATEST(action.execute_at, $2)
     WHERE action.status = 'pending'
       AND action.action_type = 'relationship_item_release'
       AND action.aggregate_type = 'relationship_item'
       AND action.available_at > GREATEST(action.execute_at, $2)
       AND EXISTS (
         SELECT 1
         FROM relationship_items item
         WHERE item.id = action.aggregate_id
           AND item.partnership_id = $1
           AND item.release_mode = 'scheduled'
           AND item.released_at IS NULL
       )`,
    [partnershipId, now],
  );
  return result.rowCount ?? 0;
}
