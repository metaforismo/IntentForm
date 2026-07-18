import { describe, expect, it } from "vitest";
import { parseGraph } from "@intentform/semantic-schema";
import { demoGraph } from "@intentform/proof-report/demo";
import { compileReact } from "@intentform/compiler-react";
import { analyzeDesignSystem, applyTokenExtraction } from "./design-system-extraction";

function extractionGraph() {
  const graph = structuredClone(demoGraph);
  const screen = graph.screens.find((candidate) => candidate.id === "payment-request")!;
  for (const [index, node] of screen.nodes.slice(0, 2).entries()) {
    node.layout.gap = 18;
    node.style.appearance = {
      fills: [{ id: `fill-${index}`, type: "solid", visible: true, color: { color: "#123456" }, opacity: 1, blendMode: "normal" }],
      radius: { linked: true, topLeft: 12, topRight: 12, bottomRight: 12, bottomLeft: 12 },
      effects: [], opacity: 1, blendMode: "normal",
      typography: { style: "normal", size: 17, align: "start", transform: "none", wrapping: "wrap", truncation: "none", features: [] },
    };
  }
  return parseGraph(graph);
}

describe("design-system extraction", () => {
  it("deterministically suggests repeated literals with exact affected nodes", () => {
    const graph = extractionGraph();
    const first = analyzeDesignSystem(graph, "payment-request");
    const second = analyzeDesignSystem(graph, "payment-request");
    expect(first).toEqual(second);
    expect(first.tokens).toEqual(expect.arrayContaining([
      expect.objectContaining({ group: "colors", value: "#123456", occurrences: 2 }),
      expect.objectContaining({ group: "spacing", value: 18, occurrences: 2 }),
      expect.objectContaining({ group: "radii", value: 12, occurrences: 2 }),
      expect.objectContaining({ group: "fontSizes", value: 17, occurrences: 2 }),
    ]));
    expect(first.tokens.find((item) => item.group === "colors")?.nodeIds).toHaveLength(2);
  });

  it("creates tokens and replaces literals without changing another screen", () => {
    const graph = extractionGraph();
    const beforeOther = structuredClone(graph.screens.find((screen) => screen.id === "home"));
    const analysis = analyzeDesignSystem(graph, "payment-request");
    const colors = analysis.tokens.find((item) => item.group === "colors")!;
    const spacing = analysis.tokens.find((item) => item.group === "spacing")!;
    const next = applyTokenExtraction(graph, "payment-request", [
      { suggestionId: colors.id, key: "color.extracted.brand" },
      { suggestionId: spacing.id, key: "space.extracted.row" },
    ]);
    const nodes = next.screens.find((screen) => screen.id === "payment-request")!.nodes.slice(0, 2);
    expect(nodes.every((node) => node.layout.gap === undefined && node.layout.gapToken === "space.extracted.row")).toBe(true);
    expect(nodes.every((node) => node.style.appearance?.fills[0]?.type === "solid" && node.style.appearance.fills[0].color.token === "color.extracted.brand")).toBe(true);
    expect(next.tokens.modes[next.tokens.activeMode]!.values.colors["color.extracted.brand"]).toBe("#123456");
    expect(next.screens.find((screen) => screen.id === "home")).toEqual(beforeOther);
    expect(compileReact(next)).toEqual(compileReact(next));
  });

  it("rejects invalid, colliding, and stale review input", () => {
    const graph = extractionGraph();
    const analysis = analyzeDesignSystem(graph, "payment-request");
    const colors = analysis.tokens.find((item) => item.group === "colors")!;
    expect(() => applyTokenExtraction(graph, "payment-request", [{ suggestionId: colors.id, key: "space.wrong" }])).toThrow(/invalid colors token key/i);
    expect(() => applyTokenExtraction(graph, "payment-request", [{ suggestionId: "missing", key: "color.extracted.missing" }])).toThrow(/unknown extraction suggestion/i);
  });

  it("keeps large repeated-node analysis deterministic and candidate output bounded", () => {
    const graph = structuredClone(demoGraph);
    const screen = graph.screens.find((candidate) => candidate.id === "payment-request")!;
    const leaf = structuredClone(screen.nodes.flatMap((node) => node.children).find((node) => node.children.length === 0) ?? screen.nodes[0]!);
    screen.nodes = Array.from({ length: 2_000 }, (_, index) => ({
      ...structuredClone(leaf),
      id: `stress.node-${index}`,
      children: [],
      style: {
        ...structuredClone(leaf.style),
        appearance: { fills: [{ id: `stress.fill-${index}`, type: "solid", visible: true, color: { color: "#abcdef" }, opacity: 1, blendMode: "normal" }], effects: [], opacity: 1, blendMode: "normal" },
      },
    }));
    const first = analyzeDesignSystem(graph, "payment-request");
    const second = analyzeDesignSystem(graph, "payment-request");
    expect(first).toEqual(second);
    expect(first.tokens.find((item) => item.group === "colors")).toMatchObject({ value: "#abcdef", occurrences: 2_000 });
    expect(first.components.length).toBeLessThanOrEqual(8);
  });
});
