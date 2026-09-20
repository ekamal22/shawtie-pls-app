CREATE TABLE idempotency_records (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  scope text NOT NULL,
  idempotency_key text NOT NULL,
  request_fingerprint bytea,
  response_status integer,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  CONSTRAINT idempotency_records_scope_nonempty
    CHECK (length(scope) > 0),
  CONSTRAINT idempotency_records_key_nonempty
    CHECK (length(idempotency_key) > 0)
);

CREATE UNIQUE INDEX idempotency_records_account_scope_key_unique
  ON idempotency_records (account_id, scope, idempotency_key);

CREATE INDEX idempotency_records_expiry
  ON idempotency_records (expires_at)
  WHERE expires_at IS NOT NULL;

CREATE TABLE partnership_lifecycle_events (
  id uuid PRIMARY KEY,
  partnership_id uuid REFERENCES partnerships(id) ON DELETE SET NULL,
  actor_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  aggregate_version bigint NOT NULL,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partnership_lifecycle_events_version_positive
    CHECK (aggregate_version > 0)
);

CREATE INDEX partnership_lifecycle_events_partnership_order
  ON partnership_lifecycle_events (partnership_id, created_at, id);

CREATE FUNCTION reject_lifecycle_event_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'partnership_lifecycle_events rows are append-only while retained';
END;
$$;

CREATE TRIGGER partnership_lifecycle_events_no_update
BEFORE UPDATE ON partnership_lifecycle_events
FOR EACH ROW
EXECUTE FUNCTION reject_lifecycle_event_update();

CREATE TABLE scheduled_actions (
  id uuid PRIMARY KEY,
  action_type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  execute_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 12,
  expected_generation bigint,
  deduplication_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  claimed_at timestamptz,
  claimed_by text,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT scheduled_actions_status_valid
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'stale', 'cancelled')),
  CONSTRAINT scheduled_actions_attempt_count_nonnegative
    CHECK (attempt_count >= 0),
  CONSTRAINT scheduled_actions_max_attempts_positive
    CHECK (max_attempts > 0),
  CONSTRAINT scheduled_actions_expected_generation_positive
    CHECK (expected_generation IS NULL OR expected_generation > 0)
);

CREATE UNIQUE INDEX scheduled_actions_deduplication_unique
  ON scheduled_actions (deduplication_key);

CREATE INDEX scheduled_actions_due
  ON scheduled_actions (execute_at, id)
  WHERE status = 'pending';

CREATE TABLE outbox_events (
  id uuid PRIMARY KEY,
  event_type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  deduplication_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  available_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  claimed_by text,
  delivered_at timestamptz,
  last_error_code text,
  CONSTRAINT outbox_events_status_valid
    CHECK (status IN ('pending', 'processing', 'delivered', 'failed')),
  CONSTRAINT outbox_events_attempt_count_nonnegative
    CHECK (attempt_count >= 0)
);

CREATE UNIQUE INDEX outbox_events_deduplication_unique
  ON outbox_events (deduplication_key);

CREATE INDEX outbox_events_available
  ON outbox_events (available_at, id)
  WHERE status = 'pending';

CREATE TABLE deletion_manifests (
  id uuid PRIMARY KEY,
  subject_type text NOT NULL,
  subject_id uuid NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  access_revoked_at timestamptz,
  completed_at timestamptz,
  last_error_code text,
  CONSTRAINT deletion_manifests_subject_type_valid
    CHECK (subject_type IN ('partnership', 'account')),
  CONSTRAINT deletion_manifests_status_valid
    CHECK (status IN ('pending', 'processing', 'completed', 'failed'))
);

CREATE INDEX deletion_manifests_incomplete
  ON deletion_manifests (created_at, id)
  WHERE status <> 'completed';

CREATE TABLE deletion_targets (
  id uuid PRIMARY KEY,
  manifest_id uuid NOT NULL REFERENCES deletion_manifests(id) ON DELETE CASCADE,
  target_type text NOT NULL,
  target_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT deletion_targets_status_valid
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  CONSTRAINT deletion_targets_attempt_count_nonnegative
    CHECK (attempt_count >= 0)
);

CREATE UNIQUE INDEX deletion_targets_manifest_target_unique
  ON deletion_targets (manifest_id, target_type, target_key);

CREATE INDEX deletion_targets_pending
  ON deletion_targets (manifest_id, created_at, id)
  WHERE status <> 'completed';

CREATE TABLE security_events (
  id uuid PRIMARY KEY,
  account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  device_id uuid REFERENCES account_devices(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX security_events_account_time
  ON security_events (account_id, created_at DESC);
