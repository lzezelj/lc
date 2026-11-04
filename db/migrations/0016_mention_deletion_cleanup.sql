CREATE FUNCTION clear_deleted_message_mentions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN
    DELETE FROM message_mentions WHERE message_id=NEW.id;
    NEW.mentions := '[]'::jsonb;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER messages_mention_cleanup BEFORE UPDATE OF deleted_at ON messages
FOR EACH ROW EXECUTE FUNCTION clear_deleted_message_mentions();
