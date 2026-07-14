import { setFixtureValue, type SemanticInterfaceGraph, type SemanticNode } from "@intentform/semantic-schema";

export type EditorTool = "select" | "hand";
export type MobilePanel = "structure" | "inspector" | null;
export type PreviewBreakpoint = "compact" | "regular";
export type DeviceId = "compact-phone" | "regular-phone" | "regular-tablet";
export type VisualState = "idle" | "loading" | "empty" | "failed" | "completed";
export type RailTab = "layers" | "tokens";
export type NodeCommand = "duplicate" | "delete" | "move-up" | "move-down";

export interface DeviceProfile {
  id: DeviceId;
  label: string;
  detail: string;
  width: number;
  height: number;
  breakpoint: PreviewBreakpoint;
}

export const deviceProfiles: DeviceProfile[] = [
  { id: "compact-phone", label: "Compact phone", detail: "375 × 667", width: 375, height: 667, breakpoint: "compact" },
  { id: "regular-phone", label: "Regular phone", detail: "402 × 874", width: 402, height: 874, breakpoint: "regular" },
  { id: "regular-tablet", label: "Regular tablet", detail: "768 × 1024", width: 768, height: 1024, breakpoint: "regular" },
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
  const value = graph.tokens.colors[key];
  return typeof value === "string" && /^#[0-9a-fA-F]{3,8}$/.test(value) ? value : fallback;
}

export function tokenRadius(graph: SemanticInterfaceGraph, key: string, fallback: number): number {
  const value = graph.tokens.radii[key];
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
