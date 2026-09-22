CREATE TABLE conversation_member_state (
  conversation_id uuid NOT NULL,
  partnership_id uuid NOT NULL,
  account_id uuid NOT NULL,
  delivered_through bigint NOT NULL DEFAULT 0,
  read_through bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, account_id),
  CONSTRAINT conversation_member_state_conversation_fk
    FOREIGN KEY (conversation_id, partnership_id)
    REFERENCES conversations(id, partnership_id)
    ON DELETE CASCADE,
  CONSTRAINT conversation_member_state_member_fk
    FOREIGN KEY (partnership_id, account_id)
    REFERENCES partnership_members(partnership_id, account_id)
    ON DELETE CASCADE,
  CONSTRAINT conversation_member_state_sequences_nonnegative
    CHECK (delivered_through >= 0 AND read_through >= 0),
  CONSTRAINT conversation_member_state_read_implies_delivery
    CHECK (read_through <= delivered_through)
);

INSERT INTO conversation_member_state (
  conversation_id, partnership_id, account_id, delivered_through, read_through, updated_at
)
SELECT
  conversation.id,
  conversation.partnership_id,
  member.account_id,
  0,
  0,
  conversation.created_at
FROM conversations AS conversation
JOIN partnership_members AS member
  ON member.partnership_id = conversation.partnership_id
WHERE conversation.kind = 'primary'
  AND member.released_at IS NULL
ON CONFLICT (conversation_id, account_id) DO NOTHING;

CREATE TABLE partnership_chat_nicknames (
  partnership_id uuid NOT NULL,
  subject_account_id uuid NOT NULL,
  nickname text,
  version bigint NOT NULL DEFAULT 1,
  updated_by_account_id uuid NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (partnership_id, subject_account_id),
  CONSTRAINT partnership_chat_nicknames_subject_member_fk
    FOREIGN KEY (partnership_id, subject_account_id)
    REFERENCES partnership_members(partnership_id, account_id)
    ON DELETE CASCADE,
  CONSTRAINT partnership_chat_nicknames_updater_member_fk
    FOREIGN KEY (partnership_id, updated_by_account_id)
    REFERENCES partnership_members(partnership_id, account_id),
  CONSTRAINT partnership_chat_nicknames_version_positive
    CHECK (version > 0),
  CONSTRAINT partnership_chat_nicknames_size
    CHECK (nickname IS NULL OR octet_length(nickname) BETWEEN 1 AND 256)
);

CREATE TABLE account_presence (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  last_seen_at timestamptz NOT NULL,
  online_until timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT account_presence_online_window
    CHECK (online_until >= last_seen_at)
);

CREATE TABLE conversation_typing_state (
  conversation_id uuid NOT NULL,
  partnership_id uuid NOT NULL,
  account_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (conversation_id, account_id),
  CONSTRAINT conversation_typing_state_conversation_fk
    FOREIGN KEY (conversation_id, partnership_id)
    REFERENCES conversations(id, partnership_id)
    ON DELETE CASCADE,
  CONSTRAINT conversation_typing_state_member_fk
    FOREIGN KEY (partnership_id, account_id)
    REFERENCES partnership_members(partnership_id, account_id)
    ON DELETE CASCADE
);

CREATE INDEX conversation_typing_state_expiry
  ON conversation_typing_state (expires_at, conversation_id);
