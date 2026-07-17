"use client";

import { Check } from "@phosphor-icons/react";
import { resolvedContainerMode } from "@intentform/layout-engine";
import {
  isContainerNode,
  resolveTokenMode,
  type SemanticInterfaceGraph,
  type SemanticNode,
} from "@intentform/semantic-schema";
import type { CSSProperties } from "react";
import { isNodeVisible, tokenColor, tokenRadius, type VisualState } from "./support";
import type { SelectionIntent } from "./direct-manipulation";
import { nodeAppearanceStyle } from "./appearance";

function formatMoney(value: unknown, fallback: string): string {
  const amount = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  if (!Number.isFinite(amount)) return fallback;
  const [integer, decimals = "00"] = Math.abs(amount).toFixed(2).split(".");
  return `${amount < 0 ? "−" : ""}€${integer!.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${decimals}`;
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "–";
}

function Skeleton({ className }: { className: string }) {
  return <span aria-hidden="true" className={`skeleton-block block ${className}`} />;
}

interface NodePreviewProps {
  node: SemanticNode;
  graph: SemanticInterfaceGraph;
  fixture?: Record<string, unknown>;
  state?: VisualState;
  viewport?: { width: number; height: number; presentation?: "device" | "browser" | "content" };
  selectedNodeId?: string | null;
  selectedNodeIds?: readonly string[];
  hoveredNodeId?: string | null;
  onSelectNode?(nodeId: string, intent: SelectionIntent): void;
}

interface PreviewWebStyle {
  display?: CSSProperties["display"] | undefined;
  flexDirection?: CSSProperties["flexDirection"] | undefined;
  flexWrap?: CSSProperties["flexWrap"] | undefined;
  gridTemplateColumns?: CSSProperties["gridTemplateColumns"] | undefined;
  position?: CSSProperties["position"] | undefined;
  insetBlockStart?: CSSProperties["insetBlockStart"] | undefined;
  overflowX?: CSSProperties["overflowX"] | undefined;
  overflowY?: CSSProperties["overflowY"] | undefined;
  aspectRatio?: CSSProperties["aspectRatio"] | undefined;
  containerType?: CSSProperties["containerType"] | undefined;
}

function previewWebStyle(node: SemanticNode, graph?: SemanticInterfaceGraph, viewport?: { width: number; height: number; presentation?: "device" | "browser" | "content" }): PreviewWebStyle {
  if (!node.web || !graph?.web || !viewport || viewport.presentation === "device") return {};
  const breakpoint = graph.web.breakpoints.find((candidate) => viewport.width >= candidate.minWidth && (candidate.maxWidth === undefined || viewport.width <= candidate.maxWidth));
  const style = { ...node.web, ...(breakpoint ? node.web.breakpointOverrides[breakpoint.id] : {}) };
  return {
    display: style.display,
    flexDirection: style.display === "flex" ? style.direction : undefined,
    flexWrap: style.display === "flex" ? style.wrap : undefined,
    gridTemplateColumns: style.display === "grid" ? `repeat(auto-fit, minmax(min(100%, ${style.gridMinColumnWidth}px), 1fr))` : undefined,
    position: style.position,
    insetBlockStart: style.insetBlockStart,
    overflowX: style.overflowX,
    overflowY: style.overflowY,
    aspectRatio: style.aspectRatio,
    containerType: style.containerType,
  };
}

export function semanticNodeBoxStyle(node: SemanticNode, graph?: SemanticInterfaceGraph, viewport?: { width: number; height: number; presentation?: "device" | "browser" | "content" }) {
  return {
    width: node.layout.width === "fixed" ? node.layout.fixedWidth : node.layout.width === "fill" ? "100%" : "fit-content",
    height: node.layout.height === "fixed" ? node.layout.fixedHeight : undefined,
    minWidth: node.layout.minWidth,
    maxWidth: node.layout.maxWidth,
    minHeight: node.layout.minHeight,
    maxHeight: node.layout.maxHeight,
    alignSelf: node.layout.align === "start" ? "flex-start" : node.layout.align === "end" ? "flex-end" : node.layout.align,
    flexGrow: node.layout.flexGrow,
    flexShrink: node.layout.flexShrink,
    flexBasis: node.layout.flexBasis,
    gridColumn: node.layout.gridColumn ? `${node.layout.gridColumn.start} / span ${node.layout.gridColumn.span}` : undefined,
    gridRow: node.layout.gridRow ? `${node.layout.gridRow.start} / span ${node.layout.gridRow.span}` : undefined,
    overflow: node.layout.overflow === "clip" ? "hidden" : node.layout.overflow === "scroll" ? "auto" : "visible",
    ...previewWebStyle(node, graph, viewport),
    ...(graph ? nodeAppearanceStyle(node, graph) : {}),
  };
}

