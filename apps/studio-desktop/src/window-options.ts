export const desktopWindowWebPreferences = {
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  nodeIntegrationInSubFrames: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  experimentalFeatures: false,
  spellcheck: true,
} as const;

export function navigationAllowed(target: string, studioOrigin: string): boolean {
  try {
    const url = new URL(target);
    const origin = new URL(studioOrigin);
    return url.origin === origin.origin && ["/", "/studio", "/runtime-preview"].includes(url.pathname);
  } catch {
    return false;
  }
}
