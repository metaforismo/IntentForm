"use client";

import {
  ArrowDown,
  ArrowUp,
  Copy,
  CaretDown,
  CaretDoubleUp,
  CaretRight,
  DownloadSimple,
  DotsSixVertical,
  Eye,
  EyeSlash,
  FrameCorners,
  MagnifyingGlass,
  Lock,
  LockOpen,
  Plus,
  Selection,
  Stack,
  TextT,
  TreeStructure,
  Trash,
  UploadSimple,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import {
  findGraphNodeLocation,
  flattenSemanticNodes,
  isContainerNode,
  parseGraph,
  resolveTokenMode,
  type SemanticInterfaceGraph,
  type ComponentDefinition,
  type SemanticNode,
} from "@intentform/semantic-schema";
import { buildNodeIndex } from "@intentform/layout-engine";
import { importDtcg, serializeDtcg, TOKEN_ASSET_LIMITS } from "@intentform/token-assets";
import { extractSvgPaints, replaceSvgPaint, type SvgPaint } from "@intentform/token-assets/svg-paints";
import { Reorder } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { IconButton } from "../ui/controls";
import {
  groupAssetIntegrityDiagnostics,
  hasBlockingAssetIntegrityIssue,
  parseAssetIntegritySnapshot,
  type AssetIntegrityDiagnostic,
} from "./asset-integrity";
import { importLocalAsset } from "./asset-import";
import { isNodeVisible, nodeNames, type NodeCommand, type RailTab, type VisualState } from "./support";
import type { SelectionIntent } from "./direct-manipulation";
import { virtualWindow } from "../reliability-model";

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
  onReorderNodes(screenId: string, parentId: string | null, orderedIds: string[]): void;
  onMoveNode(nodeId: string, targetParentId: string | null, targetIndex: number): void;
  onNodeCommand(command: NodeCommand, nodeId: string): void;
  onInstantiateComponent(definitionId: string): void;
  onCreateComponent(nodeId: string, name: string): void;
  onUpdateComponent(definition: ComponentDefinition): void;
  onUpdateTokens(mutate: (tokens: SemanticInterfaceGraph["tokens"]) => void, notice: string): void;
  localProjectFingerprint: string | null;
  localProjectSaved: boolean;
  onUpdateAssets(mutate: (assets: SemanticInterfaceGraph["assets"]) => void, notice: string): void;
  onExternalAssetCommit(graph: SemanticInterfaceGraph, fingerprint: string, notice: string): void;
  onPlaceAsset(assetId: string): void;
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
    <div className="flex min-h-[34px] items-center justify-between pl-1">
      <span className="text-[11px] font-medium leading-[15px] text-[var(--muted)]">{label}</span>
      {action}
    </div>
  );
}

function AssetThumbnail({ asset }: { asset: SemanticInterfaceGraph["assets"][number] }) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  if (!["raster", "svg", "icon"].includes(asset.kind)) return null;
  return (
    <div className="relative mb-2 grid h-20 place-items-center overflow-hidden rounded-lg border border-[var(--line)] bg-[repeating-conic-gradient(var(--canvas)_0_25%,var(--field)_0_50%)_50%/12px_12px]">
      {state === "loading" ? <span className="text-[9px] font-medium text-[var(--faint)]">Loading preview…</span> : null}
      <img
        key={attempt}
        loading="lazy"
        decoding="async"
        src={`/api/project/assets/${asset.digest}`}
        alt=""
        onLoad={() => setState("ready")}
        onError={() => setState("error")}
        className={`absolute inset-0 size-full object-contain ${state === "ready" ? "opacity-100" : "opacity-0"}`}
      />
      {state === "error" ? <button type="button" onClick={() => { setState("loading"); setAttempt((value) => value + 1); }} className="relative z-[1] rounded-md bg-[var(--danger-soft)] px-2 py-1 text-[9px] font-semibold text-[var(--danger)]">Missing · Retry</button> : null}
    </div>
  );
}

