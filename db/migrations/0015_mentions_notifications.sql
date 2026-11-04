ALTER TABLE messages ADD COLUMN mentions jsonb NOT NULL DEFAULT '[]'::jsonb;
CREATE TABLE message_mentions (
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notified_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (message_id,user_id)
);
CREATE INDEX message_mentions_user_idx ON message_mentions(user_id,notified_at);
CREATE TABLE channel_reads (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  message_at timestamptz NOT NULL DEFAULT now(),
  message_id uuid NOT NULL,
  PRIMARY KEY (user_id,channel_id)
);
CREATE TABLE direct_reads (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  message_at timestamptz NOT NULL DEFAULT now(),
  message_id uuid NOT NULL,
  PRIMARY KEY (user_id,friend_id)
);
-- Existing history starts read; subsequent messages persist across browser/device changes.
INSERT INTO channel_reads(user_id,channel_id,message_id)
SELECT sm.user_id,c.id,'00000000-0000-0000-0000-000000000000'::uuid
FROM server_members sm JOIN channels c ON c.server_id=sm.server_id WHERE c.type='text';
INSERT INTO direct_reads(user_id,friend_id,message_id)
SELECT requester_id,recipient_id,'00000000-0000-0000-0000-000000000000'::uuid FROM friendships WHERE status='accepted'
UNION ALL SELECT recipient_id,requester_id,'00000000-0000-0000-0000-000000000000'::uuid FROM friendships WHERE status='accepted';
CREATE TABLE server_notifications (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  messages boolean NOT NULL DEFAULT true,
  mentions boolean NOT NULL DEFAULT true,
  message_mute_until timestamptz,
  mention_mute_until timestamptz,
  PRIMARY KEY(user_id,server_id)
);
CREATE TABLE direct_notifications (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  messages boolean NOT NULL DEFAULT true,
  calls boolean NOT NULL DEFAULT true,
  message_mute_until timestamptz,
  call_mute_until timestamptz,
  PRIMARY KEY(user_id,friend_id)
);
