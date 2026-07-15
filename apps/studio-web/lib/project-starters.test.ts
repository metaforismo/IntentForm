import { describe, expect, it } from "vitest";
import { parseGraph } from "@intentform/semantic-schema";
import {
  createStarterGraph,
  projectExamples,
  type ProjectType,
} from "./project-starters";

describe("project starters", () => {
  it.each<ProjectType>(["application", "prototype", "component-library", "responsive-web"])(
    "creates a deterministic valid %s starter",
    (projectType) => {
      const first = createStarterGraph({
        name: "Northline Field Notes",
        audience: "Distributed research teams",
        purpose: "Review and organize field observations",
        projectType,
        targets: projectType === "responsive-web" ? ["react", "swiftui", "web"] : ["react", "swiftui"],
      });
      const second = createStarterGraph({
        name: "Northline Field Notes",
        audience: "Distributed research teams",
        purpose: "Review and organize field observations",
        projectType,
        targets: projectType === "responsive-web" ? ["react", "swiftui", "web"] : ["react", "swiftui"],
      });

      expect(parseGraph(first)).toEqual(first);
      expect(second).toEqual(first);
      expect(first.product.name).toBe("Northline Field Notes");
      expect(first.platforms.every((platform) => platform.enabled)).toBe(true);
      expect(first.screens[0]?.nodes).toHaveLength(1);
    },
  );

  it("creates a responsive-web starter with intrinsic frames, breakpoints, and typed layout", () => {
    const graph = createStarterGraph({
      name: "Northline Journal",
      audience: "Field researchers",
      purpose: "Publish observations across browser widths",
      projectType: "responsive-web",
      targets: ["web"],
    });
    expect(graph.web).toEqual(expect.objectContaining({
      strategy: "responsive-web",
      defaultFrame: "desktop-browser",
      inlinePaddingToken: "space.20",
    }));
    expect(graph.web?.frames.map((frame) => frame.mode)).toEqual(["browser", "browser", "browser", "fluid"]);
    expect(graph.web?.breakpoints.map((breakpoint) => breakpoint.id)).toEqual(["small", "medium", "large"]);
    expect(graph.screens[0]?.nodes[0]?.web).toEqual(expect.objectContaining({ display: "grid", containerType: "inline-size" }));
    expect(graph.platforms.find((platform) => platform.target === "web")?.enabled).toBe(true);
  });

  it("enables only explicitly selected compiler targets", () => {
    const graph = createStarterGraph({
      name: "Sable Inventory",
      audience: "Independent shop operators",
      purpose: "Track stock changes without a spreadsheet",
      projectType: "application",
      targets: ["react"],
    });
    expect(graph.platforms).toEqual([
      expect.objectContaining({ target: "react", enabled: true }),
      expect.objectContaining({ target: "swiftui", enabled: false }),
    ]);
  });

  it("ships multiple validated examples as copy-only source graphs", () => {
    expect(projectExamples.length).toBeGreaterThanOrEqual(3);
    expect(new Set(projectExamples.map((example) => example.graph.product.name)).size).toBe(projectExamples.length);
    for (const example of projectExamples) expect(parseGraph(example.graph)).toEqual(example.graph);
  });

  it("rejects an empty target selection", () => {
    expect(() => createStarterGraph({
      name: "No Target",
      audience: "Product teams",
      purpose: "Test target validation",
      projectType: "prototype",
      targets: [],
    })).toThrow(/at least one target/i);
  });
});
