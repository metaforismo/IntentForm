import { describe, expect, it } from "vitest";
import {
  defaultGuidePreferences,
  guideStorageKey,
  nextGuideId,
  parseGuidePreferences,
  readGuidePreferences,
  visibleGuidePositions,
  writeGuidePreferences,
} from "./guides";

describe("editor guide metadata", () => {
  it("fails closed for malformed storage and bounds untrusted guide values", () => {
    expect(parseGuidePreferences("not-json")).toEqual(defaultGuidePreferences());
    expect(parseGuidePreferences(JSON.stringify({
      visible: false,
      snap: false,
      byScreen: {
        home: [
          { id: "guide-v-1", axis: "vertical", position: 99_999, locked: true, hidden: false },
          { id: "guide-v-1", axis: "vertical", position: 10 },
          { id: "bad id", axis: "horizontal", position: 12 },
        ],
        "../escape": [{ id: "guide-h-1", axis: "horizontal", position: 20 }],
      },
    }))).toEqual({
      visible: false,
      snap: false,
      byScreen: { home: [{ id: "guide-v-1", axis: "vertical", position: 10_000, locked: true, hidden: false }] },
    });
  });

  it("keeps guides project-scoped and treats unavailable storage as optional metadata", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };
    const preferences = { visible: true, snap: true, byScreen: { home: [{ id: "guide-h-1", axis: "horizontal" as const, position: 120, locked: false, hidden: false }] } };
    writeGuidePreferences(storage, "project-a", preferences);
    expect(values.has(guideStorageKey("project-a"))).toBe(true);
    expect(readGuidePreferences(storage, "project-a")).toEqual(preferences);
    expect(readGuidePreferences(null, "project-a")).toEqual(defaultGuidePreferences());
  });

  it("allocates stable IDs and exposes only visible guide snap coordinates", () => {
    const guides = [
      { id: "guide-v-1", axis: "vertical" as const, position: 24, locked: false, hidden: false },
      { id: "guide-v-2", axis: "vertical" as const, position: 48, locked: false, hidden: true },
      { id: "guide-h-1", axis: "horizontal" as const, position: 32, locked: true, hidden: false },
    ];
    expect(nextGuideId(guides, "vertical")).toBe("guide-v-3");
    expect(visibleGuidePositions(guides, true)).toEqual({ x: [24], y: [32] });
    expect(visibleGuidePositions(guides, false)).toEqual({ x: [], y: [] });
  });
});
