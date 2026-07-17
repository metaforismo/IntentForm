import { describe, expect, it } from "vitest";
import type { SemanticInterfaceGraph, SemanticNode } from "@intentform/semantic-schema";
import { demoGraph } from "../../proof-report/src/demo.ts";
import { auditDesignQuality } from "./design-quality.ts";
import { verifyGraph } from "./index.ts";

const scenario = { target: "react" as const, viewport: { width: 390, height: 844 }, visualState: "idle" };

function cloneNode(source: SemanticNode, id: string): SemanticNode {
  return { ...structuredClone(source), id };
}

function appearance(overrides: Partial<NonNullable<SemanticNode["style"]["appearance"]>> = {}) {
  return { fills: [], effects: [], opacity: 1, blendMode: "normal", ...overrides } satisfies NonNullable<SemanticNode["style"]["appearance"]>;
}

function inconsistentGraph(): SemanticInterfaceGraph {
  const graph = structuredClone(demoGraph);
  const screen = graph.screens[0]!;
  const source = screen.nodes[0]!;
  const nodes: SemanticNode[] = [];

  graph.tokens.modes.default!.values.fontSizes = { "font.body": 12 };

  [10, 11, 12, 13, 14, 15, 16].forEach((size, index) => {
    const node = cloneNode(source, `quality.type-${index}`);
    node.kind = "text";
    node.intent.label = index === 0 ? "A long uppercase action label that should remain readable" : `Type ${index}`;
    node.style.appearance = appearance({
      fills: [], effects: [], opacity: 1, blendMode: "normal",
      typography: {
        style: "normal", align: "start", transform: index === 0 ? "uppercase" : "none", wrapping: "wrap", truncation: "none", features: [],
        size, ...(index === 0 ? { lineHeight: 40 } : {}),
      },
    });
    nodes.push(node);
  });
  nodes[1]!.intent.label = "This authored line is intentionally longer than ninety characters so the deterministic readability rule has exact evidence.";

  [9, 10, 11].forEach((gap, index) => {
    const node = cloneNode(source, `quality.gap-${index}`);
    node.layout.gap = gap;
    nodes.push(node);
  });

  [1, 2, 3, 4, 5, 6, 999, 999, 999, 999].forEach((radius, index) => {
    const node = cloneNode(source, `quality.radius-${index}`);
    node.style.appearance = appearance({
      fills: [], effects: [], opacity: 1, blendMode: "normal",
      radius: { linked: true, topLeft: radius, topRight: radius, bottomRight: radius, bottomLeft: radius },
    });
    nodes.push(node);
  });

  Array.from({ length: 13 }, (_, index) => index).forEach((index) => {
    const node = cloneNode(source, `quality.color-${index}`);
    const color = index === 0 ? "#397461" : `#${(index + 1).toString(16).padStart(6, "0")}`;
    node.style.appearance = appearance({
      fills: [{ id: `fill-${index}`, type: "solid", visible: true, color: { color }, opacity: 1, blendMode: "normal" }],
      effects: [], opacity: 1, blendMode: "normal",
    });
    nodes.push(node);
  });

  const primary = cloneNode(screen.nodes.find((node) => node.kind === "primary-action")!, "quality.primary");
  primary.intent.label = "OK";
  primary.style.emphasis = "normal";
  primary.layout.width = "fixed";
  primary.layout.height = "fixed";
  primary.layout.fixedWidth = 1_000;
  primary.layout.fixedHeight = 32;
  nodes.push(primary);
  const duplicateAction = cloneNode(primary, "quality.primary-duplicate");
  duplicateAction.layout.fixedWidth = 44;
  duplicateAction.layout.fixedHeight = 44;
  nodes.push(duplicateAction);

  for (let index = 0; index < 3; index += 1) {
    const root = cloneNode(source, `quality.repeated-${index}`);
    root.children = [cloneNode(source, `quality.repeated-${index}.child`)];
    nodes.push(root);
  }

  const overridden = cloneNode(source, "quality.overridden");
  overridden.componentInstance = {
    definitionId: graph.components[0]!.id,
    props: {},
    overrides: Array.from({ length: 9 }, (_, index) => ({ op: "set-included" as const, target: source.id, value: index % 2 === 0 })),
    slots: {},
  };
  nodes.push(overridden);

  screen.nodes = nodes;
  return graph;
}

describe("deterministic design-quality audit", () => {
  it("keeps the curated showcase free of avoidable design-quality findings", () => {
    expect(auditDesignQuality(demoGraph, scenario)).toEqual([]);
  });

  it("reports every measurable rule with exact affected paths and repair guidance", () => {
    const findings = auditDesignQuality(inconsistentGraph(), scenario);
    expect(new Set(findings.map((finding) => finding.ruleId))).toEqual(new Set([
      "color.excessive-literals",
      "color.unbound-token",
      "components.excessive-overrides",
      "components.repeated-structure",
      "hierarchy.primary-prominence",
      "interaction.ambiguous-label",
      "interaction.duplicate-action",
      "interaction.minimum-target",
      "responsiveness.viewport-overflow",
      "spacing.near-duplicates",
      "spacing.off-scale",
      "surfaces.excessive-pills",
      "surfaces.radius-diversity",
      "typography.excessive-uppercase",
      "typography.line-height-ratio",
      "typography.long-line",
      "typography.minimum-body-size",
      "typography.size-diversity",
      "typography.unbound-size-token",
    ]));
    expect(new Set(findings.map((finding) => finding.category))).toEqual(new Set([
      "typography", "spacing", "surfaces", "color", "hierarchy", "interaction", "responsiveness", "components-tokens",
    ]));
    for (const finding of findings) {
      expect(finding.nodeIds.length).toBeGreaterThan(0);
      expect(finding.propertyPaths.length).toBeGreaterThan(0);
      expect(finding.suggestedRepair.description.length).toBeGreaterThan(10);
      expect(finding.subjective).toBe(false);
      expect(finding.ruleVersion).toBe("1.0.0");
    }
  });

  it("detects a dense ungrouped layer tree independently of repeated structures", () => {
    const graph = structuredClone(demoGraph);
    const source = graph.screens[0]!.nodes[0]!;
    graph.screens[0]!.nodes = Array.from({ length: 41 }, (_, index) => cloneNode(source, `flat-${index}`));
    expect(auditDesignQuality(graph, scenario).map((finding) => finding.ruleId)).toContain("hierarchy.ungrouped-density");
  });

  it("surfaces deterministic findings through the shared verifier contract", () => {
    const result = verifyGraph(inconsistentGraph(), { target: "react", viewport: scenario.viewport, buildStatus: "passed" });
    const finding = result.findings.find((item) => item.rule?.id === "responsiveness.viewport-overflow");
    expect(finding).toMatchObject({
      category: "design-quality",
      designQualityCategory: "responsiveness",
      nodeId: "quality.primary",
      propertyPath: "quality.primary.layout.fixedWidth",
      subjective: false,
      rule: { standard: "IntentForm Design Quality", version: "1.0.0", profileId: "design-quality" },
    });
    expect(finding?.evidence.some((item) => item.kind === "design-quality")).toBe(true);
  });
});
