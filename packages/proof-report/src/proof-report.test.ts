import { describe, expect, it } from "vitest";
import { compileReact } from "@intentform/compiler-react";
import { compileSwiftUI } from "@intentform/compiler-swiftui";
import { parseGraph, stableSerialize } from "@intentform/semantic-schema";
import { demoGraph } from "./demo";
import { buildProofReport } from "./index";
import { verifyRenderedPrimaryAction } from "@intentform/verifier";

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
    const report = buildProofReport(demoGraph);
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
    const report = buildProofReport(demoGraph);
    const react = compileReact(report.after.graph);
    const swift = compileSwiftUI(report.after.graph);
    const reactScreen = react.files.find((file) => file.path.endsWith("payment-request.tsx"));
    const swiftScreen = swift.files.find((file) => file.path.endsWith("paymentRequest.swift"));

    expect(reactScreen?.content).toContain('className="primary persistent"');
    expect(swiftScreen?.content).toContain(".safeAreaInset(edge: .bottom)");
    expect(swiftScreen?.content).not.toContain(".position(");
  });

  it("generates a runnable React flow with typed event wiring", () => {
    const output = compileReact(buildProofReport(demoGraph).after.graph);
    const app = output.files.find((file) => file.path.endsWith("App.tsx"));
    const payment = output.files.find((file) => file.path.endsWith("payment-request.tsx"));

    expect(app?.content).toContain('setScreen("payment-request")');
    expect(app?.content).toContain('setScreen("receipt")');
    expect(payment?.content).toContain("onClick={events.onConfirm}");
  });

  it("verifies rendered compact placement from browser bounds", () => {
    const compact = {
      target: "react" as const,
      screenId: "payment-request",
      viewport: { width: 375, height: 667 },
      primaryAction: { x: 22, y: 329, width: 331, height: 50 },
      screenshotPath: "artifacts/react/before-375x667.png",
      graphExpectsPersistent: true,
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
    })).toHaveLength(0);
  });

  it("rejects graph references that cannot be resolved", () => {
    const invalid = structuredClone(demoGraph);
    invalid.contracts[0]!.screenId = "missing-screen";
    expect(() => parseGraph(invalid)).toThrow(/Unknown contract screen/);
  });

  it("rejects unsafe event identifiers and escapes graph-authored React text", () => {
    const unsafeEvent = structuredClone(demoGraph);
    unsafeEvent.screens[0]!.nodes.at(-1)!.interactions[0]!.event = "onClick;alert(1)";
    expect(() => parseGraph(unsafeEvent)).toThrow();

    const authoredText = structuredClone(demoGraph);
    authoredText.product.name = "<Verdant>";
    authoredText.screens[0]!.title = "Balance {review}";
    const screen = compileReact(parseGraph(authoredText)).files.find((file) => file.path.endsWith("home.tsx"));
    expect(screen?.content).toContain('{"<Verdant>"}');
    expect(screen?.content).toContain('{"Balance {review}"}');
    expect(screen?.content).not.toContain("<h1>Balance {review}</h1>");
  });
});
