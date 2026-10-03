-- Run on a NEW shared database. Preserves this app's existing retention policy.
CREATE TABLE fridge_ai_helper_auth_attempts (
  ip_hash TEXT NOT NULL,
  bucket INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY(ip_hash,bucket)
);
CREATE TABLE fridge_ai_helper_auth_config (
  app_id TEXT PRIMARY KEY CHECK(app_id='fridge-ai-helper'),
  key_sha256 TEXT NOT NULL
);
CREATE TABLE fridge_ai_helper_auth_sessions (
  session_id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  token_sha256 TEXT NOT NULL UNIQUE,
  device_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE TABLE fridge_ai_helper_backup_chunks (
  backup_id TEXT NOT NULL REFERENCES fridge_ai_helper_backups(backup_id),
  chunk_index INTEGER NOT NULL CHECK(chunk_index>=0),
  backup_json TEXT NOT NULL,
  PRIMARY KEY(backup_id,chunk_index)
);
CREATE TABLE fridge_ai_helper_backup_retention (
  backup_id TEXT PRIMARY KEY REFERENCES fridge_ai_helper_backups(backup_id) ON DELETE CASCADE,
  app_id TEXT NOT NULL CHECK(app_id='fridge-ai-helper'),
  verified_at TEXT,
  version_number INTEGER,
  UNIQUE(app_id,version_number),
  CHECK((verified_at IS NULL AND version_number IS NULL) OR (verified_at IS NOT NULL AND version_number>0))
);
CREATE TABLE fridge_ai_helper_backups (
  backup_id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL CHECK(app_id='fridge-ai-helper'),
  schema_version INTEGER NOT NULL CHECK(schema_version=1),
  created_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  device_id TEXT,
  record_count INTEGER NOT NULL CHECK(record_count>=0),
  source_revision INTEGER NOT NULL CHECK(source_revision>=0),
  sha256 TEXT NOT NULL,
  byte_length INTEGER NOT NULL CHECK(byte_length>0),
  chunk_count INTEGER NOT NULL CHECK(chunk_count BETWEEN 1 AND 42)
);
CREATE INDEX fridge_ai_helper_auth_sessions_app ON fridge_ai_helper_auth_sessions(app_id, revoked_at);
CREATE INDEX fridge_ai_helper_backups_history ON fridge_ai_helper_backups(app_id,received_at DESC,backup_id DESC);
CREATE TRIGGER fridge_ai_helper_backups_no_delete BEFORE DELETE ON fridge_ai_helper_backups
WHEN OLD.backup_id NOT IN (
  SELECT b.backup_id FROM fridge_ai_helper_backups b JOIN fridge_ai_helper_backup_retention r ON r.backup_id=b.backup_id
  WHERE b.app_id=OLD.app_id AND r.version_number IS NOT NULL
  ORDER BY r.version_number DESC LIMIT -1 OFFSET 3
) BEGIN SELECT RAISE(ABORT,'protected backup'); END;
CREATE TRIGGER fridge_ai_helper_backups_no_update BEFORE UPDATE ON fridge_ai_helper_backups BEGIN SELECT RAISE(ABORT,'immutable backup'); END;
CREATE TRIGGER fridge_ai_helper_chunks_no_delete BEFORE DELETE ON fridge_ai_helper_backup_chunks
WHEN OLD.backup_id NOT IN (
  SELECT b.backup_id FROM fridge_ai_helper_backups b JOIN fridge_ai_helper_backup_retention r ON r.backup_id=b.backup_id
  WHERE b.app_id='fridge-ai-helper' AND r.version_number IS NOT NULL
  ORDER BY r.version_number DESC LIMIT -1 OFFSET 3
) BEGIN SELECT RAISE(ABORT,'protected backup'); END;
CREATE TRIGGER fridge_ai_helper_chunks_no_update BEFORE UPDATE ON fridge_ai_helper_backup_chunks BEGIN SELECT RAISE(ABORT,'immutable backup'); END;
