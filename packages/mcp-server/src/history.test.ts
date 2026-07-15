import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { demoGraph } from "@intentform/proof-report/demo";
import { parseGraph, stableSerialize } from "@intentform/semantic-schema";
import {
  MAX_HISTORY_OPERATIONS,
  semanticThreeWayMerge,
} from "./history.ts";
import {
  applyPatch,
  applyProjectBranchPatch,
  applyProjectHistoryOperation,
  createProjectBranch,
  deleteProjectBranch,
  mergeProjectBranch,
  previewProjectBranchMerge,
  previewProjectHistoryOperation,
  projectHistory,
  recoverProjectHistory,
} from "./tools.ts";
import { loadProject, saveProject } from "./store.ts";

let dir: string;

const labelPatch = (id: string, label: string) => ({
  id,
  rationale: `set label to ${label}`,
  operations: [{ op: "set-label" as const, target: "payment-request.confirm", label }],
});

const placementPatch = {
  id: "main-placement",
  rationale: "keep compact action inset",
  operations: [{
    op: "set-placement" as const,
    target: "payment-request.confirm",
    compact: "persistent-bottom" as const,
    regular: "inline" as const,
  }],
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "intentform-history-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("operation history", () => {
  it("seeds an integrity-checked, private, Git-readable main operation", () => {
    const loaded = loadProject(dir);
    const history = projectHistory(dir);

    expect(history).toMatchObject({
      integrity: "valid",
      currentFingerprint: loaded.fingerprint,
      compactedBeforeSequence: null,
      branches: [{ name: "main", headFingerprint: loaded.fingerprint }],
      operations: [{ kind: "seed", author: "system", resultFingerprint: loaded.fingerprint }],
    });
    const historyRoot = join(dir, "history");
    const operationFile = readdirSync(join(historyRoot, "operations"))[0]!;
    const checkpointFile = readdirSync(join(historyRoot, "checkpoints"))[0]!;
    for (const path of [
      join(historyRoot, "manifest.json"),
      join(historyRoot, "operations", operationFile),
      join(historyRoot, "checkpoints", checkpointFile),
    ]) {
      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(readFileSync(path, "utf8")).toMatch(/\n$/);
    }
  });

  it("auto-merges an agent label with a human inset change and records provenance", () => {
    const initial = loadProject(dir);
    createProjectBranch(dir, "agent-copy");
    const branchEdit = applyProjectBranchPatch(
      dir,
      "agent-copy",
      labelPatch("agent-label", "Send safely"),
      initial.fingerprint,
    );
    const humanEdit = applyPatch(dir, placementPatch, initial.fingerprint);

    const preview = previewProjectBranchMerge(dir, "agent-copy");
    expect(preview).toMatchObject({
      currentFingerprint: humanEdit.fingerprint,
      conflicts: [],
    });
    expect(preview.changes).toContainEqual(expect.objectContaining({
      path: "payment-request.confirm.intent.label",
      after: "Send safely",
    }));

    const merged = mergeProjectBranch(dir, "agent-copy", humanEdit.fingerprint, "human");
    expect(merged).toMatchObject({
      branch: "agent-copy",
      operation: { kind: "merge", author: "human", sourceId: "agent-copy" },
    });
    const node = loadProject(dir).graph.screens.flatMap((screen) => screen.nodes)
      .find((candidate) => candidate.id === "payment-request.confirm")!;
    expect(node.intent.label).toBe("Send safely");
    expect(node.layout.placement).toEqual({ compact: "persistent-bottom", regular: "inline" });
    expect(branchEdit.operation.kind).toBe("branch-edit");
  });

  it("reports same-property conflicts without changing main", () => {
    const initial = loadProject(dir);
    createProjectBranch(dir, "copy-a");
    applyProjectBranchPatch(dir, "copy-a", labelPatch("branch-label", "Branch label"), initial.fingerprint);
    const main = applyPatch(dir, labelPatch("main-label", "Main label"), initial.fingerprint);

    const preview = previewProjectBranchMerge(dir, "copy-a");
    expect(preview.conflicts).toContainEqual(expect.objectContaining({
      path: "$.screens[id=payment-request].nodes[id=payment-request.confirm].intent.label",
      reason: "both-modified",
      base: "Confirm request",
      ours: "Main label",
      theirs: "Branch label",
    }));
    expect(() => mergeProjectBranch(dir, "copy-a", main.fingerprint)).toThrow(/requires review/i);
    expect(loadProject(dir).fingerprint).toBe(main.fingerprint);
  });

  it("accepts one-sided reorder and rejects competing reorder", () => {
    const base = structuredClone(demoGraph);
    const ours = structuredClone(base);
    const theirs = structuredClone(base);
    ours.screens[0]!.nodes = [ours.screens[0]!.nodes[1]!, ours.screens[0]!.nodes[0]!, ours.screens[0]!.nodes[2]!];
    theirs.screens[0]!.nodes[0]!.intent.label = "Balance today";
    const clean = semanticThreeWayMerge(parseGraph(base), parseGraph(ours), parseGraph(theirs));
    expect(clean.conflicts).toEqual([]);
    expect(clean.graph.screens[0]!.nodes.map((node) => node.id)).toEqual(ours.screens[0]!.nodes.map((node) => node.id));
    expect(clean.graph.screens[0]!.nodes.find((node) => node.id === "home.balance")!.intent.label).toBe("Balance today");

    const competing = structuredClone(base);
    competing.screens[0]!.nodes = [competing.screens[0]!.nodes[0]!, competing.screens[0]!.nodes[2]!, competing.screens[0]!.nodes[1]!];
    const conflicted = semanticThreeWayMerge(parseGraph(base), parseGraph(ours), parseGraph(competing));
    expect(conflicted.conflicts).toContainEqual(expect.objectContaining({
      path: "$.screens[id=home].nodes.$order",
      reason: "order-conflict",
    }));
  });

  it("merges independent fields through screenId- and name-keyed contract arrays", () => {
    const base = structuredClone(demoGraph);
    const ours = structuredClone(base);
    const theirs = structuredClone(base);
    ours.contracts.find((contract) => contract.screenId === "home")!.data
      .find((field) => field.name === "balance")!.required = false;
    theirs.contracts.find((contract) => contract.screenId === "home")!.data
      .find((field) => field.name === "activitySummary")!.required = false;

    const merged = semanticThreeWayMerge(parseGraph(base), parseGraph(ours), parseGraph(theirs));
    expect(merged.conflicts).toEqual([]);
    const data = merged.graph.contracts.find((contract) => contract.screenId === "home")!.data;
    expect(data.find((field) => field.name === "balance")!.required).toBe(false);
    expect(data.find((field) => field.name === "activitySummary")!.required).toBe(false);
  });

  it("previews and applies inverse revert and cherry-pick as new operations", () => {
    const initial = loadProject(dir);
    const edit = applyPatch(dir, labelPatch("first-label", "Reviewed label"), initial.fingerprint);
    const sourceId = edit.operation!.id;

    const revertPreview = previewProjectHistoryOperation(dir, sourceId, "revert");
    expect(revertPreview).toMatchObject({ conflicts: [], previewFingerprint: initial.fingerprint });
    const reverted = applyProjectHistoryOperation(dir, sourceId, "revert", edit.fingerprint);
    expect(reverted).toMatchObject({ direction: "revert", operation: { kind: "revert", sourceId } });
    expect(reverted.fingerprint).toBe(initial.fingerprint);

    const cherryPreview = previewProjectHistoryOperation(dir, sourceId, "cherry-pick");
    expect(cherryPreview).toMatchObject({ conflicts: [], previewFingerprint: edit.fingerprint });
    const cherryPicked = applyProjectHistoryOperation(dir, sourceId, "cherry-pick", reverted.fingerprint);
    expect(cherryPicked).toMatchObject({ direction: "cherry-pick", operation: { kind: "cherry-pick", sourceId } });
    expect(cherryPicked.fingerprint).toBe(edit.fingerprint);
  });

  it("enforces branch path and fingerprint bounds and deletes only branch pointers", () => {
    const initial = loadProject(dir);
    expect(() => createProjectBranch(dir, "../escape")).toThrow(/branch names/i);
    createProjectBranch(dir, "bounded");
    expect(() => applyProjectBranchPatch(dir, "bounded", labelPatch("stale", "No"), "00000000"))
      .toThrow(/branch fingerprint conflict/i);
    expect(deleteProjectBranch(dir, "bounded")).toEqual({ deleted: "bounded", branches: ["main"] });
    expect(loadProject(dir).fingerprint).toBe(initial.fingerprint);
  });

  it("serializes deletions explicitly so operation checksums survive JSON round trips", () => {
    const initial = loadProject(dir);
    const graph = structuredClone(initial.graph);
    graph.screens = graph.screens.filter((screen) => screen.id !== "layout-lab");
    const saved = saveProject(dir, parseGraph(graph), "remove layout lab", initial.fingerprint);
    const deletion = saved.operation!.changes.find((change) => change.afterMissing);
    expect(deletion).toMatchObject({ after: null, afterMissing: true, beforeMissing: false });
    expect(projectHistory(dir)).toMatchObject({ integrity: "valid" });
  });

  it("refuses out-of-band graph drift until explicit recovery", () => {
    const initial = loadProject(dir);
    const drifted = structuredClone(initial.graph);
    drifted.product.name = "Out of band";
    writeFileSync(join(dir, "graph.json"), stableSerialize(drifted), "utf8");
    const current = loadProject(dir);
    expect(projectHistory(dir)).toMatchObject({ integrity: "needs-recovery" });
    const candidate = structuredClone(current.graph);
    candidate.product.name = "Should not save";
    expect(() => saveProject(dir, candidate, "blocked drift save", current.fingerprint)).toThrow(/recover before writing/i);
    expect(loadProject(dir).graph.product.name).toBe("Out of band");
    expect(existsSync(join(dir, "revisions"))).toBe(false);
  });

  it("removes a staged operation when revision persistence fails", () => {
    const initial = loadProject(dir);
    const beforeFiles = readdirSync(join(dir, "history", "operations"));
    const beforeCheckpoints = readdirSync(join(dir, "history", "checkpoints"));
    writeFileSync(join(dir, "revisions"), "not a directory", "utf8");
    const candidate = structuredClone(initial.graph);
    candidate.product.name = "Cannot commit";
    expect(() => saveProject(dir, candidate, "failed revision write", initial.fingerprint)).toThrow();
    expect(loadProject(dir).fingerprint).toBe(initial.fingerprint);
    expect(readdirSync(join(dir, "history", "operations"))).toEqual(beforeFiles);
    expect(readdirSync(join(dir, "history", "checkpoints"))).toEqual(beforeCheckpoints);
  });

  it("compacts large histories while preserving a recovery checkpoint", () => {
    let current = loadProject(dir);
    for (let index = 0; index < MAX_HISTORY_OPERATIONS + 7; index += 1) {
      const graph = structuredClone(current.graph);
      graph.screens[0]!.nodes[0]!.intent.label = `Balance ${index}`;
      const saved = saveProject(dir, graph, `large history ${index}`, current.fingerprint);
      current = { graph: parseGraph(graph), fingerprint: saved.fingerprint, seeded: false };
    }
    const history = projectHistory(dir);
    expect(history.integrity).toBe("valid");
    expect(history.operations.length).toBeLessThanOrEqual(MAX_HISTORY_OPERATIONS);
    expect(history.compactedBeforeSequence).toBeTypeOf("number");
    expect(history.branches[0]).toMatchObject({ name: "main", headFingerprint: current.fingerprint });
    expect(readdirSync(join(dir, "history", "operations")).length).toBeLessThanOrEqual(MAX_HISTORY_OPERATIONS);
  }, 30_000);

  it("quarantines corrupt metadata and rebuilds from graph/checkpoint evidence", () => {
    const initial = loadProject(dir);
    const edit = applyPatch(dir, labelPatch("recovery-label", "Recover me"), initial.fingerprint);
    const operationFile = readdirSync(join(dir, "history", "operations")).sort().at(-1)!;
    const operationPath = join(dir, "history", "operations", operationFile);
    const corrupt = JSON.parse(readFileSync(operationPath, "utf8")) as { reason: string };
    corrupt.reason = "tampered without checksum";
    writeFileSync(operationPath, JSON.stringify(corrupt, null, 2), "utf8");

    expect(projectHistory(dir)).toMatchObject({ integrity: "needs-recovery" });
    const recovered = recoverProjectHistory(dir);
    expect(recovered).toMatchObject({ integrity: "valid", currentFingerprint: edit.fingerprint });
    const recoveryRoots = readdirSync(join(dir, "history", "recovery"));
    expect(recoveryRoots).toHaveLength(1);
    expect(readdirSync(join(dir, "history", "recovery", recoveryRoots[0]!))).toContain(operationFile);
    expect(loadProject(dir).fingerprint).toBe(edit.fingerprint);
  });
});
