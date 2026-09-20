CREATE TABLE partner_requests (
  id uuid PRIMARY KEY,
  sender_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  recipient_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  declined_at timestamptz,
  cancelled_at timestamptz,
  accepted_at timestamptz,
  invalidated_at timestamptz,
  CONSTRAINT partner_requests_not_self
    CHECK (sender_account_id <> recipient_account_id),
  CONSTRAINT partner_requests_status_valid
    CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'expired', 'invalidated')),
  CONSTRAINT partner_requests_exact_expiry
    CHECK (expires_at = created_at + interval '7 days')
);

CREATE UNIQUE INDEX partner_requests_one_pending_direction
  ON partner_requests (sender_account_id, recipient_account_id)
  WHERE status = 'pending';

CREATE INDEX partner_requests_recipient_pending
  ON partner_requests (recipient_account_id, created_at DESC)
  WHERE status = 'pending';

CREATE TABLE partner_request_attempts (
  id uuid PRIMARY KEY,
  request_id uuid REFERENCES partner_requests(id) ON DELETE SET NULL,
  sender_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  recipient_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  outcome text NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT partner_request_attempts_not_self
    CHECK (sender_account_id <> recipient_account_id),
  CONSTRAINT partner_request_attempts_outcome_valid
    CHECK (outcome IN ('created', 'rate_limited', 'decline_cooldown', 'blocked', 'ineligible'))
);

CREATE INDEX partner_request_attempts_rolling_window
  ON partner_request_attempts (sender_account_id, recipient_account_id, created_at DESC);

CREATE TABLE partnerships (
  id uuid PRIMARY KEY,
  relationship_start_date date NOT NULL,
  lifecycle_state text NOT NULL DEFAULT 'active',
  version bigint NOT NULL DEFAULT 1,
  generation bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz NOT NULL,
  terminated_at timestamptz,
  termination_reason text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partnerships_lifecycle_valid
    CHECK (lifecycle_state IN ('active', 'breakup_pending', 'terminated')),
  CONSTRAINT partnerships_version_positive
    CHECK (version > 0),
  CONSTRAINT partnerships_generation_positive
    CHECK (generation > 0),
  CONSTRAINT partnerships_termination_shape
    CHECK (
      (lifecycle_state <> 'terminated' AND terminated_at IS NULL AND termination_reason IS NULL)
      OR
      (lifecycle_state = 'terminated' AND terminated_at IS NOT NULL AND termination_reason IN ('breakup', 'partner_account_deleted'))
    )
);

CREATE TABLE partnership_members (
  partnership_id uuid NOT NULL REFERENCES partnerships(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL,
  released_at timestamptz,
  PRIMARY KEY (partnership_id, account_id)
);

CREATE UNIQUE INDEX partnership_members_one_occupied_slot
  ON partnership_members (account_id)
  WHERE released_at IS NULL;

CREATE INDEX partnership_members_partnership_current
  ON partnership_members (partnership_id)
  WHERE released_at IS NULL;

CREATE TABLE breakup_processes (
  id uuid PRIMARY KEY,
  partnership_id uuid NOT NULL REFERENCES partnerships(id) ON DELETE CASCADE,
  initiated_by_account_id uuid NOT NULL,
  initiated_at timestamptz NOT NULL,
  initiator_cancel_until timestamptz NOT NULL,
  base_deadline timestamptz NOT NULL,
  final_deadline timestamptz NOT NULL,
  generation bigint NOT NULL,
  restored_at timestamptz,
  dissolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT breakup_processes_member_fk
    FOREIGN KEY (partnership_id, initiated_by_account_id)
    REFERENCES partnership_members(partnership_id, account_id),
  CONSTRAINT breakup_processes_generation_positive
    CHECK (generation > 0),
  CONSTRAINT breakup_processes_exact_cancel_window
    CHECK (initiator_cancel_until = initiated_at + interval '1 hour'),
  CONSTRAINT breakup_processes_exact_base_deadline
    CHECK (base_deadline = initiated_at + interval '7 days'),
  CONSTRAINT breakup_processes_final_deadline_valid
    CHECK (
      final_deadline = base_deadline
      OR final_deadline = initiated_at + interval '10 days'
    ),
  CONSTRAINT breakup_processes_terminal_exclusive
    CHECK (NOT (restored_at IS NOT NULL AND dissolved_at IS NOT NULL))
);

CREATE UNIQUE INDEX breakup_processes_one_open
  ON breakup_processes (partnership_id)
  WHERE restored_at IS NULL AND dissolved_at IS NULL;

CREATE TABLE breakup_restore_intents (
  breakup_process_id uuid NOT NULL REFERENCES breakup_processes(id) ON DELETE CASCADE,
  partnership_id uuid NOT NULL,
  account_id uuid NOT NULL,
  submitted_at timestamptz NOT NULL,
  PRIMARY KEY (breakup_process_id, account_id),
  CONSTRAINT breakup_restore_intents_member_fk
    FOREIGN KEY (partnership_id, account_id)
    REFERENCES partnership_members(partnership_id, account_id)
);

CREATE INDEX breakup_restore_intents_partnership
  ON breakup_restore_intents (partnership_id, submitted_at);

CREATE TABLE account_partner_eligibility (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  source_partnership_id uuid REFERENCES partnerships(id) ON DELETE SET NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL,
  eligible_at timestamptz NOT NULL,
  resolved_at timestamptz,
  CONSTRAINT account_partner_eligibility_reason_valid
    CHECK (reason IN ('breakup_dissolution', 'partner_account_deleted')),
  CONSTRAINT account_partner_eligibility_window_valid
    CHECK (eligible_at > created_at)
);

CREATE UNIQUE INDEX account_partner_eligibility_one_open
  ON account_partner_eligibility (account_id)
  WHERE resolved_at IS NULL;

CREATE INDEX account_partner_eligibility_due
  ON account_partner_eligibility (eligible_at)
  WHERE resolved_at IS NULL;

CREATE TABLE partnership_blocks (
  id uuid PRIMARY KEY,
  blocker_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  blocked_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  source_partnership_id uuid REFERENCES partnerships(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL,
  removed_at timestamptz,
  CONSTRAINT partnership_blocks_not_self
    CHECK (blocker_account_id <> blocked_account_id)
);

CREATE UNIQUE INDEX partnership_blocks_one_active_direction
  ON partnership_blocks (blocker_account_id, blocked_account_id)
  WHERE removed_at IS NULL;

CREATE INDEX partnership_blocks_blocked_lookup
  ON partnership_blocks (blocked_account_id)
  WHERE removed_at IS NULL;

CREATE TABLE partnership_crypto_epochs (
  partnership_id uuid NOT NULL REFERENCES partnerships(id) ON DELETE CASCADE,
  epoch integer NOT NULL,
  crypto_protocol_version text NOT NULL,
  created_at timestamptz NOT NULL,
  retired_at timestamptz,
  rotation_reason text,
  PRIMARY KEY (partnership_id, epoch),
  CONSTRAINT partnership_crypto_epochs_positive
    CHECK (epoch > 0)
);
