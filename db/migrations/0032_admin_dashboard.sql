CREATE TABLE "admin_audit_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "actor_id" uuid NOT NULL,
  "action" text NOT NULL,
  "target_type" text NOT NULL,
  "target_id" uuid NOT NULL,
  "user_id" uuid,
  "server_id" uuid,
  "channel_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "admin_audit_created_idx" ON "admin_audit_log" ("created_at", "id");
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "edited_by_admin" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "direct_messages" ADD COLUMN "edited_by_admin" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE INDEX "messages_author_timeline_idx" ON "messages" ("author_id", "created_at", "id");
