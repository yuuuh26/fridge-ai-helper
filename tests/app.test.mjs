import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

test('tabs create three fridge types, keep legacy data, and isolate edits', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'https://example.test/fridge-ai-helper/' });
  const { window } = dom;
  globalThis.window = window;
  globalThis.document = window.document;
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
  globalThis.localStorage = window.localStorage;
  globalThis.FormData = window.FormData;
  globalThis.indexedDB = new IDBFactory();
  globalThis.IDBKeyRange = IDBKeyRange;
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function (value = '') {
    this.returnValue = value;
    this.open = false;
    this.dispatchEvent(new window.Event('close'));
  };

  await new Promise((resolve, reject) => {
    const request = indexedDB.open('fridge-ai-helper', 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore('ingredients', { keyPath: 'id' });
      store.createIndex('createdAt', 'createdAt');
      store.createIndex('normalizedName', 'normalizedName', { unique: true });
      store.put({
        id: 'legacy', name: '玉ねぎ', normalizedName: '玉ねぎ', selectionState: 'required',
        isFrozen: true, quantity: '2', unit: '回分', category: 'vegetable',
        createdAt: '2026-09-20T00:00:00Z'
      });
    };
    request.onsuccess = () => { request.result.close(); resolve(); };
    request.onerror = () => reject(request.error);
  });
  localStorage.setItem('fridge-ai-helper-seasoning-options-v1', JSON.stringify([{ id: 'soy', name: '醤油' }]));
  localStorage.setItem('fridge-ai-helper-seasoning-selected-v1', JSON.stringify(['soy']));

  await import('../app.js');
  const $ = selector => document.querySelector(selector);
  const waitFor = async predicate => {
    for (let attempt = 0; attempt < 120; attempt++) {
      if (predicate()) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('画面更新を待っても完了しませんでした');
  };
  const create = async (name, mode) => {
    $('#add-fridge-button').click();
    $('#new-fridge-name').value = name;
    $(`input[value="${mode}"]`).checked = true;
    $('#create-fridge-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await waitFor(() => $('.fridge-tab[aria-selected="true"]')?.textContent === name);
  };
  const switchTo = async name => {
    [...document.querySelectorAll('.fridge-tab')].find(tab => tab.textContent === name).click();
    await waitFor(() => $('.fridge-tab[aria-selected="true"]')?.textContent === name);
  };
  await waitFor(() => $('.ingredient-card')?.dataset.state === 'required');
  assert.equal($('.frozen-button').getAttribute('aria-pressed'), 'true');
  assert.equal($('.seasoning-option').getAttribute('aria-pressed'), 'true');

  await create('実家', 'full');
  assert.equal($('.ingredient-card').dataset.state, 'required');
  assert.equal($('.seasoning-option').getAttribute('aria-pressed'), 'true');
  $('.card-main').click();
  await waitFor(() => $('.ingredient-card').dataset.state === 'optional');
  await switchTo('自宅');
  assert.equal($('.ingredient-card').dataset.state, 'required');

  await create('友人宅', 'items');
  assert.equal($('.ingredient-card').dataset.state, 'none');
  assert.equal($('.frozen-button').getAttribute('aria-pressed'), 'true');
  assert.equal($('.seasoning-option').getAttribute('aria-pressed'), 'false');

  await create('別宅', 'empty');
  assert.equal(document.querySelectorAll('.ingredient-card').length, 0);
  assert.equal(document.querySelectorAll('.seasoning-option').length, 0);
  await switchTo('実家');
  assert.equal($('.ingredient-card').dataset.state, 'optional');
  assert.equal(document.querySelectorAll('.fridge-tab').length, 4);

  await create('祖父母宅', 'empty');
  assert.equal($('#add-fridge-button').hidden, true);
  $('#manage-fridge-button').click();
  $('#rename-fridge-name').value = '祖母宅';
  $('#rename-fridge-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => $('.fridge-tab[aria-selected="true"]')?.textContent === '祖母宅');
  $('#manage-fridge-button').click();
  $('#delete-fridge-button').click();
  $('#delete-fridge-dialog').close('confirm');
  await waitFor(() => document.querySelectorAll('.fridge-tab').length === 4);
  assert.equal($('#add-fridge-button').hidden, false);
  assert.equal($('.fridge-tab[aria-selected="true"]').textContent, '自宅');
  dom.window.close();
});
