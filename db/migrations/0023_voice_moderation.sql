ALTER TABLE server_members ADD COLUMN voice_muted boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE server_members ADD COLUMN voice_deafened boolean NOT NULL DEFAULT false;
