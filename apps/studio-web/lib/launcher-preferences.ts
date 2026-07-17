import type { CatalogSort } from "./launcher-model";

export const LAUNCHER_PREFERENCES_KEY = "intentform-launcher-preferences-v1";

export interface LauncherPreferences {
  catalogView: "grid" | "list";
  sort: CatalogSort;
  appearance: "light" | "dark" | "system";
  density: "compact" | "comfortable";
  reducedMotion: boolean;
  highContrast: boolean;
  canvasGrid: boolean;
  gridSize: 8 | 16 | 24 | 32;
}

export const defaultLauncherPreferences: LauncherPreferences = {
  catalogView: "grid",
  sort: "modified",
  appearance: "system",
  density: "compact",
  reducedMotion: false,
  highContrast: false,
  canvasGrid: true,
  gridSize: 24,
};

export function parseLauncherPreferences(value: string | null): LauncherPreferences {
  if (!value) return defaultLauncherPreferences;
  try {
    const input = JSON.parse(value) as Partial<LauncherPreferences>;
    return {
      catalogView: input.catalogView === "list" ? "list" : "grid",
      sort: input.sort === "name" || input.sort === "type" || input.sort === "status" ? input.sort : "modified",
      appearance: input.appearance === "light" || input.appearance === "dark" ? input.appearance : "system",
      density: input.density === "comfortable" ? "comfortable" : "compact",
      reducedMotion: input.reducedMotion === true,
      highContrast: input.highContrast === true,
      canvasGrid: input.canvasGrid !== false,
      gridSize: input.gridSize === 8 || input.gridSize === 16 || input.gridSize === 32 ? input.gridSize : 24,
    };
  } catch {
    return defaultLauncherPreferences;
  }
}

export function resolvedAppearance(preference: LauncherPreferences["appearance"], systemDark: boolean): "light" | "dark" {
  return preference === "system" ? (systemDark ? "dark" : "light") : preference;
}

export function applyLauncherPreferences(preferences: LauncherPreferences, systemDark: boolean): void {
  const root = document.documentElement;
  const theme = resolvedAppearance(preferences.appearance, systemDark);
  root.dataset.theme = theme;
  root.dataset.ifDensity = preferences.density;
  root.toggleAttribute("data-if-reduced-motion", preferences.reducedMotion);
  root.toggleAttribute("data-if-high-contrast", preferences.highContrast);
  root.toggleAttribute("data-if-canvas-grid", preferences.canvasGrid);
  root.style.setProperty("--if-user-grid-size", `${preferences.gridSize}px`);
  window.localStorage.setItem("intentform-theme", theme);
}
