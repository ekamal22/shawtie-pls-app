ALTER TABLE account_devices
  ADD CONSTRAINT account_devices_id_account_unique
  UNIQUE (id, account_id);

ALTER TABLE account_sessions
  DROP CONSTRAINT account_sessions_device_id_fkey;

ALTER TABLE account_sessions
  ADD CONSTRAINT account_sessions_device_account_fk
  FOREIGN KEY (device_id, account_id)
  REFERENCES account_devices(id, account_id);

ALTER TABLE account_recovery_material
  DROP CONSTRAINT account_recovery_material_device_id_fkey;

ALTER TABLE account_recovery_material
  ADD CONSTRAINT account_recovery_material_device_account_fk
  FOREIGN KEY (device_id, account_id)
  REFERENCES account_devices(id, account_id);

CREATE FUNCTION enforce_partnership_member_limit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_count integer;
BEGIN
  PERFORM 1
  FROM partnerships
  WHERE id = NEW.partnership_id
  FOR UPDATE;

  SELECT count(*)
  INTO current_count
  FROM partnership_members
  WHERE partnership_id = NEW.partnership_id;

  IF current_count >= 2 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'partnership cannot contain more than two members';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER partnership_members_max_two
BEFORE INSERT ON partnership_members
FOR EACH ROW
EXECUTE FUNCTION enforce_partnership_member_limit();

ALTER TABLE breakup_processes
  ADD CONSTRAINT breakup_processes_id_partnership_unique
  UNIQUE (id, partnership_id);

ALTER TABLE breakup_restore_intents
  ADD CONSTRAINT breakup_restore_intents_process_partnership_fk
  FOREIGN KEY (breakup_process_id, partnership_id)
  REFERENCES breakup_processes(id, partnership_id)
  ON DELETE CASCADE;

ALTER TABLE messages
  ADD CONSTRAINT messages_id_conversation_unique
  UNIQUE (id, conversation_id);

ALTER TABLE messages
  DROP CONSTRAINT messages_reply_to_message_id_fkey;

ALTER TABLE messages
  ADD CONSTRAINT messages_reply_same_conversation_fk
  FOREIGN KEY (reply_to_message_id, conversation_id)
  REFERENCES messages(id, conversation_id);

ALTER TABLE messages
  DROP CONSTRAINT messages_sender_device_id_fkey;

ALTER TABLE messages
  ADD CONSTRAINT messages_sender_device_account_fk
  FOREIGN KEY (sender_device_id, sender_account_id)
  REFERENCES account_devices(id, account_id);

ALTER TABLE message_reactions
  ADD COLUMN partnership_id uuid;

UPDATE message_reactions AS reaction
SET partnership_id = message.partnership_id
FROM messages AS message
WHERE message.id = reaction.message_id;

ALTER TABLE message_reactions
  ALTER COLUMN partnership_id SET NOT NULL;

ALTER TABLE message_reactions
  ADD CONSTRAINT message_reactions_member_fk
  FOREIGN KEY (partnership_id, reactor_account_id)
  REFERENCES partnership_members(partnership_id, account_id);

ALTER TABLE message_receipts
  ADD COLUMN partnership_id uuid;

UPDATE message_receipts AS receipt
SET partnership_id = message.partnership_id
FROM messages AS message
WHERE message.id = receipt.message_id;

ALTER TABLE message_receipts
  ALTER COLUMN partnership_id SET NOT NULL;

ALTER TABLE message_receipts
  ADD CONSTRAINT message_receipts_member_fk
  FOREIGN KEY (partnership_id, account_id)
  REFERENCES partnership_members(partnership_id, account_id);

ALTER TABLE relationship_events
  ADD CONSTRAINT relationship_events_actor_member_fk
  FOREIGN KEY (partnership_id, actor_account_id)
  REFERENCES partnership_members(partnership_id, account_id);

ALTER TABLE call_sessions
  ADD CONSTRAINT call_sessions_id_partnership_unique
  UNIQUE (id, partnership_id);

ALTER TABLE call_participants
  ADD COLUMN partnership_id uuid;

UPDATE call_participants AS participant
SET partnership_id = session.partnership_id
FROM call_sessions AS session
WHERE session.id = participant.call_session_id;

ALTER TABLE call_participants
  ALTER COLUMN partnership_id SET NOT NULL;

ALTER TABLE call_participants
  ADD CONSTRAINT call_participants_session_partnership_fk
  FOREIGN KEY (call_session_id, partnership_id)
  REFERENCES call_sessions(id, partnership_id)
  ON DELETE CASCADE;

ALTER TABLE call_participants
  ADD CONSTRAINT call_participants_member_fk
  FOREIGN KEY (partnership_id, account_id)
  REFERENCES partnership_members(partnership_id, account_id);

ALTER TABLE call_events
  ADD COLUMN partnership_id uuid;

UPDATE call_events AS event
SET partnership_id = session.partnership_id
FROM call_sessions AS session
WHERE session.id = event.call_session_id;

ALTER TABLE call_events
  ALTER COLUMN partnership_id SET NOT NULL;

ALTER TABLE call_events
  ADD CONSTRAINT call_events_session_partnership_fk
  FOREIGN KEY (call_session_id, partnership_id)
  REFERENCES call_sessions(id, partnership_id)
  ON DELETE CASCADE;

ALTER TABLE call_events
  ADD CONSTRAINT call_events_actor_member_fk
  FOREIGN KEY (partnership_id, actor_account_id)
  REFERENCES partnership_members(partnership_id, account_id);
