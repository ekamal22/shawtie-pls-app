import type { QueryExecutor } from "../types/query-executor.ts";

export interface ConversationParticipants {
  readonly conversationId: string;
  readonly partnershipId: string;
  readonly memberIds: readonly string[];
}

export interface LockedConversation {
  readonly conversationId: string;
  readonly partnershipId: string;
  readonly nextServerSequence: bigint;
  readonly nextChangeSequence: bigint;
}

export interface LockedMessage {
  readonly id: string;
  readonly conversationId: string;
  readonly partnershipId: string;
  readonly senderAccountId: string;
  readonly senderDeviceId: string | null;
  readonly replyToMessageId: string | null;
  readonly clientIdempotencyKey: string;
  readonly requestFingerprint: Buffer | null;
  readonly requestFingerprintVersion: number | null;
  readonly serverSequence: bigint;
  readonly contentVersion: bigint;
  readonly lastChangeSequence: bigint;
  readonly bodyText: string | null;
  readonly createdAt: Date;
  readonly editedAt: Date | null;
  readonly deletedAt: Date | null;
}

interface LockedMessageRow {
  id: string;
  conversation_id: string;
  partnership_id: string;
  sender_account_id: string;
  sender_device_id: string | null;
  reply_to_message_id: string | null;
  client_idempotency_key: string;
  request_fingerprint: Buffer | null;
  request_fingerprint_version: number | null;
  server_sequence: string | number | bigint;
  content_version: string | number | bigint;
  last_change_sequence: string | number | bigint;
  body_text: string | null;
  created_at: Date;
  edited_at: Date | null;
  deleted_at: Date | null;
}

function mapLockedMessage(row: LockedMessageRow): LockedMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    partnershipId: row.partnership_id,
    senderAccountId: row.sender_account_id,
    senderDeviceId: row.sender_device_id,
    replyToMessageId: row.reply_to_message_id,
    clientIdempotencyKey: row.client_idempotency_key,
    requestFingerprint: row.request_fingerprint,
    requestFingerprintVersion: row.request_fingerprint_version,
    serverSequence: BigInt(row.server_sequence),
    contentVersion: BigInt(row.content_version),
    lastChangeSequence: BigInt(row.last_change_sequence),
    bodyText: row.body_text,
    createdAt: row.created_at,
    editedAt: row.edited_at,
    deletedAt: row.deleted_at,
  };
}

export interface CurrentConversationReadModel {
  readonly conversationId: string;
  readonly partnershipId: string;
  readonly lifecycleState: "active" | "breakup_pending";
  readonly activatedAt: Date;
  readonly accountDeletionViewOnly: boolean;
  readonly viewOnlyAccountId: string | null;
  readonly latestServerSequence: bigint;
  readonly latestChangeSequence: bigint;
  readonly breakupInitiatedAt: Date | null;
  readonly messageFreezeSequence: bigint | null;
  readonly self: {
    readonly accountId: string;
    readonly username: string;
    readonly displayName: string;
    readonly nickname: string | null;
    readonly nicknameVersion: bigint;
    readonly deliveredThrough: bigint;
    readonly readThrough: bigint;
  };
  readonly partner: {
    readonly accountId: string;
    readonly username: string;
    readonly displayName: string;
    readonly nickname: string | null;
    readonly nicknameVersion: bigint;
    readonly lastSeenAt: Date | null;
    readonly onlineUntil: Date | null;
    readonly typingUntil: Date | null;
    readonly deliveredThrough: bigint;
    readonly readThrough: bigint;
  };
}

export async function insertPrimaryConversation(
  executor: QueryExecutor,
  input: {
    readonly id: string;
    readonly partnershipId: string;
    readonly memberIds: readonly [string, string];
    readonly createdAt: Date;
  },
): Promise<void> {
  await executor.query(
    `INSERT INTO conversations (
       id, partnership_id, kind, next_server_sequence, next_change_sequence, created_at
     ) VALUES ($1,$2,'primary',1,1,$3)`,
    [input.id, input.partnershipId, input.createdAt],
  );

  const result = await executor.query(
    `INSERT INTO conversation_member_state (
       conversation_id, partnership_id, account_id, delivered_through, read_through, updated_at
     )
     SELECT $1, $2, value, 0, 0, $4
     FROM unnest($3::uuid[]) AS value`,
    [input.id, input.partnershipId, [...input.memberIds], input.createdAt],
  );

  if (result.rowCount !== 2) {
    throw new Error("Primary conversation must create exactly two member-state rows");
  }
}

