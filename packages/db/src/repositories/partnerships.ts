import type { QueryExecutor } from "../types/query-executor.ts";

export interface PartnershipReadModel {
  readonly partnershipId: string;
  readonly lifecycleState: "active" | "breakup_pending";
  readonly activatedAt: Date;
  readonly relationshipStartDate: string;
  readonly metadataVersion: bigint;
  readonly accountDeletionViewOnly: boolean;
  readonly otherMember: {
    readonly accountId: string;
    readonly username: string;
    readonly displayName: string;
  };
}

export async function loadPartnershipReadModelForAccount(
  executor: QueryExecutor,
  accountId: string,
): Promise<PartnershipReadModel | null> {
  const result = await executor.query<{
    partnership_id: string;
    lifecycle_state: "active" | "breakup_pending";
    activated_at: Date;
    relationship_start_date: string;
    version: string | number | bigint;
    account_deletion_view_only: boolean;
    other_account_id: string;
    other_username: string;
    other_display_name: string;
  }>(
    `SELECT p.id AS partnership_id,
            p.lifecycle_state,
            p.activated_at,
            p.relationship_start_date::text,
            p.version,
            EXISTS (
              SELECT 1
              FROM partnership_members member
              JOIN accounts account ON account.id = member.account_id
              WHERE member.partnership_id = p.id
                AND member.released_at IS NULL
                AND account.status <> 'active'
            ) AS account_deletion_view_only,
            other_member.account_id AS other_account_id,
            other_account.username_display AS other_username,
            other_profile.display_name AS other_display_name
     FROM partnership_members self_member
     JOIN partnerships p ON p.id = self_member.partnership_id
     JOIN partnership_members other_member
       ON other_member.partnership_id = p.id
      AND other_member.account_id <> self_member.account_id
      AND other_member.released_at IS NULL
     JOIN accounts other_account ON other_account.id = other_member.account_id
     JOIN account_profiles other_profile ON other_profile.account_id = other_member.account_id
     WHERE self_member.account_id = $1
       AND self_member.released_at IS NULL
       AND p.lifecycle_state IN ('active', 'breakup_pending')
     LIMIT 1`,
    [accountId],
  );
  const row = result.rows[0];
  return row
    ? {
        partnershipId: row.partnership_id,
        lifecycleState: row.lifecycle_state,
        activatedAt: row.activated_at,
        relationshipStartDate: row.relationship_start_date,
        metadataVersion: BigInt(row.version),
        accountDeletionViewOnly: row.account_deletion_view_only,
        otherMember: {
          accountId: row.other_account_id,
          username: row.other_username,
          displayName: row.other_display_name,
        },
      }
    : null;
}

export async function loadPartnershipMemberIds(
  executor: QueryExecutor,
  partnershipId: string,
): Promise<readonly string[]> {
  const result = await executor.query<{ account_id: string }>(
    `SELECT account_id
     FROM partnership_members
     WHERE partnership_id = $1
       AND released_at IS NULL
     ORDER BY account_id`,
    [partnershipId],
  );
  return result.rows.map((row) => row.account_id);
}

export interface LockedPartnershipMetadata {
  readonly partnershipId: string;
  readonly lifecycleState: "active" | "breakup_pending" | "terminated";
  readonly relationshipStartDate: string;
  readonly metadataVersion: bigint;
  readonly generation: bigint;
  readonly accountDeletionViewOnly: boolean;
  readonly memberIds: readonly string[];
}

export async function lockPartnershipForMetadataUpdate(
  executor: QueryExecutor,
  partnershipId: string,
): Promise<LockedPartnershipMetadata | null> {
  const partnership = await executor.query<{
    partnership_id: string;
    lifecycle_state: "active" | "breakup_pending" | "terminated";
    relationship_start_date: string;
    version: string | number | bigint;
    generation: string | number | bigint;
    account_deletion_view_only: boolean;
  }>(
    `SELECT p.id AS partnership_id,
            p.lifecycle_state,
            p.relationship_start_date::text,
            p.version,
            p.generation,
            EXISTS (
              SELECT 1
              FROM partnership_members member
              JOIN accounts account ON account.id = member.account_id
              WHERE member.partnership_id = p.id
                AND member.released_at IS NULL
                AND account.status <> 'active'
            ) AS account_deletion_view_only
     FROM partnerships p
     WHERE p.id = $1
     FOR UPDATE`,
    [partnershipId],
  );
  const row = partnership.rows[0];
  if (!row) return null;
  const memberIds = await loadPartnershipMemberIds(executor, partnershipId);
  return {
    partnershipId: row.partnership_id,
    lifecycleState: row.lifecycle_state,
    relationshipStartDate: row.relationship_start_date,
    metadataVersion: BigInt(row.version),
    generation: BigInt(row.generation),
    accountDeletionViewOnly: row.account_deletion_view_only,
    memberIds,
  };
}

export async function insertPartnership(
  executor: QueryExecutor,
  input: {
    readonly id: string;
    readonly relationshipStartDate: string;
    readonly activatedAt: Date;
  },
): Promise<void> {
  await executor.query(
    `INSERT INTO partnerships (
       id, relationship_start_date, lifecycle_state, version, generation,
       created_at, activated_at, updated_at
     ) VALUES ($1,$2::date,'active',1,1,$3,$3,$3)`,
    [input.id, input.relationshipStartDate, input.activatedAt],
  );
}

export async function insertPartnershipMembers(
  executor: QueryExecutor,
  partnershipId: string,
  accountIds: readonly [string, string],
  joinedAt: Date,
): Promise<void> {
  const result = await executor.query(
    `INSERT INTO partnership_members (partnership_id, account_id, joined_at)
     SELECT $1, value, $3
     FROM unnest($2::uuid[]) AS value`,
    [partnershipId, [...accountIds], joinedAt],
  );
  if (result.rowCount !== 2) throw new Error("Partnership must create exactly two members");
}

export async function updateRelationshipStartDateIfVersion(
  executor: QueryExecutor,
  input: {
    readonly partnershipId: string;
    readonly relationshipStartDate: string;
    readonly expectedVersion: bigint;
    readonly updatedAt: Date;
  },
): Promise<bigint | null> {
  const result = await executor.query<{ version: string | number | bigint }>(
    `UPDATE partnerships
     SET relationship_start_date = $2::date,
         version = version + 1,
         updated_at = $4
     WHERE id = $1
       AND version = $3
     RETURNING version`,
    [
      input.partnershipId,
      input.relationshipStartDate,
      input.expectedVersion.toString(),
      input.updatedAt,
    ],
  );
  const row = result.rows[0];
  return row ? BigInt(row.version) : null;
}
