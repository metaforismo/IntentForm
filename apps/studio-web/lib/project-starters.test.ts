import { describe, expect, it } from "vitest";
import { flattenSemanticNodes, parseGraph } from "@intentform/semantic-schema";
import { verifyGraph } from "@intentform/verifier";
import {
  createStarterGraph,
  createLumenShowcaseGraph,
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
        targets: projectType === "responsive-web" ? ["react", "swiftui", "expo", "web"] : ["react", "swiftui", "expo"],
      });
      const second = createStarterGraph({
        name: "Northline Field Notes",
        audience: "Distributed research teams",
        purpose: "Review and organize field observations",
        projectType,
        targets: projectType === "responsive-web" ? ["react", "swiftui", "expo", "web"] : ["react", "swiftui", "expo"],
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

  it("creates an Expo Router starter with a deterministic safe slug and universal fallback", () => {
    const graph = createStarterGraph({
      name: "Crème & Field Notes",
      audience: "Field researchers",
      purpose: "Capture observations on mobile devices",
      projectType: "application",
      targets: ["expo"],
    });
    expect(graph.expo).toEqual({
      strategy: "expo-router",
      sdkVersion: "57.0.0",
      slug: "creme-field-notes",
      scheme: "creme-field-notes",
      defaultRenderStrategy: "universal-react-native",
      developmentBuild: false,
    });
    expect(graph.platforms.filter((platform) => platform.enabled)).toEqual([expect.objectContaining({ target: "expo", enabled: true })]);
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

  it.each([
    ["empty", ["home.start"]],
    ["patterns", ["home.start", "home.primary-input", "home.primary-action"]],
    ["example", ["home.example"]],
  ] as const)("creates the selected %s starter content", (startFrom, nodeIds) => {
    const graph = createStarterGraph({
      name: "Starter content",
      audience: "Product teams",
      purpose: "Test a complete onboarding choice",
      projectType: "application",
      targets: ["react"],
      startFrom,
    });
    expect(graph.screens[0]?.nodes.map((node) => node.id)).toEqual(nodeIds);
    if (startFrom === "example") expect(graph.screens[0]?.nodes[0]?.children).toHaveLength(4);
  });

  it.each([
    ["light", ["default"], "default"],
    ["dark", ["default", "dark"], "dark"],
    ["both", ["default", "dark"], "default"],
  ] as const)("creates the selected %s token modes", (theme, modes, activeMode) => {
    const graph = createStarterGraph({
      name: "Starter theme",
      audience: "Product teams",
      purpose: "Test deterministic token modes",
      projectType: "application",
      targets: ["react"],
      theme,
    });
    expect(Object.keys(graph.tokens.modes)).toEqual(modes);
    expect(graph.tokens.activeMode).toBe(activeMode);
    expect(parseGraph(graph)).toEqual(graph);
  });

  it("ships multiple validated examples as copy-only source graphs", () => {
    expect(projectExamples.length).toBeGreaterThanOrEqual(3);
    expect(new Set(projectExamples.map((example) => example.graph.product.name)).size).toBe(projectExamples.length);
    for (const example of projectExamples) expect(parseGraph(example.graph)).toEqual(example.graph);
  });

  it("ships the original Aster Sound multi-platform showcase", () => {
    const graph = createLumenShowcaseGraph();
    expect(graph.product.name).toBe("Aster Sound");
    expect(graph.screens.map((screen) => screen.id)).toEqual(["library", "collection", "player"]);
    expect(Object.keys(graph.tokens.modes)).toEqual(expect.arrayContaining(["default", "evening", "compact"]));
    expect(graph.components.length).toBeGreaterThan(0);
    expect(graph.components.map((component) => component.id)).toEqual(["aster.playback-action", "aster.release-surface"]);
    expect(graph.platforms.filter((platform) => platform.enabled).map((platform) => platform.target))
      .toEqual(expect.arrayContaining(["react", "swiftui", "expo", "web"]));
    const nodes = graph.screens.flatMap((screen) => flattenSemanticNodes(screen.nodes));
    const originalArtwork = nodes.filter((node) => node.style.role === "original-vector-art");
    expect(originalArtwork.length).toBeGreaterThanOrEqual(12);
    expect(originalArtwork.every((node) => node.web === undefined && node.style.appearance?.fills.length)).toBe(true);
    expect(nodes.find((node) => node.id === "library.tidal.play")?.prototypeActions)
      .toContainEqual(expect.objectContaining({ type: "navigate", targetScreenId: "player" }));
    expect(nodes.find((node) => node.id === "player.play")?.prototypeActions)
      .toContainEqual(expect.objectContaining({ type: "change-state", state: "completed" }));
    expect(graph.reviewThreads).toContainEqual(expect.objectContaining({
      id: "review.aster-player-action",
      messages: expect.arrayContaining([expect.objectContaining({ transactionId: "transaction.aster-player-placement" })]),
    }));
    expect(graph.contracts.flatMap((contract) => contract.visualStates))
      .toEqual(expect.arrayContaining(["idle", "loading", "empty", "failed", "completed"]));
    const verification = verifyGraph(graph, {
      target: "web",
      viewport: { width: 1440, height: 1000 },
      buildStatus: "passed",
      deviceProfile: "device:desktop",
      visualState: "idle",
    });
    expect(verification.findings.filter((finding) => finding.category === "design-quality"))
      .toEqual([]);
    expect(JSON.stringify(graph)).not.toMatch(/lorem ipsum|spotify|apple music/i);
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
