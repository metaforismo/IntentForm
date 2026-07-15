"use client";

import {
  ArrowDown,
  ArrowUp,
  Copy,
  DotsSixVertical,
  Eye,
  EyeSlash,
  FrameCorners,
  MagnifyingGlass,
  Plus,
  Selection,
  Stack,
  TextT,
  TreeStructure,
  Trash,
  X,
} from "@phosphor-icons/react";
import {
  flattenSemanticNodes,
  isContainerNode,
  type SemanticInterfaceGraph,
  type SemanticNode,
} from "@intentform/semantic-schema";
import { buildNodeIndex } from "@intentform/layout-engine";
import { Reorder } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { IconButton } from "../ui/controls";
import { isNodeVisible, nodeNames, type RailTab, type VisualState } from "./support";
import type { SelectionIntent } from "./direct-manipulation";

interface LayersPanelProps {
  graph: SemanticInterfaceGraph;
  screen: SemanticInterfaceGraph["screens"][number];
  selectedNodeIds: readonly string[];
  activeVisualState: VisualState;
  railTab: RailTab;
  visible: boolean;
  desktopVisible: boolean;
  layerQuery: string;
  onRailTab(tab: RailTab): void;
  onLayerQuery(query: string): void;
  onSelectScreen(screenId: string): void;
  onSelectNode(nodeId: string | null, intent?: SelectionIntent): void;
  onHoverNode(nodeId: string | null): void;
  onAddScreen(): void;
  onReorderScreens(orderedIds: string[]): void;
  onDuplicateScreen(screenId: string): void;
  onDeleteScreen(screenId: string): void;
  onReorderNodes(screenId: string, orderedIds: string[]): void;
  onUpdateTokens(mutate: (tokens: SemanticInterfaceGraph["tokens"]) => void, notice: string): void;
  onClose(): void;
  onDismissMobile(): void;
}

function layerIcon(node: SemanticNode) {
  if (isContainerNode(node)) return <TreeStructure size={13} />;
  if (node.kind === "primary-action" || node.kind === "secondary-action") return <Selection size={13} />;
  if (node.kind === "money-input") return <TextT size={13} />;
  return <Stack size={13} />;
}

function PanelHeading({ label, action }: { label: string; action?: React.ReactNode }) {
  return (
    <div className="flex min-h-8 items-center justify-between pl-1">
      <span className="text-[11px] font-semibold tracking-[.01em] text-[var(--muted)]">{label}</span>
      {action}
    </div>
  );
}

function TokenNumberField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit(next: number): void;
}) {
  return (
    <label className="grid grid-cols-[1fr_76px] items-center gap-2 text-[11px] text-[var(--muted)]">
      <span className="truncate font-mono text-[11px]">{label}</span>
      <input
        key={`${label}-${value}`}
        type="number"
        min={0}
        defaultValue={value}
        onBlur={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next) && next >= 0 && next !== value) onCommit(next);
        }}
        onKeyDown={(event) => { if (event.key === "Enter") (event.target as HTMLInputElement).blur(); }}
        className="min-h-8 rounded-lg border border-[var(--line)] bg-[var(--field)] px-2 text-right font-mono text-[11px] text-[var(--t-strong)] outline-none transition-colors hover:border-[var(--line-strong)] focus:border-[var(--accent)]"
      />
    </label>
  );
}

