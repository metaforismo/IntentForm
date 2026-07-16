"use client";

import {
  ArrowClockwise,
  ArrowCounterClockwise,
  ArrowSquareOut,
  ArrowsCounterClockwise,
  ArrowsOutSimple,
  CaretDown,
  CheckCircle,
  Command,
  Copy,
  CurrencyEur,
  Cursor,
  CursorClick,
  DeviceMobile,
  DownloadSimple,
  FileText,
  FrameCorners,
  Hand,
  Keyboard,
  ListDashes,
  MagnifyingGlass,
  Minus,
  MonitorPlay,
  PaintBrush,
  Plus,
  Selection,
  ShieldCheck,
  Sparkle,
  Stack,
  TextT,
  Trash,
  TreeStructure,
  UserCircle,
  Wallet,
  WarningCircle,
  type Icon,
} from "@phosphor-icons/react";
import {
  flattenGraphNodes,
  flattenSemanticNodes,
  parseGraph,
  type ComponentOverride,
  type SemanticInterfaceGraph,
  type SemanticNode,
} from "@intentform/semantic-schema";
import {
  createComponentFromNode,
  detachComponentInstance,
  instantiateComponent,
  resetComponentInstance,
  setComponentOverride,
  setComponentProperty,
  setComponentState,
  setComponentVariant,
  updateComponentDefinition,
} from "@intentform/semantic-schema/component-library";
import { createGraphIndex, type GraphIndex } from "@intentform/graph-runtime";
import type { VerificationFinding } from "@intentform/verifier";
import type { DeviceBezelReference } from "@intentform/device-registry";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CanvasStage, type CanvasApi } from "./editor/canvas";
import { importLocalAsset } from "./editor/asset-import";
import { Inspector } from "./editor/inspector";
import { LayersPanel } from "./editor/layers-panel";
import { CommandMenu, ShortcutsSheet, type EditorCommand } from "./editor/overlays";
import { MultiDeviceComparison } from "./stages/multi-device-comparison";
import {
  defaultComparisonProfileIds,
  reconcileComparisonProfileIds,
  replaceComparisonProfile,
} from "./stages/workspace-model";
import {
  NODE_CLIPBOARD_MIME,
  STYLE_CLIPBOARD_MIME,
  createNodeClipboardPayload,
  createStyleClipboardPayload,
  parseNodeClipboardPayload,
  parseStyleClipboardPayload,
  pasteNodesTransaction,
  pasteStyleTransaction,
  plainTextFromHtml,
  serializeClipboardPayload,
  type NodeClipboardPayload,
  type PasteMode,
  type StyleClipboardPayload,
} from "./editor/clipboard";
import {
  duplicateNodesTransaction,
  duplicateNodeTransaction,
  duplicateScreenTransaction,
  editorTransactionError,
  insertionStateBindings,
  locateEditorNode,
  moveNodeTransaction,
  moveSelectionTransaction,
  removeNodesTransaction,
  removeNodeTransaction,
  reorderChildrenTransaction,
  setFreeformPositionsTransaction,
  updateNodeLayoutTransaction,
  wrapNodesTransaction,
} from "./editor/transactions";
import {
  normalizeNodeSelection,
  selectionParentId,
  updateNodeSelection,
  type Point,
  type ResizeCandidate,
  type SelectionIntent,
} from "./editor/direct-manipulation";
import {
  editorProfiles,
  isFormControl,
  isNodeVisible,
  nodeCatalog,
  nodeNames,
  withFixtureValue,
  type EditorTool,
  type DeviceId,
  type FrameStatus,
  type MobilePanel,
  type NodeCommand,
  type RailTab,
  type VisualState,
} from "./editor/support";

export type WorkflowStage = "brief" | "graph" | "outputs" | "verify" | "report";

interface ManualEditorProps {
  graph: SemanticInterfaceGraph;
  selectedScreen: string;
  selectedNodeId: string | null;
  canUndo: boolean;
  canRedo: boolean;
  findings: VerificationFinding[];
  deviceId: DeviceId;
  localProjectEnabled: boolean;
  localProjectFingerprint: string | null;
  localProjectSaved: boolean;
  onSelectScreen(screenId: string): void;
  onDeviceId(deviceId: DeviceId): void;
  onSelectNode(nodeId: string | null): void;
  onCommit(graph: SemanticInterfaceGraph, notice: string): void;
  onExternalAssetCommit(graph: SemanticInterfaceGraph, fingerprint: string, notice: string): void;
  onNotice(notice: string): void;
  onUndo(): void;
  onRedo(): void;
  onOpenStage(stage: WorkflowStage): void;
  onResetProject(): void;
  onExportGraph(): void;
}

interface LocalBezelPack {
  packId: string;
  version: string;
  name: string;
  publisher: string;
  revoked: boolean;
  manifestChecksum: string;
  license: { name: string; sourceUrl: string; termsAcknowledgement: string; redistribution: "local-reference-only" };
  profiles: Array<{
    deviceProfileId: string;
    asset: { digest: string; mediaType: "image/png" | "image/webp"; width: number; height: number };
    viewport: { x: number; y: number; width: number; height: number };
  }>;
}

interface LocalBezelResponse {
  enabled: boolean;
  packs: LocalBezelPack[];
  diagnostics: string[];
}

const catalogIcons: Record<SemanticNode["kind"], Icon> = {
  text: TextT,
  image: FrameCorners,
  shape: Selection,
  action: CursorClick,
  input: FileText,
  divider: Minus,
  spacer: ArrowsOutSimple,
  frame: FrameCorners,
  list: ListDashes,
  "primary-action": CursorClick,
  "secondary-action": Selection,
  "money-input": CurrencyEur,
  "balance-summary": Wallet,
  "transaction-list": ListDashes,
  "recipient-identity": UserCircle,
  "status-message": WarningCircle,
  "receipt-summary": CheckCircle,
  stack: Stack,
  grid: TreeStructure,
  overlay: Stack,
  scroll: ListDashes,
  "safe-area": FrameCorners,
  adaptive: ArrowsOutSimple,
  wrap: Stack,
  split: TreeStructure,
  freeform: Cursor,
  "page-flow": ListDashes,
};

const newNodeLayout = (kind: SemanticNode["kind"]): SemanticNode["layout"] => ({
  axis: "vertical",
  width: "fill",
  height: "hug",
  align: "stretch",
  justify: "start",
  overflow: kind === "scroll" ? "scroll" : "visible",
  columns: 2,
  splitRatio: 0.5,
  ...(kind === "adaptive" ? { adaptive: { compact: "stack" as const, regular: "grid" as const } } : {}),
  gapToken: "space.16",
  paddingToken: "space.20",
  ...(kind === "primary-action" ? { placement: { compact: "inline" as const, regular: "inline" as const } } : {}),
});

interface EditorComponentContext {
  rootId: string;
  targetId: string;
  definitionId: string;
}

function componentContextForNode(
  graph: SemanticInterfaceGraph,
  screen: SemanticInterfaceGraph["screens"][number],
  nodeId: string,
): EditorComponentContext | null {
  const visit = (nodes: readonly SemanticNode[], owner: EditorComponentContext | null): EditorComponentContext | null => {
    for (const node of nodes) {
      let current = owner;
      if (node.componentInstance) {
        const definition = graph.components.find((candidate) => candidate.id === node.componentInstance!.definitionId);
        if (definition) {
          current = { rootId: node.id, targetId: definition.template.id, definitionId: definition.id };
        }
      }
      if (node.id === nodeId) {
        if (!current) return null;
        return {
          ...current,
          targetId: node.id === current.rootId
            ? current.targetId
            : node.id.startsWith(`${current.rootId}.`) ? node.id.slice(current.rootId.length + 1) : current.targetId,
        };
      }
      const nested = visit(node.children, current);
      if (nested) return nested;
    }
    return null;
  };
  return visit(screen.nodes, null);
}

