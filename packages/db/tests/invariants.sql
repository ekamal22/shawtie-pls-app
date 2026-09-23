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

DO $$
BEGIN
  BEGIN
    UPDATE messages
    SET server_sequence = 2
    WHERE id = '78100000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'expected M1 immutable message sequence rejection';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM <> 'message creation identity and order are immutable' THEN
        RAISE;
      END IF;
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

INSERT INTO accounts (
  id, username_normalized, username_display, date_of_birth, status
) VALUES
  ('00000000-0000-0000-0000-000000000004', 'delta', 'Delta', DATE '2000-01-01', 'active'),
  ('00000000-0000-0000-0000-000000000005', 'epsilon', 'Epsilon', DATE '2000-01-01', 'active');

INSERT INTO account_profiles (
  account_id, display_name
) VALUES
  ('00000000-0000-0000-0000-000000000004', 'Delta'),
  ('00000000-0000-0000-0000-000000000005', 'Epsilon');

INSERT INTO partnerships (
  id, relationship_start_date, lifecycle_state, activated_at
) VALUES (
  '20000000-0000-0000-0000-000000000003',
  DATE '2024-02-29',
  'active',
  now()
);

INSERT INTO partnership_members (
  partnership_id, account_id, joined_at
) VALUES
  ('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000004', now()),
  ('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000005', now());

INSERT INTO relationship_items (
  id,
  partnership_id,
  creator_account_id,
  kind,
  development_plaintext_payload,
  occurred_precision,
  occurred_year,
  occurred_month,
  occurred_day,
  created_at,
  updated_at
) VALUES
  (
    '80000000-0000-4000-8000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'memory',
    '{"title":"Invariant memory"}'::jsonb,
    'day',
    2026,
    9,
    22,
    now(),
    now()
  ),
  (
    '80000000-0000-4000-8000-000000000002',
    '20000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000002',
    'memory',
    '{"title":"Second invariant memory"}'::jsonb,
    'year',
    2025,
    NULL,
    NULL,
    now(),
    now()
  ),
  (
    '80000000-0000-4000-8000-000000000003',
    '20000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000004',
    'memory',
    '{"title":"Other partnership memory"}'::jsonb,
    'unknown',
    NULL,
    NULL,
    NULL,
    now(),
    now()
  );

DO $$
BEGIN
  BEGIN
    INSERT INTO relationship_items (
      id, partnership_id, creator_account_id, kind,
      development_plaintext_payload, encrypted_payload, ciphertext_version,
      created_at, updated_at
    ) VALUES (
      '80100000-0000-4000-8000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000001',
      'memory',
      '{"title":"plaintext"}'::jsonb,
      decode('aa', 'hex'),
      'test-v1',
      now(),
      now()
    );
    RAISE EXCEPTION 'expected relationship content storage mode violation';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO relationship_items (
      id, partnership_id, creator_account_id, kind,
      release_mode, release_generation, created_at, updated_at
    ) VALUES (
      '80100000-0000-4000-8000-000000000002',
      '20000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000001',
      'for_you',
      'scheduled',
      1,
      now(),
      now()
    );
    RAISE EXCEPTION 'expected scheduled release shape violation';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END;
$$;

DO $$
BEGIN
  BEGIN
    UPDATE relationship_items
    SET kind = 'first'
    WHERE id = '80000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'expected relationship item immutable identity rejection';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM <> 'relationship_items immutable identity fields cannot change' THEN
        RAISE;
      END IF;
  END;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO relationship_someday_state (
      item_id, partnership_id, state
    ) VALUES (
      '80000000-0000-4000-8000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      'someday'
    );
    RAISE EXCEPTION 'expected relationship feature state kind rejection';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM <> 'relationship_someday_state requires someday item' THEN
        RAISE;
      END IF;
  END;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO relationship_item_references (
      id, partnership_id, item_id, reference_type, reference_id, role, position
    ) VALUES (
      '80200000-0000-4000-8000-000000000001',
      '20000000-0000-0000-0000-000000000003',
      '80000000-0000-4000-8000-000000000001',
      'media',
      '80300000-0000-4000-8000-000000000001',
      'attachment',
      0
    );
    RAISE EXCEPTION 'expected relationship reference partnership mismatch rejection';
  EXCEPTION
    WHEN foreign_key_violation THEN NULL;
  END;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO relationship_item_links (
      partnership_id, owner_item_id, target_item_id, link_type, position
    ) VALUES (
      '20000000-0000-0000-0000-000000000001',
      '80000000-0000-4000-8000-000000000001',
      '80000000-0000-4000-8000-000000000002',
      'curation',
      0
    );
    RAISE EXCEPTION 'expected relationship link owner kind rejection';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM <> 'curation link owner kind is invalid' THEN
        RAISE;
      END IF;
  END;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO relationship_story_members (
      partnership_id, item_id, added_by_account_id
    ) VALUES (
      '20000000-0000-0000-0000-000000000001',
      '80000000-0000-4000-8000-000000000001',
      '00000000-0000-0000-0000-000000000003'
    );
    RAISE EXCEPTION 'expected relationship story actor membership rejection';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM <> 'relationship story actor must be a current partnership member' THEN
        RAISE;
      END IF;
  END;
