import { getAllIngredients, removeIngredient, saveIngredient } from './db.js';
import { generateAiPrompt, nextSelectionState, normalizeIngredientName } from './utils.js';

const PUBLIC_URL = 'https://yuuuh26.github.io/fridge-ai-helper/';
const STOCK_MODES = ['回', '常時'];
const stateLabels = { none: '未選択', optional: '使ってもOK', required: '必ず使う' };
const stateIcons = { none: '○', optional: '●', required: '●' };

const elements = {
  addForm: document.querySelector('#add-form'),
  nameInput: document.querySelector('#ingredient-name'),
  list: document.querySelector('#ingredient-list'),
  emptyState: document.querySelector('#empty-state'),
  requiredSummary: document.querySelector('#required-summary'),
  optionalSummary: document.querySelector('#optional-summary'),
  selectedCount: document.querySelector('#selected-count'),
  copyButton: document.querySelector('#copy-button'),
  copyUrlButton: document.querySelector('#copy-url-button'),
  appUrl: document.querySelector('#app-url'),
  toast: document.querySelector('#toast'),
  deleteDialog: document.querySelector('#delete-dialog'),
  deleteMessage: document.querySelector('#delete-message'),
  storageStatus: document.querySelector('#storage-status')
};

let ingredients = [];
let pendingDeleteId = null;
let toastTimer;

function createId() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function showToast(message, type = 'success') {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle('error', type === 'error');
  elements.toast.classList.add('show');
  toastTimer = setTimeout(() => elements.toast.classList.remove('show'), 2600);
}

function ingredientSummary(item) {
  const stock = item.unit === '常時'
    ? ' 常時'
    : item.quantity ? ` ${item.quantity}回` : '';
  return `${item.name}${stock}${item.isFrozen ? ' ❄️' : ''}`;
}