export function ManualEditor({
  graph,
  selectedScreen,
  selectedNodeId,
  canUndo,
  canRedo,
  findings,
  deviceId,
  localProjectEnabled,
  localProjectFingerprint,
  localProjectSaved,
  onSelectScreen,
  onDeviceId,
  onSelectNode,
  onCommit,
  onExternalAssetCommit,
  onNotice,
  onUndo,
  onRedo,
  onOpenStage,
  onResetProject,
  onExportGraph,
}: ManualEditorProps) {
  const [tool, setTool] = useState<EditorTool>("select");
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [zoomPct, setZoomPct] = useState(60);
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false);
  const [insertOpen, setInsertOpen] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>(null);
  const [desktopPanels, setDesktopPanels] = useState({ structure: true, inspector: true });
  const [railTab, setRailTab] = useState<RailTab>("layers");
  const [visualStateByScreen, setVisualStateByScreen] = useState<Record<string, VisualState>>({});
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [layerQuery, setLayerQuery] = useState("");
  const [previewMode, setPreviewMode] = useState(false);
  const [comparisonMode, setComparisonMode] = useState(false);
  const [comparisonProfileIds, setComparisonProfileIds] = useState<string[]>(() => defaultComparisonProfileIds(editorProfiles(graph)));
  const [showDeviceChrome, setShowDeviceChrome] = useState(true);
  const [localLicenseAcknowledged, setLocalLicenseAcknowledged] = useState(() => graph.devices.bezel?.acknowledgedLocalLicense === true);
  const [pendingBezelValue, setPendingBezelValue] = useState("");
  const [bezelPacks, setBezelPacks] = useState<LocalBezelPack[]>([]);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>(() => selectedNodeId ? [selectedNodeId] : []);
  const [panelWidths, setPanelWidths] = useState(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = JSON.parse(window.localStorage.getItem("intentform-panel-widths") ?? "") as { rail?: number; inspector?: number };
        return {
          rail: Math.min(380, Math.max(220, saved.rail ?? 268)),
          inspector: Math.min(420, Math.max(260, saved.inspector ?? 304)),
        };
      } catch {
        // Fall through to defaults when nothing valid is stored.
      }
    }
    return { rail: 268, inspector: 304 };
  });
  const canvasApi = useRef<CanvasApi>(null);
  const nodeClipboard = useRef<NodeClipboardPayload | null>(null);
  const styleClipboard = useRef<StyleClipboardPayload | null>(null);
  const pendingPasteMode = useRef<PasteMode>("after");
  const structureTriggerRef = useRef<HTMLButtonElement>(null);
  const inspectorTriggerRef = useRef<HTMLButtonElement>(null);
  const insertTriggerRef = useRef<HTMLButtonElement>(null);
  const zoomTriggerRef = useRef<HTMLButtonElement>(null);
  const previousMobilePanel = useRef<MobilePanel>(null);
  const previousInsertOpen = useRef(false);
  const previousZoomOpen = useRef(false);
  const panelLimits = {
    rail: { min: 220, max: 380 },
    inspector: { min: 260, max: 420 },
  } as const;

  useEffect(() => {
    try {
      window.localStorage.setItem("intentform-panel-widths", JSON.stringify(panelWidths));
    } catch {
      // Persisting panel sizes is best-effort.
    }
  }, [panelWidths]);

  useEffect(() => {
    const previous = previousMobilePanel.current;
    previousMobilePanel.current = mobilePanel;
    if (mobilePanel) {
      const panelId = mobilePanel === "structure" ? "editor-structure-panel" : "editor-inspector-panel";
      requestAnimationFrame(() => {
        const panel = document.getElementById(panelId);
        const close = panel?.querySelector<HTMLElement>('button[aria-label^="Close"]');
        const first = panel?.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)');
        (close ?? first)?.focus();
      });
      const trapFocus = (event: KeyboardEvent) => {
        if (event.key !== "Tab") return;
        const panel = document.getElementById(panelId);
        if (!panel) return;
        const items = [...panel.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')]
          .filter((item) => item.getClientRects().length > 0);
        const first = items[0];
        const last = items.at(-1);
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      };
      window.addEventListener("keydown", trapFocus);
      return () => window.removeEventListener("keydown", trapFocus);
    }
    if (previous === "structure") structureTriggerRef.current?.focus();
    if (previous === "inspector") inspectorTriggerRef.current?.focus();
  }, [mobilePanel]);

  useEffect(() => {
    const previous = previousInsertOpen.current;
    previousInsertOpen.current = insertOpen;
    if (insertOpen) requestAnimationFrame(() => document.querySelector<HTMLElement>('[role="menu"][aria-label="Insert semantic component"] [role="menuitem"]')?.focus());
    else if (previous) insertTriggerRef.current?.focus();
  }, [insertOpen]);

  useEffect(() => {
    const previous = previousZoomOpen.current;
    previousZoomOpen.current = zoomMenuOpen;
    if (zoomMenuOpen) requestAnimationFrame(() => document.querySelector<HTMLElement>('[role="menu"][aria-label="Choose zoom level"] [role="menuitem"]')?.focus());
    else if (previous) zoomTriggerRef.current?.focus();
  }, [zoomMenuOpen]);

  const beginPanelResize = (side: "rail" | "inspector") => (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = panelWidths[side];
    const onMove = (move: PointerEvent) => {
      const delta = move.clientX - startX;
      const next = side === "rail" ? startWidth + delta : startWidth - delta;
      setPanelWidths((current) => ({
        ...current,
        [side]: Math.min(panelLimits[side].max, Math.max(panelLimits[side].min, next)),
      }));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const resizePanelWithKeyboard = (side: "rail" | "inspector") => (event: React.KeyboardEvent<HTMLDivElement>) => {
    const limits = panelLimits[side];
    let next: number | null = null;
    if (event.key === "Home") next = limits.min;
    else if (event.key === "End") next = limits.max;
    else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const physicalDelta = event.key === "ArrowRight" ? 12 : -12;
      next = panelWidths[side] + (side === "rail" ? physicalDelta : -physicalDelta);
    }
    if (next === null) return;
    event.preventDefault();
    setPanelWidths((current) => ({
      ...current,
      [side]: Math.min(limits.max, Math.max(limits.min, next!)),
    }));
  };

  const graphIndexRef = useRef<GraphIndex | null>(null);
  const graphIndex = useMemo(() => {
    const next = createGraphIndex(graph, graphIndexRef.current ?? undefined);
    graphIndexRef.current = next;
    return next;
  }, [graph]);
  const screen = graphIndex.screenById.get(selectedScreen) ?? graph.screens[0];
  const selectedNodeLocation = selectedNodeId ? graphIndex.locationById.get(selectedNodeId) : undefined;
  const selectedNode = screen && selectedNodeLocation?.screenId === screen.id ? selectedNodeLocation.node : null;
  const selectedLocation = selectedNodeId ? locateEditorNode(graph, selectedNodeId) : null;
  const componentContext = screen && selectedNodeId
    ? componentContextForNode(graph, screen, selectedNodeId)
    : null;
  const profiles = useMemo(() => editorProfiles(graph), [graph]);
  const activeProfile = profiles.find((profile) => profile.id === deviceId) ?? profiles.find((profile) => profile.id === `web:${graph.web?.defaultFrame}`) ?? profiles[0]!;
  useEffect(() => {
    setComparisonProfileIds((current) => reconcileComparisonProfileIds(current, profiles));
  }, [profiles]);
  const availableBezels = useMemo(() => bezelPacks.flatMap((pack) => pack.profiles
    .filter((profile) => !pack.revoked && profile.deviceProfileId === activeProfile.registryId)
    .map((profile) => ({ pack, profile }))), [activeProfile.registryId, bezelPacks]);
  const activeBezel = graph.devices.bezel && graph.devices.bezel.deviceProfileId === activeProfile.registryId
    ? availableBezels.find(({ pack, profile }) => pack.packId === graph.devices.bezel?.packId
      && pack.manifestChecksum === graph.devices.bezel?.manifestChecksum
      && profile.asset.digest === graph.devices.bezel?.assetDigest)
    : undefined;
  const activeBezelValue = activeBezel ? `${activeBezel.pack.packId}:${activeBezel.profile.asset.digest}` : "";
  const pendingBezel = availableBezels.find(({ pack, profile }) => `${pack.packId}:${profile.asset.digest}` === pendingBezelValue);
  const selectedBezel = pendingBezel ?? activeBezel;
  const bezelOverlay = activeBezel && graph.devices.bezel ? {
    src: `/api/project/bezel-packs/${encodeURIComponent(activeBezel.pack.packId)}/${activeBezel.profile.asset.digest}?profile=${encodeURIComponent(activeBezel.profile.deviceProfileId)}&version=${encodeURIComponent(activeBezel.pack.version)}&manifest=${activeBezel.pack.manifestChecksum}&ack=1`,
    image: { width: activeBezel.profile.asset.width, height: activeBezel.profile.asset.height },
    viewport: activeBezel.profile.viewport,
  } : null;

  useEffect(() => {
    if (!localProjectEnabled) {
      setBezelPacks([]);
      return;
    }
    const controller = new AbortController();
    void fetch("/api/project/bezel-packs", { cache: "no-store", signal: controller.signal })
      .then(async (response) => response.ok ? await response.json() as LocalBezelResponse : null)
      .then((payload) => setBezelPacks(payload?.enabled ? payload.packs : []))
      .catch(() => setBezelPacks([]));
    return () => controller.abort();
  }, [localProjectEnabled]);

  const commitBezel = (selected: (typeof availableBezels)[number]) => {
    const next = structuredClone(graph);
    next.devices.bezel = {
      packId: selected.pack.packId,
      packVersion: selected.pack.version,
      manifestChecksum: selected.pack.manifestChecksum,
      deviceProfileId: selected.profile.deviceProfileId,
      assetDigest: selected.profile.asset.digest,
      acknowledgedLocalLicense: true,
    } satisfies DeviceBezelReference;
    setPendingBezelValue("");
    onCommit(parseGraph(next), `Selected local bezel pack ${selected.pack.name}; compilers remain unchanged.`);
  };

  const selectBezel = (value: string) => {
    if (!value) {
      setPendingBezelValue("");
      setLocalLicenseAcknowledged(false);
      if (graph.devices.bezel) {
        const next = structuredClone(graph);
        delete next.devices.bezel;
        onCommit(parseGraph(next), "Returned to the neutral device frame.");
      }
      return;
    }
    if (value === activeBezelValue) {
      setPendingBezelValue("");
      setLocalLicenseAcknowledged(true);
      return;
    }
    const selected = availableBezels.find(({ pack, profile }) => `${pack.packId}:${profile.asset.digest}` === value);
    if (!selected) return;
    setPendingBezelValue(value);
    setLocalLicenseAcknowledged(false);
    onNotice(`Review ${selected.pack.license.name}, then confirm local-only use to apply this bezel.`);
  };

  const acknowledgeBezel = (acknowledged: boolean) => {
    setLocalLicenseAcknowledged(acknowledged);
    if (acknowledged && pendingBezel) {
      commitBezel(pendingBezel);
    } else if (!acknowledged && activeBezel) {
      selectBezel("");
    }
  };

  useEffect(() => {
    const validIds = new Set(screen ? graphIndex.screenIndexes.get(screen.id)?.nodesById.keys() : []);
    setSelectedNodeIds((current) => {
      if (!selectedNodeId || !validIds.has(selectedNodeId)) return [];
      if (current.includes(selectedNodeId) && current.every((id) => validIds.has(id))) return current;
      return [selectedNodeId];
    });
  }, [graphIndex, screen, selectedNodeId]);

  const selectNode = useCallback((nodeId: string | null, intent: SelectionIntent = "replace") => {
    if (!nodeId) {
      setSelectedNodeIds([]);
      onSelectNode(null);
      return;
    }
    const targetScreenId = graphIndex.locationById.get(nodeId)?.screenId;
    const targetNode = graphIndex.locationById.get(nodeId)?.node;
    if (!targetNode || targetNode.editor?.locked || targetNode.editor?.hidden) return;
    const targetScreen = targetScreenId ? graphIndex.screenById.get(targetScreenId) : undefined;
    if (!targetScreen) return;
    const preorder = graphIndex.screenIndexes.get(targetScreen.id)?.nodes.map((node) => node.id) ?? [];
    const current = selectedNodeIds.filter((id) => preorder.includes(id));
    const next = updateNodeSelection(current, nodeId, preorder, intent);
    setSelectedNodeIds(next);
    onSelectNode(next.includes(nodeId) ? nodeId : next.at(-1) ?? null);
  }, [graphIndex, onSelectNode, selectedNodeIds]);

  const normalizedSelection = useMemo(
    () => screen ? normalizeNodeSelection(graph, screen.id, selectedNodeIds) : [],
    [graph, screen, selectedNodeIds],
  );

  const statusByScreen = useMemo(() => {
    const map = new Map<string, FrameStatus>();
    for (const finding of findings) {
      const entry = map.get(finding.screenId) ?? { errors: 0, warnings: 0 };
      if (finding.severity === "error") entry.errors += 1;
      else if (finding.severity === "warning") entry.warnings += 1;
      map.set(finding.screenId, entry);
    }
    return map;
  }, [findings]);

  const visualStateFor = useCallback((screenId: string): VisualState => {
    const contract = graphIndex.contractByScreenId.get(screenId);
    const available = (contract?.visualStates ?? ["idle"]) as VisualState[];
    const requested = visualStateByScreen[screenId];
    return requested && available.includes(requested) ? requested : available[0] ?? "idle";
  }, [graphIndex, visualStateByScreen]);

  const availableStates = ((graph.contracts.find((item) => item.screenId === screen?.id)?.visualStates ?? ["idle"])) as VisualState[];
  const activeVisualState = screen ? visualStateFor(screen.id) : "idle";

  /* Every mutation flows through the schema validator; a rejected draft never
     reaches the committed graph or the local draft. */
  const commitDraft = useCallback((draft: SemanticInterfaceGraph, notice: string) => {
    try {
      const validated = parseGraph(draft);
      onCommit(validated, notice);
      return validated;
    } catch (error) {
      onNotice(editorTransactionError(error));
      return null;
    }
  }, [onCommit, onNotice]);

  const updateNodeById = useCallback((nodeId: string, mutate: (node: SemanticNode) => void, notice: string) => {
    const draft = structuredClone(graph);
    const found = locateEditorNode(draft, nodeId);
    if (!found) return;
    const binding = componentContextForNode(draft, found.screen, nodeId);
    const before = structuredClone(found.node);
    mutate(found.node);
    if (binding) {
      const definitionLayout = (layout: SemanticNode["layout"]) => {
        const copy = structuredClone(layout) as Record<string, unknown>;
        for (const field of [
          "width", "height", "fixedWidth", "fixedHeight", "minWidth", "maxWidth", "minHeight", "maxHeight", "position", "placement",
        ] as const) delete copy[field];
        return copy;
      };
      const changesDefinitionOwnedFields = [
        "intent", "style", "accessibility", "web", "states", "interactions", "children", "componentInstance",
      ].some((field) => JSON.stringify(before[field as keyof SemanticNode]) !== JSON.stringify(found.node[field as keyof SemanticNode]))
        || JSON.stringify(definitionLayout(before.layout)) !== JSON.stringify(definitionLayout(found.node.layout));
      if (nodeId !== binding.rootId || changesDefinitionOwnedFields) {
        onNotice("This layer belongs to an attached component. Use its component controls or detach it before changing definition-owned fields.");
        return;
      }
    }
    found.node.provenance = { author: "human", revision: found.node.provenance.revision + 1 };
    commitDraft(draft, notice);
  }, [commitDraft, graph, onNotice]);

  const updateNode = (mutate: (node: SemanticNode) => void, notice: string) => {
    if (!selectedNode) return;
    updateNodeById(selectedNode.id, mutate, notice);
  };

  const updateFixture = useCallback((fieldName: string, value: string | number | boolean) => {
    if (!screen) return;
    try {
      const draft = withFixtureValue(graph, screen.id, activeVisualState, fieldName, value);
      commitDraft(draft, `Updated ${fieldName} in the ${screen.title} ${activeVisualState} fixture.`);
    } catch (error) {
      onNotice(editorTransactionError(error));
    }
  }, [activeVisualState, commitDraft, graph, onNotice, screen]);

  const moveNode = useCallback((nodeId: string, direction: -1 | 1) => {
    const draft = structuredClone(graph);
    const found = locateEditorNode(draft, nodeId);
    if (!found) return;
    const nodes = found.siblings;
    const index = found.index;
    const target = index + direction;
    if (index < 0 || target < 0 || target >= nodes.length) return;
    [nodes[index], nodes[target]] = [nodes[target]!, nodes[index]!];
    nodes[target]!.provenance = { author: "human", revision: nodes[target]!.provenance.revision + 1 };
    commitDraft(draft, `Moved ${nodeNames[nodes[target]!.kind]} ${direction < 0 ? "up" : "down"} in the semantic stack.`);
  }, [commitDraft, graph]);

  const reorderNodes = useCallback((screenId: string, parentId: string | null, orderedIds: string[]) => {
    try {
      const next = reorderChildrenTransaction(graph, screenId, parentId, orderedIds);
      commitDraft(next, "Reordered the semantic stack.");
    } catch (error) {
      onNotice(editorTransactionError(error));
    }
  }, [commitDraft, graph, onNotice]);

  const reparentNode = useCallback((nodeId: string, targetParentId: string | null, targetIndex: number) => {
    try {
      const next = moveNodeTransaction(graph, nodeId, targetParentId, targetIndex);
      const source = locateEditorNode(graph, nodeId);
      const target = targetParentId ? locateEditorNode(graph, targetParentId)?.node : null;
      commitDraft(next, `Moved ${source?.node.intent.label ?? "layer"} into ${target?.intent.label ?? source?.screen.title ?? "screen"}.`);
    } catch (error) {
      onNotice(editorTransactionError(error));
    }
  }, [commitDraft, graph, onNotice]);

  const deleteNodeById = useCallback((nodeId: string) => {
    const found = locateEditorNode(graph, nodeId);
    if (!found) return;
    try {
      const next = removeNodeTransaction(graph, nodeId);
      const committed = commitDraft(next, `Removed ${nodeNames[found.node.kind]} from ${found.screen.title}.`);
      if (committed && selectedNodeId === nodeId) {
        const remainingScreen = committed.screens.find((item) => item.id === found.screen.id);
        onSelectNode(found.parent?.id ?? remainingScreen?.nodes[0]?.id ?? null);
      }
    } catch (error) {
      onNotice(editorTransactionError(error));
    }
  }, [commitDraft, graph, onNotice, onSelectNode, selectedNodeId]);

  const duplicateNodeById = useCallback((nodeId: string) => {
    const found = locateEditorNode(graph, nodeId);
    if (!found) return;
    try {
      const result = duplicateNodeTransaction(graph, nodeId);
      const committed = commitDraft(result.graph, `Duplicated ${nodeNames[found.node.kind]} with its semantic descendants.`);
      if (committed) onSelectNode(result.nodeId);
    } catch (error) {
      onNotice(editorTransactionError(error));
    }
  }, [commitDraft, graph, onNotice, onSelectNode]);

  const duplicateSelection = useCallback(() => {
    if (normalizedSelection.length === 0) return;
    try {
      const result = duplicateNodesTransaction(graph, normalizedSelection);
      const committed = commitDraft(result.graph, `Duplicated ${result.nodeIds.length} selected ${result.nodeIds.length === 1 ? "layer" : "layers"} atomically.`);
      if (committed) {
        setSelectedNodeIds(result.nodeIds);
        onSelectNode(result.nodeIds.at(-1) ?? null);
      }
    } catch (error) {
      onNotice(editorTransactionError(error));
    }
  }, [commitDraft, graph, normalizedSelection, onNotice, onSelectNode]);

  const deleteSelection = useCallback(() => {
    if (normalizedSelection.length === 0) return;
    const fallback = locateEditorNode(graph, normalizedSelection[0]!)?.parent?.id ?? null;
    try {
      const next = removeNodesTransaction(graph, normalizedSelection);
      const committed = commitDraft(next, `Removed ${normalizedSelection.length} selected ${normalizedSelection.length === 1 ? "layer" : "layers"}.`);
      if (committed) {
        const fallbackExists = fallback ? locateEditorNode(committed, fallback) : null;
        setSelectedNodeIds(fallbackExists ? [fallback!] : []);
        onSelectNode(fallbackExists ? fallback : null);
      }
    } catch (error) {
      onNotice(editorTransactionError(error));
    }
  }, [commitDraft, graph, normalizedSelection, onNotice, onSelectNode]);

  const copySelection = useCallback((data?: DataTransfer) => {
    if (!screen || normalizedSelection.length === 0) return false;
    try {
      const payload = createNodeClipboardPayload(graph, screen.id, normalizedSelection);
      const serialized = serializeClipboardPayload(payload);
      nodeClipboard.current = payload;
      data?.setData(NODE_CLIPBOARD_MIME, serialized);
      data?.setData("text/plain", payload.nodes.map((node) => node.intent.label ?? node.intent.purpose).join("\n"));
      if (!data) void navigator.clipboard?.writeText(serialized).catch(() => undefined);
      onNotice(`Copied ${payload.nodes.length} semantic ${payload.nodes.length === 1 ? "layer" : "layers"}.`);
      return true;
    } catch (error) {
      onNotice(editorTransactionError(error));
      return false;
    }
  }, [graph, normalizedSelection, onNotice, screen]);

  const pastePayload = useCallback((payload: NodeClipboardPayload, mode: PasteMode, notice?: string) => {
    if (!screen) return;
    try {
      const result = pasteNodesTransaction(graph, screen.id, normalizedSelection, payload, mode);
      const committed = commitDraft(result.graph, notice ?? `${mode === "replace" ? "Replaced the selection with" : "Pasted"} ${result.nodeIds.length} semantic ${result.nodeIds.length === 1 ? "layer" : "layers"}.`);
      if (committed) {
        setSelectedNodeIds(result.nodeIds);
        onSelectNode(result.nodeIds.at(-1) ?? null);
      }
    } catch (error) {
      onNotice(editorTransactionError(error));
    }
  }, [commitDraft, graph, normalizedSelection, onNotice, onSelectNode, screen]);

  const plainTextPayload = useCallback((text: string): NodeClipboardPayload | null => {
    if (!screen) return null;
    const value = Array.from(text.trim()).slice(0, 240).join("");
    if (!value) return null;
    return {
      format: "intentform/nodes",
      version: 1,
      nodes: [{
        id: `${screen.id}.pasted-text`,
        kind: "text",
        intent: { purpose: "Preserve pasted text content", label: value, importance: "supporting" },
        layout: newNodeLayout("text"),
        style: { role: "text", emphasis: "normal" },
        accessibility: { label: value, live: "off" },
        states: insertionStateBindings(activeVisualState),
        interactions: [],
        provenance: { author: "human", revision: 0 },
        children: [],
      }],
    };
  }, [activeVisualState, screen]);

  const pasteFromData = useCallback((data: DataTransfer, mode: PasteMode) => {
    const structured = data.getData(NODE_CLIPBOARD_MIME);
    if (structured) {
      try {
        const payload = parseNodeClipboardPayload(structured);
        nodeClipboard.current = payload;
        pastePayload(payload, mode);
      } catch (error) {
        onNotice(editorTransactionError(error));
      }
      return;
    }
    const html = data.getData("text/html");
    if (html) {
      const extracted = plainTextFromHtml(html);
      const payload = plainTextPayload(extracted.text);
      if (payload) pastePayload(payload, mode, extracted.diagnostics[0]?.message);
      else onNotice(extracted.diagnostics[0]?.message ?? "The pasted HTML contained no editable text.");
      return;
    }
    const payload = plainTextPayload(data.getData("text/plain"));
    if (payload) pastePayload(payload, mode, "Pasted plain text as an editable semantic text layer.");
  }, [onNotice, pastePayload, plainTextPayload]);

  const pasteInternal = useCallback((mode: PasteMode) => {
    if (!nodeClipboard.current) {
      onNotice("Nothing from IntentForm is available to paste yet.");
      return;
    }
    pastePayload(nodeClipboard.current, mode);
  }, [onNotice, pastePayload]);

  const copyStyles = useCallback((data?: DataTransfer) => {
    const source = normalizedSelection.length === 1 ? locateEditorNode(graph, normalizedSelection[0]!)?.node : null;
    if (!source) {
      onNotice("Select one layer before copying styles.");
      return;
    }
    const payload = createStyleClipboardPayload(source);
    styleClipboard.current = payload;
    data?.setData(STYLE_CLIPBOARD_MIME, serializeClipboardPayload(payload));
    onNotice(`Copied styles from ${source.intent.label ?? source.id}.`);
  }, [graph, normalizedSelection, onNotice]);

  const pasteStyles = useCallback((data?: DataTransfer) => {
    try {
      const serialized = data?.getData(STYLE_CLIPBOARD_MIME);
      const payload = serialized ? parseStyleClipboardPayload(serialized) : styleClipboard.current;
      if (!payload) {
        onNotice("Nothing from IntentForm is available in the style clipboard.");
        return;
      }
      styleClipboard.current = payload;
      const next = pasteStyleTransaction(graph, normalizedSelection, payload);
      commitDraft(next, `Applied copied styles to ${normalizedSelection.length} ${normalizedSelection.length === 1 ? "layer" : "layers"}.`);
    } catch (error) {
      onNotice(editorTransactionError(error));
    }
  }, [commitDraft, graph, normalizedSelection, onNotice]);

  const moveSelection = useCallback((direction: -1 | 1) => {
    if (normalizedSelection.length === 0) return;
    try {
      const next = moveSelectionTransaction(graph, normalizedSelection, direction);
      commitDraft(next, `Moved ${normalizedSelection.length === 1 ? "the selected layer" : "the selected layers"} ${direction < 0 ? "up" : "down"}.`);
    } catch (error) {
      onNotice(editorTransactionError(error));
    }
  }, [commitDraft, graph, normalizedSelection, onNotice]);

  const groupSelection = useCallback(() => {
    if (!screen || normalizedSelection.length < 2) return;
    const parentId = selectionParentId(graph, normalizedSelection);
    if (parentId === undefined) {
      onNotice("Edit rejected: Grouped layers must share one parent. No changes were saved.");
      return;
    }
    const existingIds = new Set(flattenGraphNodes(graph).map((node) => node.id));
    let index = 1;
    while (existingIds.has(`${screen.id}.group-${index}`)) index += 1;
    const id = `${screen.id}.group-${index}`;
    const wrapper: SemanticNode = {
      id,
      kind: "stack",
      intent: { purpose: "Keep selected layers together", label: "Group", importance: "supporting" },
      layout: newNodeLayout("stack"),
      style: { role: "group", emphasis: "normal" },
      accessibility: { label: "Grouped content", live: "off" },
      states: [],
      interactions: [],
      provenance: { author: "human", revision: 0 },
      children: [],
    };
    try {
      const next = wrapNodesTransaction(graph, screen.id, normalizedSelection, wrapper);
      const committed = commitDraft(next, `Grouped ${normalizedSelection.length} layers in a semantic stack.`);
      if (committed) {
        setSelectedNodeIds([id]);
        onSelectNode(id);
      }
    } catch (error) {
      onNotice(editorTransactionError(error));
    }
  }, [commitDraft, graph, normalizedSelection, onNotice, onSelectNode, screen]);

  const reorderSelection = useCallback((screenId: string, parentId: string | null, orderedIds: string[]) => {
    try {
      const next = reorderChildrenTransaction(graph, screenId, parentId, orderedIds);
      commitDraft(next, `Reordered ${normalizedSelection.length === 1 ? "a layer" : `${normalizedSelection.length} selected layers`} by direct manipulation.`);
    } catch (error) {
      onNotice(editorTransactionError(error));
    }
  }, [commitDraft, graph, normalizedSelection.length, onNotice]);

  const moveFreeformSelection = useCallback((positions: Readonly<Record<string, Point>>) => {
    try {
      const next = setFreeformPositionsTransaction(graph, positions);
      commitDraft(next, `Moved ${Object.keys(positions).length} freeform ${Object.keys(positions).length === 1 ? "layer" : "layers"} on the semantic grid.`);
    } catch (error) {
      onNotice(editorTransactionError(error));
    }
  }, [commitDraft, graph, onNotice]);

  const resizeNode = useCallback((nodeId: string, size: ResizeCandidate) => {
    try {
      const next = updateNodeLayoutTransaction(graph, nodeId, (layout) => {
        layout.width = "fixed";
        layout.fixedWidth = size.width;
        layout.height = "fixed";
        layout.fixedHeight = size.height;
        if (layout.position && size.offsetX) layout.position.x += size.offsetX;
        if (layout.position && size.offsetY) layout.position.y += size.offsetY;
      });
      commitDraft(next, `Resized the selected layer to ${Math.round(size.width)} × ${Math.round(size.height)}.`);
    } catch (error) {
      onNotice(editorTransactionError(error));
    }
  }, [commitDraft, graph, onNotice]);

  const insertNode = (kind: SemanticNode["kind"]) => {
    if (!screen) return;
    const preset = nodeCatalog.find((item) => item.kind === kind);
    if (!preset) return;
    const draft = structuredClone(graph);
    const draftScreen = draft.screens.find((item) => item.id === screen.id);
    if (!draftScreen) return;
    const existingIds = new Set(flattenGraphNodes(draft).map((node) => node.id));
    let count = flattenSemanticNodes(draftScreen.nodes).filter((node) => node.kind === kind).length + 1;
    while (existingIds.has(`${screen.id}.custom-${kind}-${count}`)) count += 1;
    const id = `${screen.id}.custom-${kind}-${count}`;
    draftScreen.nodes.push({
      id,
      kind,
      intent: { purpose: preset.purpose, label: preset.label, importance: preset.importance },
      layout: newNodeLayout(kind),
      style: { role: kind, emphasis: preset.importance === "primary" ? "strong" : preset.importance === "secondary" ? "quiet" : "normal" },
      accessibility: { label: preset.label, live: preset.live },
      states: insertionStateBindings(activeVisualState),
      interactions: [],
      provenance: { author: "human", revision: 0 },
      children: [],
    });
    const committed = commitDraft(draft, `Inserted a semantic ${nodeNames[kind].toLowerCase()}.`);
    if (committed) {
      onSelectNode(id);
      setInsertOpen(false);
    }
  };

  const updateAssets = useCallback((
    mutate: (assets: SemanticInterfaceGraph["assets"]) => void,
    notice: string,
  ) => {
    const draft = structuredClone(graph);
    mutate(draft.assets);
    commitDraft(draft, notice);
  }, [commitDraft, graph]);

  const placeAsset = useCallback((assetId: string, sourceGraph: SemanticInterfaceGraph = graph) => {
    if (!screen) return;
    const asset = sourceGraph.assets.find((candidate) => candidate.id === assetId);
    if (!asset || !["raster", "svg", "icon"].includes(asset.kind)) return;
    const draft = structuredClone(sourceGraph);
    const draftScreen = draft.screens.find((item) => item.id === screen.id);
    if (!draftScreen) return;
    const existingIds = new Set(flattenGraphNodes(draft).map((node) => node.id));
    const stem = asset.id.split(".").at(-1)?.replace(/[^a-z0-9-]/gi, "-").toLowerCase() || "asset";
    let count = 1;
    let id = `${screen.id}.asset-${stem}-${count}`;
    while (existingIds.has(id)) { count += 1; id = `${screen.id}.asset-${stem}-${count}`; }
    const width = Math.max(32, Math.min(asset.width ?? 320, 960));
    const height = Math.max(32, Math.min(asset.height ?? 240, 720));
    draftScreen.nodes.push({
      id,
      kind: "image",
      intent: { purpose: `Display ${asset.name}`, label: asset.name, importance: "supporting" },
      layout: { ...newNodeLayout("image"), width: "fixed", fixedWidth: width, height: "fixed", fixedHeight: height },
      style: { role: "image", emphasis: "normal" },
      accessibility: { label: asset.name, live: "off" },
      asset: { assetId, fit: "contain", focalPoint: { x: 0.5, y: 0.5 }, decorative: false },
      states: insertionStateBindings(activeVisualState),
      interactions: [],
      provenance: { author: "human", revision: 0 },
      children: [],
    });
    if (commitDraft(draft, `Placed ${asset.name} on ${screen.title}.`)) onSelectNode(id);
  }, [activeVisualState, commitDraft, graph, onSelectNode, screen]);

  const pasteAssetFile = useCallback((file: File) => {
    if (!localProjectFingerprint || !localProjectSaved) {
      onNotice(localProjectFingerprint ? "Save canvas changes before pasting image bytes." : "Open a local project before pasting image bytes onto the canvas.");
      return;
    }
    if (!file.type.startsWith("image/")) {
      onNotice(`Clipboard file type is not supported: ${file.type || "unknown"}.`);
      return;
    }
    void importLocalAsset({ file, graph, expectedFingerprint: localProjectFingerprint })
      .then((result) => {
        onExternalAssetCommit(result.graph, result.fingerprint, `Imported ${result.asset.name} from the clipboard atomically.`);
        placeAsset(result.asset.id, result.graph);
      })
      .catch((error) => onNotice(error instanceof Error ? error.message : "Clipboard image import failed."));
  }, [graph, localProjectFingerprint, localProjectSaved, onExternalAssetCommit, onNotice, placeAsset]);

  const insertLibraryComponent = useCallback((definitionId: string) => {
    if (!screen) return;
    const definition = graph.components.find((candidate) => candidate.id === definitionId);
    if (!definition) return;
    const stem = definition.id.split(".").at(-1)?.replace(/[^a-z0-9-]/g, "-") || "component";
    const ids = new Set(flattenGraphNodes(graph).map((node) => node.id));
    let count = 1;
    let instanceId = `${screen.id}.instance-${stem}-${count}`;
    while (ids.has(instanceId)) {
      count += 1;
      instanceId = `${screen.id}.instance-${stem}-${count}`;
    }
    try {
      const next = instantiateComponent(graph, {
        definitionId,
        instanceId,
        screenId: screen.id,
      });
      const committed = commitDraft(next, `Inserted ${definition.name} from the local component library.`);
      if (committed) {
        onSelectNode(instanceId);
        setInsertOpen(false);
      }
    } catch (error) {
      onNotice(editorTransactionError(error));
    }
  }, [commitDraft, graph, onNotice, onSelectNode, screen]);

  const createLibraryComponent = useCallback((nodeId: string, name: string) => {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "component";
    let index = 1;
    let definitionId = `local.${base}`;
    while (graph.components.some((definition) => definition.id === definitionId)) {
      index += 1;
      definitionId = `local.${base}-${index}`;
    }
    try {
      const next = createComponentFromNode(graph, { nodeId, definitionId, name });
      if (commitDraft(next, `Created ${name} as ${definitionId}.`)) onSelectNode(nodeId);
    } catch (error) {
      onNotice(editorTransactionError(error));
    }
  }, [commitDraft, graph, onNotice, onSelectNode]);

  const updateLibraryComponent = useCallback((definition: SemanticInterfaceGraph["components"][number]) => {
    try {
      commitDraft(updateComponentDefinition(graph, definition), `Updated ${definition.name} component registration.`);
    } catch (error) {
      onNotice(editorTransactionError(error));
    }
  }, [commitDraft, graph, onNotice]);

  const mutateComponent = useCallback((
    mutate: (source: SemanticInterfaceGraph, instanceId: string) => SemanticInterfaceGraph,
    notice: string,
  ) => {
    if (!componentContext) return;
    try {
      commitDraft(mutate(graph, componentContext.rootId), notice);
    } catch (error) {
      onNotice(editorTransactionError(error));
    }
  }, [commitDraft, componentContext, graph, onNotice]);

  const reorderScreens = useCallback((orderedIds: string[]) => {
    const draft = structuredClone(graph);
    const byId = new Map(draft.screens.map((item) => [item.id, item]));
    const next = orderedIds.map((id) => byId.get(id)).filter((item): item is typeof draft.screens[number] => Boolean(item));
    if (next.length !== draft.screens.length) return;
    draft.screens = next;
    commitDraft(draft, "Reordered the product flow.");
  }, [commitDraft, graph]);

  const duplicateScreen = useCallback((screenId: string) => {
    try {
      const source = graph.screens.find((item) => item.id === screenId);
      if (!source) return;
      const result = duplicateScreenTransaction(graph, screenId);
      const committed = commitDraft(result.graph, `Duplicated ${source.title} with its contract and fixtures.`);
      if (committed) {
        onSelectScreen(result.screenId);
        onSelectNode(result.nodeId);
      }
    } catch (error) {
      onNotice(editorTransactionError(error));
    }
  }, [commitDraft, graph, onNotice, onSelectNode, onSelectScreen]);

  const deleteScreen = useCallback((screenId: string) => {
    if (graph.screens.length <= 1) return;
    const draft = structuredClone(graph);
    const removed = draft.screens.find((item) => item.id === screenId);
    if (!removed) return;
    draft.screens = draft.screens.filter((item) => item.id !== screenId);
    draft.contracts = draft.contracts.filter((item) => item.screenId !== screenId);
    draft.fixtures = draft.fixtures.filter((item) => item.screenId !== screenId);
    draft.flows = draft.flows
      .map((flow) => ({ ...flow, steps: flow.steps.filter((step) => step.from !== screenId && step.to !== screenId) }))
      .filter((flow) => flow.steps.length > 0);
    const fallback = draft.screens[0];
    const committed = commitDraft(draft, `Removed ${removed.title} and its contract, fixtures and flow steps.`);
    if (committed && selectedScreen === screenId && fallback) {
      onSelectScreen(fallback.id);
      onSelectNode(fallback.nodes[0]?.id ?? null);
    }
  }, [commitDraft, graph, onSelectNode, onSelectScreen, selectedScreen]);

  const addScreen = useCallback(() => {
    const draft = structuredClone(graph);
    let index = draft.screens.length + 1;
    while (draft.screens.some((item) => item.id === `screen-${index}`)) index += 1;
    const id = `screen-${index}`;
    const nodeId = `${id}.content`;
    draft.screens.push({
      id,
      title: "New screen",
      purpose: "Define the next product moment",
      route: `/${id}`,
      nodes: [{
        id: nodeId,
        kind: "status-message",
        intent: { purpose: "Describe the screen purpose", label: "Start shaping this screen", importance: "supporting" },
        layout: newNodeLayout("status-message"),
        style: { role: "status-message", emphasis: "normal" },
        accessibility: { label: "Start shaping this screen", live: "polite" },
        states: [],
        interactions: [],
        provenance: { author: "human", revision: 0 },
        children: [],
      }],
    });
    const committed = commitDraft(draft, "Added a new semantic screen without introducing platform code.");
    if (committed) {
      onSelectScreen(id);
      onSelectNode(nodeId);
    }
  }, [commitDraft, graph, onSelectNode, onSelectScreen]);

  const updateScreenField = (field: "title" | "purpose", value: string) => {
    if (!screen) return;
    const draft = structuredClone(graph);
    const draftScreen = draft.screens.find((item) => item.id === screen.id);
    if (!draftScreen) return;
    draftScreen[field] = value;
    commitDraft(draft, field === "title" ? `Renamed the screen to ${value}.` : "Refined the screen purpose.");
  };

  const updateTokens = (mutate: (tokens: SemanticInterfaceGraph["tokens"]) => void, notice: string) => {
    const draft = structuredClone(graph);
    mutate(draft.tokens);
    commitDraft(draft, notice);
  };

  /* Flow editing: an action's event and its navigation target live in the
     graph (interactions + flows), so the board's arrows update immediately. */
  const setActionEvent = useCallback((nodeId: string, eventName: string | null) => {
    const draft = structuredClone(graph);
    const found = locateEditorNode(draft, nodeId);
    if (!found) return;
    const previous = found.node.interactions[0]?.event ?? null;
    found.node.interactions = eventName ? [{ event: eventName, requires: [] }] : [];
    found.node.provenance = { author: "human", revision: found.node.provenance.revision + 1 };
    if (previous && previous !== eventName) {
      for (const flow of draft.flows) {
        flow.steps = flow.steps.flatMap((step) => {
          if (step.from !== found.screen.id || step.event !== previous) return [step];
          return eventName ? [{ ...step, event: eventName }] : [];
        });
      }
      draft.flows = draft.flows.filter((flow) => flow.steps.length > 0);
    }
    commitDraft(draft, eventName ? `Bound the action to ${eventName}.` : "Detached the action from its event.");
  }, [commitDraft, graph]);

  const setFlowTarget = useCallback((fromScreenId: string, eventName: string, targetScreenId: string | null) => {
    const draft = structuredClone(graph);
    for (const flow of draft.flows) {
      flow.steps = flow.steps.filter((step) => !(step.from === fromScreenId && step.event === eventName));
    }
    draft.flows = draft.flows.filter((flow) => flow.steps.length > 0);
    if (!targetScreenId) {
      commitDraft(draft, `Removed the navigation for ${eventName}.`);
      return;
    }
    const target = draft.screens.find((item) => item.id === targetScreenId);
    if (!target) return;
    const flow = draft.flows[0];
    if (flow) flow.steps.push({ from: fromScreenId, event: eventName, to: targetScreenId });
    else draft.flows.push({ id: "main", steps: [{ from: fromScreenId, event: eventName, to: targetScreenId }] });
    commitDraft(draft, `Routed ${eventName} to ${target.title}.`);
  }, [commitDraft, graph]);

  const handleNodeCommand = (command: NodeCommand, nodeId: string) => {
    if (command === "duplicate") duplicateNodeById(nodeId);
    else if (command === "delete") deleteNodeById(nodeId);
    else if (command === "move-up" || command === "move-down") moveNode(nodeId, command === "move-up" ? -1 : 1);
    else {
      const draft = structuredClone(graph);
      const location = locateEditorNode(draft, nodeId);
      if (!location) return;
      const current = location.node.editor ?? { locked: false, hidden: false };
      location.node.editor = command === "toggle-lock"
        ? { ...current, locked: !current.locked }
        : { ...current, hidden: !current.hidden };
      commitDraft(draft, command === "toggle-lock"
        ? `${location.node.editor.locked ? "Locked" : "Unlocked"} ${nodeNames[location.node.kind]}.`
        : `${location.node.editor.hidden ? "Hid" : "Showed"} ${nodeNames[location.node.kind]}.`);
    }
  };

  const toggleEditorPanel = useCallback((panel: Exclude<MobilePanel, null>) => {
    if (window.matchMedia("(min-width: 1280px)").matches) {
      setDesktopPanels((current) => ({ ...current, [panel]: !current[panel] }));
    } else {
      setMobilePanel((current) => current === panel ? null : panel);
    }
  }, []);

  const closeEditorPanel = useCallback((panel: Exclude<MobilePanel, null>) => {
    if (window.matchMedia("(min-width: 1280px)").matches) {
      setDesktopPanels((current) => ({ ...current, [panel]: false }));
    } else {
      setMobilePanel(null);
    }
  }, []);

  const selectVisualState = (nextState: VisualState) => {
    if (!screen) return;
    setVisualStateByScreen((current) => ({ ...current, [screen.id]: nextState }));
    if (selectedNode && selectedNode.states.length > 0 && !selectedNode.states.some((binding) => binding.name === nextState)) {
      selectNode(null);
    }
  };

  /* One long-lived keyboard subscription; handlers read the latest editor
     state through a ref so listeners are never re-attached mid-gesture. */
  const keyActions = useRef({
    escape: () => {},
    duplicate: () => {},
    remove: () => {},
    moveSelected: (_direction: -1 | 1) => {},
    navigate: (_direction: "up" | "down" | "left" | "right") => {},
    zoomToSelection: () => {},
    undo: () => {},
    redo: () => {},
    togglePanel: (_panel: "structure" | "inspector") => {},
    copy: (_data?: DataTransfer): boolean => false,
    cut: (_data?: DataTransfer) => {},
    paste: (_data: DataTransfer, _mode: PasteMode) => {},
    pasteFile: (_file: File) => {},
    pasteInternal: (_mode: PasteMode) => {},
    copyStyles: (_data?: DataTransfer) => {},
    pasteStyles: (_data?: DataTransfer) => {},
  });
  keyActions.current = {
    escape: () => {
      if (commandOpen || shortcutsOpen || insertOpen || zoomMenuOpen || mobilePanel) {
        setCommandOpen(false);
        setCommandQuery("");
        setShortcutsOpen(false);
        setInsertOpen(false);
        setZoomMenuOpen(false);
        setMobilePanel(null);
        return;
      }
      selectNode(null);
    },
    duplicate: duplicateSelection,
    remove: deleteSelection,
    moveSelected: moveSelection,
    navigate: (direction) => {
      if (!screen) return;
      if (direction === "left" || direction === "right") {
        const index = graph.screens.findIndex((item) => item.id === screen.id);
        const next = graph.screens[index + (direction === "right" ? 1 : -1)];
        if (next) {
          onSelectScreen(next.id);
          selectNode(next.nodes[0]?.id ?? null);
        }
        return;
      }
      const visible = flattenSemanticNodes(screen.nodes).filter((node) => isNodeVisible(node, activeVisualState));
      const index = visible.findIndex((node) => node.id === selectedNodeId);
      const next = index === -1 ? visible[0] : visible[index + (direction === "down" ? 1 : -1)];
      if (next) selectNode(next.id);
    },
    zoomToSelection: () => { if (screen) canvasApi.current?.fitScreen(screen.id, true); },
    undo: () => { if (canUndo) onUndo(); },
    redo: () => { if (canRedo) onRedo(); },
    togglePanel: toggleEditorPanel,
    copy: copySelection,
    cut: (data) => { if (copySelection(data)) deleteSelection(); },
    paste: pasteFromData,
    pasteFile: pasteAssetFile,
    pasteInternal,
    copyStyles,
    pasteStyles,
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const modifier = event.metaKey || event.ctrlKey;

      if (event.key === "Escape") {
        keyActions.current.escape();
        return;
      }
      if (modifier && key === "k") {
        event.preventDefault();
        setCommandOpen((open) => !open);
        setCommandQuery("");
        return;
      }
      if (isFormControl(event.target)) return;
      if (modifier && event.altKey && key === "c") {
        event.preventDefault();
        keyActions.current.copyStyles();
        return;
      }
      if (modifier && event.altKey && key === "v") {
        event.preventDefault();
        keyActions.current.pasteStyles();
        return;
      }
      if (modifier && event.shiftKey && key === "r") {
        event.preventDefault();
        keyActions.current.pasteInternal("replace");
        return;
      }
      if (modifier && key === "v") {
        pendingPasteMode.current = event.shiftKey ? "in-place" : "after";
        return;
      }
      if (event.key === " ") {
        event.preventDefault();
        setSpaceHeld(true);
        return;
      }
      if (modifier && key === "d") {
        event.preventDefault();
        keyActions.current.duplicate();
        return;
      }
      if (modifier && key === "z") {
        event.preventDefault();
        if (event.shiftKey) keyActions.current.redo();
        else keyActions.current.undo();
        return;
      }
      if (event.altKey && key === "l") {
        event.preventDefault();
        keyActions.current.togglePanel("structure");
        return;
      }
      if (event.altKey && key === "i") {
        event.preventDefault();
        keyActions.current.togglePanel("inspector");
        return;
      }
      if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        event.preventDefault();
        keyActions.current.moveSelected(event.key === "ArrowUp" ? -1 : 1);
        return;
      }
      if (!modifier && !event.altKey && event.key.startsWith("Arrow")) {
        event.preventDefault();
        keyActions.current.navigate(
          event.key === "ArrowUp" ? "up" : event.key === "ArrowDown" ? "down" : event.key === "ArrowLeft" ? "left" : "right",
        );
        return;
      }
      if (!modifier && event.shiftKey && event.code === "Digit2") {
        event.preventDefault();
        keyActions.current.zoomToSelection();
        return;
      }
      if (!modifier && (event.key === "Delete" || event.key === "Backspace")) {
        event.preventDefault();
        keyActions.current.remove();
        return;
      }
      if (modifier || event.altKey) return;
      if (key === "v") setTool("select");
      else if (key === "h") setTool("hand");
      else if (key === "p") { setComparisonMode(false); setPreviewMode((current) => !current); }
      else if (key === "0") { event.preventDefault(); canvasApi.current?.fitAll(true); }
      else if (key === "1") { event.preventDefault(); canvasApi.current?.zoomTo(1); }
      else if (key === "2") { event.preventDefault(); canvasApi.current?.zoomTo(2); }
      else if (key === "+" || key === "=") { event.preventDefault(); canvasApi.current?.zoomBy(1.25); }
      else if (key === "-") { event.preventDefault(); canvasApi.current?.zoomBy(0.8); }
      else if (event.key === "?") { event.preventDefault(); setShortcutsOpen((open) => !open); }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === " ") setSpaceHeld(false);
    };
    const onBlur = () => setSpaceHeld(false);
    const onCopy = (event: ClipboardEvent) => {
      if (isFormControl(event.target) || !event.clipboardData) return;
      if (keyActions.current.copy(event.clipboardData)) event.preventDefault();
    };
    const onCut = (event: ClipboardEvent) => {
      if (isFormControl(event.target) || !event.clipboardData) return;
      event.preventDefault();
      keyActions.current.cut(event.clipboardData);
    };
    const onPaste = (event: ClipboardEvent) => {
      if (isFormControl(event.target) || !event.clipboardData) return;
      event.preventDefault();
      const file = [...event.clipboardData.items]
        .find((item) => item.kind === "file" && item.type.startsWith("image/"))
        ?.getAsFile();
      if (file) {
        keyActions.current.pasteFile(file);
        return;
      }
      const mode = pendingPasteMode.current;
      pendingPasteMode.current = "after";
      keyActions.current.paste(event.clipboardData, mode);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    window.addEventListener("copy", onCopy);
    window.addEventListener("cut", onCut);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("copy", onCopy);
      window.removeEventListener("cut", onCut);
      window.removeEventListener("paste", onPaste);
    };
  }, [commandOpen, insertOpen, mobilePanel, shortcutsOpen, zoomMenuOpen]);

  const desktopGrid = desktopPanels.structure && desktopPanels.inspector
    ? "xl:grid-cols-[var(--rail-w)_minmax(420px,1fr)_var(--insp-w)]"
    : desktopPanels.structure
      ? "xl:grid-cols-[var(--rail-w)_minmax(420px,1fr)]"
      : desktopPanels.inspector
        ? "xl:grid-cols-[minmax(420px,1fr)_var(--insp-w)]"
        : "xl:grid-cols-1";

  useEffect(() => {
    if (!insertOpen && !zoomMenuOpen) return;
    const close = () => { setInsertOpen(false); setZoomMenuOpen(false); };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [insertOpen, zoomMenuOpen]);

  const commands: EditorCommand[] = [
    ...(!comparisonMode ? [
      { label: "Fit board in view", shortcut: "0", section: "Board", icon: ArrowsOutSimple, action: () => canvasApi.current?.fitAll(true) },
      { label: "Zoom to 100%", shortcut: "1", section: "Board", icon: MagnifyingGlass, action: () => canvasApi.current?.zoomTo(1) },
      { label: previewMode ? "Exit preview mode" : "Enter preview mode", shortcut: "P", section: "Board", icon: MonitorPlay, action: () => setPreviewMode((current) => !current) },
    ] : []),
    { label: comparisonMode ? "Exit responsive comparison" : "Compare responsive devices", section: "Board", icon: ArrowsOutSimple, action: () => setComparisonMode((current) => !current) },
    { label: "Toggle pages and layers", shortcut: "⌥L", section: "Panels", icon: Stack, action: () => toggleEditorPanel("structure") },
    { label: "Toggle design inspector", shortcut: "⌥I", section: "Panels", icon: Selection, action: () => toggleEditorPanel("inspector") },
    { label: "Show design tokens", section: "Panels", icon: PaintBrush, action: () => { setRailTab("tokens"); setDesktopPanels((current) => ({ ...current, structure: true })); setMobilePanel("structure"); } },
    { label: "Show component library", section: "Panels", icon: Stack, action: () => { setRailTab("components"); setDesktopPanels((current) => ({ ...current, structure: true })); setMobilePanel("structure"); } },
    { label: "Show project assets", section: "Panels", icon: Stack, action: () => { setRailTab("assets"); setDesktopPanels((current) => ({ ...current, structure: true })); setMobilePanel("structure"); } },
    { label: "Add semantic screen", section: "Edit", icon: FrameCorners, action: addScreen },
    { label: "Duplicate current screen", section: "Edit", icon: Copy, action: () => { if (screen) duplicateScreen(screen.id); } },
    ...(graph.screens.length > 1 && screen ? [
      { label: "Delete current screen", section: "Edit", icon: Trash, action: () => deleteScreen(screen.id) },
    ] : []),
    ...(normalizedSelection.length > 0 ? [
      { label: `Copy selected ${normalizedSelection.length === 1 ? "layer" : "layers"}`, shortcut: "⌘C", section: "Edit", icon: Copy, action: () => { copySelection(); } },
      { label: `Cut selected ${normalizedSelection.length === 1 ? "layer" : "layers"}`, shortcut: "⌘X", section: "Edit", icon: Copy, action: () => { if (copySelection()) deleteSelection(); } },
      { label: `Duplicate selected ${normalizedSelection.length === 1 ? "layer" : "layers"}`, shortcut: "⌘D", section: "Edit", icon: Copy, action: duplicateSelection },
      { label: `Delete selected ${normalizedSelection.length === 1 ? "layer" : "layers"}`, shortcut: "⌫", section: "Edit", icon: Trash, action: deleteSelection },
      { label: "Paste to replace", shortcut: "⇧⌘R", section: "Edit", icon: Copy, action: () => pasteInternal("replace") },
      { label: "Copy styles", shortcut: "⌥⌘C", section: "Edit", icon: PaintBrush, action: () => copyStyles() },
      { label: "Paste styles", shortcut: "⌥⌘V", section: "Edit", icon: PaintBrush, action: () => pasteStyles() },
    ] : []),
    { label: "Paste", shortcut: "⌘V", section: "Edit", icon: Copy, action: () => pasteInternal("after") },
    { label: "Paste in place", shortcut: "⇧⌘V", section: "Edit", icon: Copy, action: () => pasteInternal("in-place") },
    ...(normalizedSelection.length > 1 ? [
      { label: "Group selected layers", section: "Edit", icon: Stack, action: groupSelection },
    ] : []),
    ...(!comparisonMode ? profiles.map((profile) => ({
      label: `Preview on ${profile.label.toLowerCase()} (${profile.detail})`,
      section: "Device",
      icon: DeviceMobile,
      action: () => onDeviceId(profile.id),
    })) : []),
    { label: "Open product brief", section: "Workflow", icon: Sparkle, action: () => onOpenStage("brief") },
    { label: "Open semantic graph", section: "Workflow", icon: TreeStructure, action: () => onOpenStage("graph") },
    { label: "Open native outputs", section: "Workflow", icon: ArrowSquareOut, action: () => onOpenStage("outputs") },
    { label: "Open verification", section: "Workflow", icon: ShieldCheck, action: () => onOpenStage("verify") },
    { label: "Open proof report", section: "Workflow", icon: FileText, action: () => onOpenStage("report") },
    { label: "Export graph as JSON", section: "Project", icon: DownloadSimple, action: onExportGraph },
    { label: "Reset to verified sample", section: "Project", icon: ArrowsCounterClockwise, action: onResetProject },
  ];

  if (!screen) return null;

  const floatingButton = "inline-flex h-7 items-center gap-1 rounded-[5px] px-2 text-[10.5px] font-medium leading-[15px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]";

  return (
    <div
      className={`editor-shell relative grid h-full min-h-0 grid-cols-1 overflow-hidden bg-[var(--workspace)] text-[var(--t-strong)] ${desktopGrid}`}
      data-preview-mode={previewMode}
      style={{ "--rail-w": `${panelWidths.rail}px`, "--insp-w": `${panelWidths.inspector}px` } as React.CSSProperties}
      onDragOver={(event) => { if (event.dataTransfer.types.includes("application/x-intentform-asset")) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; } }}
      onDrop={(event) => { const assetId = event.dataTransfer.getData("application/x-intentform-asset"); if (assetId) { event.preventDefault(); placeAsset(assetId); } }}
    >
      {mobilePanel ? (
        <button
          type="button"
          aria-label="Close editor panel"
          onClick={() => setMobilePanel(null)}
          className="absolute inset-0 z-[2] bg-[var(--backdrop)] backdrop-blur-[1px] xl:hidden"
        />
      ) : null}

      {shortcutsOpen || commandOpen ? (
        <button
          type="button"
          aria-label="Close editor dialog"
          tabIndex={-1}
          onClick={() => { setShortcutsOpen(false); setCommandOpen(false); setCommandQuery(""); }}
          className="absolute inset-0 z-[3] bg-[var(--backdrop)]/35 backdrop-blur-[1px]"
        />
      ) : null}

      {shortcutsOpen ? <ShortcutsSheet onClose={() => setShortcutsOpen(false)} /> : null}
      {commandOpen ? (
        <CommandMenu
          query={commandQuery}
          commands={commands}
          onQuery={setCommandQuery}
          onRun={(command) => { command.action(); setCommandOpen(false); setCommandQuery(""); }}
          onClose={() => { setCommandOpen(false); setCommandQuery(""); }}
        />
      ) : null}

      <LayersPanel
        graph={graph}
        screen={screen}
        selectedNodeIds={selectedNodeIds}
        activeVisualState={activeVisualState}
        railTab={railTab}
        visible={mobilePanel === "structure"}
        desktopVisible={desktopPanels.structure}
        layerQuery={layerQuery}
        onRailTab={setRailTab}
        onLayerQuery={setLayerQuery}
        onSelectScreen={onSelectScreen}
        onSelectNode={selectNode}
        onHoverNode={setHoveredNodeId}
        onAddScreen={addScreen}
        onReorderScreens={reorderScreens}
        onDuplicateScreen={duplicateScreen}
        onDeleteScreen={deleteScreen}
        onReorderNodes={reorderNodes}
        onMoveNode={reparentNode}
        onNodeCommand={handleNodeCommand}
        onInstantiateComponent={insertLibraryComponent}
        onCreateComponent={createLibraryComponent}
        onUpdateComponent={updateLibraryComponent}
        onUpdateTokens={updateTokens}
        localProjectFingerprint={localProjectFingerprint}
        localProjectSaved={localProjectSaved}
        onUpdateAssets={updateAssets}
        onExternalAssetCommit={onExternalAssetCommit}
        onPlaceAsset={placeAsset}
        onClose={() => closeEditorPanel("structure")}
        onDismissMobile={() => setMobilePanel(null)}
      />

      <section className="relative h-full min-h-0 min-w-0">
        {desktopPanels.structure ? (
          <div
            role="separator"
            aria-label="Resize pages and layers panel"
            aria-orientation="vertical"
            aria-valuemin={panelLimits.rail.min}
            aria-valuemax={panelLimits.rail.max}
            aria-valuenow={panelWidths.rail}
            tabIndex={0}
            onPointerDown={beginPanelResize("rail")}
            onKeyDown={resizePanelWithKeyboard("rail")}
            className="absolute inset-y-0 left-0 z-[4] hidden w-1.5 cursor-col-resize hover:bg-[var(--accent)]/25 active:bg-[var(--accent)]/40 xl:block"
          />
        ) : null}
        {desktopPanels.inspector ? (
          <div
            role="separator"
            aria-label="Resize design inspector"
            aria-orientation="vertical"
            aria-valuemin={panelLimits.inspector.min}
            aria-valuemax={panelLimits.inspector.max}
            aria-valuenow={panelWidths.inspector}
            tabIndex={0}
            onPointerDown={beginPanelResize("inspector")}
            onKeyDown={resizePanelWithKeyboard("inspector")}
            className="absolute inset-y-0 right-0 z-[4] hidden w-1.5 cursor-col-resize hover:bg-[var(--accent)]/25 active:bg-[var(--accent)]/40 xl:block"
          />
        ) : null}
        {comparisonMode ? (
          <div className="h-full pb-7 pt-12">
            <MultiDeviceComparison
              graph={graph}
              selectedScreen={screen.id}
              visualState={activeVisualState}
              profiles={profiles}
              profileIds={comparisonProfileIds}
              onProfileChange={(index, profileId) => setComparisonProfileIds((current) => replaceComparisonProfile(current, index, profileId, profiles))}
            />
          </div>
        ) : (
          <CanvasStage
            graph={graph}
            selectedScreen={screen.id}
            selectedNodeId={selectedNodeId}
            selectedNodeIds={selectedNodeIds}
            hoveredNodeId={hoveredNodeId}
            tool={tool}
            spaceHeld={spaceHeld}
            previewMode={previewMode}
            showDeviceChrome={showDeviceChrome}
            bezelOverlay={bezelOverlay}
            profile={activeProfile}
            apiRef={canvasApi}
            visualStateFor={visualStateFor}
            frameStatus={(screenId) => statusByScreen.get(screenId) ?? { errors: 0, warnings: 0 }}
            onSelectScreen={onSelectScreen}
            onSelectNode={selectNode}
            onAnchor={(nodeId, placement) => updateNodeById(nodeId, (draft) => {
              if (draft.layout.placement) draft.layout.placement[activeProfile.breakpoint] = placement;
            }, placement === "persistent-bottom"
              ? `Anchored primary action to the ${activeProfile.breakpoint} bottom safe area.`
              : `Returned primary action to the ${activeProfile.breakpoint} semantic stack.`)}
            onReorderSelection={reorderSelection}
            onMoveFreeform={moveFreeformSelection}
            onResizeNode={resizeNode}
            onGroupSelection={groupSelection}
            onDuplicateSelection={duplicateSelection}
            onDeleteSelection={deleteSelection}
            onCopySelection={() => { copySelection(); }}
            onCutSelection={() => { if (copySelection()) deleteSelection(); }}
            onPaste={pasteInternal}
            onCopyStyles={() => copyStyles()}
            onPasteStyles={() => pasteStyles()}
            onMoveSelection={moveSelection}
            onNodeCommand={handleNodeCommand}
            onRenameNode={(nodeId, _screenId, label) => updateNodeById(nodeId, (draft) => {
              draft.intent.label = label;
              draft.accessibility.label = label;
            }, "Updated visible and accessible label.")}
            onOpenVerify={() => onOpenStage("verify")}
            onZoomChange={setZoomPct}
          />
        )}

        <div className="pointer-events-auto absolute inset-x-2 top-2 z-[2] flex flex-wrap items-start justify-between gap-2 sm:inset-x-3 sm:top-3 sm:flex-nowrap">
          <div className="floating-chrome order-1 flex h-9 shrink-0 items-center gap-0.5 rounded-[8px] p-1 sm:order-none">
            <button
              ref={structureTriggerRef}
              type="button"
              aria-label="Open pages and layers"
              aria-controls="editor-structure-panel"
              aria-expanded={mobilePanel === "structure"}
              onClick={() => toggleEditorPanel("structure")}
              className={`${floatingButton} ${desktopPanels.structure ? "xl:hidden" : ""}`}
            >
              <Stack size={13} /> Layers
            </button>
            <button type="button" aria-label="Open command menu" title="Commands · ⌘K" aria-expanded={commandOpen} onClick={() => { setCommandOpen((open) => !open); setCommandQuery(""); }} className={floatingButton}>
              <Command size={13} /> <span className="hidden 2xl:inline">Commands</span><kbd className="ml-0.5 hidden rounded border border-[var(--line)] bg-[var(--chip)] px-1 font-mono text-[10px] text-[var(--faint)] 2xl:inline">⌘K</kbd>
            </button>
          </div>

          <div className="floating-chrome order-3 mx-auto flex h-9 shrink-0 items-center gap-0.5 rounded-[8px] p-1 sm:order-none sm:mx-0">
            {comparisonMode ? (
              <span className="flex h-7 items-center gap-1.5 px-2 text-[10.5px] font-medium text-[var(--accent-text)]"><ArrowsOutSimple size={13} /> {comparisonProfileIds.length} synchronized frames</span>
            ) : <>
            {([
              { id: "select", label: "Select", icon: Cursor },
              { id: "hand", label: "Pan", icon: Hand },
            ] as const).map((item) => {
              const ToolIcon = item.icon;
              const active = tool === item.id && !(item.id === "select" && spaceHeld);
              return (
                <button key={item.id} type="button" aria-label={item.label} aria-pressed={tool === item.id} onClick={() => setTool(item.id)} className={`grid size-7 place-items-center rounded-[5px] ${active || (item.id === "hand" && spaceHeld) ? "bg-[var(--accent)] text-white" : "text-[var(--muted)] hover:bg-[var(--hover)]"}`}>
                  <ToolIcon size={13} weight={tool === item.id ? "fill" : "regular"} />
                </button>
              );
            })}
            <span className="mx-1 h-4 w-px bg-[var(--line)]" />
            <button type="button" aria-label="Undo" disabled={!canUndo} onClick={onUndo} className="grid size-7 place-items-center rounded-[5px] text-[var(--muted)] hover:bg-[var(--hover)] disabled:opacity-25"><ArrowCounterClockwise size={13} /></button>
            <button type="button" aria-label="Redo" disabled={!canRedo} onClick={onRedo} className="grid size-7 place-items-center rounded-[5px] text-[var(--muted)] hover:bg-[var(--hover)] disabled:opacity-25"><ArrowClockwise size={13} /></button>
            <span className="mx-1 h-4 w-px bg-[var(--line)]" />
            <div className="relative" onPointerDown={(event) => event.stopPropagation()}>
              <button ref={insertTriggerRef} type="button" aria-label="Insert component" aria-expanded={insertOpen} onClick={() => setInsertOpen((open) => !open)} className={`grid size-7 place-items-center rounded-[5px] ${insertOpen ? "bg-[var(--accent-soft)] text-[var(--accent-dark)]" : "text-[var(--muted)] hover:bg-[var(--hover)]"}`}>
                <Plus size={13} weight="bold" />
              </button>
              {insertOpen ? (
                <div role="menu" aria-label="Insert semantic component" className="menu-pop absolute left-1/2 top-10 z-[3] w-[300px] -translate-x-1/2 p-1.5">
                  <span className="block px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[.12em] text-[var(--faint)]">Semantic components</span>
                  {nodeCatalog.map((preset) => {
                    const PresetIcon = catalogIcons[preset.kind];
                    return (
                      <button key={preset.kind} type="button" role="menuitem" onClick={() => insertNode(preset.kind)} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-[var(--hover)]">
                        <span className="grid size-8 shrink-0 place-items-center rounded-md border border-[var(--line)] bg-[var(--chip)] text-[var(--t-strong)]"><PresetIcon size={14} /></span>
                        <span className="min-w-0"><strong className="block text-[11px] font-semibold">{nodeNames[preset.kind]}</strong><small className="block truncate text-[11px] text-[var(--muted)]">{preset.description}</small></span>
                      </button>
                    );
                  })}
                  {graph.components.length > 0 ? <span className="mt-1 block border-t border-[var(--line)] px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[.12em] text-[var(--faint)]">Local library</span> : null}
                  {graph.components.map((definition) => (
                    <button key={definition.id} type="button" role="menuitem" disabled={Boolean(definition.deprecated)} onClick={() => insertLibraryComponent(definition.id)} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-[var(--hover)] disabled:cursor-not-allowed disabled:opacity-45">
                      <span className="grid size-8 shrink-0 place-items-center rounded-md border border-[var(--line)] bg-[var(--chip)] text-[var(--t-strong)]"><Stack size={14} /></span>
                      <span className="min-w-0"><strong className="block text-[11px] font-semibold">{definition.name}</strong><small className="block truncate text-[11px] text-[var(--muted)]">v{definition.version} · {definition.variants.length} variants</small></span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            </>}
          </div>

          <div className="floating-chrome order-2 flex h-9 shrink-0 items-center gap-0.5 rounded-[8px] p-1 sm:order-none">
            {!comparisonMode ? <button type="button" aria-label="Toggle preview mode" aria-pressed={previewMode} onClick={() => setPreviewMode((current) => !current)} className={`inline-flex h-7 items-center gap-1 rounded-[5px] px-2 text-[10.5px] font-medium ${previewMode ? "bg-[var(--accent-soft)] text-[var(--accent-text)]" : "text-[var(--muted)] hover:bg-[var(--hover)]"}`}>
              <MonitorPlay size={13} weight={previewMode ? "fill" : "regular"} /> Preview
            </button> : null}
            <button type="button" aria-label="Toggle responsive comparison" aria-pressed={comparisonMode} onClick={() => setComparisonMode((current) => !current)} className={`inline-flex h-7 items-center gap-1 rounded-[5px] px-2 text-[10.5px] font-medium ${comparisonMode ? "bg-[var(--accent-soft)] text-[var(--accent-text)]" : "text-[var(--muted)] hover:bg-[var(--hover)]"}`}>
              <ArrowsOutSimple size={13} /> Compare
            </button>
            <button
              ref={inspectorTriggerRef}
              type="button"
              aria-label="Open design inspector"
              aria-controls="editor-inspector-panel"
              aria-expanded={mobilePanel === "inspector"}
              onClick={() => toggleEditorPanel("inspector")}
              className={`${floatingButton} ${desktopPanels.inspector ? "xl:hidden" : ""}`}
            >
              Design <Selection size={13} />
            </button>
          </div>
        </div>

        <div className="pointer-events-auto absolute inset-x-0 bottom-0 z-[2] flex min-h-7 items-center justify-between gap-2 border-t border-[var(--line)] bg-[var(--chrome)]/95 px-2 backdrop-blur sm:flex-nowrap">
          <div className="flex min-w-0 shrink items-center gap-1.5 text-[10px] text-[var(--muted)]">
            {!comparisonMode ? <label className="relative flex items-center gap-1.5 text-[var(--muted)]">
              <DeviceMobile size={12} aria-hidden="true" />
              <span className="sr-only">Preview device</span>
              <select aria-label="Preview device" value={activeProfile.id} onChange={(event) => onDeviceId(event.target.value as DeviceId)} className="min-h-7 max-w-36 appearance-none rounded-md bg-transparent pr-4 text-[12px] font-semibold outline-none hover:bg-[var(--hover)]">
                {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.label} · {profile.detail}</option>)}
              </select>
              <CaretDown size={9} className="pointer-events-none absolute right-0 text-[var(--faint)]" />
            </label> : <span className="flex items-center gap-1.5 font-semibold text-[var(--muted)]"><ArrowsOutSimple size={12} /> Responsive comparison</span>}
            {!comparisonMode && availableBezels.length > 0 ? <>
              <span className="h-4 w-px bg-[var(--line)]" />
              <label className="relative flex items-center gap-1.5 text-[var(--muted)]">
                <FrameCorners size={12} aria-hidden="true" />
                <span className="sr-only">Device bezel</span>
                <select
                  aria-label="Device bezel"
                  value={pendingBezelValue || activeBezelValue}
                  onChange={(event) => selectBezel(event.target.value)}
                  className="min-h-7 max-w-40 appearance-none rounded-md bg-transparent pr-4 text-[12px] font-semibold outline-none hover:bg-[var(--hover)]"
                >
                  <option value="">Neutral frame</option>
                  {availableBezels.map(({ pack, profile }) => <option key={`${pack.packId}:${profile.asset.digest}`} value={`${pack.packId}:${profile.asset.digest}`}>{pack.name} · {pack.license.name}</option>)}
                </select>
                <CaretDown size={9} className="pointer-events-none absolute right-0 text-[var(--faint)]" />
              </label>
              {selectedBezel ? <>
                <a
                  href={selectedBezel.pack.license.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  title={selectedBezel.pack.license.termsAcknowledgement}
                  className="text-[11px] font-semibold text-[var(--accent)] underline-offset-2 hover:underline"
                >
                  Review terms
                </a>
                <label className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--muted)]" title={selectedBezel.pack.license.termsAcknowledgement}>
                  <input aria-label="Acknowledge local bezel license" type="checkbox" checked={localLicenseAcknowledged} onChange={(event) => acknowledgeBezel(event.target.checked)} className="accent-[var(--accent)]" />
                  Use locally
                </label>
              </> : null}
            </> : null}
            <span className="h-4 w-px bg-[var(--line)]" />
            <label className="relative flex items-center gap-1.5 text-[var(--muted)]">
              <span className="size-1.5 rounded-full bg-[var(--accent)]" aria-hidden="true" />
              <span className="sr-only">Visual state</span>
              <select aria-label="Visual state" value={activeVisualState} onChange={(event) => selectVisualState(event.target.value as VisualState)} className="min-h-7 appearance-none rounded-md bg-transparent pr-4 text-[12px] font-semibold capitalize outline-none hover:bg-[var(--hover)]">
                {availableStates.map((state) => <option key={state} value={state}>{state}</option>)}
              </select>
              <CaretDown size={9} className="pointer-events-none absolute right-0 text-[var(--faint)]" />
            </label>
            <span className="hidden pl-1 pr-2 font-mono text-[11px] text-[var(--faint)] 2xl:inline">
              {comparisonMode ? "Shared screen and visual state across every frame" : previewMode ? "Preview · click actions to follow the flow" : spaceHeld ? "Panning · release Space to select" : tool === "select" ? "Drag the primary action to anchor it" : "Drag to pan the board"}
            </span>
            <span className="hidden h-4 w-px bg-[var(--line)] lg:block" />
            <span className="hidden font-mono text-[10px] text-[var(--faint)] lg:inline">{comparisonMode ? `${comparisonProfileIds.length} frames` : `${normalizedSelection.length} selected · ${activeProfile.breakpoint}`} · saved · {graph.schemaVersion}</span>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {!comparisonMode && activeProfile.presentation === "device" ? (
              <button
                type="button"
                aria-label="Toggle device chrome"
                aria-pressed={showDeviceChrome}
                title="Toggle neutral device chrome"
                onClick={() => setShowDeviceChrome((current) => !current)}
                className={`grid size-7 place-items-center rounded-md ${showDeviceChrome ? "bg-[var(--accent-soft)] text-[var(--accent-dark)]" : "text-[var(--muted)] hover:bg-[var(--hover)]"}`}
              >
                <FrameCorners size={12} />
              </button>
            ) : null}
            {!comparisonMode ? <>
            <button type="button" aria-label="Fit canvas" title="Fit board · 0" onClick={() => canvasApi.current?.fitAll(true)} className="hidden size-7 place-items-center rounded-md text-[var(--muted)] hover:bg-[var(--hover)] sm:grid"><ArrowsOutSimple size={12} /></button>
            <button type="button" aria-label="Zoom out" onClick={() => canvasApi.current?.zoomBy(0.8)} className="hidden size-7 place-items-center rounded-md text-[var(--muted)] hover:bg-[var(--hover)] sm:grid"><Minus size={11} /></button>
            <div className="relative" onPointerDown={(event) => event.stopPropagation()}>
              <button ref={zoomTriggerRef} type="button" aria-label="Zoom level" aria-expanded={zoomMenuOpen} onClick={() => setZoomMenuOpen((open) => !open)} className="min-h-7 w-12 rounded-md text-center font-mono text-[11px] text-[var(--t-strong)] hover:bg-[var(--hover)]">{zoomPct}%</button>
              {zoomMenuOpen ? (
                <div role="menu" aria-label="Choose zoom level" className="menu-pop absolute bottom-9 right-0 z-[3] w-36 p-1">
                  {([
                    { label: "Fit board", shortcut: "0", run: () => canvasApi.current?.fitAll(true) },
                    { label: "50%", run: () => canvasApi.current?.zoomTo(0.5) },
                    { label: "100%", shortcut: "1", run: () => canvasApi.current?.zoomTo(1) },
                    { label: "150%", run: () => canvasApi.current?.zoomTo(1.5) },
                    { label: "200%", shortcut: "2", run: () => canvasApi.current?.zoomTo(2) },
                  ]).map((item) => (
                    <button key={item.label} type="button" role="menuitem" onClick={() => { item.run(); setZoomMenuOpen(false); }} className="flex min-h-7 w-full items-center justify-between rounded-md px-2 text-left text-[12px] text-[var(--t-strong)] hover:bg-[var(--hover)]">
                      {item.label}
                      {item.shortcut ? <kbd className="font-mono text-[10px] text-[var(--faint)]">{item.shortcut}</kbd> : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <button type="button" aria-label="Zoom in" onClick={() => canvasApi.current?.zoomBy(1.25)} className="hidden size-7 place-items-center rounded-md text-[var(--muted)] hover:bg-[var(--hover)] sm:grid"><Plus size={11} /></button>
            </> : null}
            <span className="hidden h-4 w-px bg-[var(--line)] sm:block" />
            <button type="button" aria-label="Show keyboard shortcuts" title="Keyboard shortcuts · ?" aria-expanded={shortcutsOpen} onClick={() => setShortcutsOpen((open) => !open)} className="hidden size-7 place-items-center rounded-md text-[var(--muted)] hover:bg-[var(--hover)] sm:grid"><Keyboard size={13} /></button>
          </div>
        </div>
      </section>

      <Inspector
        graph={graph}
        screen={screen}
        selectedNode={normalizedSelection.length === 1 ? selectedNode : null}
        componentContext={normalizedSelection.length === 1 ? componentContext : null}
        selectionCount={normalizedSelection.length}
        profile={activeProfile}
        visualState={activeVisualState}
        visible={mobilePanel === "inspector"}
        desktopVisible={desktopPanels.inspector}
        updateNode={updateNode}
        onSetComponentProperty={(name, value) => mutateComponent(
          (source, instanceId) => setComponentProperty(source, instanceId, name, value),
          `Updated the ${name} component property.`,
        )}
        onSetComponentVariant={(variant) => mutateComponent(
          (source, instanceId) => setComponentVariant(source, instanceId, variant),
          variant ? `Applied the ${variant} component variant.` : "Restored the default component variant.",
        )}
        onSetComponentState={(state) => mutateComponent(
          (source, instanceId) => setComponentState(source, instanceId, state),
          state ? `Applied the ${state} component state.` : "Restored the default component state.",
        )}
        onSetComponentOverride={(override: ComponentOverride) => mutateComponent(
          (source, instanceId) => setComponentOverride(source, instanceId, override),
          "Updated an instance override.",
        )}
        onResetComponent={() => mutateComponent(resetComponentInstance, "Reset the component instance to its definition defaults.")}
        onDetachComponent={() => mutateComponent(detachComponentInstance, "Detached the component while preserving its rendered semantic tree.")}
        onUpdateFixture={updateFixture}
        onSetActionEvent={setActionEvent}
        onSetFlowTarget={setFlowTarget}
        onDuplicate={duplicateSelection}
        onReorder={moveSelection}
        onDelete={deleteSelection}
        onGroup={groupSelection}
        canDelete={Boolean(selectedLocation && (selectedLocation.parent || selectedLocation.screen.nodes.length > 1))}
        onScreenTitle={(title) => updateScreenField("title", title)}
        onScreenPurpose={(purpose) => updateScreenField("purpose", purpose)}
        onClose={() => closeEditorPanel("inspector")}
      />
    </div>
  );
}
