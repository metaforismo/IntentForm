export type InlineTextConflict = "changed" | "removed" | null;

export interface InlineTextEditState {
  baselineValue: string;
  draftValue: string;
  latestValue: string | null;
  conflict: InlineTextConflict;
}

export function beginInlineTextEdit(value: string): InlineTextEditState {
  return {
    baselineValue: value,
    draftValue: value,
    latestValue: value,
    conflict: null,
  };
}

export function updateInlineTextDraft(state: InlineTextEditState, draftValue: string): InlineTextEditState {
  if (draftValue === state.draftValue) return state;
  return { ...state, draftValue };
}

export function reconcileInlineTextEdit(
  state: InlineTextEditState,
  latestValue: string | null,
  options: { preserveDraft?: boolean } = {},
): InlineTextEditState {
  if (latestValue === state.latestValue) return state;
  if (latestValue === null) return { ...state, latestValue, conflict: "removed" };

  const draftIsUntouched = state.draftValue === state.baselineValue;
  if (draftIsUntouched && !options.preserveDraft) {
    return {
      baselineValue: latestValue,
      draftValue: latestValue,
      latestValue,
      conflict: null,
    };
  }
  return { ...state, latestValue, conflict: "changed" };
}

export function loadLatestInlineText(state: InlineTextEditState): InlineTextEditState {
  if (state.latestValue === null) return state;
  return {
    baselineValue: state.latestValue,
    draftValue: state.latestValue,
    latestValue: state.latestValue,
    conflict: null,
  };
}

export function inlineTextCommitValue(state: InlineTextEditState): string | null {
  if (state.conflict || state.latestValue === null) return null;
  const value = state.draftValue.trim();
  return value && value !== state.latestValue ? value : null;
}