function SvgPaintEditor({
  asset,
  disabled,
  onRecolor,
}: {
  asset: SemanticInterfaceGraph["assets"][number];
  disabled: boolean;
  onRecolor(paint: SvgPaint, color: string): void;
}) {
  const [state, setState] = useState<{ status: "loading" | "ready" | "error"; paints: SvgPaint[]; message?: string }>({ status: "loading", paints: [] });

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading", paints: [] });
    void fetch(`/api/project/assets/${asset.digest}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("SVG source is unavailable.");
        const paints = extractSvgPaints(await response.text());
        setState({
          status: "ready",
          paints,
          ...(paints.length === 0 ? { message: "No editable literal fills or strokes. Paint servers, currentColor, and keywords stay unchanged." } : {}),
        });
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ status: "error", paints: [], message: error instanceof Error ? error.message : "SVG paints could not be inspected." });
      });
    return () => controller.abort();
  }, [asset.digest]);

  return (
    <section aria-label={`Paints in ${asset.name}`} data-testid="svg-paint-editor" className="mt-2 rounded-md border border-[var(--line)] bg-[var(--canvas)] p-2">
      <div className="flex items-center justify-between gap-2">
        <strong className="text-[9px] font-semibold text-[var(--muted)]">Editable SVG paints</strong>
        {state.status === "ready" && state.paints.length > 0 ? <span className="font-mono text-[8px] tabular-nums text-[var(--faint)]">{state.paints.length} color{state.paints.length === 1 ? "" : "s"}</span> : null}
      </div>
      {state.status === "loading" ? <p role="status" className="mt-1.5 text-[9px] text-[var(--faint)]">Inspecting fills and strokes…</p> : null}
      {state.message ? <p role={state.status === "error" ? "alert" : "status"} className={`mt-1.5 text-[9px] leading-relaxed ${state.status === "error" ? "text-[var(--danger)]" : "text-[var(--faint)]"}`}>{state.message}</p> : null}
      {state.paints.length > 0 ? (
        <div className="mt-1.5 grid gap-1">
          {state.paints.map((paint) => (
            <label key={paint.normalized} className="flex min-h-8 items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--field)] px-2 text-[9px] text-[var(--muted)]">
              <input
                type="color"
                aria-label={`Recolor ${paint.normalized} in ${asset.name}`}
                value={paint.normalized.slice(0, 7)}
                disabled={disabled}
                onChange={(event) => onRecolor(paint, event.target.value)}
                className="size-5 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0 disabled:cursor-not-allowed"
              />
              <span className="min-w-0 flex-1"><span className="block font-mono text-[9px] font-semibold text-[var(--ink)]">{paint.normalized}</span><span className="block truncate text-[8px] text-[var(--faint)]">{paint.properties.join(" + ")} · {paint.usages} use{paint.usages === 1 ? "" : "s"}</span></span>
              {paint.normalized.length === 9 ? <span className="rounded bg-[var(--chip)] px-1 py-0.5 font-mono text-[7px] uppercase text-[var(--faint)]">alpha</span> : null}
            </label>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function AssetPolicyEditor({
  asset,
  onChange,
}: {
  asset: SemanticInterfaceGraph["assets"][number];
  onChange(mutate: (asset: SemanticInterfaceGraph["assets"][number]) => void, notice: string): void;
}) {
  const [licenseName, setLicenseName] = useState(asset.license.name);
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setLicenseName(asset.license.name); }, [asset.license.name]);
  const commitLicense = () => {
    const next = licenseName.trim();
    if (next && next !== asset.license.name) onChange((draft) => { draft.license.name = next; }, `Updated ${asset.name} license.`);
    else setLicenseName(asset.license.name);
  };
  return (
    <details className="mt-2 rounded-md border border-[var(--line)] px-2 py-1.5 text-[9px] text-[var(--muted)]">
      <summary className="cursor-pointer font-semibold">License and export</summary>
      <div className="mt-2 grid gap-2">
        <label className="grid gap-1">License name<input value={licenseName} onFocus={() => { focused.current = true; }} onChange={(event) => setLicenseName(event.target.value)} onBlur={() => { focused.current = false; commitLicense(); }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} className="min-h-7 rounded-md border border-[var(--line)] bg-[var(--canvas)] px-2 text-[10px] text-[var(--ink)] outline-none focus:border-[var(--accent)]" /></label>
        <label className="grid gap-1">Redistribution<select value={asset.license.redistribution} onChange={(event) => onChange((draft) => { draft.license.redistribution = event.target.value as typeof draft.license.redistribution; if (draft.license.redistribution !== "allowed" && draft.exportPolicy === "copy") draft.exportPolicy = "reference"; }, `Updated ${asset.name} redistribution policy.`)} className="select-control min-h-7 text-[10px]"><option value="allowed">Allowed</option><option value="restricted">Restricted</option><option value="unknown">Unknown</option></select></label>
        <label className="grid gap-1">Export policy<select value={asset.exportPolicy} onChange={(event) => onChange((draft) => { draft.exportPolicy = event.target.value as typeof draft.exportPolicy; }, `Updated ${asset.name} export policy.`)} className="select-control min-h-7 text-[10px]"><option value="reference">Reference</option><option value="blocked">Blocked</option><option value="copy" disabled={asset.license.redistribution !== "allowed"}>Copy into output</option></select></label>
      </div>
    </details>
  );
}

function TokenNumberField({
  label,
  value,
  min = 0,
  onCommit,
}: {
  label: string;
  value: number;
  min?: number;
  onCommit(next: number): void;
}) {
  const [draft, setDraft] = useState(String(value));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setDraft(String(value)); }, [value]);
  const commit = () => {
    const next = Number(draft);
    if (Number.isFinite(next) && next >= min && next !== value) onCommit(next);
    else setDraft(String(value));
  };
  return (
    <label className="grid grid-cols-[1fr_76px] items-center gap-2 text-[11px] text-[var(--muted)]">
      <span className="truncate font-mono text-[11px]">{label}</span>
      <input
        type="number"
        min={min}
        value={draft}
        onFocus={() => { focused.current = true; }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => { focused.current = false; commit(); }}
        onKeyDown={(event) => { if (event.key === "Enter") (event.target as HTMLInputElement).blur(); }}
        className="min-h-8 rounded-lg border border-[var(--line)] bg-[var(--field)] px-2 text-right font-mono text-[11px] text-[var(--t-strong)] outline-none transition-colors hover:border-[var(--line-strong)] focus:border-[var(--accent)]"
      />
    </label>
  );
}

function TokenHexField({ label, value, onCommit }: { label: string; value: string; onCommit(next: string): void }) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  const composing = useRef(false);
  useEffect(() => { if (!focused.current && !composing.current) setDraft(value); }, [value]);
  const commit = (source = draft) => {
    const next = source.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(next) && next !== value) onCommit(next);
    else setDraft(value);
  };
  return <input
    aria-label={`Hex for ${label}`}
    value={draft}
    onFocus={() => { focused.current = true; }}
    onChange={(event) => setDraft(event.target.value)}
    onCompositionStart={() => { composing.current = true; }}
    onCompositionEnd={(event) => { composing.current = false; if (!focused.current) commit(event.currentTarget.value); }}
    onBlur={() => { focused.current = false; if (!composing.current) commit(); }}
    onKeyDown={(event) => { if (event.key === "Enter" && !composing.current) event.currentTarget.blur(); else if (event.key === "Escape") { setDraft(value); event.currentTarget.blur(); } }}
    className="min-h-8 rounded-lg border border-[var(--line)] bg-[var(--field)] px-2 font-mono text-[11px] text-[var(--t-strong)] outline-none transition-colors hover:border-[var(--line-strong)] focus:border-[var(--accent)]"
  />;
}

function TextDraft({ value, ariaLabel, onCommit }: { value: string; ariaLabel: string; onCommit(next: string): void }) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  const composing = useRef(false);
  useEffect(() => { if (!focused.current && !composing.current) setDraft(value); }, [value]);
  const commit = (source = draft) => {
    const next = source.trim();
    if (next !== value) onCommit(next);
    else setDraft(value);
  };
  return <input aria-label={ariaLabel} value={draft} onFocus={() => { focused.current = true; }} onChange={(event) => setDraft(event.target.value)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={(event) => { composing.current = false; if (!focused.current) commit(event.currentTarget.value); }} onBlur={() => { focused.current = false; if (!composing.current) commit(); }} onKeyDown={(event) => { if (event.key === "Enter" && !composing.current) event.currentTarget.blur(); else if (event.key === "Escape") { setDraft(value); event.currentTarget.blur(); } }} className="min-h-7 min-w-0 rounded-md border border-[var(--line)] bg-[var(--canvas)] px-2 font-mono text-[10px] text-[var(--ink)] outline-none focus:border-[var(--accent)]" />;
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
  onMoveNode,
  onNodeCommand,
  onInstantiateComponent,
  onCreateComponent,
  onUpdateComponent,
  onUpdateTokens,
  localProjectFingerprint,
  localProjectSaved,
  onUpdateAssets,
  onExternalAssetCommit,
  onPlaceAsset,
  onClose,
  onDismissMobile,
}: LayersPanelProps) {
  const [order, setOrder] = useState<string[]>(() => screen.nodes.map((node) => node.id));
  const [pageOrder, setPageOrder] = useState<string[]>(() => graph.screens.map((item) => item.id));
  const pagesListRef = useRef<HTMLDivElement>(null);
  const layersListRef = useRef<HTMLDivElement>(null);
  const layersScrollRef = useRef<HTMLDivElement>(null);
  const tokenFileRef = useRef<HTMLInputElement>(null);
  const assetFileRef = useRef<HTMLInputElement>(null);
  const replacingAssetId = useRef<string | null>(null);
  const retryReplacingAssetId = useRef<string | null>(null);
  const assetUploadController = useRef<AbortController | null>(null);
  const [tokenTransferStatus, setTokenTransferStatus] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const [assetTransferStatus, setAssetTransferStatus] = useState<{ kind: "working" | "success" | "error"; message: string } | null>(null);
  const [assetIntegrityRefresh, setAssetIntegrityRefresh] = useState(0);
  const [assetIntegrity, setAssetIntegrity] = useState<
    | { kind: "idle" | "loading"; diagnostics: AssetIntegrityDiagnostic[] }
    | { kind: "ready"; diagnostics: AssetIntegrityDiagnostic[] }
    | { kind: "error"; diagnostics: AssetIntegrityDiagnostic[]; message: string }
  >({ kind: "idle", diagnostics: [] });
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ nodeId: string; mode: "before" | "inside" } | null>(null);
  const [tokenQuery, setTokenQuery] = useState("");
  const [newTokenKey, setNewTokenKey] = useState("");
  const [newTokenValue, setNewTokenValue] = useState("");
  const [layerScroll, setLayerScroll] = useState({ top: 0, height: 480 });

  useEffect(() => {
    setOrder(screen.nodes.map((node) => node.id));
  }, [screen.id, screen.nodes]);

  useEffect(() => {
    setPageOrder(graph.screens.map((item) => item.id));
  }, [graph.screens]);

  useEffect(() => {
    const element = layersScrollRef.current;
    if (!element) return;
    const measure = () => setLayerScroll((current) => ({ ...current, height: element.clientHeight }));
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, [railTab]);

  useEffect(() => {
    if (!layerQuery) return;
    layersScrollRef.current?.scrollTo({ top: 0 });
    setLayerScroll((current) => ({ ...current, top: 0 }));
  }, [layerQuery]);

  useEffect(() => {
    if (railTab !== "assets" || !localProjectSaved || !localProjectFingerprint) {
      setAssetIntegrity({ kind: "idle", diagnostics: [] });
      return;
    }
    const controller = new AbortController();
    setAssetIntegrity((current) => ({ kind: "loading", diagnostics: current.diagnostics }));
    void fetch("/api/project/assets", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as unknown;
        if (!response.ok) {
          const message = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
            ? payload.error
            : "Asset integrity inspection failed.";
          throw new Error(message);
        }
        const snapshot = parseAssetIntegritySnapshot(payload);
        if (snapshot.fingerprint !== localProjectFingerprint) throw new Error("The local project changed during asset inspection. Check again.");
        setAssetIntegrity({ kind: "ready", diagnostics: snapshot.diagnostics });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setAssetIntegrity((current) => ({
          kind: "error",
          diagnostics: current.diagnostics,
          message: error instanceof Error ? error.message : "Asset integrity inspection failed.",
        }));
      });
    return () => controller.abort();
  }, [assetIntegrityRefresh, graph.assets, localProjectFingerprint, localProjectSaved, railTab]);

  const allNodes = useMemo(() => flattenSemanticNodes(screen.nodes), [screen.nodes]);
  const assetDiagnostics = useMemo(() => groupAssetIntegrityDiagnostics(assetIntegrity.diagnostics), [assetIntegrity.diagnostics]);
  const containerIds = useMemo(() => allNodes.filter(isContainerNode).map((node) => node.id), [allNodes]);
  const allLayersCollapsed = containerIds.length > 0 && containerIds.every((id) => collapsedIds.has(id));
  const nodesById = useMemo(() => new Map(allNodes.map((node) => [node.id, node])), [allNodes]);
  const nodeIndex = useMemo(() => buildNodeIndex(screen.nodes), [screen.nodes]);
  const query = layerQuery.trim().toLowerCase();
  const resolvedTokens = useMemo(() => resolveTokenMode(graph.tokens), [graph.tokens]);
  const tokenEntries = useMemo(() => Object.entries(resolvedTokens).flatMap(([group, values]) =>
    (Object.entries(values) as Array<[string, string | number]>).map(([key, value]) => ({ group: group as keyof typeof resolvedTokens, key, value }))), [resolvedTokens]);
  const filteredNodes = useMemo(() => query
    ? allNodes.filter((node) => `${node.intent.label ?? ""} ${nodeNames[node.kind]} ${node.id}`.toLowerCase().includes(query))
    : null, [allNodes, query]);
  const filteredWindow = virtualWindow(filteredNodes?.length ?? 0, layerScroll.top, layerScroll.height, 28);

  const commitOrder = () => {
    const current = screen.nodes.map((node) => node.id);
    if (order.length === current.length && order.every((id, index) => id === current[index])) return;
    onReorderNodes(screen.id, null, order);
  };

  const commitPageOrder = () => {
    const current = graph.screens.map((item) => item.id);
    if (pageOrder.length === current.length && pageOrder.every((id, index) => id === current[index])) return;
    onReorderScreens(pageOrder);
  };

  const importTokenFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      if (file.size > TOKEN_ASSET_LIMITS.maxDtcgBytes) throw new Error(`Token file exceeds ${TOKEN_ASSET_LIMITS.maxDtcgBytes} bytes.`);
      const result = importDtcg(JSON.parse(await file.text()));
      const candidate = structuredClone(graph);
      candidate.tokens = result.tokens;
      parseGraph(candidate);
      onUpdateTokens((tokens) => {
        tokens.defaultMode = result.tokens.defaultMode;
        tokens.activeMode = result.tokens.activeMode;
        tokens.modes = structuredClone(result.tokens.modes);
        tokens.aliases = structuredClone(result.tokens.aliases);
        tokens.deprecated = structuredClone(result.tokens.deprecated);
        tokens.extensions = structuredClone(result.tokens.extensions);
      }, "Imported DTCG 2025.10 tokens.");
      setTokenTransferStatus({ kind: "success", message: result.diagnostics[0]?.message ?? "Token import complete." });
    } catch (error) {
      setTokenTransferStatus({ kind: "error", message: error instanceof Error ? error.message : "Token import failed." });
    } finally {
      if (tokenFileRef.current) tokenFileRef.current.value = "";
    }
  };

  const exportTokenFile = () => {
    const content = serializeDtcg(graph.tokens);
    const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    const slug = graph.product.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "intentform";
    anchor.download = `${slug}.tokens.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setTokenTransferStatus({ kind: "success", message: "Exported deterministic DTCG 2025.10 JSON." });
  };

  const chooseAssetFile = (replacingId?: string) => {
    replacingAssetId.current = replacingId ?? null;
    assetFileRef.current?.click();
  };

  const importAssetFile = async (file: File | undefined) => {
    if (!file) return;
    if (!localProjectFingerprint || !localProjectSaved) {
      setAssetTransferStatus({ kind: "error", message: localProjectFingerprint ? "Save canvas changes before importing files." : "Open a local project before importing files." });
      return;
    }
    const replacingId = replacingAssetId.current;
    retryReplacingAssetId.current = replacingId;
    const replaced = replacingId ? graph.assets.find((asset) => asset.id === replacingId) : undefined;
    const controller = new AbortController();
    assetUploadController.current?.abort();
    assetUploadController.current = controller;
    setAssetTransferStatus({ kind: "working", message: `${replaced ? "Replacing" : "Importing"} ${file.name}…` });
    try {
      const imported = await importLocalAsset({
        file,
        graph,
        expectedFingerprint: localProjectFingerprint,
        ...(replacingId ? { replacingId } : {}),
        signal: controller.signal,
      });
      onExternalAssetCommit(imported.graph, imported.fingerprint, `${replaced ? "Replaced" : "Imported"} ${imported.asset.name} atomically.`);
      retryReplacingAssetId.current = null;
      setAssetTransferStatus({ kind: "success", message: `${imported.asset.name} is ready on the canvas.` });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        retryReplacingAssetId.current = null;
        setAssetTransferStatus({ kind: "success", message: "Asset import cancelled." });
        return;
      }
      setAssetTransferStatus({ kind: "error", message: error instanceof Error ? error.message : "Asset import failed." });
    } finally {
      replacingAssetId.current = null;
      if (assetUploadController.current === controller) assetUploadController.current = null;
      if (assetFileRef.current) assetFileRef.current.value = "";
    }
  };

  const removeUnusedAssets = () => {
    const used = new Set(graph.screens.flatMap((item) => flattenSemanticNodes(item.nodes)).flatMap((node) => node.asset ? [node.asset.assetId] : []));
    const unused = graph.assets.filter((asset) => !used.has(asset.id));
    if (unused.length === 0) {
      setAssetTransferStatus({ kind: "success", message: "Every asset is used by the document." });
      return;
    }
    onUpdateAssets((assets) => {
      for (let index = assets.length - 1; index >= 0; index -= 1) {
        if (!used.has(assets[index]!.id)) assets.splice(index, 1);
      }
    }, `Removed ${unused.length} unused asset manifest entr${unused.length === 1 ? "y" : "ies"}. Save before garbage collection.`);
    setAssetTransferStatus({ kind: "success", message: `Removed ${unused.length} unused asset entr${unused.length === 1 ? "y" : "ies"}.` });
  };

  const cleanAssetStore = async () => {
    if (!localProjectFingerprint || !localProjectSaved) return;
    setAssetTransferStatus({ kind: "working", message: "Cleaning unreferenced asset bytes…" });
    try {
      const response = await fetch(`/api/project/assets?expectedFingerprint=${encodeURIComponent(localProjectFingerprint)}`, { method: "DELETE" });
      const result = await response.json() as { error?: string; removed?: string[] };
      if (!response.ok || !result.removed) throw new Error(result.error ?? "Asset cleanup failed.");
      setAssetTransferStatus({ kind: "success", message: result.removed.length === 0 ? "The asset store is already clean." : `Removed ${result.removed.length} unreferenced file${result.removed.length === 1 ? "" : "s"}.` });
    } catch (error) {
      setAssetTransferStatus({ kind: "error", message: error instanceof Error ? error.message : "Asset cleanup failed." });
    }
  };

  const exportAsset = (asset: SemanticInterfaceGraph["assets"][number]) => {
    const anchor = document.createElement("a");
    anchor.href = `/api/project/assets/${asset.digest}`;
    const extension = asset.storageKey.split(".").at(-1) ?? "bin";
    anchor.download = `${asset.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "asset"}.${extension}`;
    anchor.click();
    setAssetTransferStatus({ kind: "success", message: `Exported ${asset.name} at intrinsic size.` });
  };

  const recolorSvg = async (asset: SemanticInterfaceGraph["assets"][number], paint: SvgPaint, color: string) => {
    try {
      setAssetTransferStatus({ kind: "working", message: `Recoloring ${asset.name}…` });
      const response = await fetch(`/api/project/assets/${asset.digest}`, { cache: "no-store" });
      if (!response.ok) throw new Error("The SVG source is missing or invalid.");
      const source = await response.text();
      const recolored = replaceSvgPaint(source, paint.normalized, color);
      if (recolored.replacements === 0) throw new Error(`The selected paint ${paint.normalized} is no longer present.`);
      replacingAssetId.current = asset.id;
      await importAssetFile(new File([recolored.source], `${asset.id}.svg`, { type: "image/svg+xml" }));
    } catch (error) {
      replacingAssetId.current = null;
      setAssetTransferStatus({ kind: "error", message: error instanceof Error ? error.message : "SVG recolor failed." });
    }
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

  const toggleCollapsed = (nodeId: string) => setCollapsedIds((current) => {
    const next = new Set(current);
    if (next.has(nodeId)) next.delete(nodeId);
    else next.add(nodeId);
    return next;
  });

  const focusAdjacentTreeItem = (current: HTMLElement, direction: -1 | 1) => {
    const items = [...(layersListRef.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [])];
    const index = items.indexOf(current);
    items[index + direction]?.focus();
  };

  const finishNodeDrop = (event: React.DragEvent<HTMLElement>, target: SemanticNode) => {
    event.preventDefault();
    event.stopPropagation();
    const sourceId = draggedNodeId ?? event.dataTransfer.getData("text/intentform-node");
    const mode = dropTarget?.nodeId === target.id ? dropTarget.mode : "before";
    setDraggedNodeId(null);
    setDropTarget(null);
    if (!sourceId || sourceId === target.id || target.editor?.locked || target.editor?.hidden) return;
    const targetLocation = findGraphNodeLocation(graph, target.id);
    if (!targetLocation) return;
    if (mode === "inside" && isContainerNode(target)) {
      onMoveNode(sourceId, target.id, target.children.length);
      setCollapsedIds((current) => {
        const next = new Set(current);
        next.delete(target.id);
        return next;
      });
      return;
    }
    onMoveNode(sourceId, targetLocation.parent?.id ?? null, targetLocation.index);
  };

  const layerRow = (node: SemanticNode, allowDrag: boolean, depth = 0) => {
    const stateVisible = isNodeVisible(node, activeVisualState);
    const nodeVisible = !node.editor?.hidden && stateVisible;
    const collapsed = collapsedIds.has(node.id);
    const canContain = isContainerNode(node);
    const draggable = allowDrag && !node.editor?.locked && !node.editor?.hidden;
    const currentDrop = dropTarget?.nodeId === node.id ? dropTarget.mode : null;
    return (
      <div
        role="treeitem"
        tabIndex={selectedNodeIds.includes(node.id) ? 0 : -1}
        data-testid={`layer-${node.id}`}
        data-state-visible={nodeVisible}
        data-drop-target={currentDrop ?? undefined}
        aria-selected={selectedNodeIds.includes(node.id)}
        aria-expanded={canContain ? !collapsed : undefined}
        draggable={draggable}
        onDragStart={(event) => {
          if (!draggable) { event.preventDefault(); return; }
          setDraggedNodeId(node.id);
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/intentform-node", node.id);
        }}
        onDragEnd={() => { setDraggedNodeId(null); setDropTarget(null); }}
        onDragOver={(event) => {
          if (!draggedNodeId || draggedNodeId === node.id || node.editor?.locked || node.editor?.hidden) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "move";
          const rect = event.currentTarget.getBoundingClientRect();
          const mode = canContain && event.clientX >= rect.left + Math.min(48, rect.width * 0.25) ? "inside" : "before";
          setDropTarget({ nodeId: node.id, mode });
        }}
        onDrop={(event) => finishNodeDrop(event, node)}
        onMouseEnter={() => onHoverNode(node.id)}
        onMouseLeave={() => onHoverNode(null)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            focusAdjacentTreeItem(event.currentTarget, event.key === "ArrowDown" ? 1 : -1);
          } else if (event.key === "ArrowRight" && canContain && collapsed) {
            event.preventDefault();
            toggleCollapsed(node.id);
          } else if (event.key === "ArrowLeft" && canContain && !collapsed) {
            event.preventDefault();
            toggleCollapsed(node.id);
          } else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelectNode(node.id, "replace");
          }
        }}
        className={`group relative flex h-7 w-full items-center rounded-[5px] text-left text-[11px] leading-[15px] outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--accent)] ${currentDrop === "inside" ? "bg-[var(--accent-soft)] ring-1 ring-inset ring-[var(--accent)]" : currentDrop === "before" ? "before:absolute before:inset-x-1 before:top-0 before:h-px before:bg-[var(--accent)]" : selectedNodeIds.includes(node.id) ? "bg-[var(--accent-soft)] font-medium text-[var(--accent-text)]" : nodeVisible ? "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]" : "text-[var(--faint)] hover:bg-[var(--hover)]"}`}
        style={{ paddingLeft: 6 + depth * 14 }}
      >
        <button type="button" aria-label={`${collapsed ? "Expand" : "Collapse"} ${node.intent.label ?? nodeNames[node.kind]}`} disabled={!canContain} onClick={() => canContain && toggleCollapsed(node.id)} className={`grid size-5 shrink-0 place-items-center rounded ${canContain ? "hover:bg-[var(--field)]" : "pointer-events-none opacity-0"}`}>{collapsed ? <CaretRight size={10} /> : <CaretDown size={10} />}</button>
        <button
          type="button"
          aria-pressed={selectedNodeIds.includes(node.id)}
          onClick={(event) => {
            onSelectNode(node.id, event.shiftKey ? "range" : event.metaKey || event.ctrlKey ? "toggle" : "replace");
            if (!event.shiftKey && !event.metaKey && !event.ctrlKey) onDismissMobile();
          }}
          className="flex min-w-0 flex-1 items-center gap-1.5 self-stretch text-left"
        >
          <DotsSixVertical size={11} className={`shrink-0 ${draggable ? "cursor-grab opacity-0 group-hover:opacity-45" : "opacity-0"}`} />
          <span className="shrink-0 opacity-70">{layerIcon(node)}</span>
          <span className="min-w-0 flex-1 truncate">{node.intent.label ?? nodeNames[node.kind]}</span>
        </button>
        <button type="button" aria-label={`${node.editor?.locked ? "Unlock" : "Lock"} ${node.intent.label ?? nodeNames[node.kind]}`} aria-pressed={Boolean(node.editor?.locked)} onClick={() => onNodeCommand("toggle-lock", node.id)} className={`grid size-6 shrink-0 place-items-center rounded hover:bg-[var(--field)] ${node.editor?.locked ? "opacity-80" : "opacity-0 group-hover:opacity-60 group-focus-within:opacity-60"}`}>{node.editor?.locked ? <Lock size={11} /> : <LockOpen size={11} />}</button>
        <button type="button" aria-label={`${node.editor?.hidden ? "Show" : "Hide"} ${node.intent.label ?? nodeNames[node.kind]}`} aria-pressed={Boolean(node.editor?.hidden)} onClick={() => onNodeCommand("toggle-hidden", node.id)} className={`grid size-6 shrink-0 place-items-center rounded hover:bg-[var(--field)] ${node.editor?.hidden || !stateVisible ? "opacity-80" : "opacity-0 group-hover:opacity-60 group-focus-within:opacity-60"}`}>{nodeVisible ? <Eye size={11} /> : <EyeSlash size={11} />}</button>
      </div>
    );
  };

  const nestedRows = (node: SemanticNode, depth: number): React.ReactNode => collapsedIds.has(node.id) ? null : node.children.map((child) => (
    <div key={child.id} role="none">
      {layerRow(child, true, depth)}
      {nestedRows(child, depth + 1)}
    </div>
  ));

  return (
    <aside
      id="editor-structure-panel"
      role={visible ? "dialog" : undefined}
      aria-modal={visible ? "true" : undefined}
      aria-label="Pages and layers"
      className={`${visible ? "grid" : "hidden"} ${desktopVisible ? "xl:grid" : "xl:hidden"} absolute inset-y-0 left-0 z-[3] w-[268px] min-h-0 grid-rows-[auto_1fr] border-r border-[var(--line)] bg-[var(--chrome)] shadow-[24px_0_52px_-32px_var(--shadow-strong)] xl:relative xl:z-[3] xl:w-auto xl:shadow-none`}
    >
      <div className="grid h-[34px] grid-cols-[minmax(0,1fr)_28px] items-center border-b border-[var(--line)] px-2">
        <div className="flex min-w-0 items-center gap-0.5" role="tablist" aria-label="Left panel sections">
          {([
            ["layers", "Layers", TreeStructure],
            ["components", "Components", Stack],
            ["assets", "Assets", UploadSimple],
            ["tokens", "Tokens", Selection],
          ] as const).map(([tab, label, TabIcon], tabIndex, tabs) => (
            <button
              key={tab}
              id={`editor-${tab}-tab`}
              type="button"
              role="tab"
              aria-label={label}
              aria-selected={railTab === tab}
              aria-controls={`editor-${tab}-tabpanel`}
              tabIndex={railTab === tab ? 0 : -1}
              onClick={() => onRailTab(tab)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                event.preventDefault();
                const delta = event.key === "ArrowRight" ? 1 : -1;
                const next = tabs[(tabIndex + delta + tabs.length) % tabs.length]![0];
                onRailTab(next);
                requestAnimationFrame(() => document.getElementById(`editor-${next}-tab`)?.focus());
              }}
              title={label}
              className={`flex h-7 min-w-7 items-center justify-center gap-1 rounded-[5px] px-1.5 text-[10.5px] font-medium leading-[15px] transition-colors ${railTab === tab ? "bg-[var(--accent-soft)] text-[var(--accent-text)]" : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"}`}
            >
              <TabIcon size={13} weight={railTab === tab ? "fill" : "regular"} />
              {railTab === tab ? <span className="truncate">{label}</span> : null}
            </button>
          ))}
        </div>
        <IconButton ariaLabel="Close pages and layers" onClick={onClose} size={7}><X size={13} /></IconButton>
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
                    <div className={`group relative flex h-7 items-center overflow-hidden rounded-[5px] ${active ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--hover)]"}`}>
                      <button
                        type="button"
                        onClick={() => { onSelectScreen(item.id); onSelectNode(item.nodes[0]?.id ?? null, "replace"); onDismissMobile(); }}
                        className={`flex h-7 min-w-0 flex-1 items-center gap-2 pl-2 pr-2 text-left text-[11px] leading-[15px] ${active ? "font-medium text-[var(--accent-text)]" : "font-normal text-[var(--muted)] group-hover:text-[var(--ink)]"}`}
                      >
                        <FrameCorners size={13} className="shrink-0 opacity-70" />
                        <span className="min-w-0 flex-1 truncate">{item.title}</span>
                        {flattenSemanticNodes(item.nodes).length > 0 ? <span className="shrink-0 font-mono text-[9.5px] text-[var(--faint)] transition-opacity group-hover:opacity-0">{flattenSemanticNodes(item.nodes).length}</span> : null}
                      </button>
                      <span className={`pointer-events-none absolute inset-y-0 right-0 flex items-center gap-0.5 pl-3 pr-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 ${active ? "bg-gradient-to-l from-[var(--accent-soft)] via-[var(--accent-soft)] to-transparent" : "bg-gradient-to-l from-[var(--hover)] via-[var(--hover)] to-transparent"}`}>
                        <button type="button" aria-label={`Move screen ${item.title} up`} disabled={pageOrder.indexOf(item.id) === 0} onClick={() => movePage(item.id, -1)} className="pointer-events-auto grid size-6 place-items-center rounded-md text-[var(--muted)] hover:bg-[var(--field)] hover:text-[var(--ink)] disabled:opacity-25"><ArrowUp size={12} /></button>
                        <button type="button" aria-label={`Move screen ${item.title} down`} disabled={pageOrder.indexOf(item.id) === pageOrder.length - 1} onClick={() => movePage(item.id, 1)} className="pointer-events-auto grid size-6 place-items-center rounded-md text-[var(--muted)] hover:bg-[var(--field)] hover:text-[var(--ink)] disabled:opacity-25"><ArrowDown size={12} /></button>
                        <button type="button" aria-label={`Duplicate screen ${item.title}`} onClick={() => onDuplicateScreen(item.id)} className="pointer-events-auto grid size-6 place-items-center rounded-md text-[var(--muted)] hover:bg-[var(--field)] hover:text-[var(--ink)]"><Copy size={12} /></button>
                        <button type="button" aria-label={`Delete screen ${item.title}`} disabled={graph.screens.length <= 1} onClick={() => onDeleteScreen(item.id)} className="pointer-events-auto grid size-6 place-items-center rounded-md text-[var(--muted)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] disabled:opacity-25"><Trash size={12} /></button>
                      </span>
                    </div>
                  </Reorder.Item>
                );
              })}
            </Reorder.Group>
          </div>

          <div className="px-2 pb-1 pt-1.5">
            <PanelHeading label="Layers" action={
              <IconButton
                ariaLabel={allLayersCollapsed ? "Expand all layers" : "Collapse all layers"}
                title={allLayersCollapsed ? "Expand all" : "Collapse all"}
                onClick={() => setCollapsedIds(allLayersCollapsed ? new Set() : new Set(containerIds))}
                size={7}
              ><CaretDoubleUp size={12} className={allLayersCollapsed ? "rotate-180" : ""} /></IconButton>
            } />
            <label className="mt-0.5 flex h-7 items-center gap-2 rounded-[5px] border border-[var(--line)] bg-[var(--field)] px-2 text-[var(--muted)] transition-colors focus-within:border-[var(--accent)] focus-within:shadow-[0_0_0_2px_color-mix(in_oklab,var(--accent)_12%,transparent)] hover:border-[var(--line-strong)]">
              <MagnifyingGlass size={13} aria-hidden="true" className="shrink-0" />
              <span className="sr-only">Search layers</span>
              <input aria-label="Search layers" value={layerQuery} onChange={(event) => onLayerQuery(event.target.value)} placeholder="Find a layer" className="min-w-0 flex-1 bg-transparent text-[11px] text-[var(--t-strong)] outline-none placeholder:text-[var(--faint)]" />
              {layerQuery ? <button type="button" aria-label="Clear layer search" onClick={() => onLayerQuery("")} className="grid size-5 shrink-0 place-items-center rounded hover:bg-[var(--hover)]"><X size={11} /></button> : null}
            </label>
          </div>

          <div ref={layersScrollRef} onScroll={(event) => setLayerScroll((current) => ({ ...current, top: event.currentTarget.scrollTop }))} className="min-h-0 overflow-y-auto overflow-x-hidden px-2 pb-2 pt-1">
            {filteredNodes ? (
              <div ref={layersListRef} role="tree" aria-label="Filtered layers" className="grid grid-cols-1 gap-px">
                <div role="none" aria-hidden="true" style={{ height: filteredWindow.before }} />
                {filteredNodes.slice(filteredWindow.start, filteredWindow.end).map((node) => layerRow(node, false, (nodeIndex.get(node.id)?.depth ?? 1) - 1))}
                <div role="none" aria-hidden="true" style={{ height: filteredWindow.after }} />
                {filteredNodes.length === 0 ? <div className="mx-1 mt-3 rounded-lg border border-dashed border-[var(--line-strong)] px-3 py-5 text-center text-[11px] leading-relaxed text-[var(--muted)]">No layers match “{layerQuery}”.</div> : null}
              </div>
            ) : (
              <Reorder.Group ref={layersListRef} role="tree" aria-label="Layers" axis="y" as="div" values={order} onReorder={setOrder} className="relative grid grid-cols-1 gap-px">
                {order.map((nodeId) => {
                  const node = nodesById.get(nodeId);
                  if (!node) return null;
                  return (
                    <Reorder.Item
                      key={nodeId}
                      value={nodeId}
                      as="div"
                      role="none"
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
      ) : railTab === "components" ? (
        <div id="editor-components-tabpanel" role="tabpanel" aria-labelledby="editor-components-tab" className="min-h-0 overflow-y-auto overflow-x-hidden" data-testid="component-library-panel">
          <section className="border-b border-[var(--line)] px-3 pb-3 pt-2">
            <PanelHeading label="Local components" action={<button type="button" disabled={selectedNodeIds.length !== 1} onClick={() => {
              const selected = selectedNodeIds[0] ? findGraphNodeLocation(graph, selectedNodeIds[0])?.node : undefined;
              if (selected) onCreateComponent(selected.id, selected.intent.label ?? selected.intent.purpose);
            }} className="inline-flex min-h-7 items-center gap-1 rounded-lg border border-[var(--line)] px-2 text-[9px] font-semibold text-[var(--muted)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-40"><Plus size={11} /> Create</button>} />
            <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--faint)]">Versioned semantic definitions expand deterministically into every enabled compiler.</p>
            <p className="mt-1 text-[10px] leading-relaxed text-[var(--muted)]">Select one layer, then create a reusable definition with a typed label property and content slot.</p>
          </section>
          <div className="grid gap-2 p-2">
            {graph.components.map((definition) => (
              <article key={definition.id} className="rounded-xl border border-[var(--line)] bg-[var(--field)] p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <strong className="block truncate text-[12px] font-semibold text-[var(--ink)]">{definition.name}</strong>
                    <span className="mt-0.5 block font-mono text-[9px] text-[var(--faint)]">v{definition.version}</span>
                  </div>
                  <button
                    type="button"
                    disabled={Boolean(definition.deprecated)}
                    aria-label={`Insert ${definition.name}`}
                    onClick={() => onInstantiateComponent(definition.id)}
                    className="inline-flex min-h-7 shrink-0 items-center gap-1 rounded-lg bg-[var(--accent-soft)] px-2 text-[10px] font-semibold text-[var(--accent-text)] hover:bg-[var(--accent)] hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <Plus size={11} /> Insert
                  </button>
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-[var(--muted)]">{definition.description}</p>
                <div className="mt-2 flex flex-wrap gap-1 font-mono text-[9px] text-[var(--faint)]">
                  <span>{definition.properties.length} props</span><span>·</span>
                  <span>{definition.slots.length} slots</span><span>·</span>
                  <span>{definition.variants.length} variants</span>
                </div>
                {(() => {
                  const sources = graph.dependencies.flatMap((dependency) => dependency.exports
                    .filter((exportPath) => /^[a-z][a-z0-9/-]*$/.test(exportPath))
                    .map((exportPath) => ({ dependency, exportPath })));
                  const binding = definition.codeBindings[0];
                  return (
                    <details className="mt-2 rounded-md border border-[var(--line)] px-2 py-1.5 text-[9px] text-[var(--muted)]">
                      <summary className="cursor-pointer font-semibold">Web code binding {binding ? "· active" : ""}</summary>
                      {sources.length > 0 ? <div className="mt-2 grid gap-2">
                        <label className="grid gap-1">Signed package export
                          <select value={binding ? `${binding.dependencyId}|${binding.exportPath}` : ""} onChange={(event) => {
                            const [dependencyId, exportPath] = event.target.value.split("|");
                            const next = structuredClone(definition);
                            next.codeBindings = dependencyId && exportPath ? [{ target: "web", dependencyId, exportPath, exportName: "Component", propertyMap: {} }] : [];
                            onUpdateComponent(next);
                          }} className="select-control min-h-7 text-[10px]"><option value="">Semantic output</option>{sources.map(({ dependency, exportPath }) => <option key={`${dependency.id}/${exportPath}`} value={`${dependency.id}|${exportPath}`}>{dependency.id}/{exportPath}</option>)}</select>
                        </label>
                        {binding ? <TextDraft value={binding.exportName} ariaLabel={`Code export name for ${definition.name}`} onCommit={(value) => {
                          if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) return;
                          const next = structuredClone(definition);
                          next.codeBindings[0]!.exportName = value;
                          onUpdateComponent(next);
                        }} /> : null}
                        {binding && definition.properties.length > 0 ? <div className="grid gap-1">{definition.properties.map((property) => <label key={property.name} className="grid grid-cols-[1fr_1fr] items-center gap-2"><span className="font-mono">{property.name}</span><TextDraft value={Object.entries(binding.propertyMap).find(([, componentProperty]) => componentProperty === property.name)?.[0] ?? ""} ariaLabel={`Code property for ${property.name}`} onCommit={(value) => {
                          const next = structuredClone(definition);
                          const map = next.codeBindings[0]!.propertyMap;
                          for (const [key, componentProperty] of Object.entries(map)) if (componentProperty === property.name) delete map[key];
                          if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) map[value] = property.name;
                          onUpdateComponent(next);
                        }} /></label>)}</div> : null}
                      </div> : <p className="mt-2 leading-relaxed text-[var(--faint)]">Install a signed package with a module export before registering a code component.</p>}
                    </details>
                  );
                })()}
                {definition.deprecated ? <p className="mt-2 rounded-md bg-[var(--warn-soft)] px-2 py-1.5 text-[10px] leading-relaxed text-[var(--warn)]">Deprecated · {definition.deprecated.message}</p> : null}
              </article>
            ))}
            {graph.components.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[var(--line-strong)] px-3 py-8 text-center text-[11px] leading-relaxed text-[var(--muted)]">This project has no local component definitions yet.</div>
            ) : null}
          </div>
        </div>
      ) : railTab === "assets" ? (
        <div id="editor-assets-tabpanel" role="tabpanel" aria-labelledby="editor-assets-tab" className="min-h-0 overflow-y-auto overflow-x-hidden" data-testid="asset-library-panel">
          <section className="border-b border-[var(--line)] px-3 pb-3 pt-2">
            <PanelHeading
              label="Project assets"
              action={<div className="flex gap-1"><button type="button" title={localProjectSaved ? "Import a local asset" : "Save canvas changes before importing"} disabled={!localProjectFingerprint || !localProjectSaved || assetTransferStatus?.kind === "working"} onClick={() => chooseAssetFile()} className="inline-flex min-h-7 items-center gap-1 rounded-lg border border-[var(--line)] px-2 text-[9px] font-semibold text-[var(--muted)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-40"><UploadSimple size={11} /> Import</button><button type="button" disabled={graph.assets.length === 0} onClick={removeUnusedAssets} className="inline-flex min-h-7 items-center gap-1 rounded-lg border border-[var(--line)] px-2 text-[9px] font-semibold text-[var(--muted)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-40"><Trash size={11} /> Unused</button><button type="button" title={localProjectSaved ? "Delete bytes not referenced by the saved manifest" : "Save before cleaning the asset store"} disabled={!localProjectSaved || assetTransferStatus?.kind === "working"} onClick={() => void cleanAssetStore()} className="inline-flex min-h-7 items-center rounded-lg border border-[var(--line)] px-2 text-[9px] font-semibold text-[var(--muted)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-40">Clean</button></div>}
            />
            <input ref={assetFileRef} type="file" aria-label="Import project asset" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml,video/mp4,video/webm,audio/mpeg,audio/ogg,audio/wav,font/woff,font/woff2,font/ttf,font/otf" className="sr-only" onChange={(event) => void importAssetFile(event.target.files?.[0])} />
            <p className="mt-1 text-[11px] leading-relaxed text-[var(--faint)]">Digest-verified local files with explicit license and export policy. Drag visual assets onto the canvas.</p>
            {localProjectFingerprint ? (
              <div className={`mt-2 flex min-h-8 items-center justify-between gap-2 rounded-md px-2 text-[9.5px] ${assetIntegrity.kind === "error" || assetIntegrity.diagnostics.some((item) => item.severity === "error") ? "bg-[var(--danger-soft)] text-[var(--danger)]" : assetIntegrity.diagnostics.length > 0 ? "bg-[var(--warn-soft)] text-[var(--warn)]" : "bg-[var(--canvas)] text-[var(--muted)]"}`} data-testid="asset-integrity-status">
                <span className="min-w-0 flex-1 leading-relaxed">
                  {assetIntegrity.kind === "loading" ? "Checking stored bytes…" : assetIntegrity.kind === "error" ? assetIntegrity.message : assetIntegrity.kind === "ready" && assetIntegrity.diagnostics.length === 0 ? "All stored asset bytes match their manifests." : assetIntegrity.kind === "ready" ? `${assetIntegrity.diagnostics.length} integrity or policy finding${assetIntegrity.diagnostics.length === 1 ? "" : "s"}.` : "Save the project to check stored bytes."}
                </span>
                <button type="button" disabled={assetIntegrity.kind === "loading" || !localProjectSaved} onClick={() => setAssetIntegrityRefresh((value) => value + 1)} className="shrink-0 rounded border border-current/20 px-1.5 py-1 font-semibold disabled:opacity-40">Check</button>
              </div>
            ) : null}
            {assetTransferStatus ? <p role={assetTransferStatus.kind === "error" ? "alert" : "status"} className={`mt-2 flex items-start gap-1.5 rounded-lg px-2 py-1.5 text-[10px] leading-relaxed ${assetTransferStatus.kind === "error" ? "bg-[var(--danger-soft)] text-[var(--danger)]" : "bg-[var(--accent-soft)] text-[var(--accent-text)]"}`}>{assetTransferStatus.kind === "error" ? <WarningCircle className="mt-0.5 shrink-0" size={11} /> : null}<span className="min-w-0 flex-1">{assetTransferStatus.message}</span>{assetTransferStatus.kind === "working" ? <button type="button" onClick={() => assetUploadController.current?.abort()} className="shrink-0 font-semibold underline">Cancel</button> : assetTransferStatus.kind === "error" && localProjectSaved ? <button type="button" onClick={() => chooseAssetFile(retryReplacingAssetId.current ?? undefined)} className="shrink-0 font-semibold underline">Choose again</button> : null}</p> : null}
          </section>
          <div className="grid gap-2 p-2">
            {graph.assets.map((asset) => {
              const diagnostics = assetDiagnostics.get(asset.id) ?? [];
              const blocked = hasBlockingAssetIntegrityIssue(diagnostics);
              return (
              <article
                key={asset.id}
                draggable={!blocked && ["raster", "svg", "icon"].includes(asset.kind)}
                onDragStart={(event) => { event.dataTransfer.effectAllowed = "copy"; event.dataTransfer.setData("application/x-intentform-asset", asset.id); }}
                className={`rounded-lg border bg-[var(--field)] p-2.5 ${blocked ? "border-[var(--danger)]/45" : "border-[var(--line)]"}`}
              >
                <AssetThumbnail asset={asset} />
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <strong className="block truncate text-[12px] font-semibold text-[var(--ink)]">{asset.name}</strong>
                    <span className="mt-0.5 block font-mono text-[9px] text-[var(--faint)]">{asset.kind} · {Math.ceil(asset.byteLength / 1024)} KB</span>
                  </div>
                  <span className={`rounded-md px-1.5 py-1 font-mono text-[8px] uppercase ${asset.exportPolicy === "copy" ? "bg-[var(--accent-soft)] text-[var(--accent-text)]" : asset.exportPolicy === "blocked" ? "bg-[var(--warn-soft)] text-[var(--warn)]" : "bg-[var(--chip)] text-[var(--muted)]"}`}>{asset.exportPolicy}</span>
                </div>
                <p className="mt-2 truncate font-mono text-[9px] text-[var(--faint)]">sha256 {asset.digest.slice(0, 12)}…</p>
                <p className="mt-2 text-[10px] leading-relaxed text-[var(--muted)]">{asset.license.name} · redistribution {asset.license.redistribution}</p>
                {asset.width && asset.height ? <p className="mt-1 font-mono text-[9px] text-[var(--faint)]">{asset.width} × {asset.height}px</p> : null}
                {asset.variants.length > 0 ? <p className="mt-1 font-mono text-[9px] text-[var(--faint)]">{asset.variants.length} variant{asset.variants.length === 1 ? "" : "s"}</p> : null}
                {diagnostics.length > 0 ? (
                  <div className="mt-2 grid gap-1" aria-label={`Integrity findings for ${asset.name}`}>
                    {diagnostics.map((diagnostic) => <p key={`${diagnostic.variantId ?? "default"}:${diagnostic.code}`} className={`flex gap-1.5 rounded-md px-2 py-1.5 text-[9.5px] leading-relaxed ${diagnostic.severity === "error" ? "bg-[var(--danger-soft)] text-[var(--danger)]" : "bg-[var(--warn-soft)] text-[var(--warn)]"}`}><WarningCircle className="mt-0.5 shrink-0" size={10} /><span>{diagnostic.message}{diagnostic.variantId ? ` · ${diagnostic.variantId}` : ""}</span></p>)}
                  </div>
                ) : null}
                <div className="mt-2 grid grid-cols-4 gap-1">
                  <button type="button" title={blocked ? "Replace the missing or modified bytes before placing this asset" : undefined} disabled={blocked || !(["raster", "svg", "icon"].includes(asset.kind))} onClick={() => onPlaceAsset(asset.id)} className="min-h-7 rounded-md border border-[var(--line)] px-1 text-[9px] font-semibold text-[var(--muted)] hover:text-[var(--ink)] disabled:opacity-35">Place</button>
                  <button type="button" disabled={!localProjectFingerprint || !localProjectSaved} onClick={() => chooseAssetFile(asset.id)} className="min-h-7 rounded-md border border-[var(--line)] px-1 text-[9px] font-semibold text-[var(--muted)] hover:text-[var(--ink)] disabled:opacity-35">{blocked ? "Repair" : "Replace"}</button>
                  <button type="button" onClick={() => void navigator.clipboard.writeText(asset.id).then(() => setAssetTransferStatus({ kind: "success", message: `Copied ${asset.id}.` })).catch(() => setAssetTransferStatus({ kind: "error", message: "Clipboard access was denied." }))} className="min-h-7 rounded-md border border-[var(--line)] px-1 text-[9px] font-semibold text-[var(--muted)] hover:text-[var(--ink)]">Copy ref</button>
                  <button type="button" disabled={blocked || asset.kind === "font" || asset.exportPolicy === "blocked"} onClick={() => exportAsset(asset)} className="min-h-7 rounded-md border border-[var(--line)] px-1 text-[9px] font-semibold text-[var(--muted)] hover:text-[var(--ink)] disabled:opacity-35">Export</button>
                </div>
                {["svg", "icon"].includes(asset.kind) ? <SvgPaintEditor asset={asset} disabled={!localProjectFingerprint || !localProjectSaved || assetTransferStatus?.kind === "working"} onRecolor={(paint, color) => void recolorSvg(asset, paint, color)} /> : null}
                <AssetPolicyEditor asset={asset} onChange={(mutate, notice) => onUpdateAssets((assets) => { const draft = assets.find((candidate) => candidate.id === asset.id); if (draft) mutate(draft); }, notice)} />
              </article>
              );
            })}
            {graph.assets.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[var(--line-strong)] px-3 py-8 text-center text-[11px] leading-relaxed text-[var(--muted)]">{localProjectFingerprint ? "No project assets yet. Import an image, SVG, media file, or licensed font." : "Open a local project to import content-addressed assets."}</div>
            ) : null}
          </div>
        </div>
      ) : (
        <div id="editor-tokens-tabpanel" role="tabpanel" aria-labelledby="editor-tokens-tab" className="min-h-0 overflow-y-auto overflow-x-hidden">
          <section className="border-b border-[var(--line)] px-3 pb-3 pt-2">
            <PanelHeading
              label="DTCG 2025.10"
              action={<div className="flex gap-1"><button type="button" onClick={() => tokenFileRef.current?.click()} className="inline-flex min-h-7 items-center gap-1 rounded-lg border border-[var(--line)] px-2 text-[9px] font-semibold text-[var(--muted)] hover:text-[var(--ink)]"><UploadSimple size={11} /> Import</button><button type="button" onClick={exportTokenFile} className="inline-flex min-h-7 items-center gap-1 rounded-lg border border-[var(--line)] px-2 text-[9px] font-semibold text-[var(--muted)] hover:text-[var(--ink)]"><DownloadSimple size={11} /> Export</button></div>}
            />
            <input ref={tokenFileRef} type="file" aria-label="Import DTCG tokens" accept="application/json,.json,.tokens" className="sr-only" onChange={(event) => void importTokenFile(event.target.files?.[0])} />
            <p className="mt-1 text-[10px] leading-relaxed text-[var(--faint)]">Aliases, modes, deprecation, and vendor extensions round-trip through the stable community format.</p>
            {tokenTransferStatus ? <p role={tokenTransferStatus.kind === "error" ? "alert" : "status"} className={`mt-2 rounded-lg px-2 py-1.5 text-[10px] leading-relaxed ${tokenTransferStatus.kind === "error" ? "bg-[var(--danger-soft)] text-[var(--danger)]" : "bg-[var(--accent-soft)] text-[var(--accent-text)]"}`}>{tokenTransferStatus.message}</p> : null}
          </section>
          <section className="border-b border-[var(--line)] px-3 pb-3 pt-2">
            <PanelHeading
              label="Token mode"
              action={<button type="button" onClick={() => onUpdateTokens((tokens) => {
                let index = Object.keys(tokens.modes).length + 1;
                let id = `mode-${index}`;
                while (tokens.modes[id]) { index += 1; id = `mode-${index}`; }
                tokens.modes[id] = { name: `Mode ${index}`, values: {
                  colors: {}, spacing: {}, radii: {}, fontFamilies: {}, fontWeights: {}, fontSizes: {}, lineHeights: {},
                  letterSpacing: {}, shadows: {}, opacity: {}, durations: {}, easings: {}, containers: {}, breakpoints: {}, zIndices: {},
                } };
                tokens.activeMode = id;
              }, "Created a token mode.")} className="rounded-lg border border-[var(--line)] px-2 py-1 text-[9px] font-semibold text-[var(--muted)] hover:text-[var(--ink)]">Add mode</button>}
            />
            <select
              aria-label="Active token mode"
              value={graph.tokens.activeMode}
              onChange={(event) => onUpdateTokens((tokens) => { tokens.activeMode = event.target.value; }, `Switched to ${event.target.value} token mode.`)}
              className="select-control mt-2 w-full font-mono text-[11px]"
            >
              {Object.entries(graph.tokens.modes).map(([id, mode]) => <option key={id} value={id}>{mode.name} · {id}</option>)}
            </select>
            {graph.tokens.activeMode !== graph.tokens.defaultMode ? (
              <button type="button" onClick={() => onUpdateTokens((tokens) => {
                const removed = tokens.activeMode;
                tokens.activeMode = tokens.defaultMode;
                delete tokens.modes[removed];
              }, "Removed the active token mode.")} className="mt-2 text-[9px] font-semibold text-[var(--danger)]">Remove active mode</button>
            ) : null}
          </section>
          <section className="border-b border-[var(--line)] px-3 pb-3 pt-2">
            <PanelHeading label="Color tokens" />
            <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--faint)]">Bound to every frame and compiled into both platforms.</p>
            <div className="mt-3 grid gap-2">
              {Object.entries(resolvedTokens.colors).filter(([key]) => !graph.tokens.aliases[key]).map(([key, value]) => (
                <div key={key} className="grid grid-cols-[28px_1fr_68px] items-center gap-2">
                  <input
                    type="color"
                    aria-label={`Pick ${key}`}
                    value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#397461"}
                    onChange={(event) => onUpdateTokens((tokens) => { tokens.modes[tokens.activeMode]!.values.colors[key] = event.target.value; }, `Set ${key}.`)}
                    className="h-8 w-full cursor-pointer rounded-lg border border-[var(--line)] bg-[var(--field)] p-0.5"
                  />
                  <span className="truncate font-mono text-[11px] text-[var(--muted)]">{key}</span>
                  <TokenHexField label={key} value={value} onCommit={(next) => onUpdateTokens((tokens) => { tokens.modes[tokens.activeMode]!.values.colors[key] = next; }, `Set ${key}.`)} />
                </div>
              ))}
            </div>
          </section>
          <section className="border-b border-[var(--line)] px-3 pb-3 pt-2">
            <PanelHeading label="Radii" />
            <div className="mt-2 grid gap-2">
              {Object.entries(resolvedTokens.radii).filter(([key]) => !graph.tokens.aliases[key]).map(([key, value]) => (
                <TokenNumberField key={key} label={key} value={value} onCommit={(next) => onUpdateTokens((tokens) => { tokens.modes[tokens.activeMode]!.values.radii[key] = next; }, `Set ${key} to ${next}.`)} />
              ))}
            </div>
          </section>
          <section className="px-3 pb-3 pt-2">
            <PanelHeading label="Spacing" />
            <div className="mt-2 grid gap-2">
              {Object.entries(resolvedTokens.spacing).filter(([key]) => !graph.tokens.aliases[key]).map(([key, value]) => (
                <TokenNumberField key={key} label={key} value={value} min={1} onCommit={(next) => onUpdateTokens((tokens) => { tokens.modes[tokens.activeMode]!.values.spacing[key] = next; }, `Set ${key} to ${next}.`)} />
              ))}
            </div>
            <div className="mt-4 border-t border-[var(--line)] pt-3" data-testid="expanded-token-editor">
              <PanelHeading label="All token families" />
              <label className="mt-2 flex h-8 items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--field)] px-2.5 text-[var(--muted)] focus-within:border-[var(--accent)]"><MagnifyingGlass size={12} /><input aria-label="Search tokens" value={tokenQuery} onChange={(event) => setTokenQuery(event.target.value)} placeholder="Search typography, motion, depth…" className="min-w-0 flex-1 bg-transparent text-[11px] text-[var(--ink)] outline-none" /></label>
              <div className="mt-2 grid max-h-72 gap-1 overflow-y-auto pr-1">
                {tokenEntries.filter(({ key, group }) => `${key} ${group}`.toLowerCase().includes(tokenQuery.trim().toLowerCase())).map(({ group, key, value }) => (
                  <div key={key} className="grid grid-cols-[1fr_86px_22px] items-center gap-1.5 rounded-md px-1 py-1 hover:bg-[var(--hover)]">
                    <div className="min-w-0"><span className="block truncate font-mono text-[10px] text-[var(--muted)]">{key}</span><span className="block truncate text-[8px] uppercase tracking-[.08em] text-[var(--faint)]">{group}</span></div>
                    {typeof value === "number" ? <input aria-label={`Value for ${key}`} type="number" value={value} onChange={(event) => {
                      const next = Number(event.target.value);
                      if (!Number.isFinite(next)) return;
                      onUpdateTokens((tokens) => { const groups = tokens.modes[tokens.activeMode]!.values as Record<string, Record<string, string | number> | undefined>; (groups[group] ??= {})[key] = next; }, `Set ${key} to ${next}.`);
                    }} className="min-h-7 min-w-0 rounded-md border border-[var(--line)] bg-[var(--canvas)] px-1.5 text-right font-mono text-[9px] text-[var(--ink)] outline-none focus:border-[var(--accent)]" /> : <TextDraft ariaLabel={`Value for ${key}`} value={value} onCommit={(next) => onUpdateTokens((tokens) => { const groups = tokens.modes[tokens.activeMode]!.values as Record<string, Record<string, string | number> | undefined>; (groups[group] ??= {})[key] = next; }, `Set ${key}.`)} />}
                    <button type="button" aria-label={`Remove ${key}`} onClick={() => onUpdateTokens((tokens) => { const groups = tokens.modes[tokens.activeMode]!.values as Record<string, Record<string, string | number> | undefined>; delete groups[group]?.[key]; }, `Removed ${key}.`)} className="grid size-5 place-items-center rounded text-[var(--faint)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"><Trash size={10} /></button>
                  </div>
                ))}
              </div>
              <div className="mt-2 grid grid-cols-[1fr_72px_auto] gap-1.5">
                <input aria-label="New token key" value={newTokenKey} onChange={(event) => setNewTokenKey(event.target.value)} placeholder="font.size.body" className="min-h-8 min-w-0 rounded-md border border-[var(--line)] bg-[var(--field)] px-2 font-mono text-[9px] text-[var(--ink)] outline-none focus:border-[var(--accent)]" />
                <input aria-label="New token value" value={newTokenValue} onChange={(event) => setNewTokenValue(event.target.value)} placeholder="16" className="min-h-8 min-w-0 rounded-md border border-[var(--line)] bg-[var(--field)] px-2 font-mono text-[9px] text-[var(--ink)] outline-none focus:border-[var(--accent)]" />
                <button type="button" onClick={() => {
                  const prefixes: Array<[string, keyof typeof resolvedTokens, "string" | "number"]> = [
                    ["font.family.", "fontFamilies", "string"], ["font.weight.", "fontWeights", "number"], ["font.size.", "fontSizes", "number"],
                    ["font.line-height.", "lineHeights", "number"], ["font.letter-spacing.", "letterSpacing", "number"], ["shadow.", "shadows", "string"],
                    ["opacity.", "opacity", "number"], ["duration.", "durations", "number"], ["easing.", "easings", "string"],
                    ["container.", "containers", "number"], ["breakpoint.", "breakpoints", "number"], ["z.", "zIndices", "number"],
                  ];
                  const match = prefixes.find(([prefix]) => newTokenKey.startsWith(prefix));
                  if (!match) { setTokenTransferStatus({ kind: "error", message: "Use a supported typography, shadow, opacity, duration, easing, container, breakpoint, or z-index prefix." }); return; }
                  const [, group, type] = match;
                  const value = type === "number" ? Number(newTokenValue) : newTokenValue.trim();
                  if ((type === "number" && !Number.isFinite(value)) || value === "") { setTokenTransferStatus({ kind: "error", message: "Enter a valid token value." }); return; }
                  onUpdateTokens((tokens) => { const groups = tokens.modes[tokens.activeMode]!.values as Record<string, Record<string, string | number> | undefined>; (groups[group] ??= {})[newTokenKey] = value; }, `Added ${newTokenKey}.`);
                  setNewTokenKey(""); setNewTokenValue(""); setTokenTransferStatus(null);
                }} className="min-h-8 rounded-md bg-[var(--accent-soft)] px-2 text-[9px] font-semibold text-[var(--accent-text)] hover:bg-[var(--accent)] hover:text-white">Add</button>
              </div>
            </div>
            {Object.keys(graph.tokens.aliases).length > 0 ? <div className="mt-4 rounded-lg border border-[var(--line)] bg-[var(--field)] p-2.5"><strong className="text-[9px] uppercase tracking-[.12em] text-[var(--faint)]">Aliases</strong>{Object.entries(graph.tokens.aliases).map(([key, target]) => <p key={key} className="mt-1 truncate font-mono text-[9px] text-[var(--muted)]">{key} → {target}{graph.tokens.deprecated[key] ? " · deprecated" : ""}</p>)}</div> : null}
            <div className="mt-4 rounded-lg bg-[var(--accent-soft)] p-3 text-[11px] leading-relaxed text-[var(--accent-text)]">
              Token edits are semantic changes: they land in the graph diff and recompile every enabled target deterministically.
            </div>
          </section>
        </div>
      )}
    </aside>
  );
}
