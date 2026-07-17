import { describe, expect, it } from "vitest";
import type { SemanticInterfaceGraph, SemanticNode } from "@intentform/semantic-schema";
import { ACCESSIBILITY_PROFILES, ACCESSIBILITY_RULESET, auditAccessibility } from "./index";

function actionNode(): SemanticNode {
  return {
    id: "screen.submit",
    kind: "primary-action",
    intent: { purpose: "Submit the form", label: "Submit", importance: "primary" },
    layout: {
      axis: "vertical", width: "fill", height: "hug", align: "stretch", justify: "start",
      overflow: "visible", columns: 2, splitRatio: 0.5, gapToken: "space.16", paddingToken: "space.20",
    },
    style: { role: "action", emphasis: "strong" },
    accessibility: { label: "Submit", live: "off" },
    states: [],
    interactions: [{ event: "submit", requires: [] }],
    prototypeActions: [],
    provenance: { author: "human", revision: 0 },
    children: [],
  };
}

function fixtureGraph(): SemanticInterfaceGraph {
  return {
    screens: [{
      id: "screen",
      title: "Screen",
      route: "/",
      purpose: "Complete the form",
      nodes: [actionNode()],
    }],
  } as SemanticInterfaceGraph;
}

describe("accessibility verifier", () => {
  it("audits the stable WCAG 2.2 AA profile matrix without exposing authored copy", () => {
    const graph = fixtureGraph();
    const first = auditAccessibility(graph, { target: "react" });
    const second = auditAccessibility(graph, { target: "react" });
    expect(first).toEqual(second);
    expect(first.ruleset).toEqual(ACCESSIBILITY_RULESET);
    expect(first.profiles).toEqual(ACCESSIBILITY_PROFILES);
    expect(JSON.stringify(first.findings)).not.toContain("Send money");
  });

  it("detects label-in-name, live-region, target, drag, resize and RTL risks", () => {
    const graph = fixtureGraph();
    const primary = graph.screens[0]!.nodes[0]!;
    primary.accessibility.label = "Unrelated command";
    primary.accessibility.live = "assertive";
    primary.layout.height = "fixed";
    primary.layout.fixedHeight = 20;
    primary.layout.position = { x: 10, y: 10, z: 0 };
    primary.interactions.push({ event: "drag", requires: [] });
    const result = auditAccessibility(graph, { target: "swiftui" });
    expect(new Set(result.findings.map((item) => item.ruleId))).toEqual(new Set([
      "label-in-name",
      "live-region-role",
      "assertive-live-region",
      "target-size",
      "drag-alternative",
      "text-resize",
      "rtl-logical-order",
    ]));
    expect(result.passed).toBe(false);
  });

  it("requires reasoned, scoped suppressions and keeps them visible", () => {
    const graph = fixtureGraph();
    const primary = graph.screens[0]!.nodes[0]!;
    primary.accessibility.label = "Unrelated command";
    const result = auditAccessibility(graph, {
      target: "react",
      suppressions: [{
        ruleId: "label-in-name",
        screenId: graph.screens[0]!.id,
        nodeId: primary.id,
        reason: "Reviewed with the accessibility owner.",
      }],
    });
    const finding = result.findings.find((item) => item.ruleId === "label-in-name");
    expect(finding).toMatchObject({ status: "suppressed", suppressionReason: "Reviewed with the accessibility owner." });
    expect(() => auditAccessibility(graph, {
      target: "react",
      suppressions: [{ ruleId: "label-in-name", reason: "no" }],
    })).toThrow(/requires an 8-500 character reason/);
    expect(() => auditAccessibility(graph, {
      target: "react",
      suppressions: [{ ruleId: "label-in-name", reason: "Contact owner@example.test for approval." }],
    })).toThrow(/must not contain email/);
  });
});