/* Renders one semantic node at realistic mobile proportions. Colors and radii
   come from the graph's design tokens; the content comes from the screen's
   fixture for the active visual state, so state switches change real data. */
export function NodePreview({
  node,
  graph,
  fixture = {},
  state = "idle",
  viewport = { width: 375, height: 667 },
  selectedNodeId = null,
  selectedNodeIds = [],
  hoveredNodeId = null,
  onSelectNode,
}: NodePreviewProps) {
  const accent = tokenColor(graph, "color.accent", "#397461");
  const ink = tokenColor(graph, "color.ink", "#181c1a");
  const surfaceRadius = tokenRadius(graph, "radius.surface", 28);
  const controlRadius = tokenRadius(graph, "radius.control", 18);
  const deep = `color-mix(in oklab, ${accent} 62%, ${ink})`;
  const soft = `color-mix(in oklab, ${accent} 14%, #ffffff)`;
  const hairline = `color-mix(in oklab, ${ink} 12%, #ffffff)`;
  const loading = state === "loading";

  if (node.asset) {
    const asset = graph.assets.find((candidate) => candidate.id === node.asset?.assetId);
    const variant = node.asset.variantId
      ? asset?.variants.find((candidate) => candidate.id === node.asset?.variantId)
      : undefined;
    const file = variant ?? asset;
    const contentNode = structuredClone(node);
    delete contentNode.asset;
    return (
      <div className="grid gap-2" data-preview-asset={asset?.id}>
        {asset && file && asset.exportPolicy !== "blocked" && ["raster", "svg", "icon"].includes(asset.kind) ? (
          <img
            loading="lazy"
            decoding="async"
            src={`/api/project/assets/${file.digest}`}
            alt={node.asset.decorative ? "" : node.accessibility.label}
            className="max-h-52 w-full rounded-xl border border-zinc-200 bg-white"
            style={{
              objectFit: node.asset.fit,
              objectPosition: `${Math.round(node.asset.focalPoint.x * 100)}% ${Math.round(node.asset.focalPoint.y * 100)}%`,
            }}
          />
        ) : asset ? (
          <div className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-3 text-center text-[11px] text-zinc-500">{asset.name} · {asset.exportPolicy === "blocked" ? "export blocked" : `${asset.kind} preview unavailable`}</div>
        ) : null}
        <NodePreview
          node={contentNode}
          graph={graph}
          fixture={fixture}
          state={state}
          viewport={viewport}
          selectedNodeId={selectedNodeId}
          selectedNodeIds={selectedNodeIds}
          hoveredNodeId={hoveredNodeId}
          {...(onSelectNode ? { onSelectNode } : {})}
        />
      </div>
    );
  }

  if (isContainerNode(node)) {
    const mode = resolvedContainerMode(node, viewport);
    const spacing = resolveTokenMode(graph.tokens).spacing;
    const gap = spacing[node.layout.gapToken] ?? 0;
    const padding = spacing[node.layout.paddingToken] ?? 0;
    const paddingBySide = node.layout.paddingTokens ? {
      paddingTop: spacing[node.layout.paddingTokens.top] ?? 0,
      paddingRight: spacing[node.layout.paddingTokens.right] ?? 0,
      paddingBottom: spacing[node.layout.paddingTokens.bottom] ?? 0,
      paddingLeft: spacing[node.layout.paddingTokens.left] ?? 0,
    } : { padding };
    const horizontal = node.layout.axis === "horizontal";
    const style: CSSProperties = {
      ...semanticNodeBoxStyle(node, graph, viewport),
      display: mode === "grid" || mode === "overlay" || mode === "freeform" ? "grid" : "flex",
      flexDirection: horizontal ? "row" : "column",
      flexWrap: mode === "wrap" ? "wrap" : "nowrap",
      gridTemplateColumns: mode === "grid" ? (node.layout.gridTracks?.map((track) => `${track}fr`).join(" ") ?? `repeat(${node.layout.columns}, minmax(0, 1fr))`) : undefined,
      gridTemplateRows: mode === "grid" && node.layout.gridRows ? node.layout.gridRows.map((track) => `${track}fr`).join(" ") : undefined,
      position: mode === "freeform" ? "relative" : undefined,
      gap,
      ...(mode === "safe-area" && !node.layout.paddingTokens
        ? { padding: `${padding + 16}px ${padding}px ${padding + 24}px` }
        : paddingBySide),
      alignItems: node.layout.align === "start" ? "flex-start" : node.layout.align === "end" ? "flex-end" : node.layout.align,
      justifyContent: node.layout.justify === "space-between" ? "space-between" : node.layout.justify,
      overflow: mode === "scroll" ? "auto" : semanticNodeBoxStyle(node).overflow,
    };
    const selected = new Set([...selectedNodeIds, ...(selectedNodeId ? [selectedNodeId] : [])]);
    const visibleChildren = node.children.filter((child) => isNodeVisible(child, state));
    return (
      <div data-layout-mode={mode} data-container-id={node.id} aria-label={node.accessibility.label} style={style}>
        {visibleChildren.length > 0 ? visibleChildren.map((child, index) => {
          const position = child.layout.position;
          const childStyle: CSSProperties = {
            ...semanticNodeBoxStyle(child, graph, viewport),
            ...(mode === "overlay" ? { gridArea: "1 / 1" } : {}),
            ...(mode === "freeform" ? {
              position: "absolute",
              left: position?.x ?? 0,
              top: position?.y ?? 0,
              zIndex: position?.z ?? 0,
            } : {}),
            ...(mode === "split" ? {
              flex: index === 0 ? node.layout.splitRatio : 1 - node.layout.splitRatio,
            } : {}),
            ...(mode === "wrap" ? { flex: `1 1 calc(${100 / node.layout.columns}% - ${gap}px)` } : {}),
            ...(selected.has(child.id) ? { outline: "1px solid var(--select)", outlineOffset: 2 } : {}),
            ...(child.id === hoveredNodeId && !selected.has(child.id) ? { outline: "1px solid var(--select)", outlineOffset: 2 } : {}),
          };
          return (
            <div
              key={child.id}
              data-testid={`canvas-node-${child.id}`}
              data-node-selected={selected.has(child.id) || undefined}
              style={childStyle}
              onPointerDown={onSelectNode ? (event) => {
                event.stopPropagation();
                onSelectNode(child.id, event.shiftKey ? "range" : event.metaKey || event.ctrlKey ? "toggle" : "replace");
              } : undefined}
              onClick={onSelectNode ? (event) => event.stopPropagation() : undefined}
            >
              <NodePreview
                node={child}
                graph={graph}
                fixture={fixture}
                state={state}
                viewport={viewport}
                selectedNodeId={selectedNodeId}
                selectedNodeIds={selectedNodeIds}
                hoveredNodeId={hoveredNodeId}
                {...(onSelectNode ? { onSelectNode } : {})}
              />
            </div>
          );
        }) : (
          <span className="p-3 text-center text-[11px] text-zinc-400">Empty {mode}</span>
        )}
      </div>
    );
  }

  switch (node.kind) {
    case "text":
      return <p className="whitespace-pre-wrap text-[14px] leading-relaxed">{node.intent.label}</p>;
    case "image":
      return <div className="grid min-h-28 place-items-center rounded-xl border border-dashed text-[12px] text-zinc-500" style={{ borderColor: hairline }}>Image · {node.intent.label}</div>;
    case "shape":
      return <div aria-hidden="true" className="min-h-16 rounded-xl" style={{ background: soft }} />;
    case "action":
      return <div className="rounded-lg border px-4 py-3 text-center text-[14px] font-semibold" style={{ borderColor: accent, color: deep }}>{node.intent.label}</div>;
    case "input":
      return <label className="grid gap-2 text-[13px] font-medium">{node.intent.label}<span className="min-h-10 rounded-lg border bg-white" style={{ borderColor: hairline }} /></label>;
    case "divider":
      return <hr aria-hidden="true" style={{ borderColor: hairline }} />;
    case "spacer":
      return <span aria-hidden="true" className="block min-h-4" />;
    case "balance-summary":
      return (
        <div data-loading-skeleton={loading || undefined} className="grid gap-1.5 p-6 text-white" style={{ background: deep, borderRadius: surfaceRadius, boxShadow: "0 24px 44px -30px rgba(20, 40, 33, .8)" }}>
          <span className="text-[13px] text-white/65">{node.intent.label ?? "Available balance"}</span>
          {loading
            ? <Skeleton className="h-[34px] w-40 rounded-lg opacity-40" />
            : <strong className="font-mono text-[34px] leading-none tracking-[-0.05em]">{formatMoney(fixture.balance, "€8,420.16")}</strong>}
          <span className="text-[11px] text-white/50">{loading ? "Refreshing…" : "Updated just now"}</span>
        </div>
      );
    case "transaction-list":
      if (state === "empty") {
        return (
          <div className="grid gap-1">
            <span className="text-[15px] font-semibold tracking-[-.02em]">{node.intent.label}</span>
            <div className="rounded-2xl border border-dashed px-4 py-6 text-center text-[13px] text-zinc-500" style={{ borderColor: hairline }}>
              No activity yet. Your first payment will appear here.
            </div>
          </div>
        );
      }
      return (
        <div data-loading-skeleton={loading || undefined} className="grid gap-1">
          <span className="text-[15px] font-semibold tracking-[-.02em]">{node.intent.label}</span>
          {[["Riva Studio", "−€84.20"], ["Northline Market", "−€32.70"]].map(([name, amount]) => (
            <div key={name} className="flex items-center justify-between py-3 text-[13.5px]" style={{ borderTop: `1px solid ${hairline}` }}>
              {loading ? <Skeleton className="h-3.5 w-28 rounded" /> : <span>{name}</span>}
              {loading ? <Skeleton className="h-3.5 w-16 rounded" /> : <strong className="font-mono tracking-[-.02em]">{amount}</strong>}
            </div>
          ))}
        </div>
      );
    case "money-input":
      return (
        <div data-loading-skeleton={loading || undefined} className="grid gap-2 text-[13px] font-medium">
          {node.intent.label}
          <div className="border bg-white px-5 py-4 font-mono text-[27px] font-semibold tracking-[-.04em]" style={{ borderColor: hairline, borderRadius: controlRadius }}>
            {loading ? <Skeleton className="h-[27px] w-32 rounded-lg" /> : formatMoney(fixture.amount, "€120.00")}
          </div>
        </div>
      );
    case "recipient-identity": {
      const name = typeof fixture.recipientName === "string" && fixture.recipientName ? fixture.recipientName : "Mara Rinaldi";
      return (
        <div data-loading-skeleton={loading || undefined} className="flex items-center gap-3.5 py-3.5" style={{ borderTop: `1px solid ${hairline}`, borderBottom: `1px solid ${hairline}` }}>
          <span className="grid size-11 place-items-center rounded-full text-[12px] font-bold" style={{ background: soft, color: deep }}>{loading ? "" : initialsOf(name)}</span>
          <span className="grid gap-0.5">
            {loading ? <Skeleton className="h-3.5 w-28 rounded" /> : <strong className="text-[14px] tracking-[-.01em]">{name}</strong>}
            {loading ? <Skeleton className="h-3 w-36 rounded" /> : <small className="text-[12px] text-zinc-500">mara@northline.test</small>}
          </span>
        </div>
      );
    }
    case "status-message":
      return (
        <div className="border-l-[3px] border-[#a4432c] bg-[#f6e7e1] p-4 text-[13px] leading-relaxed text-[#6f3423]" style={{ borderRadius: 6 }}>
          {node.intent.label}
        </div>
      );
    case "receipt-summary":
      return (
        <div data-loading-skeleton={loading || undefined} className="grid justify-items-center gap-1.5 p-7 text-center" style={{ background: soft, borderRadius: surfaceRadius }}>
          <span className="grid size-11 place-items-center rounded-full text-white" style={{ background: accent }}><Check size={22} weight="bold" /></span>
          <span className="mt-1 text-[13px]">{node.intent.label}</span>
          {loading
            ? <Skeleton className="h-[30px] w-28 rounded-lg" />
            : <strong className="font-mono text-[30px] leading-none tracking-[-.04em]">{formatMoney(fixture.amount, "€120.00")}</strong>}
          <small className="text-[11px] text-zinc-500">Reference {typeof fixture.reference === "string" && fixture.reference ? fixture.reference : "IF-2048"}</small>
        </div>
      );
    case "secondary-action":
      return (
        <div className="px-5 py-4 text-center text-[15px] font-semibold" style={{ background: soft, color: deep, borderRadius: controlRadius }}>
          {node.intent.label}
        </div>
      );
    case "primary-action":
      return (
        <div
          className="px-5 py-4 text-center text-[15px] font-bold text-white"
          style={{ background: accent, borderRadius: controlRadius, boxShadow: `0 18px 30px -20px color-mix(in oklab, ${accent} 85%, black)`, opacity: loading ? 0.75 : 1 }}
        >
          {node.intent.label}
        </div>
      );
  }
}
