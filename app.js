import { getAllIngredients, removeIngredient, saveIngredient } from './db.js?v=12';
import {
  generateAiPrompt,
  INGREDIENT_CATEGORIES,
  INGREDIENT_CATEGORY_LABELS,
  ingredientCategory,
  nextSelectionState,
  normalizeIngredientName,
  sortIngredientsByCategory
} from './utils.js?v=12';

const PUBLIC_URL = 'https://yuuuh26.github.io/fridge-ai-helper/';
const LEGACY_MAIN_SEASONINGS_STORAGE_KEY = 'fridge-ai-helper-main-seasonings';
const SEASONING_OPTIONS_STORAGE_KEY = 'fridge-ai-helper-seasoning-options-v1';
const SEASONING_SELECTED_STORAGE_KEY = 'fridge-ai-helper-seasoning-selected-v1';
const DEFAULT_SEASONINGS = Object.freeze([
  '醤油', '味噌', '塩', 'こしょう', '砂糖', 'みりん', '酒', '酢',
  'めんつゆ', 'ポン酢', 'ごま油', 'オリーブオイル', 'オイスターソース',
  '鶏ガラスープの素', 'コンソメ', 'カレー粉', 'にんにく', 'しょうが'
]);
const STOCK_MODES = ['回分', '常時'];
const stateLabels = { none: '未選択', optional: '使ってもOK', required: '必ず使う' };
const stateIcons = { none: '○', optional: '●', required: '●' };

const elements = {
  addForm: document.querySelector('#add-form'),
  nameInput: document.querySelector('#ingredient-name'),
  categoryInput: document.querySelector('#ingredient-category'),
  list: document.querySelector('#ingredient-list'),
  constantList: document.querySelector('#constant-ingredient-list'),
  constantSection: document.querySelector('#constant-pantry'),
  constantCount: document.querySelector('#constant-count'),
  emptyState: document.querySelector('#empty-state'),
  requiredSummary: document.querySelector('#required-summary'),
  optionalSummary: document.querySelector('#optional-summary'),
  selectedCount: document.querySelector('#selected-count'),
  seasoningList: document.querySelector('#seasoning-list'),
  seasoningSelectedCount: document.querySelector('#seasoning-selected-count'),
  seasoningManagerList: document.querySelector('#seasoning-manager-list'),
  seasoningAddForm: document.querySelector('#seasoning-add-form'),
  seasoningNameInput: document.querySelector('#seasoning-name'),
  copyButton: document.querySelector('#copy-button'),
  copyUrlButton: document.querySelector('#copy-url-button'),
  appUrl: document.querySelector('#app-url'),
  toast: document.querySelector('#toast'),
  deleteDialog: document.querySelector('#delete-dialog'),
  deleteMessage: document.querySelector('#delete-message'),
  storageStatus: document.querySelector('#storage-status'),
  selectionBoard: document.querySelector('.selection-board')
};

let ingredients = [];
let seasonings = [];
let selectedSeasoningIds = new Set();
let sessionDisplayOrder = [];
let wasHidden = false;
let pendingDeleteId = null;
let toastTimer;
let summaryPressTimer = null;
let summaryPressChip = null;
let summaryPressStart = null;
const SUMMARY_LONG_PRESS_MS = 550;

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

