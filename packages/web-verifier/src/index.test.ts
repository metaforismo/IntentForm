import { describe, expect, it } from "vitest";
import { demoGraph } from "@intentform/proof-report/demo";
import { parseGraph } from "@intentform/semantic-schema";
import { computeNeutralLayout } from "@intentform/layout-engine";
import { verifyBrowserLayoutEvidence, verifyResponsiveWeb } from "./index";

function webGraph() {
  const graph = structuredClone(demoGraph);
  graph.platforms.push({ target: "web", enabled: true, capabilities: ["semantic-html", "responsive-layout"] });
  graph.web = {
    strategy: "responsive-web",
    defaultFrame: "desktop",
    frames: [
      { id: "mobile", label: "Mobile web", mode: "browser", width: 390, height: 844 },
      { id: "desktop", label: "Desktop web", mode: "browser", width: 1440, height: 1000 },
    ],
    breakpoints: [
      { id: "small", label: "Small", minWidth: 0, maxWidth: 767 },
      { id: "large", label: "Large", minWidth: 768 },
    ],
    contentMaxWidth: 1200,
    inlinePaddingToken: "space.20",
  };
  return parseGraph(graph);
}

describe("responsive web verification", () => {
  it("compiles and covers declared browser frames", () => {
    const result = verifyResponsiveWeb(webGraph());
    expect(result.passed).toBe(true);
    expect(result.fingerprint).toMatch(/^[a-f0-9]{8}$/);
    expect(result.scenarios).toEqual([
      expect.objectContaining({ id: "mobile", activeBreakpoints: ["small"] }),
      expect.objectContaining({ id: "desktop", activeBreakpoints: ["large"] }),
    ]);
  });

  it("reports uncovered widths and fixed live-region risk deterministically", () => {
    const graph = structuredClone(webGraph());
    graph.web!.breakpoints = [{ id: "large", label: "Large", minWidth: 900 }];
    graph.screens[0]!.nodes[0]!.web = {
      display: "block", direction: "column", wrap: "nowrap", position: "fixed", insetBlockStart: 0,
      overflowX: "visible", overflowY: "visible", containerType: "normal", gridMinColumnWidth: 240,
      gridMaxColumns: 4, breakpointOverrides: {},
    };
    graph.screens[0]!.nodes[0]!.accessibility.live = "polite";
    const result = verifyResponsiveWeb(parseGraph(graph));
    expect(result.findings.map((finding) => finding.code)).toEqual(expect.arrayContaining(["web.fixed.live", "web.frame.uncovered"]));
  });

  it("evaluates breakpoint-only fixed positioning for each declared frame", () => {
    const graph = structuredClone(webGraph());
    graph.screens[0]!.nodes[0]!.web = {
      display: "block", direction: "column", wrap: "nowrap", position: "static",
      overflowX: "visible", overflowY: "visible", containerType: "normal", gridMinColumnWidth: 240,
      gridMaxColumns: 4, breakpointOverrides: { small: { position: "fixed", insetBlockStart: 0 }, large: { position: "static" } },
    };
    graph.screens[0]!.nodes[0]!.accessibility.live = "polite";
    const warnings = verifyResponsiveWeb(parseGraph(graph)).findings.filter((finding) => finding.code === "web.fixed.live");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toContain("frame mobile");
  });

  it("flags long and unbroken fixture content for localization review", () => {
    const graph = structuredClone(webGraph());
    const fixture = graph.fixtures[0]!;
    fixture.data.activitySummary = "A".repeat(170);
    const findings = verifyResponsiveWeb(parseGraph(graph)).findings;
    expect(findings.map((finding) => finding.code)).toEqual(expect.arrayContaining(["web.content.long", "web.content.unbroken"]));
  });

  it("compares captured browser bounds against the neutral layout oracle", () => {
    const graph = webGraph();
    const screen = graph.screens[0]!;
    const frame = graph.web!.frames[0]!;
    const expected = computeNeutralLayout(screen, graph, { width: frame.width!, height: frame.height });
    const evidence = [...expected.byId.values()].map((item) => ({ id: item.id, frame: { ...item.frame } }));
    expect(verifyBrowserLayoutEvidence(graph, screen.id, frame.id, evidence)).toMatchObject({ passed: true, findings: [] });
    evidence[0]!.frame.width += 12;
    expect(verifyBrowserLayoutEvidence(graph, screen.id, frame.id, evidence).findings).toEqual([
      expect.objectContaining({ severity: "error", code: "web.layout.diverged" }),
    ]);
  });
});
