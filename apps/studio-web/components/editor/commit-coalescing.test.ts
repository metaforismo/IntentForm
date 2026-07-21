import { describe, expect, it } from "vitest";
import { shouldCoalesceCommit } from "./commit-coalescing";

const base = { at: 10_000, notice: "Updated visible and accessible label.", anchor: "payment-request:payment-request.amount" };

describe("commit coalescing", () => {
  it("coalesces a rapid identical edit on the same node", () => {
    expect(shouldCoalesceCommit(base, { ...base, at: base.at + 400 })).toBe(true);
  });

  it("keeps separate undo steps for the same notice on different nodes", () => {
    expect(shouldCoalesceCommit(base, {
      ...base,
      at: base.at + 400,
      anchor: "payment-request:payment-request.confirm",
    })).toBe(false);
  });

  it("keeps separate undo steps across screens even for the same node id suffix", () => {
    expect(shouldCoalesceCommit(base, {
      ...base,
      at: base.at + 400,
      anchor: "request-sent:payment-request.amount",
    })).toBe(false);
  });

  it("never coalesces once the window has elapsed", () => {
    expect(shouldCoalesceCommit(base, { ...base, at: base.at + 900 })).toBe(false);
  });

  it("never coalesces different notices", () => {
    expect(shouldCoalesceCommit(base, { ...base, at: base.at + 400, notice: "Refined the node's intent purpose." })).toBe(false);
  });

  it("never coalesces against the cleared post-undo stamp", () => {
    expect(shouldCoalesceCommit({ at: 0, notice: "", anchor: "" }, { at: 400, notice: "", anchor: "" })).toBe(false);
  });
});
