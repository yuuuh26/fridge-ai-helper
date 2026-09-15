import test from 'node:test';
import assert from 'node:assert/strict';
import { formatIngredient, generateAiPrompt, nextSelectionState, normalizeIngredientName } from '../utils.js';

test('selection state cycles in the specified order', () => {
  assert.equal(nextSelectionState('none'), 'optional');
  assert.equal(nextSelectionState('optional'), 'required');
  assert.equal(nextSelectionState('required'), 'none');
});

test('ingredient names are normalized for duplicate checks', () => {
  assert.equal(normalizeIngredientName('  玉ねぎ  '), '玉ねぎ');
  assert.equal(normalizeIngredientName('ＡＢＣ'), 'abc');
});

test('ingredient formatting omits stock mode labels from copied text', () => {
  assert.equal(formatIngredient({ name: '鶏もも肉', quantity: '2', unit: '回', isFrozen: true }), '・鶏もも肉：2（冷凍中）');
  assert.equal(formatIngredient({ name: '塩', quantity: '', unit: '常時', isFrozen: false }), '・塩');
});

test('empty selection does not generate a prompt', () => {
  assert.equal(generateAiPrompt([{ name: '卵', selectionState: 'none' }]), '');
});

test('prompt includes only present classifications', () => {
  const prompt = generateAiPrompt([
    { name: '卵', quantity: '4', unit: '回', isFrozen: false, selectionState: 'required' },
    { name: '玉ねぎ', quantity: '2', unit: '回', isFrozen: false, selectionState: 'optional' },
    { name: '牛乳', quantity: '', unit: '', isFrozen: false, selectionState: 'none' }
  ]);
  assert.match(prompt, /【絶対に使ってほしい食材】/);
  assert.match(prompt, /・卵：4/);
  assert.doesNotMatch(prompt, /4回/);
  assert.match(prompt, /【冷蔵庫・冷凍庫にあるので/);
  assert.match(prompt, /・玉ねぎ：2/);
  assert.doesNotMatch(prompt, /2回/);
  assert.doesNotMatch(prompt, /牛乳/);
});
