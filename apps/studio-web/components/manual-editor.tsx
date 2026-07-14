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
  parseGraph,
  type SemanticInterfaceGraph,
  type SemanticNode,
} from "@intentform/semantic-schema";
import type { VerificationFinding } from "@intentform/verifier";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CanvasStage, type CanvasApi } from "./editor/canvas";
import { Inspector } from "./editor/inspector";
import { LayersPanel } from "./editor/layers-panel";
import { CommandMenu, ShortcutsSheet, type EditorCommand } from "./editor/overlays";
import {
  deviceProfiles,
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
  onSelectScreen(screenId: string): void;
  onDeviceId(deviceId: DeviceId): void;
  onSelectNode(nodeId: string | null): void;
  onCommit(graph: SemanticInterfaceGraph, notice: string): void;
  onNotice(notice: string): void;
  onUndo(): void;
  onRedo(): void;
  onOpenStage(stage: WorkflowStage): void;
  onResetProject(): void;
  onExportGraph(): void;
}

const catalogIcons: Record<SemanticNode["kind"], Icon> = {
  "primary-action": CursorClick,
  "secondary-action": Selection,
  "money-input": CurrencyEur,
  "balance-summary": Wallet,
  "transaction-list": ListDashes,
  "recipient-identity": UserCircle,
  "status-message": WarningCircle,
  "receipt-summary": CheckCircle,
};

