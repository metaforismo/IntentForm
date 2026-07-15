import { describe, expect, it } from "vitest";
import { demoGraph } from "../../proof-report/src/demo";
import { parseGraph } from "@intentform/semantic-schema";
import { compileReact } from "./index";

describe("React layout fidelity", () => {
  it("emits flex, grid placement, asymmetric padding, and baseline classes", () => {
    const graph = structuredClone(demoGraph);
    const target = graph.screens[0]!.nodes[0]!;
    Object.assign(target.layout, {
      flexGrow: 2, flexShrink: 1, flexBasis: 120, align: "baseline",
      gridTracks: [1, 3], gridRows: [2, 1], gridColumn: { start: 1, span: 2 }, gridRow: { start: 2, span: 1 },
      paddingTokens: { top: "space.8", right: "space.12", bottom: "space.16", left: "space.20" },
    });
    const output = compileReact(parseGraph(graph));
    const source = output.files.find((file) => file.path === "src/generated/screens/home.tsx")!.content;
    const css = output.files.find((file) => file.path === "src/generated/styles.css")!.content;
    expect(source).toContain("flexGrow: 2");
    expect(source).toContain('gridColumn: "1 / span 2"');
    expect(source).toContain('padding: "8px 12px 16px 20px"');
    expect(source).toContain('"--if-grid-columns": "1fr 3fr"');
    expect(source).toContain("if-align-baseline");
    expect(css).toContain(".if-align-baseline { align-self: baseline; }");
  });
});
