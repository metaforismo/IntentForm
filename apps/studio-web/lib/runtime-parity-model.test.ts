import { demoGraph } from "@intentform/proof-report/demo";
import { flattenSemanticNodes } from "@intentform/semantic-schema";
import { describe, expect, it } from "vitest";
import { compareRuntimeParity, normalizeRenderedParityNodes, runtimeParitySummary } from "./runtime-parity-model";

const screen = demoGraph.screens[0]!;
const graphNodes = flattenSemanticNodes(screen.nodes);

function renderedNodes() {
  return graphNodes.map((node, index) => ({
    nodeId: node.id,
    bounds: { x: 0, y: index * 52, width: 240, height: 48 },
    visible: node.states.length === 0,
    accessibleName: node.accessibility.label || node.intent.label,
    semanticOrder: index,
    position: node.layout.placement?.compact === "persistent-bottom" ? "fixed" : "static",
  }));
}

describe("runtime parity model", () => {
  it("matches bounded stable runtime evidence to semantic nodes", () => {
    const result = compareRuntimeParity({ graph: demoGraph, screenId: screen.id, graphFingerprint: "aaaaaaaa", evidenceGraphFingerprint: "aaaaaaaa", compilerFingerprint: "bbbbbbbb", evidenceCompilerFingerprint: "bbbbbbbb", target: "web", deviceProfile: "compact", deviceClass: "compact", visualState: "idle", collectedAt: "2026-07-18T12:00:00.000Z", renderedNodes: renderedNodes() });
    expect(result.status).toBe("current");
    expect(result.nodes).toHaveLength(graphNodes.length);
    expect(runtimeParitySummary(result).errors).toBe(0);
    expect(result.nodes.every((node) => node.verdicts.some((verdict) => verdict.kind === "matched"))).toBe(true);
  });

  it("detects missing, inaccessible, undersized, clipped, and stale runtime evidence", () => {
    const evidence = renderedNodes();
    evidence.shift();
    evidence[0] = { ...evidence[0]!, bounds: { x: 0, y: 0, width: 8, height: 8 }, accessibleName: "Different", clipped: true } as never;
    const result = compareRuntimeParity({ graph: demoGraph, screenId: screen.id, graphFingerprint: "newgraph", evidenceGraphFingerprint: "oldgraph", compilerFingerprint: "bbbbbbbb", evidenceCompilerFingerprint: "bbbbbbbb", target: "web", deviceProfile: "compact", deviceClass: "compact", visualState: "idle", collectedAt: "2026-07-18T12:00:00.000Z", renderedNodes: evidence });
    expect(result.status).toBe("stale");
    expect(result.diagnostics[0]?.code).toBe("stale-evidence");
    expect(result.nodes[0]?.verdicts.some((verdict) => verdict.kind === "missing-rendered-node")).toBe(true);
    expect(result.nodes[1]?.verdicts.map((verdict) => verdict.kind)).toEqual(expect.arrayContaining(["accessible-name-mismatch", "overflow-clipping"]));
    expect(runtimeParitySummary(result).errors).toBeGreaterThan(0);
  });

  it("rejects malformed and unbounded collector data", () => {
    expect(normalizeRenderedParityNodes([null, { nodeId: "", bounds: {} }, { nodeId: "valid", bounds: { x: Infinity, width: -4 }, visible: true }])).toEqual([
      expect.objectContaining({ nodeId: "valid", bounds: expect.objectContaining({ x: 0, width: 0 }) }),
    ]);
  });
});
