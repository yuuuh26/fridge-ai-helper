export const SELECTION_STATES = Object.freeze(['none', 'optional', 'required']);

export const INGREDIENT_CATEGORIES = Object.freeze(['meat', 'fish', 'tofu', 'vegetable']);
export const INGREDIENT_CATEGORY_LABELS = Object.freeze({
  meat: '肉',
  fish: '魚',
  tofu: '豆腐',
  vegetable: '野菜'
});

const CATEGORY_KEYWORDS = Object.freeze({
  tofu: ['豆腐', '厚揚げ', '油揚げ', 'うす揚げ', '薄揚げ'],
  meat: ['鶏', 'とり肉', 'チキン', '豚', 'ぶた肉', 'ポーク', '牛', 'ぎゅう肉', 'ビーフ', 'ひき肉', '挽肉', 'ミンチ', 'ベーコン', 'ハム', 'ソーセージ', 'ウインナー', '肉'],
  fish: ['鮭', 'さけ', 'サーモン', '鯖', 'さば', 'サバ', '鮪', 'まぐろ', 'マグロ', '鰤', 'ぶり', 'ブリ', '鯛', 'たい', 'タイ', '鰯', 'いわし', 'イワシ', '秋刀魚', 'さんま', 'サンマ', '鱈', 'たら', 'タラ', '魚', 'えび', 'エビ', '海老', 'いか', 'イカ', 'たこ', 'タコ', 'しらす', 'ツナ', 'かつお', 'カツオ']
});

export function normalizeIngredientName(name) {
  return name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ja-JP');
}

export function inferIngredientCategory(name) {
  const normalized = normalizeIngredientName(name || '');
  for (const category of ['tofu', 'meat', 'fish']) {
    if (CATEGORY_KEYWORDS[category].some(keyword => normalized.includes(normalizeIngredientName(keyword)))) {
      return category;
    }
  }
  return 'vegetable';
}

export function ingredientCategory(ingredient) {
  return INGREDIENT_CATEGORIES.includes(ingredient?.category)
    ? ingredient.category
    : inferIngredientCategory(ingredient?.name || '');
}

export function sortIngredientsByCategory(ingredients) {
  return [...ingredients].sort((a, b) => {
    const categoryDiff = INGREDIENT_CATEGORIES.indexOf(ingredientCategory(a))
      - INGREDIENT_CATEGORIES.indexOf(ingredientCategory(b));
    if (categoryDiff) return categoryDiff;
    return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
  });
}

export function nextSelectionState(currentState) {
  const index = SELECTION_STATES.indexOf(currentState);
  return SELECTION_STATES[(index + 1) % SELECTION_STATES.length];
}

export function formatIngredient(ingredient) {
  const frozenState = ingredient.isFrozen ? '冷凍中' : '非冷凍';
  return `・${ingredient.name}（${frozenState}）`;
}

export function generateAiPrompt(ingredients) {
  const selected = sortIngredientsByCategory(
    ingredients.filter(item => item.selectionState !== 'none')
  );
  if (!selected.length) return '';

  const required = selected.filter(item => item.selectionState === 'required');
  const optional = selected.filter(item => item.selectionState === 'optional');
  const sections = ['料理を考えてください。'];

  if (required.length) {
    sections.push(`【絶対に使ってほしい食材】\n\n${required.map(formatIngredient).join('\n')}`);
  }

  if (optional.length) {
    sections.push(`【冷蔵庫・冷凍庫にあるので、使っても使わなくてもよい食材】\n\n${optional.map(formatIngredient).join('\n')}`);
  }

  if (required.length) {
    sections.push('「絶対に使ってほしい食材」は必ず使用してください。');
  }
  if (optional.length) {
    sections.push('その他の食材については、料理に合う場合のみ使用してください。');
  }

  return sections.join('\n\n');
}
