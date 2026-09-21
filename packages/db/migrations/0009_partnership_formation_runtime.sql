ALTER TABLE partner_requests
  ADD COLUMN accepted_partnership_id uuid REFERENCES partnerships(id);

ALTER TABLE partner_requests
  ADD CONSTRAINT partner_requests_accepted_link_required
    CHECK (status <> 'accepted' OR accepted_partnership_id IS NOT NULL) NOT VALID,
  ADD CONSTRAINT partner_requests_accepted_link_terminal_only
    CHECK (status = 'accepted' OR accepted_partnership_id IS NULL) NOT VALID;

CREATE INDEX partner_requests_accepted_partnership
  ON partner_requests (accepted_partnership_id, accepted_at DESC, id)
  WHERE accepted_partnership_id IS NOT NULL;

CREATE TABLE account_notifications (
  id uuid PRIMARY KEY,
  recipient_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  actor_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  partnership_id uuid REFERENCES partnerships(id),
  event_type text NOT NULL,
  deduplication_key text NOT NULL,
  created_at timestamptz NOT NULL,
  read_at timestamptz,
  CONSTRAINT account_notifications_event_type_valid
    CHECK (event_type IN ('partnership_formed', 'relationship_start_date_changed')),
  CONSTRAINT account_notifications_deduplication_nonempty
    CHECK (length(deduplication_key) > 0),
  CONSTRAINT account_notifications_read_after_create
    CHECK (read_at IS NULL OR read_at >= created_at)
);

CREATE UNIQUE INDEX account_notifications_deduplication_unique
  ON account_notifications (deduplication_key);

CREATE INDEX account_notifications_recipient_order
  ON account_notifications (recipient_account_id, created_at DESC, id DESC);

CREATE INDEX account_notifications_recipient_unread
  ON account_notifications (recipient_account_id, created_at DESC, id DESC)
  WHERE read_at IS NULL;
