ALTER TABLE call_sessions
  ADD COLUMN version bigint NOT NULL DEFAULT 1,
  ADD COLUMN deadline_generation bigint NOT NULL DEFAULT 1,
  ADD COLUMN ring_expires_at timestamptz,
  ADD COLUMN connect_expires_at timestamptz,
  ADD COLUMN hard_expires_at timestamptz,
  ADD COLUMN accepted_at timestamptz,
  ADD COLUMN connected_at timestamptz,
  ADD COLUMN terminal_reason text,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

UPDATE call_sessions
SET
  terminal_reason = CASE status
    WHEN 'rejected' THEN 'rejected'
    WHEN 'cancelled' THEN 'cancelled'
    WHEN 'missed' THEN 'missed'
    WHEN 'ended' THEN 'completed'
    ELSE NULL
  END,
  status = CASE
    WHEN status IN ('rejected', 'cancelled', 'missed') THEN 'ended'
    ELSE status
  END,
  ring_expires_at = CASE
    WHEN status = 'ringing' THEN created_at + interval '1 minute'
    ELSE NULL
  END,
  accepted_at = CASE
    WHEN status = 'accepted' THEN COALESCE(started_at, created_at)
    ELSE NULL
  END,
  connect_expires_at = CASE
    WHEN status = 'accepted' THEN COALESCE(started_at, created_at) + interval '2 minutes'
    ELSE NULL
  END,
  ended_at = CASE
    WHEN status IN ('rejected', 'cancelled', 'missed', 'ended') THEN COALESCE(ended_at, created_at)
    ELSE ended_at
  END,
  updated_at = created_at;

ALTER TABLE call_sessions
  DROP CONSTRAINT call_sessions_status_valid;

ALTER TABLE call_sessions
  ADD CONSTRAINT call_sessions_status_valid
    CHECK (status IN ('ringing', 'accepted', 'connected', 'ended')),
  ADD CONSTRAINT call_sessions_version_positive CHECK (version > 0),
  ADD CONSTRAINT call_sessions_deadline_generation_positive CHECK (deadline_generation > 0),
  ADD CONSTRAINT call_sessions_terminal_reason_valid
    CHECK (
      terminal_reason IS NULL
      OR terminal_reason IN (
        'rejected',
        'cancelled',
        'missed',
        'completed',
        'failed',
        'authorization_revoked',
        'partnership_terminated',
        'account_deletion',
        'session_revoked'
      )
    ),
  ADD CONSTRAINT call_sessions_terminal_shape
    CHECK (
      (status = 'ended' AND ended_at IS NOT NULL AND terminal_reason IS NOT NULL)
      OR (status <> 'ended' AND ended_at IS NULL AND terminal_reason IS NULL)
    ),
  ADD CONSTRAINT call_sessions_connected_shape
    CHECK (connected_at IS NULL OR accepted_at IS NOT NULL),
  ADD CONSTRAINT call_sessions_deadline_shape
    CHECK (
      (status = 'ringing' AND ring_expires_at IS NOT NULL)
      OR (status = 'accepted' AND connect_expires_at IS NOT NULL)
      OR status IN ('connected', 'ended')
    );

ALTER TABLE call_sessions
  ADD CONSTRAINT call_sessions_id_partnership_unique
  UNIQUE (id, partnership_id);

CREATE UNIQUE INDEX call_sessions_one_nonterminal_per_partnership
  ON call_sessions (partnership_id)
  WHERE status <> 'ended';

CREATE INDEX call_sessions_partnership_history
  ON call_sessions (partnership_id, created_at DESC, id DESC);

ALTER TABLE call_participants
  ADD COLUMN partnership_id uuid,
  ADD COLUMN role text,
  ADD COLUMN endpoint_device_id uuid,
  ADD COLUMN endpoint_session_id uuid,
  ADD COLUMN accepted_at timestamptz,
  ADD COLUMN connected_at timestamptz;

UPDATE call_participants AS participant
SET
  partnership_id = session.partnership_id,
  role = CASE
    WHEN participant.account_id = session.initiated_by_account_id THEN 'caller'
    ELSE 'callee'
  END
FROM call_sessions AS session
WHERE session.id = participant.call_session_id;

