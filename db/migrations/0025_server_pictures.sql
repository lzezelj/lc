ALTER TABLE servers ADD COLUMN image text;
--> statement-breakpoint
CREATE TABLE server_pictures (
  server_id uuid PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
  data bytea NOT NULL CHECK (octet_length(data) BETWEEN 33 AND 524288)
);
