"use client";

import {
  CaretRight,
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
  Trash,
  X,
} from "@phosphor-icons/react";
import type { SemanticInterfaceGraph, SemanticNode } from "@intentform/semantic-schema";
import { Reorder } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { isNodeVisible, nodeNames, type RailTab, type VisualState } from "./support";

interface LayersPanelProps {
  graph: SemanticInterfaceGraph;
  screen: SemanticInterfaceGraph["screens"][number];
  selectedNodeId: string | null;
  activeVisualState: VisualState;
  railTab: RailTab;
  visible: boolean;
  desktopVisible: boolean;
  layerQuery: string;
  onRailTab(tab: RailTab): void;
  onLayerQuery(query: string): void;
  onSelectScreen(screenId: string): void;
  onSelectNode(nodeId: string | null): void;
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
  if (node.kind === "primary-action" || node.kind === "secondary-action") return <Selection size={12} />;
  if (node.kind === "money-input") return <TextT size={12} />;
  return <Stack size={12} />;
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
    <label className="grid grid-cols-[1fr_72px] items-center gap-2 text-[10.5px] text-[var(--muted)]">
      <span className="truncate font-mono">{label}</span>
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
        className="min-h-7 rounded-md border border-[var(--line-strong)] bg-[var(--field)] px-2 text-right font-mono text-[10.5px] text-[var(--t-strong)] outline-none focus:border-[var(--accent)]"
      />
    </label>
  );
}

