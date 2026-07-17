import {
  classifyDevice,
  flattenSemanticNodes,
  isTransactionalScreen,
  resolveTokenMode,
  type PlatformTarget,
  type SemanticInterfaceGraph,
} from "@intentform/semantic-schema";
import {
  ACCESSIBILITY_PROFILES,
  ACCESSIBILITY_RULESET,
  auditAccessibility,
  type AccessibilityProfile,
  type AccessibilitySuppression,
} from "@intentform/accessibility-verifier";
import {
  DESIGN_QUALITY_RULESET,
  auditDesignQuality,
  type DesignQualityCategory,
} from "./design-quality.ts";

export {
  ACCESSIBILITY_PROFILES,
  ACCESSIBILITY_RULESET,
  auditAccessibility,
  type AccessibilityProfile,
  type AccessibilitySuppression,
} from "@intentform/accessibility-verifier";
export {
  DESIGN_QUALITY_RULESET,
  auditDesignQuality,
  type DesignQualityCategory,
  type DesignQualityFinding,
  type DesignQualityScenario,
} from "./design-quality.ts";

export interface Evidence {
  kind: "viewport" | "node" | "build" | "rule" | "screenshot" | "bounds" | "accessibility" | "design-quality";
  label: string;
  value: string | number | boolean;
}

export interface RenderObservation {
  target: PlatformTarget;
  screenId: string;
  viewport: { width: number; height: number };
  primaryAction: { x: number; y: number; width: number; height: number };
  position: string;
  screenshotPath: string;
  graphPlacement: "inline" | "persistent-bottom";
}

export function verifyRenderedPrimaryAction(
  observation: RenderObservation,
): VerificationFinding[] {
  const deviceClass = classifyDevice(observation.viewport);
  const findings: VerificationFinding[] = [];
  const persistent = observation.position === "fixed"
    || observation.position === "sticky"
    || observation.position === "viewport-bottom";
  const actionBottom = observation.primaryAction.y + observation.primaryAction.height;
  const insideViewport = observation.primaryAction.x >= 0
    && observation.primaryAction.y >= 0
    && observation.primaryAction.x + observation.primaryAction.width <= observation.viewport.width
    && actionBottom <= observation.viewport.height;

  if (deviceClass === "compact" && !persistent) {
    findings.push({
      id: `${observation.target}.${observation.screenId}.primary.rendered-reachability`,
      target: observation.target,
      screenId: observation.screenId,
      severity: "error",
      violatedIntent: "The rendered primary action must remain persistently reachable on compact screens.",
      evidence: [
        { kind: "viewport", label: "Viewport width", value: observation.viewport.width },
        { kind: "viewport", label: "Viewport height", value: observation.viewport.height },
        { kind: "bounds", label: "Primary action Y", value: observation.primaryAction.y },
        { kind: "bounds", label: "Primary action height", value: observation.primaryAction.height },
        { kind: "node", label: "Computed position", value: observation.position },
        { kind: "screenshot", label: "Screenshot", value: observation.screenshotPath },
      ],
      responsibleLayer: observation.graphPlacement === "persistent-bottom" ? "compiler" : "graph",
      status: "open",
    });
  }

  if (deviceClass === "regular"
    && persistent !== (observation.graphPlacement === "persistent-bottom")) {
    findings.push({
      id: `${observation.target}.${observation.screenId}.primary.rendered-placement`,
      target: observation.target,
      screenId: observation.screenId,
      severity: "error",
      violatedIntent: "The rendered primary action must honor the graph's regular-screen placement.",
      evidence: [
        { kind: "viewport", label: "Device class", value: deviceClass },
        { kind: "node", label: "Graph placement", value: observation.graphPlacement },
        { kind: "node", label: "Observed position", value: observation.position },
        { kind: "screenshot", label: "Screenshot", value: observation.screenshotPath },
      ],
      responsibleLayer: "compiler",
      status: "open",
    });
  }

  if (!insideViewport || observation.primaryAction.height < 44 || observation.primaryAction.width < 44) {
    findings.push({
      id: `${observation.target}.${observation.screenId}.primary.rendered-bounds`,
      target: observation.target,
      screenId: observation.screenId,
      severity: "error",
      violatedIntent: "The rendered primary action must be visible and provide at least a 44 by 44 point target.",
      evidence: [
        { kind: "bounds", label: "Primary action X", value: observation.primaryAction.x },
        { kind: "bounds", label: "Primary action Y", value: observation.primaryAction.y },
        { kind: "bounds", label: "Primary action width", value: observation.primaryAction.width },
        { kind: "bounds", label: "Primary action height", value: observation.primaryAction.height },
        { kind: "screenshot", label: "Screenshot", value: observation.screenshotPath },
      ],
      responsibleLayer: observation.graphPlacement === "persistent-bottom" ? "compiler" : "graph",
      status: "open",
    });
  }

  return findings;
}

