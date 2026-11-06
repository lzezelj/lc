CREATE TABLE server_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  inviter_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT server_invitations_distinct_people CHECK (inviter_id <> recipient_id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX server_invitations_server_recipient_unique ON server_invitations(server_id, recipient_id);
--> statement-breakpoint
CREATE INDEX server_invitations_recipient_idx ON server_invitations(recipient_id);
--> statement-breakpoint
CREATE INDEX server_invitations_inviter_idx ON server_invitations(inviter_id);
