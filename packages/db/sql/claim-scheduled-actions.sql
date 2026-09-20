WITH candidates AS (
  SELECT id
  FROM scheduled_actions
  WHERE attempt_count < max_attempts
    AND (
      (status = 'pending' AND available_at <= clock_timestamp())
      OR
      (status = 'processing' AND lease_expires_at <= clock_timestamp())
    )
  ORDER BY
    CASE WHEN status = 'pending' THEN available_at ELSE lease_expires_at END,
    id
  FOR UPDATE SKIP LOCKED
  LIMIT $1
)
UPDATE scheduled_actions AS action
SET
  status = 'processing',
  claimed_at = clock_timestamp(),
  claimed_by = $2,
  lease_expires_at = clock_timestamp() + ($3 * interval '1 millisecond'),
  claim_version = action.claim_version + 1,
  attempt_count = action.attempt_count + 1
FROM candidates
WHERE action.id = candidates.id
RETURNING action.*;
