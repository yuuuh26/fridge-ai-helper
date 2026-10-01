import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BACKUP_APP_ID,
  BACKUP_SCHEMA_VERSION,
  createBackupPayload,
  parseBackupText,
  validateBackupPayload
} from '../backup.js';

const fridge = {
  id: 'home',
  name: '自宅',
  createdAt: '2026-10-01T00:00:00Z',
  seasonings: [{ id: 'soy', name: '醤油' }],
  selectedSeasoningIds: ['soy']
};

const ingredient = {
  id: 'ingredient-1',
  fridgeId: 'home',
  name: '玉ねぎ',
  normalizedName: '玉ねぎ',
  selectionState: 'required',
  category: 'vegetable',
  quantity: '2',
  unit: '回分',
  isFrozen: true,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z'
};

test('backup payload round-trips all application data', () => {
  const payload = createBackupPayload({
    fridges: [fridge],
    ingredients: [ingredient],
    activeFridgeId: 'home',
    exportedAt: '2026-10-01T12:00:00Z'
  });
  const parsed = parseBackupText(JSON.stringify(payload));

  assert.equal(parsed.app, BACKUP_APP_ID);
  assert.equal(parsed.schemaVersion, BACKUP_SCHEMA_VERSION);
  assert.equal(parsed.activeFridgeId, 'home');
  assert.deepEqual(parsed.fridges[0].seasonings, fridge.seasonings);
  assert.deepEqual(parsed.fridges[0].selectedSeasoningIds, ['soy']);
  assert.equal(parsed.ingredients[0].selectionState, 'required');
  assert.equal(parsed.ingredients[0].isFrozen, true);
});

test('invalid or unrelated JSON backups are rejected', () => {
  assert.throws(
    () => parseBackupText('{broken'),
    /JSONファイルを読み取れませんでした/
  );
  assert.throws(
    () => validateBackupPayload({
      app: 'another-app',
      schemaVersion: 1,
      fridges: [fridge],
      ingredients: [ingredient]
    }),
    /冷蔵庫AIヘルパーのバックアップではありません/
  );
});

test('duplicate ingredient names in the same fridge are rejected', () => {
  assert.throws(
    () => validateBackupPayload({
      app: BACKUP_APP_ID,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: '2026-10-01T12:00:00Z',
      activeFridgeId: 'home',
      fridges: [fridge],
      ingredients: [
        ingredient,
        { ...ingredient, id: 'ingredient-2' }
      ]
    }),
    /同じ冷蔵庫内で重複/
  );
});
