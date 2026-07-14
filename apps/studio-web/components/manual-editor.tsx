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
  nodeCatalog,
  nodeNames,
  type EditorTool,
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
  onSelectScreen(screenId: string): void;
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
  onSelectScreen,
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
  const [deviceId, setDeviceId] = useState(deviceProfiles[0]!.id);
  const [visualStateByScreen, setVisualStateByScreen] = useState<Record<string, VisualState>>({});
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [layerQuery, setLayerQuery] = useState("");
  const [previewMode, setPreviewMode] = useState(false);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const canvasApi = useRef<CanvasApi>(null);

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
    ? "xl:grid-cols-[268px_minmax(420px,1fr)_304px]"
    : desktopPanels.structure
      ? "xl:grid-cols-[268px_minmax(420px,1fr)]"
      : desktopPanels.inspector
        ? "xl:grid-cols-[minmax(420px,1fr)_304px]"
        : "xl:grid-cols-1";

  const commands: EditorCommand[] = [
    { label: "Fit board in view", shortcut: "0", section: "Board", icon: ArrowsOutSimple, action: () => canvasApi.current?.fitAll(true) },
    { label: "Zoom to 100%", shortcut: "1", section: "Board", icon: MagnifyingGlass, action: () => canvasApi.current?.zoomTo(1) },
    { label: previewMode ? "Exit preview mode" : "Enter preview mode", shortcut: "P", section: "Board", icon: MonitorPlay, action: () => setPreviewMode((current) => !current) },
    { label: "Toggle pages and layers", shortcut: "⌥L", section: "Panels", icon: Stack, action: () => toggleEditorPanel("structure") },
    { label: "Toggle design inspector", shortcut: "⌥I", section: "Panels", icon: Selection, action: () => toggleEditorPanel("inspector") },
    { label: "Show design tokens", section: "Panels", icon: PaintBrush, action: () => { setRailTab("tokens"); setDesktopPanels((current) => ({ ...current, structure: true })); setMobilePanel("structure"); } },
    { label: "Add semantic screen", section: "Edit", icon: FrameCorners, action: addScreen },
    ...(selectedNode ? [
      { label: "Duplicate selected layer", shortcut: "⌘D", section: "Edit", icon: Copy, action: () => duplicateNodeById(selectedNode.id) },
      { label: "Delete selected layer", shortcut: "⌫", section: "Edit", icon: Trash, action: () => deleteNodeById(selectedNode.id) },
    ] : []),
    ...deviceProfiles.map((profile) => ({
      label: `Preview on ${profile.label.toLowerCase()} (${profile.detail})`,
      section: "Device",
      icon: DeviceMobile,
      action: () => setDeviceId(profile.id),
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

  const floatingButton = "inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2 text-[10.5px] font-medium text-[#565f5a] hover:bg-[#eef1ee] hover:text-[var(--ink)]";

  return (
    <div className={`editor-shell relative grid h-[calc(100dvh-56px)] min-h-[560px] grid-cols-1 overflow-hidden bg-[#f6f7f5] text-[#222725] ${desktopGrid}`} data-preview-mode={previewMode}>
      {mobilePanel ? (
        <button
          type="button"
          aria-label="Close editor panel"
          onClick={() => setMobilePanel(null)}
          className="absolute inset-0 z-[2] bg-[#17201b]/20 backdrop-blur-[1px] xl:hidden"
        />
      ) : null}

      {shortcutsOpen ? <ShortcutsSheet onClose={() => setShortcutsOpen(false)} /> : null}
      {commandOpen ? (
        <CommandMenu
          query={commandQuery}
          commands={commands}
          onQuery={setCommandQuery}
          onRun={(command) => { command.action(); setCommandOpen(false); setCommandQuery(""); }}
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
        onReorderNodes={reorderNodes}
        onUpdateTokens={updateTokens}
        onClose={() => closeEditorPanel("structure")}
        onDismissMobile={() => setMobilePanel(null)}
      />

      <section className="relative h-full min-h-0 min-w-0">
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

        <div className="pointer-events-none absolute inset-x-3 top-3 z-[2] flex items-start justify-between gap-2">
          <div className="floating-chrome pointer-events-auto flex items-center gap-0.5 rounded-xl p-1">
            <button
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
              <Command size={13} /> <span className="hidden 2xl:inline">Commands</span><kbd className="ml-0.5 hidden rounded border border-[#d7dcd8] bg-white px-1 font-mono text-[8px] text-[var(--faint)] 2xl:inline">⌘K</kbd>
            </button>
          </div>

          <div className="floating-chrome pointer-events-auto flex items-center gap-0.5 rounded-xl p-1">
            {([
              { id: "select", label: "Select", icon: Cursor },
              { id: "hand", label: "Pan", icon: Hand },
            ] as const).map((item) => {
              const ToolIcon = item.icon;
              const active = tool === item.id && !(item.id === "select" && spaceHeld);
              return (
                <button key={item.id} type="button" aria-label={item.label} aria-pressed={tool === item.id} onClick={() => setTool(item.id)} className={`grid size-8 place-items-center rounded-[9px] ${active || (item.id === "hand" && spaceHeld) ? "bg-[var(--accent)] text-white shadow-[0_4px_10px_-6px_rgba(36,84,68,.9)]" : "text-[#69706c] hover:bg-[#eef1ee]"}`}>
                  <ToolIcon size={15} weight={tool === item.id ? "fill" : "regular"} />
                </button>
              );
            })}
            <span className="mx-1 h-4 w-px bg-[#d9ddda]" />
            <button type="button" aria-label="Undo" disabled={!canUndo} onClick={onUndo} className="grid size-8 place-items-center rounded-lg text-[#69706c] hover:bg-[#eef1ee] disabled:opacity-25"><ArrowCounterClockwise size={15} /></button>
            <button type="button" aria-label="Redo" disabled={!canRedo} onClick={onRedo} className="grid size-8 place-items-center rounded-lg text-[#69706c] hover:bg-[#eef1ee] disabled:opacity-25"><ArrowClockwise size={15} /></button>
            <span className="mx-1 h-4 w-px bg-[#d9ddda]" />
            <div className="relative">
              <button type="button" aria-label="Insert component" aria-expanded={insertOpen} onClick={() => setInsertOpen((open) => !open)} className={`grid size-8 place-items-center rounded-lg ${insertOpen ? "bg-[var(--accent-soft)] text-[var(--accent-dark)]" : "text-[#69706c] hover:bg-[#eef1ee]"}`}>
                <Plus size={15} weight="bold" />
              </button>
              {insertOpen ? (
                <div className="menu-pop absolute left-1/2 top-10 z-[3] w-[300px] -translate-x-1/2 rounded-xl border border-[var(--line-strong)] bg-white/98 p-1.5 shadow-[0_24px_60px_-24px_rgba(18,27,22,.4)] backdrop-blur-xl">
                  <span className="block px-2.5 pb-1 pt-1.5 text-[9px] font-semibold uppercase tracking-[.12em] text-[var(--faint)]">Semantic components</span>
                  {nodeCatalog.map((preset) => {
                    const PresetIcon = catalogIcons[preset.kind];
                    return (
                      <button key={preset.kind} type="button" onClick={() => insertNode(preset.kind)} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-[#edf3ef]">
                        <span className="grid size-8 shrink-0 place-items-center rounded-md border border-[#e0e4e1] bg-[#f8f9f7] text-[#4f5a54]"><PresetIcon size={14} /></span>
                        <span className="min-w-0"><strong className="block text-[11px] font-semibold">{nodeNames[preset.kind]}</strong><small className="block truncate text-[9.5px] text-[var(--muted)]">{preset.description}</small></span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </div>

          <div className="floating-chrome pointer-events-auto flex items-center gap-0.5 rounded-xl p-1">
            <button type="button" aria-label="Toggle preview mode" aria-pressed={previewMode} onClick={() => setPreviewMode((current) => !current)} className={`inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 text-[10.5px] font-medium ${previewMode ? "bg-[var(--accent-soft)] text-[#214d3f]" : "text-[#565f5a] hover:bg-[#eef1ee]"}`}>
              <MonitorPlay size={13} weight={previewMode ? "fill" : "regular"} /> Preview
            </button>
            <button
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

        <div className="pointer-events-none absolute inset-x-3 bottom-3 z-[2] flex items-end justify-between gap-2">
          <div className="floating-chrome pointer-events-auto flex items-center gap-1.5 rounded-xl p-1 pl-2 text-[10px] text-[#6f7772]">
            <label className="relative flex items-center gap-1.5 text-[#5f6863]">
              <DeviceMobile size={12} aria-hidden="true" />
              <span className="sr-only">Preview device</span>
              <select aria-label="Preview device" value={activeProfile.id} onChange={(event) => setDeviceId(event.target.value)} className="min-h-7 max-w-36 appearance-none rounded-md bg-transparent pr-4 text-[10px] font-semibold outline-none hover:bg-[#eef1ee]">
                {deviceProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.label} · {profile.detail}</option>)}
              </select>
              <CaretDown size={9} className="pointer-events-none absolute right-0 text-[var(--faint)]" />
            </label>
            <span className="h-4 w-px bg-[#d9ddda]" />
            <label className="relative flex items-center gap-1.5 text-[#5f6863]">
              <span className="size-1.5 rounded-full bg-[var(--accent)]" aria-hidden="true" />
              <span className="sr-only">Visual state</span>
              <select aria-label="Visual state" value={activeVisualState} onChange={(event) => selectVisualState(event.target.value as VisualState)} className="min-h-7 appearance-none rounded-md bg-transparent pr-4 text-[10px] font-semibold capitalize outline-none hover:bg-[#eef1ee]">
                {availableStates.map((state) => <option key={state} value={state}>{state}</option>)}
              </select>
              <CaretDown size={9} className="pointer-events-none absolute right-0 text-[var(--faint)]" />
            </label>
            <span className="hidden pl-1 pr-2 font-mono text-[9px] text-[var(--faint)] 2xl:inline">
              {previewMode ? "Preview · click actions to follow the flow" : spaceHeld ? "Panning · release Space to select" : tool === "select" ? "Drag the primary action to anchor it" : "Drag to pan the board"}
            </span>
          </div>

          <div className="floating-chrome pointer-events-auto flex items-center gap-1 rounded-xl p-1">
            <button type="button" aria-label="Fit canvas" title="Fit board · 0" onClick={() => canvasApi.current?.fitAll(true)} className="grid size-7 place-items-center rounded-md text-[#707873] hover:bg-[#eef1ee]"><ArrowsOutSimple size={12} /></button>
            <button type="button" aria-label="Zoom out" onClick={() => canvasApi.current?.zoomBy(0.8)} className="grid size-7 place-items-center rounded-md text-[#707873] hover:bg-[#eef1ee]"><Minus size={11} /></button>
            <div className="relative">
              <button type="button" aria-label="Zoom level" aria-expanded={zoomMenuOpen} onClick={() => setZoomMenuOpen((open) => !open)} className="min-h-7 w-12 rounded-md text-center font-mono text-[10px] text-[#4d5651] hover:bg-[#eef1ee]">{zoomPct}%</button>
              {zoomMenuOpen ? (
                <div className="menu-pop absolute bottom-9 right-0 z-[3] w-36 rounded-xl border border-[var(--line-strong)] bg-white/98 p-1 shadow-[0_18px_45px_-20px_rgba(26,37,31,.35)]">
                  {([
                    { label: "Fit board", shortcut: "0", run: () => canvasApi.current?.fitAll(true) },
                    { label: "50%", run: () => canvasApi.current?.zoomTo(0.5) },
                    { label: "100%", shortcut: "1", run: () => canvasApi.current?.zoomTo(1) },
                    { label: "150%", run: () => canvasApi.current?.zoomTo(1.5) },
                    { label: "200%", shortcut: "2", run: () => canvasApi.current?.zoomTo(2) },
                  ]).map((item) => (
                    <button key={item.label} type="button" onClick={() => { item.run(); setZoomMenuOpen(false); }} className="flex min-h-7 w-full items-center justify-between rounded-md px-2 text-left text-[10.5px] text-[#2f3531] hover:bg-[#eef2ef]">
                      {item.label}
                      {item.shortcut ? <kbd className="font-mono text-[9px] text-[var(--faint)]">{item.shortcut}</kbd> : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <button type="button" aria-label="Zoom in" onClick={() => canvasApi.current?.zoomBy(1.25)} className="grid size-7 place-items-center rounded-md text-[#707873] hover:bg-[#eef1ee]"><Plus size={11} /></button>
            <span className="h-4 w-px bg-[#d9ddda]" />
            <button type="button" aria-label="Show keyboard shortcuts" title="Keyboard shortcuts · ?" aria-expanded={shortcutsOpen} onClick={() => setShortcutsOpen((open) => !open)} className="grid size-7 place-items-center rounded-md text-[#707873] hover:bg-[#eef1ee]"><Keyboard size={13} /></button>
          </div>
        </div>
      </section>

      <Inspector
        graph={graph}
        screen={screen}
        selectedNode={selectedNode}
        profile={activeProfile}
        visible={mobilePanel === "inspector"}
        desktopVisible={desktopPanels.inspector}
        updateNode={updateNode}
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
