export const assetIntegrityCodes = [
  "asset.missing",
  "asset.symlink",
  "asset.digest-mismatch",
  "asset.policy-blocked",
  "asset.license-restricted",
] as const;

export type AssetIntegrityCode = (typeof assetIntegrityCodes)[number];

export interface AssetIntegrityDiagnostic {
  assetId: string;
  variantId?: string;
  severity: "warning" | "error";
  code: AssetIntegrityCode;
  message: string;
}

export interface AssetIntegritySnapshot {
  fingerprint: string;
  diagnostics: AssetIntegrityDiagnostic[];
}

const codes = new Set<string>(assetIntegrityCodes);
const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;

export function parseAssetIntegritySnapshot(input: unknown): AssetIntegritySnapshot {
  if (!input || typeof input !== "object") throw new Error("Asset integrity response is invalid.");
  const candidate = input as { fingerprint?: unknown; diagnostics?: unknown };
  if (typeof candidate.fingerprint !== "string" || !/^[a-f0-9]{8}$/.test(candidate.fingerprint)) {
    throw new Error("Asset integrity fingerprint is invalid.");
  }
  // 256 assets × (one base file + 16 variants + two policy findings).
  if (!Array.isArray(candidate.diagnostics) || candidate.diagnostics.length > 4_864) {
    throw new Error("Asset integrity diagnostics are invalid.");
  }
  const diagnostics = candidate.diagnostics.map((value) => {
    if (!value || typeof value !== "object") throw new Error("Asset integrity diagnostic is invalid.");
    const item = value as Record<string, unknown>;
    if (
      typeof item.assetId !== "string"
      || !identifier.test(item.assetId)
      || (item.variantId !== undefined && (typeof item.variantId !== "string" || !identifier.test(item.variantId)))
      || (item.severity !== "warning" && item.severity !== "error")
      || typeof item.code !== "string"
      || !codes.has(item.code)
      || typeof item.message !== "string"
      || item.message.length < 1
      || item.message.length > 500
    ) throw new Error("Asset integrity diagnostic is invalid.");
    return item as unknown as AssetIntegrityDiagnostic;
  });
  return { fingerprint: candidate.fingerprint, diagnostics };
}

export function groupAssetIntegrityDiagnostics(diagnostics: readonly AssetIntegrityDiagnostic[]): Map<string, AssetIntegrityDiagnostic[]> {
  const grouped = new Map<string, AssetIntegrityDiagnostic[]>();
  for (const diagnostic of diagnostics) {
    const current = grouped.get(diagnostic.assetId) ?? [];
    current.push(diagnostic);
    grouped.set(diagnostic.assetId, current);
  }
  return grouped;
}

export function hasBlockingAssetIntegrityIssue(diagnostics: readonly AssetIntegrityDiagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}
