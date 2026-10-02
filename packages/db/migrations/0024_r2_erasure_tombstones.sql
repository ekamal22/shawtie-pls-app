CREATE TABLE erasure_tombstones (
  subject_type text NOT NULL,
  subject_id uuid NOT NULL,
  erased_at timestamptz NOT NULL,
  reason text NOT NULL,
  PRIMARY KEY (subject_type, subject_id),
  CONSTRAINT erasure_tombstones_subject_type CHECK (
    subject_type IN ('account','partnership')
  ),
  CONSTRAINT erasure_tombstones_reason_nonempty CHECK (
    char_length(reason) BETWEEN 1 AND 80
  )
);

CREATE INDEX erasure_tombstones_erased_at
  ON erasure_tombstones (erased_at, subject_type, subject_id);
