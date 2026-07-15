import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { demoGraph } from "@intentform/proof-report/demo";
import { findGraphNodeLocation } from "@intentform/semantic-schema";
import { compileExpo } from "@intentform/compiler-expo";
import { compileReact } from "@intentform/compiler-react";
import { compileWeb } from "@intentform/compiler-web";
import { resourceDefinitions, toolDefinitions } from "./index.ts";
import {
  applyMigration,
  applyPatch,
  collectProjectAssets,
  cancelProjectPreview,
  compileProject,
  componentSchema,
  describeProject,
  deviceProfileResource,
  deviceBezelResource,
  diffAgainstRevision,
  exportProjectTokens,
  importProjectAssetFromInbox,
  importProjectTokens,
  instantiateProjectComponent,
  listTokenModes,
  projectRevisions,
  projectHistory,
  projectPreviewStatus,
  previewMigration,
  previewPatch,
  replaceGraph,
  runProjectPreview,
  revertProject,
  searchComponents,
  searchProjectAssets,
  verifyProject,
  verifyWebProject,
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

function legacyDemoGraph(version = "0.0.1") {
  const legacy = structuredClone(demoGraph) as unknown as Record<string, unknown> & {
    tokens: unknown;
    assets?: unknown;
  };
  legacy.schemaVersion = version;
  legacy.tokens = structuredClone(demoGraph.tokens.modes[demoGraph.tokens.defaultMode]!.values);
  delete legacy.assets;
  return legacy;
}

function migratedLegacyDemoGraph() {
  const migrated = structuredClone(demoGraph);
  migrated.tokens = {
    defaultMode: "default",
    activeMode: "default",
    modes: {
      default: {
        name: "Default",
        values: structuredClone(demoGraph.tokens.modes[demoGraph.tokens.defaultMode]!.values),
      },
    },
    aliases: {},
    deprecated: {},
    extensions: {},
  };
  migrated.assets = [];
  return migrated;
}

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
    expect(byName.get("intentform_preview_patch")?.inputSchema)
      .toEqual(byName.get("intentform_apply_patch")?.inputSchema);
    expect(byName.get("intentform_search_components")?.inputSchema).toMatchObject({ additionalProperties: false });
    expect(byName.get("intentform_component_schema")?.inputSchema).toMatchObject({ additionalProperties: false });
    expect(byName.get("intentform_instantiate_component")?.inputSchema).toMatchObject({
      required: ["definitionId", "instanceId", "screenId"],
      additionalProperties: false,
    });
    expect([...byName.keys()].filter((name) => name.startsWith("intentform_"))).toHaveLength(46);
    for (const name of [
      "intentform_list_token_modes",
      "intentform_import_dtcg",
      "intentform_export_dtcg",
      "intentform_search_assets",
      "intentform_import_asset",
      "intentform_asset_gc",
      "intentform_verify_web",
      "intentform_audit_accessibility",
      "intentform_preview_status",
      "intentform_run_preview",
      "intentform_cancel_preview",
      "intentform_begin_transaction",
      "intentform_preview_transaction",
      "intentform_commit_transaction",
      "intentform_rollback_transaction",
      "intentform_list_history",
      "intentform_create_branch",
      "intentform_apply_branch_patch",
      "intentform_preview_branch_merge",
      "intentform_merge_branch",
      "intentform_delete_branch",
      "intentform_preview_history_operation",
      "intentform_apply_history_operation",
      "intentform_recover_history",
      "intentform_preview_package_update",
      "intentform_apply_package_update",
      "intentform_set_plugin_permissions",
      "intentform_export_review_bundle",
      "intentform_preview_review_bundle",
      "intentform_apply_review_bundle",
      "intentform_verify_remote_evidence",
    ]) {
      expect(byName.get(name)?.inputSchema).toMatchObject({ additionalProperties: false });
    }
  });

  it("publishes conflict-safe preview status, run and cancellation contracts", () => {
    const byName = new Map(toolDefinitions.map((tool) => [tool.name, tool]));
    expect(byName.get("intentform_run_preview")?.inputSchema).toMatchObject({
      required: ["target", "expectedFingerprint"],
      additionalProperties: false,
    });
    expect(byName.get("intentform_cancel_preview")?.inputSchema).toMatchObject({
      required: ["target", "expectedFingerprint"],
      additionalProperties: false,
    });
    const project = loadProject(dir);
    const status = projectPreviewStatus(dir);
    expect(status.fingerprint).toBe(project.fingerprint);
    expect(status.targets.find((entry) => entry.target === "browser")).toMatchObject({
      phase: "idle",
      buildStatus: "not-run",
    });
    expect(() => runProjectPreview(dir, "browser", "00000000", false)).toThrow(/fingerprint conflict/i);
    expect(cancelProjectPreview(dir, "browser", project.fingerprint).target).toMatchObject({
      phase: "idle",
      buildStatus: "not-run",
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
    const legacy = legacyDemoGraph();
    const source = `  ${JSON.stringify(legacy, null, 4)}\n`;
    writeFileSync(join(dir, "graph.json"), source, "utf8");

    const preview = previewProjectMigration(dir);
    expect(preview).toMatchObject({
      status: "migration-required",
      fromVersion: "0.0.1",
      toVersion: "0.8.0",
      sourceFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(readdirSync(dir)).toEqual(["graph.json"]);
    expect(() => loadProject(dir)).toThrow(ProjectMigrationRequiredError);

    const expected = preview.status === "missing" ? "" : preview.sourceFingerprint;
    const applied = migrateProject(dir, expected);
    expect(applied).toMatchObject({
      status: "current",
      fromVersion: "0.0.1",
      toVersion: "0.8.0",
      fingerprint: expect.stringMatching(/^[a-f0-9]{8}$/),
    });
    expect(applied.checkpoint).toMatch(/migration-checkpoints/);
    expect(readFileSync(applied.checkpoint!, "utf8")).toBe(source);
    expect(JSON.parse(readFileSync(join(dir, "graph.json"), "utf8"))).toEqual(migratedLegacyDemoGraph());
    expect(loadProject(dir).graph).toEqual(migratedLegacyDemoGraph());
    expect(projectHistory(dir)).toMatchObject({
      integrity: "valid",
      operations: [{ kind: "save", author: "system", sourceId: "0.0.1->0.8.0" }],
    });
    expect(compileProject(dir, "react", false).fileCount).toBeGreaterThan(0);
    expect(compileProject(dir, "swiftui", false).fileCount).toBeGreaterThan(0);
    expect(compileProject(dir, "expo", false).fileCount).toBeGreaterThan(0);
  });

  it("leaves the old graph untouched when its checkpoint cannot be written", () => {
    const legacy = legacyDemoGraph();
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
    const legacy = legacyDemoGraph();
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
    const legacy = legacyDemoGraph();
    writeFileSync(join(dir, "graph.json"), JSON.stringify(legacy), "utf8");

    const preview = previewMigration(dir);
    expect(preview.status).toBe("migration-required");
    const expected = preview.status === "missing" ? "" : preview.sourceFingerprint;
    const applied = applyMigration(dir, expected);

    expect(applied).toMatchObject({ status: "current", checkpoint: expect.any(String) });
    expect(applied).not.toHaveProperty("graph");
    expect(previewMigration(dir)).toMatchObject({ status: "current", fromVersion: "0.8.0" });
  });

  it("writes atomically and rejects a stale writer without losing the winning graph", () => {
    const opened = loadProject(dir);
    const agentGraph = structuredClone(opened.graph);
    agentGraph.tokens.modes.default!.values.colors["color.accent"] = "#7a4b9e";
    const agentSave = saveProject(dir, agentGraph, "agent color change", opened.fingerprint);

    const staleStudioGraph = structuredClone(opened.graph);
    staleStudioGraph.tokens.modes.default!.values.colors["color.accent"] = "#315fcb";
    expect(() => saveProject(dir, staleStudioGraph, "stale studio save", opened.fingerprint))
      .toThrow(ProjectConflictError);

    expect(loadProject(dir).graph.tokens.modes.default!.values.colors["color.accent"]).toBe("#7a4b9e");
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
      graphFile: join(dir, "graph.json"),
    });
    expect(summary.product.name).toBe("Verdant Pay");
    expect(summary.screens.map((screen) => screen.id)).toEqual(["home", "payment-request", "receipt", "layout-lab"]);
    expect(summary.screens[1]?.nodes.map((node) => node.id)).toContain("payment-request.confirm");
    expect(summary.screens[3]?.nodeCount).toBe(20);
    expect(JSON.stringify(summary.screens[3]?.nodes)).toContain('"parentId":"layout-lab.grid"');
    expect(summary.outputs.react).toEqual({
      status: "generated",
      fingerprint: compileReact(demoGraph).fingerprint,
      diagnosticCount: 0,
      diagnostics: [],
      message: null,
    });
    expect(summary.verification.buildStatus).toBe("not-run");
    expect(summary.verification.passed).toBe(false);
    expect(summary.devices).toMatchObject({
      registryVersion: "1.0.0",
      defaultProfile: "neutral.phone.compact",
      profiles: expect.arrayContaining([
        expect.objectContaining({ id: "neutral.phone.regular", safeArea: { top: 59, right: 0, bottom: 34, left: 0 } }),
      ]),
    });
  });

  it("publishes resolved device geometry as a read-only MCP resource", () => {
    expect(resourceDefinitions.map(({ read: _read, ...resource }) => resource)).toEqual([{
      uri: "intentform://project/summary",
      name: "IntentForm project summary",
      description: expect.stringMatching(/current product, targets/i),
      mimeType: "application/json",
    }, {
      uri: "intentform://project/graph",
      name: "IntentForm canonical graph",
      description: expect.stringMatching(/complete validated Semantic Interface Graph/i),
      mimeType: "application/json",
    }, {
      uri: "intentform://project/revisions",
      name: "IntentForm project revisions",
      description: expect.stringMatching(/newest-first local revision/i),
      mimeType: "application/json",
    }, {
      uri: "intentform://project/history",
      name: "IntentForm operation history and branches",
      description: expect.stringMatching(/integrity-checked named operations/i),
      mimeType: "application/json",
    }, {
      uri: "intentform://project/accessibility",
      name: "IntentForm accessibility audit",
      description: expect.stringMatching(/WCAG 2.2 AA audits/i),
      mimeType: "application/json",
    }, {
      uri: "intentform://project/previews",
      name: "IntentForm local preview evidence",
      description: expect.stringMatching(/freshness-bound/i),
      mimeType: "application/json",
    }, {
      uri: "intentform://project/ecosystem",
      name: "IntentForm local ecosystem and collaboration policy",
      description: expect.stringMatching(/locked signed packages/i),
      mimeType: "application/json",
    }, {
      uri: "intentform://agent/activity",
      name: "IntentForm agent access and activity",
      description: expect.stringMatching(/arguments, tokens, paths, content and outputs are excluded/i),
      mimeType: "application/json",
    }, {
      uri: "intentform://device-profiles",
      name: "IntentForm device profiles",
      description: expect.stringMatching(/checksummed logical device geometry/i),
      mimeType: "application/json",
    }, {
      uri: "intentform://device-bezel-packs",
      name: "IntentForm local device bezel packs",
      description: expect.stringMatching(/never includes asset bytes or source paths/i),
      mimeType: "application/json",
    }]);
    const resource = deviceProfileResource(dir);
    expect(resource.fingerprint).toBe(loadProject(dir).fingerprint);
    expect(resource.profiles).toHaveLength(7);
    expect(resource.profiles.find((profile) => profile.id === "neutral.tablet.split")).toMatchObject({
      source: "registry",
      window: { mode: "split", resizable: true },
      capabilities: expect.arrayContaining(["split-window", "resizable"]),
    });
  });

  it("keeps the local bezel capability disabled and byte-free by default", () => {
    expect(deviceBezelResource(dir)).toEqual({ enabled: false, packs: [], diagnostics: [] });
    expect(JSON.stringify(deviceBezelResource(dir))).not.toMatch(/fileName|sourcePath|bytes/i);
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

  it("searches component schemas and instantiates one through a revisioned agent transaction", () => {
    const found = searchComponents(dir, "balance");
    expect(found).toMatchObject({
      count: 1,
      components: [{
        id: "intent.balance-summary",
        props: [{ name: "label", type: "string", required: false, default: "Available balance" }],
      }],
    });
    expect(componentSchema(dir, "intent.balance-summary")).toMatchObject({
      abiVersion: "1.0.0",
      schemaVersion: "0.8.0",
      definitions: [{ id: "intent.balance-summary", version: "1.0.0" }],
    });

    const result = instantiateProjectComponent(dir, {
      definitionId: "intent.balance-summary",
      instanceId: "layout-lab.agent-balance",
      screenId: "layout-lab",
      props: { label: "Agent balance" },
    });
    expect(result.revision?.reason).toBe("instantiate intent.balance-summary as layout-lab.agent-balance");
    expect(result.changes).not.toHaveLength(0);
    expect(findGraphNodeLocation(loadProject(dir).graph, "layout-lab.agent-balance")?.node).toMatchObject({
      intent: { label: "Agent balance" },
      componentInstance: { definitionId: "intent.balance-summary" },
    });
    expect(projectRevisions(dir).revisions).toHaveLength(1);

    expect(() => instantiateProjectComponent(dir, {
      definitionId: "intent.missing",
      instanceId: "layout-lab.missing",
      screenId: "layout-lab",
    })).toThrow(/unknown component definition/i);
    expect(projectRevisions(dir).revisions).toHaveLength(1);
  });

  it("round-trips DTCG tokens through explicit read and revisioned import tools", () => {
    expect(listTokenModes(dir)).toMatchObject({
      defaultMode: "default",
      activeMode: "default",
      modes: [
        { id: "default", overrideCount: 11 },
        { id: "evening", overrideCount: 4 },
      ],
    });
    const exported = exportProjectTokens(dir);
    expect(exported).toMatchObject({ format: "DTCG", formatVersion: "2025.10", tokenCount: 12 });
    expect(exported.content).toBe(exportProjectTokens(dir).content);

    const document = JSON.parse(exported.content) as {
      color: { accent: { $value: { components: number[] } } };
      $extensions: Record<string, unknown>;
    };
    document.color.accent.$value.components = [0.478, 0.294, 0.62];
    delete document.$extensions["org.intentform.tokens"];
    const imported = importProjectTokens(dir, document);
    expect(imported.diagnostics).toContainEqual(expect.objectContaining({ code: "dtcg.imported.2025.10" }));
    expect(imported.revision?.reason).toBe("import DTCG 2025.10 token document");
    expect(loadProject(dir).graph.tokens.modes.default?.values.colors["color.accent"]).toBe("#7a4b9e");
    expect(projectRevisions(dir).revisions).toHaveLength(1);
  });

  it("imports, searches, compiles, verifies, and garbage-collects licensed assets without leaking source paths", () => {
    mkdirSync(join(dir, "imports"), { recursive: true });
    writeFileSync(join(dir, "imports", "mark.svg"), '<svg viewBox="0 0 24 12"><path d="M0 0h24v12H0z"/></svg>');
    const imported = importProjectAssetFromInbox(dir, {
      importName: "mark.svg",
      id: "brand.mark",
      name: "Brand mark",
      kind: "icon",
      license: { name: "Project-owned", spdx: "CC0-1.0", redistribution: "allowed" },
      exportPolicy: "copy",
      metadata: { role: "brand" },
    });
    expect(imported.asset).toMatchObject({ id: "brand.mark", kind: "icon", mediaType: "image/svg+xml" });
    expect(JSON.stringify(imported.asset)).not.toContain("mark.svg");
    expect(searchProjectAssets(dir, "cc0")).toMatchObject({
      count: 1,
      assets: [{ id: "brand.mark", diagnostics: [] }],
    });

    const compiled = compileProject(dir, "react", true);
    expect(compiled.assetDiagnostics).toEqual([]);
    expect(compiled.copiedAssets).toEqual([join(dir, "output", "react", "public", imported.asset.storageKey)]);
    expect(readFileSync(compiled.copiedAssets![0]!, "utf8")).toContain("<svg");

    writeFileSync(join(dir, "assets", "orphan.bin"), "orphan");
    expect(collectProjectAssets(dir)).toEqual(expect.objectContaining({ apply: false, unused: ["assets/orphan.bin"], removed: [] }));
    expect(collectProjectAssets(dir, true)).toEqual(expect.objectContaining({ apply: true, removed: ["assets/orphan.bin"] }));
    expect(readdirSync(join(dir, "assets"))).toEqual([`${imported.asset.digest}.svg`]);
    expect(projectRevisions(dir).revisions).toHaveLength(1);
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

  it("previews the exact patch diff and fingerprint without creating a revision", () => {
    const before = loadProject(dir);
    const patch = {
      id: "preview.direct-manipulation",
      rationale: "Preview a snapped resize before commit",
      operations: [{
        op: "set-layout" as const,
        target: "layout-lab.grid-a",
        width: "fixed" as const,
        fixedWidth: 184,
        height: "fixed" as const,
        fixedHeight: 72,
      }],
    };
    const preview = previewPatch(dir, patch);

    expect(preview).toMatchObject({
      patchId: patch.id,
      currentFingerprint: before.fingerprint,
      previewFingerprint: expect.stringMatching(/^[a-f0-9]{8}$/),
      changes: expect.arrayContaining([
        expect.objectContaining({ path: "layout-lab.grid-a.layout.width", after: "fixed" }),
        expect.objectContaining({ path: "layout-lab.grid-a.layout.fixedWidth", after: 184 }),
      ]),
      verification: { buildStatus: "not-run", passed: false },
    });
    expect(preview.previewFingerprint).not.toBe(before.fingerprint);
    expect(loadProject(dir)).toMatchObject({ fingerprint: before.fingerprint, graph: before.graph });
    expect(projectRevisions(dir).revisions).toEqual([]);

    const applied = applyPatch(dir, patch);
    expect(applied.fingerprint).toBe(preview.previewFingerprint);
    expect(applied.changes).toEqual(preview.changes);
  });

  it("applies typed recursive layout and hierarchy operations in one atomic patch", () => {
    const result = applyPatch(dir, {
      id: "edit.recursive-layout",
      rationale: "Position a grid item explicitly and move it into the freeform region",
      operations: [
        {
          op: "set-layout",
          target: "layout-lab.grid-a",
          width: "fixed",
          fixedWidth: 180,
          position: { x: 24, y: 36, z: 3 },
        },
        {
          op: "move-node",
          target: "layout-lab.grid-a",
          screenId: "layout-lab",
          parent: "layout-lab.freeform",
          index: 1,
        },
      ],
    });
    const graph = loadProject(dir).graph;
    const moved = findGraphNodeLocation(graph, "layout-lab.grid-a");

    expect(moved?.parent?.id).toBe("layout-lab.freeform");
    expect(moved?.node.layout).toMatchObject({
      width: "fixed",
      fixedWidth: 180,
      position: { x: 24, y: 36, z: 3 },
    });
    expect(result.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "layout-lab.grid-a.layout.width" }),
      expect.objectContaining({ path: "layout-lab.freeform.children" }),
    ]));
  });

  it("rejects recursive patch cycles without saving a revision", () => {
    expect(() => applyPatch(dir, {
      id: "edit.recursive-cycle",
      rationale: "This invalid edit must remain atomic",
      operations: [{
        op: "move-node",
        target: "layout-lab.adaptive",
        screenId: "layout-lab",
        parent: "layout-lab.grid",
      }],
    })).toThrow(/descendants/);
    expect(projectRevisions(dir).revisions).toHaveLength(0);
    expect(findGraphNodeLocation(loadProject(dir).graph, "layout-lab.adaptive")?.parent).toBeNull();
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
    expect(() => replaceGraph(dir, { schemaVersion: "0.2.0" }, "broken")).toThrow();
    const themed = structuredClone(demoGraph);
    themed.tokens.modes.default!.values.colors["color.accent"] = "#7a4b9e";
    const result = replaceGraph(dir, themed, "brand accent change");
    expect(result.changes).toEqual([
      { path: "tokens.modes.default.values.colors.color.accent", before: "#397461", after: "#7a4b9e" },
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
    const expo = compileProject(dir, "expo", true);
    expect(expo.fingerprint).toBe(compileExpo(demoGraph).fingerprint);
    expect(expo.files).toContain("intentform.expo.json");
    expect(expo.written?.length).toBe(expo.fileCount);
  });

  it("describes, verifies, and compiles a responsive-web project through MCP tooling", () => {
    const graph = structuredClone(demoGraph);
    graph.platforms.push({ target: "web", enabled: true, capabilities: ["semantic-html", "responsive-layout"] });
    graph.web = {
      strategy: "responsive-web",
      defaultFrame: "desktop",
      frames: [
        { id: "mobile", label: "Mobile", mode: "browser", width: 390, height: 844 },
        { id: "desktop", label: "Desktop", mode: "browser", width: 1440, height: 1000 },
      ],
      breakpoints: [
        { id: "small", label: "Small", minWidth: 0, maxWidth: 767 },
        { id: "large", label: "Large", minWidth: 768 },
      ],
      contentMaxWidth: 1200,
      inlinePaddingToken: "space.20",
    };
    replaceGraph(dir, graph, "enable responsive web");
    const described = describeProject(dir);
    expect(described.web).toEqual(expect.objectContaining({ strategy: "responsive-web" }));
    expect(described.outputs.web).toEqual(expect.objectContaining({ status: "generated" }));
    const verified = verifyWebProject(dir);
    expect(verified.passed).toBe(true);
    const dry = compileProject(dir, "web", false);
    expect(dry.fingerprint).toBe(compileWeb(loadProject(dir).graph).fingerprint);
    const written = compileProject(dir, "web", true);
    expect(written.files).toContain("src/styles.css");
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