ALTER TABLE call_participants
  ALTER COLUMN partnership_id SET NOT NULL,
  ALTER COLUMN role SET NOT NULL,
  ADD CONSTRAINT call_participants_partnership_fk
    FOREIGN KEY (call_session_id, partnership_id)
    REFERENCES call_sessions(id, partnership_id)
    ON DELETE CASCADE,
  ADD CONSTRAINT call_participants_member_fk
    FOREIGN KEY (partnership_id, account_id)
    REFERENCES partnership_members(partnership_id, account_id),
  ADD CONSTRAINT call_participants_endpoint_device_fk
    FOREIGN KEY (endpoint_device_id, account_id)
    REFERENCES account_devices(id, account_id),
  ADD CONSTRAINT call_participants_endpoint_session_fk
    FOREIGN KEY (endpoint_session_id)
    REFERENCES account_sessions(id)
    ON DELETE SET NULL,
  ADD CONSTRAINT call_participants_role_valid
    CHECK (role IN ('caller', 'callee'));

CREATE UNIQUE INDEX call_participants_one_role_per_call
  ON call_participants (call_session_id, role);

CREATE FUNCTION enforce_call_participant_roles()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_call_id uuid;
  parent_exists boolean;
  caller_count integer;
  callee_count integer;
BEGIN
  target_call_id := CASE
    WHEN TG_OP = 'DELETE' THEN OLD.call_session_id
    ELSE NEW.call_session_id
  END;

  SELECT EXISTS(SELECT 1 FROM call_sessions WHERE id = target_call_id)
  INTO parent_exists;

  IF NOT parent_exists THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT
    count(*) FILTER (WHERE role = 'caller'),
    count(*) FILTER (WHERE role = 'callee')
  INTO caller_count, callee_count
  FROM call_participants
  WHERE call_session_id = target_call_id;

  IF caller_count <> 1 OR callee_count <> 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'call must contain exactly one caller and one callee';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM call_participants participant
    JOIN call_sessions session ON session.id = participant.call_session_id
    WHERE participant.call_session_id = target_call_id
      AND participant.role = 'caller'
      AND (
        participant.account_id <> session.initiated_by_account_id
        OR (
          session.status <> 'ended'
          AND (
            participant.endpoint_device_id IS NULL
            OR participant.endpoint_session_id IS NULL
            OR NOT EXISTS (
              SELECT 1
              FROM account_sessions endpoint_session
              WHERE endpoint_session.id = participant.endpoint_session_id
                AND endpoint_session.account_id = participant.account_id
                AND endpoint_session.device_id = participant.endpoint_device_id
            )
          )
        )
      )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'call caller participant must match the initiator and own the live endpoint';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM call_participants participant
    JOIN call_sessions session ON session.id = participant.call_session_id
    WHERE participant.call_session_id = target_call_id
      AND session.status IN ('accepted', 'connected')
      AND (
        participant.endpoint_device_id IS NULL
        OR participant.endpoint_session_id IS NULL
        OR NOT EXISTS (
          SELECT 1
          FROM account_sessions endpoint_session
          WHERE endpoint_session.id = participant.endpoint_session_id
            AND endpoint_session.account_id = participant.account_id
            AND endpoint_session.device_id = participant.endpoint_device_id
        )
      )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'accepted call participants must own selected endpoint sessions';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE CONSTRAINT TRIGGER call_participants_exact_roles
AFTER INSERT OR UPDATE OR DELETE ON call_participants
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION enforce_call_participant_roles();

ALTER TABLE call_events
  ADD COLUMN partnership_id uuid,
  ADD COLUMN call_version bigint,
  ADD COLUMN metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE call_events AS event
SET partnership_id = session.partnership_id
FROM call_sessions AS session
WHERE session.id = event.call_session_id;

ALTER TABLE call_events
  ALTER COLUMN partnership_id SET NOT NULL,
  ADD CONSTRAINT call_events_partnership_fk
    FOREIGN KEY (call_session_id, partnership_id)
    REFERENCES call_sessions(id, partnership_id)
    ON DELETE CASCADE,
  ADD CONSTRAINT call_events_version_positive
    CHECK (call_version IS NULL OR call_version > 0);

CREATE FUNCTION reject_call_event_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'call_events rows are append-only while retained';
END;
$$;

CREATE TRIGGER call_events_no_update
BEFORE UPDATE ON call_events
FOR EACH ROW
EXECUTE FUNCTION reject_call_event_update();
