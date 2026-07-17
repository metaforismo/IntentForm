import { describe, expect, it } from "vitest";
import {
  beginInlineTextEdit,
  inlineTextCommitValue,
  loadLatestInlineText,
  reconcileInlineTextEdit,
  updateInlineTextDraft,
} from "./inline-text-edit";

describe("inline text edit state", () => {
  it("adopts external changes while the human draft is untouched", () => {
    const state = reconcileInlineTextEdit(beginInlineTextEdit("Original"), "Agent update");
    expect(state).toEqual({
      baselineValue: "Agent update",
      draftValue: "Agent update",
      latestValue: "Agent update",
      conflict: null,
    });
  });

  it("preserves a human draft and requires explicit resolution for concurrent changes", () => {
    const draft = updateInlineTextDraft(beginInlineTextEdit("Original"), "Human draft");
    const conflicted = reconcileInlineTextEdit(draft, "Agent update");
    expect(conflicted).toMatchObject({ draftValue: "Human draft", latestValue: "Agent update", conflict: "changed" });
    expect(inlineTextCommitValue(conflicted)).toBeNull();

    const resolved = loadLatestInlineText(conflicted);
    expect(resolved).toMatchObject({ baselineValue: "Agent update", draftValue: "Agent update", conflict: null });
  });

  it("protects an active IME composition even before an input event changes the draft", () => {
    const state = reconcileInlineTextEdit(beginInlineTextEdit("Original"), "Agent update", { preserveDraft: true });
    expect(state).toMatchObject({ draftValue: "Original", latestValue: "Agent update", conflict: "changed" });
  });

  it("fails closed when the edited node disappears", () => {
    const state = reconcileInlineTextEdit(updateInlineTextDraft(beginInlineTextEdit("Original"), "Draft"), null);
    expect(state.conflict).toBe("removed");
    expect(inlineTextCommitValue(state)).toBeNull();
  });

  it("trims meaningful changes and suppresses empty or unchanged commits", () => {
    expect(inlineTextCommitValue(updateInlineTextDraft(beginInlineTextEdit("Original"), "  Updated  "))).toBe("Updated");
    expect(inlineTextCommitValue(updateInlineTextDraft(beginInlineTextEdit("Original"), " Original "))).toBeNull();
    expect(inlineTextCommitValue(updateInlineTextDraft(beginInlineTextEdit("Original"), "   "))).toBeNull();
  });
});
