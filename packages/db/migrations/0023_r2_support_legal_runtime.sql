ALTER TABLE registration_intents
  ADD COLUMN policy_version text,
  ADD COLUMN policy_accepted_at timestamptz;

CREATE TABLE account_policy_acceptances (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  policy_version text NOT NULL,
  accepted_at timestamptz NOT NULL,
  PRIMARY KEY (account_id, policy_version),
  CONSTRAINT account_policy_version_nonempty CHECK (char_length(policy_version) BETWEEN 1 AND 64)
);

CREATE TABLE abuse_reports (
  id uuid PRIMARY KEY,
  reporter_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  target_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  subject_reference text,
  category text NOT NULL,
  details text,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL,
  resolved_at timestamptz,
  CONSTRAINT abuse_report_category_check CHECK (
    category IN (
      'abusive_username',
      'impersonation',
      'partner_request_harassment',
      'account_compromise',
      'illegal_content',
      'other'
    )
  ),
  CONSTRAINT abuse_report_status_check CHECK (status IN ('open','resolved')),
  CONSTRAINT abuse_report_subject_reference_length CHECK (
    subject_reference IS NULL OR char_length(subject_reference) BETWEEN 1 AND 120
  ),
  CONSTRAINT abuse_report_details_length CHECK (
    details IS NULL OR char_length(details) BETWEEN 1 AND 2000
  ),
  CONSTRAINT abuse_report_resolution_check CHECK (
    (status = 'open' AND resolved_at IS NULL)
    OR (status = 'resolved' AND resolved_at IS NOT NULL)
  )
);

CREATE INDEX abuse_reports_reporter_created_idx
  ON abuse_reports (reporter_account_id, created_at DESC);

CREATE INDEX abuse_reports_status_created_idx
  ON abuse_reports (status, created_at ASC);
