import { describe, expect, it } from "vitest";
import { demoGraph } from "../../proof-report/src/demo";
import { parseGraph } from "@intentform/semantic-schema";
import { compileSwiftUI } from "./index";

describe("SwiftUI layout fidelity", () => {
  it("emits edge insets and layout priority while reporting unsupported CSS-grid placement", () => {
    const graph = structuredClone(demoGraph);
    const target = graph.screens[0]!.nodes[0]!;
    Object.assign(target.layout, {
      flexGrow: 4, flexShrink: 1, flexBasis: 120, gridRow: { start: 2, span: 1 },
      paddingTokens: { top: "space.8", right: "space.12", bottom: "space.16", left: "space.20" },
    });
    const output = compileSwiftUI(parseGraph(graph));
    const screen = output.files.find((file) => file.path.startsWith("Generated/Screens/") && file.content.includes("flexGrow: 4"))!.content;
    const components = output.files.find((file) => file.path === "Generated/Components/IntentFormComponents.swift")!.content;
    expect(screen).toContain("flexGrow: 4");
    expect(screen).toContain("paddingTop: 8");
    expect(screen).toContain("paddingRight: 12");
    expect(components).toContain(".layoutPriority(flexGrow)");
    expect(components).toContain("EdgeInsets(top: paddingTop, leading: paddingLeft");
    expect(output.diagnostics.map((item) => item.message)).toEqual(expect.arrayContaining([
      expect.stringContaining("CSS-grid track placement"),
      expect.stringContaining("no direct flex-shrink or flex-basis equivalent"),
    ]));
  });

  it("keeps unsupported appearance effects explicit in SwiftUI diagnostics", () => {
    const graph = structuredClone(demoGraph);
    graph.screens[0]!.nodes[0]!.style.appearance = {
      fills: [],
      effects: [{ id: "inner-1", type: "inner-shadow", visible: true, color: { color: "rgba(0, 0, 0, 0.2)" }, x: 0, y: 2, blur: 8, spread: 0 }],
      opacity: 1,
      blendMode: "normal",
    };
    expect(compileSwiftUI(parseGraph(graph)).diagnostics).toContainEqual(expect.objectContaining({
      path: expect.stringContaining("style.appearance.effects.inner-1"),
      message: expect.stringContaining("cannot lower inner-shadow"),
    }));
  });
});
