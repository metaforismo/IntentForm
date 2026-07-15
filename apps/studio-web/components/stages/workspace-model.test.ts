import { describe, expect, it } from "vitest";
import type { VerificationFinding } from "@intentform/verifier";
import {
  countVerificationFindings,
  filterVerificationFindings,
  localPreviewTarget,
  matchingCodeLineNumbers,
  usableLocalPreview,
} from "./workspace-model";

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
