import {
  classifyDevice,
  isTransactionalScreen,
  type PlatformTarget,
  type SemanticInterfaceGraph,
} from "@intentform/semantic-schema";

export interface Evidence {
  kind: "viewport" | "node" | "build" | "rule" | "screenshot" | "bounds" | "accessibility";
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
  status: "open" | "repaired" | "verified";
}

export interface VerificationScenario {
  target: PlatformTarget;
  viewport: { width: number; height: number };
  buildStatus: "passed" | "failed" | "not-run";
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

/* Token-layer rules (WCAG 2.1): the primary action renders white text on
   color.accent (≥ 3:1 for large text / UI components), and body copy renders
   color.ink on color.surface (≥ 4.5:1). */
function verifyTokenContrast(
  graph: SemanticInterfaceGraph,
  target: PlatformTarget,
): VerificationFinding[] {
  const findings: VerificationFinding[] = [];
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
      background: graph.tokens.colors["color.accent"] ?? "#397461",
      minimum: 3,
      violatedIntent: "The primary action's white label must stay legible on color.accent (WCAG ≥ 3:1).",
    },
    {
      id: "tokens.contrast.body-text",
      token: "color.ink",
      foreground: graph.tokens.colors["color.ink"] ?? "#181c1a",
      background: graph.tokens.colors["color.surface"] ?? "#fbfcf9",
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
        { kind: "rule", label: "Token value", value: graph.tokens.colors[check.token] ?? "" },
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
    });
  }

  const deviceClass = classifyDevice(scenario.viewport);
  for (const screen of graph.screens) {
    const primaryAction = screen.nodes.find((node) => node.kind === "primary-action");
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

    const hasFailureState = screen.nodes.some((node) =>
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
      && findings.every((finding) => finding.severity !== "error"),
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
