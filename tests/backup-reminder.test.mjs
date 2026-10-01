import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BACKUP_CHANGE_COUNT_KEY,
  BACKUP_REMINDER_INTERVAL,
  isBackupRelevantIngredientChange,
  loadBackupChangeCount,
  saveBackupChangeCount,
  shouldShowBackupReminder
} from '../backup-reminder.js';

function createStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); }
  };
}

test('backup reminder fires every 15 significant changes', () => {
  assert.equal(BACKUP_REMINDER_INTERVAL, 15);
  assert.equal(shouldShowBackupReminder(14), false);
  assert.equal(shouldShowBackupReminder(15), true);
  assert.equal(shouldShowBackupReminder(16), false);
  assert.equal(shouldShowBackupReminder(30), true);
});

test('selection state changes are excluded but persistent ingredient edits count', () => {
  assert.equal(isBackupRelevantIngredientChange({ selectionState: 'required' }), false);
  assert.equal(isBackupRelevantIngredientChange({ selectionState: 'none', updatedAt: 'now' }), false);
  assert.equal(isBackupRelevantIngredientChange({ isFrozen: true }), true);
  assert.equal(isBackupRelevantIngredientChange({ quantity: '2' }), true);
  assert.equal(isBackupRelevantIngredientChange({ category: 'fish' }), true);
  assert.equal(isBackupRelevantIngredientChange({ unit: '常時' }), true);
});

test('change count persists and can be reset', () => {
  const storage = createStorage();
  assert.equal(loadBackupChangeCount(storage), 0);
  saveBackupChangeCount(storage, 14);
  assert.equal(storage.getItem(BACKUP_CHANGE_COUNT_KEY), '14');
  assert.equal(loadBackupChangeCount(storage), 14);
  saveBackupChangeCount(storage, 0);
  assert.equal(loadBackupChangeCount(storage), 0);
});
