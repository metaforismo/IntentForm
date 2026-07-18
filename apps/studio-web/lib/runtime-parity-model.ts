import { flattenSemanticNodes, type SemanticInterfaceGraph, type SemanticNode } from "@intentform/semantic-schema";

export const RUNTIME_PARITY_LIMITS = {
  nodes: 2_000,
  diagnostics: 200,
  accessibleName: 240,
  coordinate: 1_000_000,
} as const;

export type RuntimeParityTarget = "web" | "react" | "expo" | "swiftui";
export type RuntimeParityStatus = "current" | "stale" | "not-run" | "unavailable";
export type RuntimeParityVerdictKind =
  | "matched"
  | "missing-rendered-node"
  | "unexpected-rendered-node"
  | "hidden-visible-mismatch"
  | "semantic-order-mismatch"
  | "accessible-name-mismatch"
  | "compact-action-unreachable"
  | "target-too-small"
  | "overflow-clipping"
  | "fixed-placement-mismatch"
  | "bounds-divergence"
  | "text-line-divergence"
  | "stale-evidence";

export interface RuntimeParityBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RuntimeParityVerdict {
  kind: RuntimeParityVerdictKind;
  severity: "match" | "warning" | "error";
  message: string;
  propertyPath?: string;
}

export interface RuntimeParityRenderedNode {
  nodeId: string;
  bounds: RuntimeParityBounds;
  visible: boolean;
  accessibleName?: string;
  computedRole?: string;
  semanticOrder: number;
  tabOrder?: number;
  position?: "static" | "relative" | "absolute" | "fixed" | "sticky";
  clipped?: boolean;
  fontMetrics?: { size?: number; lineHeight?: number; lines?: number };
}

export interface RuntimeParityNode {
  screenId: string;
  nodeId: string;
  graphRole: string;
  intended: {
    visible: boolean;
    placement?: string;
    semanticOrder: number;
    accessibleName?: string;
    minimumTarget?: { width: number; height: number };
  };
  rendered?: Omit<RuntimeParityRenderedNode, "nodeId">;
  verdicts: RuntimeParityVerdict[];
}

export interface RuntimeParityDiagnostic {
  code: "duplicate-rendered-node" | "evidence-truncated" | "unexpected-rendered-node" | "stale-evidence" | "unavailable";
  message: string;
  nodeId?: string;
}

export interface RuntimeParityResult {
  graphFingerprint: string;
  compilerFingerprint: string;
  target: RuntimeParityTarget;
  deviceProfile: string;
  visualState: string;
  collectedAt: string;
  status: RuntimeParityStatus;
  nodes: RuntimeParityNode[];
  diagnostics: RuntimeParityDiagnostic[];
}

function finiteCoordinate(value: unknown): number {
  const number = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return Math.max(-RUNTIME_PARITY_LIMITS.coordinate, Math.min(RUNTIME_PARITY_LIMITS.coordinate, number));
}

export function normalizeRenderedParityNodes(input: unknown): RuntimeParityRenderedNode[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, RUNTIME_PARITY_LIMITS.nodes).flatMap((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const candidate = value as Record<string, unknown>;
    if (typeof candidate.nodeId !== "string" || candidate.nodeId.length < 1 || candidate.nodeId.length > 240) return [];
    const rawBounds = candidate.bounds && typeof candidate.bounds === "object" && !Array.isArray(candidate.bounds)
      ? candidate.bounds as Record<string, unknown>
      : {};
    const position = ["static", "relative", "absolute", "fixed", "sticky"].includes(String(candidate.position))
      ? candidate.position as RuntimeParityRenderedNode["position"]
      : undefined;
    const accessibleName = typeof candidate.accessibleName === "string"
      ? candidate.accessibleName.slice(0, RUNTIME_PARITY_LIMITS.accessibleName)
      : undefined;
    const computedRole = typeof candidate.computedRole === "string" ? candidate.computedRole.slice(0, 80) : undefined;
    const font = candidate.fontMetrics && typeof candidate.fontMetrics === "object" && !Array.isArray(candidate.fontMetrics)
      ? candidate.fontMetrics as Record<string, unknown>
      : undefined;
    return [{
      nodeId: candidate.nodeId,
      bounds: {
        x: finiteCoordinate(rawBounds.x),
        y: finiteCoordinate(rawBounds.y),
        width: Math.max(0, finiteCoordinate(rawBounds.width)),
        height: Math.max(0, finiteCoordinate(rawBounds.height)),
      },
      visible: candidate.visible === true,
      semanticOrder: Number.isInteger(candidate.semanticOrder) ? Math.max(0, Number(candidate.semanticOrder)) : index,
      ...(Number.isInteger(candidate.tabOrder) ? { tabOrder: Math.max(-1, Number(candidate.tabOrder)) } : {}),
      ...(accessibleName ? { accessibleName } : {}),
      ...(computedRole ? { computedRole } : {}),
      ...(position ? { position } : {}),
      ...(candidate.clipped === true ? { clipped: true } : {}),
      ...(font ? { fontMetrics: {
        ...(typeof font.size === "number" ? { size: finiteCoordinate(font.size) } : {}),
        ...(typeof font.lineHeight === "number" ? { lineHeight: finiteCoordinate(font.lineHeight) } : {}),
        ...(Number.isInteger(font.lines) ? { lines: Math.max(0, Number(font.lines)) } : {}),
      } } : {}),
    }];
  });
}

