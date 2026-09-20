ALTER TABLE scheduled_actions
  ADD COLUMN available_at timestamptz;

UPDATE scheduled_actions
SET
  available_at = execute_at,
  status = CASE WHEN status = 'processing' THEN 'pending' ELSE status END,
  claimed_at = CASE WHEN status = 'processing' THEN NULL ELSE claimed_at END,
  claimed_by = CASE WHEN status = 'processing' THEN NULL ELSE claimed_by END
WHERE available_at IS NULL;

ALTER TABLE scheduled_actions
  ALTER COLUMN available_at SET NOT NULL,
  ADD COLUMN lease_expires_at timestamptz,
  ADD COLUMN claim_version bigint NOT NULL DEFAULT 0,
  ADD COLUMN payload_version integer NOT NULL DEFAULT 1,
  ADD CONSTRAINT scheduled_actions_claim_version_nonnegative
    CHECK (claim_version >= 0),
  ADD CONSTRAINT scheduled_actions_payload_version_positive
    CHECK (payload_version > 0),
  ADD CONSTRAINT scheduled_actions_claim_shape
    CHECK (
      (
        status = 'processing'
        AND claimed_at IS NOT NULL
        AND claimed_by IS NOT NULL
        AND lease_expires_at IS NOT NULL
      )
      OR
      (
        status <> 'processing'
        AND claimed_at IS NULL
        AND claimed_by IS NULL
        AND lease_expires_at IS NULL
      )
    );

DROP INDEX scheduled_actions_due;

CREATE INDEX scheduled_actions_claimable
  ON scheduled_actions (available_at, id)
  WHERE status = 'pending';

CREATE INDEX scheduled_actions_reclaimable
  ON scheduled_actions (lease_expires_at, id)
  WHERE status = 'processing';

UPDATE outbox_events
SET
  status = 'pending',
  claimed_at = NULL,
  claimed_by = NULL
WHERE status = 'processing';

ALTER TABLE outbox_events
  ADD COLUMN lease_expires_at timestamptz,
  ADD COLUMN max_attempts integer NOT NULL DEFAULT 12,
  ADD COLUMN claim_version bigint NOT NULL DEFAULT 0,
  ADD COLUMN payload_version integer NOT NULL DEFAULT 1,
  ADD CONSTRAINT outbox_events_max_attempts_positive
    CHECK (max_attempts > 0),
  ADD CONSTRAINT outbox_events_claim_version_nonnegative
    CHECK (claim_version >= 0),
  ADD CONSTRAINT outbox_events_payload_version_positive
    CHECK (payload_version > 0),
  ADD CONSTRAINT outbox_events_claim_shape
    CHECK (
      (
        status = 'processing'
        AND claimed_at IS NOT NULL
        AND claimed_by IS NOT NULL
        AND lease_expires_at IS NOT NULL
      )
      OR
      (
        status <> 'processing'
        AND claimed_at IS NULL
        AND claimed_by IS NULL
        AND lease_expires_at IS NULL
      )
    );

CREATE INDEX outbox_events_reclaimable
  ON outbox_events (lease_expires_at, id)
  WHERE status = 'processing';

UPDATE deletion_targets
SET status = 'pending'
WHERE status = 'processing';

ALTER TABLE deletion_targets
  ADD COLUMN available_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN claimed_at timestamptz,
  ADD COLUMN claimed_by text,
  ADD COLUMN lease_expires_at timestamptz,
  ADD COLUMN claim_version bigint NOT NULL DEFAULT 0,
  ADD CONSTRAINT deletion_targets_claim_version_nonnegative
    CHECK (claim_version >= 0),
  ADD CONSTRAINT deletion_targets_claim_shape
    CHECK (
      (
        status = 'processing'
        AND claimed_at IS NOT NULL
        AND claimed_by IS NOT NULL
        AND lease_expires_at IS NOT NULL
      )
      OR
      (
        status <> 'processing'
        AND claimed_at IS NULL
        AND claimed_by IS NULL
        AND lease_expires_at IS NULL
      )
    );

DROP INDEX deletion_targets_pending;

CREATE INDEX deletion_targets_claimable
  ON deletion_targets (available_at, id)
  WHERE status = 'pending';

CREATE INDEX deletion_targets_reclaimable
  ON deletion_targets (lease_expires_at, id)
  WHERE status = 'processing';
