import { resolve } from "node:path";

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;
const SECRET_ASSIGNMENT = /\b(api[-_]?key|authorization|token|secret|password)\s*[:=]\s*[^\s,;]+/gi;

export function sanitizeDesktopText(input: string, maximum = 240): string {
  return input
    .replace(/\u001B(?:[@-_][0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/g, "")
    .replace(SECRET_ASSIGNMENT, "$1=[redacted]")
    .replace(CONTROL_CHARACTERS, "")
    .trim()
    .slice(0, maximum);
}

export function safeExternalUrl(input: string): string {
  if (input.length > 2_048) throw new Error("External URL exceeds the desktop limit.");
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("External URL is invalid.");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Desktop links must use credential-free HTTPS URLs.");
  }
  return url.href;
}

export function isTrustedRendererUrl(senderUrl: string, studioOrigin: string): boolean {
  try {
    const sender = new URL(senderUrl);
    const trusted = new URL(studioOrigin);
    return sender.origin === trusted.origin && ["/", "/studio"].includes(sender.pathname);
  } catch {
    return false;
  }
}

export function minimalDesktopEnvironment(
  source: NodeJS.ProcessEnv,
  additions: Record<string, string> = {},
): NodeJS.ProcessEnv {
  const allowed = ["HOME", "PATH", "TMPDIR", "LANG", "LC_ALL", "DEVELOPER_DIR", "ANDROID_HOME", "ANDROID_SDK_ROOT"] as const;
  const result: NodeJS.ProcessEnv = {
    CI: "1",
    NODE_ENV: "production",
    EXPO_NO_TELEMETRY: "1",
    ...additions,
  };
  for (const key of allowed) if (source[key]) result[key] = source[key];
  delete result.NODE_OPTIONS;
  delete result.ELECTRON_RUN_AS_NODE;
  return result;
}

export function assertGrantedPath(grantedRoot: string, candidate: string): string {
  const granted = resolve(grantedRoot);
  const requested = resolve(candidate);
  if (requested !== granted) throw new Error("The requested project does not match the active path grant.");
  return requested;
}