export async function loadConversationParticipants(
  executor: QueryExecutor,
  conversationId: string,
): Promise<ConversationParticipants | null> {
  const result = await executor.query<{
    conversation_id: string;
    partnership_id: string;
    member_ids: string[];
  }>(
    `SELECT conversation.id AS conversation_id,
            conversation.partnership_id,
            array_agg(member.account_id ORDER BY member.account_id)::uuid[] AS member_ids
     FROM conversations AS conversation
     JOIN partnership_members AS member
       ON member.partnership_id = conversation.partnership_id
      AND member.released_at IS NULL
     WHERE conversation.id = $1
       AND conversation.kind = 'primary'
     GROUP BY conversation.id, conversation.partnership_id`,
    [conversationId],
  );
  const row = result.rows[0];
  return row
    ? {
        conversationId: row.conversation_id,
        partnershipId: row.partnership_id,
        memberIds: row.member_ids,
      }
    : null;
}

export async function getPrimaryConversationLastServerSequence(
  executor: QueryExecutor,
  partnershipId: string,
): Promise<bigint | null> {
  const result = await executor.query<{ last_server_sequence: string | number | bigint }>(
    `SELECT next_server_sequence - 1 AS last_server_sequence
     FROM conversations
     WHERE partnership_id = $1 AND kind = 'primary'
     FOR UPDATE`,
    [partnershipId],
  );
  const row = result.rows[0];
  return row ? BigInt(row.last_server_sequence) : null;
}

export async function lockConversationForMutation(
  executor: QueryExecutor,
  conversationId: string,
): Promise<LockedConversation | null> {
  const result = await executor.query<{
    id: string;
    partnership_id: string;
    next_server_sequence: string | number | bigint;
    next_change_sequence: string | number | bigint;
  }>(
    `SELECT id, partnership_id, next_server_sequence, next_change_sequence
     FROM conversations
     WHERE id = $1 AND kind = 'primary'
     FOR UPDATE`,
    [conversationId],
  );
  const row = result.rows[0];
  return row
    ? {
        conversationId: row.id,
        partnershipId: row.partnership_id,
        nextServerSequence: BigInt(row.next_server_sequence),
        nextChangeSequence: BigInt(row.next_change_sequence),
      }
    : null;
}

