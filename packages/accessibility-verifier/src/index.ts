import {
  flattenSemanticNodes,
  type PlatformTarget,
  type SemanticInterfaceGraph,
  type SemanticNode,
} from "@intentform/semantic-schema";

export const ACCESSIBILITY_RULESET = Object.freeze({
  id: "intentform-accessibility",
  version: "1.0.0",
  standard: "WCAG 2.2 AA",
} as const);

export interface AccessibilityProfile {
  id: "baseline" | "long-text" | "rtl" | "high-contrast";
  locale: string;
  direction: "ltr" | "rtl";
  textScale: number;
  textExpansion: number;
  contrast: "normal" | "increased";
  reducedMotion: boolean;
}

export const ACCESSIBILITY_PROFILES: readonly AccessibilityProfile[] = Object.freeze([
  { id: "baseline", locale: "en", direction: "ltr", textScale: 1, textExpansion: 1, contrast: "normal", reducedMotion: false },
  { id: "long-text", locale: "de", direction: "ltr", textScale: 2, textExpansion: 1.8, contrast: "normal", reducedMotion: false },
  { id: "rtl", locale: "ar", direction: "rtl", textScale: 1.3, textExpansion: 1.35, contrast: "normal", reducedMotion: false },
  { id: "high-contrast", locale: "en", direction: "ltr", textScale: 1.2, textExpansion: 1, contrast: "increased", reducedMotion: true },
]);

export type AccessibilityRuleId =
  | "accessible-name"
  | "label-in-name"
  | "live-region-role"
  | "assertive-live-region"
  | "target-size"
  | "text-resize"
  | "rtl-logical-order"
  | "drag-alternative";

export interface AccessibilitySuppression {
  ruleId: AccessibilityRuleId;
  reason: string;
  screenId?: string;
  nodeId?: string;
  profileId?: AccessibilityProfile["id"];
}

export interface AccessibilityEvidence {
  kind: "node" | "rule" | "bounds" | "accessibility";
  label: string;
  value: string | number | boolean;
}

export interface AccessibilityFinding {
  id: string;
  ruleId: AccessibilityRuleId;
  ruleVersion: typeof ACCESSIBILITY_RULESET.version;
  standard: typeof ACCESSIBILITY_RULESET.standard;
  target: PlatformTarget;
  profileId: AccessibilityProfile["id"];
  screenId: string;
  nodeId: string;
  severity: "warning" | "error";
  message: string;
  responsibleLayer: "graph" | "compiler";
  evidence: AccessibilityEvidence[];
  status: "open" | "suppressed";
  suppressionReason?: string;
  repair: {
    kind: "author-accessibility" | "adjust-layout" | "add-action-alternative" | "compiler-lowering";
    summary: string;
  };
}

export interface AccessibilityAuditOptions {
  target: PlatformTarget;
  profiles?: readonly AccessibilityProfile[];
  suppressions?: readonly AccessibilitySuppression[];
}

export interface AccessibilityAuditResult {
  ruleset: typeof ACCESSIBILITY_RULESET;
  profiles: readonly AccessibilityProfile[];
  passed: boolean;
  findingCount: number;
  suppressedCount: number;
  findings: AccessibilityFinding[];
}

const interactiveKinds = new Set<SemanticNode["kind"]>(["money-input", "primary-action", "secondary-action"]);

