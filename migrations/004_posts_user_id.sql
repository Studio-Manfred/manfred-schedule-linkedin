ALTER TABLE posts ADD COLUMN user_id uuid REFERENCES users(id);

ALTER TABLE schedule_slots ADD COLUMN user_id uuid REFERENCES users(id);

UPDATE posts SET user_id = (SELECT id FROM users WHERE email = 'jens@studiomanfred.com') WHERE user_id IS NULL;

UPDATE schedule_slots SET user_id = (SELECT id FROM users WHERE email = 'jens@studiomanfred.com') WHERE user_id IS NULL;

ALTER TABLE posts ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE schedule_slots ALTER COLUMN user_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS posts_user_due_idx ON posts (user_id, status, scheduled_at);
