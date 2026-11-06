CREATE TABLE user_avatars (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data bytea NOT NULL CHECK (octet_length(data) BETWEEN 33 AND 524288)
);
--> statement-breakpoint
CREATE FUNCTION clear_removed_avatar() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.image IS NULL THEN DELETE FROM user_avatars WHERE user_id = NEW.id; END IF;
  RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER clear_removed_user_avatar AFTER UPDATE OF image ON users
FOR EACH ROW EXECUTE FUNCTION clear_removed_avatar();
