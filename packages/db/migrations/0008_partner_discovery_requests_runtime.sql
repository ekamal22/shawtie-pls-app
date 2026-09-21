ALTER TABLE partner_requests
  ADD COLUMN expired_at timestamptz,
  ADD COLUMN invalidated_reason text,
  ADD COLUMN relationship_start_date date;

UPDATE partner_requests
SET expired_at = expires_at
WHERE status = 'expired' AND expired_at IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM partner_requests
    WHERE
      (status = 'pending' AND (
        accepted_at IS NOT NULL OR declined_at IS NOT NULL OR cancelled_at IS NOT NULL
        OR expired_at IS NOT NULL OR invalidated_at IS NOT NULL OR invalidated_reason IS NOT NULL
      ))
      OR
      (status = 'accepted' AND (
        accepted_at IS NULL OR declined_at IS NOT NULL OR cancelled_at IS NOT NULL
        OR expired_at IS NOT NULL OR invalidated_at IS NOT NULL OR invalidated_reason IS NOT NULL
      ))
      OR
      (status = 'declined' AND (
        declined_at IS NULL OR accepted_at IS NOT NULL OR cancelled_at IS NOT NULL
        OR expired_at IS NOT NULL OR invalidated_at IS NOT NULL OR invalidated_reason IS NOT NULL
      ))
      OR
      (status = 'cancelled' AND (
        cancelled_at IS NULL OR accepted_at IS NOT NULL OR declined_at IS NOT NULL
        OR expired_at IS NOT NULL OR invalidated_at IS NOT NULL OR invalidated_reason IS NOT NULL
      ))
      OR
      (status = 'expired' AND (
        expired_at IS NULL OR accepted_at IS NOT NULL OR declined_at IS NOT NULL
        OR cancelled_at IS NOT NULL OR invalidated_at IS NOT NULL OR invalidated_reason IS NOT NULL
      ))
      OR
      (status = 'invalidated' AND (
        invalidated_at IS NULL OR invalidated_reason IS NULL OR accepted_at IS NOT NULL
        OR declined_at IS NOT NULL OR cancelled_at IS NOT NULL OR expired_at IS NOT NULL
      ))
  ) THEN
    RAISE EXCEPTION 'legacy partner request terminal shape cannot be migrated safely';
  END IF;
END;
$$;

ALTER TABLE partner_requests
  ADD CONSTRAINT partner_requests_relationship_start_required_for_pending
    CHECK (status <> 'pending' OR relationship_start_date IS NOT NULL) NOT VALID,
  ADD CONSTRAINT partner_requests_invalidation_reason_valid
    CHECK (
      invalidated_reason IS NULL
      OR invalidated_reason IN ('account_unavailable', 'partnership_formed', 'block_created')
    ) NOT VALID,
  ADD CONSTRAINT partner_requests_terminal_shape
    CHECK (
      (
        status = 'pending'
        AND accepted_at IS NULL
        AND declined_at IS NULL
        AND cancelled_at IS NULL
        AND expired_at IS NULL
        AND invalidated_at IS NULL
        AND invalidated_reason IS NULL
      )
      OR
      (
        status = 'accepted'
        AND accepted_at IS NOT NULL
        AND declined_at IS NULL
        AND cancelled_at IS NULL
        AND expired_at IS NULL
        AND invalidated_at IS NULL
        AND invalidated_reason IS NULL
      )
      OR
      (
        status = 'declined'
        AND declined_at IS NOT NULL
        AND accepted_at IS NULL
        AND cancelled_at IS NULL
        AND expired_at IS NULL
        AND invalidated_at IS NULL
        AND invalidated_reason IS NULL
      )
      OR
      (
        status = 'cancelled'
        AND cancelled_at IS NOT NULL
        AND accepted_at IS NULL
        AND declined_at IS NULL
        AND expired_at IS NULL
        AND invalidated_at IS NULL
        AND invalidated_reason IS NULL
      )
      OR
      (
        status = 'expired'
        AND expired_at IS NOT NULL
        AND accepted_at IS NULL
        AND declined_at IS NULL
        AND cancelled_at IS NULL
        AND invalidated_at IS NULL
        AND invalidated_reason IS NULL
      )
      OR
      (
        status = 'invalidated'
        AND invalidated_at IS NOT NULL
        AND invalidated_reason IS NOT NULL
        AND accepted_at IS NULL
        AND declined_at IS NULL
        AND cancelled_at IS NULL
        AND expired_at IS NULL
      )
    ) NOT VALID;

DROP INDEX partner_requests_recipient_pending;

CREATE INDEX partner_requests_recipient_pending
  ON partner_requests (recipient_account_id, created_at DESC, id DESC)
  WHERE status = 'pending';

CREATE INDEX partner_requests_sender_pending
  ON partner_requests (sender_account_id, created_at DESC, id DESC)
  WHERE status = 'pending';

CREATE INDEX partner_requests_pair_pending
  ON partner_requests (sender_account_id, recipient_account_id, id)
  WHERE status = 'pending';

CREATE INDEX partner_requests_pair_declined
  ON partner_requests (sender_account_id, recipient_account_id, declined_at DESC)
  WHERE status = 'declined' AND declined_at IS NOT NULL;

ALTER TABLE partner_request_attempts
  DROP CONSTRAINT partner_request_attempts_outcome_valid,
  ADD CONSTRAINT partner_request_attempts_outcome_valid
    CHECK (
      outcome IN (
        'created',
        'rate_limited',
        'decline_cooldown',
        'monthly_limit',
        'sender_ineligible',
        'target_unavailable',
        'duplicate',
        'self_request',
        'target_changed',
        'blocked',
        'ineligible'
      )
    );

CREATE INDEX partner_request_attempts_created_pair_time
  ON partner_request_attempts (sender_account_id, recipient_account_id, created_at DESC)
  WHERE outcome = 'created';

CREATE FUNCTION reject_partner_request_attempt_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'partner_request_attempts rows are append-only while retained';
END;
$$;

CREATE TRIGGER partner_request_attempts_no_update
BEFORE UPDATE ON partner_request_attempts
FOR EACH ROW
EXECUTE FUNCTION reject_partner_request_attempt_update();
