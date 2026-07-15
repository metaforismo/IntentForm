import {
  classifyDevice,
  flattenSemanticNodes,
  isContainerNode,
  resolveTokenMode,
  walkSemanticNodes,
  type ContainerNodeKind,
  type ScreenDefinition,
  type SemanticInterfaceGraph,
  type SemanticNode,
} from "@intentform/semantic-schema";

export interface NodeLocation {
  node: SemanticNode;
  parentId: string | null;
  depth: number;
  indexPath: number[];
}

export interface LayoutFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NeutralLayoutNode {
  id: string;
  kind: SemanticNode["kind"];
  mode: ContainerNodeKind | "leaf";
  depth: number;
  frame: LayoutFrame;
  scrollable: boolean;
  clipped: boolean;
  children: NeutralLayoutNode[];
}

export interface NeutralScreenLayout {
  viewport: LayoutViewport;
  contentHeight: number;
  roots: NeutralLayoutNode[];
  byId: Map<string, NeutralLayoutNode>;
}

export interface LayoutViewport {
  width: number;
  height: number;
  safeArea?: { top: number; right: number; bottom: number; left: number };
}

export function buildNodeIndex(roots: readonly SemanticNode[]): Map<string, NodeLocation> {
  const index = new Map<string, NodeLocation>();
  walkSemanticNodes(roots, ({ node, parent, depth, indexPath }) => {
    index.set(node.id, { node, parentId: parent?.id ?? null, depth, indexPath });
  });
  return index;
}

export function resolvedContainerMode(
  node: SemanticNode,
  viewport: { width: number; height: number },
): ContainerNodeKind | "leaf" {
  if (!isContainerNode(node)) return "leaf";
  if (node.kind !== "adaptive") return node.kind;
  const device = classifyDevice(viewport);
  return node.layout.adaptive?.[device] ?? "stack";
}

const leafHeight: Record<string, number> = {
  "balance-summary": 132,
  "transaction-list": 150,
  "money-input": 92,
  "recipient-identity": 76,
  "primary-action": 56,
  "secondary-action": 52,
  "status-message": 72,
  "receipt-summary": 148,
};

function clamp(value: number, minimum: number | undefined, maximum: number | undefined): number {
  return Math.max(minimum ?? 0, Math.min(maximum ?? Number.POSITIVE_INFINITY, value));
}

function resolvedWidth(node: SemanticNode, available: number): number {
  const intrinsic = isContainerNode(node) ? available : Math.min(available, 280);
  const candidate = node.layout.width === "fixed"
    ? node.layout.fixedWidth ?? available
    : node.layout.width === "fill"
      ? available
      : intrinsic;
  return clamp(candidate, node.layout.minWidth, node.layout.maxWidth);
}

function resolvedHeight(node: SemanticNode, available: number, intrinsic: number): number {
  const candidate = node.layout.height === "fixed"
    ? node.layout.fixedHeight ?? intrinsic
    : node.layout.height === "fill"
      ? available
      : intrinsic;
  return clamp(candidate, node.layout.minHeight, node.layout.maxHeight);
}

interface LayoutContext {
  spacing: Record<string, number>;
  viewport: LayoutViewport;
  byId: Map<string, NeutralLayoutNode>;
}

function translateLayoutTree(node: NeutralLayoutNode, x: number, y: number): void {
  node.frame.x += x;
  node.frame.y += y;
  for (const child of node.children) translateLayoutTree(child, x, y);
}

function alignmentOffset(align: SemanticNode["layout"]["align"], available: number, size: number): number {
  const remaining = Math.max(0, available - size);
  if (align === "center") return remaining / 2;
  if (align === "end") return remaining;
  return 0;
}

function justifyOffsets(
  justify: SemanticNode["layout"]["justify"],
  available: number,
  used: number,
  childCount: number,
): { leading: number; between: number } {
  const remaining = Math.max(0, available - used);
  if (justify === "center") return { leading: remaining / 2, between: 0 };
  if (justify === "end") return { leading: remaining, between: 0 };
  if (justify === "space-between" && childCount > 1) {
    return { leading: 0, between: remaining / (childCount - 1) };
  }
  return { leading: 0, between: 0 };
}