END;
$$;

INSERT INTO relationship_events (
  id, partnership_id, item_id, event_type, actor_account_id, item_version
) VALUES (
  '80400000-0000-4000-8000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '80000000-0000-4000-8000-000000000001',
  'item_created',
  '00000000-0000-0000-0000-000000000001',
  1
);

DO $$
BEGIN
  BEGIN
    UPDATE relationship_events
    SET event_type = 'mutated'
    WHERE id = '80400000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'expected relationship event append-only rejection';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM <> 'relationship_events rows are append-only while retained' THEN
        RAISE;
      END IF;
  END;
END;
$$;


-- M3 media invariants.
INSERT INTO media_objects (
  id, partnership_id, uploader_account_id, uploader_device_id, storage_object_key,
  ciphertext_size, crypto_protocol_version, media_kind, format_code, state,
  ciphertext_sha256, upload_generation, upload_expires_at, ready_at,
  deletion_generation, created_at
) VALUES (
  '81000000-0000-4000-8000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  '70000000-0000-0000-0000-000000000001',
  'media/v1/invariant-a',
  128,
  'm3-test-aes-gcm-v1',
  'image',
  'webp',
  'ready_unbound',
  repeat('a', 64),
  1,
  now() + interval '1 day',
  now(),
  1,
  now()
);

DO $
BEGIN
  BEGIN
    UPDATE media_objects
    SET storage_object_key = 'media/v1/changed'
    WHERE id = '81000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'expected immutable media payload identity rejection';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM <> 'media object identity and encrypted payload metadata are immutable' THEN
        RAISE;
      END IF;
  END;
END;
$;

UPDATE media_objects
SET state = 'bound',
    binding_type = 'relationship_item',
    binding_id = '80000000-0000-4000-8000-000000000001',
    binding_role = 'attachment',
    binding_position = 0,
    upload_expires_at = NULL
WHERE id = '81000000-0000-4000-8000-000000000001';

DO $
BEGIN
  BEGIN
    UPDATE media_objects
    SET binding_position = 1
    WHERE id = '81000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'expected immutable media binding rejection';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM <> 'media binding identity is immutable after bind' THEN
        RAISE;
      END IF;
  END;
END;
$;

INSERT INTO media_objects (
  id, partnership_id, uploader_account_id, storage_object_key,
  ciphertext_size, crypto_protocol_version, media_kind, format_code, state,
  ciphertext_sha256, upload_generation, upload_expires_at, ready_at,
  deletion_generation, created_at
) VALUES (
  '81000000-0000-4000-8000-000000000002',
  '20000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'media/v1/invariant-b',
  128,
  'm3-test-aes-gcm-v1',
  'image',
  'webp',
  'ready_unbound',
  repeat('b', 64),
  1,
  now() + interval '1 day',
  now(),
  1,
  now()
);

DO $
BEGIN
  BEGIN
    UPDATE media_objects
    SET state = 'bound',
        binding_type = 'relationship_item',
        binding_id = '80000000-0000-4000-8000-000000000004',
        binding_role = 'attachment',
        binding_position = 0,
        upload_expires_at = NULL
    WHERE id = '81000000-0000-4000-8000-000000000002';
    RAISE EXCEPTION 'expected cross-partnership media binding rejection';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM <> 'media binding target must exist in the same partnership' THEN
        RAISE;
      END IF;
  END;
END;
$;

DO $
BEGIN
  BEGIN
    UPDATE media_objects
    SET state = 'bound',
        binding_type = 'relationship_item',
        binding_id = '80000000-0000-4000-8000-000000000001',
        binding_role = 'attachment',
        binding_position = 0,
        upload_expires_at = NULL
    WHERE id = '81000000-0000-4000-8000-000000000002';
    RAISE EXCEPTION 'expected media binding position uniqueness rejection';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;
END;
$;

DO $
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'media_objects_identity_immutable' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'missing M3 immutable media trigger';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'media_objects_binding_target' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'missing M3 binding target trigger';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'media_objects_binding_position_unique'
  ) THEN
    RAISE EXCEPTION 'missing M3 binding uniqueness index';
  END IF;
END;
$;

ROLLBACK;
