export const CREATE_MODES = Object.freeze(['full', 'items', 'empty']);

// Copies are independent records; changing one fridge never changes another.
export function prepareFridgeCopy(sourceFridge, sourceIngredients, target, mode, makeId) {
  if (!CREATE_MODES.includes(mode)) throw new Error('作成方法が正しくありません');
  if (mode === 'empty') {
    return { fridge: { ...target, seasonings: [], selectedSeasoningIds: [] }, ingredients: [] };
  }
  const now = new Date().toISOString();
  return {
    fridge: {
      ...target,
      seasonings: (sourceFridge.seasonings || []).map(item => ({ ...item })),
      selectedSeasoningIds: mode === 'full' ? [...(sourceFridge.selectedSeasoningIds || [])] : []
    },
    ingredients: sourceIngredients.map(item => ({
      ...item,
      id: makeId(),
      fridgeId: target.id,
      selectionState: mode === 'full' ? item.selectionState : 'none',
      createdAt: now,
      updatedAt: now
    }))
  };
}
