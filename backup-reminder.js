export const BACKUP_REMINDER_INTERVAL = 15;
export const BACKUP_CHANGE_COUNT_KEY = 'fridge-ai-helper-backup-change-count-v1';

export function loadBackupChangeCount(storage) {
  try {
    const value = Number(storage?.getItem(BACKUP_CHANGE_COUNT_KEY));
    return Number.isInteger(value) && value >= 0 ? value : 0;
  } catch {
    return 0;
  }
}

export function saveBackupChangeCount(storage, count) {
  const safeCount = Number.isInteger(count) && count >= 0 ? count : 0;
  try {
    storage?.setItem(BACKUP_CHANGE_COUNT_KEY, String(safeCount));
  } catch {
    // Reminder state is non-critical; the app data itself remains in IndexedDB.
  }
  return safeCount;
}

export function shouldShowBackupReminder(count) {
  return count > 0 && count % BACKUP_REMINDER_INTERVAL === 0;
}

export function isBackupRelevantIngredientChange(changes) {
  return Object.keys(changes || {}).some(key => key !== 'selectionState' && key !== 'updatedAt');
}
