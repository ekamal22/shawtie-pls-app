import type { QueryExecutor } from "../types/query-executor.ts";

export interface DiscoverableAccount {
  readonly accountId: string;
  readonly username: string;
  readonly displayName: string;
  readonly dateOfBirth: string;
  readonly bio: string | null;
  readonly avatarObjectId: string | null;
}

export async function findDiscoverableAccountByUsername(
  executor: QueryExecutor,
  input: { viewerAccountId: string; usernameNormalized: string },
): Promise<DiscoverableAccount | null> {
  const result = await executor.query<{
    account_id: string;
    username_display: string;
    display_name: string;
    date_of_birth: string;
    bio: string | null;
    avatar_object_id: string | null;
  }>(
    `SELECT a.id AS account_id, a.username_display, p.display_name,
            a.date_of_birth::text, p.bio, p.avatar_object_id
     FROM accounts a
     JOIN account_profiles p ON p.account_id = a.id
     WHERE a.username_normalized = $2
       AND a.status = 'active'
       AND a.id <> $1
       AND NOT EXISTS (
         SELECT 1
         FROM partnership_blocks block
         WHERE block.blocker_account_id = a.id
           AND block.blocked_account_id = $1
           AND block.removed_at IS NULL
       )
     LIMIT 1`,
    [input.viewerAccountId, input.usernameNormalized],
  );
  const row = result.rows[0];
  return row
    ? {
        accountId: row.account_id,
        username: row.username_display,
        displayName: row.display_name,
        dateOfBirth: row.date_of_birth,
        bio: row.bio,
        avatarObjectId: row.avatar_object_id,
      }
    : null;
}
