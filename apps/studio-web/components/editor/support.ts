import {
  CANONICAL_DEVICE_VIEWPORTS,
  classifyDevice,
  resolveTokenMode,
  setFixtureValue,
  type DeviceClass,
  type SemanticInterfaceGraph,
  type SemanticNode,
} from "@intentform/semantic-schema";

export type EditorTool = "select" | "hand";
export type MobilePanel = "structure" | "inspector" | null;
export type PreviewBreakpoint = DeviceClass;
export type DeviceId = "compact-phone" | "regular-phone" | "regular-tablet";
export type VisualState = "idle" | "loading" | "empty" | "failed" | "completed";
export type RailTab = "layers" | "components" | "assets" | "tokens";
export type NodeCommand = "duplicate" | "delete" | "move-up" | "move-down";

export interface DeviceProfile {
  id: DeviceId;
  label: string;
  detail: string;
  width: number;
  height: number;
  breakpoint: PreviewBreakpoint;
}

const deviceProfile = (
  id: DeviceId,
  label: string,
  viewport: { width: number; height: number },
): DeviceProfile => ({
  id,
  label,
  detail: `${viewport.width} × ${viewport.height}`,
  ...viewport,
  breakpoint: classifyDevice(viewport),
});

export const deviceProfiles: DeviceProfile[] = [
  deviceProfile("compact-phone", "Compact phone", CANONICAL_DEVICE_VIEWPORTS.compactPhone),
  deviceProfile("regular-phone", "Regular phone", CANONICAL_DEVICE_VIEWPORTS.regularPhone),
  deviceProfile("regular-tablet", "Regular tablet", CANONICAL_DEVICE_VIEWPORTS.regularTablet),
];

export const nodeNames: Record<SemanticNode["kind"], string> = {
  "balance-summary": "Balance summary",
  "transaction-list": "Recent activity",
  "money-input": "Money input",
  "recipient-identity": "Recipient",
  "primary-action": "Primary action",
  "secondary-action": "Secondary action",
  "status-message": "Status message",
  "receipt-summary": "Receipt summary",
  stack: "Stack",
  grid: "Grid",
  overlay: "Overlay",
  scroll: "Scroll container",
  "safe-area": "Safe area",
  adaptive: "Adaptive container",
  wrap: "Wrap",
  split: "Split",
  freeform: "Freeform",
  "page-flow": "Page flow",
};

export interface NodePreset {
  kind: SemanticNode["kind"];
  label: string;
  purpose: string;
  importance: "primary" | "secondary" | "supporting";
  live: "off" | "polite";
  description: string;
}

export const nodeCatalog: NodePreset[] = [
  { kind: "primary-action", label: "Continue", purpose: "Advance the current flow", importance: "primary", live: "off", description: "The single dominant action of a screen." },
  { kind: "secondary-action", label: "Not now", purpose: "Offer a non-destructive alternative", importance: "secondary", live: "off", description: "A quiet escape hatch beside the primary action." },
  { kind: "money-input", label: "Amount", purpose: "Capture a currency amount", importance: "primary", live: "off", description: "A currency-aware amount field." },
  { kind: "balance-summary", label: "Available balance", purpose: "Show the spendable balance", importance: "primary", live: "off", description: "A prioritized account balance card." },
  { kind: "transaction-list", label: "Recent activity", purpose: "Show recent account activity", importance: "supporting", live: "off", description: "A short list of recent transactions." },
  { kind: "recipient-identity", label: "Recipient", purpose: "Confirm who receives the payment", importance: "supporting", live: "off", description: "The verified identity of the counterparty." },
  { kind: "status-message", label: "Explain what happened and how to recover.", purpose: "Explain a recoverable state", importance: "supporting", live: "polite", description: "A recoverable status with next steps." },
  { kind: "receipt-summary", label: "Completed", purpose: "Summarize the completed outcome", importance: "supporting", live: "polite", description: "The completion evidence of a flow." },
  { kind: "stack", label: "Stack", purpose: "Arrange related content in one direction", importance: "supporting", live: "off", description: "A vertical or horizontal semantic stack." },
  { kind: "grid", label: "Grid", purpose: "Arrange peer content in deterministic columns", importance: "supporting", live: "off", description: "A responsive semantic grid." },
  { kind: "overlay", label: "Overlay", purpose: "Layer related content in a shared region", importance: "supporting", live: "off", description: "A semantic overlay relation." },
  { kind: "scroll", label: "Scroll", purpose: "Expose overflow content through scrolling", importance: "supporting", live: "off", description: "A bounded scroll relation." },
  { kind: "safe-area", label: "Safe area", purpose: "Keep content clear of platform insets", importance: "supporting", live: "off", description: "A platform-aware safe-area container." },
  { kind: "adaptive", label: "Adaptive", purpose: "Adapt content relations across device classes", importance: "supporting", live: "off", description: "A compact and regular layout switch." },
  { kind: "wrap", label: "Wrap", purpose: "Wrap peer content into available rows", importance: "supporting", live: "off", description: "A wrapping semantic row." },
  { kind: "split", label: "Split", purpose: "Divide available space between related regions", importance: "supporting", live: "off", description: "A proportional semantic split." },
  { kind: "freeform", label: "Freeform", purpose: "Place explicitly positioned semantic children", importance: "supporting", live: "off", description: "An explicit bounded freeform region." },
  { kind: "page-flow", label: "Page flow", purpose: "Arrange content in document reading order", importance: "supporting", live: "off", description: "A document-like page flow." },
];

export function isNodeVisible(node: SemanticNode, visualState: VisualState): boolean {
  if (node.states.length === 0) return true;
  return node.states.some((binding) => binding.name === visualState);
}

export function isFormControl(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable);
}

/* Design-token accessors: the canvas previews bind to the graph's own tokens so
   token edits repaint every frame and reach the semantic diff. */
export function tokenColor(graph: SemanticInterfaceGraph, key: string, fallback: string): string {
  const value = resolveTokenMode(graph.tokens).colors[key];
  return typeof value === "string" && /^#[0-9a-fA-F]{3,8}$/.test(value) ? value : fallback;
}

export function tokenRadius(graph: SemanticInterfaceGraph, key: string, fallback: number): number {
  const value = resolveTokenMode(graph.tokens).radii[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/* The fixture for a screen's visual state, falling back to the idle fixture so
   previews always show plausible product data. */
export function fixtureFor(
  graph: SemanticInterfaceGraph,
  screenId: string,
  state: VisualState,
): Record<string, unknown> {
  return graph.fixtures.find((fixture) => fixture.screenId === screenId && fixture.state === state)?.data
    ?? graph.fixtures.find((fixture) => fixture.screenId === screenId && fixture.state === "idle")?.data
    ?? {};
}

export function withFixtureValue(
  graph: SemanticInterfaceGraph,
  screenId: string,
  state: VisualState,
  fieldName: string,
  value: string | number | boolean,
): SemanticInterfaceGraph {
  return setFixtureValue(graph, screenId, state, fieldName, value);
}

export interface FrameStatus {
  errors: number;
  warnings: number;
}

export const FRAME_GAP = 150;
export const FRAME_HEADER_WORLD = 44;