function renderSummary(target, items) {
  target.replaceChildren();
  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-note';
    empty.textContent = 'まだ選ばれていません';
    target.append(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  items.forEach(item => {
    const chip = document.createElement('span');
    chip.className = 'summary-chip';
    chip.textContent = ingredientSummary(item);
    fragment.append(chip);
  });
  target.append(fragment);
}

function renderSelectionBoard() {
  const required = ingredients.filter(item => item.selectionState === 'required');
  const optional = ingredients.filter(item => item.selectionState === 'optional');
  renderSummary(elements.requiredSummary, required);
  renderSummary(elements.optionalSummary, optional);
  elements.selectedCount.textContent = `${required.length + optional.length}品`;
}

function createUnitSelect(item) {
  const select = document.createElement('select');
  select.className = 'unit-select';
  select.setAttribute('aria-label', `${item.name}の在庫管理方法`);
  const currentMode = item.unit === '常時' ? '常時' : '回';

  STOCK_MODES.forEach(mode => {
    const option = document.createElement('option');
    option.value = mode;
    option.textContent = mode;
    option.selected = mode === currentMode;
    select.append(option);
  });
  return select;
}

function createIngredientCard(item) {
  const card = document.createElement('article');
  card.className = 'ingredient-card';
  card.dataset.id = item.id;
  card.dataset.state = item.selectionState;

  const mainButton = document.createElement('button');
  mainButton.type = 'button';
  mainButton.className = 'card-main';
  mainButton.setAttribute('aria-label', `${item.name}：現在${stateLabels[item.selectionState]}。タップで変更`);

  const name = document.createElement('span');
  name.className = 'ingredient-name';
  name.textContent = item.name;
  const state = document.createElement('span');
  state.className = 'state-label';
  state.textContent = `${stateIcons[item.selectionState]} ${stateLabels[item.selectionState]}`;
  mainButton.append(name, state);

  const controls = document.createElement('div');
  controls.className = 'card-controls';

  const stockMode = item.unit === '常時' ? '常時' : '回';

  const quantity = document.createElement('input');
  quantity.className = 'quantity-input';
  quantity.type = 'number';
  quantity.inputMode = 'numeric';
  quantity.min = '0';
  quantity.step = '1';
  quantity.placeholder = stockMode === '常時' ? '常時' : '残り回数';
  quantity.value = stockMode === '常時' ? '' : (item.quantity || '');
  quantity.disabled = stockMode === '常時';
  quantity.setAttribute('aria-label', `${item.name}の残り使用回数`);

  const unitSelect = createUnitSelect(item);

  const frozen = document.createElement('button');
  frozen.type = 'button';
  frozen.className = 'frozen-button';
  frozen.textContent = '❄️';
  frozen.title = '冷凍状態を切り替える';
  frozen.setAttribute('aria-label', `${item.name}の冷凍状態`);
  frozen.setAttribute('aria-pressed', String(item.isFrozen));

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'delete-button';
  remove.textContent = '🗑';
  remove.title = '食材を削除';
  remove.setAttribute('aria-label', `${item.name}を削除`);

  controls.append(quantity, unitSelect, frozen, remove);

  card.append(mainButton, controls);
  return card;
}

function render() {
  const fragment = document.createDocumentFragment();
  ingredients.forEach(item => fragment.append(createIngredientCard(item)));
  elements.list.replaceChildren(fragment);
  elements.emptyState.hidden = ingredients.length > 0;
  renderSelectionBoard();
}

async function persistChange(id, changes) {
  const index = ingredients.findIndex(item => item.id === id);
  if (index < 0) return false;
  const before = ingredients[index];
  const updated = { ...before, ...changes, updatedAt: new Date().toISOString() };
  ingredients[index] = updated;
  render();

  try {
    await saveIngredient(updated);
    return true;
  } catch (error) {
    console.error(error);
    ingredients[index] = before;
    render();
    showToast('⚠️ 保存できませんでした', 'error');
    return false;
  }
}

elements.addForm.addEventListener('submit', async event => {
  event.preventDefault();
  const name = elements.nameInput.value.trim().replace(/\s+/g, ' ');
  if (!name) return;
  const normalizedName = normalizeIngredientName(name);

  if (ingredients.some(item => item.normalizedName === normalizedName)) {
    showToast('⚠️ 同じ名前の食材が登録されています', 'error');
    elements.nameInput.focus();
    return;
  }

  const now = new Date().toISOString();
  const ingredient = {
    id: createId(),
    name,
    normalizedName,
    selectionState: 'none',
    quantity: '',
    unit: '回',
    isFrozen: false,
    createdAt: now,
    updatedAt: now
  };

  try {
    await saveIngredient(ingredient);
    ingredients.push(ingredient);
    elements.nameInput.value = '';
    render();
    showToast(`✓ 「${name}」を追加しました`);
  } catch (error) {
    console.error(error);
    showToast('⚠️ 保存できませんでした', 'error');
  }
});

elements.list.addEventListener('click', async event => {
  const card = event.target.closest('.ingredient-card');
  if (!card) return;
  const item = ingredients.find(candidate => candidate.id === card.dataset.id);
  if (!item) return;

  if (event.target.closest('.card-main')) {
    await persistChange(item.id, { selectionState: nextSelectionState(item.selectionState) });
    return;
  }

  if (event.target.closest('.frozen-button')) {
    await persistChange(item.id, { isFrozen: !item.isFrozen });
    return;
  }

  if (event.target.closest('.delete-button')) {
    pendingDeleteId = item.id;
    elements.deleteMessage.textContent = `「${item.name}」を削除しますか？\n残量や冷凍状態などの情報も削除されます。`;
    elements.deleteDialog.showModal();
  }
});

elements.list.addEventListener('change', async event => {
  const card = event.target.closest('.ingredient-card');
  if (!card) return;
  const item = ingredients.find(candidate => candidate.id === card.dataset.id);
  if (!item) return;

  if (event.target.matches('.quantity-input')) {
    await persistChange(item.id, { quantity: event.target.value.trim() });
  }

  if (event.target.matches('.unit-select')) {
    const unit = event.target.value === '常時' ? '常時' : '回';
    const changes = unit === '常時'
      ? { unit, quantity: '' }
      : { unit };
    await persistChange(item.id, changes);
  }
});

elements.list.addEventListener('focusout', async event => {
  if (!event.target.matches('.quantity-input')) return;
  const card = event.target.closest('.ingredient-card');
  const item = ingredients.find(candidate => candidate.id === card?.dataset.id);
  if (!item) return;
  await persistChange(item.id, { quantity: event.target.value.trim() });
});

elements.deleteDialog.addEventListener('close', async () => {
  if (elements.deleteDialog.returnValue !== 'confirm' || !pendingDeleteId) {
    pendingDeleteId = null;
    return;
  }

  const item = ingredients.find(candidate => candidate.id === pendingDeleteId);
  try {
    await removeIngredient(pendingDeleteId);
    ingredients = ingredients.filter(candidate => candidate.id !== pendingDeleteId);
    render();
    showToast(`✓ 「${item?.name || '食材'}」を削除しました`);
  } catch (error) {
    console.error(error);
    showToast('⚠️ 削除できませんでした', 'error');
  } finally {
    pendingDeleteId = null;
  }
});

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('Clipboard API is unavailable');
}

elements.copyButton.addEventListener('click', async () => {
  const prompt = generateAiPrompt(ingredients);
  if (!prompt) {
    showToast('食材を1つ以上選択してください', 'error');
    return;
  }
  try {
    await copyText(prompt);
    showToast('✓ クリップボードにコピーしました');
  } catch (error) {
    console.error(error);
    showToast('⚠️ コピーできませんでした', 'error');
  }
});

elements.copyUrlButton.addEventListener('click', async () => {
  try {
    await copyText(PUBLIC_URL);
    showToast('✓ URLをコピーしました');
  } catch (error) {
    console.error(error);
    showToast('⚠️ コピーできませんでした', 'error');
  }
});

async function setupPersistentStorage() {
  if (!navigator.storage?.persist || !navigator.storage?.persisted) {
    elements.storageStatus.textContent = '未対応';
    return;
  }
  try {
    let persisted = await navigator.storage.persisted();
    if (!persisted) persisted = await navigator.storage.persist();
    elements.storageStatus.textContent = persisted ? '有効' : '未適用';
  } catch (error) {
    console.warn(error);
    elements.storageStatus.textContent = '確認できません';
  }
}

async function init() {
  elements.appUrl.textContent = PUBLIC_URL;
  try {
    ingredients = await getAllIngredients();
    render();
  } catch (error) {
    console.error(error);
    render();
    showToast('⚠️ 保存データを読み込めませんでした', 'error');
  }
  setupPersistentStorage();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(error => console.warn('Service Worker registration failed', error));
    });
  }
}

init();
