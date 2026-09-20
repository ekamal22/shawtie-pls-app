BEGIN;

INSERT INTO accounts (
  id,
  username_normalized,
  username_display,
  date_of_birth,
  status
) VALUES
  ('00000000-0000-0000-0000-000000000001', 'alpha', 'Alpha', DATE '2000-01-01', 'active'),
  ('00000000-0000-0000-0000-000000000002', 'beta', 'Beta', DATE '2000-01-01', 'active'),
  ('00000000-0000-0000-0000-000000000003', 'gamma', 'Gamma', DATE '2000-01-01', 'active');

INSERT INTO account_emails (
  id,
  account_id,
  email_normalized,
  verified_at,
  is_current
) VALUES (
  '10000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'alpha@example.test',
  now(),
  true
);

DO $$
BEGIN
  BEGIN
    INSERT INTO account_emails (
      id,
      account_id,
      email_normalized,
      verified_at,
      is_current
    ) VALUES (
      '10000000-0000-0000-0000-000000000002',
      '00000000-0000-0000-0000-000000000002',
      'alpha@example.test',
      now(),
      true
    );
    RAISE EXCEPTION 'expected current verified email uniqueness violation';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;
END;
$$;

INSERT INTO partnerships (
  id,
  relationship_start_date,
  lifecycle_state,
  activated_at
) VALUES
  ('20000000-0000-0000-0000-000000000001', DATE '2026-01-01', 'active', now()),
  ('20000000-0000-0000-0000-000000000002', DATE '2026-01-01', 'active', now());

INSERT INTO partnership_members (
  partnership_id,
  account_id,
  joined_at
) VALUES
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', now()),
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', now());

DO $$
BEGIN
  BEGIN
    INSERT INTO partnership_members (
      partnership_id,
      account_id,
      joined_at
    ) VALUES (
      '20000000-0000-0000-0000-000000000002',
      '00000000-0000-0000-0000-000000000001',
      now()
    );
    RAISE EXCEPTION 'expected occupied partnership slot uniqueness violation';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;
END;
$$;

INSERT INTO idempotency_records (
  id,
  account_id,
  scope,
  idempotency_key
) VALUES (
  '30000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'test',
  'same-key'
);

DO $$
BEGIN
  BEGIN
    INSERT INTO idempotency_records (
      id,
      account_id,
      scope,
      idempotency_key
    ) VALUES (
      '30000000-0000-0000-0000-000000000002',
      '00000000-0000-0000-0000-000000000001',
      'test',
      'same-key'
    );
    RAISE EXCEPTION 'expected idempotency uniqueness violation';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO partner_requests (
      id,
      sender_account_id,
      recipient_account_id,
      status,
      created_at,
      expires_at
    ) VALUES (
      '40000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000001',
      'pending',
      TIMESTAMPTZ '2026-01-01 00:00:00+00',
      TIMESTAMPTZ '2026-01-08 00:00:00+00'
    );
    RAISE EXCEPTION 'expected self partner request check violation';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO breakup_processes (
      id,
      partnership_id,
      initiated_by_account_id,
      initiated_at,
      initiator_cancel_until,
      base_deadline,
      final_deadline,
      generation
    ) VALUES (
      '50000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000001',
      TIMESTAMPTZ '2026-01-01 00:00:00+00',
      TIMESTAMPTZ '2026-01-01 01:00:00+00',
      TIMESTAMPTZ '2026-01-08 00:00:00+00',
      TIMESTAMPTZ '2026-01-09 00:00:00+00',
      1
    );
    RAISE EXCEPTION 'expected breakup final deadline check violation';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END;
$$;

INSERT INTO partnership_lifecycle_events (
  id,
  partnership_id,
  actor_account_id,
  event_type,
  aggregate_version
) VALUES (
  '60000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'test_event',
  1
);

DO $$
BEGIN
  BEGIN
    UPDATE partnership_lifecycle_events
    SET event_type = 'mutated'
    WHERE id = '60000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'expected lifecycle event append-only trigger rejection';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM <> 'partnership_lifecycle_events rows are append-only while retained' THEN
        RAISE;
      END IF;
  END;
END;
$$;


INSERT INTO account_devices (
  id,
  account_id,
  display_name,
  created_at
) VALUES (
  '70000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'Alpha Device',
  now()
);

