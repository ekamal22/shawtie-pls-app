ALTER TABLE messages
  DROP CONSTRAINT messages_m1_content_shape,
  ADD CONSTRAINT messages_m3_content_shape
    CHECK (
      (deleted_at IS NOT NULL AND body_text IS NULL AND ciphertext IS NULL)
      OR
      (
        deleted_at IS NULL
        AND num_nonnulls(body_text, ciphertext) <= 1
        AND (ciphertext IS NULL OR ciphertext_version IS NOT NULL)
      )
    );

CREATE FUNCTION validate_media_binding_target()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_partnership uuid;
BEGIN
  IF NEW.binding_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.binding_type = 'message' THEN
    SELECT partnership_id INTO target_partnership
    FROM messages
    WHERE id = NEW.binding_id;
  ELSIF NEW.binding_type = 'relationship_item' THEN
    SELECT partnership_id INTO target_partnership
    FROM relationship_items
    WHERE id = NEW.binding_id AND lifecycle = 'active';
  END IF;

  IF target_partnership IS NULL OR target_partnership <> NEW.partnership_id THEN
    RAISE EXCEPTION 'media binding target must exist in the same partnership';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER media_objects_binding_target
BEFORE INSERT OR UPDATE OF state, binding_type, binding_id, binding_role, binding_position
ON media_objects
FOR EACH ROW
WHEN (NEW.binding_id IS NOT NULL)
EXECUTE FUNCTION validate_media_binding_target();

CREATE INDEX media_objects_message_binding
  ON media_objects (binding_id, binding_position, id)
  WHERE state = 'bound' AND binding_type = 'message';

CREATE INDEX media_objects_relationship_binding
  ON media_objects (binding_id, binding_position, id)
  WHERE state = 'bound' AND binding_type = 'relationship_item';

CREATE FUNCTION validate_m3_message_nonempty()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.deleted_at IS NULL
     AND NEW.body_text IS NULL
     AND NEW.ciphertext IS NULL
     AND NOT EXISTS (
       SELECT 1
       FROM media_objects media
       WHERE media.binding_type = 'message'
         AND media.binding_id = NEW.id
         AND media.state = 'bound'
         AND media.deleted_at IS NULL
     ) THEN
    RAISE EXCEPTION 'active message must contain text/ciphertext or bound media';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER messages_m3_nonempty_at_commit
AFTER INSERT OR UPDATE OF body_text, ciphertext, deleted_at ON messages
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION validate_m3_message_nonempty();
