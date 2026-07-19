import { flattenSemanticNodes, type SemanticInterfaceGraph, type SemanticNode } from "@intentform/semantic-schema";

/**
 * Runtime parity compares the real rendered web runtime against the semantic
 * intent recorded in the graph — existence, document order, accessible names
 * and roles, WCAG target sizes, horizontal overflow, and compact
 * reachability of persistently placed actions. It deliberately does not
 * grade pixel geometry against the canvas projection: measured bounds are
 * reported as evidence, and canvas-to-runtime layout fidelity remains
 * explicitly ongoing work.
 */

export const PARITY_MESSAGE_TYPE = "intentform-runtime-parity";

/** WCAG 2.2 AA minimum target size (success criterion 2.5.8). */
const MIN_TARGET_SIZE = 24;

const INTERACTIVE_KINDS = new Set(["action", "input", "money-input", "primary-action", "secondary-action"]);
const ACTION_KINDS = new Set(["action", "primary-action", "secondary-action"]);
const INPUT_KINDS = new Set(["input", "money-input"]);
const DECORATIVE_KINDS = new Set(["shape", "divider", "spacer", "image"]);

export interface ParityExpectation {
  id: string;
  kind: string;
  label: string | null;
  orderIndex: number;
  interactive: boolean;
  decorative: boolean;
  persistentCompact: boolean;
}

export interface RuntimeNodeMeasurement {
  id: string;
  order: number;
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
  position: string;
  role: string | null;
  accessibleName: string;
  controlWidth: number;
  controlHeight: number;
  overflowX: boolean;
}

export interface RuntimeParityViewport {
  frameId: string;
  label: string;
  width: number;
  height: number;
}

export interface ParityFinding {
  code:
    | "parity.missing"
    | "parity.hidden"
    | "parity.order"
    | "parity.accessible-name"
    | "parity.role"
    | "parity.target-size"
    | "parity.overflow"
    | "parity.reachability";
  severity: "error" | "warning";
  nodeId: string;
  frameId: string;
  message: string;
  measured?: { x: number; y: number; width: number; height: number };
}

export interface RuntimeParityFrameReport {
  viewport: RuntimeParityViewport;
  comparedNodes: number;
  matchedNodes: number;
  findings: ParityFinding[];
}

export interface RuntimeParityReport {
  screenId: string;
  fingerprint: string;
  completedAt: string;
  frames: RuntimeParityFrameReport[];
}

export function parityExpectations(graph: SemanticInterfaceGraph, screenId: string): ParityExpectation[] {
  const screen = graph.screens.find((candidate) => candidate.id === screenId);
  if (!screen) return [];
  return flattenSemanticNodes(screen.nodes).map((node: SemanticNode, index) => ({
    id: node.id,
    kind: node.kind,
    label: node.intent.label?.trim() || null,
    orderIndex: index,
    interactive: INTERACTIVE_KINDS.has(node.kind),
    decorative: DECORATIVE_KINDS.has(node.kind),
    persistentCompact: node.layout.placement?.compact === "persistent-bottom",
  }));
}

function expectedRole(kind: string): "button" | "textbox" | null {
  if (ACTION_KINDS.has(kind)) return "button";
  if (INPUT_KINDS.has(kind)) return "textbox";
  return null;
}

function round(rect: RuntimeNodeMeasurement): { x: number; y: number; width: number; height: number } {
  return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
}

/** A viewport narrower than the compiled regular breakpoint behaves as compact. */
export function viewportIsCompact(width: number): boolean {
  return width < 768;
}

