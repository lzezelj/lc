CREATE TABLE "server_sounds" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "server_id" uuid NOT NULL REFERENCES "servers"("id") ON DELETE CASCADE,
  "name" text NOT NULL CHECK (char_length(btrim("name")) BETWEEN 1 AND 60),
  "audio" bytea NOT NULL CHECK (octet_length("audio") BETWEEN 44 AND 1048576),
  "duration_ms" integer NOT NULL CHECK ("duration_ms" BETWEEN 1 AND 5000),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "server_sounds_server_id_idx" ON "server_sounds" ("server_id");
