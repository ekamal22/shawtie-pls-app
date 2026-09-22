ALTER TABLE idempotency_records
  ADD COLUMN request_fingerprint_version integer;

ALTER TABLE idempotency_records
  ADD CONSTRAINT idempotency_records_fingerprint_version_positive
    CHECK (request_fingerprint_version IS NULL OR request_fingerprint_version > 0);

ALTER TABLE breakup_processes
  ADD COLUMN message_freeze_sequence bigint;

ALTER TABLE breakup_processes
  ADD CONSTRAINT breakup_processes_message_freeze_sequence_nonnegative
    CHECK (message_freeze_sequence IS NULL OR message_freeze_sequence >= 0);

ALTER TABLE conversations
  ADD COLUMN next_change_sequence bigint NOT NULL DEFAULT 1;

ALTER TABLE conversations
  ADD CONSTRAINT conversations_change_sequence_positive
    CHECK (next_change_sequence > 0);

INSERT INTO conversations (id, partnership_id, kind, next_server_sequence, next_change_sequence, created_at)
SELECT
  (
    substr(md5(partnership.id::text || ':primary'), 1, 8) || '-' ||
    substr(md5(partnership.id::text || ':primary'), 9, 4) || '-' ||
    substr(md5(partnership.id::text || ':primary'), 13, 4) || '-' ||
    substr(md5(partnership.id::text || ':primary'), 17, 4) || '-' ||
    substr(md5(partnership.id::text || ':primary'), 21, 12)
  )::uuid,
  partnership.id,
  'primary',
  1,
  1,
  partnership.activated_at
FROM partnerships AS partnership
WHERE partnership.lifecycle_state IN ('active', 'breakup_pending')
ON CONFLICT (partnership_id, kind) DO NOTHING;

ALTER TABLE messages
  ADD COLUMN body_text text,
  ADD COLUMN content_version bigint NOT NULL DEFAULT 1,
  ADD COLUMN request_fingerprint bytea,
  ADD COLUMN request_fingerprint_version integer,
  ADD COLUMN created_change_sequence bigint,
  ADD COLUMN last_change_sequence bigint;

UPDATE messages
SET created_change_sequence = server_sequence,
    last_change_sequence = server_sequence
WHERE created_change_sequence IS NULL OR last_change_sequence IS NULL;

ALTER TABLE messages
  ALTER COLUMN created_change_sequence SET NOT NULL,
  ALTER COLUMN last_change_sequence SET NOT NULL;

ALTER TABLE messages
  ADD CONSTRAINT messages_content_version_positive
    CHECK (content_version > 0),
  ADD CONSTRAINT messages_created_change_sequence_positive
    CHECK (created_change_sequence > 0),
  ADD CONSTRAINT messages_last_change_sequence_positive
    CHECK (last_change_sequence >= created_change_sequence),
  ADD CONSTRAINT messages_request_fingerprint_pair
    CHECK (
      (request_fingerprint IS NULL AND request_fingerprint_version IS NULL)
      OR
      (
        request_fingerprint IS NOT NULL
        AND request_fingerprint_version IS NOT NULL
        AND request_fingerprint_version > 0
      )
    ),
  ADD CONSTRAINT messages_body_size
    CHECK (body_text IS NULL OR octet_length(body_text) BETWEEN 1 AND 8192),
  ADD CONSTRAINT messages_m1_content_shape
    CHECK (
      (deleted_at IS NOT NULL AND body_text IS NULL AND ciphertext IS NULL)
      OR
      (
        deleted_at IS NULL
        AND num_nonnulls(body_text, ciphertext) = 1
        AND (ciphertext IS NULL OR ciphertext_version IS NOT NULL)
      )
    ) NOT VALID;

CREATE FUNCTION reject_message_creation_identity_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.conversation_id IS DISTINCT FROM OLD.conversation_id
     OR NEW.partnership_id IS DISTINCT FROM OLD.partnership_id
     OR NEW.sender_account_id IS DISTINCT FROM OLD.sender_account_id
     OR NEW.client_idempotency_key IS DISTINCT FROM OLD.client_idempotency_key
     OR NEW.server_sequence IS DISTINCT FROM OLD.server_sequence
     OR NEW.created_change_sequence IS DISTINCT FROM OLD.created_change_sequence
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'message creation identity and order are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER messages_creation_identity_immutable
BEFORE UPDATE ON messages
FOR EACH ROW
EXECUTE FUNCTION reject_message_creation_identity_update();

CREATE TABLE conversation_changes (
  conversation_id uuid NOT NULL,
  change_sequence bigint NOT NULL,
  change_type text NOT NULL,
  message_id uuid NOT NULL,
  content_version bigint,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (conversation_id, change_sequence),
  CONSTRAINT conversation_changes_conversation_fk
    FOREIGN KEY (conversation_id)
    REFERENCES conversations(id)
    ON DELETE CASCADE,
  CONSTRAINT conversation_changes_message_fk
    FOREIGN KEY (message_id, conversation_id)
    REFERENCES messages(id, conversation_id)
    ON DELETE CASCADE,
  CONSTRAINT conversation_changes_sequence_positive
    CHECK (change_sequence > 0),
  CONSTRAINT conversation_changes_content_version_positive
    CHECK (content_version IS NULL OR content_version > 0),
  CONSTRAINT conversation_changes_type_valid
    CHECK (
      change_type IN (
        'message.created',
        'message.updated',
        'message.deleted',
        'message.reaction_changed'
      )
    )
);

CREATE INDEX conversation_changes_message
  ON conversation_changes (message_id, change_sequence DESC);

INSERT INTO conversation_changes (
  conversation_id, change_sequence, change_type, message_id, content_version, created_at
)
SELECT
  message.conversation_id,
  message.server_sequence,
  CASE
    WHEN message.deleted_at IS NOT NULL THEN 'message.deleted'
    ELSE 'message.created'
  END,
  message.id,
  message.content_version,
  COALESCE(message.deleted_at, message.edited_at, message.created_at)
FROM messages AS message
ON CONFLICT (conversation_id, change_sequence) DO NOTHING;

UPDATE conversations AS conversation
SET next_change_sequence = GREATEST(
  conversation.next_server_sequence,
  COALESCE(
    (
      SELECT max(change.change_sequence) + 1
      FROM conversation_changes AS change
      WHERE change.conversation_id = conversation.id
    ),
    1
  )
);

CREATE FUNCTION reject_conversation_change_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'conversation_changes rows are append-only while retained';
END;
$$;

CREATE TRIGGER conversation_changes_no_update
BEFORE UPDATE ON conversation_changes
FOR EACH ROW
EXECUTE FUNCTION reject_conversation_change_update();

ALTER TABLE message_reactions
  ALTER COLUMN encrypted_reaction DROP NOT NULL,
  ADD COLUMN emoji_text text;

ALTER TABLE message_reactions
  ADD CONSTRAINT message_reactions_content_shape
    CHECK (
      removed_at IS NOT NULL
      OR num_nonnulls(emoji_text, encrypted_reaction) = 1
    ) NOT VALID,
  ADD CONSTRAINT message_reactions_emoji_size
    CHECK (emoji_text IS NULL OR octet_length(emoji_text) BETWEEN 1 AND 32);

CREATE UNIQUE INDEX message_reactions_one_active_account
  ON message_reactions (message_id, reactor_account_id)
  WHERE removed_at IS NULL;
