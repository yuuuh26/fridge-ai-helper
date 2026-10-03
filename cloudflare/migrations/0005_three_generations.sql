-- Change only the retention guard. Existing data remains intact until a
-- new backup is stored, read back and verified by the Worker.
DROP TRIGGER IF EXISTS backups_no_delete;
DROP TRIGGER IF EXISTS chunks_no_delete;
CREATE TRIGGER backups_no_delete BEFORE DELETE ON backups
WHEN OLD.backup_id NOT IN (
  SELECT b.backup_id FROM backups b JOIN backup_retention r ON r.backup_id=b.backup_id
  WHERE b.app_id=OLD.app_id AND r.version_number IS NOT NULL
  ORDER BY r.version_number DESC LIMIT -1 OFFSET 3
) BEGIN SELECT RAISE(ABORT,'protected backup'); END;
CREATE TRIGGER chunks_no_delete BEFORE DELETE ON backup_chunks
WHEN OLD.backup_id NOT IN (
  SELECT b.backup_id FROM backups b JOIN backup_retention r ON r.backup_id=b.backup_id
  WHERE b.app_id='fridge-ai-helper' AND r.version_number IS NOT NULL
  ORDER BY r.version_number DESC LIMIT -1 OFFSET 3
) BEGIN SELECT RAISE(ABORT,'protected backup'); END;
