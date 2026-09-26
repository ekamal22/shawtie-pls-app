CREATE TABLE protected_content_keys (
  id uuid PRIMARY KEY,
  partnership_id uuid NOT NULL REFERENCES partnerships(id) ON DELETE CASCADE,
  content_type text NOT NULL,
  content_id uuid NOT NULL,
  content_version bigint NOT NULL,
  payload_role text NOT NULL,
  crypto_profile text NOT NULL,
  group_generation integer NOT NULL,
  mls_epoch bigint NOT NULL,
  sender_crypto_device_id uuid NOT NULL REFERENCES device_crypto_identities(crypto_device_id) ON DELETE RESTRICT,
  nonce bytea NOT NULL,
  key_distribution_message bytea NOT NULL,
  ciphertext_sha256 bytea NOT NULL,
  content_signature bytea NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT protected_content_keys_group_fk
    FOREIGN KEY (partnership_id, group_generation)
    REFERENCES partnership_crypto_groups(partnership_id, group_generation)
    ON DELETE CASCADE,
  CONSTRAINT protected_content_keys_type_valid
    CHECK (content_type IN ('message', 'message_reaction', 'partnership_nickname', 'relationship_item', 'media')),
  CONSTRAINT protected_content_keys_role_valid
    CHECK (payload_role IN (
      'message_body',
      'reaction_value',
      'nickname_value',
      'relationship_preview',
      'relationship_main',
      'media_content'
    )),
  CONSTRAINT protected_content_keys_version_positive CHECK (content_version > 0),
  CONSTRAINT protected_content_keys_generation_positive CHECK (group_generation > 0),
  CONSTRAINT protected_content_keys_epoch_nonnegative CHECK (mls_epoch >= 0),
  CONSTRAINT protected_content_keys_profile_nonempty CHECK (length(crypto_profile) > 0),
  CONSTRAINT protected_content_keys_nonce_nonempty CHECK (octet_length(nonce) > 0),
  CONSTRAINT protected_content_keys_distribution_nonempty CHECK (octet_length(key_distribution_message) > 0),
  CONSTRAINT protected_content_keys_digest_size CHECK (octet_length(ciphertext_sha256) = 32),
  CONSTRAINT protected_content_keys_signature_nonempty CHECK (octet_length(content_signature) > 0),
  UNIQUE (partnership_id, content_type, content_id, content_version, payload_role)
);

CREATE INDEX protected_content_keys_partnership
  ON protected_content_keys (partnership_id, content_type, content_id);

