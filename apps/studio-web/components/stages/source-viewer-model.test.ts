import { describe, expect, it } from "vitest";
import { demoGraph } from "@intentform/proof-report/demo";
import { sourceLanguage, sourceNodeReferences, sourceWindow, tokenizeSourceLine } from "./source-viewer-model";

describe("read-only source viewer model", () => {
  it("tokenizes code without confusing comment markers inside strings", () => {
    const tokens = tokenizeSourceLine('const url: String = "https://intentform.dev"; // exact output');
    expect(tokens).toEqual(expect.arrayContaining([
      { kind: "keyword", value: "const" },
      { kind: "type", value: "String" },
      { kind: "string", value: '"https://intentform.dev"' },
      { kind: "comment", value: "// exact output" },
    ]));
  });

  it("selects a bounded overscanned line window for very large files", () => {
    expect(sourceWindow(100_000, 40_000, 600)).toEqual({ start: 1_988, end: 2_042, top: 39_760, bottom: 1_959_160 });
  });

  it("maps generated source markers back to exact semantic nodes", () => {
    const content = [
      '<div data-node-id="payment-request.amount" />',
      '.accessibilityIdentifier("intentform.payment-request.confirm")',
      '<View testID="node-payment-request.confirm" />',
      '"nodeId": "unknown.node"',
    ].join("\n");
    expect(sourceNodeReferences(demoGraph, content)).toEqual([
      { nodeId: "payment-request.amount", line: 0 },
      { nodeId: "payment-request.confirm", line: 1 },
    ]);
  });

  it("reports target-aware language labels", () => {
    expect(sourceLanguage("Generated/Home.swift", "swiftui")).toBe("Swift");
    expect(sourceLanguage("src/Home.tsx", "react")).toBe("TypeScript");
    expect(sourceLanguage("manifest.unknown", "web")).toBe("Text");
  });
});
