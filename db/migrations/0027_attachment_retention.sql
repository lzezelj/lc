ALTER TABLE message_attachments ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
--> statement-breakpoint
UPDATE message_attachments a SET created_at = m.created_at FROM messages m WHERE m.id = a.message_id;
--> statement-breakpoint
UPDATE message_attachments a SET created_at = m.created_at FROM direct_messages m WHERE m.id = a.direct_message_id;
--> statement-breakpoint
CREATE INDEX message_attachments_created_idx ON message_attachments(created_at, id);
--> statement-breakpoint
CREATE FUNCTION lc_attachment_budget(incoming bigint, budget bigint DEFAULT 2147483648, low_water bigint DEFAULT 1610612736)
RETURNS uuid[] LANGUAGE plpgsql AS $$
DECLARE
  usage bigint;
  needed bigint;
  expired uuid[];
  recipients uuid[] := '{}';
BEGIN
  IF incoming < 0 OR incoming > budget OR budget <= 0 OR budget > 2147483648 OR low_water < 0 OR low_water >= budget THEN
    RAISE EXCEPTION 'LC_ATTACHMENT_STORAGE_FULL' USING ERRCODE = 'P0001';
  END IF;
  PERFORM pg_advisory_xact_lock(73492017);
  SELECT coalesce(sum(octet_length(data)), 0) INTO usage FROM message_attachments;
  IF usage + incoming <= budget THEN RETURN recipients; END IF;
  needed := greatest(usage - low_water, usage + incoming - budget);
  SELECT array_agg(id) INTO expired FROM (
    SELECT id, coalesce(sum(octet_length(data)) OVER (ORDER BY created_at, id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS previous_bytes
    FROM message_attachments WHERE created_at < now() - interval '30 days'
  ) candidates WHERE previous_bytes < needed;
  IF expired IS NOT NULL THEN
    SELECT array_agg(DISTINCT user_id) INTO recipients FROM (
      SELECT sm.user_id FROM message_attachments a JOIN messages m ON m.id = a.message_id
      JOIN channels c ON c.id = m.channel_id JOIN server_members sm ON sm.server_id = c.server_id WHERE a.id = ANY(expired)
      UNION SELECT m.sender_id FROM message_attachments a JOIN direct_messages m ON m.id = a.direct_message_id WHERE a.id = ANY(expired)
      UNION SELECT m.recipient_id FROM message_attachments a JOIN direct_messages m ON m.id = a.direct_message_id WHERE a.id = ANY(expired)
    ) audience;
    -- Match ordinary message-deletion lock order: message rows before byte rows.
    UPDATE messages m SET attachments = (
      SELECT jsonb_agg(CASE WHEN item->>'id' = ANY(expired::text[]) THEN item || '{"expired":true}'::jsonb ELSE item END ORDER BY ordinal)
      FROM jsonb_array_elements(m.attachments) WITH ORDINALITY AS parts(item, ordinal)
    ) WHERE m.id IN (SELECT message_id FROM message_attachments WHERE id = ANY(expired));
    UPDATE direct_messages m SET attachments = (
      SELECT jsonb_agg(CASE WHEN item->>'id' = ANY(expired::text[]) THEN item || '{"expired":true}'::jsonb ELSE item END ORDER BY ordinal)
      FROM jsonb_array_elements(m.attachments) WITH ORDINALITY AS parts(item, ordinal)
    ) WHERE m.id IN (SELECT direct_message_id FROM message_attachments WHERE id = ANY(expired));
    DELETE FROM message_attachments WHERE id = ANY(expired);
  END IF;
  SELECT coalesce(sum(octet_length(data)), 0) INTO usage FROM message_attachments;
  IF usage + incoming > budget THEN RAISE EXCEPTION 'LC_ATTACHMENT_STORAGE_FULL' USING ERRCODE = 'P0001'; END IF;
  RETURN coalesce(recipients, '{}'::uuid[]);
END;
$$;
--> statement-breakpoint
CREATE FUNCTION enforce_attachment_budget() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM lc_attachment_budget(octet_length(NEW.data));
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER attachment_global_budget BEFORE INSERT ON message_attachments
FOR EACH ROW EXECUTE FUNCTION enforce_attachment_budget();
