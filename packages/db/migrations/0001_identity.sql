CREATE TABLE accounts (
  id uuid PRIMARY KEY,
  username_normalized text NOT NULL,
  username_display text NOT NULL,
  date_of_birth date NOT NULL,
  date_of_birth_corrected_at timestamptz,
  status text NOT NULL DEFAULT 'active',
  next_username_change_eligible_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT accounts_username_normalized_lowercase
    CHECK (username_normalized = lower(username_normalized)),
  CONSTRAINT accounts_status_valid
    CHECK (status IN ('active', 'deletion_pending', 'deleted'))
);

CREATE UNIQUE INDEX accounts_username_normalized_unique
  ON accounts (username_normalized);

CREATE TABLE account_profiles (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  bio text,
  avatar_object_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE account_emails (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  email_normalized text NOT NULL,
  verified_at timestamptz,
  is_current boolean NOT NULL DEFAULT false,
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_emails_normalized_lowercase
    CHECK (email_normalized = lower(email_normalized)),
  CONSTRAINT account_emails_current_requires_verified
    CHECK (
      NOT is_current
      OR (verified_at IS NOT NULL AND released_at IS NULL)
    )
);

CREATE UNIQUE INDEX account_emails_one_current_per_account
  ON account_emails (account_id)
  WHERE is_current AND released_at IS NULL;

CREATE UNIQUE INDEX account_emails_current_verified_unique
  ON account_emails (email_normalized)
  WHERE is_current AND verified_at IS NOT NULL AND released_at IS NULL;

CREATE INDEX account_emails_account_history
  ON account_emails (account_id, created_at DESC);

CREATE TABLE email_verifications (
  id uuid PRIMARY KEY,
  account_id uuid REFERENCES accounts(id) ON DELETE CASCADE,
  purpose text NOT NULL,
  email_normalized text NOT NULL,
  verifier bytea NOT NULL,
  expires_at timestamptz NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_verifications_purpose_valid
    CHECK (purpose IN ('registration', 'email_change', 'password_recovery')),
  CONSTRAINT email_verifications_attempt_count_nonnegative
    CHECK (attempt_count >= 0),
  CONSTRAINT email_verifications_normalized_lowercase
    CHECK (email_normalized = lower(email_normalized)),
  CONSTRAINT email_verifications_expiry_after_creation
    CHECK (expires_at > created_at)
);

CREATE INDEX email_verifications_lookup
  ON email_verifications (email_normalized, purpose, created_at DESC);

CREATE TABLE account_devices (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  crypto_identity_public_key bytea,
  crypto_protocol_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  revoked_at timestamptz
);

CREATE INDEX account_devices_account_active
  ON account_devices (account_id, created_at)
  WHERE revoked_at IS NULL;

CREATE TABLE account_sessions (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  device_id uuid REFERENCES account_devices(id) ON DELETE SET NULL,
  token_verifier bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_seen_at timestamptz,
  CONSTRAINT account_sessions_expiry_after_creation
    CHECK (expires_at > created_at)
);

CREATE INDEX account_sessions_account_active
  ON account_sessions (account_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE account_recovery_material (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  device_id uuid REFERENCES account_devices(id) ON DELETE SET NULL,
  crypto_protocol_version text NOT NULL,
  encrypted_material bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  replaced_at timestamptz
);

CREATE INDEX account_recovery_material_account_current
  ON account_recovery_material (account_id, created_at DESC)
  WHERE replaced_at IS NULL;

CREATE TABLE account_deletion_requests (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  requested_at timestamptz NOT NULL,
  recover_until timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  generation bigint NOT NULL,
  recovered_at timestamptz,
  finalized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_deletion_requests_status_valid
    CHECK (status IN ('pending', 'recovered', 'finalized')),
  CONSTRAINT account_deletion_requests_generation_positive
    CHECK (generation > 0),
  CONSTRAINT account_deletion_requests_exact_recovery_window
    CHECK (recover_until = requested_at + interval '7 days'),
  CONSTRAINT account_deletion_requests_terminal_fields_valid
    CHECK (
      (status = 'pending' AND recovered_at IS NULL AND finalized_at IS NULL)
      OR (status = 'recovered' AND recovered_at IS NOT NULL AND finalized_at IS NULL)
      OR (status = 'finalized' AND recovered_at IS NULL AND finalized_at IS NOT NULL)
    )
);

CREATE UNIQUE INDEX account_deletion_requests_one_pending
  ON account_deletion_requests (account_id)
  WHERE status = 'pending';

CREATE TABLE username_change_history (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  old_username_normalized text NOT NULL,
  new_username_normalized text NOT NULL,
  changed_at timestamptz NOT NULL,
  next_eligible_at timestamptz NOT NULL,
  CONSTRAINT username_change_history_exact_year
    CHECK (next_eligible_at = changed_at + interval '1 year')
);

CREATE INDEX username_change_history_account
  ON username_change_history (account_id, changed_at DESC);
