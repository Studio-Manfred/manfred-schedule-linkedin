CREATE TABLE IF NOT EXISTS posts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  body          text NOT NULL,
  images        jsonb NOT NULL DEFAULT '[]',
  status        text NOT NULL CHECK (status IN ('draft','queued','publishing','published','failed','missed')),
  pinned        boolean NOT NULL DEFAULT false,
  position      integer,
  scheduled_at  timestamptz,
  zernio_post_id text,
  linkedin_url  text,
  error         text,
  attempts      integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS posts_due_idx ON posts (status, scheduled_at);

CREATE TABLE IF NOT EXISTS schedule_slots (
  id         serial PRIMARY KEY,
  weekday    integer NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  time_local text NOT NULL CHECK (time_local ~ '^[0-2][0-9]:[0-5][0-9]$')
);
