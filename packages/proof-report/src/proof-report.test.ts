import { describe, expect, it } from "vitest";
import { compileReact } from "@intentform/compiler-react";
import { compileSwiftUI } from "@intentform/compiler-swiftui";
import { parseGraph, semanticDiff, stableSerialize } from "@intentform/semantic-schema";
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
    themed.tokens.colors["color.accent"] = "#7a4b9e";
    themed.tokens.radii["radius.control"] = 12;
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
    themed.tokens.colors["color.accent"] = "#7a4b9e";
    expect(semanticDiff(demoGraph, parseGraph(themed))).toEqual([
      { path: "tokens.colors.color.accent", before: "#397461", after: "#7a4b9e" },
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