export function LayersPanel({
  graph,
  screen,
  selectedNodeId,
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

  useEffect(() => {
    setOrder(screen.nodes.map((node) => node.id));
  }, [screen.id, screen.nodes]);

  useEffect(() => {
    setPageOrder(graph.screens.map((item) => item.id));
  }, [graph.screens]);

  const nodesById = useMemo(() => new Map(screen.nodes.map((node) => [node.id, node])), [screen.nodes]);
  const query = layerQuery.trim().toLowerCase();
  const filteredNodes = query
    ? screen.nodes.filter((node) => `${node.intent.label} ${nodeNames[node.kind]} ${node.id}`.toLowerCase().includes(query))
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

  const layerRow = (node: SemanticNode, draggable: boolean) => {
    const nodeVisible = isNodeVisible(node, activeVisualState);
    return (
      <button
        type="button"
        data-testid={`layer-${node.id}`}
        data-state-visible={nodeVisible}
        onClick={() => { onSelectNode(node.id); onDismissMobile(); }}
        onMouseEnter={() => onHoverNode(node.id)}
        onMouseLeave={() => onHoverNode(null)}
        className={`group flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[11px] ${node.id === selectedNodeId ? "bg-[var(--accent-soft)] font-medium text-[var(--accent-text)]" : nodeVisible ? "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]" : "text-[var(--faint)] hover:bg-[var(--hover)] hover:text-[var(--muted)]"}`}
      >
        <DotsSixVertical size={12} className={draggable ? "cursor-grab opacity-40" : "opacity-15"} />
        {layerIcon(node)}
        <span className="min-w-0 flex-1 truncate">{node.intent.label ?? nodeNames[node.kind]}</span>
        {nodeVisible
          ? <Eye size={11} className="opacity-0 group-hover:opacity-55" />
          : <EyeSlash size={11} aria-label={`Hidden in ${activeVisualState} state`} />}
      </button>
    );
  };

  return (
    <aside
      id="editor-structure-panel"
      aria-label="Pages and layers"
      className={`${visible ? "grid" : "hidden"} ${desktopVisible ? "xl:grid" : "xl:hidden"} absolute inset-y-0 left-0 z-[3] w-[268px] min-h-0 grid-rows-[auto_1fr] border-r border-[var(--line)] bg-[var(--chrome)] shadow-[24px_0_52px_-32px_var(--shadow-strong)] xl:relative xl:z-[1] xl:w-auto xl:shadow-none`}
    >
      <div className="flex items-center justify-between border-b border-[var(--line)] px-2 pt-1.5">
        <div className="flex gap-0.5" role="tablist" aria-label="Left panel sections">
          {([["layers", "Layers"], ["tokens", "Tokens"]] as const).map(([tab, label]) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={railTab === tab}
              onClick={() => onRailTab(tab)}
              className={`min-h-8 rounded-t-md border-b-2 px-2.5 text-[11px] font-medium ${railTab === tab ? "border-[var(--accent)] text-[var(--ink)]" : "border-transparent text-[var(--muted)] hover:text-[var(--ink)]"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <button type="button" aria-label="Close pages and layers" onClick={onClose} className="grid size-7 place-items-center rounded-md text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"><X size={13} /></button>
      </div>

      {railTab === "layers" ? (
        <div className="grid min-h-0 grid-rows-[auto_auto_1fr]">
          <div className="border-b border-[var(--line)] p-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-[var(--t-strong)]">Pages</span>
              <button type="button" aria-label="Add screen" onClick={onAddScreen} className="grid size-7 place-items-center rounded-md text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"><Plus size={13} /></button>
            </div>
            <Reorder.Group axis="y" as="div" values={pageOrder} onReorder={setPageOrder} className="mt-2 grid gap-0.5">
              {pageOrder.map((screenId) => {
                const item = graph.screens.find((candidate) => candidate.id === screenId);
                if (!item) return null;
                return (
                  <Reorder.Item key={screenId} value={screenId} as="div" onDragEnd={commitPageOrder} className="relative">
                    <div className={`group flex min-h-8 items-center gap-1 rounded-md pr-1 ${item.id === screen.id ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--hover)]"}`}>
                      <button
                        type="button"
                        onClick={() => { onSelectScreen(item.id); onSelectNode(item.nodes[0]?.id ?? null); onDismissMobile(); }}
                        className={`flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-[11px] ${item.id === screen.id ? "font-medium text-[var(--accent-text)]" : "text-[var(--muted)] group-hover:text-[var(--ink)]"}`}
                      >
                        <FrameCorners size={13} />
                        <span className="min-w-0 flex-1 truncate">{item.title}</span>
                        <span className="font-mono text-[9px] text-[var(--faint)] group-hover:hidden">{item.nodes.length}</span>
                      </button>
                      <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
                        <button type="button" aria-label={`Duplicate screen ${item.title}`} onClick={() => onDuplicateScreen(item.id)} className="grid size-6 place-items-center rounded text-[var(--muted)] hover:bg-[var(--field)] hover:text-[var(--ink)]"><Copy size={11} /></button>
                        <button type="button" aria-label={`Delete screen ${item.title}`} disabled={graph.screens.length <= 1} onClick={() => onDeleteScreen(item.id)} className="grid size-6 place-items-center rounded text-[var(--muted)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] disabled:opacity-25"><Trash size={11} /></button>
                      </span>
                    </div>
                  </Reorder.Item>
                );
              })}
            </Reorder.Group>
          </div>

          <div className="border-b border-[var(--line)] px-3 py-2.5">
            <span className="text-[11px] font-semibold text-[var(--t-strong)]">Layers</span>
            <label className="mt-2 flex min-h-8 items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--field)] px-2.5 text-[var(--muted)] focus-within:border-[var(--accent)] focus-within:shadow-[0_0_0_3px_rgba(57,116,97,.08)]">
              <MagnifyingGlass size={12} aria-hidden="true" />
              <span className="sr-only">Search layers</span>
              <input aria-label="Search layers" value={layerQuery} onChange={(event) => onLayerQuery(event.target.value)} placeholder="Find a layer" className="min-w-0 flex-1 bg-transparent text-[10.5px] text-[var(--t-strong)] outline-none placeholder:text-[var(--faint)]" />
              {layerQuery ? <button type="button" aria-label="Clear layer search" onClick={() => onLayerQuery("")} className="grid size-5 place-items-center rounded hover:bg-[var(--hover)]"><X size={10} /></button> : null}
            </label>
          </div>

          <div className="min-h-0 overflow-auto px-2 py-2">
            <div className="mb-1 flex items-center gap-1.5 px-1.5 py-1.5 text-[11px] text-[var(--muted)]"><CaretRight size={11} weight="bold" /><FrameCorners size={12} /><strong>{screen.title}</strong></div>
            {filteredNodes ? (
              <>
                {filteredNodes.map((node) => layerRow(node, false))}
                {filteredNodes.length === 0 ? <div className="mx-1 mt-3 rounded-lg border border-dashed border-[var(--line-strong)] px-3 py-5 text-center text-[10.5px] leading-relaxed text-[var(--muted)]">No layers match “{layerQuery}”.</div> : null}
              </>
            ) : (
              <Reorder.Group axis="y" as="div" values={order} onReorder={setOrder} className="grid gap-0.5">
                {order.map((nodeId) => {
                  const node = nodesById.get(nodeId);
                  if (!node) return null;
                  return (
                    <Reorder.Item key={nodeId} value={nodeId} as="div" onDragEnd={commitOrder} className="relative">
                      {layerRow(node, true)}
                    </Reorder.Item>
                  );
                })}
              </Reorder.Group>
            )}
          </div>
        </div>
      ) : (
        <div className="min-h-0 overflow-auto">
          <section className="border-b border-[var(--line)] p-3">
            <h3 className="text-[11px] font-semibold text-[var(--t-strong)]">Color tokens</h3>
            <p className="mt-1 text-[10px] leading-relaxed text-[var(--muted)]">Bound to every frame and compiled into both platforms.</p>
            <div className="mt-3 grid gap-2">
              {Object.entries(graph.tokens.colors).map(([key, value]) => (
                <div key={key} className="grid grid-cols-[26px_1fr_64px] items-center gap-2">
                  <input
                    type="color"
                    aria-label={`Pick ${key}`}
                    value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#397461"}
                    onChange={(event) => onUpdateTokens((tokens) => { tokens.colors[key] = event.target.value; }, `Set ${key}.`)}
                    className="h-7 w-full cursor-pointer rounded-md border border-[var(--line)] bg-[var(--field)] p-0.5"
                  />
                  <span className="truncate font-mono text-[10.5px] text-[var(--muted)]">{key}</span>
                  <input
                    key={`${key}-${value}`}
                    aria-label={`Hex for ${key}`}
                    defaultValue={value}
                    onBlur={(event) => {
                      const next = event.target.value.trim();
                      if (/^#[0-9a-fA-F]{3,8}$/.test(next) && next !== value) onUpdateTokens((tokens) => { tokens.colors[key] = next; }, `Set ${key}.`);
                    }}
                    onKeyDown={(event) => { if (event.key === "Enter") (event.target as HTMLInputElement).blur(); }}
                    className="min-h-7 rounded-md border border-[var(--line-strong)] bg-[var(--field)] px-1.5 font-mono text-[10px] text-[var(--t-strong)] outline-none focus:border-[var(--accent)]"
                  />
                </div>
              ))}
            </div>
          </section>
          <section className="border-b border-[var(--line)] p-3">
            <h3 className="text-[11px] font-semibold text-[var(--t-strong)]">Radii</h3>
            <div className="mt-3 grid gap-2">
              {Object.entries(graph.tokens.radii).map(([key, value]) => (
                <TokenNumberField key={key} label={key} value={value} onCommit={(next) => onUpdateTokens((tokens) => { tokens.radii[key] = next; }, `Set ${key} to ${next}.`)} />
              ))}
            </div>
          </section>
          <section className="p-3">
            <h3 className="text-[11px] font-semibold text-[var(--t-strong)]">Spacing</h3>
            <div className="mt-3 grid gap-2">
              {Object.entries(graph.tokens.spacing).map(([key, value]) => (
                <TokenNumberField key={key} label={key} value={value} onCommit={(next) => onUpdateTokens((tokens) => { tokens.spacing[key] = next; }, `Set ${key} to ${next}.`)} />
              ))}
            </div>
            <div className="mt-4 rounded-lg border border-[var(--line)] bg-[var(--hover)] p-3 text-[10px] leading-relaxed text-[var(--muted)]">
              Token edits are semantic changes: they land in the graph diff and recompile React and SwiftUI deterministically.
            </div>
          </section>
        </div>
      )}
    </aside>
  );
}
