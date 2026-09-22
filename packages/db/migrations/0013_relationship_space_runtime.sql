ALTER TABLE relationship_items
  ADD COLUMN content_schema_version integer NOT NULL DEFAULT 1,
  ADD COLUMN development_preview_payload jsonb,
  ADD COLUMN development_plaintext_payload jsonb,
  ADD COLUMN encrypted_preview_payload bytea,
  ADD COLUMN occurred_year smallint,
  ADD COLUMN occurred_month smallint,
  ADD COLUMN occurred_day smallint,
  ADD COLUMN release_mode text,
  ADD COLUMN release_generation bigint NOT NULL DEFAULT 1,
  ADD COLUMN released_at timestamptz;


UPDATE relationship_items
SET
  occurred_year = CASE
    WHEN occurred_precision IN ('day', 'month', 'year') AND occurred_date IS NOT NULL
      THEN EXTRACT(YEAR FROM occurred_date)::smallint
    ELSE occurred_year
  END,
  occurred_month = CASE
    WHEN occurred_precision IN ('day', 'month') AND occurred_date IS NOT NULL
      THEN EXTRACT(MONTH FROM occurred_date)::smallint
    ELSE occurred_month
  END,
  occurred_day = CASE
    WHEN occurred_precision = 'day' AND occurred_date IS NOT NULL
      THEN EXTRACT(DAY FROM occurred_date)::smallint
    ELSE occurred_day
  END;
ALTER TABLE relationship_items
  ADD CONSTRAINT relationship_items_id_partnership_unique
    UNIQUE (id, partnership_id),
  ADD CONSTRAINT relationship_items_content_schema_positive
    CHECK (content_schema_version > 0) NOT VALID,
  ADD CONSTRAINT relationship_items_release_generation_positive
    CHECK (release_generation > 0) NOT VALID,
  ADD CONSTRAINT relationship_items_r1_kind_valid
    CHECK (
      kind IN (
        'memory',
        'remember_this',
        'first',
        'place',
        'for_you',
        'future_us',
        'love',
        'someday',
        'our_year',
        'anniversary',
        'surprise',
        'reunion',
        'proposal',
        'relationship_signal'
      )
    ) NOT VALID,
  ADD CONSTRAINT relationship_items_content_storage_mode
    CHECK (
      NOT (
        (
          development_preview_payload IS NOT NULL
          OR development_plaintext_payload IS NOT NULL
        )
        AND
        (
          encrypted_preview_payload IS NOT NULL
          OR encrypted_payload IS NOT NULL
          OR ciphertext_version IS NOT NULL
        )
      )
    ) NOT VALID,
  ADD CONSTRAINT relationship_items_encrypted_version_shape
    CHECK (
      (
        encrypted_preview_payload IS NULL
        AND encrypted_payload IS NULL
        AND ciphertext_version IS NULL
      )
      OR
      (
        ciphertext_version IS NOT NULL
        AND (
          encrypted_preview_payload IS NOT NULL
          OR encrypted_payload IS NOT NULL
        )
      )
    ) NOT VALID,
  ADD CONSTRAINT relationship_items_occurrence_shape
    CHECK (
      (
        occurred_precision IS NULL
        AND occurred_year IS NULL
        AND occurred_month IS NULL
        AND occurred_day IS NULL
      )
      OR
      (
        occurred_precision = 'unknown'
        AND occurred_year IS NULL
        AND occurred_month IS NULL
        AND occurred_day IS NULL
      )
      OR
      (
        occurred_precision = 'year'
        AND occurred_year BETWEEN 1900 AND 9999
        AND occurred_month IS NULL
        AND occurred_day IS NULL
      )
      OR
      (
        occurred_precision = 'month'
        AND occurred_year BETWEEN 1900 AND 9999
        AND occurred_month BETWEEN 1 AND 12
        AND occurred_day IS NULL
      )
      OR
      (
        occurred_precision = 'day'
        AND occurred_year BETWEEN 1900 AND 9999
        AND occurred_month BETWEEN 1 AND 12
        AND occurred_day BETWEEN 1 AND 31
      )
    ) NOT VALID,
  ADD CONSTRAINT relationship_items_release_shape
    CHECK (
      (
        kind IN ('for_you', 'future_us')
        AND release_mode IN ('immediate', 'scheduled', 'recipient_open')
        AND (
          (
            release_mode = 'immediate'
            AND unlock_at IS NULL
            AND released_at IS NOT NULL
          )
          OR
          (
            release_mode = 'scheduled'
            AND unlock_at IS NOT NULL
          )
          OR
          (
            release_mode = 'recipient_open'
            AND unlock_at IS NULL
          )
        )
      )
      OR
      (
        kind IN ('surprise', 'proposal')
        AND release_mode IN ('immediate', 'creator_reveal')
        AND (
          (
            release_mode = 'immediate'
            AND unlock_at IS NULL
            AND released_at IS NOT NULL
          )
          OR
          (
            release_mode = 'creator_reveal'
            AND unlock_at IS NULL
          )
        )
      )
      OR
      (
        kind NOT IN ('for_you', 'future_us', 'surprise', 'proposal')
        AND release_mode IS NULL
        AND unlock_at IS NULL
        AND released_at IS NULL
      )
    ) NOT VALID;



CREATE FUNCTION reject_relationship_item_identity_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.partnership_id IS DISTINCT FROM OLD.partnership_id
     OR NEW.creator_account_id IS DISTINCT FROM OLD.creator_account_id
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'relationship_items immutable identity fields cannot change';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER relationship_items_identity_immutable
BEFORE UPDATE ON relationship_items
FOR EACH ROW
EXECUTE FUNCTION reject_relationship_item_identity_update();

