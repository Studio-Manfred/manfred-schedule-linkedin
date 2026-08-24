CREATE TABLE IF NOT EXISTS users (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  google_sub         text UNIQUE,
  email              text UNIQUE NOT NULL,
  name               text,
  zernio_api_key_enc text,
  zernio_account_id  text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

INSERT INTO users (email, name) VALUES ('jens@studiomanfred.com', 'Jens')
  ON CONFLICT (email) DO NOTHING;
