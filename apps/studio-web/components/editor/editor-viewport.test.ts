import { describe, expect, it, vi } from "vitest";
import {
  EDITOR_PANEL_WIDTHS_STORAGE_KEY,
  LEGACY_EDITOR_PANEL_WIDTHS_STORAGE_KEY,
  clampEditorPanelWidths,
  fitWorldRect,
  readEditorPanelWidths,
  translateViewBetweenViewports,
  usableEditorViewport,
} from "./editor-viewport";

describe("editor viewport geometry", () => {
  it("clamps malformed and out-of-range persisted panel widths", () => {
    expect(clampEditorPanelWidths({ rail: -500, inspector: 9_000 })).toEqual({ rail: 216, inspector: 360 });
    expect(clampEditorPanelWidths({ rail: Number.NaN, inspector: "wide" })).toEqual({ rail: 224, inspector: 264 });
  });

  it("migrates legacy panel widths without trusting invalid values", () => {
    const values = new Map([[LEGACY_EDITOR_PANEL_WIDTHS_STORAGE_KEY, JSON.stringify({ rail: 320, inspector: 999 })]]);
    const storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => values.set(key, value)),
      removeItem: vi.fn((key: string) => values.delete(key)),
    };
    expect(readEditorPanelWidths(storage)).toEqual({ rail: 320, inspector: 360 });
    expect(JSON.parse(values.get(EDITOR_PANEL_WIDTHS_STORAGE_KEY)!)).toEqual({ rail: 320, inspector: 360 });
    expect(values.has(LEGACY_EDITOR_PANEL_WIDTHS_STORAGE_KEY)).toBe(false);
  });

  it("fits content inside the usable rectangle instead of under editor chrome", () => {
    const viewport = usableEditorViewport(1_000, 800, { top: 56, right: 300, bottom: 40, left: 220 });
    expect(viewport).toEqual({ x: 220, y: 56, width: 480, height: 704 });
    const view = fitWorldRect({ x: 0, y: 0, width: 400, height: 600 }, viewport, { x: 24, y: 24 }, 1.1);
    expect(view.scale).toBeCloseTo(1.08, 3);
    expect(view.x).toBeCloseTo(244, 2);
  });

  it("preserves zoom and the world point at the safe viewport center when panels resize", () => {
    const previous = { x: 0, y: 48, width: 900, height: 700 };
    const next = { x: 220, y: 48, width: 680, height: 700 };
    expect(translateViewBetweenViewports({ x: 100, y: 80, scale: 0.75 }, previous, next)).toEqual({ x: 210, y: 80, scale: 0.75 });
  });
});