function layoutNode(
  node: SemanticNode,
  origin: { x: number; y: number },
  available: { width: number; height: number },
  depth: number,
  context: LayoutContext,
): NeutralLayoutNode {
  const mode = resolvedContainerMode(node, context.viewport);
  const width = resolvedWidth(node, available.width);
  const padding = context.spacing[node.layout.paddingToken] ?? 0;
  const paddingBySide = node.layout.paddingTokens ? {
    top: context.spacing[node.layout.paddingTokens.top] ?? 0,
    right: context.spacing[node.layout.paddingTokens.right] ?? 0,
    bottom: context.spacing[node.layout.paddingTokens.bottom] ?? 0,
    left: context.spacing[node.layout.paddingTokens.left] ?? 0,
  } : { top: padding, right: padding, bottom: padding, left: padding };
  const gap = node.layout.gap ?? context.spacing[node.layout.gapToken] ?? 0;
  const safeArea = mode === "safe-area"
    ? context.viewport.safeArea ?? { top: 16, right: 0, bottom: 24, left: 0 }
    : { top: 0, right: 0, bottom: 0, left: 0 };
  const contentX = origin.x + paddingBySide.left + safeArea.left;
  const contentY = origin.y + paddingBySide.top + safeArea.top;
  const contentWidth = Math.max(0, width - paddingBySide.left - paddingBySide.right - safeArea.left - safeArea.right);
  const children: NeutralLayoutNode[] = [];

  if (mode !== "leaf") {
    if (mode === "grid") {
      const tracks = node.layout.gridTracks ?? Array.from({ length: Math.max(1, node.layout.columns) }, () => 1);
      const columns = tracks.length;
      const totalWeight = tracks.reduce((sum, track) => sum + track, 0);
      const availableTrackWidth = Math.max(0, contentWidth - gap * (columns - 1));
      const widths = tracks.map((track) => availableTrackWidth * track / totalWeight);
      const offsets = widths.map((_, index) => widths.slice(0, index).reduce((sum, value) => sum + value, 0) + gap * index);
      const rowHeights: number[] = [];
      node.children.forEach((child, index) => {
        const column = Math.min(columns - 1, Math.max(0, (child.layout.gridColumn?.start ?? index % columns + 1) - 1));
        const span = Math.min(columns - column, child.layout.gridColumn?.span ?? 1);
        const row = Math.floor(index / columns);
        const y = contentY + rowHeights.slice(0, row).reduce((sum, height) => sum + height + gap, 0);
        const cellWidth = widths.slice(column, column + span).reduce((sum, value) => sum + value, 0) + gap * (span - 1);
        const laidOut = layoutNode(child, { x: contentX + offsets[column]!, y }, { width: cellWidth, height: available.height }, depth + 1, context);
        rowHeights[row] = Math.max(rowHeights[row] ?? 0, laidOut.frame.height);
        children.push(laidOut);
      });
    } else if (mode === "overlay") {
      for (const child of node.children) {
        children.push(layoutNode(child, { x: contentX, y: contentY }, { width: contentWidth, height: available.height }, depth + 1, context));
      }
    } else if (mode === "split") {
      const horizontal = node.layout.axis !== "vertical";
      const firstShare = node.layout.splitRatio;
      let cursor = 0;
      node.children.forEach((child, index) => {
        const share = node.children.length === 2
          ? (index === 0 ? firstShare : 1 - firstShare)
          : 1 / Math.max(1, node.children.length);
        const childWidth = horizontal ? Math.max(0, contentWidth * share - gap / 2) : contentWidth;
        const childHeight = horizontal ? available.height : Math.max(0, available.height * share - gap / 2);
        const laidOut = layoutNode(
          child,
          { x: contentX + (horizontal ? cursor : 0), y: contentY + (horizontal ? 0 : cursor) },
          { width: childWidth, height: childHeight },
          depth + 1,
          context,
        );
        cursor += (horizontal ? childWidth : childHeight) + gap;
        children.push(laidOut);
      });
    } else if (mode === "freeform") {
      for (const child of node.children) {
        const position = child.layout.position ?? { x: 0, y: 0, z: 0 };
        children.push(layoutNode(child, { x: contentX + position.x, y: contentY + position.y }, { width: contentWidth, height: available.height }, depth + 1, context));
      }
      children.sort((left, right) => {
        const leftNode = node.children.find((child) => child.id === left.id);
        const rightNode = node.children.find((child) => child.id === right.id);
        return (leftNode?.layout.position?.z ?? 0) - (rightNode?.layout.position?.z ?? 0)
          || left.id.localeCompare(right.id);
      });
    } else if (node.layout.axis === "horizontal" || mode === "wrap") {
      const columns = mode === "wrap"
        ? Math.max(1, Math.min(node.children.length || 1, node.layout.columns))
        : Math.max(1, node.children.length);
      const cellWidth = Math.max(0, (contentWidth - gap * (columns - 1)) / columns);
      let cursorX = contentX;
      let cursorY = contentY;
      let rowHeight = 0;
      node.children.forEach((child, index) => {
        if (mode === "wrap" && index > 0 && index % columns === 0) {
          cursorX = contentX;
          cursorY += rowHeight + gap;
          rowHeight = 0;
        }
        const laidOut = layoutNode(child, { x: cursorX, y: cursorY }, { width: cellWidth, height: available.height }, depth + 1, context);
        children.push(laidOut);
        cursorX += cellWidth + gap;
        rowHeight = Math.max(rowHeight, laidOut.frame.height);
      });
    } else {
      let cursorY = contentY;
      for (const child of node.children) {
        const laidOut = layoutNode(child, { x: contentX, y: cursorY }, { width: contentWidth, height: available.height }, depth + 1, context);
        children.push(laidOut);
        cursorY += laidOut.frame.height + gap;
      }
    }
  }

  const childrenBottom = children.reduce((maximum, child) => Math.max(maximum, child.frame.y + child.frame.height), contentY);
  const intrinsic = mode === "leaf"
    ? leafHeight[node.kind] ?? 64
    : Math.max(0, childrenBottom - origin.y) + paddingBySide.bottom + safeArea.bottom;
  const height = resolvedHeight(node, available.height, Math.max(intrinsic, mode === "leaf" ? 1 : paddingBySide.top + paddingBySide.bottom + safeArea.top + safeArea.bottom));

  const isLinear = mode === "stack" || mode === "page-flow" || mode === "safe-area" || mode === "scroll";
  if (isLinear && children.length > 0) {
    const horizontal = node.layout.axis === "horizontal";
    const innerWidth = Math.max(0, width - paddingBySide.left - paddingBySide.right - safeArea.left - safeArea.right);
    const innerHeight = Math.max(0, height - paddingBySide.top - paddingBySide.bottom - safeArea.top - safeArea.bottom);
    const first = children[0]!;
    const last = children.at(-1)!;
    const used = horizontal
      ? last.frame.x + last.frame.width - first.frame.x
      : last.frame.y + last.frame.height - first.frame.y;
    const main = justifyOffsets(
      node.layout.justify,
      horizontal ? innerWidth : innerHeight,
      used,
      children.length,
    );
    children.forEach((child, index) => {
      const cross = alignmentOffset(
        node.layout.align,
        horizontal ? innerHeight : innerWidth,
        horizontal ? child.frame.height : child.frame.width,
      );
      translateLayoutTree(
        child,
        horizontal ? main.leading + main.between * index : cross,
        horizontal ? cross : main.leading + main.between * index,
      );
    });
  }

  const result: NeutralLayoutNode = {
    id: node.id,
    kind: node.kind,
    mode,
    depth,
    frame: { x: origin.x, y: origin.y, width, height },
    scrollable: mode === "scroll" || node.layout.overflow === "scroll",
    clipped: node.layout.overflow === "clip",
    children,
  };
  context.byId.set(node.id, result);
  return result;
}

