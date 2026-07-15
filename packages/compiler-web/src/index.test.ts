import { describe, expect, it } from "vitest";
import { demoGraph } from "@intentform/proof-report/demo";
import { parseGraph } from "@intentform/semantic-schema";
import { compileWeb } from "./index";

function responsiveGraph() {
  const graph = structuredClone(demoGraph);
  graph.platforms.push({ target: "web", enabled: true, capabilities: ["semantic-html", "responsive-layout", "intrinsic-grid"] });
  graph.web = {
    strategy: "responsive-web",
    defaultFrame: "desktop",
    frames: [
      { id: "mobile", label: "Mobile", mode: "browser", width: 390, height: 844 },
      { id: "desktop", label: "Desktop", mode: "browser", width: 1440, height: 1000 },
    ],
    breakpoints: [
      { id: "small", label: "Small", minWidth: 0, maxWidth: 767 },
      { id: "large", label: "Large", minWidth: 768 },
    ],
    contentMaxWidth: 1160,
    inlinePaddingToken: "space.20",
  };
  graph.screens[0]!.nodes[0]!.web = {
    display: "grid",
    direction: "column",
    wrap: "wrap",
    position: "sticky",
    insetBlockStart: 64,
    overflowX: "clip",
    overflowY: "visible",
    aspectRatio: 1.6,
    containerType: "inline-size",
    gridMinColumnWidth: 260,
    gridMaxColumns: 3,
    breakpointOverrides: { large: { gridMinColumnWidth: 320, gridMaxColumns: 4 } },
  };
  return parseGraph(graph);
}

describe("responsive web compiler", () => {
  it("generates deterministic buildable React/TypeScript routes and owned CSS", () => {
    const graph = responsiveGraph();
    const first = compileWeb(graph);
    const second = compileWeb(graph);
    expect(first).toEqual(second);
    expect(first.target).toBe("web");
    expect(first.files.map((file) => file.path)).toEqual(expect.arrayContaining([
      "package.json", "index.html", "src/main.tsx", "src/app.tsx", "src/styles.css", "intentform.web.json",
      "src/routes/home.tsx", "src/contracts/home.ts",
    ]));
    const css = first.files.find((file) => file.path === "src/styles.css")!.content;
    expect(css).toContain("grid-template-columns: repeat(auto-fit, minmax(");
    expect(css).toContain("@media (min-width: 768px)");
    expect(css).toContain("container-type: inline-size");
    expect(css).toContain("position: sticky");
    expect(css).toContain("inset-block-start: 64px");
    const app = first.files.find((file) => file.path === "src/app.tsx")!.content;
    expect(app).toContain("Skip to content");
    expect(app).toContain("window.history.pushState");
    expect(app).toContain("visualState");
    expect(app).toContain('"status":"failed"');
    expect(first.files.find((file) => file.path === "src/routes/payment-request.tsx")!.content).toContain("Payment could not be sent");
    expect(css).toContain('.if-page[data-token-mode="evening"]');
    const generatedPackage = JSON.parse(first.files.find((file) => file.path === "package.json")!.content) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(generatedPackage.dependencies).toEqual({ react: "19.2.4", "react-dom": "19.2.4" });
    expect(generatedPackage.devDependencies).toEqual(expect.objectContaining({ typescript: "5.9.3", vite: "8.1.4" }));
    expect(Object.values({ ...generatedPackage.dependencies, ...generatedPackage.devDependencies })).not.toContain("latest");
    expect(first.files.some((file) => file.content.includes("dangerouslySetInnerHTML"))).toBe(false);
  });

  it("supports block-only sites and keeps punctuation-distinct node IDs isolated", () => {
    const graph = structuredClone(responsiveGraph());
    const receipt = graph.screens.find((screen) => screen.id === "receipt")!;
    receipt.nodes[0]!.id = "sample.dot";
    receipt.nodes[1]!.id = "sample-dot";
    graph.screens = [receipt];
    graph.contracts = graph.contracts.filter((contract) => contract.screenId === "receipt");
    graph.fixtures = graph.fixtures.filter((fixture) => fixture.screenId === "receipt");
    graph.flows = [];
    const output = compileWeb(parseGraph(graph));
    const css = output.files.find((file) => file.path === "src/styles.css")!.content;
    expect(css).not.toContain("grid-template-columns: repeat(auto-fit");
    expect(css).toContain(".if-web-sample-dot");
    expect(css).toContain(".if-web-sample_dot");
  });

  it("changes fingerprints for breakpoint behavior and escapes authored text as data", () => {
    const graph = structuredClone(responsiveGraph());
    const baseline = compileWeb(graph);
    graph.screens[0]!.title = 'Research </h1><script>alert("x")</script>';
    graph.screens[0]!.nodes[0]!.web!.breakpointOverrides.large = { direction: "row" };
    const edited = compileWeb(parseGraph(graph));
    expect(edited.fingerprint).not.toBe(baseline.fingerprint);
    expect(edited.files.find((file) => file.path === "src/routes/home.tsx")!.content).toContain('Research </h1><script>alert(\\"x\\")</script>');
    expect(edited.files.find((file) => file.path === "src/styles.css")!.content).toContain("flex-direction: row");
  });

  it("changes fingerprints when visual-state fixture data changes", () => {
    const graph = structuredClone(responsiveGraph());
    const baseline = compileWeb(graph);
    graph.fixtures.find((fixture) => fixture.id === "payment-request.failed")!.data.recipientName = "Localized failure recipient";
    const edited = compileWeb(parseGraph(graph));
    expect(edited.fingerprint).not.toBe(baseline.fingerprint);
    expect(edited.files.find((file) => file.path === "src/app.tsx")!.content).toContain("Localized failure recipient");
  });

  it("fails closed when the target or profile is unavailable", () => {
    const disabled = structuredClone(responsiveGraph());
    disabled.platforms.find((platform) => platform.target === "web")!.enabled = false;
    expect(() => compileWeb(parseGraph(disabled))).toThrow(/web target is not enabled/);
    const missing = structuredClone(responsiveGraph());
    delete missing.web;
    expect(() => parseGraph(missing)).toThrow(/requires a responsive-web profile/);
  });
});
