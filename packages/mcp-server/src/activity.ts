import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const ACTIVITY_FILE = "agent-activity.json";
const ACTIVITY_LOCK = ".agent-activity.lock";
const MAX_ACTIVITY_ENTRIES = 100;
const STALE_LOCK_MS = 5_000;

export type AgentTransport = "stdio" | "http";
export type AgentActivityOutcome = "succeeded" | "failed" | "cancelled" | "rejected";
export type AgentActivityAccess = "read" | "write" | "transaction" | "preview";

export interface AgentActivityEntry {
  id: string;
  at: string;
  transport: AgentTransport;
  tool: string;
  access: AgentActivityAccess;
  outcome: AgentActivityOutcome;
  durationMs: number;
}

interface AgentActivityFile {
  version: 1;
  entries: AgentActivityEntry[];
}

function activityPath(projectDir: string): string {
  return join(projectDir, ACTIVITY_FILE);
}

function validEntry(input: unknown): input is AgentActivityEntry {
  if (!input || typeof input !== "object") return false;
  const entry = input as Partial<AgentActivityEntry>;
  return typeof entry.id === "string"
    && typeof entry.at === "string"
    && (entry.transport === "stdio" || entry.transport === "http")
    && typeof entry.tool === "string"
    && ["read", "write", "transaction", "preview"].includes(entry.access ?? "")
    && ["succeeded", "failed", "cancelled", "rejected"].includes(entry.outcome ?? "")
    && typeof entry.durationMs === "number"
    && Number.isFinite(entry.durationMs);
}

function readEntries(projectDir: string): AgentActivityEntry[] {
  try {
    const parsed = JSON.parse(readFileSync(activityPath(projectDir), "utf8")) as Partial<AgentActivityFile>;
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) return [];
    return parsed.entries.filter(validEntry).slice(0, MAX_ACTIVITY_ENTRIES);
  } catch {
    return [];
  }
}

function acquireActivityLock(projectDir: string): number | null {
  const lockPath = join(projectDir, ACTIVITY_LOCK);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return openSync(lockPath, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") return null;
      try {
        if (Date.now() - statSync(lockPath).mtimeMs <= STALE_LOCK_MS) return null;
        rmSync(lockPath, { force: true });
      } catch {
        return null;
      }
    }
  }
  return null;
}

function releaseActivityLock(projectDir: string, descriptor: number): void {
  try {
    closeSync(descriptor);
  } finally {
    rmSync(join(projectDir, ACTIVITY_LOCK), { force: true });
  }
}

export function agentAccessForTool(tool: string, readOnly: boolean): AgentActivityAccess {
  if (tool.includes("transaction")) return "transaction";
  if (tool.includes("preview")) return "preview";
  return readOnly ? "read" : "write";
}

export function recordAgentActivity(
  projectDir: string,
  entry: Omit<AgentActivityEntry, "id" | "at" | "durationMs"> & { durationMs: number },
): void {
  try {
    mkdirSync(projectDir, { recursive: true });
    const descriptor = acquireActivityLock(projectDir);
    if (descriptor === null) return;
    try {
      const next: AgentActivityFile = {
        version: 1,
        entries: [{
          id: randomUUID(),
          at: new Date().toISOString(),
          transport: entry.transport,
          tool: entry.tool.slice(0, 120),
          access: entry.access,
          outcome: entry.outcome,
          durationMs: Number.isFinite(entry.durationMs)
            ? Math.max(0, Math.min(Math.round(entry.durationMs), 24 * 60 * 60_000))
            : 0,
        }, ...readEntries(projectDir)].slice(0, MAX_ACTIVITY_ENTRIES),
      };
      const temporaryPath = join(projectDir, `.agent-activity-${process.pid}-${randomUUID()}.tmp`);
      try {
        writeFileSync(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
        renameSync(temporaryPath, activityPath(projectDir));
      } finally {
        rmSync(temporaryPath, { force: true });
      }
    } finally {
      releaseActivityLock(projectDir, descriptor);
    }
  } catch {
    // Activity evidence must never change the result of a semantic operation.
  }
}

export function readAgentActivity(projectDir: string) {
  return {
    policy: {
      scope: "current-local-project" as const,
      semanticWrites: "schema-validated, fingerprint-checked, revisioned" as const,
      arbitraryShell: false,
      arbitraryFilesystem: false,
      outboundNetwork: false,
      stdio: { available: true, boundary: "local-process" as const },
      http: {
        configured: Boolean(process.env.INTENTFORM_MCP_TOKEN),
        binding: "127.0.0.1" as const,
        bearerAuthentication: "required" as const,
      },
      loggedFields: ["time", "transport", "tool", "access", "outcome", "duration"] as const,
      excludedFields: ["arguments", "tokens", "paths", "content", "outputs"] as const,
    },
    entries: readEntries(projectDir),
  };
}
