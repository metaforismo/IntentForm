import { describe, expect, it } from "vitest";
import type { VerificationFinding } from "@intentform/verifier";
import {
  countVerificationFindings,
  defaultComparisonProfileIds,
  filterVerificationFindings,
  localPreviewTarget,
  matchingCodeLineNumbers,
  reconcileComparisonProfileIds,
  replaceComparisonProfile,
  usableLocalPreview,
} from "./workspace-model";
import type { DeviceProfile } from "../editor/support";

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
    });
    expect(visible.map((item) => item.id)).toEqual(["swiftui.settings.contrast"]);
  });

  it("only reveals suppressed findings when explicitly requested", () => {
    const findings = [finding({ id: "suppressed", status: "suppressed" })];
    const base = { query: "", severities: new Set(["error"] as const), profileId: "all" };
    expect(filterVerificationFindings(findings, { ...base, showSuppressed: false })).toEqual([]);
    expect(filterVerificationFindings(findings, { ...base, showSuppressed: true })).toEqual(findings);
  });
});