export function ManualEditor({
  graph,
  selectedScreen,
  selectedNodeId,
  canUndo,
  canRedo,
  findings,
  deviceId,
  onSelectScreen,
  onDeviceId,
  onSelectNode,
  onCommit,
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
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
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

  const screen = graph.screens.find((item) => item.id === selectedScreen) ?? graph.screens[0];
  const selectedNode = screen?.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const activeProfile = deviceProfiles.find((profile) => profile.id === deviceId) ?? deviceProfiles[0]!;

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
    const contract = graph.contracts.find((item) => item.screenId === screenId);
    const available = (contract?.visualStates ?? ["idle"]) as VisualState[];
    const requested = visualStateByScreen[screenId];
    return requested && available.includes(requested) ? requested : available[0] ?? "idle";
  }, [graph.contracts, visualStateByScreen]);

  const availableStates = ((graph.contracts.find((item) => item.screenId === screen?.id)?.visualStates ?? ["idle"])) as VisualState[];
  const activeVisualState = screen ? visualStateFor(screen.id) : "idle";

  /* Every mutation flows through the schema validator; a rejected draft never
     reaches the committed graph or the local draft. */
  const commitDraft = useCallback((draft: SemanticInterfaceGraph, notice: string) => {
    try {
      onCommit(parseGraph(draft), notice);
    } catch {
      onNotice("That edit was rejected by the semantic schema, so nothing changed.");
    }
  }, [onCommit, onNotice]);

  const findNode = (draft: SemanticInterfaceGraph, nodeId: string) => {
    for (const item of draft.screens) {
      const node = item.nodes.find((candidate) => candidate.id === nodeId);
      if (node) return { screen: item, node };
    }
    return null;
  };

  const updateNodeById = useCallback((nodeId: string, mutate: (node: SemanticNode) => void, notice: string) => {
    const draft = structuredClone(graph);
    const found = findNode(draft, nodeId);
    if (!found) return;
    mutate(found.node);
    found.node.provenance = { author: "human", revision: found.node.provenance.revision + 1 };
    commitDraft(draft, notice);
  }, [commitDraft, graph]);

  const updateNode = (mutate: (node: SemanticNode) => void, notice: string) => {
    if (!selectedNode) return;
    updateNodeById(selectedNode.id, mutate, notice);
  };

  const updateFixture = useCallback((fieldName: string, value: string | number | boolean) => {
    if (!screen) return;
    try {
      const draft = withFixtureValue(graph, screen.id, activeVisualState, fieldName, value);
      commitDraft(draft, `Updated ${fieldName} in the ${screen.title} ${activeVisualState} fixture.`);
    } catch {
      onNotice("That fixture edit was rejected, so the preview data stayed unchanged.");
    }
  }, [activeVisualState, commitDraft, graph, onNotice, screen]);

  const moveNode = useCallback((nodeId: string, direction: -1 | 1) => {
    const draft = structuredClone(graph);
    const found = findNode(draft, nodeId);
    if (!found) return;
    const nodes = found.screen.nodes;
    const index = nodes.findIndex((node) => node.id === nodeId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= nodes.length) return;
    [nodes[index], nodes[target]] = [nodes[target]!, nodes[index]!];
    nodes[target]!.provenance = { author: "human", revision: nodes[target]!.provenance.revision + 1 };
    commitDraft(draft, `Moved ${nodeNames[nodes[target]!.kind]} ${direction < 0 ? "up" : "down"} in the semantic stack.`);
  }, [commitDraft, graph]);

  const reorderNodes = useCallback((screenId: string, orderedIds: string[]) => {
    const draft = structuredClone(graph);
    const draftScreen = draft.screens.find((item) => item.id === screenId);
    if (!draftScreen) return;
    const byId = new Map(draftScreen.nodes.map((node) => [node.id, node]));
    const next = orderedIds.map((id) => byId.get(id)).filter((node): node is SemanticNode => Boolean(node));
    if (next.length !== draftScreen.nodes.length) return;
    draftScreen.nodes = next;
    commitDraft(draft, "Reordered the semantic stack.");
  }, [commitDraft, graph]);

  const deleteNodeById = useCallback((nodeId: string) => {
    const draft = structuredClone(graph);
    const found = findNode(draft, nodeId);
    if (!found || found.screen.nodes.length <= 1) return;
    found.screen.nodes = found.screen.nodes.filter((node) => node.id !== nodeId);
    onSelectNode(found.screen.nodes[0]?.id ?? null);
    commitDraft(draft, `Removed ${nodeNames[found.node.kind]} from ${found.screen.title}.`);
  }, [commitDraft, graph, onSelectNode]);

  const duplicateNodeById = useCallback((nodeId: string) => {
    const draft = structuredClone(graph);
    const found = findNode(draft, nodeId);
    if (!found) return;
    const index = found.screen.nodes.findIndex((node) => node.id === nodeId);
    let copyIndex = 2;
    let id = `${nodeId}-copy`;
    while (draft.screens.some((item) => item.nodes.some((node) => node.id === id))) {
      id = `${nodeId}-copy-${copyIndex}`;
      copyIndex += 1;
    }
    const copy = structuredClone(found.node);
    copy.id = id;
    copy.intent.label = `${found.node.intent.label} copy`;
    copy.accessibility.label = copy.intent.label;
    copy.provenance = { author: "human", revision: 0 };
    found.screen.nodes.splice(index + 1, 0, copy);
    onSelectNode(id);
    commitDraft(draft, `Duplicated ${nodeNames[found.node.kind]} as a new semantic node.`);
  }, [commitDraft, graph, onSelectNode]);

  const insertNode = (kind: SemanticNode["kind"]) => {
    if (!screen) return;
    const preset = nodeCatalog.find((item) => item.kind === kind);
    if (!preset) return;
    const draft = structuredClone(graph);
    const draftScreen = draft.screens.find((item) => item.id === screen.id);
    if (!draftScreen) return;
    const count = draftScreen.nodes.filter((node) => node.kind === kind).length + 1;
    const id = `${screen.id}.custom-${kind}-${count}`;
    draftScreen.nodes.push({
      id,
      kind,
      intent: { purpose: preset.purpose, label: preset.label, importance: preset.importance },
      layout: { axis: "vertical", width: "fill", gapToken: "space.16", paddingToken: "space.20", ...(kind === "primary-action" ? { placement: { compact: "inline" as const, regular: "inline" as const } } : {}) },
      style: { role: kind, emphasis: preset.importance === "primary" ? "strong" : preset.importance === "secondary" ? "quiet" : "normal" },
      accessibility: { label: preset.label, live: preset.live },
      states: [],
      interactions: [],
      provenance: { author: "human", revision: 0 },
    });
    onSelectNode(id);
    setInsertOpen(false);
    commitDraft(draft, `Inserted a semantic ${nodeNames[kind].toLowerCase()}.`);
  };

  const reorderScreens = useCallback((orderedIds: string[]) => {
    const draft = structuredClone(graph);
    const byId = new Map(draft.screens.map((item) => [item.id, item]));
    const next = orderedIds.map((id) => byId.get(id)).filter((item): item is typeof draft.screens[number] => Boolean(item));
    if (next.length !== draft.screens.length) return;
    draft.screens = next;
    commitDraft(draft, "Reordered the product flow.");
  }, [commitDraft, graph]);

  const duplicateScreen = useCallback((screenId: string) => {
    const draft = structuredClone(graph);
    const source = draft.screens.find((item) => item.id === screenId);
    if (!source) return;
    let copyIndex = 2;
    let newId = `${screenId}-copy`;
    while (draft.screens.some((item) => item.id === newId)) {
      newId = `${screenId}-copy-${copyIndex}`;
      copyIndex += 1;
    }
    const copy = structuredClone(source);
    copy.id = newId;
    copy.title = `${source.title} copy`;
    copy.route = `/${newId}`;
    copy.nodes = copy.nodes.map((node) => ({
      ...node,
      id: node.id.startsWith(`${screenId}.`) ? `${newId}.${node.id.slice(screenId.length + 1)}` : `${newId}.${node.id}`,
      provenance: { author: "human" as const, revision: 0 },
    }));
    draft.screens.splice(draft.screens.findIndex((item) => item.id === screenId) + 1, 0, copy);
    const contract = draft.contracts.find((item) => item.screenId === screenId);
    if (contract) draft.contracts.push({ ...structuredClone(contract), screenId: newId });
    for (const fixture of draft.fixtures.filter((item) => item.screenId === screenId)) {
      draft.fixtures.push({ ...structuredClone(fixture), id: `${newId}.${fixture.state}`, screenId: newId });
    }
    onSelectScreen(newId);
    onSelectNode(copy.nodes[0]?.id ?? null);
    commitDraft(draft, `Duplicated ${source.title} with its contract and fixtures.`);
  }, [commitDraft, graph, onSelectNode, onSelectScreen]);

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
    if (selectedScreen === screenId && fallback) {
      onSelectScreen(fallback.id);
      onSelectNode(fallback.nodes[0]?.id ?? null);
    }
    commitDraft(draft, `Removed ${removed.title} and its contract, fixtures and flow steps.`);
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
        layout: { axis: "vertical", width: "fill", gapToken: "space.16", paddingToken: "space.20" },
        style: { role: "status-message", emphasis: "normal" },
        accessibility: { label: "Start shaping this screen", live: "polite" },
        states: [],
        interactions: [],
        provenance: { author: "human", revision: 0 },
      }],
    });
    onSelectScreen(id);
    onSelectNode(nodeId);
    commitDraft(draft, "Added a new semantic screen without introducing platform code.");
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
    const found = findNode(draft, nodeId);
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
    else moveNode(nodeId, command === "move-up" ? -1 : 1);
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
      onSelectNode(null);
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
      onSelectNode(null);
    },
    duplicate: () => { if (selectedNode) duplicateNodeById(selectedNode.id); },
    remove: () => { if (selectedNode) deleteNodeById(selectedNode.id); },
    moveSelected: (direction) => { if (selectedNode) moveNode(selectedNode.id, direction); },
    navigate: (direction) => {
      if (!screen) return;
      if (direction === "left" || direction === "right") {
        const index = graph.screens.findIndex((item) => item.id === screen.id);
        const next = graph.screens[index + (direction === "right" ? 1 : -1)];
        if (next) {
          onSelectScreen(next.id);
          onSelectNode(next.nodes[0]?.id ?? null);
        }
        return;
      }
      const visible = screen.nodes.filter((node) => isNodeVisible(node, activeVisualState));
      const index = visible.findIndex((node) => node.id === selectedNodeId);
      const next = index === -1 ? visible[0] : visible[index + (direction === "down" ? 1 : -1)];
      if (next) onSelectNode(next.id);
    },
    zoomToSelection: () => { if (screen) canvasApi.current?.fitScreen(screen.id, true); },
    undo: () => { if (canUndo) onUndo(); },
    redo: () => { if (canRedo) onRedo(); },
    togglePanel: toggleEditorPanel,
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
      else if (key === "p") setPreviewMode((current) => !current);
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
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
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
    { label: "Fit board in view", shortcut: "0", section: "Board", icon: ArrowsOutSimple, action: () => canvasApi.current?.fitAll(true) },
    { label: "Zoom to 100%", shortcut: "1", section: "Board", icon: MagnifyingGlass, action: () => canvasApi.current?.zoomTo(1) },
    { label: previewMode ? "Exit preview mode" : "Enter preview mode", shortcut: "P", section: "Board", icon: MonitorPlay, action: () => setPreviewMode((current) => !current) },
    { label: "Toggle pages and layers", shortcut: "⌥L", section: "Panels", icon: Stack, action: () => toggleEditorPanel("structure") },
    { label: "Toggle design inspector", shortcut: "⌥I", section: "Panels", icon: Selection, action: () => toggleEditorPanel("inspector") },
    { label: "Show design tokens", section: "Panels", icon: PaintBrush, action: () => { setRailTab("tokens"); setDesktopPanels((current) => ({ ...current, structure: true })); setMobilePanel("structure"); } },
    { label: "Add semantic screen", section: "Edit", icon: FrameCorners, action: addScreen },
    { label: "Duplicate current screen", section: "Edit", icon: Copy, action: () => { if (screen) duplicateScreen(screen.id); } },
    ...(graph.screens.length > 1 && screen ? [
      { label: "Delete current screen", section: "Edit", icon: Trash, action: () => deleteScreen(screen.id) },
    ] : []),
    ...(selectedNode ? [
      { label: "Duplicate selected layer", shortcut: "⌘D", section: "Edit", icon: Copy, action: () => duplicateNodeById(selectedNode.id) },
      { label: "Delete selected layer", shortcut: "⌫", section: "Edit", icon: Trash, action: () => deleteNodeById(selectedNode.id) },
    ] : []),
    ...deviceProfiles.map((profile) => ({
      label: `Preview on ${profile.label.toLowerCase()} (${profile.detail})`,
      section: "Device",
      icon: DeviceMobile,
      action: () => onDeviceId(profile.id),
    })),
    { label: "Open product brief", section: "Workflow", icon: Sparkle, action: () => onOpenStage("brief") },
    { label: "Open semantic graph", section: "Workflow", icon: TreeStructure, action: () => onOpenStage("graph") },
    { label: "Open native outputs", section: "Workflow", icon: ArrowSquareOut, action: () => onOpenStage("outputs") },
    { label: "Open verification", section: "Workflow", icon: ShieldCheck, action: () => onOpenStage("verify") },
    { label: "Open proof report", section: "Workflow", icon: FileText, action: () => onOpenStage("report") },
    { label: "Export graph as JSON", section: "Project", icon: DownloadSimple, action: onExportGraph },
    { label: "Reset to verified sample", section: "Project", icon: ArrowsCounterClockwise, action: onResetProject },
  ];

  if (!screen) return null;

  const floatingButton = "inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2 text-[12px] font-medium text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]";

  return (
    <div
      className={`editor-shell relative grid h-[calc(100dvh-56px)] min-h-0 grid-cols-1 overflow-hidden bg-[var(--workspace)] text-[var(--t-strong)] ${desktopGrid}`}
      data-preview-mode={previewMode}
      style={{ "--rail-w": `${panelWidths.rail}px`, "--insp-w": `${panelWidths.inspector}px` } as React.CSSProperties}
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
        selectedNodeId={selectedNodeId}
        activeVisualState={activeVisualState}
        railTab={railTab}
        visible={mobilePanel === "structure"}
        desktopVisible={desktopPanels.structure}
        layerQuery={layerQuery}
        onRailTab={setRailTab}
        onLayerQuery={setLayerQuery}
        onSelectScreen={onSelectScreen}
        onSelectNode={onSelectNode}
        onHoverNode={setHoveredNodeId}
        onAddScreen={addScreen}
        onReorderScreens={reorderScreens}
        onDuplicateScreen={duplicateScreen}
        onDeleteScreen={deleteScreen}
        onReorderNodes={reorderNodes}
        onUpdateTokens={updateTokens}
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
        <CanvasStage
          graph={graph}
          selectedScreen={screen.id}
          selectedNodeId={selectedNodeId}
          hoveredNodeId={hoveredNodeId}
          tool={tool}
          spaceHeld={spaceHeld}
          previewMode={previewMode}
          profile={activeProfile}
          apiRef={canvasApi}
          visualStateFor={visualStateFor}
          frameStatus={(screenId) => statusByScreen.get(screenId) ?? { errors: 0, warnings: 0 }}
          onSelectScreen={onSelectScreen}
          onSelectNode={onSelectNode}
          onAnchor={(nodeId, placement) => updateNodeById(nodeId, (draft) => {
            if (draft.layout.placement) draft.layout.placement[activeProfile.breakpoint] = placement;
          }, placement === "persistent-bottom"
            ? `Anchored primary action to the ${activeProfile.breakpoint} bottom safe area.`
            : `Returned primary action to the ${activeProfile.breakpoint} semantic stack.`)}
          onNodeCommand={handleNodeCommand}
          onRenameNode={(nodeId, _screenId, label) => updateNodeById(nodeId, (draft) => {
            draft.intent.label = label;
            draft.accessibility.label = label;
          }, "Updated visible and accessible label.")}
          onOpenVerify={() => onOpenStage("verify")}
          onZoomChange={setZoomPct}
        />

        <div className="pointer-events-auto absolute inset-x-2 top-2 z-[2] flex flex-wrap items-start justify-between gap-2 sm:inset-x-3 sm:top-3 sm:flex-nowrap">
          <div className="floating-chrome order-1 flex shrink-0 items-center gap-0.5 rounded-xl p-1 sm:order-none">
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

          <div className="floating-chrome order-3 mx-auto flex shrink-0 items-center gap-0.5 rounded-xl p-1 sm:order-none sm:mx-0">
            {([
              { id: "select", label: "Select", icon: Cursor },
              { id: "hand", label: "Pan", icon: Hand },
            ] as const).map((item) => {
              const ToolIcon = item.icon;
              const active = tool === item.id && !(item.id === "select" && spaceHeld);
              return (
                <button key={item.id} type="button" aria-label={item.label} aria-pressed={tool === item.id} onClick={() => setTool(item.id)} className={`grid size-8 place-items-center rounded-[9px] ${active || (item.id === "hand" && spaceHeld) ? "bg-[var(--accent)] text-white shadow-[0_4px_10px_-6px_rgba(36,84,68,.9)]" : "text-[var(--muted)] hover:bg-[var(--hover)]"}`}>
                  <ToolIcon size={15} weight={tool === item.id ? "fill" : "regular"} />
                </button>
              );
            })}
            <span className="mx-1 h-4 w-px bg-[var(--line)]" />
            <button type="button" aria-label="Undo" disabled={!canUndo} onClick={onUndo} className="grid size-8 place-items-center rounded-lg text-[var(--muted)] hover:bg-[var(--hover)] disabled:opacity-25"><ArrowCounterClockwise size={15} /></button>
            <button type="button" aria-label="Redo" disabled={!canRedo} onClick={onRedo} className="grid size-8 place-items-center rounded-lg text-[var(--muted)] hover:bg-[var(--hover)] disabled:opacity-25"><ArrowClockwise size={15} /></button>
            <span className="mx-1 h-4 w-px bg-[var(--line)]" />
            <div className="relative" onPointerDown={(event) => event.stopPropagation()}>
              <button ref={insertTriggerRef} type="button" aria-label="Insert component" aria-expanded={insertOpen} onClick={() => setInsertOpen((open) => !open)} className={`grid size-8 place-items-center rounded-lg ${insertOpen ? "bg-[var(--accent-soft)] text-[var(--accent-dark)]" : "text-[var(--muted)] hover:bg-[var(--hover)]"}`}>
                <Plus size={15} weight="bold" />
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
                </div>
              ) : null}
            </div>
          </div>

          <div className="floating-chrome order-2 flex shrink-0 items-center gap-0.5 rounded-xl p-1 sm:order-none">
            <button type="button" aria-label="Toggle preview mode" aria-pressed={previewMode} onClick={() => setPreviewMode((current) => !current)} className={`inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium ${previewMode ? "bg-[var(--accent-soft)] text-[var(--accent-text)]" : "text-[var(--muted)] hover:bg-[var(--hover)]"}`}>
              <MonitorPlay size={13} weight={previewMode ? "fill" : "regular"} /> Preview
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

        <div className="pointer-events-auto absolute inset-x-2 bottom-2 z-[2] flex flex-wrap items-end justify-between gap-2 sm:inset-x-3 sm:bottom-3 sm:flex-nowrap">
          <div className="floating-chrome flex shrink-0 items-center gap-1.5 rounded-xl p-1 pl-2 text-[10px] text-[var(--muted)]">
            <label className="relative flex items-center gap-1.5 text-[var(--muted)]">
              <DeviceMobile size={12} aria-hidden="true" />
              <span className="sr-only">Preview device</span>
              <select aria-label="Preview device" value={activeProfile.id} onChange={(event) => onDeviceId(event.target.value as DeviceId)} className="min-h-7 max-w-36 appearance-none rounded-md bg-transparent pr-4 text-[12px] font-semibold outline-none hover:bg-[var(--hover)]">
                {deviceProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.label} · {profile.detail}</option>)}
              </select>
              <CaretDown size={9} className="pointer-events-none absolute right-0 text-[var(--faint)]" />
            </label>
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
              {previewMode ? "Preview · click actions to follow the flow" : spaceHeld ? "Panning · release Space to select" : tool === "select" ? "Drag the primary action to anchor it" : "Drag to pan the board"}
            </span>
          </div>

          <div className="floating-chrome flex shrink-0 items-center gap-1 rounded-xl p-1">
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
            <span className="hidden h-4 w-px bg-[var(--line)] sm:block" />
            <button type="button" aria-label="Show keyboard shortcuts" title="Keyboard shortcuts · ?" aria-expanded={shortcutsOpen} onClick={() => setShortcutsOpen((open) => !open)} className="hidden size-7 place-items-center rounded-md text-[var(--muted)] hover:bg-[var(--hover)] sm:grid"><Keyboard size={13} /></button>
          </div>
        </div>
      </section>

      <Inspector
        graph={graph}
        screen={screen}
        selectedNode={selectedNode}
        profile={activeProfile}
        visualState={activeVisualState}
        visible={mobilePanel === "inspector"}
        desktopVisible={desktopPanels.inspector}
        updateNode={updateNode}
        onUpdateFixture={updateFixture}
        onSetActionEvent={setActionEvent}
        onSetFlowTarget={setFlowTarget}
        onDuplicate={() => { if (selectedNode) duplicateNodeById(selectedNode.id); }}
        onReorder={(direction) => { if (selectedNode) moveNode(selectedNode.id, direction); }}
        onDelete={() => { if (selectedNode) deleteNodeById(selectedNode.id); }}
        onScreenTitle={(title) => updateScreenField("title", title)}
        onScreenPurpose={(purpose) => updateScreenField("purpose", purpose)}
        onClose={() => closeEditorPanel("inspector")}
      />
    </div>
  );
}
