CREATE TABLE IF NOT EXISTS users (id uuid PRIMARY KEY, email text UNIQUE NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS sessions (token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS challenges (email text PRIMARY KEY, code_hash text NOT NULL, expires_at timestamptz NOT NULL, sent_at timestamptz NOT NULL DEFAULT now(), attempts integer NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS rate_limits (key text PRIMARY KEY, count integer NOT NULL, resets_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS pets (user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, name text NOT NULL, model text NOT NULL CHECK(model IN ('toon','vuena')), personality text NOT NULL DEFAULT '', photo_id uuid, version integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS memories (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES pets(user_id) ON DELETE CASCADE, text text NOT NULL, position integer NOT NULL);
CREATE TABLE IF NOT EXISTS photos (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, storage_key text UNIQUE NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS deletion_queue (storage_key text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS photos_owner ON photos(user_id);

-- Additive and repeatable for existing installations.
ALTER TABLE pets ADD COLUMN IF NOT EXISTS appearance jsonb;

-- Rule-based virtual life; cascading deletion keeps diary separate from real memories.
CREATE TABLE IF NOT EXISTS pet_life (
  user_id uuid PRIMARY KEY REFERENCES pets(user_id) ON DELETE CASCADE,
  last_slot bigint NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pet_life_events (
  user_id uuid NOT NULL REFERENCES pet_life(user_id) ON DELETE CASCADE,
  slot bigint NOT NULL,
  action text NOT NULL CHECK(action IN ('sleep','walk','groom','play','window')),
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY(user_id,slot)
);

ALTER TABLE pets ADD COLUMN IF NOT EXISTS appearance_asset text;
