import {
  GRAPH_LIMITS,
  findGraphNodeLocation,
  flattenGraphNodes,
  flattenSemanticNodes,
  isContainerNode,
  semanticNodeSchema,
  type SemanticInterfaceGraph,
  type SemanticNode,
} from "@intentform/semantic-schema";
import { applyEditorTransaction } from "./transactions";

export const NODE_CLIPBOARD_MIME = "application/x-intentform-nodes+json";
export const STYLE_CLIPBOARD_MIME = "application/x-intentform-style+json";
export const CLIPBOARD_PAYLOAD_LIMIT = 2_000_000;

export interface NodeClipboardPayload {
  format: "intentform/nodes";
  version: 1;
  nodes: SemanticNode[];
}

export interface StyleClipboardPayload {
  format: "intentform/style";
  version: 1;
  source: SemanticNode;
}

export interface ClipboardDiagnostic {
  code: "clipboard.html.styles-ignored" | "clipboard.html.empty";
  message: string;
}

export type PasteMode = "after" | "in-place" | "replace";

function operationRoots(graph: SemanticInterfaceGraph, screenId: string, nodeIds: readonly string[]): SemanticNode[] {
  const requested = new Set(nodeIds);
  const screen = graph.screens.find((candidate) => candidate.id === screenId);
  if (!screen) return [];
  return flattenSemanticNodes(screen.nodes)
    .filter((node) => requested.has(node.id))
    .filter((node) => {
      let parent = findGraphNodeLocation(graph, node.id)?.parent ?? null;
      while (parent) {
        if (requested.has(parent.id)) return false;
        parent = findGraphNodeLocation(graph, parent.id)?.parent ?? null;
      }
      return true;
    });
}

function assertPayloadSize(serialized: string): void {
  if (new TextEncoder().encode(serialized).byteLength > CLIPBOARD_PAYLOAD_LIMIT) {
    throw new Error(`Clipboard payload exceeds ${CLIPBOARD_PAYLOAD_LIMIT} bytes`);
  }
}

export function createNodeClipboardPayload(
  graph: SemanticInterfaceGraph,
  screenId: string,
  nodeIds: readonly string[],
): NodeClipboardPayload {
  const nodes = operationRoots(graph, screenId, nodeIds).map((node) => structuredClone(node));
  if (nodes.length === 0) throw new Error("At least one existing layer must be selected");
  const payload: NodeClipboardPayload = { format: "intentform/nodes", version: 1, nodes };
  assertPayloadSize(JSON.stringify(payload));
  return payload;
}

export function createStyleClipboardPayload(node: SemanticNode): StyleClipboardPayload {
  return { format: "intentform/style", version: 1, source: structuredClone(node) };
}

export function serializeClipboardPayload(payload: NodeClipboardPayload | StyleClipboardPayload): string {
  const serialized = JSON.stringify(payload);
  assertPayloadSize(serialized);
  return serialized;
}

function parsePayload(raw: string): unknown {
  assertPayloadSize(raw);
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Clipboard payload is not valid JSON");
  }
}

export function parseNodeClipboardPayload(raw: string): NodeClipboardPayload {
  const value = parsePayload(raw);
  if (!value || typeof value !== "object" || (value as { format?: unknown }).format !== "intentform/nodes"
    || (value as { version?: unknown }).version !== 1 || !Array.isArray((value as { nodes?: unknown }).nodes)) {
    throw new Error("Clipboard data is not an IntentForm node payload");
  }
  const nodes = (value as { nodes: unknown[] }).nodes.map((node) => semanticNodeSchema.parse(node));
  if (nodes.length === 0 || nodes.length > GRAPH_LIMITS.maxNodesPerScreen) {
    throw new Error("Clipboard node count is outside the supported range");
  }
  return { format: "intentform/nodes", version: 1, nodes };
}

export function parseStyleClipboardPayload(raw: string): StyleClipboardPayload {
  const value = parsePayload(raw);
  if (!value || typeof value !== "object" || (value as { format?: unknown }).format !== "intentform/style"
    || (value as { version?: unknown }).version !== 1) {
    throw new Error("Clipboard data is not an IntentForm style payload");
  }
  return {
    format: "intentform/style",
    version: 1,
    source: semanticNodeSchema.parse((value as { source?: unknown }).source),
  };
}

function allocateId(existing: Set<string>, baseId: string): string {
  if (!existing.has(baseId)) {
    existing.add(baseId);
    return baseId;
  }
  for (let index = 1; index < 10_000; index += 1) {
    const suffix = index === 1 ? "-copy" : `-copy-${index}`;
    const stem = baseId.slice(0, GRAPH_LIMITS.maxIdLength - suffix.length).replace(/[.-]+$/, "");
    const candidate = `${stem}${suffix}`;
    if (!existing.has(candidate)) {
      existing.add(candidate);
      return candidate;
    }
  }
  throw new Error(`Could not allocate a pasted layer id for ${baseId}`);
}

function clipboardNodes(node: SemanticNode): SemanticNode[] {
  return [node, ...node.children.flatMap(clipboardNodes), ...Object.values(node.componentInstance?.slots ?? {}).flatMap((nodes) => nodes.flatMap(clipboardNodes))];
}