function normalizeSeasoningName(name) {
  return String(name || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ja-JP');
}

function createSeasoningId(name) {
  const base = normalizeSeasoningName(name)
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return `seasoning-${base || createId()}`;
}

function saveSeasoningState() {
  try {
    localStorage.setItem(SEASONING_OPTIONS_STORAGE_KEY, JSON.stringify(seasonings));
    localStorage.setItem(SEASONING_SELECTED_STORAGE_KEY, JSON.stringify([...selectedSeasoningIds]));
  } catch (error) {
    console.warn('Seasoning state could not be saved', error);
  }
}

function loadSeasoningState() {
  try {
    const savedOptions = JSON.parse(localStorage.getItem(SEASONING_OPTIONS_STORAGE_KEY) || 'null');
    const savedSelected = JSON.parse(localStorage.getItem(SEASONING_SELECTED_STORAGE_KEY) || 'null');

    if (Array.isArray(savedOptions)) {
      seasonings = savedOptions
        .filter(item => item && typeof item.name === 'string' && item.name.trim())
        .map(item => ({ id: String(item.id || createSeasoningId(item.name)), name: item.name.trim() }));
      selectedSeasoningIds = new Set(Array.isArray(savedSelected) ? savedSelected.map(String) : []);
      return;
    }

    seasonings = DEFAULT_SEASONINGS.map(name => ({ id: createSeasoningId(name), name }));
    selectedSeasoningIds = new Set();

    const legacyText = localStorage.getItem(LEGACY_MAIN_SEASONINGS_STORAGE_KEY) || '';
    const legacyNames = legacyText
      .split(/[、,\n]/)
      .map(name => name.trim())
      .filter(Boolean);

    legacyNames.forEach(name => {
      const normalized = normalizeSeasoningName(name);
      let existing = seasonings.find(item => normalizeSeasoningName(item.name) === normalized);
      if (!existing) {
        existing = { id: createSeasoningId(name), name };
        seasonings.push(existing);
      }
      selectedSeasoningIds.add(existing.id);
    });

    localStorage.removeItem(LEGACY_MAIN_SEASONINGS_STORAGE_KEY);
    saveSeasoningState();
  } catch (error) {
    console.warn('Seasoning state could not be loaded', error);
    seasonings = DEFAULT_SEASONINGS.map(name => ({ id: createSeasoningId(name), name }));
    selectedSeasoningIds = new Set();
  }
}

function renderSeasonings() {
  const fragment = document.createDocumentFragment();

  seasonings.forEach(item => {
    const selected = selectedSeasoningIds.has(item.id);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'seasoning-option';
    button.dataset.id = item.id;
    button.setAttribute('aria-pressed', String(selected));
    button.textContent = item.name;
    fragment.append(button);
  });

  elements.seasoningList.replaceChildren(fragment);
  elements.seasoningSelectedCount.textContent = `${selectedSeasoningIds.size}個選択`;

  const managerFragment = document.createDocumentFragment();
  seasonings.forEach(item => {
    const row = document.createElement('div');
    row.className = 'seasoning-manager-row';

    const name = document.createElement('span');
    name.textContent = item.name;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'seasoning-remove-button';
    remove.dataset.id = item.id;
    remove.textContent = '削除';
    remove.setAttribute('aria-label', `${item.name}を削除`);

    row.append(name, remove);
    managerFragment.append(row);
  });
  elements.seasoningManagerList.replaceChildren(managerFragment);
}

function selectedSeasoningNames() {
  return seasonings
    .filter(item => selectedSeasoningIds.has(item.id))
    .map(item => item.name);
}

function ingredientSummary(item) {
  const quantity = ['1', '2', '3'].includes(String(item.quantity ?? '')) ? String(item.quantity) : '';
  const stock = item.unit === '常時'
    ? ' 常時'
    : quantity ? ` ${quantity}回分` : '';
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
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'summary-chip summary-chip-action';
    chip.dataset.id = item.id;
    chip.textContent = ingredientSummary(item);
    chip.title = '長押しで選択解除';
    chip.setAttribute('aria-label', `${item.name}。長押しで選択解除`);
    fragment.append(chip);
  });
  target.append(fragment);
}

function renderSelectionBoard() {
  const required = sortIngredientsByCategory(
    ingredients.filter(item => item.selectionState === 'required')
  );
  const optional = sortIngredientsByCategory(
    ingredients.filter(item => item.selectionState === 'optional')
  );
  renderSummary(elements.requiredSummary, required);
  renderSummary(elements.optionalSummary, optional);
  elements.selectedCount.textContent = `${required.length + optional.length}品`;
}

function clearSummaryLongPress() {
  if (summaryPressTimer) {
    clearTimeout(summaryPressTimer);
    summaryPressTimer = null;
  }
  summaryPressChip?.classList.remove('is-pressing');
  summaryPressChip = null;
  summaryPressStart = null;
}

elements.selectionBoard.addEventListener('pointerdown', event => {
  const chip = event.target.closest('.summary-chip-action');
  if (!chip || (event.pointerType !== 'touch' && event.button !== 0)) return;

  clearSummaryLongPress();
  summaryPressChip = chip;
  summaryPressStart = { x: event.clientX, y: event.clientY };
  chip.classList.add('is-pressing');

  try {
    chip.setPointerCapture?.(event.pointerId);
  } catch {
    // Pointer capture is optional; long press still works without it.
  }

  const id = chip.dataset.id;
  summaryPressTimer = setTimeout(async () => {
    const item = ingredients.find(candidate => candidate.id === id);
    if (!item || item.selectionState === 'none') {
      clearSummaryLongPress();
      return;
    }

    clearSummaryLongPress();
    navigator.vibrate?.(20);
    const saved = await persistChange(item.id, { selectionState: 'none' });
    if (saved) showToast(`✓ 「${item.name}」の選択を解除しました`);
  }, SUMMARY_LONG_PRESS_MS);
});

elements.selectionBoard.addEventListener('pointermove', event => {
  if (!summaryPressStart || !summaryPressChip) return;
  const distance = Math.hypot(
    event.clientX - summaryPressStart.x,
    event.clientY - summaryPressStart.y
  );
  if (distance > 10) clearSummaryLongPress();
});

['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => {
  elements.selectionBoard.addEventListener(type, clearSummaryLongPress);
});

