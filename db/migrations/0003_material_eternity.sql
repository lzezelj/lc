ALTER TABLE "channels" ALTER COLUMN "type" SET DATA TYPE text;--> statement-breakpoint
UPDATE "channels" SET "type" = 'voice_direct' WHERE "type" = 'voice';--> statement-breakpoint
DROP TYPE "public"."channel_type";--> statement-breakpoint
CREATE TYPE "public"."channel_type" AS ENUM('text', 'voice_direct', 'voice_group');--> statement-breakpoint
ALTER TABLE "channels" ALTER COLUMN "type" SET DATA TYPE "public"."channel_type" USING "type"::"public"."channel_type";