function remapClipboardNodes(nodes: readonly SemanticNode[], existing: Set<string>, offset: boolean): { nodes: SemanticNode[]; rootIds: string[] } {
  const idMap = new Map<string, string>();
  for (const node of nodes.flatMap(clipboardNodes)) idMap.set(node.id, allocateId(existing, node.id));
  const remap = (node: SemanticNode, root: boolean): SemanticNode => {
    const copy = structuredClone(node);
    copy.id = idMap.get(node.id)!;
    copy.provenance = { author: "human", revision: 0 };
    if (root && offset && copy.layout.position) {
      copy.layout.position.x += 16;
      copy.layout.position.y += 16;
    }
    copy.children = node.children.map((child) => remap(child, false));
    if (copy.componentInstance) {
      copy.componentInstance.overrides = copy.componentInstance.overrides.map((override) => ({
        ...override,
        target: idMap.get(override.target) ?? override.target,
      }));
      copy.componentInstance.slots = Object.fromEntries(Object.entries(copy.componentInstance.slots)
        .map(([slot, children]) => [slot, children.map((child) => remap(child, false))]));
    }
    return copy;
  };
  const remapped = nodes.map((node) => remap(node, true));
  return { nodes: remapped, rootIds: remapped.map((node) => node.id) };
}

function assertMutableDestination(graph: SemanticInterfaceGraph, node: SemanticNode | null): void {
  let current = node;
  while (current) {
    if (current.editor?.locked) throw new Error(`Locked layer cannot receive pasted content: ${current.id}`);
    if (current.editor?.hidden) throw new Error(`Hidden layer cannot receive pasted content: ${current.id}`);
    current = findGraphNodeLocation(graph, current.id)?.parent ?? null;
  }
}

export function pasteNodesTransaction(
  graph: SemanticInterfaceGraph,
  screenId: string,
  selectedNodeIds: readonly string[],
  payload: NodeClipboardPayload,
  mode: PasteMode,
): { graph: SemanticInterfaceGraph; nodeIds: string[] } {
  const selected = operationRoots(graph, screenId, selectedNodeIds);
  const selectedLocations = selected.map((node) => findGraphNodeLocation(graph, node.id)!);
  const selectedContainer = selected.length === 1 && isContainerNode(selected[0]!) ? selected[0]! : null;
  const firstLocation = selectedLocations[0];
  const parent = selectedContainer && mode !== "replace" ? selectedContainer : firstLocation?.parent ?? null;
  assertMutableDestination(graph, parent);
  if (mode === "replace") {
    if (selectedLocations.length === 0) throw new Error("Paste to replace requires a selection");
    if (selectedLocations.some((location) => location.siblings !== firstLocation!.siblings)) {
      throw new Error("Paste to replace requires layers with one shared parent");
    }
    for (const location of selectedLocations) assertMutableDestination(graph, location.node);
  }

  const existing = new Set(flattenGraphNodes(graph).map((node) => node.id));
  const remapped = remapClipboardNodes(payload.nodes, existing, mode === "after");
  const nextGraph = applyEditorTransaction(graph, (draft) => {
    const screen = draft.screens.find((candidate) => candidate.id === screenId);
    if (!screen) throw new Error(`Screen not found: ${screenId}`);
    const draftParent = parent ? findGraphNodeLocation(draft, parent.id)?.node ?? null : null;
    const siblings = draftParent?.children ?? screen.nodes;
    let index = selectedContainer && mode !== "replace"
      ? siblings.length
      : firstLocation ? firstLocation.index + 1 : siblings.length;
    if (mode === "replace") {
      index = firstLocation!.index;
      const selectedSet = new Set(selected.map((node) => node.id));
      for (let cursor = siblings.length - 1; cursor >= 0; cursor -= 1) {
        if (selectedSet.has(siblings[cursor]!.id)) siblings.splice(cursor, 1);
      }
    }
    siblings.splice(Math.min(index, siblings.length), 0, ...remapped.nodes);
  });
  return { graph: nextGraph, nodeIds: remapped.rootIds };
}

export function pasteStyleTransaction(
  graph: SemanticInterfaceGraph,
  nodeIds: readonly string[],
  payload: StyleClipboardPayload,
): SemanticInterfaceGraph {
  if (nodeIds.length === 0) throw new Error("Paste styles requires a selection");
  return applyEditorTransaction(graph, (draft) => {
    for (const nodeId of nodeIds) {
      const location = findGraphNodeLocation(draft, nodeId);
      if (!location) throw new Error(`Layer not found: ${nodeId}`);
      assertMutableDestination(draft, location.node);
      location.node.style = structuredClone(payload.source.style);
      if (payload.source.web) location.node.web = structuredClone(payload.source.web);
      else delete location.node.web;
      for (const field of ["axis", "align", "justify", "overflow", "gapToken", "paddingToken"] as const) {
        location.node.layout[field] = payload.source.layout[field] as never;
      }
      location.node.provenance = { author: "human", revision: location.node.provenance.revision + 1 };
    }
  });
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = { amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"' };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const hexadecimal = entity[1]?.toLowerCase() === "x";
      const point = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      const scalar = Number.isFinite(point) && point <= 0x10ffff && (point < 0xd800 || point > 0xdfff);
      return scalar ? String.fromCodePoint(point) : match;
    }
    return named[entity.toLowerCase()] ?? match;
  });
}

export function plainTextFromHtml(html: string): { text: string; diagnostics: ClipboardDiagnostic[] } {
  const text = decodeHtmlEntities(html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?(?:<\/\1>|$)/gi, "")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(?:div|h[1-6]|li|p|section)>/gi, "\n")
    .replace(/<[^>]+>/g, ""))
    .replace(/\r/g, "")
    .replace(/[\t ]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text) return { text: "", diagnostics: [{ code: "clipboard.html.empty", message: "The HTML fragment contained no editable text." }] };
  return {
    text,
    diagnostics: [{ code: "clipboard.html.styles-ignored", message: "Pasted HTML as safe text; unsupported markup and styles were ignored." }],
  };
}