elements.selectionBoard.addEventListener('contextmenu', event => {
  if (event.target.closest('.summary-chip-action')) event.preventDefault();
});

function createUnitSelect(item) {
  const select = document.createElement('select');
  select.className = 'unit-select';
  select.setAttribute('aria-label', `${item.name}の在庫管理方法`);
  const currentMode = item.unit === '常時' ? '常時' : '回分';

  STOCK_MODES.forEach(mode => {
    const option = document.createElement('option');
    option.value = mode;
    option.textContent = mode;
    option.selected = mode === currentMode;
    select.append(option);
  });
  return select;
}

function createCategorySelect(item) {
  const select = document.createElement('select');
  select.className = 'category-select';
  select.setAttribute('aria-label', `${item.name}のカテゴリ`);
  const currentCategory = ingredientCategory(item);

  INGREDIENT_CATEGORIES.forEach(category => {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = INGREDIENT_CATEGORY_LABELS[category];
    option.selected = category === currentCategory;
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

  const stockMode = item.unit === '常時' ? '常時' : '回分';

  const quantity = document.createElement('select');
  quantity.className = 'quantity-input';
  quantity.disabled = stockMode === '常時';
  quantity.setAttribute('aria-label', `${item.name}の残り使用回数`);

  const currentQuantity = ['1', '2', '3'].includes(String(item.quantity ?? ''))
    ? String(item.quantity)
    : '';

  const quantityPlaceholder = document.createElement('option');
  quantityPlaceholder.value = '';
  quantityPlaceholder.textContent = stockMode === '常時' ? '—' : '回数';
  quantityPlaceholder.selected = !currentQuantity;
  quantity.append(quantityPlaceholder);

  ['1', '2', '3'].forEach(value => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    option.selected = value === currentQuantity;
    quantity.append(option);
  });

  const unitSelect = createUnitSelect(item);
  const categorySelect = createCategorySelect(item);

  const categoryEditor = document.createElement('label');
  categoryEditor.className = 'category-editor';

  const categoryLabel = document.createElement('span');
  categoryLabel.className = 'category-editor-label';
  categoryLabel.textContent = '分類';

  categoryEditor.append(categoryLabel, categorySelect);

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

  controls.append(quantity, unitSelect, frozen, remove, categoryEditor);

  card.append(mainButton, controls);
  return card;
}

function rebuildSessionDisplayOrder() {
  sessionDisplayOrder = [...ingredients]
    .sort((a, b) => {
      const categoryDiff = INGREDIENT_CATEGORIES.indexOf(ingredientCategory(a))
        - INGREDIENT_CATEGORIES.indexOf(ingredientCategory(b));
      if (categoryDiff) return categoryDiff;

      const aUnselected = a.selectionState === 'none' ? 1 : 0;
      const bUnselected = b.selectionState === 'none' ? 1 : 0;
      if (aUnselected !== bUnselected) return aUnselected - bUnselected;

      return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
    })
    .map(item => item.id);
}

function sortBySessionDisplayOrder(items) {
  const orderMap = new Map(sessionDisplayOrder.map((id, index) => [id, index]));
  return [...items].sort((a, b) => {
    const aOrder = orderMap.has(a.id) ? orderMap.get(a.id) : Number.MAX_SAFE_INTEGER;
    const bOrder = orderMap.has(b.id) ? orderMap.get(b.id) : Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
  });
}

function renderCategorizedIngredientList(target, items) {
  const fragment = document.createDocumentFragment();

  INGREDIENT_CATEGORIES.forEach(category => {
    const categoryItems = sortBySessionDisplayOrder(
      items.filter(item => ingredientCategory(item) === category)
    );
    if (!categoryItems.length) return;

    const group = document.createElement('div');
    group.className = 'ingredient-category-group';
    group.dataset.category = category;

    const heading = document.createElement('div');
    heading.className = 'ingredient-category-heading';

    const title = document.createElement('h3');
    title.textContent = INGREDIENT_CATEGORY_LABELS[category];

    const count = document.createElement('span');
    count.className = 'category-count';
    count.textContent = `${categoryItems.length}品`;

    const cardList = document.createElement('div');
    cardList.className = 'category-ingredient-list';
    categoryItems.forEach(item => cardList.append(createIngredientCard(item)));

    heading.append(title, count);
    group.append(heading, cardList);
    fragment.append(group);
  });

  target.replaceChildren(fragment);
}

function render() {
  const regularItems = ingredients.filter(item => item.unit !== '常時');
  const constantItems = ingredients.filter(item => item.unit === '常時');

  renderCategorizedIngredientList(elements.list, regularItems);

  const constantFragment = document.createDocumentFragment();
  sortIngredientsByCategory(constantItems)
    .forEach(item => constantFragment.append(createIngredientCard(item)));
  elements.constantList.replaceChildren(constantFragment);

  elements.emptyState.hidden = regularItems.length > 0;
  elements.constantSection.hidden = constantItems.length === 0;
  elements.constantCount.textContent = `${constantItems.length}品`;

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
  const category = INGREDIENT_CATEGORIES.includes(elements.categoryInput.value)
    ? elements.categoryInput.value
    : 'vegetable';

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
    category,
    quantity: '',
    unit: '回分',
    isFrozen: false,
    createdAt: now,
    updatedAt: now
  };

  try {
    await saveIngredient(ingredient);
    ingredients.push(ingredient);
    sessionDisplayOrder.push(ingredient.id);
    elements.nameInput.value = '';
    render();
    showToast(`✓ 「${name}」を追加しました`);
  } catch (error) {
    console.error(error);
    showToast('⚠️ 保存できませんでした', 'error');
  }
});

