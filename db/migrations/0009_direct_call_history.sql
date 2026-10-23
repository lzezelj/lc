ALTER TABLE "direct_messages" ADD COLUMN "kind" text DEFAULT 'message' NOT NULL;
ALTER TABLE "direct_messages" ADD COLUMN "call_duration_seconds" integer;
