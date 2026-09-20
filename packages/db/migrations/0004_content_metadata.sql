CREATE TABLE conversations (
  id uuid PRIMARY KEY,
  partnership_id uuid NOT NULL REFERENCES partnerships(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'primary',
  next_server_sequence bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversations_kind_valid
    CHECK (kind IN ('primary')),
  CONSTRAINT conversations_sequence_positive
    CHECK (next_server_sequence > 0),
  UNIQUE (id, partnership_id),
  UNIQUE (partnership_id, kind)
);

CREATE TABLE messages (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL,
  partnership_id uuid NOT NULL,
  sender_account_id uuid NOT NULL,
  sender_device_id uuid REFERENCES account_devices(id) ON DELETE SET NULL,
  reply_to_message_id uuid REFERENCES messages(id) ON DELETE SET NULL,
  client_idempotency_key text NOT NULL,
  server_sequence bigint NOT NULL,
  ciphertext bytea,
  ciphertext_version text,
  created_at timestamptz NOT NULL,
  edited_at timestamptz,
  deleted_at timestamptz,
  CONSTRAINT messages_conversation_fk
    FOREIGN KEY (conversation_id, partnership_id)
    REFERENCES conversations(id, partnership_id)
    ON DELETE CASCADE,
  CONSTRAINT messages_sender_member_fk
    FOREIGN KEY (partnership_id, sender_account_id)
    REFERENCES partnership_members(partnership_id, account_id),
  CONSTRAINT messages_sequence_positive
    CHECK (server_sequence > 0),
  CONSTRAINT messages_deleted_content_removed
    CHECK (deleted_at IS NULL OR ciphertext IS NULL)
);

CREATE UNIQUE INDEX messages_conversation_sequence_unique
  ON messages (conversation_id, server_sequence);

CREATE UNIQUE INDEX messages_sender_idempotency_unique
  ON messages (conversation_id, sender_account_id, client_idempotency_key);

CREATE INDEX messages_conversation_order
  ON messages (conversation_id, server_sequence);

CREATE TABLE message_versions (
  id uuid PRIMARY KEY,
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  version integer NOT NULL,
  ciphertext bytea NOT NULL,
  ciphertext_version text,
  created_at timestamptz NOT NULL,
  UNIQUE (message_id, version),
  CONSTRAINT message_versions_version_positive
    CHECK (version > 0)
);

CREATE TABLE message_reactions (
  id uuid PRIMARY KEY,
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  reactor_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  encrypted_reaction bytea NOT NULL,
  ciphertext_version text,
  created_at timestamptz NOT NULL,
  removed_at timestamptz
);

CREATE INDEX message_reactions_message_active
  ON message_reactions (message_id, created_at)
  WHERE removed_at IS NULL;

CREATE TABLE message_receipts (
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  receipt_type text NOT NULL,
  recorded_at timestamptz NOT NULL,
  PRIMARY KEY (message_id, account_id, receipt_type),
  CONSTRAINT message_receipts_type_valid
    CHECK (receipt_type IN ('delivered', 'read'))
);

CREATE TABLE relationship_items (
  id uuid PRIMARY KEY,
  partnership_id uuid NOT NULL REFERENCES partnerships(id) ON DELETE CASCADE,
  creator_account_id uuid NOT NULL,
  kind text NOT NULL,
  lifecycle text NOT NULL DEFAULT 'active',
  version bigint NOT NULL DEFAULT 1,
  occurred_date date,
  occurred_precision text,
  unlock_at timestamptz,
  encrypted_payload bytea,
  ciphertext_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT relationship_items_creator_member_fk
    FOREIGN KEY (partnership_id, creator_account_id)
    REFERENCES partnership_members(partnership_id, account_id),
  CONSTRAINT relationship_items_version_positive
    CHECK (version > 0),
  CONSTRAINT relationship_items_lifecycle_valid
    CHECK (lifecycle IN ('active', 'deleted')),
  CONSTRAINT relationship_items_occurred_precision_valid
    CHECK (occurred_precision IS NULL OR occurred_precision IN ('day', 'month', 'year', 'unknown'))
);

CREATE INDEX relationship_items_partnership_kind
  ON relationship_items (partnership_id, kind, created_at);

CREATE INDEX relationship_items_unlock_due
  ON relationship_items (unlock_at, id)
  WHERE unlock_at IS NOT NULL AND lifecycle = 'active';

CREATE TABLE relationship_events (
  id uuid PRIMARY KEY,
  partnership_id uuid NOT NULL REFERENCES partnerships(id) ON DELETE CASCADE,
  item_id uuid REFERENCES relationship_items(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  actor_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  item_version bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX relationship_events_partnership_time
  ON relationship_events (partnership_id, created_at, id);

CREATE TABLE media_objects (
  id uuid PRIMARY KEY,
  partnership_id uuid NOT NULL REFERENCES partnerships(id) ON DELETE CASCADE,
  uploader_account_id uuid NOT NULL,
  storage_object_key text NOT NULL,
  ciphertext_size bigint NOT NULL,
  crypto_protocol_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT media_objects_uploader_member_fk
    FOREIGN KEY (partnership_id, uploader_account_id)
    REFERENCES partnership_members(partnership_id, account_id),
  CONSTRAINT media_objects_ciphertext_size_nonnegative
    CHECK (ciphertext_size >= 0)
);

CREATE UNIQUE INDEX media_objects_storage_key_unique
  ON media_objects (storage_object_key);

CREATE INDEX media_objects_partnership_active
  ON media_objects (partnership_id, created_at)
  WHERE deleted_at IS NULL;

CREATE TABLE call_sessions (
  id uuid PRIMARY KEY,
  partnership_id uuid NOT NULL REFERENCES partnerships(id) ON DELETE CASCADE,
  initiated_by_account_id uuid NOT NULL,
  call_type text NOT NULL,
  status text NOT NULL,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT call_sessions_initiator_member_fk
    FOREIGN KEY (partnership_id, initiated_by_account_id)
    REFERENCES partnership_members(partnership_id, account_id),
  CONSTRAINT call_sessions_type_valid
    CHECK (call_type IN ('voice', 'video')),
  CONSTRAINT call_sessions_status_valid
    CHECK (status IN ('ringing', 'accepted', 'rejected', 'cancelled', 'ended', 'missed'))
);

CREATE INDEX call_sessions_partnership_time
  ON call_sessions (partnership_id, created_at DESC);

CREATE TABLE call_participants (
  call_session_id uuid NOT NULL REFERENCES call_sessions(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  joined_at timestamptz,
  left_at timestamptz,
  PRIMARY KEY (call_session_id, account_id)
);

CREATE TABLE call_events (
  id uuid PRIMARY KEY,
  call_session_id uuid NOT NULL REFERENCES call_sessions(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  actor_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX call_events_session_time
  ON call_events (call_session_id, created_at, id);
