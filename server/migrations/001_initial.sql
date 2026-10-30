CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name varchar(80) NOT NULL,
  username varchar(30) NOT NULL,
  email varchar(254) NOT NULL UNIQUE,
  password_hash text NOT NULL,
  bio varchar(120) NOT NULL DEFAULT '',
  interests text[] NOT NULL DEFAULT '{}',
  email_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_verification_codes (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  code_hash char(64) NOT NULL,
  expires_at timestamptz NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5)
);

CREATE INDEX IF NOT EXISTS users_email_verified_at_idx
  ON users(email_verified_at);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash varchar(64) NOT NULL PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS auth_sessions_expires_at_idx
  ON auth_sessions(expires_at);
