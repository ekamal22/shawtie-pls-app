WITH candidates AS (
  SELECT id
  FROM scheduled_actions
  WHERE status = 'pending'
    AND execute_at <= now()
  ORDER BY execute_at, id
  FOR UPDATE SKIP LOCKED
  LIMIT $1
)
UPDATE scheduled_actions AS action
SET
  status = 'processing',
  claimed_at = now(),
  claimed_by = $2,
  attempt_count = action.attempt_count + 1
FROM candidates
WHERE action.id = candidates.id
RETURNING action.*;