export function computeNeutralLayout(
  screen: Pick<ScreenDefinition, "nodes">,
  graph: Pick<SemanticInterfaceGraph, "tokens">,
  viewport: LayoutViewport,
): NeutralScreenLayout {
  const byId = new Map<string, NeutralLayoutNode>();
  const spacing = resolveTokenMode(graph.tokens).spacing;
  const roots: NeutralLayoutNode[] = [];
  let cursorY = 0;
  for (const root of screen.nodes) {
    const laidOut = layoutNode(root, { x: 0, y: cursorY }, viewport, 1, { spacing, viewport, byId });
    roots.push(laidOut);
    cursorY += laidOut.frame.height + 16;
  }
  return {
    viewport,
    contentHeight: Math.max(viewport.height, Math.max(0, cursorY - 16)),
    roots,
    byId,
  };
}

export function layoutCoverage(roots: readonly SemanticNode[]): {
  nodeCount: number;
  maxDepth: number;
  containerKinds: ContainerNodeKind[];
} {
  let maxDepth = 0;
  const kinds = new Set<ContainerNodeKind>();
  walkSemanticNodes(roots, ({ node, depth }) => {
    maxDepth = Math.max(maxDepth, depth);
    if (isContainerNode(node)) kinds.add(node.kind);
  });
  return {
    nodeCount: flattenSemanticNodes(roots).length,
    maxDepth,
    containerKinds: [...kinds].sort(),
  };
}