export function LayersPanel({
  graph,
  screen,
  selectedNodeIds,
  activeVisualState,
  railTab,
  visible,
  desktopVisible,
  layerQuery,
  onRailTab,
  onLayerQuery,
  onSelectScreen,
  onSelectNode,
  onHoverNode,
  onAddScreen,
  onReorderScreens,
  onDuplicateScreen,
  onDeleteScreen,
  onReorderNodes,
  onUpdateTokens,
  onClose,
  onDismissMobile,
}: LayersPanelProps) {
  const [order, setOrder] = useState<string[]>(() => screen.nodes.map((node) => node.id));
  const [pageOrder, setPageOrder] = useState<string[]>(() => graph.screens.map((item) => item.id));
  const pagesListRef = useRef<HTMLDivElement>(null);
  const layersListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setOrder(screen.nodes.map((node) => node.id));
  }, [screen.id, screen.nodes]);

  useEffect(() => {
    setPageOrder(graph.screens.map((item) => item.id));
  }, [graph.screens]);

  const allNodes = useMemo(() => flattenSemanticNodes(screen.nodes), [screen.nodes]);
  const nodesById = useMemo(() => new Map(allNodes.map((node) => [node.id, node])), [allNodes]);
  const nodeIndex = useMemo(() => buildNodeIndex(screen.nodes), [screen.nodes]);
  const query = layerQuery.trim().toLowerCase();
  const filteredNodes = query
    ? allNodes.filter((node) => `${node.intent.label ?? ""} ${nodeNames[node.kind]} ${node.id}`.toLowerCase().includes(query))
    : null;

  const commitOrder = () => {
    const current = screen.nodes.map((node) => node.id);
    if (order.length === current.length && order.every((id, index) => id === current[index])) return;
    onReorderNodes(screen.id, order);
  };

  const commitPageOrder = () => {
    const current = graph.screens.map((item) => item.id);
    if (pageOrder.length === current.length && pageOrder.every((id, index) => id === current[index])) return;
    onReorderScreens(pageOrder);
  };

  const movePage = (screenId: string, direction: -1 | 1) => {
    const index = pageOrder.indexOf(screenId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= pageOrder.length) return;
    const next = [...pageOrder];
    [next[index], next[target]] = [next[target]!, next[index]!];
    setPageOrder(next);
    onReorderScreens(next);
  };

  const layerRow = (node: SemanticNode, draggable: boolean, depth = 0) => {
    const nodeVisible = isNodeVisible(node, activeVisualState);
    return (
      <button
        type="button"
        data-testid={`layer-${node.id}`}
        data-state-visible={nodeVisible}
        aria-pressed={selectedNodeIds.includes(node.id)}
        onClick={(event) => {
          onSelectNode(node.id, event.shiftKey ? "range" : event.metaKey || event.ctrlKey ? "toggle" : "replace");
          if (!event.shiftKey && !event.metaKey && !event.ctrlKey) onDismissMobile();
        }}
        onMouseEnter={() => onHoverNode(node.id)}
        onMouseLeave={() => onHoverNode(null)}
        className={`group flex h-8 w-full items-center gap-2 rounded-lg pr-2 text-left text-[12px] ${selectedNodeIds.includes(node.id) ? "bg-[var(--accent-soft)] font-medium text-[var(--accent-text)]" : nodeVisible ? "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]" : "text-[var(--faint)] hover:bg-[var(--hover)]"}`}
        style={{ paddingLeft: 6 + depth * 14 }}
      >
        <DotsSixVertical size={12} className={`shrink-0 ${draggable ? "cursor-grab opacity-0 group-hover:opacity-40" : "opacity-0"}`} />
        <span className="shrink-0 opacity-70">{layerIcon(node)}</span>
        <span className="min-w-0 flex-1 truncate">{node.intent.label ?? nodeNames[node.kind]}</span>
        {nodeVisible
          ? <Eye size={12} className="shrink-0 opacity-0 group-hover:opacity-50" />
          : <EyeSlash size={12} aria-label={`Hidden in ${activeVisualState} state`} className="shrink-0 opacity-60" />}
      </button>
    );
  };

  const nestedRows = (node: SemanticNode, depth: number): React.ReactNode => node.children.map((child) => (
    <div key={child.id}>
      {layerRow(child, false, depth)}
      {nestedRows(child, depth + 1)}
    </div>
  ));

  return (
    <aside
      id="editor-structure-panel"
      role={visible ? "dialog" : undefined}
      aria-modal={visible ? "true" : undefined}
      aria-label="Pages and layers"
      className={`${visible ? "grid" : "hidden"} ${desktopVisible ? "xl:grid" : "xl:hidden"} absolute inset-y-0 left-0 z-[3] w-[268px] min-h-0 grid-rows-[auto_1fr] border-r border-[var(--line)] bg-[var(--chrome)] shadow-[24px_0_52px_-32px_var(--shadow-strong)] xl:relative xl:z-[1] xl:w-auto xl:shadow-none`}
    >
      <div className="flex items-center justify-between border-b border-[var(--line)] px-2 pt-1">
        <div className="flex gap-0.5" role="tablist" aria-label="Left panel sections">
          {([["layers", "Layers"], ["tokens", "Tokens"]] as const).map(([tab, label]) => (
            <button
              key={tab}
              id={`editor-${tab}-tab`}
              type="button"
              role="tab"
              aria-selected={railTab === tab}
              aria-controls={`editor-${tab}-tabpanel`}
              tabIndex={railTab === tab ? 0 : -1}
              onClick={() => onRailTab(tab)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                event.preventDefault();
                const next = tab === "layers" ? "tokens" : "layers";
                onRailTab(next);
                requestAnimationFrame(() => document.getElementById(`editor-${next}-tab`)?.focus());
              }}
              className={`min-h-9 border-b-2 px-3 text-[12px] font-medium transition-colors ${railTab === tab ? "border-[var(--accent)] text-[var(--ink)]" : "border-transparent text-[var(--muted)] hover:text-[var(--ink)]"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <IconButton ariaLabel="Close pages and layers" onClick={onClose}><X size={13} /></IconButton>
      </div>

      {railTab === "layers" ? (
        <div id="editor-layers-tabpanel" role="tabpanel" aria-labelledby="editor-layers-tab" className="grid min-h-0 grid-rows-[auto_auto_1fr]">
          <div className="border-b border-[var(--line)] px-2 pb-2 pt-1.5">
            <PanelHeading
              label="Pages"
              action={<IconButton ariaLabel="Add screen" onClick={onAddScreen}><Plus size={13} /></IconButton>}
            />
            <Reorder.Group ref={pagesListRef} axis="y" as="div" values={pageOrder} onReorder={setPageOrder} className="relative mt-0.5 grid grid-cols-1 gap-px">
              {pageOrder.map((screenId) => {
                const item = graph.screens.find((candidate) => candidate.id === screenId);
                if (!item) return null;
                const active = item.id === screen.id;
                return (
                  <Reorder.Item
                    key={screenId}
                    value={screenId}
                    as="div"
                    dragConstraints={pagesListRef}
                    dragElastic={0.03}
                    onDragEnd={commitPageOrder}
                    className="relative"
                  >
                    <div className={`group relative flex h-8 items-center overflow-hidden rounded-lg ${active ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--hover)]"}`}>
                      <button
                        type="button"
                        onClick={() => { onSelectScreen(item.id); onSelectNode(item.nodes[0]?.id ?? null, "replace"); onDismissMobile(); }}
                        className={`flex h-8 min-w-0 flex-1 items-center gap-2 pl-2 pr-2 text-left text-[12px] ${active ? "font-medium text-[var(--accent-text)]" : "text-[var(--muted)] group-hover:text-[var(--ink)]"}`}
                      >
                        <FrameCorners size={13} className="shrink-0 opacity-70" />
                        <span className="min-w-0 flex-1 truncate">{item.title}</span>
                        <span className="shrink-0 font-mono text-[10px] text-[var(--faint)] transition-opacity group-hover:opacity-0">{flattenSemanticNodes(item.nodes).length}</span>
                      </button>
                      <span className={`pointer-events-none absolute inset-y-0 right-0 flex items-center gap-0.5 pl-3 pr-1 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 ${active ? "bg-gradient-to-l from-[var(--accent-soft)] via-[var(--accent-soft)] to-transparent" : "bg-gradient-to-l from-[var(--hover)] via-[var(--hover)] to-transparent"}`}>
                        <button type="button" aria-label={`Move screen ${item.title} up`} disabled={pageOrder.indexOf(item.id) === 0} onClick={() => movePage(item.id, -1)} className="grid size-6 place-items-center rounded-md text-[var(--muted)] hover:bg-[var(--field)] hover:text-[var(--ink)] disabled:opacity-25"><ArrowUp size={12} /></button>
                        <button type="button" aria-label={`Move screen ${item.title} down`} disabled={pageOrder.indexOf(item.id) === pageOrder.length - 1} onClick={() => movePage(item.id, 1)} className="grid size-6 place-items-center rounded-md text-[var(--muted)] hover:bg-[var(--field)] hover:text-[var(--ink)] disabled:opacity-25"><ArrowDown size={12} /></button>
                        <button type="button" aria-label={`Duplicate screen ${item.title}`} onClick={() => onDuplicateScreen(item.id)} className="grid size-6 place-items-center rounded-md text-[var(--muted)] hover:bg-[var(--field)] hover:text-[var(--ink)]"><Copy size={12} /></button>
                        <button type="button" aria-label={`Delete screen ${item.title}`} disabled={graph.screens.length <= 1} onClick={() => onDeleteScreen(item.id)} className="grid size-6 place-items-center rounded-md text-[var(--muted)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] disabled:opacity-25"><Trash size={12} /></button>
                      </span>
                    </div>
                  </Reorder.Item>
                );
              })}
            </Reorder.Group>
          </div>

          <div className="px-2 pb-1 pt-1.5">
            <PanelHeading label="Layers" />
            <label className="mt-0.5 flex h-8 items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--field)] px-2.5 text-[var(--muted)] transition-colors focus-within:border-[var(--accent)] focus-within:shadow-[0_0_0_3px_color-mix(in_oklab,var(--accent)_12%,transparent)] hover:border-[var(--line-strong)]">
              <MagnifyingGlass size={13} aria-hidden="true" className="shrink-0" />
              <span className="sr-only">Search layers</span>
              <input aria-label="Search layers" value={layerQuery} onChange={(event) => onLayerQuery(event.target.value)} placeholder="Find a layer" className="min-w-0 flex-1 bg-transparent text-[12px] text-[var(--t-strong)] outline-none placeholder:text-[var(--faint)]" />
              {layerQuery ? <button type="button" aria-label="Clear layer search" onClick={() => onLayerQuery("")} className="grid size-5 shrink-0 place-items-center rounded hover:bg-[var(--hover)]"><X size={11} /></button> : null}
            </label>
          </div>

          <div className="min-h-0 overflow-y-auto overflow-x-hidden px-2 pb-2 pt-1">
            {filteredNodes ? (
              <div className="grid grid-cols-1 gap-px">
                {filteredNodes.map((node) => layerRow(node, false, (nodeIndex.get(node.id)?.depth ?? 1) - 1))}
                {filteredNodes.length === 0 ? <div className="mx-1 mt-3 rounded-lg border border-dashed border-[var(--line-strong)] px-3 py-5 text-center text-[11px] leading-relaxed text-[var(--muted)]">No layers match “{layerQuery}”.</div> : null}
              </div>
            ) : (
              <Reorder.Group ref={layersListRef} axis="y" as="div" values={order} onReorder={setOrder} className="relative grid grid-cols-1 gap-px">
                {order.map((nodeId) => {
                  const node = nodesById.get(nodeId);
                  if (!node) return null;
                  return (
                    <Reorder.Item
                      key={nodeId}
                      value={nodeId}
                      as="div"
                      dragConstraints={layersListRef}
                      dragElastic={0.03}
                      onDragEnd={commitOrder}
                      className="relative"
                    >
                      {layerRow(node, true)}
                      {nestedRows(node, 1)}
                    </Reorder.Item>
                  );
                })}
              </Reorder.Group>
            )}
          </div>
        </div>
      ) : (
        <div id="editor-tokens-tabpanel" role="tabpanel" aria-labelledby="editor-tokens-tab" className="min-h-0 overflow-y-auto overflow-x-hidden">
          <section className="border-b border-[var(--line)] px-3 pb-3 pt-2">
            <PanelHeading label="Color tokens" />
            <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--faint)]">Bound to every frame and compiled into both platforms.</p>
            <div className="mt-3 grid gap-2">
              {Object.entries(graph.tokens.colors).map(([key, value]) => (
                <div key={key} className="grid grid-cols-[28px_1fr_68px] items-center gap-2">
                  <input
                    type="color"
                    aria-label={`Pick ${key}`}
                    value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#397461"}
                    onChange={(event) => onUpdateTokens((tokens) => { tokens.colors[key] = event.target.value; }, `Set ${key}.`)}
                    className="h-8 w-full cursor-pointer rounded-lg border border-[var(--line)] bg-[var(--field)] p-0.5"
                  />
                  <span className="truncate font-mono text-[11px] text-[var(--muted)]">{key}</span>
                  <input
                    key={`${key}-${value}`}
                    aria-label={`Hex for ${key}`}
                    defaultValue={value}
                    onBlur={(event) => {
                      const next = event.target.value.trim();
                      if (/^#[0-9a-fA-F]{3,8}$/.test(next) && next !== value) onUpdateTokens((tokens) => { tokens.colors[key] = next; }, `Set ${key}.`);
                    }}
                    onKeyDown={(event) => { if (event.key === "Enter") (event.target as HTMLInputElement).blur(); }}
                    className="min-h-8 rounded-lg border border-[var(--line)] bg-[var(--field)] px-2 font-mono text-[11px] text-[var(--t-strong)] outline-none transition-colors hover:border-[var(--line-strong)] focus:border-[var(--accent)]"
                  />
                </div>
              ))}
            </div>
          </section>
          <section className="border-b border-[var(--line)] px-3 pb-3 pt-2">
            <PanelHeading label="Radii" />
            <div className="mt-2 grid gap-2">
              {Object.entries(graph.tokens.radii).map(([key, value]) => (
                <TokenNumberField key={key} label={key} value={value} onCommit={(next) => onUpdateTokens((tokens) => { tokens.radii[key] = next; }, `Set ${key} to ${next}.`)} />
              ))}
            </div>
          </section>
          <section className="px-3 pb-3 pt-2">
            <PanelHeading label="Spacing" />
            <div className="mt-2 grid gap-2">
              {Object.entries(graph.tokens.spacing).map(([key, value]) => (
                <TokenNumberField key={key} label={key} value={value} onCommit={(next) => onUpdateTokens((tokens) => { tokens.spacing[key] = next; }, `Set ${key} to ${next}.`)} />
              ))}
            </div>
            <div className="mt-4 rounded-lg bg-[var(--accent-soft)] p-3 text-[11px] leading-relaxed text-[var(--accent-text)]">
              Token edits are semantic changes: they land in the graph diff and recompile React and SwiftUI deterministically.
            </div>
          </section>
        </div>
      )}
    </aside>
  );
}
