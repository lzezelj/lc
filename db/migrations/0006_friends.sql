CREATE TYPE "public"."friendship_status" AS ENUM('pending', 'accepted');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "handle" text;--> statement-breakpoint
WITH numbered_users AS (
  SELECT id, lower(regexp_replace(name, '[^a-zA-Z0-9]+', '', 'g')) AS base, row_number() OVER (ORDER BY id) - 1 AS sequence
  FROM "users"
)
UPDATE "users"
SET "handle" = left(COALESCE(NULLIF(numbered_users.base, ''), 'user'), 24) || '.' || lpad((numbered_users.sequence % 10000)::text, 4, '0')
FROM numbered_users
WHERE "users".id = numbered_users.id;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_handle_unique" UNIQUE("handle");--> statement-breakpoint
CREATE TABLE "friendships" (
  "requester_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "recipient_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "status" "friendship_status" DEFAULT 'pending' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "accepted_at" timestamp with time zone,
  CONSTRAINT "friendships_requester_id_recipient_id_pk" PRIMARY KEY("requester_id", "recipient_id")
);--> statement-breakpoint
CREATE INDEX "friendships_recipient_idx" ON "friendships" USING btree ("recipient_id");--> statement-breakpoint
CREATE TABLE "direct_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "sender_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "recipient_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "content" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "direct_messages_timeline_idx" ON "direct_messages" USING btree ("sender_id", "recipient_id", "created_at");