export function compareRuntimeParity(
  expectations: readonly ParityExpectation[],
  measurements: readonly RuntimeNodeMeasurement[],
  viewport: RuntimeParityViewport,
): RuntimeParityFrameReport {
  const byId = new Map(measurements.map((entry) => [entry.id, entry]));
  const findings: ParityFinding[] = [];
  const flagged = new Set<string>();
  const flag = (finding: ParityFinding) => {
    findings.push(finding);
    flagged.add(finding.nodeId);
  };

  let highestOrder = -1;
  for (const expected of expectations) {
    const measured = byId.get(expected.id);
    if (!measured) {
      flag({
        code: "parity.missing",
        severity: "error",
        nodeId: expected.id,
        frameId: viewport.frameId,
        message: `${expected.kind} node is absent from the rendered document.`,
      });
      continue;
    }
    if (!measured.visible || measured.width <= 0 || measured.height <= 0) {
      flag({
        code: "parity.hidden",
        severity: "error",
        nodeId: expected.id,
        frameId: viewport.frameId,
        message: `${expected.kind} node renders without visible geometry.`,
        measured: round(measured),
      });
      continue;
    }
    if (measured.order < highestOrder) {
      flag({
        code: "parity.order",
        severity: "error",
        nodeId: expected.id,
        frameId: viewport.frameId,
        message: "Rendered document order diverges from the semantic order.",
        measured: round(measured),
      });
    }
    highestOrder = Math.max(highestOrder, measured.order);

    if (expected.label && !expected.decorative) {
      const haystack = measured.accessibleName.toLowerCase();
      if (!haystack.includes(expected.label.toLowerCase())) {
        flag({
          code: "parity.accessible-name",
          severity: "error",
          nodeId: expected.id,
          frameId: viewport.frameId,
          message: `Accessible name does not carry the authored label “${expected.label}”.`,
          measured: round(measured),
        });
      }
    }

    const role = expectedRole(expected.kind);
    if (role && measured.role !== role) {
      flag({
        code: "parity.role",
        severity: "error",
        nodeId: expected.id,
        frameId: viewport.frameId,
        message: `Expected an accessible ${role}; the runtime exposes ${measured.role ?? "no interactive role"}.`,
        measured: round(measured),
      });
    }

    if (expected.interactive && (measured.controlWidth < MIN_TARGET_SIZE || measured.controlHeight < MIN_TARGET_SIZE)) {
      flag({
        code: "parity.target-size",
        severity: "error",
        nodeId: expected.id,
        frameId: viewport.frameId,
        message: `Interactive target measures ${Math.round(measured.controlWidth)}×${Math.round(measured.controlHeight)}px; WCAG 2.2 requires at least ${MIN_TARGET_SIZE}×${MIN_TARGET_SIZE}px.`,
        measured: round(measured),
      });
    }

    if (measured.overflowX) {
      flag({
        code: "parity.overflow",
        severity: "warning",
        nodeId: expected.id,
        frameId: viewport.frameId,
        message: "Content overflows its box horizontally at this width.",
        measured: round(measured),
      });
    }

    if (expected.persistentCompact && viewportIsCompact(viewport.width)) {
      const reachable = measured.position === "fixed" || measured.position === "sticky"
        || measured.y + measured.height <= viewport.height;
      if (!reachable) {
        flag({
          code: "parity.reachability",
          severity: "error",
          nodeId: expected.id,
          frameId: viewport.frameId,
          message: "Intent requires this action to stay reachable on compact screens, but it renders below the fold without persistent positioning.",
          measured: round(measured),
        });
      }
    }
  }

  const comparedNodes = expectations.length;
  return {
    viewport,
    comparedNodes,
    matchedNodes: expectations.filter((expected) => !flagged.has(expected.id)).length,
    findings,
  };
}

/**
 * The probe runs inside the sandboxed srcdoc document (opaque origin), so it
 * reports through postMessage instead of direct DOM access. The nonce binds
 * the response to one specific run.
 */
