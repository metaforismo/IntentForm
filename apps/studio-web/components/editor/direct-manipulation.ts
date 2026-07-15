import {
  findSemanticNode,
  findGraphNodeLocation,
  flattenSemanticNodes,
  type SemanticInterfaceGraph,
  type SemanticNode,
} from "@intentform/semantic-schema";

export const DIRECT_MANIPULATION_GRID = 8;
export const DIRECT_MANIPULATION_SNAP_TOLERANCE = 5;

export type SelectionIntent = "replace" | "toggle" | "range";
export type ResizeHandle = "east" | "south" | "southeast";

export interface AxisItem {
  id: string;
  start: number;
  end: number;
}

export interface ReorderCandidate {
  orderedIds: string[];
  insertionIndex: number;
  guide: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface FreeformMoveCandidate {
  positions: Record<string, Point>;
  snappedX: boolean;
  snappedY: boolean;
}

export interface ResizeCandidate {
  width: number;
  height: number;
}

export interface SpatialEntry {
  id: string;
  parentId: string | null;
  depth: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ReconciledGraphSelection {
  screenId: string;
  nodeId: string | null;
}

function unique(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

/** Retains nested selections across undo/redo and falls back only when the
 * selected semantic node no longer exists in the reconciled graph. */
export function reconcileGraphSelection(
  graph: Pick<SemanticInterfaceGraph, "screens">,
  screenId: string,
  nodeId: string | null,
): ReconciledGraphSelection {
  const screen = graph.screens.find((candidate) => candidate.id === screenId) ?? graph.screens[0];
  if (!screen) return { screenId: "", nodeId: null };
  return {
    screenId: screen.id,
    nodeId: nodeId && findSemanticNode(screen.nodes, nodeId) ? nodeId : screen.nodes[0]?.id ?? null,
  };
}

/** Selection is kept in semantic preorder so copy/group/delete operations are
 * deterministic even when pointer events arrive from nested DOM wrappers. */
export function updateNodeSelection(
  current: readonly string[],
  target: string,
  preorder: readonly string[],
  intent: SelectionIntent,
): string[] {
  if (intent === "replace") return [target];
  if (intent === "toggle") {
    return current.includes(target)
      ? current.filter((id) => id !== target)
      : preorder.filter((id) => current.includes(id) || id === target);
  }

  const anchor = current.at(-1);
  const anchorIndex = anchor ? preorder.indexOf(anchor) : -1;
  const targetIndex = preorder.indexOf(target);
  if (anchorIndex < 0 || targetIndex < 0) return [target];
  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  return preorder.slice(start, end + 1);
}

/** Removes missing nodes and descendants whose ancestor is already selected.
 * This prevents one transaction from operating on the same subtree twice. */
export function normalizeNodeSelection(
  graph: Pick<SemanticInterfaceGraph, "screens">,
  screenId: string,
  ids: readonly string[],
): string[] {
  const screen = graph.screens.find((candidate) => candidate.id === screenId);
  if (!screen) return [];
  const requested = new Set(unique(ids));
  return flattenSemanticNodes(screen.nodes)
    .filter((node) => requested.has(node.id))
    .filter((node) => {
      let parent = findGraphNodeLocation(graph, node.id)?.parent ?? null;
      while (parent) {
        if (requested.has(parent.id)) return false;
        parent = findGraphNodeLocation(graph, parent.id)?.parent ?? null;
      }
      return true;
    })
    .map((node) => node.id);
}

export function selectionParentId(
  graph: Pick<SemanticInterfaceGraph, "screens">,
  ids: readonly string[],
): string | null | undefined {
  const locations = ids.map((id) => findGraphNodeLocation(graph, id));
  if (locations.some((location) => !location)) return undefined;
  const first = locations[0]?.parent?.id ?? null;
  return locations.every((location) => (location?.parent?.id ?? null) === first) ? first : undefined;
}

export function selectionAxis(parent: SemanticNode | null): "horizontal" | "vertical" {
  return parent?.layout.axis === "horizontal" ? "horizontal" : "vertical";
}

/** Returns the exact final sibling order represented by the insertion guide. */
export function resolveReorderCandidate(
  items: readonly AxisItem[],
  selectedIds: readonly string[],
  pointer: number,
): ReorderCandidate {
  const selected = new Set(selectedIds);
  const moving = items.filter((item) => selected.has(item.id));
  const remaining = items.filter((item) => !selected.has(item.id));
  if (moving.length === 0) {
    return {
      orderedIds: items.map((item) => item.id),
      insertionIndex: 0,
      guide: items[0]?.start ?? 0,
    };
  }

  let insertionIndex = remaining.findIndex((item) => pointer < (item.start + item.end) / 2);
  if (insertionIndex < 0) insertionIndex = remaining.length;
  const guide = insertionIndex < remaining.length
    ? remaining[insertionIndex]!.start
    : remaining.at(-1)?.end ?? moving[0]!.start;
  const orderedIds = remaining.map((item) => item.id);
  orderedIds.splice(insertionIndex, 0, ...moving.map((item) => item.id));
  return { orderedIds, insertionIndex, guide };
}

function nearestSnap(value: number, guides: readonly number[]): { value: number; guide: boolean } {
  let best = Math.round(value / DIRECT_MANIPULATION_GRID) * DIRECT_MANIPULATION_GRID;
  let distance = Math.abs(best - value);
  let guide = false;
  for (const candidate of guides) {
    const candidateDistance = Math.abs(candidate - value);
    if (candidateDistance <= DIRECT_MANIPULATION_SNAP_TOLERANCE && candidateDistance <= distance) {
      best = candidate;
      distance = candidateDistance;
      guide = true;
    }
  }
  return { value: best, guide };
}

export function resolveFreeformMove(
  initial: Readonly<Record<string, Point>>,
  delta: Point,
  guides: { x?: readonly number[]; y?: readonly number[] } = {},
): FreeformMoveCandidate {
  const anchor = Object.values(initial)[0] ?? { x: 0, y: 0 };
  const x = nearestSnap(anchor.x + delta.x, guides.x ?? []);
  const y = nearestSnap(anchor.y + delta.y, guides.y ?? []);
  const snappedDelta = { x: x.value - anchor.x, y: y.value - anchor.y };
  return {
    positions: Object.fromEntries(Object.entries(initial).map(([id, point]) => [id, {
      x: Math.max(0, point.x + snappedDelta.x),
      y: Math.max(0, point.y + snappedDelta.y),
    }])),
    snappedX: x.guide,
    snappedY: y.guide,
  };
}

function snappedDimension(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.round(value / DIRECT_MANIPULATION_GRID) * DIRECT_MANIPULATION_GRID));
}

export function resolveResizeCandidate(
  start: { width: number; height: number },
  delta: Point,
  handle: ResizeHandle,
  options: { minimum?: number; maximum?: number; preserveAspect?: boolean } = {},
): ResizeCandidate {
  const minimum = options.minimum ?? 24;
  const maximum = options.maximum ?? 2_048;
  let width = start.width + (handle === "south" ? 0 : delta.x);
  let height = start.height + (handle === "east" ? 0 : delta.y);
  if (options.preserveAspect && handle === "southeast") {
    const ratio = start.width / Math.max(1, start.height);
    if (Math.abs(delta.x) >= Math.abs(delta.y)) height = width / ratio;
    else width = height * ratio;
  }
  return {
    width: handle === "south" ? start.width : snappedDimension(width, minimum, maximum),
    height: handle === "east" ? start.height : snappedDimension(height, minimum, maximum),
  };
}

/** A deliberately simple O(n) index is the correctness baseline. PR29 can
 * replace its internals with an R-tree without changing hit-test semantics. */
export class SpatialIndex {
  readonly #entries: SpatialEntry[];

  constructor(entries: readonly SpatialEntry[]) {
    this.#entries = [...entries];
  }

  at(point: Point): SpatialEntry[] {
    return this.#entries
      .filter((entry) => point.x >= entry.x && point.x <= entry.x + entry.width
        && point.y >= entry.y && point.y <= entry.y + entry.height)
      .sort((a, b) => b.depth - a.depth
        || a.width * a.height - b.width * b.height
        || a.id.localeCompare(b.id));
  }
}
