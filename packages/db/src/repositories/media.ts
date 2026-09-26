import type { QueryExecutor } from "../types/query-executor.ts";

export type MediaKind = "image" | "video" | "file" | "voice";
export type MediaState = "uploading" | "ready_unbound" | "bound" | "deletion_pending" | "failed";
export type MediaBindingType = "message" | "relationship_item";
export type MediaBindingRole = "attachment" | "voice_message" | "voice_letter";

export interface MediaObjectRecord {
  readonly id: string;
  readonly partnershipId: string;
  readonly uploaderAccountId: string;
  readonly uploaderDeviceId: string | null;
  readonly storageObjectKey: string;
  readonly mediaKind: MediaKind;
  readonly formatCode: string;
  readonly state: MediaState;
  readonly ciphertextSize: bigint;
  readonly ciphertextSha256: string;
  readonly cryptoProtocolVersion: string;
  readonly contentKeyId: string | null;
  readonly durationSeconds: number | null;
  readonly uploadGeneration: bigint;
  readonly uploadExpiresAt: Date | null;
  readonly readyAt: Date | null;
  readonly bindingType: MediaBindingType | null;
  readonly bindingId: string | null;
  readonly bindingRole: MediaBindingRole | null;
  readonly bindingPosition: number | null;
  readonly deletionGeneration: bigint;
  readonly createdAt: Date;
  readonly deletedAt: Date | null;
}

interface MediaRow {
  id: string;
  partnership_id: string;
  uploader_account_id: string;
  uploader_device_id: string | null;
  storage_object_key: string;
  media_kind: MediaKind;
  format_code: string;
  state: MediaState;
  ciphertext_size: string | number | bigint;
  ciphertext_sha256: string;
  crypto_protocol_version: string;
  content_key_id: string | null;
  duration_seconds: number | null;
  upload_generation: string | number | bigint;
  upload_expires_at: Date | null;
  ready_at: Date | null;
  binding_type: MediaBindingType | null;
  binding_id: string | null;
  binding_role: MediaBindingRole | null;
  binding_position: number | null;
  deletion_generation: string | number | bigint;
  created_at: Date;
  deleted_at: Date | null;
}

const columns = `
  id, partnership_id, uploader_account_id, uploader_device_id, storage_object_key,
  media_kind, format_code, state, ciphertext_size, ciphertext_sha256,
  crypto_protocol_version, content_key_id, duration_seconds, upload_generation, upload_expires_at,
  ready_at, binding_type, binding_id, binding_role, binding_position,
  deletion_generation, created_at, deleted_at
`;

function mapMedia(row: MediaRow): MediaObjectRecord {
  return {
    id: row.id,
    partnershipId: row.partnership_id,
    uploaderAccountId: row.uploader_account_id,
    uploaderDeviceId: row.uploader_device_id,
    storageObjectKey: row.storage_object_key,
    mediaKind: row.media_kind,
    formatCode: row.format_code,
    state: row.state,
    ciphertextSize: BigInt(row.ciphertext_size),
    ciphertextSha256: row.ciphertext_sha256,
    cryptoProtocolVersion: row.crypto_protocol_version,
    contentKeyId: row.content_key_id,
    durationSeconds: row.duration_seconds,
    uploadGeneration: BigInt(row.upload_generation),
    uploadExpiresAt: row.upload_expires_at,
    readyAt: row.ready_at,
    bindingType: row.binding_type,
    bindingId: row.binding_id,
    bindingRole: row.binding_role,
    bindingPosition: row.binding_position,
    deletionGeneration: BigInt(row.deletion_generation),
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
  };
}

export async function insertMediaUpload(
  executor: QueryExecutor,
  input: {
    readonly id: string;
    readonly partnershipId: string;
    readonly uploaderAccountId: string;
    readonly uploaderDeviceId: string | null;
    readonly storageObjectKey: string;
    readonly mediaKind: MediaKind;
    readonly formatCode: string;
    readonly ciphertextSize: bigint;
    readonly ciphertextSha256: string;
    readonly cryptoProtocolVersion: string;
    readonly contentKeyId?: string | null;
    readonly durationSeconds: number | null;
    readonly uploadExpiresAt: Date;
    readonly createdAt: Date;
  },
): Promise<void> {
  await executor.query(
    `INSERT INTO media_objects (
       id, partnership_id, uploader_account_id, uploader_device_id, storage_object_key,
       media_kind, format_code, state, ciphertext_size, ciphertext_sha256,
       crypto_protocol_version, content_key_id, duration_seconds, upload_generation, upload_expires_at,
       deletion_generation, created_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,'uploading',$8,$9,$10,$11,$12,1,$13,1,$14)`,
    [
      input.id,
      input.partnershipId,
      input.uploaderAccountId,
      input.uploaderDeviceId,
      input.storageObjectKey,
      input.mediaKind,
      input.formatCode,
      input.ciphertextSize.toString(),
      input.ciphertextSha256,
      input.cryptoProtocolVersion,
      input.contentKeyId ?? null,
      input.durationSeconds,
      input.uploadExpiresAt,
      input.createdAt,
    ],
  );
}

