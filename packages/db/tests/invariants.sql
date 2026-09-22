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
  email_display,
  verified_at,
  is_current
) VALUES (
  '10000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'alpha@example.test',
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
      email_display,
      verified_at,
      is_current
    ) VALUES (
      '10000000-0000-0000-0000-000000000002',
      '00000000-0000-0000-0000-000000000002',
      'alpha@example.test',
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
      expires_at,
      relationship_start_date
    ) VALUES (
      '40000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000001',
      'pending',
      TIMESTAMPTZ '2026-01-01 00:00:00+00',
      TIMESTAMPTZ '2026-01-08 00:00:00+00',
      DATE '2025-01-01'
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
      expires_at,
      idle_expires_at
    ) VALUES (
      '71000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002',
      '70000000-0000-0000-0000-000000000001',
      decode('00', 'hex'),
      now(),
      now() + interval '1 hour',
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



DO $$
BEGIN
  BEGIN
    INSERT INTO partner_requests (
      id, sender_account_id, recipient_account_id, status, created_at, expires_at
    ) VALUES (
      '74000000-0000-4000-8000-000000000001',
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000003',
      'pending',
      TIMESTAMPTZ '2026-01-01 00:00:00+00',
      TIMESTAMPTZ '2026-01-08 00:00:00+00'
    );
    RAISE EXCEPTION 'expected P1 relationship start date check violation';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END;
$$;

INSERT INTO partner_request_attempts (
  id, sender_account_id, recipient_account_id, outcome, created_at
) VALUES (
  '74100000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000003',
  'created',
  TIMESTAMPTZ '2026-01-01 00:00:00+00'
);

DO $$
BEGIN
  BEGIN
    UPDATE partner_request_attempts
    SET outcome = 'duplicate'
    WHERE id = '74100000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'expected partner request attempt append-only rejection';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM <> 'partner_request_attempts rows are append-only while retained' THEN
        RAISE;
      END IF;
  END;
END;
$$;


DO $$
BEGIN
  BEGIN
    INSERT INTO partner_requests (
      id, sender_account_id, recipient_account_id, status, created_at, expires_at,
      accepted_at, relationship_start_date
    ) VALUES (
      '75000000-0000-4000-8000-000000000001',
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000003',
      'accepted',
      TIMESTAMPTZ '2026-01-01 00:00:00+00',
      TIMESTAMPTZ '2026-01-08 00:00:00+00',
      TIMESTAMPTZ '2026-01-02 00:00:00+00',
      DATE '2025-01-01'
    );
    RAISE EXCEPTION 'expected accepted request partnership linkage violation';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END;
$$;

INSERT INTO partner_requests (
  id, sender_account_id, recipient_account_id, status, created_at, expires_at,
  accepted_at, relationship_start_date, accepted_partnership_id
) VALUES (
  '75000000-0000-4000-8000-000000000002',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000003',
  'accepted',
  TIMESTAMPTZ '2026-01-01 00:00:00+00',
  TIMESTAMPTZ '2026-01-08 00:00:00+00',
  TIMESTAMPTZ '2026-01-02 00:00:00+00',
  DATE '2025-01-01',
  '20000000-0000-0000-0000-000000000001'
);

DO $$
BEGIN
  BEGIN
    INSERT INTO partner_requests (
      id, sender_account_id, recipient_account_id, status, created_at, expires_at,
      cancelled_at, relationship_start_date, accepted_partnership_id
    ) VALUES (
      '75000000-0000-4000-8000-000000000003',
      '00000000-0000-0000-0000-000000000003',
      '00000000-0000-0000-0000-000000000002',
      'cancelled',
      TIMESTAMPTZ '2026-01-01 00:00:00+00',
      TIMESTAMPTZ '2026-01-08 00:00:00+00',
      TIMESTAMPTZ '2026-01-02 00:00:00+00',
      DATE '2025-01-01',
      '20000000-0000-0000-0000-000000000001'
    );
    RAISE EXCEPTION 'expected non-accepted request partnership linkage violation';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END;
$$;

INSERT INTO account_notifications (
  id, recipient_account_id, actor_account_id, partnership_id,
  event_type, deduplication_key, created_at
) VALUES (
  '76000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  'partnership_formed',
  'p2-invariant-dedup',
  TIMESTAMPTZ '2026-01-02 00:00:00+00'
);

DO $$
BEGIN
  BEGIN
    INSERT INTO account_notifications (
      id, recipient_account_id, actor_account_id, partnership_id,
      event_type, deduplication_key, created_at
    ) VALUES (
      '76000000-0000-4000-8000-000000000002',
      '00000000-0000-0000-0000-000000000003',
      '00000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      'partnership_formed',
      'p2-invariant-dedup',
      TIMESTAMPTZ '2026-01-02 00:01:00+00'
    );
    RAISE EXCEPTION 'expected account notification deduplication violation';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;
END;
$$;

DO $$
DECLARE
  accepted_required_validated boolean;
  accepted_terminal_validated boolean;
BEGIN
  SELECT convalidated
  INTO accepted_required_validated
  FROM pg_constraint
  WHERE conname = 'partner_requests_accepted_link_required';

  SELECT convalidated
  INTO accepted_terminal_validated
  FROM pg_constraint
  WHERE conname = 'partner_requests_accepted_link_terminal_only';

  IF accepted_required_validated IS DISTINCT FROM false
     OR accepted_terminal_validated IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'P2 legacy-safe request-linkage constraints must remain NOT VALID';
  END IF;
END;
$$;


DO $$
BEGIN
  BEGIN
    INSERT INTO account_partner_eligibility (
      id, account_id, source_partnership_id, reason, created_at, eligible_at
    ) VALUES (
      '77000000-0000-4000-8000-000000000001',
      '00000000-0000-0000-0000-000000000003',
      '20000000-0000-0000-0000-000000000001',
      'breakup_dissolution',
      TIMESTAMPTZ '2026-01-01 12:00:00+00',
      TIMESTAMPTZ '2026-03-31 12:00:00+00'
    );
    RAISE EXCEPTION 'expected exact breakup cooldown duration violation';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO partnership_blocks (
      id, blocker_account_id, blocked_account_id, source_partnership_id, created_at
    ) VALUES (
      '77100000-0000-4000-8000-000000000001',
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000003',
      NULL,
      now()
    );
    RAISE EXCEPTION 'expected former-partner block source requirement';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END;
$$;

INSERT INTO breakup_processes (
  id, partnership_id, initiated_by_account_id, initiated_at,
  initiator_cancel_until, base_deadline, final_deadline, generation, cancelled_at
) VALUES (
  '77200000-0000-4000-8000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  TIMESTAMPTZ '2026-02-01 00:00:00+00',
  TIMESTAMPTZ '2026-02-01 01:00:00+00',
  TIMESTAMPTZ '2026-02-08 00:00:00+00',
  TIMESTAMPTZ '2026-02-08 00:00:00+00',
  2,
  TIMESTAMPTZ '2026-02-01 00:30:00+00'
);

DO $$
BEGIN
  BEGIN
    UPDATE breakup_processes
    SET restored_at = TIMESTAMPTZ '2026-02-01 01:30:00+00'
    WHERE id = '77200000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'expected breakup terminal exclusivity violation';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END;
$$;

INSERT INTO account_notifications (
  id, recipient_account_id, actor_account_id, partnership_id,
  event_type, deduplication_key, created_at
) VALUES (
  '77300000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  'breakup_started',
  'p3-invariant-event-type',
  TIMESTAMPTZ '2026-02-01 00:00:00+00'
);

DO $$
DECLARE
  terminal_validated boolean;
  cooldown_validated boolean;
  block_source_validated boolean;
BEGIN
  SELECT convalidated INTO terminal_validated
  FROM pg_constraint
  WHERE conname = 'breakup_processes_terminal_exclusive';

  SELECT convalidated INTO cooldown_validated
  FROM pg_constraint
  WHERE conname = 'account_partner_eligibility_exact_duration';

  SELECT convalidated INTO block_source_validated
  FROM pg_constraint
  WHERE conname = 'partnership_blocks_source_required';

  IF terminal_validated IS DISTINCT FROM false
     OR cooldown_validated IS DISTINCT FROM false
     OR block_source_validated IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'P3 legacy-safe lifecycle constraints must remain NOT VALID';
  END IF;
END;
$$;


INSERT INTO conversations (
  id, partnership_id, kind, next_server_sequence, next_change_sequence, created_at
) VALUES (
  '78000000-0000-4000-8000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  'primary',
  2,
  2,
  TIMESTAMPTZ '2026-03-01 00:00:00+00'
);

INSERT INTO conversation_member_state (
  conversation_id, partnership_id, account_id, delivered_through, read_through, updated_at
) VALUES
  (
    '78000000-0000-4000-8000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    0,
    0,
    TIMESTAMPTZ '2026-03-01 00:00:00+00'
  ),
  (
    '78000000-0000-4000-8000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000002',
    0,
    0,
    TIMESTAMPTZ '2026-03-01 00:00:00+00'
  );

INSERT INTO messages (
  id, conversation_id, partnership_id, sender_account_id,
  client_idempotency_key, server_sequence, body_text, content_version,
  request_fingerprint, request_fingerprint_version, created_change_sequence,
  last_change_sequence, created_at
) VALUES (
  '78100000-0000-4000-8000-000000000001',
  '78000000-0000-4000-8000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'm1-invariant-message-1',
  1,
  'synthetic m1 message',
  1,
  decode('0102', 'hex'),
  1,
  1,
  1,
  TIMESTAMPTZ '2026-03-01 00:00:00+00'
);

DO $$
BEGIN
  BEGIN
    INSERT INTO messages (
      id, conversation_id, partnership_id, sender_account_id,
      client_idempotency_key, server_sequence, body_text, content_version,
      created_change_sequence, last_change_sequence, created_at
    ) VALUES (
      '78100000-0000-4000-8000-000000000002',
      '78000000-0000-4000-8000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002',
      'm1-invariant-message-2',
      1,
      'duplicate sequence',
      1,
      2,
      2,
      TIMESTAMPTZ '2026-03-01 00:01:00+00'
    );
    RAISE EXCEPTION 'expected M1 conversation server sequence uniqueness violation';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;
END;
$$;

INSERT INTO conversation_changes (
  conversation_id, change_sequence, change_type, message_id, content_version, created_at
) VALUES (
  '78000000-0000-4000-8000-000000000001',
  1,
  'message.created',
  '78100000-0000-4000-8000-000000000001',
  1,
  TIMESTAMPTZ '2026-03-01 00:00:00+00'
);

DO $$
BEGIN
  BEGIN
    UPDATE conversation_changes
    SET change_type = 'message.updated'
    WHERE conversation_id = '78000000-0000-4000-8000-000000000001'
      AND change_sequence = 1;
    RAISE EXCEPTION 'expected M1 conversation change append-only rejection';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM <> 'conversation_changes rows are append-only while retained' THEN
        RAISE;
      END IF;
  END;
END;
$$;

DO $$
BEGIN
  BEGIN
    UPDATE conversation_member_state
    SET delivered_through = 1, read_through = 2
    WHERE conversation_id = '78000000-0000-4000-8000-000000000001'
      AND account_id = '00000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'expected M1 read-through delivery invariant';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END;
$$;

INSERT INTO message_reactions (
  id, message_id, reactor_account_id, partnership_id, emoji_text, created_at
) VALUES (
  '78200000-0000-4000-8000-000000000001',
  '78100000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  '20000000-0000-0000-0000-000000000001',
  '❤️',
  TIMESTAMPTZ '2026-03-01 00:02:00+00'
);

DO $$
BEGIN
  BEGIN
    INSERT INTO message_reactions (
      id, message_id, reactor_account_id, partnership_id, emoji_text, created_at
    ) VALUES (
      '78200000-0000-4000-8000-000000000002',
      '78100000-0000-4000-8000-000000000001',
      '00000000-0000-0000-0000-000000000002',
      '20000000-0000-0000-0000-000000000001',
      '😂',
      TIMESTAMPTZ '2026-03-01 00:03:00+00'
    );
    RAISE EXCEPTION 'expected M1 one active reaction per account violation';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO partnership_chat_nicknames (
      partnership_id, subject_account_id, nickname, version,
      updated_by_account_id, updated_at
    ) VALUES (
      '20000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000003',
      'not a member',
      1,
      '00000000-0000-0000-0000-000000000001',
      TIMESTAMPTZ '2026-03-01 00:04:00+00'
    );
    RAISE EXCEPTION 'expected M1 nickname membership violation';
  EXCEPTION
    WHEN foreign_key_violation THEN NULL;
  END;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO messages (
      id, conversation_id, partnership_id, sender_account_id,
      client_idempotency_key, server_sequence, body_text, content_version,
      created_change_sequence, last_change_sequence, created_at, deleted_at
    ) VALUES (
      '78100000-0000-4000-8000-000000000003',
      '78000000-0000-4000-8000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000001',
      'm1-deleted-content-shape',
      3,
      'must not survive deletion',
      1,
      3,
      3,
      TIMESTAMPTZ '2026-03-01 00:05:00+00',
      TIMESTAMPTZ '2026-03-01 00:06:00+00'
    );
    RAISE EXCEPTION 'expected M1 deleted message content removal violation';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END;
$$;

ROLLBACK;
