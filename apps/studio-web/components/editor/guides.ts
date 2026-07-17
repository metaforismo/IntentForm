export type GuideAxis = "horizontal" | "vertical";

export interface EditorGuide {
  id: string;
  axis: GuideAxis;
  position: number;
  locked: boolean;
  hidden: boolean;
}

export interface EditorGuidePreferences {
  visible: boolean;
  snap: boolean;
  byScreen: Record<string, EditorGuide[]>;
}

export const MAX_GUIDES_PER_SCREEN = 64;
const MIN_GUIDE_POSITION = -2_000;
const MAX_GUIDE_POSITION = 10_000;

export const defaultGuidePreferences = (): EditorGuidePreferences => ({
  visible: true,
  snap: true,
  byScreen: {},
});

export function guideStorageKey(projectId: string): string {
  return `intentform-editor-guides-v1:${projectId}`;
}

function validGuide(value: unknown): EditorGuide | null {
  if (!value || typeof value !== "object") return null;
  const guide = value as Partial<EditorGuide>;
  if (typeof guide.id !== "string" || !/^[a-z][a-z0-9.-]{0,95}$/.test(guide.id)) return null;
  if (guide.axis !== "horizontal" && guide.axis !== "vertical") return null;
  if (typeof guide.position !== "number" || !Number.isFinite(guide.position)) return null;
  return {
    id: guide.id,
    axis: guide.axis,
    position: Math.min(MAX_GUIDE_POSITION, Math.max(MIN_GUIDE_POSITION, guide.position)),
    locked: guide.locked === true,
    hidden: guide.hidden === true,
  };
}

export function parseGuidePreferences(value: string | null): EditorGuidePreferences {
  if (!value) return defaultGuidePreferences();
  try {
    const parsed = JSON.parse(value) as Partial<EditorGuidePreferences>;
    const byScreen = Object.fromEntries(Object.entries(parsed.byScreen ?? {}).slice(0, 128).flatMap(([screenId, guides]) => {
      if (!/^[a-z][a-z0-9.-]{0,95}$/.test(screenId) || !Array.isArray(guides)) return [];
      const unique = new Map<string, EditorGuide>();
      for (const value of guides.slice(0, MAX_GUIDES_PER_SCREEN)) {
        const guide = validGuide(value);
        if (guide && !unique.has(guide.id)) unique.set(guide.id, guide);
      }
      return [[screenId, [...unique.values()]]];
    }));
    return { visible: parsed.visible !== false, snap: parsed.snap !== false, byScreen };
  } catch {
    return defaultGuidePreferences();
  }
}

export function readGuidePreferences(storage: Pick<Storage, "getItem"> | null, projectId: string): EditorGuidePreferences {
  if (!storage) return defaultGuidePreferences();
  try {
    return parseGuidePreferences(storage.getItem(guideStorageKey(projectId)));
  } catch {
    return defaultGuidePreferences();
  }
}

export function writeGuidePreferences(storage: Pick<Storage, "setItem"> | null, projectId: string, preferences: EditorGuidePreferences): void {
  if (!storage) return;
  try {
    storage.setItem(guideStorageKey(projectId), JSON.stringify(preferences));
  } catch {
    // Editor metadata must never block graph editing when browser storage is full.
  }
}

export function nextGuideId(guides: readonly EditorGuide[], axis: GuideAxis): string {
  const prefix = axis === "vertical" ? "guide-v" : "guide-h";
  const used = new Set(guides.map((guide) => guide.id));
  for (let index = 1; index <= MAX_GUIDES_PER_SCREEN; index += 1) {
    const candidate = `${prefix}-${index}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${prefix}-${MAX_GUIDES_PER_SCREEN}`;
}

export function visibleGuidePositions(guides: readonly EditorGuide[], snap: boolean): { x: number[]; y: number[] } {
  if (!snap) return { x: [], y: [] };
  return {
    x: guides.filter((guide) => guide.axis === "vertical" && !guide.hidden).map((guide) => guide.position),
    y: guides.filter((guide) => guide.axis === "horizontal" && !guide.hidden).map((guide) => guide.position),
  };
}
