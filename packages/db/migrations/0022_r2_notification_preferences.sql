BEGIN;

CREATE TABLE account_notification_preferences (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  message_preview_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

COMMIT;
