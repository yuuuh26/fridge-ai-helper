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

test('ingredient formatting copies ingredient names only', () => {
  assert.equal(formatIngredient({ name: '鶏もも肉', quantity: '2', unit: '回分', isFrozen: true }), '・鶏もも肉');
  assert.equal(formatIngredient({ name: '塩', quantity: '', unit: '常時', isFrozen: false }), '・塩');
});

test('empty selection does not generate a prompt', () => {
  assert.equal(generateAiPrompt([{ name: '卵', selectionState: 'none' }]), '');
});

test('prompt includes only present classifications', () => {
  const prompt = generateAiPrompt([
    { name: '卵', quantity: '3', unit: '回分', isFrozen: false, selectionState: 'required' },
    { name: '玉ねぎ', quantity: '2', unit: '回分', isFrozen: true, selectionState: 'optional' },
    { name: '牛乳', quantity: '', unit: '', isFrozen: false, selectionState: 'none' }
  ]);
  assert.match(prompt, /【絶対に使ってほしい食材】/);
  assert.match(prompt, /・卵/);
  assert.doesNotMatch(prompt, /卵：3|3回分/);
  assert.match(prompt, /【冷蔵庫・冷凍庫にあるので/);
  assert.match(prompt, /・玉ねぎ/);
  assert.doesNotMatch(prompt, /玉ねぎ：2|2回分|冷凍中/);
  assert.doesNotMatch(prompt, /牛乳/);
});
