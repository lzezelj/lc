CREATE TABLE "channel_message_reactions" (
  "message_id" uuid NOT NULL REFERENCES "messages"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "emoji" text NOT NULL CHECK (char_length("emoji") BETWEEN 1 AND 32),
  PRIMARY KEY ("message_id", "user_id", "emoji")
);
--> statement-breakpoint
CREATE TABLE "direct_message_reactions" (
  "message_id" uuid NOT NULL REFERENCES "direct_messages"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "emoji" text NOT NULL CHECK (char_length("emoji") BETWEEN 1 AND 32),
  PRIMARY KEY ("message_id", "user_id", "emoji")
);
--> statement-breakpoint
CREATE FUNCTION clear_deleted_message_reactions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN
    IF TG_TABLE_NAME = 'messages' THEN DELETE FROM channel_message_reactions WHERE message_id = NEW.id;
    ELSE DELETE FROM direct_message_reactions WHERE message_id = NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER clear_channel_reactions AFTER UPDATE OF deleted_at ON messages FOR EACH ROW EXECUTE FUNCTION clear_deleted_message_reactions();
--> statement-breakpoint
CREATE TRIGGER clear_direct_reactions AFTER UPDATE OF deleted_at ON direct_messages FOR EACH ROW EXECUTE FUNCTION clear_deleted_message_reactions();