export function runtimeParityProbeScript(nonce: string, frameId: string): string {
  return `(() => {
  const measure = () => {
    const nodes = [...document.querySelectorAll("[data-node-id]")].map((element, order) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const control = element.querySelector("button, a[href], input, select, textarea");
      const controlRect = control ? control.getBoundingClientRect() : rect;
      const tag = control ? control.tagName.toLowerCase() : null;
      const role = tag === "button" || tag === "a" ? "button"
        : tag === "input" || tag === "select" || tag === "textarea" ? "textbox"
        : null;
      const named = element.querySelector("[aria-label]");
      const accessibleName = ((named && named.getAttribute("aria-label")) || element.textContent || "").trim().slice(0, 240);
      return {
        id: element.getAttribute("data-node-id"),
        order,
        x: rect.x, y: rect.y, width: rect.width, height: rect.height,
        visible: style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0,
        position: style.position,
        role,
        accessibleName,
        controlWidth: controlRect.width,
        controlHeight: controlRect.height,
        overflowX: element.scrollWidth > element.clientWidth + 1,
      };
    });
    parent.postMessage({
      type: ${JSON.stringify(PARITY_MESSAGE_TYPE)},
      nonce: ${JSON.stringify(nonce)},
      frameId: ${JSON.stringify(frameId)},
      viewport: { width: window.innerWidth, height: window.innerHeight },
      measurements: nodes,
    }, "*");
  };
  // No requestAnimationFrame here: browsers throttle rAF inside offscreen
  // iframes, and the static document is fully laid out at load.
  if (document.readyState === "complete") measure();
  else window.addEventListener("load", measure);
})();`;
}

export function injectParityProbe(documentSource: string, nonce: string, frameId: string): string {
  const script = `<script>${runtimeParityProbeScript(nonce, frameId)}</script>`;
  return documentSource.includes("</body>")
    ? documentSource.replace("</body>", `${script}</body>`)
    : `${documentSource}${script}`;
}

export interface ParityProbeMessage {
  type: typeof PARITY_MESSAGE_TYPE;
  nonce: string;
  frameId: string;
  viewport: { width: number; height: number };
  measurements: RuntimeNodeMeasurement[];
}

export function parseParityProbeMessage(data: unknown, nonce: string): ParityProbeMessage | null {
  if (!data || typeof data !== "object") return null;
  const message = data as Partial<ParityProbeMessage>;
  if (message.type !== PARITY_MESSAGE_TYPE || message.nonce !== nonce) return null;
  if (typeof message.frameId !== "string" || !message.viewport || !Array.isArray(message.measurements)) return null;
  if (message.measurements.length > 20_000) return null;
  const valid = message.measurements.every((entry) => entry
    && typeof entry === "object"
    && typeof entry.id === "string"
    && typeof entry.order === "number"
    && Number.isFinite(entry.x) && Number.isFinite(entry.y)
    && Number.isFinite(entry.width) && Number.isFinite(entry.height)
    && typeof entry.visible === "boolean"
    && typeof entry.position === "string"
    && (entry.role === null || entry.role === "button" || entry.role === "textbox")
    && typeof entry.accessibleName === "string"
    && Number.isFinite(entry.controlWidth) && Number.isFinite(entry.controlHeight)
    && typeof entry.overflowX === "boolean");
  return valid ? (message as ParityProbeMessage) : null;
}

export function summarizeParityReport(report: RuntimeParityReport): string {
  const findings = report.frames.flatMap((frame) => frame.findings);
  const matched = Math.min(...report.frames.map((frame) => frame.matchedNodes));
  const compared = report.frames[0]?.comparedNodes ?? 0;
  if (findings.length === 0) return `${compared} nodes matched across ${report.frames.length} frame${report.frames.length === 1 ? "" : "s"}`;
  const byCode = new Map<string, number>();
  for (const finding of findings) byCode.set(finding.code, (byCode.get(finding.code) ?? 0) + 1);
  const parts = [...byCode.entries()].map(([code, count]) => {
    const label = code === "parity.missing" ? "missing"
      : code === "parity.hidden" ? "hidden"
      : code === "parity.order" ? "order"
      : code === "parity.accessible-name" ? "accessible name"
      : code === "parity.role" ? "role"
      : code === "parity.target-size" ? "target size"
      : code === "parity.overflow" ? "overflow"
      : "reachability";
    return `${count} ${label}`;
  });
  return `${matched}/${compared} nodes matched · ${parts.join(" · ")}`;
}