function isInteractive(node: SemanticNode): boolean {
  return ["action", "primary-action", "secondary-action", "input", "money-input"].includes(node.kind);
}

function intendedPlacement(node: SemanticNode, deviceClass: "compact" | "regular"): string | undefined {
  return node.layout.placement?.[deviceClass];
}

function intendedNode(screenId: string, node: SemanticNode, semanticOrder: number, deviceClass: "compact" | "regular", visualState: string): RuntimeParityNode {
  const minimumWidth = Math.max(node.layout.minWidth ?? 0, isInteractive(node) ? 44 : 0);
  const minimumHeight = Math.max(node.layout.minHeight ?? 0, isInteractive(node) ? 44 : 0);
  const placement = intendedPlacement(node, deviceClass);
  const accessibleName = ["shape", "divider", "spacer"].includes(node.kind)
    ? undefined
    : node.accessibility.label || node.intent.label;
  return {
    screenId,
    nodeId: node.id,
    graphRole: node.style.role,
    intended: {
      visible: node.states.length === 0 || node.states.some((state) => state.name === visualState && !state.visibleWhen),
      semanticOrder,
      ...(placement ? { placement } : {}),
      ...(accessibleName ? { accessibleName } : {}),
      ...(minimumWidth || minimumHeight ? { minimumTarget: { width: minimumWidth, height: minimumHeight } } : {}),
    },
    verdicts: [],
  };
}

function compareNode(intended: RuntimeParityNode, rendered: RuntimeParityRenderedNode | undefined): RuntimeParityNode {
  if (!rendered) return {
    ...intended,
    verdicts: [{ kind: "missing-rendered-node", severity: "error", message: "The semantic node is missing from the rendered runtime." }],
  };
  const verdicts: RuntimeParityVerdict[] = [];
  if (intended.intended.visible !== rendered.visible) verdicts.push({ kind: "hidden-visible-mismatch", severity: "error", message: "Authored visibility and runtime visibility disagree.", propertyPath: "visibility" });
  if (intended.intended.semanticOrder !== rendered.semanticOrder) verdicts.push({ kind: "semantic-order-mismatch", severity: "warning", message: `Expected semantic order ${intended.intended.semanticOrder + 1}; rendered ${rendered.semanticOrder + 1}.`, propertyPath: "children" });
  if (intended.intended.accessibleName && rendered.accessibleName !== intended.intended.accessibleName) verdicts.push({ kind: "accessible-name-mismatch", severity: "error", message: "The runtime accessible name differs from authored intent.", propertyPath: "accessibility.label" });
  const minimum = intended.intended.minimumTarget;
  if (minimum && rendered.visible && (rendered.bounds.width < minimum.width || rendered.bounds.height < minimum.height)) verdicts.push({ kind: "target-too-small", severity: "error", message: `Rendered target is ${Math.round(rendered.bounds.width)}×${Math.round(rendered.bounds.height)}; intent requires at least ${minimum.width}×${minimum.height}.`, propertyPath: "layout.minWidth" });
  if (rendered.clipped) verdicts.push({ kind: "overflow-clipping", severity: "error", message: "The rendered node is clipped by a runtime ancestor.", propertyPath: "layout.overflow" });
  const expectsPersistent = intended.intended.placement === "persistent-bottom";
  const renderedPersistent = rendered.position === "fixed" || rendered.position === "sticky";
  if (expectsPersistent !== renderedPersistent && intended.intended.placement) verdicts.push({ kind: "fixed-placement-mismatch", severity: "warning", message: expectsPersistent ? "Authored persistent placement is not fixed or sticky at runtime." : "Runtime placement is fixed or sticky without matching authored intent.", propertyPath: "layout.compactPlacement" });
  if (verdicts.length === 0) verdicts.push({ kind: "matched", severity: "match", message: "Runtime semantics match the authored node." });
  const { nodeId: _nodeId, ...renderedEvidence } = rendered;
  return { ...intended, rendered: renderedEvidence, verdicts };
}

