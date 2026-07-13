import type { PlatformTarget, SemanticInterfaceGraph } from "@intentform/semantic-schema";

export interface Evidence {
  kind: "viewport" | "node" | "build" | "rule";
  label: string;
  value: string | number | boolean;
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