function normalizedLabel(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function targetMinimum(target: PlatformTarget): number {
  if (target === "web" || target === "react") return 24;
  if (target === "compose") return 48;
  return 44;
}

function matchingSuppression(
  finding: Omit<AccessibilityFinding, "status" | "suppressionReason">,
  suppressions: readonly AccessibilitySuppression[],
): AccessibilitySuppression | undefined {
  return suppressions.find((suppression) => suppression.ruleId === finding.ruleId
    && (suppression.screenId === undefined || suppression.screenId === finding.screenId)
    && (suppression.nodeId === undefined || suppression.nodeId === finding.nodeId)
    && (suppression.profileId === undefined || suppression.profileId === finding.profileId));
}

function finding(
  target: PlatformTarget,
  profile: AccessibilityProfile,
  screenId: string,
  node: SemanticNode,
  input: Pick<AccessibilityFinding, "ruleId" | "severity" | "message" | "responsibleLayer" | "evidence" | "repair">,
  suppressions: readonly AccessibilitySuppression[],
): AccessibilityFinding {
  const base = {
    id: `${target}.${screenId}.a11y.${input.ruleId}.${profile.id}.${node.id}`,
    ruleVersion: ACCESSIBILITY_RULESET.version,
    standard: ACCESSIBILITY_RULESET.standard,
    target,
    profileId: profile.id,
    screenId,
    nodeId: node.id,
    ...input,
  } as const;
  const suppression = matchingSuppression(base, suppressions);
  return suppression
    ? { ...base, status: "suppressed", suppressionReason: suppression.reason }
    : { ...base, status: "open" };
}

function hasPointerOnlyInteraction(node: SemanticNode): boolean {
  const pointerEvents = node.interactions.filter((interaction) => /drag|swipe|pan|drop/i.test(interaction.event));
  if (pointerEvents.length === 0) return false;
  return !node.interactions.some((interaction) => /move|reorder|increment|decrement|select|activate/i.test(interaction.event));
}

function auditBaseline(
  graph: SemanticInterfaceGraph,
  target: PlatformTarget,
  profile: AccessibilityProfile,
  suppressions: readonly AccessibilitySuppression[],
): AccessibilityFinding[] {
  const findings: AccessibilityFinding[] = [];
  const minimum = targetMinimum(target);

  for (const screen of graph.screens) {
    for (const node of flattenSemanticNodes(screen.nodes)) {
      const accessibleName = normalizedLabel(node.accessibility.label);
      const visibleLabel = normalizedLabel(node.intent.label ?? "");
      if (interactiveKinds.has(node.kind) && accessibleName.length === 0) {
        findings.push(finding(target, profile, screen.id, node, {
          ruleId: "accessible-name",
          severity: "error",
          message: "Interactive controls require a non-empty accessible name.",
          responsibleLayer: "graph",
          evidence: [{ kind: "node", label: "Node ID", value: node.id }],
          repair: { kind: "author-accessibility", summary: "Author a concise accessible label for this control." },
        }, suppressions));
      }
      if (interactiveKinds.has(node.kind) && visibleLabel && !accessibleName.includes(visibleLabel)) {
        findings.push(finding(target, profile, screen.id, node, {
          ruleId: "label-in-name",
          severity: "error",
          message: "The accessible name must contain the visible control label in the same order.",
          responsibleLayer: "graph",
          evidence: [
            { kind: "node", label: "Node ID", value: node.id },
            { kind: "rule", label: "Visible label length", value: visibleLabel.length },
            { kind: "rule", label: "Accessible name length", value: accessibleName.length },
          ],
          repair: { kind: "author-accessibility", summary: "Align the accessible label with the visible label without exposing authored text in audit evidence." },
        }, suppressions));
      }
      if (node.kind === "status-message" && node.accessibility.live === "off") {
        findings.push(finding(target, profile, screen.id, node, {
          ruleId: "live-region-role",
          severity: "error",
          message: "Status messages that can update must expose a live-region policy.",
          responsibleLayer: "graph",
          evidence: [{ kind: "accessibility", label: "Live policy", value: "off" }],
          repair: { kind: "author-accessibility", summary: "Use polite updates for routine status and assertive only for urgent interruption." },
        }, suppressions));
      }
      if (node.kind !== "status-message" && node.accessibility.live !== "off") {
        findings.push(finding(target, profile, screen.id, node, {
          ruleId: "live-region-role",
          severity: "warning",
          message: "Live-region behavior belongs on a status-message semantic node.",
          responsibleLayer: "graph",
          evidence: [{ kind: "accessibility", label: "Live policy", value: node.accessibility.live }],
          repair: { kind: "author-accessibility", summary: "Move update announcements to a dedicated status-message node." },
        }, suppressions));
      }
      if (node.accessibility.live === "assertive") {
        findings.push(finding(target, profile, screen.id, node, {
          ruleId: "assertive-live-region",
          severity: "warning",
          message: "Assertive announcements interrupt assistive technology and require manual justification.",
          responsibleLayer: target === "swiftui" ? "compiler" : "graph",
          evidence: [{ kind: "accessibility", label: "Live policy", value: "assertive" }],
          repair: { kind: target === "swiftui" ? "compiler-lowering" : "author-accessibility", summary: "Prefer polite announcements unless this is an urgent error." },
        }, suppressions));
      }
      if (interactiveKinds.has(node.kind)) {
        const constrainedHeight = node.layout.height === "fixed" ? node.layout.fixedHeight : node.layout.maxHeight;
        const constrainedWidth = node.layout.width === "fixed" ? node.layout.fixedWidth : node.layout.maxWidth;
        if ((constrainedHeight !== undefined && constrainedHeight < minimum)
          || (constrainedWidth !== undefined && constrainedWidth < minimum)) {
          findings.push(finding(target, profile, screen.id, node, {
            ruleId: "target-size",
            severity: "error",
            message: `Interactive targets must not be constrained below ${minimum} by ${minimum} logical units for this output.`,
            responsibleLayer: "graph",
            evidence: [
              { kind: "bounds", label: "Required minimum", value: minimum },
              { kind: "bounds", label: "Constrained width", value: constrainedWidth ?? false },
              { kind: "bounds", label: "Constrained height", value: constrainedHeight ?? false },
            ],
            repair: { kind: "adjust-layout", summary: "Remove the undersized maximum/fixed constraint and preserve compiler target padding." },
          }, suppressions));
        }
      }
      if (hasPointerOnlyInteraction(node)) {
        findings.push(finding(target, profile, screen.id, node, {
          ruleId: "drag-alternative",
          severity: "error",
          message: "A drag-like interaction requires a non-drag alternative that performs the same operation.",
          responsibleLayer: "graph",
          evidence: [{ kind: "rule", label: "Pointer-only interaction", value: true }],
          repair: { kind: "add-action-alternative", summary: "Add move, reorder, increment, decrement, select, or activate semantics for the same operation." },
        }, suppressions));
      }
    }
  }
  return findings;
}

function auditProfileRisks(
  graph: SemanticInterfaceGraph,
  target: PlatformTarget,
  profile: AccessibilityProfile,
  suppressions: readonly AccessibilitySuppression[],
): AccessibilityFinding[] {
  if (profile.id === "baseline" || profile.id === "high-contrast") return [];
  const findings: AccessibilityFinding[] = [];
  for (const screen of graph.screens) {
    for (const node of flattenSemanticNodes(screen.nodes)) {
      if (profile.id === "long-text" && node.layout.height === "fixed" && node.layout.fixedHeight !== undefined) {
        const estimatedLines = Math.max(1, Math.ceil(((node.intent.label?.length ?? node.accessibility.label.length) * profile.textExpansion) / 28));
        const requiredHeight = Math.ceil(estimatedLines * 24 * profile.textScale);
        if (node.layout.fixedHeight < requiredHeight) {
          findings.push(finding(target, profile, screen.id, node, {
            ruleId: "text-resize",
            severity: "warning",
            message: "A fixed-height node may clip localized text at 200 percent text scale.",
            responsibleLayer: "graph",
            evidence: [
              { kind: "bounds", label: "Fixed height", value: node.layout.fixedHeight },
              { kind: "bounds", label: "Estimated required height", value: requiredHeight },
              { kind: "rule", label: "Text scale", value: profile.textScale },
            ],
            repair: { kind: "adjust-layout", summary: "Use hug height or raise the minimum while allowing content to wrap." },
          }, suppressions));
        }
      }
      if (profile.id === "rtl" && node.layout.position && interactiveKinds.has(node.kind)) {
        findings.push(finding(target, profile, screen.id, node, {
          ruleId: "rtl-logical-order",
          severity: "warning",
          message: "Absolutely positioned interactive content needs manual RTL reading-order and overlap verification.",
          responsibleLayer: "graph",
          evidence: [
            { kind: "rule", label: "Direction", value: profile.direction },
            { kind: "bounds", label: "Absolute X", value: node.layout.position.x },
          ],
          repair: { kind: "adjust-layout", summary: "Prefer logical flow or add an explicit mirrored layout for RTL." },
        }, suppressions));
      }
    }
  }
  return findings;
}

export function auditAccessibility(
  graph: SemanticInterfaceGraph,
  options: AccessibilityAuditOptions,
): AccessibilityAuditResult {
  const profiles = options.profiles?.length ? [...options.profiles] : [...ACCESSIBILITY_PROFILES];
  const ids = new Set<string>();
  for (const profile of profiles) {
    if (ids.has(profile.id)) throw new Error(`Duplicate accessibility profile: ${profile.id}`);
    if (!Number.isFinite(profile.textScale) || profile.textScale < 1 || profile.textScale > 3) {
      throw new RangeError(`Accessibility profile ${profile.id} has an invalid text scale`);
    }
    ids.add(profile.id);
  }
  const suppressions = options.suppressions ?? [];
  for (const suppression of suppressions) {
    if (suppression.reason.trim().length < 8 || suppression.reason.length > 500) {
      throw new Error(`Suppression ${suppression.ruleId} requires an 8-500 character reason`);
    }
    if (/@|https?:\/\/|\b(?:sk|rk|pk)_[A-Za-z0-9_-]{8,}\b|\b\+?\d[\d .()-]{6,}\d\b/i.test(suppression.reason)) {
      throw new Error(`Suppression ${suppression.ruleId} must not contain email, URL, phone, or token-like data`);
    }
  }

  const findings = profiles.flatMap((profile) => [
    ...(profile.id === "baseline" ? auditBaseline(graph, options.target, profile, suppressions) : []),
    ...auditProfileRisks(graph, options.target, profile, suppressions),
  ]).sort((left, right) => left.id.localeCompare(right.id));
  return {
    ruleset: ACCESSIBILITY_RULESET,
    profiles,
    passed: !findings.some((item) => item.severity === "error" && item.status === "open"),
    findingCount: findings.filter((item) => item.status === "open").length,
    suppressedCount: findings.filter((item) => item.status === "suppressed").length,
    findings,
  };
}