CREATE TABLE relationship_someday_state (
  item_id uuid NOT NULL,
  partnership_id uuid NOT NULL,
  state text NOT NULL,
  completed_at timestamptz,
  PRIMARY KEY (item_id),
  CONSTRAINT relationship_someday_item_fk
    FOREIGN KEY (item_id, partnership_id)
    REFERENCES relationship_items(id, partnership_id)
    ON DELETE CASCADE,
  CONSTRAINT relationship_someday_state_valid
    CHECK (state IN ('someday', 'soon', 'completed')),
  CONSTRAINT relationship_someday_completion_shape
    CHECK (
      (state = 'completed' AND completed_at IS NOT NULL)
      OR
      (state <> 'completed' AND completed_at IS NULL)
    )
);

CREATE TABLE relationship_signal_state (
  item_id uuid NOT NULL,
  partnership_id uuid NOT NULL,
  signal_kind text NOT NULL,
  PRIMARY KEY (item_id),
  CONSTRAINT relationship_signal_item_fk
    FOREIGN KEY (item_id, partnership_id)
    REFERENCES relationship_items(id, partnership_id)
    ON DELETE CASCADE,
  CONSTRAINT relationship_signal_kind_valid
    CHECK (
      signal_kind IN (
        'i_need_you',
        'call_me_when_you_can',
        'i_need_reassurance',
        'shared_feeling',
        'thinking_of_you',
        'kiss',
        'hug'
      )
    )
);

CREATE TABLE relationship_reunion_state (
  item_id uuid NOT NULL,
  partnership_id uuid NOT NULL,
  target_date date NOT NULL,
  PRIMARY KEY (item_id),
  CONSTRAINT relationship_reunion_item_fk
    FOREIGN KEY (item_id, partnership_id)
    REFERENCES relationship_items(id, partnership_id)
    ON DELETE CASCADE
);

CREATE TABLE relationship_curations (
  item_id uuid NOT NULL,
  partnership_id uuid NOT NULL,
  curation_type text NOT NULL,
  anchor_year smallint NOT NULL,
  PRIMARY KEY (item_id),
  CONSTRAINT relationship_curation_item_fk
    FOREIGN KEY (item_id, partnership_id)
    REFERENCES relationship_items(id, partnership_id)
    ON DELETE CASCADE,
  CONSTRAINT relationship_curation_type_valid
    CHECK (curation_type IN ('our_year', 'anniversary')),
  CONSTRAINT relationship_curation_anchor_year_valid
    CHECK (anchor_year BETWEEN 1900 AND 9999),
  UNIQUE (partnership_id, curation_type, anchor_year)
);

CREATE FUNCTION validate_relationship_feature_state_kind()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  actual_kind text;
BEGIN
  SELECT kind
  INTO actual_kind
  FROM relationship_items
  WHERE id = NEW.item_id
    AND partnership_id = NEW.partnership_id;

  IF TG_TABLE_NAME = 'relationship_someday_state' AND actual_kind <> 'someday' THEN
    RAISE EXCEPTION 'relationship_someday_state requires someday item';
  END IF;
  IF TG_TABLE_NAME = 'relationship_signal_state' AND actual_kind <> 'relationship_signal' THEN
    RAISE EXCEPTION 'relationship_signal_state requires relationship_signal item';
  END IF;
  IF TG_TABLE_NAME = 'relationship_reunion_state' AND actual_kind <> 'reunion' THEN
    RAISE EXCEPTION 'relationship_reunion_state requires reunion item';
  END IF;
  IF TG_TABLE_NAME = 'relationship_curations' AND actual_kind <> NEW.curation_type THEN
    RAISE EXCEPTION 'relationship_curations type must match item kind';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER relationship_someday_state_kind
BEFORE INSERT OR UPDATE ON relationship_someday_state
FOR EACH ROW
EXECUTE FUNCTION validate_relationship_feature_state_kind();

CREATE TRIGGER relationship_signal_state_kind
BEFORE INSERT OR UPDATE ON relationship_signal_state
FOR EACH ROW
EXECUTE FUNCTION validate_relationship_feature_state_kind();

CREATE TRIGGER relationship_reunion_state_kind
BEFORE INSERT OR UPDATE ON relationship_reunion_state
FOR EACH ROW
EXECUTE FUNCTION validate_relationship_feature_state_kind();

CREATE TRIGGER relationship_curations_kind
BEFORE INSERT OR UPDATE ON relationship_curations
FOR EACH ROW
EXECUTE FUNCTION validate_relationship_feature_state_kind();

CREATE INDEX relationship_items_partnership_created_active
  ON relationship_items (partnership_id, created_at DESC, id DESC)
  WHERE lifecycle = 'active';

CREATE INDEX relationship_items_partnership_occurrence_active
  ON relationship_items (
    partnership_id,
    occurred_year,
    occurred_month,
    occurred_day,
    id
  )
  WHERE lifecycle = 'active';

CREATE INDEX relationship_items_partnership_kind_active
  ON relationship_items (partnership_id, kind, created_at DESC, id DESC)
  WHERE lifecycle = 'active';

CREATE INDEX relationship_items_scheduled_unreleased
  ON relationship_items (partnership_id, unlock_at, id)
  WHERE lifecycle = 'active'
    AND release_mode = 'scheduled'
    AND released_at IS NULL;
