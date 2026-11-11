ALTER TABLE "servers" ADD COLUMN "afk_channel_id" uuid;
--> statement-breakpoint
ALTER TABLE "servers" ADD CONSTRAINT "servers_afk_channel_id_channels_id_fk" FOREIGN KEY ("afk_channel_id") REFERENCES "public"."channels"("id") ON DELETE SET NULL;
