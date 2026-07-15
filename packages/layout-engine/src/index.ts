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
  baseline: number;
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

export interface IntrinsicMeasurement {
  width: number;
  height: number;
  baseline: number;
}

export interface LayoutMeasurementProvider {
  measure(node: SemanticNode, maximumWidth: number): IntrinsicMeasurement;
}

export interface NeutralLayoutOptions {
  measurement?: LayoutMeasurementProvider;
}

export interface LayoutBoundsEvidence {
  id: string;
  frame: LayoutFrame;
}

export interface LayoutDivergence {
  id: string;
  code: "layout.browser.missing" | "layout.browser.unexpected" | "layout.browser.diverged";
  maximumDelta: number;
  expected?: LayoutFrame;
  actual?: LayoutFrame;
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

const intrinsicProfiles: Partial<Record<SemanticNode["kind"], {
  fontSize: number;
  lineHeight: number;
  horizontalInset: number;
  verticalInset: number;
  minimumWidth: number;
  minimumHeight: number;
}>> = {
  text: { fontSize: 14, lineHeight: 20, horizontalInset: 0, verticalInset: 0, minimumWidth: 1, minimumHeight: 20 },
  "balance-summary": { fontSize: 15, lineHeight: 22, horizontalInset: 24, verticalInset: 24, minimumWidth: 180, minimumHeight: 96 },
  "transaction-list": { fontSize: 15, lineHeight: 22, horizontalInset: 0, verticalInset: 12, minimumWidth: 180, minimumHeight: 72 },
  "money-input": { fontSize: 18, lineHeight: 26, horizontalInset: 20, verticalInset: 20, minimumWidth: 160, minimumHeight: 66 },
  "recipient-identity": { fontSize: 15, lineHeight: 22, horizontalInset: 14, verticalInset: 14, minimumWidth: 160, minimumHeight: 56 },
  "primary-action": { fontSize: 15, lineHeight: 22, horizontalInset: 20, verticalInset: 14, minimumWidth: 120, minimumHeight: 48 },
  "secondary-action": { fontSize: 15, lineHeight: 22, horizontalInset: 18, verticalInset: 12, minimumWidth: 112, minimumHeight: 44 },
  "status-message": { fontSize: 14, lineHeight: 20, horizontalInset: 16, verticalInset: 14, minimumWidth: 120, minimumHeight: 48 },
  "receipt-summary": { fontSize: 15, lineHeight: 22, horizontalInset: 24, verticalInset: 24, minimumWidth: 180, minimumHeight: 96 },
  image: { fontSize: 12, lineHeight: 18, horizontalInset: 12, verticalInset: 12, minimumWidth: 160, minimumHeight: 112 },
  shape: { fontSize: 12, lineHeight: 18, horizontalInset: 0, verticalInset: 0, minimumWidth: 64, minimumHeight: 64 },
};

function estimatedTextWidth(text: string, fontSize: number): number {
  let units = 0;
  for (const character of Array.from(text)) {
    if (/\s/u.test(character)) units += 0.34;
    else if (/\p{Script=Han}|\p{Extended_Pictographic}/u.test(character)) units += 1;
    else if (/[A-ZMW@#%]/u.test(character)) units += 0.72;
    else units += 0.54;
  }
  return units * fontSize;
}

export const deterministicMeasurement: LayoutMeasurementProvider = {
  measure(node, maximumWidth) {
    const profile = intrinsicProfiles[node.kind] ?? { fontSize: 14, lineHeight: 20, horizontalInset: 8, verticalInset: 8, minimumWidth: 64, minimumHeight: 36 };
    const label = node.intent.label ?? node.intent.purpose;
    const contentMaximum = Math.max(1, maximumWidth - profile.horizontalInset * 2);
    const explicitLines = label.split("\n");
    const measuredWidth = explicitLines.reduce((maximum, line) => Math.max(maximum, estimatedTextWidth(line, profile.fontSize)), 0);
    const wrappedLines = explicitLines.reduce((count, line) => count + Math.max(1, Math.ceil(estimatedTextWidth(line, profile.fontSize) / contentMaximum)), 0);
    const width = Math.min(maximumWidth, Math.max(profile.minimumWidth, measuredWidth + profile.horizontalInset * 2));
    const height = Math.max(profile.minimumHeight, wrappedLines * profile.lineHeight + profile.verticalInset * 2);
    return { width, height, baseline: profile.verticalInset + profile.lineHeight * 0.8 };
  },
};

function clamp(value: number, minimum: number | undefined, maximum: number | undefined): number {
  return Math.max(minimum ?? 0, Math.min(maximum ?? Number.POSITIVE_INFINITY, value));
}

function resolvedWidth(node: SemanticNode, available: number, intrinsic: number): number {
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
  measurement: LayoutMeasurementProvider;
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
  forcedSize: { width?: number; height?: number } = {},
): NeutralLayoutNode {
  const mode = resolvedContainerMode(node, context.viewport);
  const initialMeasurement = mode === "leaf"
    ? context.measurement.measure(node, available.width)
    : { width: available.width, height: 0, baseline: 0 };
  const width = forcedSize.width === undefined
    ? resolvedWidth(node, available.width, initialMeasurement.width)
    : clamp(forcedSize.width, node.layout.minWidth, node.layout.maxWidth);
  const leafMeasurement = mode === "leaf"
    ? context.measurement.measure(node, width)
    : initialMeasurement;
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
      const placements: Array<{ child: NeutralLayoutNode; row: number; span: number }> = [];
      node.children.forEach((child, index) => {
        const column = Math.min(columns - 1, Math.max(0, (child.layout.gridColumn?.start ?? index % columns + 1) - 1));
        const span = Math.min(columns - column, child.layout.gridColumn?.span ?? 1);
        const row = Math.max(0, (child.layout.gridRow?.start ?? Math.floor(index / columns) + 1) - 1);
        const rowSpan = child.layout.gridRow?.span ?? 1;
        const cellWidth = widths.slice(column, column + span).reduce((sum, value) => sum + value, 0) + gap * (span - 1);
        const laidOut = layoutNode(child, { x: contentX + offsets[column]!, y: contentY }, { width: cellWidth, height: available.height }, depth + 1, context);
        const contribution = Math.max(0, (laidOut.frame.height - gap * (rowSpan - 1)) / rowSpan);
        for (let offset = 0; offset < rowSpan; offset += 1) {
          rowHeights[row + offset] = Math.max(rowHeights[row + offset] ?? 0, contribution);
        }
        placements.push({ child: laidOut, row, span: rowSpan });
        children.push(laidOut);
      });
      const explicitRows = node.layout.gridRows;
      if (explicitRows && (node.layout.height === "fixed" || node.layout.height === "fill")) {
        const totalWeight = explicitRows.reduce((sum, track) => sum + track, 0);
        const parentHeight = node.layout.height === "fixed" ? node.layout.fixedHeight ?? available.height : available.height;
        const availableRows = Math.max(0, parentHeight - paddingBySide.top - paddingBySide.bottom - safeArea.top - safeArea.bottom - gap * (explicitRows.length - 1));
        explicitRows.forEach((track, index) => { rowHeights[index] = availableRows * track / totalWeight; });
      }
      for (const placement of placements) {
        const y = contentY + rowHeights.slice(0, placement.row).reduce((sum, value) => sum + value, 0) + gap * placement.row;
        translateLayoutTree(placement.child, 0, y - placement.child.frame.y);
      }
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
    } else if (mode === "wrap") {
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
      const horizontal = node.layout.axis === "horizontal";
      const preliminary = node.children.map((child) => layoutNode(
        child,
        { x: contentX, y: contentY },
        { width: contentWidth, height: available.height },
        depth + 1,
        context,
      ));
      const bases = preliminary.map((child, index) => {
        const semantic = node.children[index]!;
        return semantic.layout.flexBasis ?? (horizontal ? child.frame.width : child.frame.height);
      });
      const definiteMain = horizontal
        ? contentWidth
        : node.layout.height === "fixed"
          ? Math.max(0, (node.layout.fixedHeight ?? available.height) - paddingBySide.top - paddingBySide.bottom - safeArea.top - safeArea.bottom)
          : node.layout.height === "fill"
            ? Math.max(0, available.height - paddingBySide.top - paddingBySide.bottom - safeArea.top - safeArea.bottom)
            : undefined;
      const occupied = bases.reduce((sum, value) => sum + value, 0) + gap * Math.max(0, bases.length - 1);
      const free = definiteMain === undefined ? 0 : definiteMain - occupied;
      const factors = node.children.map((child) => free >= 0
        ? child.layout.flexGrow ?? (horizontal && child.layout.width === "fill" ? 1 : !horizontal && child.layout.height === "fill" ? 1 : 0)
        : child.layout.flexShrink ?? 1);
      const factorTotal = factors.reduce((sum, value) => sum + value, 0);
      let cursor = horizontal ? contentX : contentY;
      node.children.forEach((child, index) => {
        const base = bases[index]!;
        const delta = factorTotal > 0 ? free * factors[index]! / factorTotal : 0;
        const main = Math.max(0, base + delta);
        const laidOut = layoutNode(
          child,
          horizontal ? { x: cursor, y: contentY } : { x: contentX, y: cursor },
          { width: contentWidth, height: available.height },
          depth + 1,
          context,
          horizontal ? { width: main } : { height: main },
        );
        children.push(laidOut);
        cursor += (horizontal ? laidOut.frame.width : laidOut.frame.height) + gap;
      });
    }
  }

  const childrenBottom = children.reduce((maximum, child) => Math.max(maximum, child.frame.y + child.frame.height), contentY);
  const intrinsic = mode === "leaf"
    ? leafMeasurement.height
    : Math.max(0, childrenBottom - origin.y) + paddingBySide.bottom + safeArea.bottom;
  const height = forcedSize.height === undefined
    ? resolvedHeight(node, available.height, Math.max(intrinsic, mode === "leaf" ? 1 : paddingBySide.top + paddingBySide.bottom + safeArea.top + safeArea.bottom))
    : clamp(forcedSize.height, node.layout.minHeight, node.layout.maxHeight);

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
      const maximumBaseline = horizontal && node.layout.align === "baseline"
        ? Math.max(...children.map((candidate) => candidate.baseline))
        : 0;
      const cross = horizontal && node.layout.align === "baseline"
        ? maximumBaseline - child.baseline
        : alignmentOffset(
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
    baseline: mode === "leaf"
      ? Math.min(height, leafMeasurement.baseline)
      : Math.min(height, (children[0]?.frame.y ?? origin.y) - origin.y + (children[0]?.baseline ?? 0)),
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
  options: NeutralLayoutOptions = {},
): NeutralScreenLayout {
  const byId = new Map<string, NeutralLayoutNode>();
  const spacing = resolveTokenMode(graph.tokens).spacing;
  const roots: NeutralLayoutNode[] = [];
  let cursorY = 0;
  for (const root of screen.nodes) {
    const laidOut = layoutNode(root, { x: 0, y: cursorY }, viewport, 1, {
      spacing,
      viewport,
      byId,
      measurement: options.measurement ?? deterministicMeasurement,
    });
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

export function compareLayoutEvidence(
  layout: NeutralScreenLayout,
  evidence: readonly LayoutBoundsEvidence[],
  tolerance = 2,
): LayoutDivergence[] {
  const actual = new Map(evidence.map((item) => [item.id, item.frame]));
  const divergences: LayoutDivergence[] = [];
  for (const [id, node] of layout.byId) {
    const frame = actual.get(id);
    if (!frame) {
      divergences.push({ id, code: "layout.browser.missing", maximumDelta: Number.POSITIVE_INFINITY, expected: node.frame });
      continue;
    }
    actual.delete(id);
    const maximumDelta = Math.max(
      Math.abs(node.frame.x - frame.x),
      Math.abs(node.frame.y - frame.y),
      Math.abs(node.frame.width - frame.width),
      Math.abs(node.frame.height - frame.height),
    );
    if (maximumDelta > tolerance) {
      divergences.push({ id, code: "layout.browser.diverged", maximumDelta, expected: node.frame, actual: frame });
    }
  }
  for (const [id, frame] of actual) {
    divergences.push({ id, code: "layout.browser.unexpected", maximumDelta: Number.POSITIVE_INFINITY, actual: frame });
  }
  return divergences.sort((left, right) => left.id.localeCompare(right.id) || left.code.localeCompare(right.code));
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
