import { compileWeb } from "@intentform/compiler-web";
import { compareLayoutEvidence, computeNeutralLayout, type LayoutBoundsEvidence } from "@intentform/layout-engine";
import { flattenSemanticNodes, type SemanticInterfaceGraph } from "@intentform/semantic-schema";

export interface WebVerificationFinding {
  severity: "error" | "warning";
  code: string;
  path: string;
  message: string;
}

export interface WebVerificationScenario {
  id: string;
  width: number;
  height: number;
  activeBreakpoints: string[];
}

export interface WebVerificationResult {
  passed: boolean;
  fingerprint: string | null;
  scenarios: WebVerificationScenario[];
  findings: WebVerificationFinding[];
}

export interface BrowserLayoutVerificationResult {
  passed: boolean;
  screenId: string;
  scenarioId: string;
  tolerance: number;
  findings: WebVerificationFinding[];
}

export function verifyBrowserLayoutEvidence(
  graph: SemanticInterfaceGraph,
  screenId: string,
  scenarioId: string,
  evidence: readonly LayoutBoundsEvidence[],
  tolerance = 2,
): BrowserLayoutVerificationResult {
  const screen = graph.screens.find((candidate) => candidate.id === screenId);
  const frame = graph.web?.frames.find((candidate) => candidate.id === scenarioId);
  if (!screen || !frame) {
    const missing = !screen ? `screen ${screenId}` : `browser frame ${scenarioId}`;
    return { passed: false, screenId, scenarioId, tolerance, findings: [{ severity: "error", code: "web.layout.scenario-missing", path: missing, message: `Cannot compare browser layout because ${missing} does not exist.` }] };
  }
  const width = frame.width ?? frame.maxWidth ?? frame.minWidth ?? graph.web?.contentMaxWidth ?? 1;
  const expected = computeNeutralLayout(screen, graph, { width, height: frame.height });
  const findings = compareLayoutEvidence(expected, evidence, tolerance).map((divergence): WebVerificationFinding => ({
    severity: "error",
    code: divergence.code.replace("layout.browser", "web.layout"),
    path: `screens.${screenId}.nodes.${divergence.id}`,
    message: divergence.code === "layout.browser.diverged"
      ? `Browser bounds diverge from the neutral layout by ${divergence.maximumDelta.toFixed(2)}px (tolerance ${tolerance}px).`
      : divergence.code === "layout.browser.missing"
        ? "Expected semantic node is missing from browser layout evidence."
        : "Browser layout evidence contains an unexpected semantic node.",
  }));
  return { passed: findings.length === 0, screenId, scenarioId, tolerance, findings };
}

export function verifyResponsiveWeb(graph: SemanticInterfaceGraph): WebVerificationResult {
  const findings: WebVerificationFinding[] = [];
  const target = graph.platforms.find((candidate) => candidate.target === "web");
  if (!target?.enabled) {
    findings.push({ severity: "error", code: "web.target.disabled", path: "platforms", message: "Responsive-web verification requires the web target" });
  }
  if (!graph.web) {
    findings.push({ severity: "error", code: "web.profile.missing", path: "web", message: "Responsive-web verification requires a web profile" });
    return { passed: false, fingerprint: null, scenarios: [], findings };
  }

  const scenarios = graph.web.frames.map((frame) => {
    const width = frame.width ?? frame.maxWidth ?? frame.minWidth ?? graph.web!.contentMaxWidth;
    return {
      id: frame.id,
      width,
      height: frame.height,
      activeBreakpoints: graph.web!.breakpoints
        .filter((breakpoint) => width >= breakpoint.minWidth && (breakpoint.maxWidth === undefined || width <= breakpoint.maxWidth))
        .map((breakpoint) => breakpoint.id),
    };
  });

  for (const scenario of scenarios) {
    if (scenario.activeBreakpoints.length === 0) {
      findings.push({ severity: "warning", code: "web.frame.uncovered", path: `web.frames.${scenario.id}`, message: `Frame width ${scenario.width}px is not covered by a declared breakpoint` });
    }
  }

  for (const [fixtureIndex, fixture] of graph.fixtures.entries()) {
    for (const [field, value] of Object.entries(fixture.data)) {
      if (typeof value !== "string") continue;
      const path = `fixtures.${fixtureIndex}.data.${field}`;
      if (value.length > 160) {
        findings.push({ severity: "warning", code: "web.content.long", path, message: `Fixture text is ${value.length} characters; verify wrapping and localized expansion in every web frame` });
      }
      if (/\S{48,}/u.test(value)) {
        findings.push({ severity: "warning", code: "web.content.unbroken", path, message: "Fixture text contains an unbroken segment of 48 or more characters; verify overflow and word breaking" });
      }
    }
  }

  for (const [screenIndex, screen] of graph.screens.entries()) {
    const nodes = flattenSemanticNodes(screen.nodes);
    for (const scenario of scenarios) {
      const fixed = nodes.filter((node) => {
        const breakpoint = scenario.activeBreakpoints[0];
        const position = (breakpoint ? node.web?.breakpointOverrides[breakpoint]?.position : undefined) ?? node.web?.position;
        return position === "fixed";
      });
      if (fixed.length > 1) {
        findings.push({ severity: "warning", code: "web.fixed.multiple", path: `screens.${screenIndex}.nodes`, message: `Screen ${screen.id} contains ${fixed.length} fixed regions in frame ${scenario.id}; verify overlap and reading order` });
      }
      for (const node of fixed) {
        if (node.accessibility.live !== "off") {
          findings.push({ severity: "warning", code: "web.fixed.live", path: `screens.${screenIndex}.nodes.${node.id}.web.position`, message: `A fixed live region can obscure content when it updates in frame ${scenario.id}` });
        }
      }
    }
  }

  let fingerprint: string | null = null;
  try {
    const output = compileWeb(graph);
    fingerprint = output.fingerprint;
    for (const diagnostic of output.diagnostics) {
      findings.push({ severity: diagnostic.severity, code: "web.compiler.diagnostic", path: diagnostic.path, message: diagnostic.message });
    }
  } catch (error) {
    findings.push({ severity: "error", code: "web.compiler.failed", path: "compiler.web", message: error instanceof Error ? error.message : "Responsive-web compilation failed" });
  }

  findings.sort((left, right) => left.path.localeCompare(right.path) || left.code.localeCompare(right.code));
  return { passed: !findings.some((finding) => finding.severity === "error"), fingerprint, scenarios, findings };
}
