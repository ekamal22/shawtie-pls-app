CREATE TABLE device_crypto_identities (
  crypto_device_id uuid PRIMARY KEY,
  device_id uuid NOT NULL UNIQUE REFERENCES account_devices(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  crypto_profile text NOT NULL,
  mls_signing_public_key bytea NOT NULL,
  content_signing_public_key bytea NOT NULL,
  trust_state text NOT NULL DEFAULT 'pending',
  approved_by_crypto_device_id uuid REFERENCES device_crypto_identities(crypto_device_id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT device_crypto_identities_profile_nonempty CHECK (length(crypto_profile) > 0),
  CONSTRAINT device_crypto_identities_mls_key_nonempty CHECK (octet_length(mls_signing_public_key) > 0),
  CONSTRAINT device_crypto_identities_content_key_nonempty CHECK (octet_length(content_signing_public_key) > 0),
  CONSTRAINT device_crypto_identities_trust_state_valid
    CHECK (trust_state IN ('pending', 'trusted', 'revoked')),
  CONSTRAINT device_crypto_identities_trust_shape
    CHECK (
      (trust_state = 'pending' AND approved_at IS NULL AND revoked_at IS NULL)
      OR (trust_state = 'trusted' AND approved_at IS NOT NULL AND revoked_at IS NULL)
      OR (trust_state = 'revoked' AND revoked_at IS NOT NULL)
    )
);

CREATE INDEX device_crypto_identities_account
  ON device_crypto_identities (account_id, created_at);

CREATE INDEX device_crypto_identities_account_trusted
  ON device_crypto_identities (account_id, created_at)
  WHERE trust_state = 'trusted' AND revoked_at IS NULL;

CREATE TABLE device_crypto_approvals (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  target_crypto_device_id uuid NOT NULL REFERENCES device_crypto_identities(crypto_device_id) ON DELETE CASCADE,
  approver_crypto_device_id uuid REFERENCES device_crypto_identities(crypto_device_id) ON DELETE SET NULL,
  approval_kind text NOT NULL,
  approval_signature bytea,
  created_at timestamptz NOT NULL,
  CONSTRAINT device_crypto_approvals_kind_valid
    CHECK (approval_kind IN ('trusted_device', 'recovery')),
  CONSTRAINT device_crypto_approvals_signature_shape
    CHECK (
      (approval_kind = 'trusted_device' AND approver_crypto_device_id IS NOT NULL AND approval_signature IS NOT NULL)
      OR (approval_kind = 'recovery' AND approver_crypto_device_id IS NULL)
    )
);

CREATE UNIQUE INDEX device_crypto_approvals_target_once
  ON device_crypto_approvals (target_crypto_device_id);

CREATE TABLE device_key_packages (
  id uuid PRIMARY KEY,
  crypto_device_id uuid NOT NULL REFERENCES device_crypto_identities(crypto_device_id) ON DELETE CASCADE,
  key_package bytea NOT NULL,
  key_package_sha256 bytea NOT NULL,
  state text NOT NULL DEFAULT 'available',
  reserved_partnership_id uuid REFERENCES partnerships(id) ON DELETE SET NULL,
  reserved_at timestamptz,
  consumed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT device_key_packages_nonempty CHECK (octet_length(key_package) > 0),
  CONSTRAINT device_key_packages_digest_size CHECK (octet_length(key_package_sha256) = 32),
  CONSTRAINT device_key_packages_state_valid
    CHECK (state IN ('available', 'reserved', 'consumed', 'revoked')),
  CONSTRAINT device_key_packages_state_shape
    CHECK (
      (state = 'available' AND reserved_partnership_id IS NULL AND reserved_at IS NULL AND consumed_at IS NULL AND revoked_at IS NULL)
      OR (state = 'reserved' AND reserved_partnership_id IS NOT NULL AND reserved_at IS NOT NULL AND consumed_at IS NULL AND revoked_at IS NULL)
      OR (state = 'consumed' AND consumed_at IS NOT NULL AND revoked_at IS NULL)
      OR (state = 'revoked' AND revoked_at IS NOT NULL)
    )
);

CREATE UNIQUE INDEX device_key_packages_digest_unique
  ON device_key_packages (key_package_sha256);

CREATE INDEX device_key_packages_available
  ON device_key_packages (crypto_device_id, created_at)
  WHERE state = 'available';

CREATE TABLE account_crypto_recovery (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  crypto_profile text NOT NULL,
  recovery_key_version integer NOT NULL,
  recovery_hpke_public_key bytea NOT NULL,
  recovery_auth_public_key bytea NOT NULL,
  encrypted_bundle bytea NOT NULL,
  created_by_crypto_device_id uuid NOT NULL REFERENCES device_crypto_identities(crypto_device_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL,
  replaced_at timestamptz,
  CONSTRAINT account_crypto_recovery_profile_nonempty CHECK (length(crypto_profile) > 0),
  CONSTRAINT account_crypto_recovery_key_version_positive CHECK (recovery_key_version > 0),
  CONSTRAINT account_crypto_recovery_hpke_key_nonempty CHECK (octet_length(recovery_hpke_public_key) > 0),
  CONSTRAINT account_crypto_recovery_auth_key_nonempty CHECK (octet_length(recovery_auth_public_key) > 0),
  CONSTRAINT account_crypto_recovery_bundle_nonempty CHECK (octet_length(encrypted_bundle) > 0)
);

CREATE UNIQUE INDEX account_crypto_recovery_one_current
  ON account_crypto_recovery (account_id)
  WHERE replaced_at IS NULL;

CREATE UNIQUE INDEX account_crypto_recovery_account_version
  ON account_crypto_recovery (account_id, recovery_key_version);

CREATE TABLE crypto_recovery_challenges (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  target_crypto_device_id uuid NOT NULL REFERENCES device_crypto_identities(crypto_device_id) ON DELETE CASCADE,
  recovery_key_version integer NOT NULL,
  challenge bytea NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  failed_at timestamptz,
  CONSTRAINT crypto_recovery_challenges_key_version_positive CHECK (recovery_key_version > 0),
  CONSTRAINT crypto_recovery_challenges_size CHECK (octet_length(challenge) = 32),
  CONSTRAINT crypto_recovery_challenges_expiry CHECK (expires_at > created_at),
  CONSTRAINT crypto_recovery_challenges_terminal_exclusive
    CHECK (NOT (consumed_at IS NOT NULL AND failed_at IS NOT NULL))
);

CREATE UNIQUE INDEX crypto_recovery_challenges_one_open_target
  ON crypto_recovery_challenges (target_crypto_device_id)
  WHERE consumed_at IS NULL AND failed_at IS NULL;

CREATE INDEX crypto_recovery_challenges_expiry
  ON crypto_recovery_challenges (expires_at)
  WHERE consumed_at IS NULL AND failed_at IS NULL;

CREATE FUNCTION s1_revoke_crypto_identity_with_device()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL THEN
    UPDATE device_crypto_identities
    SET trust_state = 'revoked',
        revoked_at = NEW.revoked_at
    WHERE device_id = NEW.id
      AND revoked_at IS NULL;

    UPDATE device_key_packages
    SET state = 'revoked',
        revoked_at = NEW.revoked_at,
        reserved_partnership_id = NULL,
        reserved_at = NULL
    WHERE crypto_device_id IN (
      SELECT crypto_device_id
      FROM device_crypto_identities
      WHERE device_id = NEW.id
    )
      AND state IN ('available', 'reserved');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER account_devices_s1_crypto_revoke
AFTER UPDATE OF revoked_at ON account_devices
FOR EACH ROW
EXECUTE FUNCTION s1_revoke_crypto_identity_with_device();