export async function allocateMessageAndChangeSequence(
  executor: QueryExecutor,
  conversationId: string,
): Promise<{ serverSequence: bigint; changeSequence: bigint }> {
  const result = await executor.query<{
    server_sequence: string | number | bigint;
    change_sequence: string | number | bigint;
  }>(
    `UPDATE conversations
     SET next_server_sequence = next_server_sequence + 1,
         next_change_sequence = next_change_sequence + 1
     WHERE id = $1
     RETURNING next_server_sequence - 1 AS server_sequence,
               next_change_sequence - 1 AS change_sequence`,
    [conversationId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Conversation sequence allocation failed");
  return {
    serverSequence: BigInt(row.server_sequence),
    changeSequence: BigInt(row.change_sequence),
  };
}

export async function allocateChangeSequence(
  executor: QueryExecutor,
  conversationId: string,
): Promise<bigint> {
  const result = await executor.query<{ change_sequence: string | number | bigint }>(
    `UPDATE conversations
     SET next_change_sequence = next_change_sequence + 1
     WHERE id = $1
     RETURNING next_change_sequence - 1 AS change_sequence`,
    [conversationId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Conversation change-sequence allocation failed");
  return BigInt(row.change_sequence);
}

export async function findMessageByIdempotencyKey(
  executor: QueryExecutor,
  input: {
    readonly conversationId: string;
    readonly senderAccountId: string;
    readonly idempotencyKey: string;
  },
): Promise<LockedMessage | null> {
  const result = await executor.query<LockedMessageRow>(
    `SELECT id, conversation_id, partnership_id, sender_account_id, sender_device_id,
            reply_to_message_id, client_idempotency_key, request_fingerprint,
            request_fingerprint_version, server_sequence, content_version,
            last_change_sequence, body_text, created_at, edited_at, deleted_at
     FROM messages
     WHERE conversation_id = $1
       AND sender_account_id = $2
       AND client_idempotency_key = $3
     LIMIT 1`,
    [input.conversationId, input.senderAccountId, input.idempotencyKey],
  );
  const row = result.rows[0];
  return row ? mapLockedMessage(row) : null;
}

export async function lockMessageForMutation(
  executor: QueryExecutor,
  conversationId: string,
  messageId: string,
): Promise<LockedMessage | null> {
  const result = await executor.query<LockedMessageRow>(
    `SELECT id, conversation_id, partnership_id, sender_account_id, sender_device_id,
            reply_to_message_id, client_idempotency_key, request_fingerprint,
            request_fingerprint_version, server_sequence, content_version,
            last_change_sequence, body_text, created_at, edited_at, deleted_at
     FROM messages
     WHERE id = $2 AND conversation_id = $1
     FOR UPDATE`,
    [conversationId, messageId],
  );
  const row = result.rows[0];
  return row ? mapLockedMessage(row) : null;
}

export async function messageExistsInConversation(
  executor: QueryExecutor,
  conversationId: string,
  messageId: string,
): Promise<boolean> {
  const result = await executor.query(
    "SELECT 1 FROM messages WHERE id = $2 AND conversation_id = $1 LIMIT 1",
    [conversationId, messageId],
  );
  return result.rowCount === 1;
}

export async function insertMessage(
  executor: QueryExecutor,
  input: {
    readonly id: string;
    readonly conversationId: string;
    readonly partnershipId: string;
    readonly senderAccountId: string;
    readonly senderDeviceId: string | null;
    readonly replyToMessageId: string | null;
    readonly idempotencyKey: string;
    readonly requestFingerprint: Buffer;
    readonly requestFingerprintVersion: number;
    readonly serverSequence: bigint;
    readonly changeSequence: bigint;
    readonly body: string;
    readonly createdAt: Date;
  },
): Promise<void> {
  await executor.query(
    `INSERT INTO messages (
       id, conversation_id, partnership_id, sender_account_id, sender_device_id,
       reply_to_message_id, client_idempotency_key, server_sequence,
       body_text, content_version, request_fingerprint, request_fingerprint_version,
       last_change_sequence, created_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1,$10,$11,$12,$13)`,
    [
      input.id,
      input.conversationId,
      input.partnershipId,
      input.senderAccountId,
      input.senderDeviceId,
      input.replyToMessageId,
      input.idempotencyKey,
      input.serverSequence.toString(),
      input.body,
      input.requestFingerprint,
      input.requestFingerprintVersion,
      input.changeSequence.toString(),
      input.createdAt,
    ],
  );
}

export async function updateMessageBody(
  executor: QueryExecutor,
  input: {
    readonly messageId: string;
    readonly expectedContentVersion: bigint;
    readonly body: string;
    readonly changeSequence: bigint;
    readonly editedAt: Date;
  },
): Promise<bigint | null> {
  const result = await executor.query<{ content_version: string | number | bigint }>(
    `UPDATE messages
     SET body_text = $3,
         ciphertext = NULL,
         ciphertext_version = NULL,
         content_version = content_version + 1,
         last_change_sequence = $4,
         edited_at = $5
     WHERE id = $1
       AND content_version = $2
       AND deleted_at IS NULL
     RETURNING content_version`,
    [
      input.messageId,
      input.expectedContentVersion.toString(),
      input.body,
      input.changeSequence.toString(),
      input.editedAt,
    ],
  );
  const row = result.rows[0];
  return row ? BigInt(row.content_version) : null;
}

export async function tombstoneMessage(
  executor: QueryExecutor,
  input: {
    readonly messageId: string;
    readonly changeSequence: bigint;
    readonly deletedAt: Date;
  },
): Promise<bigint | null> {
  const result = await executor.query<{ content_version: string | number | bigint }>(
    `UPDATE messages
     SET body_text = NULL,
         ciphertext = NULL,
         ciphertext_version = NULL,
         content_version = content_version + 1,
         last_change_sequence = $2,
         deleted_at = $3
     WHERE id = $1
       AND deleted_at IS NULL
     RETURNING content_version`,
    [input.messageId, input.changeSequence.toString(), input.deletedAt],
  );
  const row = result.rows[0];
  if (!row) return null;

  await executor.query("DELETE FROM message_versions WHERE message_id = $1", [input.messageId]);
  await executor.query("DELETE FROM message_reactions WHERE message_id = $1", [input.messageId]);
  return BigInt(row.content_version);
}

export async function insertConversationChange(
  executor: QueryExecutor,
  input: {
    readonly conversationId: string;
    readonly changeSequence: bigint;
    readonly changeType:
      | "message.created"
      | "message.updated"
      | "message.deleted"
      | "message.reaction_changed";
    readonly messageId: string;
    readonly contentVersion: bigint | null;
    readonly createdAt: Date;
  },
): Promise<void> {
  await executor.query(
    `INSERT INTO conversation_changes (
       conversation_id, change_sequence, change_type, message_id, content_version, created_at
     ) VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      input.conversationId,
      input.changeSequence.toString(),
      input.changeType,
      input.messageId,
      input.contentVersion?.toString() ?? null,
      input.createdAt,
    ],
  );
}

interface MessageProjectionRow {
  message_id: string;
  sender_account_id: string;
  sender_device_id: string | null;
  reply_to_message_id: string | null;
  server_sequence: string | number | bigint;
  content_version: string | number | bigint;
  last_change_sequence: string | number | bigint;
  body_text: string | null;
  created_at: Date;
  edited_at: Date | null;
  deleted_at: Date | null;
  reply_sender_account_id: string | null;
  reply_body_text: string | null;
  reply_deleted_at: Date | null;
  reactions: unknown;
}

export interface MessageProjectionRowModel {
  readonly messageId: string;
  readonly senderAccountId: string;
  readonly senderDeviceId: string | null;
  readonly replyToMessageId: string | null;
  readonly serverSequence: bigint;
  readonly contentVersion: bigint;
  readonly lastChangeSequence: bigint;
  readonly body: string | null;
  readonly createdAt: Date;
  readonly editedAt: Date | null;
  readonly deletedAt: Date | null;
  readonly replyContext: {
    readonly messageId: string;
    readonly senderAccountId: string;
    readonly body: string | null;
    readonly deleted: boolean;
  } | null;
  readonly reactions: readonly {
    readonly accountId: string;
    readonly emoji: string;
  }[];
}

function reactionList(value: unknown): readonly { accountId: string; emoji: string }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const accountId = "accountId" in item ? item.accountId : null;
    const emoji = "emoji" in item ? item.emoji : null;
    return typeof accountId === "string" && typeof emoji === "string"
      ? [{ accountId, emoji }]
      : [];
  });
}

function mapMessageProjection(row: MessageProjectionRow): MessageProjectionRowModel {
  return {
    messageId: row.message_id,
    senderAccountId: row.sender_account_id,
    senderDeviceId: row.sender_device_id,
    replyToMessageId: row.reply_to_message_id,
    serverSequence: BigInt(row.server_sequence),
    contentVersion: BigInt(row.content_version),
    lastChangeSequence: BigInt(row.last_change_sequence),
    body: row.deleted_at ? null : row.body_text,
    createdAt: row.created_at,
    editedAt: row.edited_at,
    deletedAt: row.deleted_at,
    replyContext:
      row.reply_to_message_id && row.reply_sender_account_id
        ? {
            messageId: row.reply_to_message_id,
            senderAccountId: row.reply_sender_account_id,
            body: row.reply_deleted_at ? null : row.reply_body_text,
            deleted: row.reply_deleted_at !== null,
          }
        : null,
    reactions: row.deleted_at ? [] : reactionList(row.reactions),
  };
}

const messageProjectionSql = `
  SELECT message.id AS message_id,
         message.sender_account_id,
         message.sender_device_id,
         message.reply_to_message_id,
         message.server_sequence,
         message.content_version,
         message.last_change_sequence,
         message.body_text,
         message.created_at,
         message.edited_at,
         message.deleted_at,
         reply.sender_account_id AS reply_sender_account_id,
         reply.body_text AS reply_body_text,
         reply.deleted_at AS reply_deleted_at,
         COALESCE(
           (
             SELECT jsonb_agg(
               jsonb_build_object(
                 'accountId', reaction.reactor_account_id,
                 'emoji', reaction.emoji_text
               )
               ORDER BY reaction.created_at, reaction.reactor_account_id
             )
             FROM message_reactions AS reaction
             WHERE reaction.message_id = message.id
               AND reaction.removed_at IS NULL
               AND reaction.emoji_text IS NOT NULL
           ),
           '[]'::jsonb
         ) AS reactions
  FROM messages AS message
  LEFT JOIN messages AS reply
    ON reply.id = message.reply_to_message_id
   AND reply.conversation_id = message.conversation_id
`;

export async function listConversationMessages(
  executor: QueryExecutor,
  input: {
    readonly conversationId: string;
    readonly beforeSequence: bigint | null;
    readonly afterSequence: bigint | null;
    readonly limit: number;
  },
): Promise<readonly MessageProjectionRowModel[]> {
  let where = "message.conversation_id = $1";
  let order = "message.server_sequence DESC";
  const params: unknown[] = [input.conversationId];

  if (input.beforeSequence !== null) {
    params.push(input.beforeSequence.toString());
    where += " AND message.server_sequence < $2";
  } else if (input.afterSequence !== null) {
    params.push(input.afterSequence.toString());
    where += " AND message.server_sequence > $2";
    order = "message.server_sequence ASC";
  }

  params.push(input.limit);
  const limitIndex = params.length;

  const result = await executor.query<MessageProjectionRow>(
    `${messageProjectionSql}
     WHERE ${where}
     ORDER BY ${order}
     LIMIT $${limitIndex}`,
    params,
  );

  const rows = result.rows.map(mapMessageProjection);
  return input.afterSequence === null ? rows.reverse() : rows;
}

export async function loadMessageProjection(
  executor: QueryExecutor,
  conversationId: string,
  messageId: string,
): Promise<MessageProjectionRowModel | null> {
  const result = await executor.query<MessageProjectionRow>(
    `${messageProjectionSql}
     WHERE message.conversation_id = $1
       AND message.id = $2
     LIMIT 1`,
    [conversationId, messageId],
  );
  const row = result.rows[0];
  return row ? mapMessageProjection(row) : null;
}

export interface ConversationChangeRow {
  readonly changeSequence: bigint;
  readonly changeType:
    | "message.created"
    | "message.updated"
    | "message.deleted"
    | "message.reaction_changed";
  readonly messageId: string;
  readonly contentVersion: bigint | null;
  readonly createdAt: Date;
}

export async function listConversationChanges(
  executor: QueryExecutor,
  conversationId: string,
  afterChangeSequence: bigint,
  limit: number,
): Promise<readonly ConversationChangeRow[]> {
  const result = await executor.query<{
    change_sequence: string | number | bigint;
    change_type: ConversationChangeRow["changeType"];
    message_id: string;
    content_version: string | number | bigint | null;
    created_at: Date;
  }>(
    `SELECT change_sequence, change_type, message_id, content_version, created_at
     FROM conversation_changes
     WHERE conversation_id = $1
       AND change_sequence > $2
     ORDER BY change_sequence ASC
     LIMIT $3`,
    [conversationId, afterChangeSequence.toString(), limit],
  );
  return result.rows.map((row) => ({
    changeSequence: BigInt(row.change_sequence),
    changeType: row.change_type,
    messageId: row.message_id,
    contentVersion: row.content_version === null ? null : BigInt(row.content_version),
    createdAt: row.created_at,
  }));
}

export async function setMessageReaction(
  executor: QueryExecutor,
  input: {
    readonly id: string;
    readonly messageId: string;
    readonly partnershipId: string;
    readonly accountId: string;
    readonly emoji: string;
    readonly changeSequence: bigint;
    readonly at: Date;
  },
): Promise<void> {
  await executor.query(
    `INSERT INTO message_reactions (
       id, message_id, reactor_account_id, partnership_id,
       encrypted_reaction, emoji_text, created_at, removed_at
     ) VALUES ($1,$2,$3,$4,NULL,$5,$6,NULL)
     ON CONFLICT (message_id, reactor_account_id) WHERE removed_at IS NULL
     DO UPDATE SET
       encrypted_reaction = NULL,
       ciphertext_version = NULL,
       emoji_text = EXCLUDED.emoji_text,
       created_at = EXCLUDED.created_at,
       removed_at = NULL`,
    [input.id, input.messageId, input.accountId, input.partnershipId, input.emoji, input.at],
  );
  await executor.query(
    "UPDATE messages SET last_change_sequence = $2 WHERE id = $1 AND deleted_at IS NULL",
    [input.messageId, input.changeSequence.toString()],
  );
}

export async function removeMessageReaction(
  executor: QueryExecutor,
  messageId: string,
  accountId: string,
  changeSequence: bigint,
): Promise<boolean> {
  const result = await executor.query(
    `DELETE FROM message_reactions
     WHERE message_id = $1
       AND reactor_account_id = $2
       AND removed_at IS NULL`,
    [messageId, accountId],
  );
  if (result.rowCount !== 1) return false;
  await executor.query(
    "UPDATE messages SET last_change_sequence = $2 WHERE id = $1 AND deleted_at IS NULL",
    [messageId, changeSequence.toString()],
  );
  return true;
}

export async function upsertConversationReceipt(
  executor: QueryExecutor,
  input: {
    readonly conversationId: string;
    readonly partnershipId: string;
    readonly accountId: string;
    readonly type: "delivered" | "read";
    readonly throughSequence: bigint;
    readonly at: Date;
  },
): Promise<{ deliveredThrough: bigint; readThrough: bigint }> {
  const result = await executor.query<{
    delivered_through: string | number | bigint;
    read_through: string | number | bigint;
  }>(
    `INSERT INTO conversation_member_state (
       conversation_id, partnership_id, account_id,
       delivered_through, read_through, updated_at
     ) VALUES (
       $1,$2,$3,
       $4,
       CASE WHEN $5 = 'read' THEN $4 ELSE 0 END,
       $6
     )
     ON CONFLICT (conversation_id, account_id)
     DO UPDATE SET
       delivered_through = GREATEST(
         conversation_member_state.delivered_through,
         EXCLUDED.delivered_through,
         EXCLUDED.read_through
       ),
       read_through = GREATEST(
         conversation_member_state.read_through,
         EXCLUDED.read_through
       ),
       updated_at = EXCLUDED.updated_at
     RETURNING delivered_through, read_through`,
    [
      input.conversationId,
      input.partnershipId,
      input.accountId,
      input.throughSequence.toString(),
      input.type,
      input.at,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Conversation receipt update failed");
  return {
    deliveredThrough: BigInt(row.delivered_through),
    readThrough: BigInt(row.read_through),
  };
}

export async function updatePartnershipNickname(
  executor: QueryExecutor,
  input: {
    readonly partnershipId: string;
    readonly subjectAccountId: string;
    readonly actorAccountId: string;
    readonly nickname: string | null;
    readonly expectedVersion: bigint;
    readonly at: Date;
  },
): Promise<bigint | null> {
  const updated = await executor.query<{ version: string | number | bigint }>(
    `UPDATE partnership_chat_nicknames
     SET nickname = $4,
         version = version + 1,
         updated_by_account_id = $3,
         updated_at = $6
     WHERE partnership_id = $1
       AND subject_account_id = $2
       AND version = $5
     RETURNING version`,
    [
      input.partnershipId,
      input.subjectAccountId,
      input.actorAccountId,
      input.nickname,
      input.expectedVersion.toString(),
      input.at,
    ],
  );
  const updatedRow = updated.rows[0];
  if (updatedRow) return BigInt(updatedRow.version);

  if (input.expectedVersion !== 1n) return null;

  const inserted = await executor.query<{ version: string | number | bigint }>(
    `INSERT INTO partnership_chat_nicknames (
       partnership_id, subject_account_id, nickname, version,
       updated_by_account_id, updated_at
     ) VALUES ($1,$2,$4,2,$3,$5)
     ON CONFLICT (partnership_id, subject_account_id) DO NOTHING
     RETURNING version`,
    [
      input.partnershipId,
      input.subjectAccountId,
      input.actorAccountId,
      input.nickname,
      input.at,
    ],
  );
  const insertedRow = inserted.rows[0];
  return insertedRow ? BigInt(insertedRow.version) : null;
}

export interface PresenceSnapshot {
  readonly lastSeenAt: Date;
  readonly onlineUntil: Date;
  readonly updatedAt: Date;
}

export async function heartbeatPresence(
  executor: QueryExecutor,
  input: {
    readonly accountId: string;
    readonly at: Date;
    readonly onlineUntil: Date;
    readonly minRefreshBefore: Date;
  },
): Promise<PresenceSnapshot> {
  const result = await executor.query<{
    last_seen_at: Date;
    online_until: Date;
    updated_at: Date;
  }>(
    `INSERT INTO account_presence (
       account_id, last_seen_at, online_until, updated_at
     ) VALUES ($1,$2,$3,$2)
     ON CONFLICT (account_id)
     DO UPDATE SET
       last_seen_at = EXCLUDED.last_seen_at,
       online_until = EXCLUDED.online_until,
       updated_at = EXCLUDED.updated_at
     WHERE account_presence.updated_at <= $4
     RETURNING last_seen_at, online_until, updated_at`,
    [input.accountId, input.at, input.onlineUntil, input.minRefreshBefore],
  );
  const row = result.rows[0];
  if (row) {
    return {
      lastSeenAt: row.last_seen_at,
      onlineUntil: row.online_until,
      updatedAt: row.updated_at,
    };
  }

  const current = await executor.query<{
    last_seen_at: Date;
    online_until: Date;
    updated_at: Date;
  }>(
    `SELECT last_seen_at, online_until, updated_at
     FROM account_presence
     WHERE account_id = $1`,
    [input.accountId],
  );
  const currentRow = current.rows[0];
  if (!currentRow) throw new Error("Presence snapshot disappeared");
  return {
    lastSeenAt: currentRow.last_seen_at,
    onlineUntil: currentRow.online_until,
    updatedAt: currentRow.updated_at,
  };
}

export async function setConversationTypingState(
  executor: QueryExecutor,
  input: {
    readonly conversationId: string;
    readonly partnershipId: string;
    readonly accountId: string;
    readonly typing: boolean;
    readonly at: Date;
    readonly expiresAt: Date;
    readonly minRefreshBefore: Date;
  },
): Promise<Date | null> {
  if (!input.typing) {
    await executor.query(
      `DELETE FROM conversation_typing_state
       WHERE conversation_id = $1 AND account_id = $2`,
      [input.conversationId, input.accountId],
    );
    return null;
  }

  const result = await executor.query<{ expires_at: Date }>(
    `INSERT INTO conversation_typing_state (
       conversation_id, partnership_id, account_id, expires_at, updated_at
     ) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (conversation_id, account_id)
     DO UPDATE SET
       expires_at = EXCLUDED.expires_at,
       updated_at = EXCLUDED.updated_at
     WHERE conversation_typing_state.updated_at <= $6
     RETURNING expires_at`,
    [
      input.conversationId,
      input.partnershipId,
      input.accountId,
      input.expiresAt,
      input.at,
      input.minRefreshBefore,
    ],
  );
  const row = result.rows[0];
  if (row) return row.expires_at;

  const current = await executor.query<{ expires_at: Date }>(
    `SELECT expires_at
     FROM conversation_typing_state
     WHERE conversation_id = $1 AND account_id = $2`,
    [input.conversationId, input.accountId],
  );
  return current.rows[0]?.expires_at ?? null;
}

export async function loadCurrentConversationReadModel(
  executor: QueryExecutor,
  accountId: string,
  now: Date,
): Promise<CurrentConversationReadModel | null> {
  const result = await executor.query<{
    conversation_id: string;
    partnership_id: string;
    lifecycle_state: "active" | "breakup_pending";
    activated_at: Date;
    account_deletion_view_only: boolean;
    view_only_account_id: string | null;
    latest_server_sequence: string | number | bigint;
    latest_change_sequence: string | number | bigint;
    breakup_initiated_at: Date | null;
    message_freeze_sequence: string | number | bigint | null;
    self_account_id: string;
    self_username: string;
    self_display_name: string;
    self_nickname: string | null;
    self_nickname_version: string | number | bigint;
    self_delivered_through: string | number | bigint;
    self_read_through: string | number | bigint;
    partner_account_id: string;
    partner_username: string;
    partner_display_name: string;
    partner_nickname: string | null;
    partner_nickname_version: string | number | bigint;
    partner_last_seen_at: Date | null;
    partner_online_until: Date | null;
    partner_typing_until: Date | null;
    partner_delivered_through: string | number | bigint;
    partner_read_through: string | number | bigint;
  }>(
    `SELECT conversation.id AS conversation_id,
            conversation.partnership_id,
            partnership.lifecycle_state,
            partnership.activated_at,
            EXISTS (
              SELECT 1
              FROM partnership_members AS status_member
              JOIN accounts AS status_account
                ON status_account.id = status_member.account_id
              WHERE status_member.partnership_id = partnership.id
                AND status_member.released_at IS NULL
                AND status_account.status <> 'active'
            ) AS account_deletion_view_only,
            (
              SELECT status_member.account_id
              FROM partnership_members AS status_member
              JOIN accounts AS status_account
                ON status_account.id = status_member.account_id
              WHERE status_member.partnership_id = partnership.id
                AND status_member.released_at IS NULL
                AND status_account.status <> 'active'
              ORDER BY status_member.account_id
              LIMIT 1
            ) AS view_only_account_id,
            conversation.next_server_sequence - 1 AS latest_server_sequence,
            conversation.next_change_sequence - 1 AS latest_change_sequence,
            breakup.initiated_at AS breakup_initiated_at,
            breakup.message_freeze_sequence,
            self_member.account_id AS self_account_id,
            self_account.username_display AS self_username,
            self_profile.display_name AS self_display_name,
            self_nickname.nickname AS self_nickname,
            COALESCE(self_nickname.version, 1) AS self_nickname_version,
            COALESCE(self_state.delivered_through, 0) AS self_delivered_through,
            COALESCE(self_state.read_through, 0) AS self_read_through,
            partner_member.account_id AS partner_account_id,
            partner_account.username_display AS partner_username,
            partner_profile.display_name AS partner_display_name,
            partner_nickname.nickname AS partner_nickname,
            COALESCE(partner_nickname.version, 1) AS partner_nickname_version,
            CASE
              WHEN partner_presence.last_seen_at >= partnership.activated_at
              THEN partner_presence.last_seen_at
              ELSE NULL
            END AS partner_last_seen_at,
            CASE
              WHEN partner_presence.last_seen_at >= partnership.activated_at
               AND partner_presence.online_until > $2
              THEN partner_presence.online_until
              ELSE NULL
            END AS partner_online_until,
            CASE
              WHEN partner_typing.expires_at > $2
              THEN partner_typing.expires_at
              ELSE NULL
            END AS partner_typing_until,
            COALESCE(partner_state.delivered_through, 0) AS partner_delivered_through,
            COALESCE(partner_state.read_through, 0) AS partner_read_through
     FROM partnership_members AS self_member
     JOIN partnerships AS partnership
       ON partnership.id = self_member.partnership_id
     JOIN conversations AS conversation
       ON conversation.partnership_id = partnership.id
      AND conversation.kind = 'primary'
     JOIN accounts AS self_account
       ON self_account.id = self_member.account_id
     JOIN account_profiles AS self_profile
       ON self_profile.account_id = self_member.account_id
     JOIN partnership_members AS partner_member
       ON partner_member.partnership_id = partnership.id
      AND partner_member.account_id <> self_member.account_id
      AND partner_member.released_at IS NULL
     JOIN accounts AS partner_account
       ON partner_account.id = partner_member.account_id
     JOIN account_profiles AS partner_profile
       ON partner_profile.account_id = partner_member.account_id
     LEFT JOIN breakup_processes AS breakup
       ON breakup.partnership_id = partnership.id
      AND breakup.restored_at IS NULL
      AND breakup.dissolved_at IS NULL
      AND breakup.cancelled_at IS NULL
      AND breakup.superseded_at IS NULL
     LEFT JOIN partnership_chat_nicknames AS self_nickname
       ON self_nickname.partnership_id = partnership.id
      AND self_nickname.subject_account_id = self_member.account_id
     LEFT JOIN partnership_chat_nicknames AS partner_nickname
       ON partner_nickname.partnership_id = partnership.id
      AND partner_nickname.subject_account_id = partner_member.account_id
     LEFT JOIN conversation_member_state AS self_state
       ON self_state.conversation_id = conversation.id
      AND self_state.account_id = self_member.account_id
     LEFT JOIN conversation_member_state AS partner_state
       ON partner_state.conversation_id = conversation.id
      AND partner_state.account_id = partner_member.account_id
     LEFT JOIN account_presence AS partner_presence
       ON partner_presence.account_id = partner_member.account_id
     LEFT JOIN conversation_typing_state AS partner_typing
       ON partner_typing.conversation_id = conversation.id
      AND partner_typing.account_id = partner_member.account_id
     WHERE self_member.account_id = $1
       AND self_member.released_at IS NULL
       AND partnership.lifecycle_state IN ('active', 'breakup_pending')
     LIMIT 1`,
    [accountId, now],
  );

  const row = result.rows[0];
  return row
    ? {
        conversationId: row.conversation_id,
        partnershipId: row.partnership_id,
        lifecycleState: row.lifecycle_state,
        activatedAt: row.activated_at,
        accountDeletionViewOnly: row.account_deletion_view_only,
        viewOnlyAccountId: row.view_only_account_id,
        latestServerSequence: BigInt(row.latest_server_sequence),
        latestChangeSequence: BigInt(row.latest_change_sequence),
        breakupInitiatedAt: row.breakup_initiated_at,
        messageFreezeSequence:
          row.message_freeze_sequence === null ? null : BigInt(row.message_freeze_sequence),
        self: {
          accountId: row.self_account_id,
          username: row.self_username,
          displayName: row.self_display_name,
          nickname: row.self_nickname,
          nicknameVersion: BigInt(row.self_nickname_version),
          deliveredThrough: BigInt(row.self_delivered_through),
          readThrough: BigInt(row.self_read_through),
        },
        partner: {
          accountId: row.partner_account_id,
          username: row.partner_username,
          displayName: row.partner_display_name,
          nickname: row.partner_nickname,
          nicknameVersion: BigInt(row.partner_nickname_version),
          lastSeenAt: row.partner_last_seen_at,
          onlineUntil: row.partner_online_until,
          typingUntil: row.partner_typing_until,
          deliveredThrough: BigInt(row.partner_delivered_through),
          readThrough: BigInt(row.partner_read_through),
        },
      }
    : null;
}

export async function deletePartnershipMessagingContent(
  executor: QueryExecutor,
  partnershipId: string,
): Promise<void> {
  await executor.query(
    "DELETE FROM partnership_chat_nicknames WHERE partnership_id = $1",
    [partnershipId],
  );
  await executor.query(
    "DELETE FROM conversations WHERE partnership_id = $1",
    [partnershipId],
  );
}

export async function deleteAccountPresence(
  executor: QueryExecutor,
  accountId: string,
): Promise<void> {
  await executor.query("DELETE FROM account_presence WHERE account_id = $1", [accountId]);
}
