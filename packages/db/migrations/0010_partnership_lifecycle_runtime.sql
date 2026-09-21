ALTER TABLE breakup_processes
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN superseded_at timestamptz;

ALTER TABLE breakup_processes
  DROP CONSTRAINT breakup_processes_terminal_exclusive;

ALTER TABLE breakup_processes
  ADD CONSTRAINT breakup_processes_terminal_exclusive
    CHECK (num_nonnulls(restored_at, dissolved_at, cancelled_at, superseded_at) <= 1) NOT VALID,
  ADD CONSTRAINT breakup_processes_cancel_timing
    CHECK (cancelled_at IS NULL OR (cancelled_at >= initiated_at AND cancelled_at < initiator_cancel_until)) NOT VALID,
  ADD CONSTRAINT breakup_processes_restore_timing
    CHECK (restored_at IS NULL OR (restored_at >= initiator_cancel_until AND restored_at < final_deadline)) NOT VALID,
  ADD CONSTRAINT breakup_processes_dissolve_timing
    CHECK (dissolved_at IS NULL OR dissolved_at = final_deadline) NOT VALID,
  ADD CONSTRAINT breakup_processes_supersede_timing
    CHECK (superseded_at IS NULL OR superseded_at >= initiated_at) NOT VALID;

DROP INDEX breakup_processes_one_open;

CREATE UNIQUE INDEX breakup_processes_one_open
  ON breakup_processes (partnership_id)
  WHERE restored_at IS NULL
    AND dissolved_at IS NULL
    AND cancelled_at IS NULL
    AND superseded_at IS NULL;

ALTER TABLE account_partner_eligibility
  ADD CONSTRAINT account_partner_eligibility_exact_duration
    CHECK (
      (reason = 'breakup_dissolution' AND eligible_at = created_at + interval '3 months')
      OR
      (reason = 'partner_account_deleted' AND eligible_at = created_at + interval '1 month')
    ) NOT VALID;

ALTER TABLE partnership_blocks
  ADD CONSTRAINT partnership_blocks_source_required
    CHECK (source_partnership_id IS NOT NULL) NOT VALID;

ALTER TABLE account_notifications
  DROP CONSTRAINT account_notifications_event_type_valid;

ALTER TABLE account_notifications
  ADD CONSTRAINT account_notifications_event_type_valid
    CHECK (
      event_type IN (
        'partnership_formed',
        'relationship_start_date_changed',
        'breakup_started',
        'breakup_cancelled',
        'restoration_requested',
        'partnership_restored',
        'breakup_deadline_reminder',
        'partnership_dissolved',
        'partner_account_deletion_started',
        'partner_account_recovered',
        'partner_account_deleted'
      )
    );

CREATE INDEX partnership_members_former_history
  ON partnership_members (account_id, released_at DESC, partnership_id)
  WHERE released_at IS NOT NULL;

CREATE INDEX scheduled_actions_pending_aggregate
  ON scheduled_actions (aggregate_type, aggregate_id)
  WHERE status = 'pending';

CREATE UNIQUE INDEX deletion_manifests_one_partnership
  ON deletion_manifests (subject_type, subject_id)
  WHERE subject_type = 'partnership';
