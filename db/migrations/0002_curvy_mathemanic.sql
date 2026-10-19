CREATE TYPE "public"."channel_type" AS ENUM('text', 'voice');--> statement-breakpoint
ALTER TYPE "public"."room_role" RENAME TO "server_role";--> statement-breakpoint
CREATE TABLE "channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "channel_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "room_members" RENAME TO "server_members";--> statement-breakpoint
ALTER TABLE "rooms" RENAME TO "servers";--> statement-breakpoint
ALTER TABLE "server_members" RENAME COLUMN "room_id" TO "server_id";--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "messages_room_id_rooms_id_fk";
--> statement-breakpoint
ALTER TABLE "server_members" DROP CONSTRAINT "room_members_room_id_rooms_id_fk";
--> statement-breakpoint
ALTER TABLE "server_members" DROP CONSTRAINT "room_members_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "servers" DROP CONSTRAINT "rooms_created_by_users_id_fk";
--> statement-breakpoint
DROP INDEX "messages_room_timeline_idx";--> statement-breakpoint
DROP INDEX "room_members_user_id_idx";--> statement-breakpoint
DROP INDEX "rooms_created_by_idx";--> statement-breakpoint
ALTER TABLE "server_members" DROP CONSTRAINT "room_members_room_id_user_id_pk";--> statement-breakpoint
ALTER TABLE "server_members" ADD CONSTRAINT "server_members_server_id_user_id_pk" PRIMARY KEY("server_id","user_id");--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "channel_id" uuid;--> statement-breakpoint
INSERT INTO "channels" ("server_id", "name", "type")
SELECT "id", 'general', 'text'::"channel_type" FROM "servers";--> statement-breakpoint
INSERT INTO "channels" ("server_id", "name", "type")
SELECT "id", 'Lounge', 'voice'::"channel_type" FROM "servers";--> statement-breakpoint
UPDATE "messages"
SET "channel_id" = "channels"."id"
FROM "channels"
WHERE "channels"."server_id" = "messages"."room_id"
	AND "channels"."name" = 'general'
	AND "channels"."type" = 'text';--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "channel_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "channels_server_id_idx" ON "channels" USING btree ("server_id");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_members" ADD CONSTRAINT "server_members_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_members" ADD CONSTRAINT "server_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "servers" ADD CONSTRAINT "servers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_channel_timeline_idx" ON "messages" USING btree ("channel_id","created_at","id");--> statement-breakpoint
CREATE INDEX "server_members_user_id_idx" ON "server_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "servers_created_by_idx" ON "servers" USING btree ("created_by");--> statement-breakpoint
ALTER TABLE "messages" DROP COLUMN "room_id";
