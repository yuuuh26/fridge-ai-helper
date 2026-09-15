export const SELECTION_STATES = Object.freeze(['none', 'optional', 'required']);

export function normalizeIngredientName(name) {
  return name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ja-JP');
}

export function nextSelectionState(currentState) {
  const index = SELECTION_STATES.indexOf(currentState);
  return SELECTION_STATES[(index + 1) % SELECTION_STATES.length];
}

export function formatIngredient(ingredient) {
  return `・${ingredient.name}`;
}

export function generateAiPrompt(ingredients) {
  const selected = ingredients.filter(item => item.selectionState !== 'none');
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
