import { describe, expect, it } from "vitest";
import { demoGraph } from "@intentform/proof-report/demo";
import { parseGraph } from "@intentform/semantic-schema";
import { projectComputedDom, type ComputedDomNode, type ComputedDomStyle } from "./dom-import";

function graph() {
  const source = structuredClone(demoGraph);
  source.platforms.push({ target: "web", enabled: true, capabilities: ["semantic-html", "responsive-layout"] });
  source.web = {
    strategy: "responsive-web",
    defaultFrame: "desktop",
    frames: [{ id: "desktop", label: "Desktop", mode: "browser", width: 1440, height: 1000 }],
    breakpoints: [{ id: "desktop", label: "Desktop", minWidth: 0 }],
    contentMaxWidth: 1200,
    inlinePaddingToken: "space.20",
  };
  return parseGraph(source);
}

function style(overrides: Partial<ComputedDomStyle> = {}): ComputedDomStyle {
  return {
    display: "block", flexDirection: "column", flexWrap: "nowrap", position: "static", insetBlockStart: null,
    overflowX: "visible", overflowY: "visible", gap: 0,
    paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0,
    alignItems: "stretch", justifyContent: "flex-start", width: 320, height: 80,
    gridTemplateColumns: [], color: "rgb(24, 28, 26)", backgroundColor: "rgba(0, 0, 0, 0)",
    borderColor: "rgb(0, 0, 0)", borderWidth: 0, borderStyle: "none", borderRadius: 0,
    opacity: 1, fontFamily: "Arial, sans-serif", fontSize: 16, fontWeight: 400, lineHeight: 24,
    letterSpacing: 0, textAlign: "start", ...overrides,
  };
}

function node(overrides: Partial<ComputedDomNode> = {}): ComputedDomNode {
  return {
    tag: "p", text: "Imported copy", accessibleName: "Imported copy", hasImageSource: false,
    unsupported: [], style: style(), children: [], ...overrides,
  };
}

describe("browser computed DOM projection", () => {
  it("converts native flex, grid, typography, borders, and hierarchy into a validated graph", () => {
    const source = graph();
    const projection = projectComputedDom(source, "home", [node({
      tag: "section",
      text: "",
      accessibleName: "Feature grid",
      style: style({
        display: "grid", gap: 16, paddingTop: 20, paddingRight: 20, paddingBottom: 20, paddingLeft: 20,
        gridTemplateColumns: [240, 480], backgroundColor: "rgb(255, 255, 255)", borderWidth: 1,
        borderStyle: "solid", borderColor: "rgb(210, 210, 210)", borderRadius: 8,
      }),
      children: [node({ style: style({ fontSize: 18, fontWeight: 700, lineHeight: 26 }) })],
    })]);
    const root = projection.graph.screens.find((screen) => screen.id === "home")!.nodes[0]!;
    expect(root.kind).toBe("grid");
    expect(root.layout.gridTracks).toEqual([1, 2]);
    expect(root.layout.paddingTokens).toBeDefined();
    expect(root.web?.visual).toEqual(expect.objectContaining({ backgroundColor: "rgb(255, 255, 255)", borderRadius: 8 }));
    expect(root.children[0]).toEqual(expect.objectContaining({ kind: "text", style: expect.objectContaining({ emphasis: "strong" }) }));
    expect(root.children[0]!.web?.visual).toEqual(expect.objectContaining({
      paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0,
    }));
    expect(projection.importedNodes).toBe(2);
    expect(projection.replacedNodes).toBeGreaterThan(0);
    expect(projection.changes.length).toBeGreaterThan(0);
    expect(parseGraph(projection.graph)).toEqual(projection.graph);
  });

  it("reports unsupported effects and asset handoff without inventing fidelity", () => {
    const projection = projectComputedDom(graph(), "home", [node({
      tag: "img", hasImageSource: true, unsupported: ["transform", "box-shadow"],
    })]);
    expect(projection.graph.screens.find((screen) => screen.id === "home")!.nodes[0]!.kind).toBe("image");
    expect(projection.diagnostics.map((diagnostic) => diagnostic.message).join(" ")).toMatch(/transform.*not silently approximated/i);
    expect(projection.diagnostics.map((diagnostic) => diagnostic.message).join(" ")).toMatch(/image bytes are not embedded/i);
  });

  it("keeps interactive and rich text elements semantic leaves", () => {
    const projection = projectComputedDom(graph(), "home", [node({
      tag: "button",
      text: "Continue",
      accessibleName: "Continue",
      children: [node({ tag: "span", text: "Continue", accessibleName: "Continue" })],
    })]);
    const imported = projection.graph.screens.find((screen) => screen.id === "home")!.nodes[0]!;
    expect(imported.kind).toBe("primary-action");
    expect(imported.children).toEqual([]);
    expect(imported.interactions.some((interaction) => interaction.event === "onRequestPayment")).toBe(true);
  });

  it("fails closed for unknown screens and empty imports", () => {
    expect(() => projectComputedDom(graph(), "unknown", [node()])).toThrow(/selected screen/i);
    expect(() => projectComputedDom(graph(), "home", [])).toThrow(/supported visible elements/i);
  });
});