export async function loadMediaObject(
  executor: QueryExecutor,
  mediaId: string,
): Promise<MediaObjectRecord | null> {
  const result = await executor.query<MediaRow>(
    `SELECT ${columns} FROM media_objects WHERE id = $1 LIMIT 1`,
    [mediaId],
  );
  return result.rows[0] ? mapMedia(result.rows[0]) : null;
}

export async function lockMediaObject(
  executor: QueryExecutor,
  mediaId: string,
): Promise<MediaObjectRecord | null> {
  const result = await executor.query<MediaRow>(
    `SELECT ${columns} FROM media_objects WHERE id = $1 FOR UPDATE`,
    [mediaId],
  );
  return result.rows[0] ? mapMedia(result.rows[0]) : null;
}

export async function lockMediaObjectsForBinding(
  executor: QueryExecutor,
  partnershipId: string,
  uploaderAccountId: string,
  mediaIds: readonly string[],
): Promise<readonly MediaObjectRecord[]> {
  if (mediaIds.length === 0) return [];
  const result = await executor.query<MediaRow>(
    `SELECT ${columns}
     FROM media_objects
     WHERE partnership_id = $1
       AND uploader_account_id = $2
       AND id = ANY($3::uuid[])
     ORDER BY id
     FOR UPDATE`,
    [partnershipId, uploaderAccountId, [...mediaIds]],
  );
  return result.rows.map(mapMedia);
}

export async function refreshMediaUpload(
  executor: QueryExecutor,
  mediaId: string,
  expectedGeneration: bigint,
  expiresAt: Date,
): Promise<bigint | null> {
  const result = await executor.query<{ upload_generation: string | number | bigint }>(
    `UPDATE media_objects
     SET upload_generation = upload_generation + 1,
         upload_expires_at = $3
     WHERE id = $1
       AND upload_generation = $2
       AND state = 'uploading'
       AND deleted_at IS NULL
     RETURNING upload_generation`,
    [mediaId, expectedGeneration.toString(), expiresAt],
  );
  return result.rows[0] ? BigInt(result.rows[0].upload_generation) : null;
}

export async function markMediaReady(
  executor: QueryExecutor,
  mediaId: string,
  expectedGeneration: bigint,
  readyAt: Date,
  unboundExpiresAt: Date,
): Promise<boolean> {
  const result = await executor.query(
    `UPDATE media_objects
     SET state = 'ready_unbound',
         ready_at = $3,
         upload_expires_at = $4
     WHERE id = $1
       AND upload_generation = $2
       AND state = 'uploading'
       AND deleted_at IS NULL`,
    [mediaId, expectedGeneration.toString(), readyAt, unboundExpiresAt],
  );
  return result.rowCount === 1;
}

export async function bindMediaObject(
  executor: QueryExecutor,
  input: {
    readonly mediaId: string;
    readonly bindingType: MediaBindingType;
    readonly bindingId: string;
    readonly bindingRole: MediaBindingRole;
    readonly position: number;
  },
): Promise<boolean> {
  const result = await executor.query(
    `UPDATE media_objects
     SET state = 'bound',
         binding_type = $2,
         binding_id = $3,
         binding_role = $4,
         binding_position = $5,
         upload_expires_at = NULL
     WHERE id = $1
       AND state = 'ready_unbound'
       AND deleted_at IS NULL
       AND binding_id IS NULL`,
    [input.mediaId, input.bindingType, input.bindingId, input.bindingRole, input.position],
  );
  return result.rowCount === 1;
}

