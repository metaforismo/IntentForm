import { describe, expect, it } from "vitest";
import type { VerificationFinding } from "@intentform/verifier";
import {
  countVerificationFindings,
  buildPresentation,
  createRepairPreview,
  defaultComparisonProfileIds,
  filterVerificationFindings,
  localPreviewTarget,
  matchingCodeLineNumbers,
  reconcileComparisonProfileIds,
  replaceComparisonProfile,
  usableLocalPreview,
  verificationNavigationTarget,
} from "./workspace-model";
import type { DeviceProfile } from "../editor/support";
import { demoGraph } from "@intentform/proof-report/demo";
import { stableSerialize } from "@intentform/semantic-schema";

function profile(id: string, width: number, presentation: DeviceProfile["presentation"] = "device"): DeviceProfile {
  return {
    id: id as DeviceProfile["id"], label: id, detail: `${width}px`, width, height: width < 600 ? 844 : 900,
    breakpoint: width < 600 ? "compact" : "regular", presentation, scale: 1, orientation: width < 600 ? "portrait" : "landscape",
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 }, corners: { radius: 0 }, cutouts: [], capabilities: [], textScale: 1,
  };
}

function finding(overrides: Partial<VerificationFinding> = {}): VerificationFinding {
  return {
    id: "react.checkout.primary",
    target: "react",
    screenId: "checkout",
    severity: "error",
    violatedIntent: "Primary action needs an accessible name",
    evidence: [],
    responsibleLayer: "graph",
    status: "open",
    ...overrides,
  };
}

