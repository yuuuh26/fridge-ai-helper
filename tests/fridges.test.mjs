import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareFridgeCopy } from '../fridges.js';

const source = {
  id: 'home', seasonings: [{ id: 'soy', name: '醤油' }],
  selectedSeasoningIds: ['soy']
};
const items = [{
  id: 'original', fridgeId: 'home', name: '玉ねぎ', normalizedName: '玉ねぎ',
  isFrozen: true, selectionState: 'required', category: 'vegetable',
  quantity: '2', unit: '回分', createdAt: '2026-09-20T00:00:00Z'
}];
const target = { id: 'other', name: '実家', createdAt: '2026-09-27T00:00:00Z' };

test('full copy preserves choices and freezer status without sharing records', () => {
  const copy = prepareFridgeCopy(source, items, target, 'full', () => 'copy-1');
  assert.deepEqual(copy.fridge.selectedSeasoningIds, ['soy']);
  assert.equal(copy.ingredients[0].selectionState, 'required');
  assert.equal(copy.ingredients[0].isFrozen, true);
  assert.equal(copy.ingredients[0].fridgeId, 'other');
  assert.notEqual(copy.ingredients[0].id, items[0].id);
  copy.fridge.seasonings[0].name = '塩';
  assert.equal(source.seasonings[0].name, '醤油');
});

test('item copy clears food and seasoning selections while retaining their names and frozen states', () => {
  const copy = prepareFridgeCopy(source, items, target, 'items', () => 'copy-1');
  assert.equal(copy.ingredients[0].selectionState, 'none');
  assert.equal(copy.ingredients[0].isFrozen, true);
  assert.equal(copy.ingredients[0].quantity, '2');
  assert.equal(copy.fridge.seasonings[0].name, '醤油');
  assert.deepEqual(copy.fridge.selectedSeasoningIds, []);
});

test('new fridge starts without food or seasonings', () => {
  const copy = prepareFridgeCopy(source, items, target, 'empty', () => 'unused');
  assert.deepEqual(copy.ingredients, []);
  assert.deepEqual(copy.fridge.seasonings, []);
  assert.deepEqual(copy.fridge.selectedSeasoningIds, []);
});
