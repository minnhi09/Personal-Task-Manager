-- The first MVP used another name for the same UTC+07:00 region. Normalize
-- accounts that still have the initial default to Vietnam's canonical IANA ID.
UPDATE users
SET timezone = 'Asia/Ho_Chi_Minh'
WHERE timezone = 'Asia/Bangkok';

CREATE TABLE IF NOT EXISTS mobile_tokens (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS mobile_tokens_user_id_idx ON mobile_tokens(user_id);
CREATE INDEX IF NOT EXISTS mobile_tokens_expires_at_idx ON mobile_tokens(expires_at);
