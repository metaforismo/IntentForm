import { describe, expect, it } from "vitest";
import { demoGraph } from "@intentform/proof-report/demo";
import { parseGraph } from "@intentform/semantic-schema";
import { instantiateComponent } from "@intentform/semantic-schema/component-library";
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
      "src/routes/home.tsx", "src/contracts/home.ts", "html/home.html", "html/styles.css",
    ]));
    const css = first.files.find((file) => file.path === "src/styles.css")!.content;
    expect(css).toContain("grid-template-columns: repeat(auto-fit, minmax(");
    expect(css).toContain("@media (min-width: 768px)");
    expect(css).toContain("container-type: inline-size");
    expect(css).toContain("position: sticky");
    expect(css).toContain("inset-block-start: 64px");
    expect(css).toContain("@media (forced-colors: active)");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("min-height: 44px");
    // Inputs must not keep their intrinsic UA width: an unconstrained input
    // sizes its grid track past the node's flex box and overlaps siblings.
    expect(css).toContain(".if-field input { width: 100%; min-width: 0;");
    expect(first.files.find((file) => file.path === "index.html")!.content).toContain('lang="en" dir="auto"');
    const app = first.files.find((file) => file.path === "src/app.tsx")!.content;
    expect(app).toContain("Skip to content");
    expect(app).toContain("window.history.pushState");
    expect(app).toContain("visualState");
    expect(app).toContain('"status":"failed"');
    expect(app).not.toContain("if-site-nav");
    const route = first.files.find((file) => file.path === "src/routes/home.tsx")!.content;
    expect(route).not.toContain("if-page-header");
    expect(route).not.toContain("if-eyebrow");
    expect(first.files.find((file) => file.path === "html/home.html")!.content).toContain('data-screen-id="home"');
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
    graph.prototype.startScreenId = receipt.id;
    graph.reviewThreads = [];
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

  it("emits flex, explicit grid placement, baseline, and asymmetric padding declarations", () => {
    const graph = structuredClone(responsiveGraph());
    const target = graph.screens[0]!.nodes[0]!;
    Object.assign(target.layout, {
      flexGrow: 2, flexShrink: 3, flexBasis: 180, align: "baseline",
      gridTracks: [1, 2], gridRows: [2, 1], gridColumn: { start: 2, span: 1 }, gridRow: { start: 1, span: 2 },
      paddingTokens: { top: "space.8", right: "space.12", bottom: "space.16", left: "space.20" },
    });
    const css = compileWeb(parseGraph(graph)).files.find((file) => file.path === "src/styles.css")!.content;
    expect(css).toContain("flex-grow: 2");
    expect(css).toContain("flex-shrink: 3");
    expect(css).toContain("flex-basis: 180px");
    expect(css).toContain("grid-template-columns: 1fr 2fr");
    expect(css).toContain("grid-template-rows: 2fr 1fr");
    expect(css).toContain("grid-column: 2 / span 1");
    expect(css).toContain("grid-row: 1 / span 2");
    expect(css).toContain("align-self: baseline");
    expect(css).toContain("padding: 8px 12px 16px 20px");
  });

  it("compiles typed visual Web properties without restoring a universal design template", () => {
    const graph = structuredClone(responsiveGraph());
    graph.screens[0]!.nodes[0]!.web!.visual = {
      color: "rgb(12, 24, 36)",
      backgroundColor: "oklch(70% 0.15 240)",
      borderColor: "#abc",
      borderWidth: 2,
      borderStyle: "solid",
      borderRadius: 6,
      opacity: 0.9,
      fontFamily: '"Geist", sans-serif',
      fontSize: 18,
      fontWeight: 620,
      lineHeight: 26,
      letterSpacing: -0.2,
      textAlign: "center",
    };
    const output = compileWeb(parseGraph(graph));
    const css = output.files.find((file) => file.path === "src/styles.css")!.content;
    expect(css).toContain("background-color: oklch(70% 0.15 240)");
    expect(css).toContain('font-family: "Geist", sans-serif');
    expect(css).toContain("border-radius: 6px");
    expect(css).not.toContain("if-page-header");
    expect(css).not.toContain("if-site-nav");
    expect(css).not.toContain("font-size: clamp(2.5rem");
  });

  it("lowers portable authored appearance into exact Web declarations", () => {
    const graph = structuredClone(responsiveGraph());
    const target = graph.screens[0]!.nodes[0]!;
    target.layout.rotation = 9;
    target.style.appearance = {
      fills: [{ id: "gradient-1", type: "linear-gradient", visible: true, angle: 135, stops: [{ position: 0, color: { token: "color.accent" } }, { position: 1, color: { color: "#112233" } }], opacity: 1, blendMode: "normal" }],
      stroke: { visible: true, color: { color: "#abcdef" }, width: 2, style: "dashed", alignment: "outside" },
      radius: { linked: false, topLeft: 4, topRight: 8, bottomRight: 12, bottomLeft: 16 },
      effects: [{ id: "shadow-1", type: "inner-shadow", visible: true, color: { color: "rgba(0, 0, 0, 0.25)" }, x: 1, y: 2, blur: 8, spread: 0 }],
      opacity: 0.8,
      blendMode: "multiply",
      typography: { family: '"Geist", sans-serif', style: "italic", weight: 640, size: 19, lineHeight: 27, letterSpacing: -0.3, align: "center", transform: "uppercase", wrapping: "balance", truncation: "none", features: ["liga"] },
    };
    const css = compileWeb(parseGraph(graph)).files.find((file) => file.path === "src/styles.css")!.content;
    expect(css).toContain("linear-gradient(135deg");
    expect(css).toContain("outline: 2px dashed #abcdef");
    expect(css).toContain("border-radius: 4px 8px 12px 16px");
    expect(css).toContain("box-shadow: inset 1px 2px 8px 0px rgba(0, 0, 0, 0.25)");
    expect(css).toContain("transform: rotate(9deg)");
    expect(css).toContain("font-feature-settings: \"liga\" 1");
  });

  it("emits exact signed package imports and mapped props for registered Web code components", () => {
    const graph = structuredClone(responsiveGraph());
    const definition = graph.components[0]!;
    const exportPath = "components/balance-summary";
    graph.dependencies.push({
      id: "@intentform/acme-ui",
      version: "2.4.1",
      kind: "component-library",
      manifestDigest: "a".repeat(64),
      artifactDigest: "b".repeat(64),
      publisherKeyId: "acme.release",
      visibility: "public",
      registry: "https://packages.example.test",
      publishedAt: "2026-07-15T12:00:00.000Z",
      sourceRevision: "release-2.4.1",
      license: "MIT",
      exports: [exportPath],
    });
    definition.codeBindings = [{
      target: "web",
      dependencyId: "@intentform/acme-ui",
      exportPath,
      exportName: "BalanceSummary",
      propertyMap: { title: definition.properties[0]!.name },
    }];
    const instanceGraph = instantiateComponent(parseGraph(graph), {
      definitionId: definition.id,
      instanceId: "home.code-component",
      screenId: "home",
      props: { [definition.properties[0]!.name]: "Available now" },
    });
    const output = compileWeb(parseGraph(instanceGraph));
    const route = output.files.find((file) => file.path === "src/routes/home.tsx")!.content;
    const packageJson = JSON.parse(output.files.find((file) => file.path === "package.json")!.content) as { dependencies: Record<string, string> };
    expect(route).toContain('import { BalanceSummary as IntentForm_');
    expect(route).toContain('from "@intentform/acme-ui/components/balance-summary"');
    expect(route).toContain('title={"Available now"}');
    expect(packageJson.dependencies["@intentform/acme-ui"]).toBe("2.4.1");
  });
});