export interface VerificationFinding {
  id: string;
  target: PlatformTarget;
  screenId: string;
  severity: "info" | "warning" | "error";
  violatedIntent: string;
  evidence: Evidence[];
  responsibleLayer: "graph" | "tokens" | "compiler";
  status: "open" | "repaired" | "verified" | "suppressed";
  rule?: {
    id: string;
    version: string;
    standard: string;
    profileId: string;
  };
  suppressionReason?: string;
  category?: "semantic" | "accessibility" | "build" | "design-quality";
  designQualityCategory?: DesignQualityCategory;
  nodeId?: string;
  nodeIds?: string[];
  propertyPath?: string;
  propertyPaths?: string[];
  deviceProfile?: string;
  visualState?: string;
  suggestedRepair?: {
    description: string;
  };
  subjective?: false;
}

export interface VerificationScenario {
  target: PlatformTarget;
  viewport: { width: number; height: number };
  buildStatus: "passed" | "failed" | "not-run";
  accessibility?: {
    profiles?: readonly AccessibilityProfile[];
    suppressions?: readonly AccessibilitySuppression[];
  };
}

export interface VerificationResult {
  passed: boolean;
  scenario: VerificationScenario;
  findings: VerificationFinding[];
}

function relativeLuminance(hex: string): number | null {
  const expanded = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) return null;
  const channel = (value: number) => {
    const scaled = value / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(parseInt(expanded.slice(0, 2), 16))
    + 0.7152 * channel(parseInt(expanded.slice(2, 4), 16))
    + 0.0722 * channel(parseInt(expanded.slice(4, 6), 16));
}

export function contrastRatio(foreground: string, background: string): number | null {
  const fg = relativeLuminance(foreground);
  const bg = relativeLuminance(background);
  if (fg === null || bg === null) return null;
  const lighter = Math.max(fg, bg);
  const darker = Math.min(fg, bg);
  return (lighter + 0.05) / (darker + 0.05);
}

/* Token-layer rules (WCAG 2.2): the primary action renders white text on
   color.accent (≥ 3:1 for large text / UI components), and body copy renders
   color.ink on color.surface (≥ 4.5:1). */