export function compareRuntimeParity(input: {
  graph: SemanticInterfaceGraph;
  screenId: string;
  graphFingerprint: string;
  evidenceGraphFingerprint: string;
  compilerFingerprint: string;
  evidenceCompilerFingerprint: string;
  target: RuntimeParityTarget;
  deviceProfile: string;
  visualState: string;
  deviceClass: "compact" | "regular";
  collectedAt: string;
  renderedNodes: unknown;
}): RuntimeParityResult {
  const screen = input.graph.screens.find((candidate) => candidate.id === input.screenId);
  if (!screen) return { graphFingerprint: input.graphFingerprint, compilerFingerprint: input.compilerFingerprint, target: input.target, deviceProfile: input.deviceProfile, visualState: input.visualState, collectedAt: input.collectedAt, status: "unavailable", nodes: [], diagnostics: [{ code: "unavailable", message: "The selected screen is not present in the current graph." }] };
  const rendered = normalizeRenderedParityNodes(input.renderedNodes);
  const renderedById = new Map<string, RuntimeParityRenderedNode>();
  const duplicateIds = new Set<string>();
  for (const node of rendered) {
    if (renderedById.has(node.nodeId)) duplicateIds.add(node.nodeId);
    else renderedById.set(node.nodeId, node);
  }
  const allSemanticNodes = flattenSemanticNodes(screen.nodes);
  const semanticNodes = allSemanticNodes.slice(0, RUNTIME_PARITY_LIMITS.nodes);
  const nodes = semanticNodes.map((node, index) => compareNode(intendedNode(screen.id, node, index, input.deviceClass, input.visualState), renderedById.get(node.id)));
  const semanticIds = new Set(semanticNodes.map((node) => node.id));
  const diagnostics: RuntimeParityDiagnostic[] = [...duplicateIds].sort().map((nodeId) => ({ code: "duplicate-rendered-node" as const, nodeId, message: "The runtime emitted the same stable node ID more than once." }));
  diagnostics.push(...rendered
    .filter((node) => !semanticIds.has(node.nodeId))
    .slice(0, RUNTIME_PARITY_LIMITS.diagnostics)
    .map((node) => ({ code: "unexpected-rendered-node" as const, nodeId: node.nodeId, message: "A runtime node has no matching semantic node in the selected screen." })));
  const truncated = semanticNodes.length < allSemanticNodes.length || (Array.isArray(input.renderedNodes) && input.renderedNodes.length > RUNTIME_PARITY_LIMITS.nodes);
  if (truncated) diagnostics.unshift({ code: "evidence-truncated", message: `Parity evidence exceeded the ${RUNTIME_PARITY_LIMITS.nodes}-node bound and cannot pass.` });
  const stale = input.graphFingerprint !== input.evidenceGraphFingerprint || input.compilerFingerprint !== input.evidenceCompilerFingerprint;
  if (stale) {
    diagnostics.unshift({ code: "stale-evidence", message: "Runtime evidence was collected for an older graph fingerprint." });
    for (const node of nodes) node.verdicts.unshift({ kind: "stale-evidence", severity: "error", message: "This node result is stale and cannot pass." });
  }
  return { graphFingerprint: input.evidenceGraphFingerprint, compilerFingerprint: input.evidenceCompilerFingerprint, target: input.target, deviceProfile: input.deviceProfile, visualState: input.visualState, collectedAt: input.collectedAt, status: stale ? "stale" : truncated || duplicateIds.size > 0 ? "unavailable" : "current", nodes, diagnostics: diagnostics.slice(0, RUNTIME_PARITY_LIMITS.diagnostics) };
}

export function runtimeParitySummary(result: RuntimeParityResult): { matched: number; warnings: number; errors: number } {
  let matched = 0;
  let warnings = 0;
  let errors = 0;
  for (const node of result.nodes) {
    if (node.verdicts.some((verdict) => verdict.severity === "error")) errors += 1;
    else if (node.verdicts.some((verdict) => verdict.severity === "warning")) warnings += 1;
    else matched += 1;
  }
  return { matched, warnings, errors };
}
