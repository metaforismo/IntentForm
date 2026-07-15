import { describe, expect, it } from "vitest";
import { compileReact, lowerGraph } from "@intentform/compiler-react";
import { compileSwiftUI } from "@intentform/compiler-swiftui";
import {
  parseGraph,
  findGraphNode,
  semanticDiff,
  stableSerialize,
  type SemanticInterfaceGraph,
} from "@intentform/semantic-schema";
import {
  instantiateComponent,
  setComponentProperty,
} from "@intentform/semantic-schema/component-library";
import { demoGraph } from "./demo";
import { buildProofReport } from "./index";
import { verifyGraph, verifyRenderedPrimaryAction } from "@intentform/verifier";

const completedBuildEvidence = { before: "passed", after: "passed" } as const;

describe("IntentForm proof pipeline", () => {
  it("round-trips the canonical graph deterministically", () => {
    const serialized = stableSerialize(demoGraph);
    expect(parseGraph(JSON.parse(serialized))).toEqual(demoGraph);
    expect(stableSerialize(JSON.parse(serialized))).toBe(serialized);
  });

  it("produces byte-equivalent output for the same graph", () => {
    expect(compileReact(demoGraph)).toEqual(compileReact(demoGraph));
    expect(compileSwiftUI(demoGraph)).toEqual(compileSwiftUI(demoGraph));
  });

  it("expands component bindings before both compilers and updates both fingerprints", () => {
    const inserted = parseGraph(instantiateComponent(demoGraph, {
      definitionId: "intent.balance-summary",
      instanceId: "layout-lab.library-balance",
      screenId: "layout-lab",
      props: { label: "Library balance" },
    }));
    const edited = parseGraph(setComponentProperty(
      inserted,
      "layout-lab.library-balance",
      "label",
      "Updated library balance",
    ));

    expect(findGraphNode(inserted, "layout-lab.library-balance")?.intent.label).toBe("Library balance");
    expect(findGraphNode(edited, "layout-lab.library-balance")?.intent.label).toBe("Updated library balance");
    expect(compileReact(edited).fingerprint).not.toBe(compileReact(inserted).fingerprint);
    expect(compileSwiftUI(edited).fingerprint).not.toBe(compileSwiftUI(inserted).fingerprint);
  });

  it("preserves the recursive layout hierarchy in IR and both generated targets", () => {
    const layoutScreen = lowerGraph(demoGraph, "react").screens.find((screen) => screen.id === "layout-lab");
    expect(layoutScreen?.layoutCoverage).toEqual({
      nodeCount: 20,
      maxDepth: 4,
      containerKinds: [
        "adaptive", "freeform", "grid", "overlay", "page-flow",
        "safe-area", "scroll", "split", "stack", "wrap",
      ],
    });
    expect(layoutScreen?.nodes[0]?.children[0]?.children[0]?.children[0]?.id).toBe("layout-lab.grid-a");

    const react = compileReact(demoGraph);
    const reactScreen = react.files.find((file) => file.path.endsWith("layout-lab.tsx"));
    const reactStyles = react.files.find((file) => file.path.endsWith("styles.css"));
    expect(reactScreen?.content).toContain("if-mode-compact-stack if-mode-regular-grid");
    expect(reactScreen?.content).toContain('data-node-id="layout-lab.freeform-a"');
    expect(reactStyles?.content).toContain(".if-mode-regular-freeform > .if-node { position: absolute;");

    const swift = compileSwiftUI(demoGraph);
    const swiftScreen = swift.files.find((file) => file.path.endsWith("layoutLab.swift"));
    const swiftComponents = swift.files.find((file) => file.path.endsWith("IntentFormComponents.swift"));
    expect(swiftScreen?.content).toContain('mode: deviceClass == .compact ? "stack" : "grid"');
    expect(swiftScreen?.content).toContain('mode: deviceClass == .compact ? "freeform" : "freeform"');
    expect(swiftScreen?.content).toContain("fixedHeight: 180");
    expect(swiftScreen?.content).toContain('align: "stretch"');
    expect(swiftScreen?.content).toContain('justify: "start"');
    expect(swiftComponents?.content).toContain('case "grid":');
    expect(swiftComponents?.content).toContain('case "overlay", "freeform":');
    expect(swiftComponents?.content).toContain("struct IntentFormLinearLayout: Layout");
    expect(swiftComponents?.content).toContain("leadingRatio: splitRatio");
    expect(swiftComponents?.content).toContain("splitContentMain * clampedRatio");
    expect(swiftComponents?.content).toContain('case "space-between" where subviews.count > 1:');
  });

  const editableParityCases: Array<[
    string,
    (graph: SemanticInterfaceGraph) => void,
  ]> = [
    ["screen purpose", (graph) => { graph.screens[1]!.purpose = "Collect and confirm a customer payment request"; }],
    ["screen route", (graph) => { graph.screens[1]!.route = "/collect-payment"; }],
    ["node purpose", (graph) => { graph.screens[1]!.nodes[1]!.intent.purpose = "Confirm the verified recipient identity"; }],
    ["importance", (graph) => { graph.screens[1]!.nodes[1]!.intent.importance = "secondary"; }],
    ["layout axis", (graph) => { graph.screens[1]!.nodes[1]!.layout.axis = "horizontal"; }],
    ["layout width", (graph) => { graph.screens[1]!.nodes[1]!.layout.width = "hug"; }],
    ["layout height", (graph) => { graph.screens[1]!.nodes[1]!.layout.height = "fixed"; graph.screens[1]!.nodes[1]!.layout.fixedHeight = 96; }],
    ["layout constraints", (graph) => { graph.screens[1]!.nodes[1]!.layout.minWidth = 180; graph.screens[1]!.nodes[1]!.layout.maxWidth = 360; }],
    ["layout alignment", (graph) => { graph.screens[1]!.nodes[1]!.layout.align = "center"; graph.screens[1]!.nodes[1]!.layout.justify = "space-between"; }],
    ["layout overflow", (graph) => { graph.screens[1]!.nodes[1]!.layout.overflow = "clip"; }],
    ["grid columns", (graph) => { findGraphNode(graph, "layout-lab.grid")!.layout.columns = 1; }],
    ["split ratio", (graph) => { findGraphNode(graph, "layout-lab.split")!.layout.splitRatio = 0.65; }],
    ["adaptive modes", (graph) => { findGraphNode(graph, "layout-lab.adaptive")!.layout.adaptive = { compact: "wrap", regular: "split" }; }],
    ["freeform position", (graph) => { findGraphNode(graph, "layout-lab.freeform-a")!.layout.position = { x: 32, y: 48, z: 4 }; }],
    ["layout gap", (graph) => { graph.screens[1]!.nodes[1]!.layout.gapToken = "space.8"; }],
    ["layout padding", (graph) => { graph.screens[1]!.nodes[1]!.layout.paddingToken = "space.24"; }],
    ["style role", (graph) => { graph.screens[1]!.nodes[1]!.style.role = "surface"; }],
    ["style emphasis", (graph) => { graph.screens[1]!.nodes[1]!.style.emphasis = "strong"; }],
    ["accessibility hint", (graph) => { graph.screens[1]!.nodes[1]!.accessibility.hint = "Verify the recipient before continuing"; }],
    ["accessibility live mode", (graph) => { graph.screens[1]!.nodes[2]!.accessibility.live = "assertive"; }],
    ["spacing token", (graph) => { graph.tokens.modes.default!.values.spacing["space.16"] = 19; }],
    ["surface color token", (graph) => { graph.tokens.modes.default!.values.colors["color.surface"] = "#f7f2e8"; }],
  ];

  it.each(editableParityCases)("lowers editable %s changes into both target outputs", (_name, mutate) => {
    const edited = structuredClone(demoGraph);
    mutate(edited);
    const graph = parseGraph(edited);

    expect(compileReact(graph).fingerprint).not.toBe(compileReact(demoGraph).fingerprint);
    expect(compileSwiftUI(graph).fingerprint).not.toBe(compileSwiftUI(demoGraph).fingerprint);
  });

  it("reports capability fallbacks instead of silently accepting unsupported fixed width", () => {
    const edited = structuredClone(demoGraph);
    edited.screens[1]!.nodes[1]!.layout.width = "fixed";

    for (const output of [compileReact(parseGraph(edited)), compileSwiftUI(parseGraph(edited))]) {
      expect(output.diagnostics).toContainEqual(expect.objectContaining({
        severity: "warning",
        path: "screens.payment-request.nodes.payment-request.recipient.layout.width",
        message: expect.stringMatching(/fixed width requires an explicit dimension/i),
      }));
    }
  });

  it("applies known target overrides and diagnoses unknown override keys", () => {
    const edited = structuredClone(demoGraph);
    edited.screens[1]!.nodes[1]!.platformOverrides = {
      react: { "layout.axis": "horizontal", "unsupported.magic": true },
      swiftui: { "style.emphasis": "quiet" },
    };
    const graph = parseGraph(edited);
    const react = compileReact(graph);
    const swift = compileSwiftUI(graph);
    const reactScreen = react.files.find((file) => file.path.endsWith("payment-request.tsx"));
    const swiftScreen = swift.files.find((file) => file.path.endsWith("paymentRequest.swift"));

    expect(reactScreen?.content).toContain("if-axis-horizontal");
    expect(swiftScreen?.content).toContain('emphasis: "quiet"');
    expect(react.diagnostics).toContainEqual(expect.objectContaining({
      severity: "warning",
      path: "screens.payment-request.nodes.payment-request.recipient.platformOverrides.react.unsupported.magic",
    }));
  });

  it("applies bounded target constraint overrides and restores invalid pairs", () => {
    const edited = structuredClone(demoGraph);
    edited.screens[1]!.nodes[1]!.platformOverrides = {
      react: { "layout.minWidth": 180, "layout.maxWidth": 340 },
      swiftui: { "layout.minHeight": 420, "layout.maxHeight": 120 },
    };
    const graph = parseGraph(edited);
    const react = compileReact(graph);
    const swift = compileSwiftUI(graph);
    const reactScreen = react.files.find((file) => file.path.endsWith("payment-request.tsx"));
    const swiftScreen = swift.files.find((file) => file.path.endsWith("paymentRequest.swift"));

    expect(reactScreen?.content).toContain("minWidth: 180, maxWidth: 340");
    expect(swiftScreen?.content).toContain("minHeight: nil");
    expect(swiftScreen?.content).toContain("maxHeight: nil");
    expect(swift.diagnostics).toContainEqual(expect.objectContaining({
      path: "screens.payment-request.nodes.payment-request.recipient.platformOverrides.swiftui.layout.minHeight",
      message: expect.stringMatching(/shared constraints were restored/i),
    }));
  });

  it("reports the SwiftUI assertive-live fallback while preserving native update semantics", () => {
    const edited = structuredClone(demoGraph);
    edited.screens[1]!.nodes[2]!.accessibility.live = "assertive";

    const swift = compileSwiftUI(parseGraph(edited));
    const screen = swift.files.find((file) => file.path.endsWith("paymentRequest.swift"));
    expect(screen?.content).toContain("// IntentForm live region: assertive");
    expect(screen?.content).toContain(".accessibilityAddTraits(.updatesFrequently)");
    expect(swift.diagnostics).toContainEqual(expect.objectContaining({
      severity: "warning",
      path: "screens.payment-request.nodes.payment-request.failure.accessibility.live",
      message: expect.stringMatching(/does not expose assertive live-region urgency/i),
    }));
  });

  it("repairs the controlled compact-action failure and reruns verification", () => {
    const report = buildProofReport(demoGraph, completedBuildEvidence);
    const finding = report.before.verification.findings.find((item) =>
      item.id.endsWith("primary.compact-reachability"),
    );

    expect(report.before.verification.passed).toBe(false);
    expect(finding?.screenId).toBe("payment-request");
    expect(report.changes).toEqual([
      expect.objectContaining({ path: "payment-request.confirm.layout.placement" }),
    ]);
    expect(report.after.verification.passed).toBe(true);
    expect(report.reconciledFindings.find((item) => item.id === finding?.id)?.status).toBe("verified");
    expect(report.before.reactFingerprint).not.toBe(report.after.reactFingerprint);
    expect(report.before.swiftFingerprint).not.toBe(report.after.swiftFingerprint);
  });

  it("finds and repairs transactional semantics at recursive depth", () => {
    const nested = structuredClone(demoGraph);
    const screen = nested.screens.find((item) => item.id === "payment-request")!;
    const children = screen.nodes;
    const wrapper = structuredClone(children[0]!);
    wrapper.id = "payment-request.stack";
    wrapper.kind = "stack";
    wrapper.intent = { purpose: "Arrange the payment request fields", label: "Payment request fields", importance: "supporting" };
    wrapper.style = { role: "surface", emphasis: "normal" };
    wrapper.accessibility = { label: "Payment request fields", live: "off" };
    wrapper.states = [];
    wrapper.interactions = [];
    wrapper.children = children;
    screen.nodes = [wrapper];

    const report = buildProofReport(parseGraph(nested), completedBuildEvidence);
    expect(report.before.verification.findings).toContainEqual(expect.objectContaining({
      id: "swiftui.payment-request.primary.compact-reachability",
    }));
    expect(report.changes).toContainEqual(expect.objectContaining({
      path: "payment-request.confirm.layout.placement",
    }));
    expect(report.after.verification.passed).toBe(true);
    expect(report.after.graph.screens.find((item) => item.id === "payment-request")?.nodes[0]?.children)
      .toHaveLength(children.length);
  });

  it("lowers the repair into platform-native adaptive primitives", () => {
    const report = buildProofReport(demoGraph, completedBuildEvidence);
    const react = compileReact(report.after.graph);
    const swift = compileSwiftUI(report.after.graph);
    const reactScreen = react.files.find((file) => file.path.endsWith("payment-request.tsx"));
    const reactStyles = react.files.find((file) => file.path.endsWith("styles.css"));
    const swiftScreen = swift.files.find((file) => file.path.endsWith("paymentRequest.swift"));
    const swiftComponents = swift.files.find((file) => file.path.endsWith("IntentFormComponents.swift"));

    expect(reactScreen?.content).toContain('className="primary placement-compact-persistent placement-regular-inline"');
    expect(reactStyles?.content).toContain("@media (min-width: 391px) and (min-height: 701px)");
    expect(swiftScreen?.content).toContain(".safeAreaInset(edge: .bottom)");
    expect(swiftScreen?.content).toContain("let viewportFrame = proxy.frame(in: .global)");
    expect(swiftScreen?.content).toContain("IntentFormDeviceClass.resolve(width: viewportFrame.maxX, height: viewportFrame.maxY)");
    expect(swiftScreen?.content).toContain("let usesPersistentPrimary = deviceClass == .compact\n                ? true\n                : false");
    expect(swiftScreen?.content).toContain('.accessibilityIdentifier("intentform.payment-request.confirm")');
    expect(swiftScreen?.content).toContain('if (data.status == "failed")');
    expect(swiftScreen?.content).not.toContain('Text("Request payment")');
    expect(swiftScreen?.content).not.toContain(".position(");
    expect(swiftComponents?.content).toContain("width <= 390 || height <= 700");
  });

  it("honors compact and regular placement values independently", () => {
    const graph = structuredClone(demoGraph);
    const primary = graph.screens
      .find((screen) => screen.id === "payment-request")
      ?.nodes.find((node) => node.kind === "primary-action");
    if (!primary?.layout.placement) throw new Error("Test graph has no adaptive primary placement");
    primary.layout.placement = { compact: "inline", regular: "persistent-bottom" };

    const parsed = parseGraph(graph);
    const reactScreen = compileReact(parsed).files.find((file) => file.path.endsWith("payment-request.tsx"));
    const swiftScreen = compileSwiftUI(parsed).files.find((file) => file.path.endsWith("paymentRequest.swift"));

    expect(reactScreen?.content).toContain('className="primary placement-compact-inline placement-regular-persistent"');
    expect(swiftScreen?.content).toContain("let usesPersistentPrimary = deviceClass == .compact\n                ? false\n                : true");
  });

  it("generates a runnable React flow with typed event wiring", () => {
    const output = compileReact(buildProofReport(demoGraph, completedBuildEvidence).after.graph);
    const app = output.files.find((file) => file.path.endsWith("App.tsx"));
    const payment = output.files.find((file) => file.path.endsWith("payment-request.tsx"));

    expect(app?.content).toContain('setScreen("payment-request")');
    expect(app?.content).toContain('setScreen("receipt")');
    expect(payment?.content).toContain("onClick={events.onConfirm}");
  });

  it("keeps manually added contract-free screens runnable", () => {
    const graph = structuredClone(demoGraph);
    graph.screens.push({
      id: "screen-4",
      title: "Manual screen",
      purpose: "Prove manual canvas insertion",
      route: "/manual",
      nodes: [structuredClone(graph.screens[1]!.nodes[1]!)],
    });
    graph.screens.at(-1)!.nodes[0]!.id = "screen-4.content";
    const output = compileReact(parseGraph(graph));
    const contract = output.files.find((file) => file.path.endsWith("contracts/screen-4.ts"));
    expect(contract?.content).toContain("readonly empty?: never");
    expect(output.files.find((file) => file.path.endsWith("App.tsx"))?.content).toContain("<Screen4Screen");
    expect(output.files.find((file) => file.path.endsWith("screens/screen-4.tsx"))?.content).toContain("function Screen4Screen");
    expect(compileSwiftUI(parseGraph(graph)).files.find((file) => file.path.endsWith("screen4.swift"))?.content).toContain("struct Screen4Screen");
  });

  it("does not require a primary action on an informational screen", () => {
    const graph = structuredClone(demoGraph);
    graph.screens.push({
      id: "about",
      title: "About",
      purpose: "Explain the product",
      route: "/about",
      nodes: [structuredClone(graph.screens[2]!.nodes[0]!)],
    });
    graph.screens.at(-1)!.nodes[0]!.id = "about.content";
    const parsed = parseGraph(graph);
    const verification = verifyGraph(parsed, {
      target: "react",
      viewport: { width: 402, height: 874 },
      buildStatus: "passed",
    });

    expect(verification.findings).not.toContainEqual(expect.objectContaining({
      id: "react.about.primary.missing",
    }));
  });

  it("fails verification explicitly when the selected target is disabled", () => {
    const graph = structuredClone(demoGraph);
    graph.platforms.find((platform) => platform.target === "react")!.enabled = false;
    const verification = verifyGraph(parseGraph(graph), {
      target: "react",
      viewport: { width: 402, height: 874 },
      buildStatus: "passed",
    });

    expect(verification.passed).toBe(false);
    expect(verification.findings).toContainEqual(expect.objectContaining({
      id: "react.target.disabled",
      severity: "error",
      responsibleLayer: "compiler",
    }));
  });

  it("verifies rendered compact placement from browser bounds", () => {
    const compact = {
      target: "react" as const,
      screenId: "payment-request",
      viewport: { width: 375, height: 667 },
      primaryAction: { x: 22, y: 329, width: 331, height: 50 },
      screenshotPath: "artifacts/react/before-375x667.png",
      graphPlacement: "persistent-bottom" as const,
    };

    expect(verifyRenderedPrimaryAction({ ...compact, position: "static" })).toHaveLength(1);
    expect(verifyRenderedPrimaryAction({
      ...compact,
      position: "fixed",
      primaryAction: { ...compact.primaryAction, y: 599 },
      screenshotPath: "artifacts/react/after-375x667.png",
    })).toHaveLength(0);
    expect(verifyRenderedPrimaryAction({
      ...compact,
      viewport: { width: 1024, height: 768 },
      primaryAction: { x: 314, y: 329, width: 396, height: 50 },
      position: "static",
      screenshotPath: "artifacts/react/after-1024x768.png",
      graphPlacement: "inline",
    })).toHaveLength(0);
    expect(verifyRenderedPrimaryAction({
      ...compact,
      viewport: { width: 402, height: 874 },
      primaryAction: { x: 22, y: 798, width: 358, height: 50 },
      position: "fixed",
      screenshotPath: "artifacts/react/wrong-regular-placement.png",
      graphPlacement: "inline",
    })).toContainEqual(expect.objectContaining({
      id: "react.payment-request.primary.rendered-placement",
    }));
    expect(verifyRenderedPrimaryAction({
      ...compact,
      position: "fixed",
      primaryAction: { x: 22, y: 640, width: 331, height: 50 },
      screenshotPath: "artifacts/react/offscreen-375x667.png",
    })).toContainEqual(expect.objectContaining({
      id: "react.payment-request.primary.rendered-bounds",
    }));
    expect(verifyRenderedPrimaryAction({
      ...compact,
      position: "fixed",
      primaryAction: { x: 22, y: 599, width: 40, height: 40 },
      screenshotPath: "artifacts/react/undersized-375x667.png",
    })).toContainEqual(expect.objectContaining({
      id: "react.payment-request.primary.rendered-bounds",
    }));
  });

  it("does not turn source generation into build evidence", () => {
    const pending = verifyGraph(demoGraph, {
      target: "swiftui",
      viewport: { width: 402, height: 874 },
      buildStatus: "not-run",
    });
    expect(pending.passed).toBe(false);
    expect(pending.findings).toContainEqual(expect.objectContaining({
      id: "swiftui.build.not-run",
      severity: "warning",
    }));

    const failed = verifyGraph(demoGraph, {
      target: "swiftui",
      viewport: { width: 402, height: 874 },
      buildStatus: "failed",
    });
    expect(failed.passed).toBe(false);
    expect(failed.findings).toContainEqual(expect.objectContaining({
      id: "swiftui.build.failed",
      severity: "error",
    }));
  });

  it("accepts native compact placement derived from accessibility bounds", () => {
    expect(verifyRenderedPrimaryAction({
      target: "swiftui",
      screenId: "payment-request",
      viewport: { width: 874, height: 402 },
      primaryAction: { x: 120, y: 330, width: 634, height: 49 },
      position: "viewport-bottom",
      screenshotPath: "artifacts/swiftui/payment-request-compact.png",
      graphPlacement: "persistent-bottom",
    })).toHaveLength(0);
  });

  it("resolves design tokens into both platform outputs", () => {
    const themed = structuredClone(demoGraph);
    themed.tokens.modes.default!.values.colors["color.accent"] = "#7a4b9e";
    themed.tokens.modes.default!.values.radii["radius.control"] = 12;
    const graph = parseGraph(themed);

    const css = compileReact(graph).files.find((file) => file.path.endsWith("styles.css"));
    expect(css?.content).toContain("--if-color-accent: #7a4b9e;");
    expect(css?.content).toContain("--if-radius-control: 12px;");
    expect(css?.content).toContain("background: var(--if-accent);");

    const components = compileSwiftUI(graph).files.find((file) => file.path.endsWith("IntentFormComponents.swift"));
    expect(components?.content).toContain("static let controlRadius: CGFloat = 12");
    expect(components?.content).toContain("static let accent = Color(red: 0.478, green: 0.294, blue: 0.620)");

    expect(compileReact(graph).fingerprint).not.toBe(compileReact(demoGraph).fingerprint);
    expect(compileSwiftUI(graph).fingerprint).not.toBe(compileSwiftUI(demoGraph).fingerprint);
  });

  it("emits deterministic token-mode selectors and native mode metadata", () => {
    const react = compileReact(demoGraph);
    const reactScreen = react.files.find((file) => file.path.endsWith("home.tsx"));
    const styles = react.files.find((file) => file.path.endsWith("styles.css"));
    expect(reactScreen?.content).toContain('data-if-token-mode="default"');
    expect(styles?.content).toContain('.screen[data-if-token-mode="evening"]');
    expect(styles?.content).toContain("--if-color-canvas: #111714;");

    const swift = compileSwiftUI(demoGraph);
    const components = swift.files.find((file) => file.path.endsWith("IntentFormComponents.swift"));
    expect(components?.content).toContain('static let activeMode = "default"');
    expect(components?.content).toContain('static let availableModes = ["default", "evening"]');
  });

  it("lowers licensed raster assets into both targets and emits machine-readable manifests", () => {
    const draft = structuredClone(demoGraph);
    const digest = "c".repeat(64);
    draft.assets.push({
      id: "brand.hero",
      name: "Brand hero",
      kind: "raster",
      digest,
      mediaType: "image/png",
      byteLength: 256,
      storageKey: `assets/${digest}.png`,
      width: 1200,
      height: 800,
      variants: [],
      license: { name: "Project-owned", spdx: "CC0-1.0", redistribution: "allowed" },
      exportPolicy: "copy",
      metadata: { role: "hero" },
    });
    findGraphNode(draft, "receipt.summary")!.asset = {
      assetId: "brand.hero",
      fit: "cover",
      focalPoint: { x: 0.4, y: 0.25 },
      decorative: false,
    };
    const graph = parseGraph(draft);

    const react = compileReact(graph);
    const reactScreen = react.files.find((file) => file.path.endsWith("receipt.tsx"));
    const reactManifest = react.files.find((file) => file.path === "assets.manifest.json");
    expect(reactScreen?.content).toContain(`<img className="if-asset-media" src="/assets/${digest}.png"`);
    expect(reactScreen?.content).toContain('objectFit: "cover"');
    expect(JSON.parse(reactManifest!.content)).toMatchObject({
      version: 1,
      assets: [{ id: "brand.hero", digest, exportPolicy: "copy", license: { spdx: "CC0-1.0" } }],
    });

    const swift = compileSwiftUI(graph);
    const swiftScreen = swift.files.find((file) => file.path.endsWith("receipt.swift"));
    const swiftManifest = swift.files.find((file) => file.path === "Generated/Assets.manifest.json");
    expect(swiftScreen?.content).toContain(`Image("${digest}")`);
    expect(swiftScreen?.content).toContain("IntentForm focal point: 0.4, 0.25");
    expect(JSON.parse(swiftManifest!.content)).toMatchObject({ assets: [{ id: "brand.hero", digest }] });
  });

  it("diagnoses blocked, reference-only, and unsupported native asset policies", () => {
    const makeAssetGraph = (kind: "raster" | "svg", exportPolicy: "blocked" | "reference") => {
      const draft = structuredClone(demoGraph);
      const digest = "d".repeat(64);
      draft.assets.push({
        id: "brand.media",
        name: "Brand media",
        kind,
        digest,
        mediaType: kind === "svg" ? "image/svg+xml" : "image/png",
        byteLength: 128,
        storageKey: `assets/${digest}.${kind === "svg" ? "svg" : "png"}`,
        variants: [],
        license: { name: "Reference license", redistribution: "restricted" },
        exportPolicy,
        metadata: {},
      });
      findGraphNode(draft, "receipt.summary")!.asset = {
        assetId: "brand.media",
        fit: "contain",
        focalPoint: { x: 0.5, y: 0.5 },
        decorative: true,
      };
      return parseGraph(draft);
    };

    const blocked = compileReact(makeAssetGraph("raster", "blocked"));
    expect(blocked.diagnostics).toContainEqual(expect.objectContaining({ message: expect.stringMatching(/blocked from generated output/i) }));
    expect(blocked.files.find((file) => file.path.endsWith("receipt.tsx"))?.content).not.toContain("if-asset-media");

    const referenced = compileReact(makeAssetGraph("raster", "reference"));
    expect(referenced.diagnostics).toContainEqual(expect.objectContaining({ message: expect.stringMatching(/reference-only/i) }));

    const swiftSvg = compileSwiftUI(makeAssetGraph("svg", "reference"));
    expect(swiftSvg.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: expect.stringMatching(/reference-only/i) }),
      expect.objectContaining({ message: expect.stringMatching(/raw svg assets require a platform adapter/i) }),
    ]));
    expect(swiftSvg.files.find((file) => file.path.endsWith("receipt.swift"))?.content).not.toContain("Image(");
  });

  it("lowers fixture values and visibility into both generated targets", () => {
    const customized = structuredClone(demoGraph);
    customized.fixtures.find((fixture) => fixture.id === "home.idle")!.data.balance = "9999.50";
    customized.fixtures.find((fixture) => fixture.id === "home.idle")!.data.activitySummary = "Custom activity";
    for (const fixture of customized.fixtures.filter((item) => item.screenId === "payment-request")) {
      fixture.data.amount = "321.45";
      fixture.data.recipientName = "Ari Sol";
      fixture.data.recipientHandle = "ari@example.test";
    }
    customized.fixtures.find((fixture) => fixture.id === "receipt.completed")!.data.reference = "CUSTOM-77";
    customized.fixtures.find((fixture) => fixture.id === "receipt.completed")!.data.amount = "654.32";
    const graph = parseGraph(customized);
    const react = compileReact(graph);
    const swift = compileSwiftUI(graph);
    const reactSource = react.files.map((file) => file.content).join("\n");
    const swiftSource = swift.files.map((file) => file.content).join("\n");

    expect(reactSource).toContain('"balance":"9999.50"');
    expect(reactSource).toContain('"recipientName":"Ari Sol"');
    expect(reactSource).toContain('"activitySummary":"Custom activity"');
    expect(reactSource).toContain('"reference":"CUSTOM-77"');
    expect(reactSource).toContain("String(data.balance");
    expect(reactSource).toContain('search.get("state")');
    expect(reactSource).toContain('data.status === "failed"');
    expect(swiftSource).toContain('balance: "9999.50"');
    expect(swiftSource).toContain('recipientName: "Ari Sol"');
    expect(swiftSource).toContain('activitySummary: "Custom activity"');
    expect(swiftSource).toContain('reference: "CUSTOM-77"');
    expect(swiftSource).toContain('case "failed": return Self(');
    expect(swiftSource).toContain('if (data.status == "failed")');
    expect(`${reactSource}\n${swiftSource}`).not.toContain("Riva Studio");
    expect(`${reactSource}\n${swiftSource}`).not.toContain("Mara Rinaldi");
    expect(`${reactSource}\n${swiftSource}`).not.toContain("IF-2048");
    expect(`${reactSource}\n${swiftSource}`).not.toContain("€8,420.16");
  });

  it("keeps renamed and payload-bearing events in parity across targets", () => {
    const customized = structuredClone(demoGraph);
    const contract = customized.contracts.find((item) => item.screenId === "payment-request")!;
    const event = contract.events.find((item) => item.name === "onConfirm")!;
    event.name = "submitRequest";
    event.payload = "string";
    const primary = customized.screens.find((screen) => screen.id === "payment-request")!
      .nodes.find((node) => node.kind === "primary-action")!;
    primary.interactions[0]!.event = "submitRequest";
    primary.interactions.push({ event: "onCancel", requires: [] });
    customized.flows[0]!.steps.find((step) => step.from === "payment-request")!.event = "submitRequest";
    const graph = parseGraph(customized);

    const react = compileReact(graph);
    const reactScreen = react.files.find((file) => file.path.endsWith("payment-request.tsx"));
    const reactContract = react.files.find((file) => file.path.endsWith("contracts/payment-request.ts"));
    const reactApp = react.files.find((file) => file.path.endsWith("App.tsx"));
    expect(reactScreen?.content).toContain("onClick={() => { events.submitRequest(data.recipientName); events.onCancel(); }}");
    expect(reactContract?.content).toContain("submitRequest(payload: string): void;");
    expect(reactApp?.content).toContain('submitRequest: (_payload: string) => setScreen("receipt")');

    const swift = compileSwiftUI(graph);
    const swiftScreen = swift.files.find((file) => file.path.endsWith("paymentRequest.swift"));
    const swiftApp = swift.files.find((file) => file.path.endsWith("IntentFormApp.swift"));
    expect(swiftScreen?.content).toContain("var submitRequest: (String) -> Void");
    expect(swiftScreen?.content).toContain("events.submitRequest(data.recipientName); events.onCancel()");
    expect(swiftApp?.content).toContain('submitRequest: { _ in screen = "receipt" }');
  });

  it("emits field types, optional defaults and secondary events without sample handlers", () => {
    const customized = structuredClone(demoGraph);
    const homeContract = customized.contracts.find((contract) => contract.screenId === "home")!;
    homeContract.data.push(
      { name: "attempts", type: "number", required: true },
      { name: "approved", type: "boolean", required: false },
      { name: "note", type: "string", required: false },
      { name: "class", type: "string", required: true },
    );
    const homeFixture = customized.fixtures.find((fixture) => fixture.id === "home.idle")!;
    homeFixture.data.attempts = 3;
    homeFixture.data.approved = true;
    homeFixture.data.class = "priority";

    const payment = customized.screens.find((screen) => screen.id === "payment-request")!;
    const secondary = structuredClone(payment.nodes.find((node) => node.kind === "primary-action")!);
    secondary.id = "payment-request.cancel";
    secondary.kind = "secondary-action";
    secondary.intent = { purpose: "Cancel this request", label: "Cancel request", importance: "secondary" };
    secondary.style = { role: "secondary-action", emphasis: "normal" };
    secondary.accessibility = { label: "Cancel request", live: "off" };
    secondary.interactions = [{ event: "onCancel", requires: [] }];
    secondary.layout.placement = undefined;
    payment.nodes.push(secondary);

    const graph = parseGraph(customized);
    const react = compileReact(graph);
    expect(react.files.find((file) => file.path.endsWith("contracts/home.ts"))?.content).toContain("attempts: number;");
    expect(react.files.find((file) => file.path.endsWith("contracts/home.ts"))?.content).toContain("approved?: boolean;");
    expect(react.files.find((file) => file.path.endsWith("contracts/home.ts"))?.content).toContain("note?: string;");
    expect(react.files.find((file) => file.path.endsWith("payment-request.tsx"))?.content).toContain("onClick={events.onCancel}");

    const swift = compileSwiftUI(graph);
    expect(swift.files.find((file) => file.path.endsWith("home.swift"))?.content).toContain("var attempts: Double = 3");
    expect(swift.files.find((file) => file.path.endsWith("home.swift"))?.content).toContain("var approved: Bool? = true");
    expect(swift.files.find((file) => file.path.endsWith("home.swift"))?.content).toContain("var note: String? = nil");
    expect(swift.files.find((file) => file.path.endsWith("home.swift"))?.content).toContain('var `class`: String = "priority"');
    expect(swift.files.find((file) => file.path.endsWith("paymentRequest.swift"))?.content).toContain('Button("Cancel request") { events.onCancel() }');
  });

  it("refuses to compile a target the graph has disabled", () => {
    const disabled = structuredClone(demoGraph);
    disabled.platforms.find((platform) => platform.target === "react")!.enabled = false;
    expect(() => compileReact(parseGraph(disabled))).toThrow(/react target is not enabled/);
  });

  it("surfaces token edits in the semantic diff", () => {
    const themed = structuredClone(demoGraph);
    themed.tokens.modes.default!.values.colors["color.accent"] = "#7a4b9e";
    expect(semanticDiff(demoGraph, parseGraph(themed))).toEqual([
      { path: "tokens.modes.default.values.colors.color.accent", before: "#397461", after: "#7a4b9e" },
    ]);
  });

  it("rejects graph references that cannot be resolved", () => {
    const invalid = structuredClone(demoGraph);
    invalid.contracts[0]!.screenId = "missing-screen";
    expect(() => parseGraph(invalid)).toThrow(/Unknown contract screen/);
  });

  it("rejects unsafe event identifiers and escapes graph-authored compiler text", () => {
    const unsafeEvent = structuredClone(demoGraph);
    unsafeEvent.screens[0]!.nodes.at(-1)!.interactions[0]!.event = "onClick;alert(1)";
    expect(() => parseGraph(unsafeEvent)).toThrow();

    const authoredText = structuredClone(demoGraph);
    authoredText.product.name = "<Verdant>";
    authoredText.screens[0]!.title = "Balance {review}";
    const authoredLabel = 'Send "now" \\(danger)';
    authoredText.screens[0]!.nodes.at(-1)!.intent.label = authoredLabel;
    authoredText.screens[0]!.nodes.at(-1)!.accessibility.label = authoredLabel;
    const graph = parseGraph(authoredText);
    const reactScreen = compileReact(graph).files.find((file) => file.path.endsWith("home.tsx"));
    expect(reactScreen?.content).toContain('{"<Verdant>"}');
    expect(reactScreen?.content).toContain('{"Balance {review}"}');
    expect(reactScreen?.content).toContain(`{${JSON.stringify(authoredLabel)}}`);
    expect(reactScreen?.content).not.toContain("<h1>Balance {review}</h1>");

    const swiftEscaped = authoredLabel.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
    const swiftScreen = compileSwiftUI(graph).files.find((file) => file.path.endsWith("home.swift"));
    expect(swiftScreen?.content).toContain(`Button("${swiftEscaped}")`);
  });
});
