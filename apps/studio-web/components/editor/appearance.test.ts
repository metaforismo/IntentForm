import { describe, expect, it } from "vitest";
import { demoGraph } from "@intentform/proof-report/demo";
import { nodeAppearanceStyle, selectionColors } from "./appearance";

describe("portable node appearance", () => {
  it("resolves literal and token-bound fills, typography, corners, effects, and rotation", () => {
    const graph = structuredClone(demoGraph);
    const node = graph.screens[0]!.nodes[0]!;
    node.layout.rotation = -12;
    node.style.appearance = {
      fills: [{ id: "fill-1", type: "solid", visible: true, color: { token: "color.accent" }, opacity: 0.8, blendMode: "normal" }],
      stroke: { visible: true, color: { color: "#ffffff" }, width: 2, style: "solid", alignment: "outside" },
      radius: { linked: true, topLeft: 8, topRight: 8, bottomRight: 8, bottomLeft: 8, token: "radius.control" },
      effects: [{ id: "shadow-1", type: "shadow", visible: true, color: { color: "rgba(0, 0, 0, 0.2)" }, x: 0, y: 8, blur: 24, spread: 0 }],
      opacity: 0.9,
      blendMode: "multiply",
      typography: { familyToken: "font.family.body", style: "italic", weight: 650, size: 18, align: "center", transform: "uppercase", wrapping: "nowrap", truncation: "ellipsis", features: ["liga"] },
    };
    const style = nodeAppearanceStyle(node, graph);
    expect(style.background).toContain(graph.tokens.modes.default!.values.colors["color.accent"]!);
    expect(style.outline).toBe("2px solid #ffffff");
    expect(style.transform).toBe("rotate(-12deg)");
    expect(style.boxShadow).toContain("0px 8px 24px 0px");
    expect(style.fontStyle).toBe("italic");
    expect(style.textOverflow).toBe("ellipsis");
  });

  it("aggregates selection colors by binding and visual origin", () => {
    const graph = structuredClone(demoGraph);
    const first = graph.screens[0]!.nodes[0]!;
    const second = graph.screens[0]!.nodes[1]!;
    first.style.appearance = { fills: [{ id: "fill-1", type: "solid", visible: true, color: { token: "color.accent" }, opacity: 1, blendMode: "normal" }], effects: [], opacity: 1, blendMode: "normal" };
    second.style.appearance = { fills: [{ id: "fill-2", type: "solid", visible: true, color: { token: "color.accent" }, opacity: 1, blendMode: "normal" }], stroke: { visible: true, color: { token: "color.accent" }, width: 1, style: "solid", alignment: "inside" }, effects: [], opacity: 1, blendMode: "normal" };
    expect(selectionColors([first, second], graph)).toEqual([expect.objectContaining({ token: "color.accent", usages: 3, origins: ["fill", "stroke"] })]);
  });
});