export async function markMediaDeletionPending(
  executor: QueryExecutor,
  mediaId: string,
  deletedAt: Date,
): Promise<bigint | null> {
  const result = await executor.query<{ deletion_generation: string | number | bigint }>(
    `UPDATE media_objects
     SET state = 'deletion_pending',
         deleted_at = $2,
         deletion_generation = deletion_generation + 1
     WHERE id = $1
       AND state IN ('uploading', 'ready_unbound', 'bound')
       AND deleted_at IS NULL
     RETURNING deletion_generation`,
    [mediaId, deletedAt],
  );
  return result.rows[0] ? BigInt(result.rows[0].deletion_generation) : null;
}

export async function markBoundMediaDeletionPending(
  executor: QueryExecutor,
  bindingType: MediaBindingType,
  bindingId: string,
  deletedAt: Date,
): Promise<readonly { mediaId: string; generation: bigint }[]> {
  const result = await executor.query<{
    id: string;
    deletion_generation: string | number | bigint;
  }>(
    `UPDATE media_objects
     SET state = 'deletion_pending',
         deleted_at = $3,
         deletion_generation = deletion_generation + 1
     WHERE binding_type = $1
       AND binding_id = $2
       AND state = 'bound'
       AND deleted_at IS NULL
     RETURNING id, deletion_generation`,
    [bindingType, bindingId, deletedAt],
  );
  return result.rows.map((row) => ({
    mediaId: row.id,
    generation: BigInt(row.deletion_generation),
  }));
}

export async function listBoundMediaForContainer(
  executor: QueryExecutor,
  bindingType: MediaBindingType,
  bindingId: string,
): Promise<readonly MediaObjectRecord[]> {
  const result = await executor.query<MediaRow>(
    `SELECT ${columns}
     FROM media_objects
     WHERE binding_type = $1
       AND binding_id = $2
       AND state = 'bound'
       AND deleted_at IS NULL
     ORDER BY binding_position, id`,
    [bindingType, bindingId],
  );
  return result.rows.map(mapMedia);
}

export async function getMediaUploadGeneration(
  executor: QueryExecutor,
  mediaId: string,
): Promise<bigint> {
  const result = await executor.query<{ upload_generation: string | number | bigint }>(
    `SELECT upload_generation FROM media_objects
     WHERE id = $1 AND state IN ('uploading', 'ready_unbound') AND deleted_at IS NULL`,
    [mediaId],
  );
  return BigInt(result.rows[0]?.upload_generation ?? 0);
}

export async function getMediaDeletionGeneration(
  executor: QueryExecutor,
  mediaId: string,
): Promise<bigint> {
  const result = await executor.query<{ deletion_generation: string | number | bigint }>(
    `SELECT deletion_generation FROM media_objects
     WHERE id = $1 AND state = 'deletion_pending'`,
    [mediaId],
  );
  return BigInt(result.rows[0]?.deletion_generation ?? 0);
}

export async function loadMediaForDeletion(
  executor: QueryExecutor,
  mediaId: string,
  expectedGeneration?: bigint,
): Promise<MediaObjectRecord | null> {
  const result = await executor.query<MediaRow>(
    `SELECT ${columns}
     FROM media_objects
     WHERE id = $1
       AND state = 'deletion_pending'
       AND ($2::bigint IS NULL OR deletion_generation = $2)
     LIMIT 1`,
    [mediaId, expectedGeneration?.toString() ?? null],
  );
  return result.rows[0] ? mapMedia(result.rows[0]) : null;
}

export async function deleteMediaObjectMetadata(
  executor: QueryExecutor,
  mediaId: string,
  expectedGeneration?: bigint,
): Promise<boolean> {
  const result = await executor.query(
    `DELETE FROM media_objects
     WHERE id = $1
       AND state = 'deletion_pending'
       AND ($2::bigint IS NULL OR deletion_generation = $2)`,
    [mediaId, expectedGeneration?.toString() ?? null],
  );
  return result.rowCount === 1;
}

export async function listPartnershipMediaForDeletion(
  executor: QueryExecutor,
  partnershipId: string,
  limit = 100,
): Promise<readonly MediaObjectRecord[]> {
  const result = await executor.query<MediaRow>(
    `SELECT ${columns}
     FROM media_objects
     WHERE partnership_id = $1
     ORDER BY id
     LIMIT $2`,
    [partnershipId, limit],
  );
  return result.rows.map(mapMedia);
}

export async function deletePartnershipMediaObjectMetadata(
  executor: QueryExecutor,
  partnershipId: string,
  mediaId: string,
): Promise<boolean> {
  const result = await executor.query(
    "DELETE FROM media_objects WHERE partnership_id = $1 AND id = $2",
    [partnershipId, mediaId],
  );
  return result.rowCount === 1;
}
