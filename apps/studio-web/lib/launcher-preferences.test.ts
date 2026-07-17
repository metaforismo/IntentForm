import { describe, expect, it } from "vitest";
import { defaultLauncherPreferences, parseLauncherPreferences, resolvedAppearance } from "./launcher-preferences";

describe("launcher preferences", () => {
  it("uses safe defaults for missing, corrupt, and unsupported values", () => {
    expect(parseLauncherPreferences(null)).toEqual(defaultLauncherPreferences);
    expect(parseLauncherPreferences("not json")).toEqual(defaultLauncherPreferences);
    expect(parseLauncherPreferences(JSON.stringify({ catalogView: "unknown", sort: "unknown", gridSize: 999 }))).toMatchObject({
      catalogView: "grid",
      sort: "modified",
      gridSize: 24,
    });
  });

  it("restores supported preferences and resolves the system theme explicitly", () => {
    expect(parseLauncherPreferences(JSON.stringify({
      catalogView: "list",
      sort: "status",
      appearance: "dark",
      density: "comfortable",
      reducedMotion: true,
      highContrast: true,
      canvasGrid: false,
      gridSize: 16,
    }))).toEqual({
      catalogView: "list",
      sort: "status",
      appearance: "dark",
      density: "comfortable",
      reducedMotion: true,
      highContrast: true,
      canvasGrid: false,
      gridSize: 16,
    });
    expect(resolvedAppearance("system", true)).toBe("dark");
    expect(resolvedAppearance("system", false)).toBe("light");
  });
});
