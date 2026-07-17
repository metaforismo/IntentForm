import { describe, expect, it } from "vitest";
import {
  groupAssetIntegrityDiagnostics,
  hasBlockingAssetIntegrityIssue,
  parseAssetIntegritySnapshot,
} from "./asset-integrity";

describe("asset integrity UI model", () => {
  it("parses bounded snapshots and groups variant findings under their asset", () => {
    const snapshot = parseAssetIntegritySnapshot({
      fingerprint: "deadbeef",
      diagnostics: [
        { assetId: "brand.hero", variantId: "dark", severity: "error", code: "asset.missing", message: "Variant bytes are missing." },
        { assetId: "brand.hero", severity: "warning", code: "asset.policy-blocked", message: "Export is blocked." },
      ],
    });

    expect(groupAssetIntegrityDiagnostics(snapshot.diagnostics).get("brand.hero")).toHaveLength(2);
    expect(hasBlockingAssetIntegrityIssue(snapshot.diagnostics)).toBe(true);
  });

  it("keeps policy and license findings non-blocking for canvas placement", () => {
    expect(hasBlockingAssetIntegrityIssue([
      { assetId: "licensed.photo", severity: "warning", code: "asset.license-restricted", message: "Reference only." },
    ])).toBe(false);
  });

  it.each([
    [{ fingerprint: "bad", diagnostics: [] }],
    [{ fingerprint: "deadbeef", diagnostics: [{ assetId: "bad/id", severity: "error", code: "asset.missing", message: "Missing." }] }],
    [{ fingerprint: "deadbeef", diagnostics: [{ assetId: "asset.ok", severity: "fatal", code: "asset.missing", message: "Missing." }] }],
    [{ fingerprint: "deadbeef", diagnostics: [{ assetId: "asset.ok", severity: "error", code: "asset.unknown", message: "Unknown." }] }],
  ])("rejects malformed snapshots without accepting partial data", (input) => {
    expect(() => parseAssetIntegritySnapshot(input)).toThrow(/invalid/i);
  });
});
