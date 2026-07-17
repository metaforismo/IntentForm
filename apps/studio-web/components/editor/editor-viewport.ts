export interface EditorPanelWidths {
  rail: number;
  inspector: number;
}

export interface EditorViewportInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface EditorViewportRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const EDITOR_PANEL_LIMITS = {
  rail: { min: 216, max: 340, default: 224 },
  inspector: { min: 248, max: 360, default: 264 },
} as const;

export const EDITOR_PANEL_WIDTHS_STORAGE_KEY = "intentform-panel-widths-v3";
export const LEGACY_EDITOR_PANEL_WIDTHS_STORAGE_KEY = "intentform-panel-widths-v2";

const finiteNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function clampEditorPanelWidths(value: unknown): EditorPanelWidths {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    rail: clamp(finiteNumber(record.rail) ?? EDITOR_PANEL_LIMITS.rail.default, EDITOR_PANEL_LIMITS.rail.min, EDITOR_PANEL_LIMITS.rail.max),
    inspector: clamp(finiteNumber(record.inspector) ?? EDITOR_PANEL_LIMITS.inspector.default, EDITOR_PANEL_LIMITS.inspector.min, EDITOR_PANEL_LIMITS.inspector.max),
  };
}

export function readEditorPanelWidths(storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null): EditorPanelWidths {
  if (!storage) return clampEditorPanelWidths(null);
  let parsed: unknown;
  try {
    const stored = storage.getItem(EDITOR_PANEL_WIDTHS_STORAGE_KEY)
      ?? storage.getItem(LEGACY_EDITOR_PANEL_WIDTHS_STORAGE_KEY);
    parsed = stored ? JSON.parse(stored) : null;
  } catch {
    parsed = null;
  }
  const widths = clampEditorPanelWidths(parsed);
  try {
    storage.setItem(EDITOR_PANEL_WIDTHS_STORAGE_KEY, JSON.stringify(widths));
    storage.removeItem(LEGACY_EDITOR_PANEL_WIDTHS_STORAGE_KEY);
  } catch {
    // Storage is optional; valid in-memory geometry is still returned.
  }
  return widths;
}

export function usableEditorViewport(width: number, height: number, insets: EditorViewportInsets): EditorViewportRect {
  const left = clamp(insets.left, 0, Math.max(0, width));
  const top = clamp(insets.top, 0, Math.max(0, height));
  const right = clamp(insets.right, 0, Math.max(0, width - left));
  const bottom = clamp(insets.bottom, 0, Math.max(0, height - top));
  return {
    x: left,
    y: top,
    width: Math.max(1, width - left - right),
    height: Math.max(1, height - top - bottom),
  };
}

export function fitWorldRect(
  world: { x: number; y: number; width: number; height: number },
  viewport: EditorViewportRect,
  padding: { x: number; y: number },
  maxScale: number,
  minScale = 0.12,
): { x: number; y: number; scale: number } {
  const availableWidth = Math.max(1, viewport.width - padding.x * 2);
  const availableHeight = Math.max(1, viewport.height - padding.y * 2);
  const scale = clamp(Math.min(availableWidth / world.width, availableHeight / world.height, maxScale), minScale, maxScale);
  return {
    scale,
    x: viewport.x + viewport.width / 2 - (world.x + world.width / 2) * scale,
    y: viewport.y + viewport.height / 2 - (world.y + world.height / 2) * scale,
  };
}

export function translateViewBetweenViewports(
  view: { x: number; y: number; scale: number },
  previous: EditorViewportRect,
  next: EditorViewportRect,
): { x: number; y: number; scale: number } {
  return {
    ...view,
    x: view.x + (next.x + next.width / 2) - (previous.x + previous.width / 2),
    y: view.y + (next.y + next.height / 2) - (previous.y + previous.height / 2),
  };
}
