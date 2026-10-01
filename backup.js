export const BACKUP_APP_ID = 'fridge-ai-helper';
export const BACKUP_SCHEMA_VERSION = 1;

const SELECTION_STATES = new Set(['none', 'optional', 'required']);
const STOCK_UNITS = new Set(['回分', '常時']);

function fail(message) {
  throw new Error(message);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireString(value, label) {
  if (typeof value !== 'string' || !value.trim()) fail(`${label}が正しくありません`);
  return value;
}

export function createBackupPayload({
  fridges,
  ingredients,
  activeFridgeId = null,
  exportedAt = new Date().toISOString()
}) {
  return {
    app: BACKUP_APP_ID,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt,
    activeFridgeId,
    fridges: fridges.map(item => ({ ...item })),
    ingredients: ingredients.map(item => ({ ...item }))
  };
}

export function validateBackupPayload(value) {
  if (!isPlainObject(value)) fail('バックアップ形式が正しくありません');
  if (value.app !== BACKUP_APP_ID) fail('冷蔵庫AIヘルパーのバックアップではありません');
  if (value.schemaVersion !== BACKUP_SCHEMA_VERSION) {
    fail(`対応していないバックアップ形式です（version: ${value.schemaVersion ?? '不明'}）`);
  }
  if (!Array.isArray(value.fridges) || value.fridges.length < 1 || value.fridges.length > 5) {
    fail('冷蔵庫データの件数が正しくありません');
  }
  if (!Array.isArray(value.ingredients)) fail('食材データが正しくありません');

  const fridgeIds = new Set();
  const fridgeNames = new Set();

  const fridges = value.fridges.map((fridge, index) => {
    if (!isPlainObject(fridge)) fail(`冷蔵庫${index + 1}のデータが正しくありません`);
    const id = requireString(fridge.id, `冷蔵庫${index + 1}のID`);
    const name = requireString(fridge.name, `冷蔵庫${index + 1}の名前`);
    if (fridgeIds.has(id)) fail('同じIDの冷蔵庫が重複しています');
    if (fridgeNames.has(name)) fail('同じ名前の冷蔵庫が重複しています');
    fridgeIds.add(id);
    fridgeNames.add(name);

    const seasonings = fridge.seasonings ?? [];
    const selectedSeasoningIds = fridge.selectedSeasoningIds ?? [];
    if (!Array.isArray(seasonings) || !Array.isArray(selectedSeasoningIds)) {
      fail(`「${name}」の調味料データが正しくありません`);
    }

    const seasoningIds = new Set();
    seasonings.forEach((seasoning, seasoningIndex) => {
      if (!isPlainObject(seasoning)) fail(`「${name}」の調味料${seasoningIndex + 1}が正しくありません`);
      const seasoningId = requireString(seasoning.id, `「${name}」の調味料ID`);
      requireString(seasoning.name, `「${name}」の調味料名`);
      if (seasoningIds.has(seasoningId)) fail(`「${name}」で同じ調味料IDが重複しています`);
      seasoningIds.add(seasoningId);
    });
    selectedSeasoningIds.forEach(idValue => {
      if (typeof idValue !== 'string' || !seasoningIds.has(idValue)) {
        fail(`「${name}」の調味料選択データが正しくありません`);
      }
    });

    return {
      ...fridge,
      seasonings: seasonings.map(item => ({ ...item })),
      selectedSeasoningIds: [...selectedSeasoningIds]
    };
  });

  const ingredientIds = new Set();
  const fridgeAndNames = new Set();
  const ingredients = value.ingredients.map((ingredient, index) => {
    if (!isPlainObject(ingredient)) fail(`食材${index + 1}のデータが正しくありません`);
    const id = requireString(ingredient.id, `食材${index + 1}のID`);
    const fridgeId = requireString(ingredient.fridgeId, `食材${index + 1}の冷蔵庫ID`);
    const name = requireString(ingredient.name, `食材${index + 1}の名前`);
    const normalizedName = requireString(ingredient.normalizedName, `食材「${name}」の検索名`);

    if (!fridgeIds.has(fridgeId)) fail(`食材「${name}」の保存先冷蔵庫が存在しません`);
    if (ingredientIds.has(id)) fail('同じIDの食材が重複しています');
    ingredientIds.add(id);

    const uniqueKey = `${fridgeId}\u0000${normalizedName}`;
    if (fridgeAndNames.has(uniqueKey)) fail(`「${name}」が同じ冷蔵庫内で重複しています`);
    fridgeAndNames.add(uniqueKey);

    if (!SELECTION_STATES.has(ingredient.selectionState)) {
      fail(`食材「${name}」の選択状態が正しくありません`);
    }
    if (!STOCK_UNITS.has(ingredient.unit)) {
      fail(`食材「${name}」の在庫管理方法が正しくありません`);
    }
    if (typeof ingredient.isFrozen !== 'boolean') {
      fail(`食材「${name}」の冷凍状態が正しくありません`);
    }

    return { ...ingredient };
  });

  const activeFridgeId =
    typeof value.activeFridgeId === 'string' && fridgeIds.has(value.activeFridgeId)
      ? value.activeFridgeId
      : null;

  return {
    app: BACKUP_APP_ID,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: typeof value.exportedAt === 'string' ? value.exportedAt : '',
    activeFridgeId,
    fridges,
    ingredients
  };
}

export function parseBackupText(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    fail('JSONファイルを読み取れませんでした');
  }
  return validateBackupPayload(value);
}

export function backupFilename(date = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  return [
    'fridge-ai-helper-backup-',
    date.getFullYear(), '-',
    pad(date.getMonth() + 1), '-',
    pad(date.getDate()), '_',
    pad(date.getHours()), pad(date.getMinutes()),
    '.json'
  ].join('');
}