function verifyTokenContrast(
  graph: SemanticInterfaceGraph,
  target: PlatformTarget,
): VerificationFinding[] {
  const findings: VerificationFinding[] = [];
  const tokens = resolveTokenMode(graph.tokens);
  const checks: Array<{
    id: string;
    token: string;
    foreground: string;
    background: string;
    minimum: number;
    violatedIntent: string;
  }> = [
    {
      id: "tokens.contrast.primary-action",
      token: "color.accent",
      foreground: "#ffffff",
      background: tokens.colors["color.accent"] ?? "#397461",
      minimum: 3,
      violatedIntent: "The primary action's white label must stay legible on color.accent (WCAG ≥ 3:1).",
    },
    {
      id: "tokens.contrast.body-text",
      token: "color.ink",
      foreground: tokens.colors["color.ink"] ?? "#181c1a",
      background: tokens.colors["color.surface"] ?? "#fbfcf9",
      minimum: 4.5,
      violatedIntent: "Body copy in color.ink must stay legible on color.surface (WCAG ≥ 4.5:1).",
    },
  ];

  for (const check of checks) {
    const ratio = contrastRatio(check.foreground, check.background);
    if (ratio === null || ratio >= check.minimum) continue;
    findings.push({
      id: `${target}.${check.id}`,
      target,
      screenId: "project",
      severity: "error",
      violatedIntent: check.violatedIntent,
      evidence: [
        { kind: "rule", label: "Contrast ratio", value: Number(ratio.toFixed(2)) },
        { kind: "rule", label: "Required minimum", value: check.minimum },
        { kind: "rule", label: "Token", value: check.token },
        { kind: "rule", label: "Token value", value: tokens.colors[check.token] ?? "" },
      ],
      responsibleLayer: "tokens",
      status: "open",
    });
  }
  return findings;
}

