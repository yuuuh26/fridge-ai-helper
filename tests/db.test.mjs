import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { prepareFridgeCopy } from '../fridges.js';

await new Promise((resolve, reject) => {
  const request = indexedDB.open('fridge-ai-helper', 1);
  request.onupgradeneeded = () => {
    const store = request.result.createObjectStore('ingredients', { keyPath: 'id' });
    store.createIndex('createdAt', 'createdAt');
    store.createIndex('normalizedName', 'normalizedName', { unique: true });
    store.put({
      id: 'existing', name: '玉ねぎ', normalizedName: '玉ねぎ', selectionState: 'required',
      isFrozen: true, quantity: '2', unit: '回分', category: 'vegetable',
      createdAt: '2026-09-20T00:00:00Z'
    });
  };
  request.onsuccess = () => { request.result.close(); resolve(); };
  request.onerror = () => reject(request.error);
});

const {
  createFridge, deleteFridge, getAllIngredients, getDatabaseSnapshot, getFridges,
  replaceDatabaseSnapshot, saveIngredient, saveFridge
} = await import('../db.js');

test('v1 ingredients migrate into home without changing selection or frozen state', async () => {
  const [home] = await getFridges();
  assert.equal(home.id, 'home');
  const [ingredient] = await getAllIngredients('home');
  assert.equal(ingredient.id, 'existing');
  assert.equal(ingredient.selectionState, 'required');
  assert.equal(ingredient.isFrozen, true);
  assert.equal(ingredient.fridgeId, 'home');
});

test('copied ingredients and seasonings remain isolated and deletion is scoped', async () => {
  const [source] = await getFridges();
  const items = await getAllIngredients('home');
  const updated = { ...source, seasonings: [{ id: 'soy', name: '醤油' }], selectedSeasoningIds: ['soy'] };
  await saveFridge(updated);
  const { fridge, ingredients } = prepareFridgeCopy(
    updated, items, { id: 'other', name: '実家', createdAt: '2026-09-27T00:00:00Z' },
    'items', () => 'copied'
  );
  await createFridge(fridge, ingredients);
  assert.equal((await getAllIngredients('other'))[0].selectionState, 'none');
  assert.equal((await getAllIngredients('other'))[0].isFrozen, true);
  assert.deepEqual((await getFridges()).find(item => item.id === 'other').selectedSeasoningIds, []);
  await saveIngredient({ ...(await getAllIngredients('other'))[0], selectionState: 'optional' });
  assert.equal((await getAllIngredients('home'))[0].selectionState, 'required');
  await deleteFridge('other');
  assert.equal((await getAllIngredients('other')).length, 0);
  assert.equal((await getAllIngredients('home')).length, 1);
});

test('the same ingredient name is allowed in another fridge and the limit is five', async () => {
  for (let index = 1; index <= 4; index++) {
    const id = `fridge-${index}`;
    await createFridge({ id, name: id, createdAt: new Date().toISOString() }, []);
  }
  await saveIngredient({
    ...(await getAllIngredients('home'))[0],
    id: 'same-name-in-other-fridge',
    fridgeId: 'fridge-1'
  });
  assert.equal((await getAllIngredients('fridge-1')).length, 1);
  await assert.rejects(createFridge({
    id: 'sixth', name: '6個目', createdAt: new Date().toISOString()
  }));
  assert.equal((await getFridges()).length, 5);
});


test('backup snapshot replacement is complete and rolls back on constraint failure', async () => {
  const replacement = {
    fridges: [{
      id: 'home',
      name: '自宅',
      createdAt: '2026-10-01T00:00:00Z',
      seasonings: [{ id: 'miso', name: '味噌' }],
      selectedSeasoningIds: ['miso']
    }],
    ingredients: [{
      id: 'restored',
      fridgeId: 'home',
      name: '白菜',
      normalizedName: '白菜',
      selectionState: 'optional',
      category: 'vegetable',
      quantity: '2',
      unit: '回分',
      isFrozen: false,
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-01T00:00:00Z'
    }]
  };

  await replaceDatabaseSnapshot(replacement);
  const restored = await getDatabaseSnapshot();
  assert.equal(restored.fridges.length, 1);
  assert.equal(restored.ingredients.length, 1);
  assert.equal(restored.ingredients[0].name, '白菜');
  assert.deepEqual(restored.fridges[0].selectedSeasoningIds, ['miso']);

  const beforeFailure = JSON.stringify(restored);
  await assert.rejects(replaceDatabaseSnapshot({
    fridges: replacement.fridges,
    ingredients: [
      replacement.ingredients[0],
      { ...replacement.ingredients[0], id: 'duplicate-name' }
    ]
  }));

  assert.equal(JSON.stringify(await getDatabaseSnapshot()), beforeFailure);
});
