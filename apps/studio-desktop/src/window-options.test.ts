import { describe, expect, it } from "vitest";
import { desktopWindowWebPreferences, navigationAllowed } from "./window-options.ts";

describe("desktop BrowserWindow policy", () => {
  it("keeps the renderer sandboxed and Node-free", () => {
    expect(desktopWindowWebPreferences).toMatchObject({
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
    });
  });

  it("allows only the active local Studio routes", () => {
    const origin = "http://127.0.0.1:43123";
    expect(navigationAllowed(`${origin}/studio`, origin)).toBe(true);
    expect(navigationAllowed(`${origin}/runtime-preview`, origin)).toBe(true);
    expect(navigationAllowed(`${origin}/api/project`, origin)).toBe(false);
    expect(navigationAllowed("https://example.com/studio", origin)).toBe(false);
    expect(navigationAllowed("file:///etc/passwd", origin)).toBe(false);
  });
});
