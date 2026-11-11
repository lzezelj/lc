ALTER TABLE "channels" ADD COLUMN "position" integer;
--> statement-breakpoint
ALTER TABLE "server_members" ADD COLUMN "position" integer;
--> statement-breakpoint
WITH ranked AS (
  SELECT id, (row_number() OVER (
    PARTITION BY server_id, (type = 'text') ORDER BY created_at, id
  ) - 1)::integer AS position FROM channels
)
UPDATE channels SET position = ranked.position FROM ranked WHERE channels.id = ranked.id;
--> statement-breakpoint
WITH ranked AS (
  SELECT server_id, user_id, (row_number() OVER (
    PARTITION BY user_id ORDER BY joined_at, server_id
  ) - 1)::integer AS position FROM server_members
)
UPDATE server_members SET position = ranked.position FROM ranked
WHERE server_members.server_id = ranked.server_id AND server_members.user_id = ranked.user_id;
