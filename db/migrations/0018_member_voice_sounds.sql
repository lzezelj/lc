ALTER TABLE "server_members" ADD COLUMN "join_sound_id" uuid;
--> statement-breakpoint
ALTER TABLE "server_members" ADD COLUMN "leave_sound_id" uuid;
--> statement-breakpoint
UPDATE "server_members" AS member SET "join_sound_id" = server."join_sound_id"
FROM "servers" AS server WHERE server.id = member.server_id;
--> statement-breakpoint
ALTER TABLE "server_members" ADD CONSTRAINT "server_members_join_sound_id_server_sounds_id_fk"
FOREIGN KEY ("join_sound_id") REFERENCES "public"."server_sounds"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "server_members" ADD CONSTRAINT "server_members_leave_sound_id_server_sounds_id_fk"
FOREIGN KEY ("leave_sound_id") REFERENCES "public"."server_sounds"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "servers" DROP COLUMN "join_sound_id";