describe("Code and Verify workspace model", () => {
  it("chooses one desktop, tablet, and phone comparison profile in visual order", () => {
    const profiles = [
      profile("device:phone", 390),
      profile("device:tablet", 768),
      profile("device:precision.browser.desktop", 1_440),
      profile("web:desktop", 1_440, "browser"),
    ];
    expect(defaultComparisonProfileIds(profiles)).toEqual(["web:desktop", "device:tablet", "device:phone"]);
  });

  it("prefers a registry browser profile when the graph has no Web frames", () => {
    const profiles = [profile("device:ipad-landscape", 1_180), profile("device:precision.browser.desktop", 1_440), profile("device:tablet", 768), profile("device:phone", 390)];
    expect(defaultComparisonProfileIds(profiles)[0]).toBe("device:precision.browser.desktop");
  });

  it("reconciles removed and duplicate comparison profiles without exceeding three frames", () => {
    const profiles = [profile("device:phone", 390), profile("device:tablet", 768), profile("web:desktop", 1_440, "browser")];
    expect(reconcileComparisonProfileIds(["missing", "device:phone", "device:phone"], profiles))
      .toEqual(["device:phone", "web:desktop", "device:tablet"]);
  });

  it("swaps an already visible comparison profile instead of rendering duplicates", () => {
    const profiles = [profile("device:phone", 390), profile("device:tablet", 768), profile("web:desktop", 1_440, "browser")];
    expect(replaceComparisonProfile(["web:desktop", "device:tablet", "device:phone"], 0, "device:phone", profiles))
      .toEqual(["device:phone", "device:tablet", "web:desktop"]);
    expect(replaceComparisonProfile(["web:desktop", "device:tablet", "device:phone"], 8, "missing", profiles))
      .toEqual(["web:desktop", "device:tablet", "device:phone"]);
  });

  it("maps generated targets onto the correct local preview runtime", () => {
    expect(localPreviewTarget("web")).toBe("browser");
    expect(localPreviewTarget("react")).toBe("browser");
    expect(localPreviewTarget("expo")).toBe("expo-ios");
    expect(localPreviewTarget("swiftui")).toBe("swiftui");
  });

  it("does not treat toolchain-unavailable entries as build evidence", () => {
    expect(usableLocalPreview({ target: "swiftui", unavailable: true, message: "Xcode missing" })).toBeNull();
    expect(usableLocalPreview(undefined)).toBeNull();
  });

  it("presents build lifecycle states without treating stale or generated output as verified", () => {
    expect(buildPresentation(false, undefined, false)).toMatchObject({ state: "disabled", canStart: false });
    expect(buildPresentation(true, undefined, false)).toMatchObject({ state: "not-run", canStart: true });
    expect(buildPresentation(true, { target: "swiftui", unavailable: true, message: "Xcode missing" }, false))
      .toMatchObject({ state: "unavailable", canStart: false });
    const base = {
      target: "browser" as const,
      evidence: "built" as const,
      freshness: "fresh" as const,
      buildStatus: "passed" as const,
      buildState: "passed" as const,
      expectedBinding: {} as never,
      manifest: null,
      priorValidEvidence: null,
    };
    expect(buildPresentation(true, { ...base, phase: "building" }, false)).toMatchObject({ state: "running", canCancel: true });
    expect(buildPresentation(true, { ...base, phase: "ready" }, false)).toMatchObject({ state: "current", label: "Evidence current" });
    expect(buildPresentation(true, { ...base, phase: "ready", freshness: "stale", buildState: "stale" }, false))
      .toMatchObject({ state: "stale", canStart: true });
  });

  it("finds generated source lines case-insensitively without matching an empty query", () => {
    expect([...matchingCodeLineNumbers(["const Button = 1", "button()", "Text()"], " BUTTON ")]).toEqual([0, 1]);
    expect([...matchingCodeLineNumbers(["anything"], "   ")]).toEqual([]);
  });

  it("counts open severities separately from suppressed findings", () => {
    const findings = [
      finding(),
      finding({ id: "warning", severity: "warning" }),
      finding({ id: "info", severity: "info" }),
      finding({ id: "suppressed", status: "suppressed" }),
    ];
    expect(countVerificationFindings(findings)).toEqual({ error: 1, warning: 1, info: 1, suppressed: 1 });
  });

  it("filters by severity, suppression, profile, and searchable evidence identity", () => {
    const findings = [
      finding({ rule: { id: "name", version: "2.2", standard: "WCAG", profileId: "screen-reader" } }),
      finding({ id: "swiftui.settings.contrast", target: "swiftui", screenId: "settings", severity: "warning", violatedIntent: "Contrast is insufficient", responsibleLayer: "tokens", rule: { id: "contrast", version: "2.2", standard: "WCAG", profileId: "low-vision" } }),
      finding({ id: "suppressed", status: "suppressed" }),
    ];
    const visible = filterVerificationFindings(findings, {
      query: "settings tokens",
      severities: new Set(["warning"]),
      showSuppressed: false,
      profileId: "low-vision",
      category: "all",
    });
    expect(visible.map((item) => item.id)).toEqual(["swiftui.settings.contrast"]);
  });

  it("only reveals suppressed findings when explicitly requested", () => {
    const findings = [finding({ id: "suppressed", status: "suppressed" })];
    const base = { query: "", severities: new Set(["error"] as const), profileId: "all", category: "all" as const };
    expect(filterVerificationFindings(findings, { ...base, showSuppressed: false })).toEqual([]);
    expect(filterVerificationFindings(findings, { ...base, showSuppressed: true })).toEqual(findings);
  });

  it("navigates only to the exact screen, node, device, and visual state from evidence", () => {
    const exactNode = demoGraph.screens[0]!.nodes[0]!.id;
    expect(verificationNavigationTarget(demoGraph, finding({
      screenId: demoGraph.screens[0]!.id,
      nodeId: exactNode,
      deviceProfile: "device:known",
      visualState: "idle",
      sourceFingerprint: "1234abcd",
    }), new Set(["device:known"]), "1234abcd")).toEqual({
      screenId: demoGraph.screens[0]!.id,
      nodeId: exactNode,
      deviceProfile: "device:known",
      visualState: "idle",
    });
    expect(verificationNavigationTarget(demoGraph, finding({ screenId: "missing" }), new Set(), "1234abcd")).toBeNull();
    expect(verificationNavigationTarget(demoGraph, finding({ screenId: demoGraph.screens[0]!.id, nodeId: "missing" }), new Set(), "1234abcd")).toBeNull();
    expect(verificationNavigationTarget(demoGraph, finding({ screenId: demoGraph.screens[0]!.id, sourceFingerprint: "feedc0de" }), new Set(), "1234abcd")).toBeNull();
  });

  it("previews a repair without mutating the canonical graph", () => {
    const node = demoGraph.screens.flatMap((screen) => screen.nodes).find((candidate) => candidate.id === "payment-request.confirm")!;
    const before = stableSerialize(demoGraph);
    const preview = createRepairPreview(demoGraph, finding({ id: "react.primary.compact-reachability" }), {
      layer: "graph",
      summary: "Keep the primary action reachable on compact screens.",
      patch: {
        id: "repair.preview-test",
        rationale: "Compact reachability",
        operations: [{ op: "set-placement", target: node.id, compact: "persistent-bottom", regular: "inline" }],
      },
    }, "1234abcd");
    expect(stableSerialize(demoGraph)).toBe(before);
    expect(preview.sourceFingerprint).toBe("1234abcd");
    expect(preview.repairedGraph).not.toBe(demoGraph);
    expect(preview.changes.length).toBeGreaterThan(0);
  });

  it("filters deterministic design-quality findings by category and exact property path", () => {
    const findings = [
      finding({ category: "semantic" }),
      finding({
        id: "design-quality.spacing.off-scale.checkout.stack",
        category: "design-quality",
        designQualityCategory: "spacing",
        nodeIds: ["checkout.stack"],
        propertyPaths: ["checkout.stack.layout.gap"],
      }),
    ];
    const visible = filterVerificationFindings(findings, {
      query: "checkout.stack.layout.gap",
      severities: new Set(["error"]),
      showSuppressed: false,
      profileId: "all",
      category: "design-quality",
    });
    expect(visible.map((item) => item.id)).toEqual(["design-quality.spacing.off-scale.checkout.stack"]);
  });
});
