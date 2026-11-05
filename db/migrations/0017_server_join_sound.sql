ALTER TABLE "servers" ADD COLUMN "join_sound_id" uuid;
--> statement-breakpoint
ALTER TABLE "servers" ADD CONSTRAINT "servers_join_sound_id_server_sounds_id_fk"
FOREIGN KEY ("join_sound_id") REFERENCES "public"."server_sounds"("id") ON DELETE SET NULL;
