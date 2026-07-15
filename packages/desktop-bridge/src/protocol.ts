import { z } from "zod";

export const desktopServiceIdSchema = z.enum(["studio", "mcp"]);
export type DesktopServiceId = z.infer<typeof desktopServiceIdSchema>;

export const desktopServicePhaseSchema = z.enum([
  "stopped",
  "starting",
  "ready",
  "stopping",
  "crashed",
]);

export const toolchainIdSchema = z.enum(["node", "git", "pnpm", "expo", "xcode", "android"]);
export type ToolchainId = z.infer<typeof toolchainIdSchema>;

export const toolchainStatusSchema = z.strictObject({
  id: toolchainIdSchema,
  label: z.string().min(1).max(80),
  status: z.enum(["available", "missing", "unsupported", "failed"]),
  version: z.string().max(240).nullable(),
  detail: z.string().max(240),
});
export type ToolchainStatus = z.infer<typeof toolchainStatusSchema>;

export const gitSnapshotSchema = z.strictObject({
  available: z.boolean(),
  repository: z.boolean(),
  branch: z.string().max(240).nullable(),
  upstream: z.string().max(240).nullable(),
  ahead: z.number().int().min(0).max(1_000_000),
  behind: z.number().int().min(0).max(1_000_000),
  changed: z.number().int().min(0).max(1_000_000),
  branches: z.array(z.strictObject({ name: z.string().max(240), current: z.boolean() })).max(500),
  commits: z.array(z.strictObject({
    hash: z.string().regex(/^[a-f0-9]{7,64}$/i),
    authoredAt: z.string().datetime(),
    subject: z.string().max(400),
  })).max(20),
  message: z.string().max(240),
});
export type GitSnapshot = z.infer<typeof gitSnapshotSchema>;

export const desktopSnapshotSchema = z.strictObject({
  version: z.literal(1),
  platform: z.enum(["darwin", "linux", "win32"]),
  appVersion: z.string().min(1).max(40),
  project: z.strictObject({
    granted: z.boolean(),
    name: z.string().max(240).nullable(),
    path: z.string().max(4_096).nullable(),
  }),
  services: z.array(z.strictObject({
    id: desktopServiceIdSchema,
    phase: desktopServicePhaseSchema,
    pid: z.number().int().positive().nullable(),
    restarts: z.number().int().min(0).max(3),
    message: z.string().max(240),
  })).length(2),
  toolchains: z.array(toolchainStatusSchema).length(6),
  git: gitSnapshotSchema.nullable(),
  update: z.strictObject({
    supported: z.boolean(),
    phase: z.enum(["disabled", "idle", "checking", "available", "current", "downloaded", "failed"]),
    message: z.string().max(240),
  }),
});
export type DesktopSnapshot = z.infer<typeof desktopSnapshotSchema>;

export const desktopIpcChannels = {
  snapshot: "intentform:desktop:snapshot",
  chooseProject: "intentform:desktop:choose-project",
  refreshToolchains: "intentform:desktop:refresh-toolchains",
  refreshGit: "intentform:desktop:refresh-git",
  setService: "intentform:desktop:set-service",
  copyMcpConfiguration: "intentform:desktop:copy-mcp-configuration",
  openExternal: "intentform:desktop:open-external",
  checkForUpdates: "intentform:desktop:check-for-updates",
  changed: "intentform:desktop:changed",
} as const;

export const serviceCommandSchema = z.strictObject({
  service: desktopServiceIdSchema,
  action: z.enum(["start", "stop", "restart"]),
});

export const externalUrlRequestSchema = z.strictObject({
  url: z.string().min(1).max(2_048),
});

export interface IntentFormDesktopApi {
  readonly runtimeSecurity: Readonly<{ rendererSandboxed: boolean; contextIsolated: boolean }>;
  snapshot(): Promise<DesktopSnapshot>;
  chooseProject(): Promise<DesktopSnapshot>;
  refreshToolchains(): Promise<DesktopSnapshot>;
  refreshGit(): Promise<DesktopSnapshot>;
  setService(input: z.infer<typeof serviceCommandSchema>): Promise<DesktopSnapshot>;
  copyMcpConfiguration(): Promise<void>;
  openExternal(input: z.infer<typeof externalUrlRequestSchema>): Promise<void>;
  checkForUpdates(): Promise<DesktopSnapshot>;
  onChanged(listener: (snapshot: DesktopSnapshot) => void): () => void;
}