document.querySelector('.app-shell').addEventListener('click', async event => {
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

document.querySelector('.app-shell').addEventListener('change', async event => {
  const card = event.target.closest('.ingredient-card');
  if (!card) return;
  const item = ingredients.find(candidate => candidate.id === card.dataset.id);
  if (!item) return;

  if (event.target.matches('.quantity-input')) {
    await persistChange(item.id, { quantity: event.target.value.trim() });
  }

  if (event.target.matches('.unit-select')) {
    const unit = event.target.value === '常時' ? '常時' : '回分';
    const changes = unit === '常時'
      ? { unit, quantity: '' }
      : { unit };
    await persistChange(item.id, changes);
  }

  if (event.target.matches('.category-select')) {
    const category = INGREDIENT_CATEGORIES.includes(event.target.value)
      ? event.target.value
      : ingredientCategory(item);
    await persistChange(item.id, { category });
  }
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
    sessionDisplayOrder = sessionDisplayOrder.filter(id => id !== pendingDeleteId);
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

elements.seasoningList.addEventListener('click', event => {
  const button = event.target.closest('.seasoning-option');
  if (!button) return;

  const id = button.dataset.id;
  if (selectedSeasoningIds.has(id)) {
    selectedSeasoningIds.delete(id);
  } else {
    selectedSeasoningIds.add(id);
  }
  saveSeasoningState();
  renderSeasonings();
});

elements.seasoningAddForm.addEventListener('submit', event => {
  event.preventDefault();
  const name = elements.seasoningNameInput.value.trim().replace(/\s+/g, ' ');
  if (!name) return;

  const normalized = normalizeSeasoningName(name);
  if (seasonings.some(item => normalizeSeasoningName(item.name) === normalized)) {
    showToast('⚠️ 同じ調味料が登録されています', 'error');
    return;
  }

  seasonings.push({ id: createSeasoningId(name), name });
  elements.seasoningNameInput.value = '';
  saveSeasoningState();
  renderSeasonings();
  showToast(`✓ 「${name}」を追加しました`);
});

elements.seasoningManagerList.addEventListener('click', event => {
  const button = event.target.closest('.seasoning-remove-button');
  if (!button) return;

  const id = button.dataset.id;
  const item = seasonings.find(candidate => candidate.id === id);
  seasonings = seasonings.filter(candidate => candidate.id !== id);
  selectedSeasoningIds.delete(id);
  saveSeasoningState();
  renderSeasonings();
  showToast(`✓ 「${item?.name || '調味料'}」を削除しました`);
});

elements.copyButton.addEventListener('click', async () => {
  const prompt = generateAiPrompt(ingredients, selectedSeasoningNames());
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

async function persistLegacyCategories() {
  const legacyItems = ingredients.filter(item => !INGREDIENT_CATEGORIES.includes(item.category));
  if (!legacyItems.length) return;

  await Promise.all(legacyItems.map(async item => {
    const category = ingredientCategory(item);
    const updated = { ...item, category, updatedAt: new Date().toISOString() };
    await saveIngredient(updated);
    const index = ingredients.findIndex(candidate => candidate.id === item.id);
    if (index >= 0) ingredients[index] = updated;
  }));
}

async function init() {
  elements.appUrl.textContent = PUBLIC_URL;
  loadSeasoningState();
  renderSeasonings();

  try {
    ingredients = await getAllIngredients();
    await persistLegacyCategories();
    rebuildSessionDisplayOrder();
    render();
  } catch (error) {
    console.error(error);
    render();
    showToast('⚠️ 保存データを読み込めませんでした', 'error');
  }
  setupPersistentStorage();

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      wasHidden = true;
      return;
    }

    if (document.visibilityState === 'visible' && wasHidden) {
      wasHidden = false;
      rebuildSessionDisplayOrder();
      render();
    }
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js?v=12', { updateViaCache: 'none' }).catch(error => console.warn('Service Worker registration failed', error));
    });
  }
}

init();
