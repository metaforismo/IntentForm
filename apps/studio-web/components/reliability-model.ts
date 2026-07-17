export const AUTOSAVE_DELAYS = {
  small: 350,
  medium: 900,
  large: 1_800,
} as const;

export function adaptiveAutosaveDelay(serializedBytes: number): number {
  if (!Number.isFinite(serializedBytes) || serializedBytes < 0) return AUTOSAVE_DELAYS.small;
  if (serializedBytes >= 6 * 1024 * 1024) return AUTOSAVE_DELAYS.large;
  if (serializedBytes >= 1024 * 1024) return AUTOSAVE_DELAYS.medium;
  return AUTOSAVE_DELAYS.small;
}

export function virtualWindow(itemCount: number, scrollTop: number, viewportHeight: number, itemHeight: number, overscan = 8) {
  const count = Math.max(0, Math.floor(Number.isFinite(itemCount) ? itemCount : 0));
  const rowHeight = Number.isFinite(itemHeight) && itemHeight > 0 ? itemHeight : 1;
  const top = Math.max(0, Number.isFinite(scrollTop) ? scrollTop : 0);
  const height = Math.max(0, Number.isFinite(viewportHeight) ? viewportHeight : 0);
  const buffer = Math.max(0, Math.floor(Number.isFinite(overscan) ? overscan : 0));
  const start = Math.max(0, Math.floor(top / rowHeight) - buffer);
  const end = Math.min(count, Math.ceil((top + height) / rowHeight) + buffer);
  return { start, end, before: start * rowHeight, after: Math.max(0, (count - end) * rowHeight) };
}

export function compareModeStorageKey(projectId: string): string {
  return `intentform-compare-mode:${projectId}`;
}

export function readBooleanPreference(storage: Pick<Storage, "getItem"> | null, key: string): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(key) === "true";
  } catch {
    return false;
  }
}

export function writeBooleanPreference(storage: Pick<Storage, "setItem"> | null, key: string, value: boolean): void {
  if (!storage) return;
  try {
    storage.setItem(key, String(value));
  } catch {
    // Preferences are best-effort.
  }
}
