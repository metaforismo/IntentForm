import { describe, expect, it } from "vitest";
import { compileReact } from "@intentform/compiler-react";
import { compileSwiftUI } from "@intentform/compiler-swiftui";
import { parseGraph, stableSerialize } from "@intentform/semantic-schema";
import { demoGraph } from "./demo";
import { buildProofReport } from "./index";

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

  it("rejects graph references that cannot be resolved", () => {
    const invalid = structuredClone(demoGraph);
    invalid.contracts[0]!.screenId = "missing-screen";
    expect(() => parseGraph(invalid)).toThrow(/Unknown contract screen/);
  });
});
