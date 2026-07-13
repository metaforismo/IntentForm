import type { PlatformTarget, SemanticInterfaceGraph } from "@intentform/semantic-schema";

export interface Evidence {
  kind: "viewport" | "node" | "build" | "rule" | "screenshot" | "bounds";
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
  graphExpectsPersistent: boolean;
}

export function verifyRenderedPrimaryAction(
  observation: RenderObservation,
): VerificationFinding[] {
  const compact = observation.viewport.width <= 390 || observation.viewport.height <= 700;
  if (!compact) return [];

  const findings: VerificationFinding[] = [];
  const persistent = observation.position === "fixed" || observation.position === "sticky";
  const actionBottom = observation.primaryAction.y + observation.primaryAction.height;
  const insideViewport = observation.primaryAction.x >= 0
    && observation.primaryAction.y >= 0
    && observation.primaryAction.x + observation.primaryAction.width <= observation.viewport.width
    && actionBottom <= observation.viewport.height;

  if (!persistent) {
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
      responsibleLayer: observation.graphExpectsPersistent ? "compiler" : "graph",
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
      responsibleLayer: observation.graphExpectsPersistent ? "compiler" : "graph",
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
  buildPassed: boolean;
}

export interface VerificationResult {
  passed: boolean;
  scenario: VerificationScenario;
  findings: VerificationFinding[];
}

export function verifyGraph(
  graph: SemanticInterfaceGraph,
  scenario: VerificationScenario,
): VerificationResult {
  const findings: VerificationFinding[] = [];

  if (!scenario.buildPassed) {
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
  }

  const compact = scenario.viewport.height <= 700 || scenario.viewport.width <= 390;
  for (const screen of graph.screens) {
    const primaryAction = screen.nodes.find((node) => node.kind === "primary-action");
    if (!primaryAction) {
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

    if (compact && primaryAction.layout.placement?.compact !== "persistent-bottom") {
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
    const contract = graph.contracts.find((item) => item.screenId === screen.id);
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

  return { passed: findings.every((finding) => finding.severity !== "error"), scenario, findings };
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
