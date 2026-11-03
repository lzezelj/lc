ALTER TABLE "server_sounds" DROP CONSTRAINT "server_sounds_audio_check";
--> statement-breakpoint
ALTER TABLE "server_sounds" ADD CONSTRAINT "server_sounds_audio_check" CHECK (octet_length("audio") BETWEEN 44 AND 2097152);
--> statement-breakpoint
ALTER TABLE "server_sounds" DROP CONSTRAINT "server_sounds_duration_ms_check";
--> statement-breakpoint
ALTER TABLE "server_sounds" ADD CONSTRAINT "server_sounds_duration_ms_check" CHECK ("duration_ms" BETWEEN 1 AND 10000);
