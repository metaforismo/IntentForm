import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { agentAccessForTool, readAgentActivity, recordAgentActivity } from "./activity.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "intentform-agent-activity-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("metadata-only agent activity", () => {
  it("records only bounded non-sensitive outcome metadata in a private file", () => {
    for (let index = 0; index < 110; index += 1) {
      recordAgentActivity(dir, {
        transport: index % 2 === 0 ? "stdio" : "http",
        tool: "intentform_describe_project",
        access: "read",
        outcome: "succeeded",
        durationMs: index + 0.4,
      });
    }

    const result = readAgentActivity(dir);
    expect(result.entries).toHaveLength(100);
    expect(result.entries[0]).toMatchObject({
      transport: "http",
      tool: "intentform_describe_project",
      access: "read",
      outcome: "succeeded",
      durationMs: 109,
    });
    expect(result.entries[0]?.id).toMatch(/^[a-f0-9-]{36}$/);
    expect(result.entries[0]?.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const activityFile = join(dir, "agent-activity.json");
    expect(statSync(activityFile).mode & 0o777).toBe(0o600);
    const stored = readFileSync(activityFile, "utf8");
    expect(stored).not.toMatch(/argument|authorization|bearer|secret|content|output|sourcePath/i);
  });

  it("publishes an explicit least-authority policy without exposing a credential", () => {
    const prior = process.env.INTENTFORM_MCP_TOKEN;
    process.env.INTENTFORM_MCP_TOKEN = "not-returned";
    try {
      const { policy } = readAgentActivity(dir);
      expect(policy).toMatchObject({
        scope: "current-local-project",
        arbitraryShell: false,
        arbitraryFilesystem: false,
        outboundNetwork: false,
        http: { configured: true, binding: "127.0.0.1", bearerAuthentication: "required" },
        excludedFields: ["arguments", "tokens", "paths", "content", "outputs"],
      });
      expect(JSON.stringify(policy)).not.toContain("not-returned");
    } finally {
      if (prior === undefined) delete process.env.INTENTFORM_MCP_TOKEN;
      else process.env.INTENTFORM_MCP_TOKEN = prior;
    }
  });

  it("recovers from malformed optional evidence without affecting future records", () => {
    writeFileSync(join(dir, "agent-activity.json"), "{not-json", "utf8");
    expect(readAgentActivity(dir).entries).toEqual([]);
    recordAgentActivity(dir, {
      transport: "stdio",
      tool: "intentform_apply_patch",
      access: "write",
      outcome: "failed",
      durationMs: Number.POSITIVE_INFINITY,
    });
    expect(readAgentActivity(dir).entries).toEqual([
      expect.objectContaining({ tool: "intentform_apply_patch", durationMs: 0 }),
    ]);
  });

  it("skips a live writer and recovers an abandoned activity lock", () => {
    const lock = join(dir, ".agent-activity.lock");
    writeFileSync(lock, "", { mode: 0o600 });
    const entry = {
      transport: "stdio" as const,
      tool: "intentform_get_graph",
      access: "read" as const,
      outcome: "succeeded" as const,
      durationMs: 1,
    };
    recordAgentActivity(dir, entry);
    expect(readAgentActivity(dir).entries).toEqual([]);

    const stale = new Date(Date.now() - 10_000);
    utimesSync(lock, stale, stale);
    recordAgentActivity(dir, entry);
    expect(readAgentActivity(dir).entries).toHaveLength(1);
    expect(existsSync(lock)).toBe(false);
  });

  it("classifies reads, previews, transactions and writes deterministically", () => {
    expect(agentAccessForTool("intentform_get_graph", true)).toBe("read");
    expect(agentAccessForTool("intentform_preview_patch", true)).toBe("preview");
    expect(agentAccessForTool("intentform_commit_transaction", false)).toBe("transaction");
    expect(agentAccessForTool("intentform_apply_patch", false)).toBe("write");
  });
});
