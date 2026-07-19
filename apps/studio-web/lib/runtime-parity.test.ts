import { describe, expect, it } from "vitest";
import { demoGraph } from "@intentform/proof-report/demo";
import { parseGraph } from "@intentform/semantic-schema";
import {
  compareRuntimeParity,
  injectParityProbe,
  parityExpectations,
  parseParityProbeMessage,
  summarizeParityReport,
  viewportIsCompact,
  PARITY_MESSAGE_TYPE,
  type RuntimeNodeMeasurement,
  type RuntimeParityViewport,
} from "./runtime-parity";

const compact: RuntimeParityViewport = { frameId: "mobile", label: "Mobile", width: 390, height: 700 };
const desktop: RuntimeParityViewport = { frameId: "desktop", label: "Desktop", width: 1440, height: 1000 };

function measurement(overrides: Partial<RuntimeNodeMeasurement> & { id: string; order: number }): RuntimeNodeMeasurement {
  return {
    x: 20,
    y: 20 + overrides.order * 80,
    width: 350,
    height: 60,
    visible: true,
    position: "static",
    role: null,
    accessibleName: "",
    controlWidth: 350,
    controlHeight: 48,
    overflowX: false,
    ...overrides,
  };
}

describe("runtime parity", () => {
  const screen = demoGraph.screens.find((candidate) => candidate.id === "payment-request")!;
  const expectations = parityExpectations(demoGraph, screen.id);

  const cleanMeasurements = () => expectations.map((expected, index) => measurement({
    id: expected.id,
    order: index,
    role: expected.kind.endsWith("action") ? "button" : ["input", "money-input"].includes(expected.kind) ? "textbox" : null,
    accessibleName: expected.label ?? "",
    position: expected.persistentCompact ? "fixed" : "static",
  }));

  it("derives expectations in semantic traversal order with placement intent", () => {
    expect(expectations.length).toBeGreaterThan(2);
    expect(expectations.map((entry) => entry.orderIndex)).toEqual(expectations.map((_, index) => index));
    const confirm = expectations.find((entry) => entry.id === "payment-request.confirm")!;
    // The verified sample deliberately ships the confirm action inline; the
    // repair journey is what moves it to persistent-bottom.
    expect(confirm).toMatchObject({ interactive: true, persistentCompact: false });

    const repaired = structuredClone(demoGraph);
    const node = repaired.screens.find((candidate) => candidate.id === screen.id)!.nodes
      .find((candidate) => candidate.id === "payment-request.confirm")!;
    node.layout.placement = { compact: "persistent-bottom", regular: "inline" };
    const repairedExpectations = parityExpectations(parseGraph(repaired), screen.id);
    expect(repairedExpectations.find((entry) => entry.id === "payment-request.confirm"))
      .toMatchObject({ persistentCompact: true });
    expect(parityExpectations(demoGraph, "missing-screen")).toEqual([]);
  });

  it("reports a full match for a faithful runtime", () => {
    const report = compareRuntimeParity(expectations, cleanMeasurements(), compact);
    expect(report).toMatchObject({ comparedNodes: expectations.length, matchedNodes: expectations.length, findings: [] });
  });

  it("flags missing and hidden nodes as errors", () => {
    const missing = cleanMeasurements().slice(1);
    expect(compareRuntimeParity(expectations, missing, desktop).findings).toContainEqual(
      expect.objectContaining({ code: "parity.missing", nodeId: expectations[0]!.id, severity: "error" }),
    );
    const hidden = cleanMeasurements().map((entry, index) => index === 0 ? { ...entry, visible: false } : entry);
    expect(compareRuntimeParity(expectations, hidden, desktop).findings).toContainEqual(
      expect.objectContaining({ code: "parity.hidden", nodeId: expectations[0]!.id }),
    );
  });

  it("flags semantic order inversions", () => {
    const swapped = cleanMeasurements();
    const orders = swapped.map((entry) => entry.order);
    swapped[0]!.order = orders[1]!;
    swapped[1]!.order = orders[0]!;
    const report = compareRuntimeParity(expectations, swapped, desktop);
    expect(report.findings).toContainEqual(expect.objectContaining({ code: "parity.order", severity: "error" }));
  });

  it("flags lost accessible names and wrong roles", () => {
    const labeled = expectations.find((entry) => entry.interactive && entry.label)!;
    const renamed = cleanMeasurements().map((entry) => entry.id === labeled.id
      ? { ...entry, accessibleName: "Something unrelated", role: null }
      : entry);
    const findings = compareRuntimeParity(expectations, renamed, desktop).findings;
    expect(findings).toContainEqual(expect.objectContaining({ code: "parity.accessible-name", nodeId: labeled.id }));
    expect(findings).toContainEqual(expect.objectContaining({ code: "parity.role", nodeId: labeled.id }));
  });

  it("flags WCAG target-size violations on interactive nodes only", () => {
    const interactive = expectations.find((entry) => entry.interactive)!;
    const text = expectations.find((entry) => entry.kind === "text" || entry.kind === "status-message");
    const tiny = cleanMeasurements().map((entry) => ({ ...entry, controlWidth: 20, controlHeight: 20 }));
    const findings = compareRuntimeParity(expectations, tiny, desktop).findings;
    expect(findings).toContainEqual(expect.objectContaining({ code: "parity.target-size", nodeId: interactive.id }));
    if (text) expect(findings).not.toContainEqual(expect.objectContaining({ code: "parity.target-size", nodeId: text.id }));
  });

  it("flags horizontal overflow as a warning", () => {
    const overflowing = cleanMeasurements().map((entry, index) => index === 0 ? { ...entry, overflowX: true } : entry);
    expect(compareRuntimeParity(expectations, overflowing, compact).findings).toContainEqual(
      expect.objectContaining({ code: "parity.overflow", severity: "warning" }),
    );
  });

  it("requires persistent compact actions to stay reachable on compact frames only", () => {
    const persistentExpectations = expectations.map((entry) => entry.id === "payment-request.confirm"
      ? { ...entry, persistentCompact: true }
      : entry);
    const belowFold = cleanMeasurements().map((entry) => entry.id === "payment-request.confirm"
      ? { ...entry, position: "static", y: 1600 }
      : entry);
    expect(compareRuntimeParity(persistentExpectations, belowFold, compact).findings).toContainEqual(
      expect.objectContaining({ code: "parity.reachability", nodeId: "payment-request.confirm", severity: "error" }),
    );
    expect(compareRuntimeParity(persistentExpectations, belowFold, desktop).findings).not.toContainEqual(
      expect.objectContaining({ code: "parity.reachability" }),
    );
    const fixed = cleanMeasurements().map((entry) => entry.id === "payment-request.confirm"
      ? { ...entry, position: "fixed", y: 1600 }
      : entry);
    expect(compareRuntimeParity(persistentExpectations, fixed, compact).findings).not.toContainEqual(
      expect.objectContaining({ code: "parity.reachability" }),
    );
    expect(viewportIsCompact(compact.width)).toBe(true);
    expect(viewportIsCompact(desktop.width)).toBe(false);
  });

  it("injects a nonce-bound probe and validates its response strictly", () => {
    const page = "<html><body><main></main></body></html>";
    const injected = injectParityProbe(page, "nonce-1", "mobile");
    expect(injected).toContain(PARITY_MESSAGE_TYPE);
    expect(injected).toContain("nonce-1");
    expect(injected.indexOf("</body>")).toBeGreaterThan(injected.indexOf("<script>"));

    const valid = {
      type: PARITY_MESSAGE_TYPE,
      nonce: "nonce-1",
      frameId: "mobile",
      viewport: { width: 390, height: 700 },
      measurements: [measurement({ id: "a", order: 0 })],
    };
    expect(parseParityProbeMessage(valid, "nonce-1")).not.toBeNull();
    expect(parseParityProbeMessage(valid, "other-nonce")).toBeNull();
    expect(parseParityProbeMessage({ ...valid, measurements: [{ id: 1 }] }, "nonce-1")).toBeNull();
    expect(parseParityProbeMessage(null, "nonce-1")).toBeNull();
  });

  it("summarizes matched and differing runs in plain language", () => {
    const clean = compareRuntimeParity(expectations, cleanMeasurements(), compact);
    const cleanSummary = summarizeParityReport({ screenId: screen.id, fingerprint: "f", completedAt: "t", frames: [clean] });
    expect(cleanSummary).toContain(`${expectations.length} nodes matched`);

    const broken = compareRuntimeParity(expectations, cleanMeasurements().slice(1), compact);
    const summary = summarizeParityReport({ screenId: screen.id, fingerprint: "f", completedAt: "t", frames: [broken] });
    expect(summary).toContain("1 missing");
    expect(summary).toContain(`${broken.matchedNodes}/${expectations.length} nodes matched`);
  });
});
