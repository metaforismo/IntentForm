import { describe, expect, it, vi } from "vitest";
import { adaptiveAutosaveDelay, AUTOSAVE_DELAYS, compareModeStorageKey, readBooleanPreference, virtualWindow, writeBooleanPreference } from "./reliability-model";

describe("Studio long-session reliability model", () => {
  it("throttles multi-megabyte graph saves without delaying small edits", () => {
    expect(adaptiveAutosaveDelay(128_000)).toBe(AUTOSAVE_DELAYS.small);
    expect(adaptiveAutosaveDelay(1024 * 1024)).toBe(AUTOSAVE_DELAYS.medium);
    expect(adaptiveAutosaveDelay(6 * 1024 * 1024)).toBe(AUTOSAVE_DELAYS.large);
    expect(adaptiveAutosaveDelay(Number.NaN)).toBe(AUTOSAVE_DELAYS.small);
  });

  it("keeps compare restoration project-scoped and storage failures non-fatal", () => {
    expect(compareModeStorageKey("project-a")).not.toBe(compareModeStorageKey("project-b"));
    expect(readBooleanPreference({ getItem: () => "true" }, "key")).toBe(true);
    expect(readBooleanPreference({ getItem: () => { throw new DOMException("denied"); } }, "key")).toBe(false);
    const setItem = vi.fn();
    writeBooleanPreference({ setItem }, "key", true);
    expect(setItem).toHaveBeenCalledWith("key", "true");
    expect(() => writeBooleanPreference({ setItem: () => { throw new DOMException("full"); } }, "key", false)).not.toThrow();
  });

  it("keeps a 100,000-row list inside a bounded render window", () => {
    const window = virtualWindow(100_000, 28 * 50_000, 560, 28);
    expect(window.end - window.start).toBeLessThanOrEqual(36);
    expect(window.before + window.after + (window.end - window.start) * 28).toBe(2_800_000);
  });

  it("keeps transient invalid measurements from producing an invalid render range", () => {
    expect(virtualWindow(Number.NaN, Number.NaN, Number.NaN, 0, Number.NaN)).toEqual({
      start: 0,
      end: 0,
      before: 0,
      after: 0,
    });
    expect(virtualWindow(3, -100, -1, 0, -2)).toEqual({
      start: 0,
      end: 0,
      before: 0,
      after: 3,
    });
  });
});
