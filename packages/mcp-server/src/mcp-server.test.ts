import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { demoGraph } from "@intentform/proof-report/demo";
import { compileReact } from "@intentform/compiler-react";
import { toolDefinitions } from "./index.ts";
import {
  applyMigration,
  applyPatch,
  compileProject,
  describeProject,
  diffAgainstRevision,
  projectRevisions,
  previewMigration,
  replaceGraph,
  revertProject,
  verifyProject,
} from "./tools.ts";
import {
  loadProject,
  migrateProject,
  ProjectBusyError,
  ProjectConflictError,
  ProjectMigrationConflictError,
  ProjectMigrationRequiredError,
  previewProjectMigration,
  saveProject,
} from "./store.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "intentform-mcp-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("IntentForm agent project store", () => {
  it("publishes migration preview and apply as separate MCP tools", () => {
    const byName = new Map(toolDefinitions.map((tool) => [tool.name, tool]));
    expect(byName.get("intentform_preview_migration")?.inputSchema).toEqual({
      type: "object",
      properties: {},
      additionalProperties: false,
    });
    expect(byName.get("intentform_apply_migration")?.inputSchema).toMatchObject({
      required: ["expectedSourceFingerprint"],
      additionalProperties: false,
    });
  });

  it("seeds a missing project from the verified sample and validates on load", () => {
    const first = loadProject(dir);
    expect(first.seeded).toBe(true);
    expect(first.graph).toEqual(demoGraph);
    const second = loadProject(dir);
    expect(second.seeded).toBe(false);
    expect(second.fingerprint).toBe(first.fingerprint);
  });

  it("previews an old schema without writing, then checkpoints exact bytes before migration", () => {
    const legacy = structuredClone(demoGraph) as unknown as Record<string, unknown>;
    legacy.schemaVersion = "0.0.1";
    const source = `  ${JSON.stringify(legacy, null, 4)}\n`;
    writeFileSync(join(dir, "graph.json"), source, "utf8");

    const preview = previewProjectMigration(dir);
    expect(preview).toMatchObject({
      status: "migration-required",
      fromVersion: "0.0.1",
      toVersion: "0.1.0",
      sourceFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(readdirSync(dir)).toEqual(["graph.json"]);
    expect(() => loadProject(dir)).toThrow(ProjectMigrationRequiredError);

    const expected = preview.status === "missing" ? "" : preview.sourceFingerprint;
    const applied = migrateProject(dir, expected);
    expect(applied).toMatchObject({
      status: "current",
      fromVersion: "0.0.1",
      toVersion: "0.1.0",
      fingerprint: expect.stringMatching(/^[a-f0-9]{8}$/),
    });
    expect(applied.checkpoint).toMatch(/migration-checkpoints/);
    expect(readFileSync(applied.checkpoint!, "utf8")).toBe(source);
    expect(JSON.parse(readFileSync(join(dir, "graph.json"), "utf8"))).toEqual(demoGraph);
    expect(loadProject(dir).graph).toEqual(demoGraph);
    expect(compileProject(dir, "react", false).fileCount).toBeGreaterThan(0);
    expect(compileProject(dir, "swiftui", false).fileCount).toBeGreaterThan(0);
  });

  it("leaves the old graph untouched when its checkpoint cannot be written", () => {
    const legacy = structuredClone(demoGraph) as unknown as Record<string, unknown>;
    legacy.schemaVersion = "0.0.1";
    const source = JSON.stringify(legacy);
    writeFileSync(join(dir, "graph.json"), source, "utf8");
    writeFileSync(join(dir, "migration-checkpoints"), "not-a-directory", "utf8");
    const preview = previewProjectMigration(dir);
    const expected = preview.status === "missing" ? "" : preview.sourceFingerprint;

    expect(() => migrateProject(dir, expected)).toThrow();
    expect(readFileSync(join(dir, "graph.json"), "utf8")).toBe(source);
  });

  it("rejects malformed and future project files without rewriting them", () => {
    for (const source of ["{", JSON.stringify({ schemaVersion: "9.0.0" })]) {
      writeFileSync(join(dir, "graph.json"), source, "utf8");
      expect(() => previewProjectMigration(dir)).toThrow();
      expect(() => loadProject(dir)).toThrow();
      expect(readFileSync(join(dir, "graph.json"), "utf8")).toBe(source);
      expect(readdirSync(dir)).toEqual(["graph.json"]);
    }
  });

  it("rejects a stale migration preview without creating a checkpoint", () => {
    const legacy = structuredClone(demoGraph) as unknown as Record<string, unknown>;
    legacy.schemaVersion = "0.0.1";
    writeFileSync(join(dir, "graph.json"), JSON.stringify(legacy), "utf8");
    const preview = previewProjectMigration(dir);
    expect(preview.status).toBe("migration-required");

    writeFileSync(join(dir, "graph.json"), `${JSON.stringify(legacy)}\n`, "utf8");
    const expected = preview.status === "missing" ? "" : preview.sourceFingerprint;
    expect(() => migrateProject(dir, expected)).toThrow(ProjectMigrationConflictError);
    expect(readdirSync(dir)).toEqual(["graph.json"]);
  });

  it("does not checkpoint or rewrite a current project during an identity migration", () => {
    const source = JSON.stringify(demoGraph);
    writeFileSync(join(dir, "graph.json"), source, "utf8");
    const preview = previewProjectMigration(dir);
    expect(preview.status).toBe("current");
    const expected = preview.status === "missing" ? "" : preview.sourceFingerprint;
    const applied = migrateProject(dir, expected);

    expect(applied.checkpoint).toBeNull();
    expect(readFileSync(join(dir, "graph.json"), "utf8")).toBe(source);
    expect(readdirSync(dir)).toEqual(["graph.json"]);
  });

  it("exposes read-only preview and explicit apply operations to MCP callers", () => {
    const legacy = structuredClone(demoGraph) as unknown as Record<string, unknown>;
    legacy.schemaVersion = "0.0.1";
    writeFileSync(join(dir, "graph.json"), JSON.stringify(legacy), "utf8");

    const preview = previewMigration(dir);
    expect(preview.status).toBe("migration-required");
    const expected = preview.status === "missing" ? "" : preview.sourceFingerprint;
    const applied = applyMigration(dir, expected);

    expect(applied).toMatchObject({ status: "current", checkpoint: expect.any(String) });
    expect(applied).not.toHaveProperty("graph");
    expect(previewMigration(dir)).toMatchObject({ status: "current", fromVersion: "0.1.0" });
  });

  it("writes atomically and rejects a stale writer without losing the winning graph", () => {
    const opened = loadProject(dir);
    const agentGraph = structuredClone(opened.graph);
    agentGraph.tokens.colors["color.accent"] = "#7a4b9e";
    const agentSave = saveProject(dir, agentGraph, "agent color change", opened.fingerprint);

    const staleStudioGraph = structuredClone(opened.graph);
    staleStudioGraph.tokens.colors["color.accent"] = "#315fcb";
    expect(() => saveProject(dir, staleStudioGraph, "stale studio save", opened.fingerprint))
      .toThrow(ProjectConflictError);

    expect(loadProject(dir).graph.tokens.colors["color.accent"]).toBe("#7a4b9e");
    expect(loadProject(dir).fingerprint).toBe(agentSave.fingerprint);
    expect(projectRevisions(dir).revisions).toHaveLength(1);
    expect(readdirSync(dir).filter((entry) => entry.startsWith(".") && entry.endsWith(".tmp"))).toEqual([]);
    expect(readdirSync(dir)).not.toContain(".write.lock");
  });

  it("fails closed while another process owns the project write lock", () => {
    const opened = loadProject(dir);
    writeFileSync(join(dir, ".write.lock"), "another-process\n", "utf8");
    expect(() => saveProject(dir, opened.graph, "contended save", opened.fingerprint))
      .toThrow(ProjectBusyError);
  });

  it("recovers a write lock left behind by a terminated process", () => {
    const opened = loadProject(dir);
    writeFileSync(join(dir, ".write.lock"), "99999999\n", "utf8");
    expect(saveProject(dir, opened.graph, "recover stale lock", opened.fingerprint).fingerprint)
      .toBe(opened.fingerprint);
    expect(readdirSync(dir)).not.toContain(".write.lock");
  });

  it("describes the project with stable node ids and compiler fingerprints", () => {
    const summary = describeProject(dir);
    expect(summary.project).toEqual({
      kind: "local",
      root: dir,
      graphFile: join(dir, ".intentform", "graph.json"),
    });
    expect(summary.product.name).toBe("Verdant Pay");
    expect(summary.screens.map((screen) => screen.id)).toEqual(["home", "payment-request", "receipt"]);
    expect(summary.screens[1]?.nodes.map((node) => node.id)).toContain("payment-request.confirm");
    expect(summary.outputs.react).toEqual({
      status: "generated",
      fingerprint: compileReact(demoGraph).fingerprint,
      diagnosticCount: 0,
      diagnostics: [],
      message: null,
    });
    expect(summary.verification.buildStatus).toBe("not-run");
    expect(summary.verification.passed).toBe(false);
  });

  it("describes a disabled compiler target without throwing or fabricating a fingerprint", () => {
    const graph = structuredClone(demoGraph);
    graph.platforms.find((platform) => platform.target === "react")!.enabled = false;
    replaceGraph(dir, graph, "disable React output");

    const summary = describeProject(dir);
    expect(summary.outputs.react).toEqual({
      status: "disabled",
      fingerprint: null,
      message: expect.stringMatching(/react target is not enabled/i),
    });
    expect(summary.outputs.swiftui.status).toBe("generated");
  });

  it("applies a typed patch atomically, records a revision and re-verifies", () => {
    const result = applyPatch(dir, {
      id: "edit.test",
      rationale: "Keep the confirm action reachable on compact devices",
      operations: [{ op: "set-placement", target: "payment-request.confirm", compact: "persistent-bottom", regular: "inline" }],
    });
    expect(result.changes).toEqual([
      expect.objectContaining({ path: "payment-request.confirm.layout.placement" }),
    ]);
    expect(result.verification.buildStatus).toBe("not-run");
    expect(result.verification.passed).toBe(false);
    expect(result.verification.findings).toContainEqual(expect.objectContaining({
      id: "swiftui.build.not-run",
    }));
    expect(result.revision?.reason).toContain("reachable");
    expect(projectRevisions(dir).revisions).toHaveLength(1);
  });

  it("edits preview fixtures through a typed patch and reports a field-level diff", () => {
    const result = applyPatch(dir, {
      id: "edit.fixture-recipient",
      rationale: "Show the alternate failed-payment recipient",
      operations: [{
        op: "set-fixture-value",
        screenId: "payment-request",
        state: "failed",
        field: "recipientName",
        value: "Elena Serra",
      }],
    });

    expect(result.changes).toContainEqual({
      path: "fixtures.payment-request.failed.data.recipientName",
      before: "Mara Rinaldi",
      after: "Elena Serra",
    });
    expect(loadProject(dir).graph.fixtures.find((fixture) => fixture.id === "payment-request.failed")?.data.recipientName)
      .toBe("Elena Serra");
  });

  it("rejects invalid patches without touching the project", () => {
    expect(() => applyPatch(dir, {
      id: "edit.bad",
      rationale: "invalid",
      operations: [{ op: "set-label", target: "missing.node", label: "Nope" }],
    })).toThrow(/Patch target not found/);
    expect(projectRevisions(dir).revisions).toHaveLength(0);
    expect(loadProject(dir).graph).toEqual(demoGraph);
  });

  it("rejects fixture values that violate the screen contract atomically", () => {
    expect(() => applyPatch(dir, {
      id: "edit.bad-fixture",
      rationale: "invalid fixture type",
      operations: [{
        op: "set-fixture-value",
        screenId: "payment-request",
        state: "failed",
        field: "recipientName",
        value: false,
      }],
    })).toThrow(/Invalid string value/);
    expect(projectRevisions(dir).revisions).toHaveLength(0);
    expect(loadProject(dir).graph).toEqual(demoGraph);
  });

  it("rejects invalid replacement graphs and accepts valid ones with a diff", () => {
    expect(() => replaceGraph(dir, { schemaVersion: "0.1.0" }, "broken")).toThrow();
    const themed = structuredClone(demoGraph);
    themed.tokens.colors["color.accent"] = "#7a4b9e";
    const result = replaceGraph(dir, themed, "brand accent change");
    expect(result.changes).toEqual([
      { path: "tokens.colors.color.accent", before: "#397461", after: "#7a4b9e" },
    ]);
  });

  it("verifies scenarios independently of generation", () => {
    const compact = verifyProject(dir, "compact");
    const regular = verifyProject(dir, "regular");
    expect(compact.passed).toBe(false);
    expect(compact.findings.some((finding) => finding.id.endsWith("primary.compact-reachability"))).toBe(true);
    expect(regular.passed).toBe(false);
    expect(regular.buildStatus).toBe("not-run");
    expect(regular.findings).toEqual([
      expect.objectContaining({ id: "swiftui.build.not-run" }),
    ]);
  });

  it("compiles deterministically and can emit files to disk", () => {
    const dry = compileProject(dir, "react", false);
    expect(dry.fingerprint).toBe(compileReact(demoGraph).fingerprint);
    const written = compileProject(dir, "react", true);
    expect(written.written?.length).toBe(written.fileCount);
  });

  it("diffs against revisions and reverts reversibly", () => {
    applyPatch(dir, {
      id: "edit.label",
      rationale: "rename",
      operations: [{ op: "set-label", target: "payment-request.confirm", label: "Send request" }],
    });
    const revisions = projectRevisions(dir).revisions;
    const diff = diffAgainstRevision(dir, revisions[0]?.id);
    expect(diff.changes).toEqual([
      expect.objectContaining({ path: "payment-request.confirm.intent.label", after: "Send request" }),
    ]);

    const reverted = revertProject(dir, revisions[0]!.id);
    expect(reverted.changes).toEqual([
      expect.objectContaining({ path: "payment-request.confirm.intent.label", after: "Confirm request" }),
    ]);
    expect(loadProject(dir).graph).toEqual(demoGraph);
  });
});
