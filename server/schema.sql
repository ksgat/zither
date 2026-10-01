CREATE TABLE IF NOT EXISTS desktop_grants (
  code_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  challenge text NOT NULL,
  redirect_uri text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS desktop_sessions (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS desktop_sessions_user ON desktop_sessions(user_id);
CREATE TABLE IF NOT EXISTS onshape_oauth_states (
  state_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS onshape_connections (
  user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  credentials text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
