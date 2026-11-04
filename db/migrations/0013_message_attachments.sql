ALTER TABLE messages ADD COLUMN attachments jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE direct_messages ADD COLUMN attachments jsonb NOT NULL DEFAULT '[]'::jsonb;
CREATE TABLE message_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uploader_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id uuid REFERENCES messages(id) ON DELETE CASCADE,
  direct_message_id uuid REFERENCES direct_messages(id) ON DELETE CASCADE,
  data bytea NOT NULL,
  CONSTRAINT attachment_one_message CHECK (num_nonnulls(message_id, direct_message_id) = 1),
  CONSTRAINT attachment_size CHECK (octet_length(data) BETWEEN 1 AND 10485760)
);
CREATE INDEX message_attachments_uploader_idx ON message_attachments(uploader_id);
CREATE INDEX message_attachments_message_idx ON message_attachments(message_id);
CREATE INDEX message_attachments_direct_idx ON message_attachments(direct_message_id);
CREATE FUNCTION remove_deleted_message_attachments() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN
    IF TG_TABLE_NAME = 'messages' THEN
      DELETE FROM message_attachments WHERE message_id = NEW.id;
    ELSE
      DELETE FROM message_attachments WHERE direct_message_id = NEW.id;
    END IF;
    NEW.attachments := '[]'::jsonb;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER messages_attachment_cleanup BEFORE UPDATE OF deleted_at ON messages
FOR EACH ROW EXECUTE FUNCTION remove_deleted_message_attachments();
CREATE TRIGGER direct_messages_attachment_cleanup BEFORE UPDATE OF deleted_at ON direct_messages
FOR EACH ROW EXECUTE FUNCTION remove_deleted_message_attachments();
