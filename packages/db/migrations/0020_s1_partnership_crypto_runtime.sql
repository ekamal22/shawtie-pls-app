ALTER TABLE partnerships
  ADD COLUMN crypto_profile text,
  ADD COLUMN crypto_required_from timestamptz,
  ADD COLUMN crypto_group_generation integer,
  ADD CONSTRAINT partnerships_crypto_shape
    CHECK (
      (crypto_profile IS NULL AND crypto_required_from IS NULL AND crypto_group_generation IS NULL)
      OR
      (
        crypto_profile IS NOT NULL
        AND crypto_required_from IS NOT NULL
        AND crypto_group_generation IS NOT NULL
        AND crypto_group_generation > 0
      )
    ) NOT VALID;

CREATE TABLE partnership_crypto_groups (
  partnership_id uuid NOT NULL REFERENCES partnerships(id) ON DELETE CASCADE,
  group_generation integer NOT NULL,
  group_id bytea NOT NULL,
  crypto_profile text NOT NULL,
  ciphersuite text NOT NULL,
  current_epoch bigint NOT NULL,
  control_sequence bigint NOT NULL DEFAULT 0,
  rekey_required boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active',
  created_by_crypto_device_id uuid NOT NULL REFERENCES device_crypto_identities(crypto_device_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL,
  superseded_at timestamptz,
  destroyed_at timestamptz,
  PRIMARY KEY (partnership_id, group_generation),
  CONSTRAINT partnership_crypto_groups_generation_positive CHECK (group_generation > 0),
  CONSTRAINT partnership_crypto_groups_epoch_nonnegative CHECK (current_epoch >= 0),
  CONSTRAINT partnership_crypto_groups_control_sequence_nonnegative CHECK (control_sequence >= 0),
  CONSTRAINT partnership_crypto_groups_id_nonempty CHECK (octet_length(group_id) > 0),
  CONSTRAINT partnership_crypto_groups_profile_nonempty CHECK (length(crypto_profile) > 0),
  CONSTRAINT partnership_crypto_groups_ciphersuite_nonempty CHECK (length(ciphersuite) > 0),
  CONSTRAINT partnership_crypto_groups_status_valid CHECK (status IN ('active', 'superseded', 'destroyed')),
  CONSTRAINT partnership_crypto_groups_terminal_shape
    CHECK (
      (status = 'active' AND superseded_at IS NULL AND destroyed_at IS NULL)
      OR (status = 'superseded' AND superseded_at IS NOT NULL AND destroyed_at IS NULL)
      OR (status = 'destroyed' AND destroyed_at IS NOT NULL)
    )
);

CREATE UNIQUE INDEX partnership_crypto_groups_group_id_unique
  ON partnership_crypto_groups (group_id);

CREATE UNIQUE INDEX partnership_crypto_groups_one_active
  ON partnership_crypto_groups (partnership_id)
  WHERE status = 'active';

CREATE TABLE partnership_crypto_members (
  partnership_id uuid NOT NULL,
  group_generation integer NOT NULL,
  crypto_device_id uuid NOT NULL REFERENCES device_crypto_identities(crypto_device_id) ON DELETE RESTRICT,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  leaf_index integer NOT NULL,
  joined_epoch bigint NOT NULL,
  removed_epoch bigint,
  joined_at timestamptz NOT NULL,
  removed_at timestamptz,
  PRIMARY KEY (partnership_id, group_generation, crypto_device_id),
  CONSTRAINT partnership_crypto_members_group_fk
    FOREIGN KEY (partnership_id, group_generation)
    REFERENCES partnership_crypto_groups(partnership_id, group_generation)
    ON DELETE CASCADE,
  CONSTRAINT partnership_crypto_members_leaf_nonnegative CHECK (leaf_index >= 0),
  CONSTRAINT partnership_crypto_members_joined_epoch_nonnegative CHECK (joined_epoch >= 0),
  CONSTRAINT partnership_crypto_members_removed_shape
    CHECK (
      (removed_epoch IS NULL AND removed_at IS NULL)
      OR (removed_epoch IS NOT NULL AND removed_at IS NOT NULL AND removed_epoch > joined_epoch)
    )
);

CREATE UNIQUE INDEX partnership_crypto_members_active_leaf
  ON partnership_crypto_members (partnership_id, group_generation, leaf_index)
  WHERE removed_at IS NULL;

CREATE INDEX partnership_crypto_members_active_device
  ON partnership_crypto_members (crypto_device_id, partnership_id)
  WHERE removed_at IS NULL;

CREATE TABLE partnership_crypto_control_messages (
  partnership_id uuid NOT NULL,
  group_generation integer NOT NULL,
  control_sequence bigint NOT NULL,
  kind text NOT NULL,
  epoch_from bigint NOT NULL,
  epoch_to bigint NOT NULL,
  sender_crypto_device_id uuid NOT NULL REFERENCES device_crypto_identities(crypto_device_id) ON DELETE RESTRICT,
  recipient_crypto_device_id uuid REFERENCES device_crypto_identities(crypto_device_id) ON DELETE SET NULL,
  target_crypto_device_id uuid REFERENCES device_crypto_identities(crypto_device_id) ON DELETE SET NULL,
  mls_message bytea NOT NULL,
  welcome bytea,
  message_sha256 bytea NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (partnership_id, group_generation, control_sequence),
  CONSTRAINT partnership_crypto_control_group_fk
    FOREIGN KEY (partnership_id, group_generation)
    REFERENCES partnership_crypto_groups(partnership_id, group_generation)
    ON DELETE CASCADE,
  CONSTRAINT partnership_crypto_control_sequence_positive CHECK (control_sequence > 0),
  CONSTRAINT partnership_crypto_control_kind_valid CHECK (kind IN ('add', 'remove', 'update', 'reset')),
  CONSTRAINT partnership_crypto_control_epoch_valid CHECK (epoch_to = epoch_from + 1),
  CONSTRAINT partnership_crypto_control_message_nonempty CHECK (octet_length(mls_message) > 0),
  CONSTRAINT partnership_crypto_control_digest_size CHECK (octet_length(message_sha256) = 32),
  CONSTRAINT partnership_crypto_control_welcome_shape
    CHECK (
      (kind = 'add' AND welcome IS NOT NULL AND target_crypto_device_id IS NOT NULL)
      OR (kind <> 'add' AND welcome IS NULL)
    )
);

CREATE INDEX partnership_crypto_control_cursor
  ON partnership_crypto_control_messages (partnership_id, group_generation, control_sequence);

CREATE INDEX partnership_crypto_control_recipient
  ON partnership_crypto_control_messages (recipient_crypto_device_id, partnership_id, control_sequence)
  WHERE recipient_crypto_device_id IS NOT NULL;

CREATE FUNCTION s1_mark_groups_rekey_required_on_crypto_revoke()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.trust_state <> 'revoked' AND NEW.trust_state = 'revoked' THEN
    UPDATE partnership_crypto_groups AS groups
    SET rekey_required = true
    WHERE groups.status = 'active'
      AND EXISTS (
        SELECT 1
        FROM partnership_crypto_members AS members
        WHERE members.partnership_id = groups.partnership_id
          AND members.group_generation = groups.group_generation
          AND members.crypto_device_id = NEW.crypto_device_id
          AND members.removed_at IS NULL
      );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER device_crypto_identity_rekey_groups
AFTER UPDATE OF trust_state ON device_crypto_identities
FOR EACH ROW
EXECUTE FUNCTION s1_mark_groups_rekey_required_on_crypto_revoke();
