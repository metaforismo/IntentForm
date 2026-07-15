import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ToolchainId, ToolchainStatus } from "./protocol.ts";
import { sanitizeDesktopText } from "./security.ts";

export interface DesktopCommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface DesktopCommandRunner {
  run(executable: string, args: readonly string[], options: { cwd?: string; timeoutMs: number }): Promise<DesktopCommandResult>;
}

export interface ToolchainPaths {
  node?: string;
  git?: string;
  pnpmCli?: string;
  expoCli?: string;
  xcrun?: string;
  adb?: string;
}

interface Probe {
  id: ToolchainId;
  label: string;
  supported: boolean;
  executable: string | undefined;
  args: readonly string[];
}

function versionText(result: DesktopCommandResult): string {
  return sanitizeDesktopText((result.stdout || result.stderr).split(/\r?\n/).filter(Boolean).slice(0, 2).join(" · "));
}

export function defaultToolchainPaths(workspaceRoot: string, environment: NodeJS.ProcessEnv = process.env): ToolchainPaths {
  const androidRoot = environment.ANDROID_HOME ?? environment.ANDROID_SDK_ROOT;
  const candidates: Record<keyof ToolchainPaths, string | undefined> = {
    node: environment.INTENTFORM_NODE_PATH ?? environment.npm_node_execpath,
    git: process.platform === "win32" ? environment.INTENTFORM_GIT_PATH : "/usr/bin/git",
    pnpmCli: join(workspaceRoot, "node_modules/pnpm/bin/pnpm.cjs"),
    expoCli: join(workspaceRoot, "apps/expo-preview/node_modules/expo/bin/cli"),
    xcrun: process.platform === "darwin" ? "/usr/bin/xcrun" : undefined,
    adb: androidRoot ? join(androidRoot, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb") : undefined,
  };
  return Object.fromEntries(Object.entries(candidates).filter(([, path]) => path && existsSync(path))) as ToolchainPaths;
}

export async function probeToolchains(
  platform: NodeJS.Platform,
  paths: ToolchainPaths,
  runner: DesktopCommandRunner,
): Promise<ToolchainStatus[]> {
  const probes: Probe[] = [
    { id: "node", label: "Node.js", supported: true, executable: paths.node, args: ["--version"] },
    { id: "git", label: "Git", supported: true, executable: paths.git, args: ["--version"] },
    { id: "pnpm", label: "pnpm", supported: true, executable: paths.node, args: paths.pnpmCli ? [paths.pnpmCli, "--version"] : [] },
    { id: "expo", label: "Expo", supported: true, executable: paths.node, args: paths.expoCli ? [paths.expoCli, "--version"] : [] },
    { id: "xcode", label: "Xcode", supported: platform === "darwin", executable: paths.xcrun, args: ["xcodebuild", "-version"] },
    { id: "android", label: "Android SDK", supported: true, executable: paths.adb, args: ["version"] },
  ];
  return Promise.all(probes.map(async (probe): Promise<ToolchainStatus> => {
    if (!probe.supported) return { id: probe.id, label: probe.label, status: "unsupported", version: null, detail: "Not available on this operating system." };
    if (!probe.executable || (probe.id === "pnpm" && !paths.pnpmCli) || (probe.id === "expo" && !paths.expoCli)) {
      return { id: probe.id, label: probe.label, status: "missing", version: null, detail: "Toolchain executable was not found in the trusted installation paths." };
    }
    try {
      const result = await runner.run(probe.executable, probe.args, { timeoutMs: 5_000 });
      const version = versionText(result);
      return result.code === 0
        ? { id: probe.id, label: probe.label, status: "available", version: version || null, detail: "Available" }
        : { id: probe.id, label: probe.label, status: "failed", version: null, detail: version || `Probe exited with code ${result.code ?? "unknown"}.` };
    } catch (error) {
      return { id: probe.id, label: probe.label, status: "failed", version: null, detail: sanitizeDesktopText(error instanceof Error ? error.message : "Toolchain probe failed.") };
    }
  }));
}
