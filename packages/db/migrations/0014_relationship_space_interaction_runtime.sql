CREATE TABLE relationship_item_references (
  id uuid PRIMARY KEY,
  partnership_id uuid NOT NULL,
  item_id uuid NOT NULL,
  reference_type text NOT NULL,
  reference_id uuid NOT NULL,
  role text NOT NULL,
  position integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT relationship_reference_item_fk
    FOREIGN KEY (item_id, partnership_id)
    REFERENCES relationship_items(id, partnership_id)
    ON DELETE CASCADE,
  CONSTRAINT relationship_reference_shape
    CHECK (
      (reference_type = 'message' AND role = 'source')
      OR
      (reference_type = 'media' AND role IN ('attachment', 'voice_letter'))
    ),
  CONSTRAINT relationship_reference_position_valid
    CHECK (position BETWEEN 0 AND 31),
  UNIQUE (item_id, role, position),
  UNIQUE (item_id, reference_type, reference_id, role)
);

CREATE INDEX relationship_item_references_external
  ON relationship_item_references (reference_type, reference_id);

CREATE TABLE relationship_item_links (
  partnership_id uuid NOT NULL,
  owner_item_id uuid NOT NULL,
  target_item_id uuid NOT NULL,
  link_type text NOT NULL,
  position integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_item_id, link_type, position),
  CONSTRAINT relationship_item_link_owner_fk
    FOREIGN KEY (owner_item_id, partnership_id)
    REFERENCES relationship_items(id, partnership_id)
    ON DELETE CASCADE,
  CONSTRAINT relationship_item_link_target_fk
    FOREIGN KEY (target_item_id, partnership_id)
    REFERENCES relationship_items(id, partnership_id)
    ON DELETE RESTRICT,
  CONSTRAINT relationship_item_link_type_valid
    CHECK (link_type IN ('curation', 'prepared_content')),
  CONSTRAINT relationship_item_link_position_valid
    CHECK (position BETWEEN 0 AND 99),
  CONSTRAINT relationship_item_link_not_self
    CHECK (owner_item_id <> target_item_id),
  UNIQUE (owner_item_id, link_type, target_item_id)
);

CREATE INDEX relationship_item_links_target
  ON relationship_item_links (target_item_id, owner_item_id);

CREATE TABLE relationship_story_members (
  partnership_id uuid NOT NULL,
  item_id uuid NOT NULL,
  added_by_account_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (partnership_id, item_id),
  CONSTRAINT relationship_story_item_fk
    FOREIGN KEY (item_id, partnership_id)
    REFERENCES relationship_items(id, partnership_id)
    ON DELETE CASCADE
);

CREATE FUNCTION validate_relationship_item_link_owner_kind()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  owner_kind text;
BEGIN
  SELECT kind
  INTO owner_kind
  FROM relationship_items
  WHERE id = NEW.owner_item_id
    AND partnership_id = NEW.partnership_id;

  IF NEW.link_type = 'curation'
     AND owner_kind NOT IN ('our_year', 'anniversary') THEN
    RAISE EXCEPTION 'curation link owner kind is invalid';
  END IF;

  IF NEW.link_type = 'prepared_content'
     AND owner_kind <> 'reunion' THEN
    RAISE EXCEPTION 'prepared_content link owner must be reunion';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER relationship_item_links_owner_kind
BEFORE INSERT OR UPDATE ON relationship_item_links
FOR EACH ROW
EXECUTE FUNCTION validate_relationship_item_link_owner_kind();

CREATE FUNCTION validate_relationship_story_actor_membership()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.added_by_account_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM partnership_members
       WHERE partnership_id = NEW.partnership_id
         AND account_id = NEW.added_by_account_id
         AND released_at IS NULL
     ) THEN
    RAISE EXCEPTION 'relationship story actor must be a current partnership member';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER relationship_story_actor_membership
BEFORE INSERT OR UPDATE ON relationship_story_members
FOR EACH ROW
EXECUTE FUNCTION validate_relationship_story_actor_membership();

ALTER TABLE relationship_events
  DROP CONSTRAINT relationship_events_item_id_fkey,
  ADD CONSTRAINT relationship_events_item_fk
    FOREIGN KEY (item_id, partnership_id)
    REFERENCES relationship_items(id, partnership_id)
    ON DELETE CASCADE,
  ADD CONSTRAINT relationship_events_item_version_positive
    CHECK (item_version IS NULL OR item_version > 0) NOT VALID;

CREATE FUNCTION validate_relationship_event_actor_membership()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.actor_account_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM partnership_members
       WHERE partnership_id = NEW.partnership_id
         AND account_id = NEW.actor_account_id
         AND released_at IS NULL
     ) THEN
    RAISE EXCEPTION 'relationship event actor must be a current partnership member';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER relationship_events_actor_membership
BEFORE INSERT ON relationship_events
FOR EACH ROW
EXECUTE FUNCTION validate_relationship_event_actor_membership();

CREATE FUNCTION reject_relationship_event_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'relationship_events rows are append-only while retained';
END;
$$;

CREATE TRIGGER relationship_events_no_update
BEFORE UPDATE ON relationship_events
FOR EACH ROW
EXECUTE FUNCTION reject_relationship_event_update();
