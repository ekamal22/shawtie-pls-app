CREATE TABLE registration_intents (
  id uuid PRIMARY KEY,
  username_normalized text NOT NULL,
  username_display text NOT NULL,
  display_name text NOT NULL,
  date_of_birth date NOT NULL,
  email_normalized text NOT NULL,
  email_display text NOT NULL,
  password_hash text,
  expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT registration_intents_username_lowercase
    CHECK (username_normalized = lower(username_normalized)),
  CONSTRAINT registration_intents_email_lowercase
    CHECK (email_normalized = lower(email_normalized)),
  CONSTRAINT registration_intents_expiry_after_creation
    CHECK (expires_at > created_at),
  CONSTRAINT registration_intents_completion_shape
    CHECK (
      (completed_at IS NULL AND password_hash IS NOT NULL)
      OR (completed_at IS NOT NULL AND password_hash IS NULL)
    )
);

CREATE INDEX registration_intents_expiry
  ON registration_intents (expires_at)
  WHERE completed_at IS NULL;

CREATE TABLE account_password_credentials (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  password_version integer NOT NULL DEFAULT 1,
  changed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_password_credentials_version_positive
    CHECK (password_version > 0)
);

ALTER TABLE account_emails
  ADD COLUMN email_display text;

UPDATE account_emails
SET email_display = email_normalized
WHERE email_display IS NULL;

ALTER TABLE account_emails
  ALTER COLUMN email_display SET NOT NULL;

ALTER TABLE email_verifications
  DROP CONSTRAINT email_verifications_purpose_valid,
  ADD COLUMN registration_intent_id uuid REFERENCES registration_intents(id) ON DELETE CASCADE,
  ADD COLUMN email_display text,
  ADD COLUMN challenge_nonce bytea,
  ADD COLUMN max_attempts integer NOT NULL DEFAULT 5,
  ADD COLUMN superseded_at timestamptz,
  ADD COLUMN verifier_key_version integer NOT NULL DEFAULT 1,
  ADD COLUMN last_attempt_at timestamptz,
  ADD CONSTRAINT email_verifications_purpose_valid
    CHECK (purpose IN ('registration', 'email_change', 'password_recovery', 'account_recovery')),
  ADD CONSTRAINT email_verifications_max_attempts_positive
    CHECK (max_attempts > 0),
  ADD CONSTRAINT email_verifications_key_version_positive
    CHECK (verifier_key_version > 0),
  ADD CONSTRAINT email_verifications_attempts_bounded
    CHECK (attempt_count <= max_attempts),
  ADD CONSTRAINT email_verifications_display_nonempty
    CHECK (email_display IS NULL OR length(email_display) > 0),
  ADD CONSTRAINT email_verifications_subject_shape
    CHECK (
      (
        purpose = 'registration'
        AND registration_intent_id IS NOT NULL
        AND account_id IS NULL
      )
      OR
      (
        purpose <> 'registration'
        AND account_id IS NOT NULL
        AND registration_intent_id IS NULL
      )
    ) NOT VALID;

CREATE UNIQUE INDEX email_verifications_one_active_registration
  ON email_verifications (registration_intent_id, purpose)
  WHERE registration_intent_id IS NOT NULL
    AND consumed_at IS NULL
    AND superseded_at IS NULL;

CREATE UNIQUE INDEX email_verifications_one_active_account_purpose
  ON email_verifications (account_id, purpose)
  WHERE account_id IS NOT NULL
    AND consumed_at IS NULL
    AND superseded_at IS NULL;

ALTER TABLE account_sessions
  ADD COLUMN token_key_version integer NOT NULL DEFAULT 1,
  ADD COLUMN token_generation bigint NOT NULL DEFAULT 1,
  ADD COLUMN idle_expires_at timestamptz,
  ADD COLUMN reauthenticated_at timestamptz,
  ADD COLUMN rotated_at timestamptz,
  ADD CONSTRAINT account_sessions_token_key_version_positive
    CHECK (token_key_version > 0),
  ADD CONSTRAINT account_sessions_token_generation_positive
    CHECK (token_generation > 0);

UPDATE account_sessions
SET idle_expires_at = expires_at
WHERE idle_expires_at IS NULL;

ALTER TABLE account_sessions
  ALTER COLUMN idle_expires_at SET NOT NULL,
  ADD CONSTRAINT account_sessions_idle_expiry_after_creation
    CHECK (idle_expires_at > created_at);

CREATE UNIQUE INDEX account_sessions_token_verifier_unique
  ON account_sessions (token_verifier);

ALTER TABLE account_devices
  ADD COLUMN handle_verifier bytea,
  ADD COLUMN handle_key_version integer,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT account_devices_handle_key_version_positive
    CHECK (handle_key_version IS NULL OR handle_key_version > 0),
  ADD CONSTRAINT account_devices_handle_shape
    CHECK (
      (handle_verifier IS NULL AND handle_key_version IS NULL)
      OR (handle_verifier IS NOT NULL AND handle_key_version IS NOT NULL)
    );

CREATE UNIQUE INDEX account_devices_handle_verifier_unique
  ON account_devices (handle_verifier)
  WHERE handle_verifier IS NOT NULL;

CREATE TABLE security_rate_limit_buckets (
  scope text NOT NULL,
  key_hash bytea NOT NULL,
  window_started_at timestamptz NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  blocked_until timestamptz,
  last_outcome text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, key_hash),
  CONSTRAINT security_rate_limit_scope_nonempty
    CHECK (length(scope) > 0),
  CONSTRAINT security_rate_limit_attempt_count_nonnegative
    CHECK (attempt_count >= 0)
);

CREATE INDEX security_rate_limit_blocked
  ON security_rate_limit_buckets (blocked_until)
  WHERE blocked_until IS NOT NULL;

CREATE TABLE security_email_deliveries (
  id uuid PRIMARY KEY,
  account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  destination_email text NOT NULL,
  template text NOT NULL,
  parameters_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  expires_at timestamptz NOT NULL,
  CONSTRAINT security_email_deliveries_destination_nonempty
    CHECK (length(destination_email) > 0),
  CONSTRAINT security_email_deliveries_template_nonempty
    CHECK (length(template) > 0),
  CONSTRAINT security_email_deliveries_expiry_after_creation
    CHECK (expires_at > created_at),
  CONSTRAINT security_email_deliveries_parameters_object
    CHECK (jsonb_typeof(parameters_json) = 'object')
);

CREATE INDEX security_email_deliveries_expiry
  ON security_email_deliveries (expires_at);

CREATE FUNCTION reject_security_event_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'security_events rows are append-only while retained';
END;
$$;

CREATE TRIGGER security_events_no_update
BEFORE UPDATE ON security_events
FOR EACH ROW
EXECUTE FUNCTION reject_security_event_update();