DO $$
BEGIN
  BEGIN
    INSERT INTO account_sessions (
      id,
      account_id,
      device_id,
      token_verifier,
      created_at,
      expires_at
    ) VALUES (
      '71000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002',
      '70000000-0000-0000-0000-000000000001',
      decode('00', 'hex'),
      now(),
      now() + interval '1 hour'
    );
    RAISE EXCEPTION 'expected device ownership foreign key violation';
  EXCEPTION
    WHEN foreign_key_violation THEN NULL;
  END;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO partnership_members (
      partnership_id,
      account_id,
      joined_at
    ) VALUES (
      '20000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000003',
      now()
    );
    RAISE EXCEPTION 'expected partnership member limit violation';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END;
$$;

INSERT INTO scheduled_actions (
  id,
  action_type,
  aggregate_type,
  aggregate_id,
  execute_at,
  available_at,
  deduplication_key
) VALUES (
  '72000000-0000-0000-0000-000000000001',
  'test',
  'partnership',
  '20000000-0000-0000-0000-000000000001',
  now(),
  now(),
  'same-scheduled-action'
);

DO $$
BEGIN
  BEGIN
    INSERT INTO scheduled_actions (
      id,
      action_type,
      aggregate_type,
      aggregate_id,
      execute_at,
      available_at,
      deduplication_key
    ) VALUES (
      '72000000-0000-0000-0000-000000000002',
      'test',
      'partnership',
      '20000000-0000-0000-0000-000000000001',
      now(),
      now(),
      'same-scheduled-action'
    );
    RAISE EXCEPTION 'expected scheduled action deduplication violation';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;
END;
$$;


INSERT INTO registration_intents (
  id, username_normalized, username_display, display_name, date_of_birth,
  email_normalized, email_display, password_hash, expires_at
) VALUES (
  '73000000-0000-4000-8000-000000000001',
  'registration-test',
  'Registration-Test',
  'Registration Test',
  DATE '2000-01-01',
  'registration@example.test',
  'registration@example.test',
  'argon2-test-hash',
  now() + interval '1 day'
);

INSERT INTO email_verifications (
  id, registration_intent_id, purpose, email_normalized, email_display,
  verifier, challenge_nonce, expires_at
) VALUES (
  '73100000-0000-4000-8000-000000000001',
  '73000000-0000-4000-8000-000000000001',
  'registration',
  'registration@example.test',
  'registration@example.test',
  decode('01', 'hex'),
  decode('02', 'hex'),
  now() + interval '10 minutes'
);

DO $$
BEGIN
  BEGIN
    INSERT INTO email_verifications (
      id, registration_intent_id, purpose, email_normalized, email_display,
      verifier, challenge_nonce, expires_at
    ) VALUES (
      '73100000-0000-4000-8000-000000000002',
      '73000000-0000-4000-8000-000000000001',
      'registration',
      'registration@example.test',
      'registration@example.test',
      decode('03', 'hex'),
      decode('04', 'hex'),
      now() + interval '10 minutes'
    );
    RAISE EXCEPTION 'expected one active registration challenge violation';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;
END;
$$;

INSERT INTO account_sessions (
  id, account_id, device_id, token_verifier, created_at, expires_at, idle_expires_at
) VALUES (
  '73200000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  '70000000-0000-0000-0000-000000000001',
  decode('aa', 'hex'),
  now(),
  now() + interval '1 hour',
  now() + interval '1 hour'
);

DO $$
BEGIN
  BEGIN
    INSERT INTO account_sessions (
      id, account_id, device_id, token_verifier, created_at, expires_at, idle_expires_at
    ) VALUES (
      '73200000-0000-4000-8000-000000000002',
      '00000000-0000-0000-0000-000000000001',
      '70000000-0000-0000-0000-000000000001',
      decode('aa', 'hex'),
      now(),
      now() + interval '1 hour',
      now() + interval '1 hour'
    );
    RAISE EXCEPTION 'expected session token verifier uniqueness violation';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;
END;
$$;

INSERT INTO security_events (
  id, account_id, event_type, metadata_json
) VALUES (
  '73300000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'test_security_event',
  '{}'::jsonb
);

DO $$
BEGIN
  BEGIN
    UPDATE security_events
    SET event_type = 'mutated'
    WHERE id = '73300000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'expected security event append-only trigger rejection';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM <> 'security_events rows are append-only while retained' THEN
        RAISE;
      END IF;
  END;
END;
$$;

ROLLBACK;