CREATE TABLE content_key_recovery_capsules (
  content_key_id uuid NOT NULL REFERENCES protected_content_keys(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  recovery_key_version integer NOT NULL,
  hpke_encapsulation bytea NOT NULL,
  hpke_ciphertext bytea NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (content_key_id, account_id),
  CONSTRAINT content_key_recovery_capsules_recovery_fk
    FOREIGN KEY (account_id, recovery_key_version)
    REFERENCES account_crypto_recovery(account_id, recovery_key_version)
    ON DELETE RESTRICT,
  CONSTRAINT content_key_recovery_capsules_version_positive CHECK (recovery_key_version > 0),
  CONSTRAINT content_key_recovery_capsules_encapsulation_nonempty CHECK (octet_length(hpke_encapsulation) > 0),
  CONSTRAINT content_key_recovery_capsules_ciphertext_nonempty CHECK (octet_length(hpke_ciphertext) > 0)
);

ALTER TABLE messages
  ADD COLUMN body_content_key_id uuid REFERENCES protected_content_keys(id) ON DELETE SET NULL,
  DROP CONSTRAINT messages_m3_content_shape,
  ADD CONSTRAINT messages_s1_content_shape
    CHECK (
      (
        deleted_at IS NOT NULL
        AND body_text IS NULL
        AND ciphertext IS NULL
        AND body_content_key_id IS NULL
      )
      OR
      (
        deleted_at IS NULL
        AND num_nonnulls(body_text, ciphertext) <= 1
        AND (
          (ciphertext IS NULL AND body_content_key_id IS NULL)
          OR
          (
            ciphertext IS NOT NULL
            AND ciphertext_version IS NOT NULL
            AND body_content_key_id IS NOT NULL
          )
        )
      )
    );

CREATE UNIQUE INDEX messages_body_content_key_unique
  ON messages (body_content_key_id)
  WHERE body_content_key_id IS NOT NULL;

ALTER TABLE message_reactions
  ADD COLUMN content_key_id uuid REFERENCES protected_content_keys(id) ON DELETE SET NULL,
  DROP CONSTRAINT message_reactions_content_shape,
  ADD CONSTRAINT message_reactions_s1_content_shape
    CHECK (
      (
        emoji_text IS NOT NULL
        AND encrypted_reaction IS NULL
        AND ciphertext_version IS NULL
        AND content_key_id IS NULL
      )
      OR
      (
        emoji_text IS NULL
        AND encrypted_reaction IS NOT NULL
        AND ciphertext_version IS NOT NULL
        AND content_key_id IS NOT NULL
      )
    );

CREATE UNIQUE INDEX message_reactions_content_key_unique
  ON message_reactions (content_key_id)
  WHERE content_key_id IS NOT NULL;

ALTER TABLE partnership_chat_nicknames
  ADD COLUMN encrypted_nickname bytea,
  ADD COLUMN ciphertext_version text,
  ADD COLUMN content_key_id uuid REFERENCES protected_content_keys(id) ON DELETE SET NULL,
  ADD CONSTRAINT partnership_chat_nicknames_s1_content_shape
    CHECK (
      (
        nickname IS NULL
        AND encrypted_nickname IS NULL
        AND ciphertext_version IS NULL
        AND content_key_id IS NULL
      )
      OR
      (
        nickname IS NOT NULL
        AND encrypted_nickname IS NULL
        AND ciphertext_version IS NULL
        AND content_key_id IS NULL
      )
      OR
      (
        nickname IS NULL
        AND encrypted_nickname IS NOT NULL
        AND ciphertext_version IS NOT NULL
        AND content_key_id IS NOT NULL
      )
    );

CREATE UNIQUE INDEX partnership_chat_nicknames_content_key_unique
  ON partnership_chat_nicknames (content_key_id)
  WHERE content_key_id IS NOT NULL;

ALTER TABLE relationship_items
  ADD COLUMN preview_content_key_id uuid REFERENCES protected_content_keys(id) ON DELETE SET NULL,
  ADD COLUMN main_content_key_id uuid REFERENCES protected_content_keys(id) ON DELETE SET NULL,
  ADD CONSTRAINT relationship_items_s1_key_shape
    CHECK (
      (encrypted_preview_payload IS NULL OR preview_content_key_id IS NOT NULL)
      AND (encrypted_payload IS NULL OR main_content_key_id IS NOT NULL)
    ) NOT VALID;

CREATE UNIQUE INDEX relationship_items_preview_content_key_unique
  ON relationship_items (preview_content_key_id)
  WHERE preview_content_key_id IS NOT NULL;

CREATE UNIQUE INDEX relationship_items_main_content_key_unique
  ON relationship_items (main_content_key_id)
  WHERE main_content_key_id IS NOT NULL;

ALTER TABLE media_objects
  ADD COLUMN content_key_id uuid REFERENCES protected_content_keys(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX media_objects_content_key_unique
  ON media_objects (content_key_id)
  WHERE content_key_id IS NOT NULL;

CREATE FUNCTION s1_reject_crypto_required_plaintext()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  required_at timestamptz;
BEGIN
  SELECT crypto_required_from INTO required_at
  FROM partnerships
  WHERE id = NEW.partnership_id;

  IF required_at IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'messages' THEN
    IF NEW.deleted_at IS NULL AND NEW.body_text IS NOT NULL THEN
      RAISE EXCEPTION 'crypto-required message plaintext is forbidden';
    END IF;
    IF NEW.deleted_at IS NULL AND NEW.ciphertext IS NOT NULL AND NEW.body_content_key_id IS NULL THEN
      RAISE EXCEPTION 'crypto-required message ciphertext requires S1 key metadata';
    END IF;
  ELSIF TG_TABLE_NAME = 'message_reactions' THEN
    IF NEW.emoji_text IS NOT NULL
       OR NEW.encrypted_reaction IS NULL
       OR NEW.content_key_id IS NULL THEN
      RAISE EXCEPTION 'crypto-required reaction must be encrypted';
    END IF;
  ELSIF TG_TABLE_NAME = 'partnership_chat_nicknames' THEN
    IF NEW.nickname IS NOT NULL THEN
      RAISE EXCEPTION 'crypto-required nickname plaintext is forbidden';
    END IF;
    IF NEW.encrypted_nickname IS NOT NULL AND NEW.content_key_id IS NULL THEN
      RAISE EXCEPTION 'crypto-required nickname ciphertext requires S1 key metadata';
    END IF;
  ELSIF TG_TABLE_NAME = 'relationship_items' THEN
    IF NEW.development_preview_payload IS NOT NULL OR NEW.development_plaintext_payload IS NOT NULL THEN
      RAISE EXCEPTION 'crypto-required relationship plaintext is forbidden';
    END IF;
  ELSIF TG_TABLE_NAME = 'media_objects' THEN
    IF NEW.content_key_id IS NULL OR NEW.crypto_protocol_version <> 'shawtie.mls.v1' THEN
      RAISE EXCEPTION 'crypto-required media requires S1 key metadata';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER messages_s1_plaintext_guard
BEFORE INSERT OR UPDATE OF body_text, ciphertext, body_content_key_id, deleted_at
ON messages
FOR EACH ROW
EXECUTE FUNCTION s1_reject_crypto_required_plaintext();

CREATE TRIGGER message_reactions_s1_plaintext_guard
BEFORE INSERT OR UPDATE OF emoji_text, encrypted_reaction, content_key_id
ON message_reactions
FOR EACH ROW
EXECUTE FUNCTION s1_reject_crypto_required_plaintext();

CREATE TRIGGER partnership_chat_nicknames_s1_plaintext_guard
BEFORE INSERT OR UPDATE OF nickname, encrypted_nickname, content_key_id
ON partnership_chat_nicknames
FOR EACH ROW
EXECUTE FUNCTION s1_reject_crypto_required_plaintext();

CREATE TRIGGER relationship_items_s1_plaintext_guard
BEFORE INSERT OR UPDATE OF development_preview_payload, development_plaintext_payload,
  encrypted_preview_payload, encrypted_payload, preview_content_key_id, main_content_key_id
ON relationship_items
FOR EACH ROW
EXECUTE FUNCTION s1_reject_crypto_required_plaintext();

CREATE TRIGGER media_objects_s1_crypto_guard
BEFORE INSERT OR UPDATE OF crypto_protocol_version, content_key_id
ON media_objects
FOR EACH ROW
EXECUTE FUNCTION s1_reject_crypto_required_plaintext();
