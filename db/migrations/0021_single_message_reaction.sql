DELETE FROM channel_message_reactions a USING channel_message_reactions b
WHERE a.message_id = b.message_id AND a.user_id = b.user_id AND a.emoji COLLATE "C" > b.emoji COLLATE "C";
--> statement-breakpoint
DELETE FROM direct_message_reactions a USING direct_message_reactions b
WHERE a.message_id = b.message_id AND a.user_id = b.user_id AND a.emoji COLLATE "C" > b.emoji COLLATE "C";
--> statement-breakpoint
ALTER TABLE channel_message_reactions DROP CONSTRAINT channel_message_reactions_pkey;
--> statement-breakpoint
ALTER TABLE channel_message_reactions ADD CONSTRAINT channel_message_reactions_message_id_user_id_pk PRIMARY KEY (message_id, user_id);
--> statement-breakpoint
ALTER TABLE direct_message_reactions DROP CONSTRAINT direct_message_reactions_pkey;
--> statement-breakpoint
ALTER TABLE direct_message_reactions ADD CONSTRAINT direct_message_reactions_message_id_user_id_pk PRIMARY KEY (message_id, user_id);
