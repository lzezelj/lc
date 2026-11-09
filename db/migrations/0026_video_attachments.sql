ALTER TABLE message_attachments DROP CONSTRAINT attachment_size;
--> statement-breakpoint
ALTER TABLE message_attachments ADD CONSTRAINT attachment_size
CHECK (octet_length(data) BETWEEN 1 AND 26214400);
