import type { VerificationFinding } from "@intentform/verifier";
import { applyRepair, type RepairProposal } from "@intentform/repair-planner";
import {
  flattenSemanticNodes,
  semanticDiff,
  stableSerialize,
  type SemanticChange,
  type SemanticInterfaceGraph,
} from "@intentform/semantic-schema";
import type { OutputTarget } from "../studio";
import type { LocalPreviewEntry, LocalPreviewTarget } from "../use-local-previews";
import type { DeviceProfile } from "../editor/support";

export type VerificationSeverity = VerificationFinding["severity"];
export type VerificationCategory = NonNullable<VerificationFinding["category"]> | "semantic";

export interface VerificationNavigationTarget {
  screenId: string;
  nodeId: string | null;
  deviceProfile: string | null;
  visualState: string;
}

export interface RepairPreview {
  findingId: string;
  sourceFingerprint: string;
  proposal: RepairProposal;
  changes: SemanticChange[];
  repairedGraph: SemanticInterfaceGraph;
}

export const COMPARISON_PROFILE_LIMIT = 3;

function comparisonCategory(profile: DeviceProfile): "phone" | "tablet" | "desktop" {
  if (profile.width < 600) return "phone";
  if (profile.width < 1_000) return "tablet";
  return "desktop";
}

function preferredProfile(
  profiles: readonly DeviceProfile[],
  category: ReturnType<typeof comparisonCategory>,
): DeviceProfile | undefined {
  const candidates = profiles.filter((profile) => comparisonCategory(profile) === category);
  if (category === "desktop") {
    return candidates.find((profile) => profile.presentation === "browser")
      ?? candidates.find((profile) => profile.id.includes("browser"))
      ?? [...candidates].sort((left, right) => right.width - left.width)[0];
  }
  return candidates.find((profile) => profile.presentation === "device" && profile.orientation === "portrait")
    ?? candidates.find((profile) => profile.presentation === "device")
    ?? candidates[0];
}

export function defaultComparisonProfileIds(profiles: readonly DeviceProfile[]): string[] {
  const preferred = (["desktop", "tablet", "phone"] as const)
    .map((category) => preferredProfile(profiles, category))
    .filter((profile): profile is DeviceProfile => Boolean(profile));
  const remaining = profiles.filter((profile) => !preferred.some((candidate) => candidate.id === profile.id));
  return [...preferred, ...remaining].slice(0, COMPARISON_PROFILE_LIMIT).map((profile) => profile.id);
}

export function reconcileComparisonProfileIds(
  selectedIds: readonly string[],
  profiles: readonly DeviceProfile[],
): string[] {
  const availableIds = new Set<string>(profiles.map((profile) => profile.id));
  const valid = selectedIds.filter((id, index) => availableIds.has(id) && selectedIds.indexOf(id) === index);
  const defaults = defaultComparisonProfileIds(profiles).filter((id) => !valid.includes(id));
  return [...valid, ...defaults].slice(0, Math.min(COMPARISON_PROFILE_LIMIT, profiles.length));
}

export function replaceComparisonProfile(
  selectedIds: readonly string[],
  index: number,
  profileId: string,
  profiles: readonly DeviceProfile[],
): string[] {
  const reconciled = reconcileComparisonProfileIds(selectedIds, profiles);
  if (index < 0 || index >= reconciled.length || !profiles.some((profile) => profile.id === profileId)) return reconciled;
  const existingIndex = reconciled.indexOf(profileId);
  const next = [...reconciled];
  if (existingIndex >= 0) next[existingIndex] = reconciled[index]!;
  next[index] = profileId;
  return next;
}

export function localPreviewTarget(target: OutputTarget): LocalPreviewTarget {
  if (target === "swiftui") return "swiftui";
  if (target === "expo") return "expo-ios";
  return "browser";
}

export function usableLocalPreview(entry: LocalPreviewEntry | undefined) {
  return entry && !("unavailable" in entry) ? entry : null;
}

export function verificationNavigationTarget(
  graph: SemanticInterfaceGraph,
  finding: VerificationFinding,
  availableDeviceProfiles: ReadonlySet<string>,
  currentSourceFingerprint: string,
): VerificationNavigationTarget | null {
  if (finding.sourceFingerprint && finding.sourceFingerprint !== currentSourceFingerprint) return null;
  const screen = graph.screens.find((candidate) => candidate.id === finding.screenId);
  if (!screen) return null;
  const requestedNodeId = finding.nodeId ?? finding.nodeIds?.[0] ?? null;
  const exactNode = requestedNodeId
    ? flattenSemanticNodes(screen.nodes).find((candidate) => candidate.id === requestedNodeId)
    : null;
  if (requestedNodeId && !exactNode) return null;
  if (finding.deviceProfile && !availableDeviceProfiles.has(finding.deviceProfile)) return null;
  const availableStates = graph.contracts.find((contract) => contract.screenId === screen.id)?.visualStates ?? ["idle"];
  if (finding.visualState && !availableStates.includes(finding.visualState as typeof availableStates[number])) return null;
  return {
    screenId: screen.id,
    nodeId: exactNode?.id ?? null,
    deviceProfile: finding.deviceProfile ?? null,
    visualState: finding.visualState ?? "idle",
  };
}

export function createRepairPreview(
  graph: SemanticInterfaceGraph,
  finding: VerificationFinding,
  proposal: RepairProposal,
  sourceFingerprint: string,
): RepairPreview {
  const before = stableSerialize(graph);
  const repairedGraph = applyRepair(graph, proposal);
  if (stableSerialize(graph) !== before) throw new Error("Repair preview mutated the source graph.");
  const changes = semanticDiff(graph, repairedGraph);
  if (changes.length === 0) throw new Error("The proposed repair does not change the current graph.");
  return {
    findingId: finding.id,
    sourceFingerprint,
    proposal,
    changes,
    repairedGraph,
  };
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
    category: "all" | VerificationCategory;
  },
): VerificationFinding[] {
  const normalized = options.query.trim().toLowerCase();
  return findings.filter((finding) => (
    options.severities.has(finding.severity)
    && (options.showSuppressed || finding.status !== "suppressed")
    && (options.profileId === "all" || finding.rule?.profileId === options.profileId)
    && (options.category === "all" || (finding.category ?? "semantic") === options.category)
    && (!normalized || `${finding.violatedIntent} ${finding.id} ${finding.screenId} ${finding.responsibleLayer} ${finding.designQualityCategory ?? ""} ${(finding.nodeIds ?? []).join(" ")} ${(finding.propertyPaths ?? []).join(" ")}`.toLowerCase().includes(normalized))
  ));
}