export function verifyGraph(
  graph: SemanticInterfaceGraph,
  scenario: VerificationScenario,
): VerificationResult {
  const findings: VerificationFinding[] = [];
  const platform = graph.platforms.find((candidate) => candidate.target === scenario.target);

  if (!platform?.enabled) {
    findings.push({
      id: `${scenario.target}.target.disabled`,
      target: scenario.target,
      screenId: "project",
      severity: "error",
      violatedIntent: `The ${scenario.target} verification target must be enabled before its output can be accepted.`,
      evidence: [{ kind: "rule", label: "Target enabled", value: false }],
      responsibleLayer: "compiler",
      status: "open",
    });
  }

  findings.push(...verifyTokenContrast(graph, scenario.target));
  const accessibility = auditAccessibility(graph, {
    target: scenario.target,
    profiles: scenario.accessibility?.profiles ?? ACCESSIBILITY_PROFILES,
    ...(scenario.accessibility?.suppressions
      ? { suppressions: scenario.accessibility.suppressions }
      : {}),
  });
  findings.push(...accessibility.findings.map((item): VerificationFinding => ({
    id: item.id,
    target: item.target,
    screenId: item.screenId,
    severity: item.severity,
    violatedIntent: item.message,
    evidence: item.evidence,
    responsibleLayer: item.responsibleLayer,
    status: item.status,
    category: "accessibility",
    rule: {
      id: item.ruleId,
      version: item.ruleVersion,
      standard: item.standard,
      profileId: item.profileId,
    },
    ...(item.suppressionReason ? { suppressionReason: item.suppressionReason } : {}),
  })));

  findings.push(...auditDesignQuality(graph, {
    target: scenario.target,
    viewport: scenario.viewport,
    visualState: "idle",
  }).map((item): VerificationFinding => ({
    id: item.id,
    target: item.target,
    screenId: item.screenId,
    severity: item.severity,
    violatedIntent: item.message,
    evidence: [
      ...item.evidence.map((evidence) => ({
        kind: "design-quality" as const,
        label: evidence.label,
        value: evidence.value,
      })),
      { kind: "viewport", label: "Viewport width", value: item.viewport.width },
      { kind: "viewport", label: "Viewport height", value: item.viewport.height },
      { kind: "design-quality", label: "Visual state", value: item.visualState },
    ],
    responsibleLayer: item.category === "spacing" || item.category === "color" || item.category === "components-tokens"
      ? "tokens"
      : "graph",
    status: "open",
    category: "design-quality",
    designQualityCategory: item.category,
    nodeIds: item.nodeIds,
    propertyPaths: item.propertyPaths,
    ...(item.nodeIds[0] ? { nodeId: item.nodeIds[0] } : {}),
    ...(item.propertyPaths[0] ? { propertyPath: item.propertyPaths[0] } : {}),
    deviceProfile: `${scenario.viewport.width}x${scenario.viewport.height}`,
    visualState: item.visualState,
    suggestedRepair: { description: item.suggestedRepair.description },
    subjective: false,
    rule: {
      id: item.ruleId,
      version: item.ruleVersion,
      standard: DESIGN_QUALITY_RULESET.standard,
      profileId: DESIGN_QUALITY_RULESET.profileId,
    },
  })));

  if (scenario.buildStatus === "failed") {
    findings.push({
      id: `${scenario.target}.build.failed`,
      target: scenario.target,
      screenId: "project",
      severity: "error",
      violatedIntent: "Generated output must compile before visual claims are accepted.",
      evidence: [{ kind: "build", label: "Build passed", value: false }],
      responsibleLayer: "compiler",
      status: "open",
      category: "build",
    });
  } else if (scenario.buildStatus === "not-run") {
    findings.push({
      id: `${scenario.target}.build.not-run`,
      target: scenario.target,
      screenId: "project",
      severity: "warning",
      violatedIntent: "Generated output needs current build evidence before verification can pass.",
      evidence: [{ kind: "build", label: "Build status", value: "not run" }],
      responsibleLayer: "compiler",
      status: "open",
      category: "build",
    });
  }

  const deviceClass = classifyDevice(scenario.viewport);
  for (const screen of graph.screens) {
    const screenNodes = flattenSemanticNodes(screen.nodes);
    const primaryAction = screenNodes.find((node) => node.kind === "primary-action");
    const contract = graph.contracts.find((item) => item.screenId === screen.id);
    if (!primaryAction && isTransactionalScreen(screen, contract)) {
      findings.push({
        id: `${scenario.target}.${screen.id}.primary.missing`,
        target: scenario.target,
        screenId: screen.id,
        severity: "error",
        violatedIntent: "Every transactional screen needs one clear primary action.",
        evidence: [{ kind: "rule", label: "Primary actions found", value: 0 }],
        responsibleLayer: "graph",
        status: "open",
      });
      continue;
    }

    if (!primaryAction) continue;

    if (deviceClass === "compact" && primaryAction.layout.placement?.compact !== "persistent-bottom") {
      findings.push({
        id: `${scenario.target}.${screen.id}.primary.compact-reachability`,
        target: scenario.target,
        screenId: screen.id,
        severity: "error",
        violatedIntent: "The primary action must remain persistently reachable on compact screens.",
        evidence: [
          { kind: "viewport", label: "Viewport width", value: scenario.viewport.width },
          { kind: "viewport", label: "Viewport height", value: scenario.viewport.height },
          { kind: "node", label: "Node ID", value: primaryAction.id },
          { kind: "node", label: "Current compact placement", value: primaryAction.layout.placement?.compact ?? "inline" },
          { kind: "node", label: "Expected compact placement", value: "persistent-bottom" },
        ],
        responsibleLayer: "graph",
        status: "open",
      });
    }

    const hasFailureState = screenNodes.some((node) =>
      node.states.some((state) => state.name === "failed"),
    );
    if (contract?.visualStates.includes("failed") && !hasFailureState) {
      findings.push({
        id: `${scenario.target}.${screen.id}.failure-state.missing`,
        target: scenario.target,
        screenId: screen.id,
        severity: "warning",
        violatedIntent: "Declared failure states need visible recovery UI.",
        evidence: [{ kind: "rule", label: "Failure state declared but not represented", value: true }],
        responsibleLayer: "graph",
        status: "open",
      });
    }
  }

  return {
    passed: scenario.buildStatus === "passed"
      && findings.every((finding) => finding.severity !== "error" || finding.status === "suppressed"),
    scenario,
    findings,
  };
}

export function reconcileFindings(
  before: VerificationFinding[],
  after: VerificationFinding[],
): VerificationFinding[] {
  const afterIds = new Set(after.map((finding) => finding.id));
  return before.map((finding) => ({
    ...finding,
    status: afterIds.has(finding.id) ? "open" : "verified",
  }));
}
