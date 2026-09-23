ALTER TABLE media_objects
  ADD COLUMN media_kind text,
  ADD COLUMN format_code text,
  ADD COLUMN state text,
  ADD COLUMN uploader_device_id uuid,
  ADD COLUMN ciphertext_sha256 text,
  ADD COLUMN upload_generation bigint,
  ADD COLUMN upload_expires_at timestamptz,
  ADD COLUMN ready_at timestamptz,
  ADD COLUMN duration_seconds integer,
  ADD COLUMN binding_type text,
  ADD COLUMN binding_id uuid,
  ADD COLUMN binding_role text,
  ADD COLUMN binding_position integer,
  ADD COLUMN deletion_generation bigint;

UPDATE media_objects
SET media_kind = COALESCE(media_kind, 'file'),
    format_code = COALESCE(format_code, 'binary'),
    state = CASE WHEN deleted_at IS NULL THEN 'ready_unbound' ELSE 'failed' END,
    ciphertext_sha256 = COALESCE(ciphertext_sha256, repeat('0', 64)),
    crypto_protocol_version = COALESCE(crypto_protocol_version, 'legacy'),
    upload_generation = COALESCE(upload_generation, 1),
    ready_at = CASE WHEN deleted_at IS NULL THEN COALESCE(ready_at, created_at) ELSE ready_at END,
    upload_expires_at = CASE
      WHEN deleted_at IS NULL THEN COALESCE(upload_expires_at, created_at + interval '1 day')
      ELSE upload_expires_at
    END,
    deletion_generation = COALESCE(deletion_generation, 1);

ALTER TABLE media_objects
  ALTER COLUMN media_kind SET NOT NULL,
  ALTER COLUMN format_code SET NOT NULL,
  ALTER COLUMN state SET NOT NULL,
  ALTER COLUMN ciphertext_sha256 SET NOT NULL,
  ALTER COLUMN upload_generation SET NOT NULL,
  ALTER COLUMN deletion_generation SET NOT NULL,
  ALTER COLUMN crypto_protocol_version SET NOT NULL,
  ADD CONSTRAINT media_objects_identity_unique UNIQUE (id, partnership_id),
  ADD CONSTRAINT media_objects_uploader_device_account_fk
    FOREIGN KEY (uploader_device_id, uploader_account_id)
    REFERENCES account_devices(id, account_id)
    ON DELETE SET NULL (uploader_device_id),
  ADD CONSTRAINT media_objects_kind_valid
    CHECK (media_kind IN ('image', 'video', 'file', 'voice')),
  ADD CONSTRAINT media_objects_format_code_valid
    CHECK (format_code ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  ADD CONSTRAINT media_objects_state_valid
    CHECK (state IN ('uploading', 'ready_unbound', 'bound', 'deletion_pending', 'failed')),
  ADD CONSTRAINT media_objects_sha256_valid
    CHECK (ciphertext_sha256 ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT media_objects_generation_positive
    CHECK (upload_generation > 0 AND deletion_generation > 0),
  ADD CONSTRAINT media_objects_duration_positive
    CHECK (duration_seconds IS NULL OR duration_seconds > 0),
  ADD CONSTRAINT media_objects_binding_position_valid
    CHECK (binding_position IS NULL OR binding_position BETWEEN 0 AND 31),
  ADD CONSTRAINT media_objects_binding_shape
    CHECK (
      (binding_type IS NULL AND binding_id IS NULL AND binding_role IS NULL AND binding_position IS NULL)
      OR
      (
        binding_type IN ('message', 'relationship_item')
        AND binding_id IS NOT NULL
        AND binding_role IN ('attachment', 'voice_message', 'voice_letter')
        AND binding_position IS NOT NULL
        AND (
          (binding_type = 'message' AND binding_role IN ('attachment', 'voice_message'))
          OR
          (binding_type = 'relationship_item' AND binding_role IN ('attachment', 'voice_letter'))
        )
      )
    ),
  ADD CONSTRAINT media_objects_state_shape
    CHECK (
      (
        state = 'uploading'
        AND deleted_at IS NULL
        AND ready_at IS NULL
        AND upload_expires_at IS NOT NULL
        AND binding_id IS NULL
      )
      OR
      (
        state = 'ready_unbound'
        AND deleted_at IS NULL
        AND ready_at IS NOT NULL
        AND upload_expires_at IS NOT NULL
        AND binding_id IS NULL
      )
      OR
      (
        state = 'bound'
        AND deleted_at IS NULL
        AND ready_at IS NOT NULL
        AND binding_id IS NOT NULL
      )
      OR
      (state IN ('deletion_pending', 'failed') AND deleted_at IS NOT NULL)
    );

CREATE INDEX media_objects_uploader_unbound
  ON media_objects (uploader_account_id, created_at, id)
  WHERE state IN ('uploading', 'ready_unbound');

CREATE INDEX media_objects_upload_expiry
  ON media_objects (upload_expires_at, id)
  WHERE state IN ('uploading', 'ready_unbound');

CREATE INDEX media_objects_partnership_cleanup
  ON media_objects (partnership_id, state, id);

CREATE UNIQUE INDEX media_objects_binding_position_unique
  ON media_objects (binding_type, binding_id, binding_role, binding_position)
  WHERE state = 'bound';

CREATE FUNCTION reject_media_object_identity_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.partnership_id IS DISTINCT FROM OLD.partnership_id
     OR NEW.uploader_account_id IS DISTINCT FROM OLD.uploader_account_id
     OR NEW.storage_object_key IS DISTINCT FROM OLD.storage_object_key
     OR NEW.ciphertext_size IS DISTINCT FROM OLD.ciphertext_size
     OR NEW.ciphertext_sha256 IS DISTINCT FROM OLD.ciphertext_sha256
     OR NEW.media_kind IS DISTINCT FROM OLD.media_kind
     OR NEW.format_code IS DISTINCT FROM OLD.format_code
     OR NEW.crypto_protocol_version IS DISTINCT FROM OLD.crypto_protocol_version
     OR NEW.duration_seconds IS DISTINCT FROM OLD.duration_seconds
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'media object identity and encrypted payload metadata are immutable';
  END IF;

  IF OLD.binding_id IS NOT NULL AND (
    NEW.binding_type IS DISTINCT FROM OLD.binding_type
    OR NEW.binding_id IS DISTINCT FROM OLD.binding_id
    OR NEW.binding_role IS DISTINCT FROM OLD.binding_role
    OR NEW.binding_position IS DISTINCT FROM OLD.binding_position
  ) THEN
    RAISE EXCEPTION 'media binding identity is immutable after bind';
  END IF;

  IF OLD.binding_id IS NULL AND NEW.binding_id IS NOT NULL AND OLD.state <> 'ready_unbound' THEN
    RAISE EXCEPTION 'only ready_unbound media may be bound';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER media_objects_identity_immutable
BEFORE UPDATE ON media_objects
FOR EACH ROW
EXECUTE FUNCTION reject_media_object_identity_update();
