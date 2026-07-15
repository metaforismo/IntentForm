import type { VerificationFinding } from "@intentform/verifier";
import type { OutputTarget } from "../studio";
import type { LocalPreviewEntry, LocalPreviewTarget } from "../use-local-previews";

export type VerificationSeverity = VerificationFinding["severity"];

export function localPreviewTarget(target: OutputTarget): LocalPreviewTarget {
  if (target === "swiftui") return "swiftui";
  if (target === "expo") return "expo-ios";
  return "browser";
}

export function usableLocalPreview(entry: LocalPreviewEntry | undefined) {
  return entry && !("unavailable" in entry) ? entry : null;
}

export function matchingCodeLineNumbers(lines: readonly string[], query: string): Set<number> {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return new Set();
  return new Set(lines.flatMap((line, index) => line.toLowerCase().includes(normalized) ? [index] : []));
}

export function countVerificationFindings(findings: readonly VerificationFinding[]) {
  return {
    error: findings.filter((finding) => finding.severity === "error" && finding.status !== "suppressed").length,
    warning: findings.filter((finding) => finding.severity === "warning" && finding.status !== "suppressed").length,
    info: findings.filter((finding) => finding.severity === "info" && finding.status !== "suppressed").length,
    suppressed: findings.filter((finding) => finding.status === "suppressed").length,
  };
}

export function filterVerificationFindings(
  findings: readonly VerificationFinding[],
  options: {
    query: string;
    severities: ReadonlySet<VerificationSeverity>;
    showSuppressed: boolean;
    profileId: string;
  },
): VerificationFinding[] {
  const normalized = options.query.trim().toLowerCase();
  return findings.filter((finding) => (
    options.severities.has(finding.severity)
    && (options.showSuppressed || finding.status !== "suppressed")
    && (options.profileId === "all" || finding.rule?.profileId === options.profileId)
    && (!normalized || `${finding.violatedIntent} ${finding.id} ${finding.screenId} ${finding.responsibleLayer}`.toLowerCase().includes(normalized))
  ));
}
