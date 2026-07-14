"use client";

import {
  ArrowDown,
  ArrowClockwise,
  ArrowCounterClockwise,
  ArrowUp,
  ArrowsOutSimple,
  CaretRight,
  Check,
  Command,
  Copy,
  Cursor,
  DeviceMobile,
  DotsSixVertical,
  Eye,
  EyeSlash,
  FrameCorners,
  Hand,
  Keyboard,
  MagnifyingGlass,
  Minus,
  MonitorPlay,
  Plus,
  Selection,
  Stack,
  TextT,
  Trash,
  X,
} from "@phosphor-icons/react";
import {
  parseGraph,
  type SemanticInterfaceGraph,
  type SemanticNode,
} from "@intentform/semantic-schema";
import { motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type EditorTool = "select" | "hand";
type MobilePanel = "structure" | "inspector" | null;
type PreviewBreakpoint = "compact" | "regular";
type VisualState = "idle" | "loading" | "empty" | "failed" | "completed";
type CommitGraph = (graph: SemanticInterfaceGraph, notice: string) => void;

interface DeviceProfile {
  id: string;
  label: string;
  detail: string;
  width: number;
  height: number;
  breakpoint: PreviewBreakpoint;
  defaultZoom: number;
}

const deviceProfiles: DeviceProfile[] = [
  { id: "compact-phone", label: "Compact phone", detail: "375 × 667", width: 375, height: 667, breakpoint: "compact", defaultZoom: 90 },
  { id: "regular-phone", label: "Regular phone", detail: "402 × 874", width: 402, height: 874, breakpoint: "regular", defaultZoom: 70 },
  { id: "regular-tablet", label: "Regular tablet", detail: "768 × 1024", width: 768, height: 1024, breakpoint: "regular", defaultZoom: 50 },
];

interface ManualEditorProps {
  graph: SemanticInterfaceGraph;
  selectedScreen: string;
  selectedNodeId: string | null;
  canUndo: boolean;
  canRedo: boolean;
  onSelectScreen(screenId: string): void;
  onSelectNode(nodeId: string | null): void;
  onCommit: CommitGraph;
  onUndo(): void;
  onRedo(): void;
}

const nodeNames: Record<SemanticNode["kind"], string> = {
  "balance-summary": "Balance summary",
  "transaction-list": "Recent activity",
  "money-input": "Money input",
  "recipient-identity": "Recipient",
  "primary-action": "Primary action",
  "secondary-action": "Secondary action",
  "status-message": "Status message",
  "receipt-summary": "Receipt summary",
};

function isNodeVisible(node: SemanticNode, visualState: VisualState): boolean {
  if (node.states.length === 0) return true;
  return node.states.some((binding) => binding.name === visualState);
}

function isFormControl(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function CanvasNodePreview({ node }: { node: SemanticNode }) {
  switch (node.kind) {
    case "balance-summary":
      return (
        <div className="grid gap-1 rounded-[22px] bg-[#173c32] p-5 text-white shadow-[0_18px_34px_-24px_rgba(23,60,50,.75)]">
          <span className="text-[10px] text-emerald-100/70">Available balance</span>
          <strong className="font-mono text-[28px] tracking-[-.05em]">€8,420.16</strong>
          <span className="text-[9px] text-emerald-100/55">Updated just now</span>
        </div>
      );
    case "transaction-list":
      return (
        <div className="grid gap-2">
          <span className="text-[11px] font-semibold">{node.intent.label}</span>
          {["Riva Studio", "Northline Market"].map((name, index) => (
            <div key={name} className="flex justify-between border-t border-[#dde2dd] py-2.5 text-[10px]">
              <span>{name}</span><strong className="font-mono">−€{index === 0 ? "84.20" : "32.70"}</strong>
            </div>
          ))}
        </div>
      );
    case "money-input":
      return (
        <div className="grid gap-1.5 text-[10px] font-medium">
          {node.intent.label}
          <div className="rounded-2xl border border-[#cfd8d1] bg-white px-4 py-3 font-mono text-[23px] font-semibold tracking-[-.04em]">€120.00</div>
        </div>
      );
    case "recipient-identity":
      return (
        <div className="flex items-center gap-3 border-y border-[#dde2dd] py-3">
          <span className="grid size-10 place-items-center rounded-full bg-[#deebe5] text-[9px] font-bold text-[#2f6654]">MR</span>
          <span className="grid"><strong className="text-[10px]">Mara Rinaldi</strong><small className="text-[8px] text-zinc-500">mara@northline.test</small></span>
        </div>
      );
    case "status-message":
      return <div className="border-l-2 border-[#a24c39] bg-[#f5e5df] p-3 text-[9px] leading-relaxed text-[#713628]">{node.intent.label}</div>;
    case "receipt-summary":
      return (
        <div className="grid justify-items-center gap-1 rounded-[22px] bg-[#e3efe8] p-6 text-center">
          <Check size={23} weight="bold" className="rounded-full bg-[#397461] p-1 text-white" />
          <span className="text-[10px]">{node.intent.label}</span>
          <strong className="font-mono text-[25px]">€120.00</strong>
          <small className="text-[8px] text-zinc-500">Reference IF-2048</small>
        </div>
      );
    case "secondary-action":
      return <div className="rounded-2xl bg-[#e7eee9] px-4 py-3 text-center text-[10px] font-bold text-[#397461]">{node.intent.label}</div>;
    case "primary-action":
      return <div className="rounded-2xl bg-[#397461] px-4 py-3.5 text-center text-[10px] font-bold text-white shadow-[0_14px_24px_-18px_rgba(57,116,97,.9)]">{node.intent.label}</div>;
  }
}

function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange(value: T): void;
}) {
  return (
    <div className="grid gap-2">
      <span className="text-[9px] font-medium text-[#747d78]">{label}</span>
      <div className="grid grid-flow-col rounded-lg border border-[#dce0dd] bg-[#eef1ef] p-0.5">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`min-h-7 rounded-md px-2 text-[9px] font-medium transition-colors ${value === option.value ? "bg-white text-[#2d3430] shadow-[0_3px_9px_-7px_rgba(24,34,28,.8),inset_0_0_0_1px_rgba(255,255,255,.8)]" : "text-[#78817c] hover:bg-white/55 hover:text-[#343a36]"}`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ManualEditor({
  graph,
  selectedScreen,
  selectedNodeId,
  canUndo,
  canRedo,
  onSelectScreen,
  onSelectNode,
  onCommit,
  onUndo,
  onRedo,
}: ManualEditorProps) {
  const [tool, setTool] = useState<EditorTool>("select");
  const [zoom, setZoom] = useState(90);
  const [insertOpen, setInsertOpen] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>(null);
  const [desktopPanels, setDesktopPanels] = useState({ structure: true, inspector: true });
  const [deviceId, setDeviceId] = useState(deviceProfiles[0]!.id);
  const [visualStateByScreen, setVisualStateByScreen] = useState<Record<string, VisualState>>({});
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [layerQuery, setLayerQuery] = useState("");
  const [previewMode, setPreviewMode] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const panOrigin = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const screen = graph.screens.find((item) => item.id === selectedScreen) ?? graph.screens[0];
  const selectedNode = screen?.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const activeProfile = deviceProfiles.find((profile) => profile.id === deviceId) ?? deviceProfiles[0]!;
  const screenContract = graph.contracts.find((contract) => contract.screenId === screen?.id);
  const availableStates = screenContract?.visualStates ?? ["idle"];
  const requestedVisualState = screen ? visualStateByScreen[screen.id] : undefined;
  const activeVisualState = requestedVisualState && availableStates.includes(requestedVisualState)
    ? requestedVisualState
    : availableStates[0] ?? "idle";
  const visibleNodes = screen?.nodes.filter((node) => isNodeVisible(node, activeVisualState)) ?? [];
  const filteredNodes = useMemo(() => {
    const query = layerQuery.trim().toLowerCase();
    if (!screen || !query) return screen?.nodes ?? [];
    return screen.nodes.filter((node) => `${node.intent.label} ${nodeNames[node.kind]} ${node.id}`.toLowerCase().includes(query));
  }, [layerQuery, screen]);

  const fitCanvas = useCallback(() => {
    const viewport = canvasRef.current;
    if (!viewport) {
      setZoom(activeProfile.defaultZoom);
      return;
    }
    const availableWidth = Math.max(260, viewport.clientWidth - 112);
    const availableHeight = Math.max(420, viewport.clientHeight - 96);
    const scale = Math.min(1.1, availableWidth / activeProfile.width, availableHeight / activeProfile.height);
    setZoom(Math.max(50, Math.min(110, Math.floor(scale * 20) * 5)));
  }, [activeProfile]);

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

  const updateNodeById = (nodeId: string, mutate: (node: SemanticNode) => void, notice: string) => {
    if (!screen) return;
    const next = structuredClone(graph);
    const node = next.screens.find((item) => item.id === screen.id)?.nodes.find((item) => item.id === nodeId);
    if (!node) return;
    mutate(node);
    node.provenance = { author: "human", revision: node.provenance.revision + 1 };
    onCommit(parseGraph(next), notice);
  };

  const updateNode = (mutate: (node: SemanticNode) => void, notice: string) => {
    if (!selectedNode) return;
    updateNodeById(selectedNode.id, mutate, notice);
  };

  const reorderNode = (direction: -1 | 1) => {
    if (!screen || !selectedNode) return;
    const next = structuredClone(graph);
    const nodes = next.screens.find((item) => item.id === screen.id)?.nodes;
    if (!nodes) return;
    const index = nodes.findIndex((node) => node.id === selectedNode.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= nodes.length) return;
    [nodes[index], nodes[target]] = [nodes[target]!, nodes[index]!];
    nodes[target]!.provenance = { author: "human", revision: nodes[target]!.provenance.revision + 1 };
    onCommit(parseGraph(next), `Moved ${nodeNames[selectedNode.kind]} ${direction < 0 ? "up" : "down"} in the semantic stack.`);
  };

  const deleteNode = () => {
    if (!screen || !selectedNode || screen.nodes.length <= 1) return;
    const next = structuredClone(graph);
    const nextScreen = next.screens.find((item) => item.id === screen.id);
    if (!nextScreen) return;
    nextScreen.nodes = nextScreen.nodes.filter((node) => node.id !== selectedNode.id);
    onSelectNode(nextScreen.nodes[0]?.id ?? null);
    onCommit(parseGraph(next), `Removed ${nodeNames[selectedNode.kind]} from ${screen.title}.`);
  };

  const insertNode = (kind: "primary-action" | "secondary-action" | "status-message" | "receipt-summary") => {
    if (!screen) return;
    const next = structuredClone(graph);
    const nextScreen = next.screens.find((item) => item.id === screen.id);
    if (!nextScreen) return;
    const count = nextScreen.nodes.filter((node) => node.kind === kind).length + 1;
    const id = `${screen.id}.custom-${kind}-${count}`;
    const presets = {
      "primary-action": { label: "Continue", purpose: "Advance the current flow", importance: "primary" as const, live: "off" as const },
      "secondary-action": { label: "Not now", purpose: "Offer a non-destructive alternative", importance: "secondary" as const, live: "off" as const },
      "status-message": { label: "Explain what happened and how to recover.", purpose: "Explain a recoverable state", importance: "supporting" as const, live: "polite" as const },
      "receipt-summary": { label: "Completed", purpose: "Summarize the completed outcome", importance: "supporting" as const, live: "polite" as const },
    };
    const preset = presets[kind];
    const node: SemanticNode = {
      id,
      kind,
      intent: { purpose: preset.purpose, label: preset.label, importance: preset.importance },
      layout: { axis: "vertical", width: "fill", gapToken: "space.16", paddingToken: "space.20", ...(kind === "primary-action" ? { placement: { compact: "inline", regular: "inline" } } : {}) },
      style: { role: kind, emphasis: kind === "primary-action" ? "strong" : kind === "secondary-action" ? "quiet" : "normal" },
      accessibility: { label: preset.label, live: preset.live },
      states: [],
      interactions: [],
      provenance: { author: "human", revision: 0 },
    };
    nextScreen.nodes.push(node);
    onSelectNode(id);
    setInsertOpen(false);
    onCommit(parseGraph(next), `Inserted a semantic ${nodeNames[kind].toLowerCase()}.`);
  };

  const duplicateNode = () => {
    if (!screen || !selectedNode) return;
    const next = structuredClone(graph);
    const nextScreen = next.screens.find((item) => item.id === screen.id);
    if (!nextScreen) return;
    const index = nextScreen.nodes.findIndex((node) => node.id === selectedNode.id);
    if (index < 0) return;
    let copyIndex = 2;
    let id = `${selectedNode.id}-copy`;
    while (nextScreen.nodes.some((node) => node.id === id)) {
      id = `${selectedNode.id}-copy-${copyIndex}`;
      copyIndex += 1;
    }
    const copy = structuredClone(selectedNode);
    copy.id = id;
    copy.intent.label = `${selectedNode.intent.label} copy`;
    copy.accessibility.label = copy.intent.label;
    copy.provenance = { author: "human", revision: 0 };
    nextScreen.nodes.splice(index + 1, 0, copy);
    onSelectNode(id);
    onCommit(parseGraph(next), `Duplicated ${nodeNames[selectedNode.kind]} as a new semantic node.`);
  };

  const addScreen = () => {
    const next = structuredClone(graph);
    let index = next.screens.length + 1;
    while (next.screens.some((item) => item.id === `screen-${index}`)) index += 1;
    const id = `screen-${index}`;
    const nodeId = `${id}.content`;
    next.screens.push({
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
    onCommit(parseGraph(next), "Added a new semantic screen without introducing platform code.");
  };

  const updateScreenTitle = (title: string) => {
    if (!screen || !title || title === screen.title) return;
    const next = structuredClone(graph);
    const nextScreen = next.screens.find((item) => item.id === screen.id);
    if (!nextScreen) return;
    nextScreen.title = title;
    onCommit(parseGraph(next), `Renamed the screen to ${title}.`);
  };

  const selectDevice = (nextDeviceId: string) => {
    const nextProfile = deviceProfiles.find((profile) => profile.id === nextDeviceId);
    if (!nextProfile) return;
    setDeviceId(nextProfile.id);
    setZoom(nextProfile.defaultZoom);
  };

  const selectVisualState = (nextState: VisualState) => {
    if (!screen) return;
    setVisualStateByScreen((current) => ({ ...current, [screen.id]: nextState }));
    if (selectedNode && !isNodeVisible(selectedNode, nextState)) onSelectNode(null);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const modifier = event.metaKey || event.ctrlKey;

      if (event.key === "Escape") {
        setMobilePanel(null);
        setInsertOpen(false);
        setShortcutsOpen(false);
        setCommandOpen(false);
        setCommandQuery("");
        return;
      }
      if (modifier && key === "k") {
        event.preventDefault();
        setCommandOpen((open) => !open);
        setCommandQuery("");
        return;
      }
      if (isFormControl(event.target)) return;
      if (modifier && key === "d" && selectedNode) {
        event.preventDefault();
        duplicateNode();
        return;
      }
      if (modifier && key === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          if (canRedo) onRedo();
        } else if (canUndo) onUndo();
        return;
      }
      if (event.altKey && key === "l") {
        event.preventDefault();
        toggleEditorPanel("structure");
        return;
      }
      if (event.altKey && key === "i") {
        event.preventDefault();
        toggleEditorPanel("inspector");
        return;
      }
      if (!modifier && !event.altKey && key === "v") setTool("select");
      else if (!modifier && !event.altKey && key === "h") setTool("hand");
      else if (!modifier && !event.altKey && key === "p") setPreviewMode((current) => !current);
      else if (!modifier && !event.altKey && key === "0") {
        event.preventDefault();
        fitCanvas();
      } else if (!modifier && !event.altKey && (key === "+" || key === "=")) {
        event.preventDefault();
        setZoom((value) => Math.min(120, value + 10));
      } else if (!modifier && !event.altKey && key === "-") {
        event.preventDefault();
        setZoom((value) => Math.max(50, value - 10));
      } else if (event.key === "?") {
        event.preventDefault();
        setShortcutsOpen((open) => !open);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canRedo, canUndo, duplicateNode, fitCanvas, onRedo, onUndo, selectedNode, toggleEditorPanel]);

  const canvasScale = useMemo(() => zoom / 100, [zoom]);
  const desktopGrid = desktopPanels.structure && desktopPanels.inspector
    ? "xl:grid-cols-[260px_minmax(420px,1fr)_310px]"
    : desktopPanels.structure
      ? "xl:grid-cols-[260px_minmax(420px,1fr)]"
      : desktopPanels.inspector
        ? "xl:grid-cols-[minmax(420px,1fr)_310px]"
        : "xl:grid-cols-1";
  const commands = [
    { label: "Fit device in canvas", shortcut: "0", icon: ArrowsOutSimple, action: fitCanvas },
    { label: previewMode ? "Exit preview mode" : "Enter preview mode", shortcut: "P", icon: MonitorPlay, action: () => setPreviewMode((current) => !current) },
    { label: "Toggle pages and layers", shortcut: "⌥L", icon: Stack, action: () => toggleEditorPanel("structure") },
    { label: "Toggle design inspector", shortcut: "⌥I", icon: Selection, action: () => toggleEditorPanel("inspector") },
    { label: "Add semantic screen", shortcut: "", icon: FrameCorners, action: addScreen },
    ...(selectedNode ? [{ label: "Duplicate selected layer", shortcut: "⌘D", icon: Copy, action: duplicateNode }] : []),
  ];
  const filteredCommands = commands.filter((item) => item.label.toLowerCase().includes(commandQuery.trim().toLowerCase()));

  const runCommand = (action: () => void) => {
    action();
    setCommandOpen(false);
    setCommandQuery("");
  };

  if (!screen) return null;

  return (
    <div className={`editor-shell relative grid h-[calc(100dvh-54px)] min-h-[600px] grid-cols-1 overflow-hidden bg-[#f6f7f5] text-[#222725] ${desktopGrid}`} data-preview-mode={previewMode}>
      {mobilePanel ? (
        <button
          type="button"
          aria-label="Close editor panel"
          onClick={() => setMobilePanel(null)}
          className="absolute inset-0 z-[2] bg-[#17201b]/20 backdrop-blur-[1px] xl:hidden"
        />
      ) : null}

      {shortcutsOpen ? (
        <section aria-label="Keyboard shortcuts" className="absolute left-1/2 top-16 z-[4] w-[min(420px,calc(100%-32px))] -translate-x-1/2 rounded-[14px] border border-[#cfd4d0] bg-white/98 p-4 text-[#252a27] shadow-[0_28px_80px_-32px_rgba(18,27,22,.42)] backdrop-blur-xl">
          <div className="flex items-center justify-between border-b border-[#e3e6e3] pb-3">
            <div><strong className="block text-xs">Workspace shortcuts</strong><span className="mt-1 block text-[9px] text-[#7b847f]">Fast commands pause while you edit a field.</span></div>
            <button type="button" aria-label="Close keyboard shortcuts" onClick={() => setShortcutsOpen(false)} className="grid size-8 place-items-center rounded-md text-[#7f8883] hover:bg-[#edf0ed] hover:text-[#222725]"><X size={14} /></button>
          </div>
          <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-6 gap-y-2 text-[10px] text-[#5f6863]">
            {[["Select / Hand tool", "V / H"], ["Preview mode", "P"], ["Command menu", "⌘K"], ["Duplicate layer", "⌘D"], ["Undo / Redo", "⌘Z / ⇧⌘Z"], ["Fit canvas", "0"], ["Zoom", "+ / −"], ["Layers / Inspector", "⌥L / ⌥I"], ["Close panels", "Esc"]].map(([label, shortcut]) => <div key={label} className="contents"><dt>{label}</dt><dd className="rounded border border-[#d8ddda] bg-[#f3f5f3] px-1.5 py-0.5 font-mono text-[9px] text-[#38413c]">{shortcut}</dd></div>)}
          </dl>
        </section>
      ) : null}

      {commandOpen ? (
        <section aria-label="Command menu" className="command-menu absolute left-1/2 top-16 z-[5] w-[min(520px,calc(100%-32px))] -translate-x-1/2 overflow-hidden rounded-[14px] border border-[#cfd4d0] bg-white/98 shadow-[0_28px_80px_-32px_rgba(18,27,22,.42)] backdrop-blur-xl">
          <div className="flex items-center gap-3 border-b border-[#e3e6e3] px-4 py-3">
            <MagnifyingGlass size={15} className="text-[#68716c]" />
            <input autoFocus aria-label="Search commands" value={commandQuery} onChange={(event) => setCommandQuery(event.target.value)} placeholder="Search workspace commands" className="min-w-0 flex-1 bg-transparent text-[11px] text-[#313733] outline-none placeholder:text-[#8b938e]" />
            <kbd className="rounded-md border border-[#d8ddda] bg-[#f3f5f3] px-1.5 py-0.5 font-mono text-[8px] text-[#77807a]">ESC</kbd>
          </div>
          <div className="p-1.5">
            <span className="block px-2.5 pb-1.5 pt-1 text-[8px] font-semibold uppercase tracking-[.12em] text-[#8a928d]">Actions</span>
            {filteredCommands.map((item) => {
              const Icon = item.icon;
              return (
                <button key={item.label} type="button" onClick={() => runCommand(item.action)} className="flex min-h-10 w-full items-center gap-3 rounded-lg px-2.5 text-left text-[10px] text-[#2f3531] hover:bg-[#edf3ef]">
                  <span className="grid size-7 place-items-center rounded-md border border-[#e0e4e1] bg-[#f8f9f7] text-[#4f5a54]"><Icon size={13} /></span>
                  <span className="flex-1">{item.label}</span>
                  {item.shortcut ? <kbd className="font-mono text-[8px] text-[#8a928d]">{item.shortcut}</kbd> : null}
                </button>
              );
            })}
            {filteredCommands.length === 0 ? <div className="px-3 py-8 text-center text-[10px] text-[#7c8580]">No workspace command matches “{commandQuery}”.</div> : null}
          </div>
        </section>
      ) : null}

      <aside
        id="editor-structure-panel"
        aria-label="Pages and layers"
        className={`${mobilePanel === "structure" ? "grid" : "hidden"} ${desktopPanels.structure ? "xl:grid" : "xl:hidden"} absolute inset-y-0 left-0 z-[3] w-[260px] min-h-0 grid-rows-[auto_auto_1fr] border-r border-[#d7dbd8] bg-[#f8f9f7] shadow-[24px_0_52px_-32px_rgba(24,34,28,.32)] xl:static xl:z-auto xl:w-auto xl:shadow-none`}
      >
        <div className="border-b border-[#dde1de] p-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold text-[#343a36]">Pages</span>
            <div className="flex items-center gap-1">
              <button type="button" aria-label="Add screen" onClick={addScreen} className="grid size-7 place-items-center rounded-md text-[#727b76] hover:bg-[#e9edea] hover:text-[#222725]"><Plus size={13} /></button>
              <button type="button" aria-label="Close pages and layers" onClick={() => closeEditorPanel("structure")} className="grid size-7 place-items-center rounded-md text-[#727b76] hover:bg-[#e9edea] hover:text-[#222725]"><X size={13} /></button>
            </div>
          </div>
          <div className="mt-2 grid gap-0.5">
            {graph.screens.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => { onSelectScreen(item.id); onSelectNode(item.nodes[0]?.id ?? null); setMobilePanel(null); }}
                className={`flex min-h-8 items-center gap-2 rounded-md px-2 text-left text-[10px] ${item.id === screen.id ? "bg-[#e2ebe6] font-medium text-[#234d40]" : "text-[#626b66] hover:bg-[#ecefec] hover:text-[#222725]"}`}
              >
                <FrameCorners size={13} />
                <span className="truncate">{item.title}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="border-b border-[#dde1de] px-3 py-2.5">
          <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold text-[#343a36]">Layers</span>
          <div className="relative">
            <button type="button" aria-label="Insert component" onClick={() => setInsertOpen((open) => !open)} className="grid size-7 place-items-center rounded-md text-[#727b76] hover:bg-[#e9edea] hover:text-[#222725]"><Plus size={13} /></button>
            {insertOpen ? (
              <div className="absolute right-0 top-8 z-[2] w-48 rounded-lg border border-[#d4d9d5] bg-white p-1.5 text-[#303632] shadow-[0_18px_45px_-20px_rgba(26,37,31,.35)]">
                <button type="button" onClick={() => insertNode("primary-action")} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[10px] hover:bg-[#edf2ee]"><Selection size={13} /> Primary action</button>
                <button type="button" onClick={() => insertNode("secondary-action")} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[10px] hover:bg-[#edf2ee]"><Selection size={13} /> Secondary action</button>
                <button type="button" onClick={() => insertNode("status-message")} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[10px] hover:bg-[#edf2ee]"><TextT size={13} /> Status message</button>
                <button type="button" onClick={() => insertNode("receipt-summary")} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[10px] hover:bg-[#edf2ee]"><Check size={13} /> Receipt summary</button>
              </div>
            ) : null}
          </div>
          </div>
          <label className="mt-2 flex min-h-8 items-center gap-2 rounded-lg border border-[#d9ddda] bg-white px-2.5 text-[#78817c] focus-within:border-[#7aa08f] focus-within:shadow-[0_0_0_3px_rgba(57,116,97,.08)]">
            <MagnifyingGlass size={12} aria-hidden="true" />
            <span className="sr-only">Search layers</span>
            <input aria-label="Search layers" value={layerQuery} onChange={(event) => setLayerQuery(event.target.value)} placeholder="Find a layer" className="min-w-0 flex-1 bg-transparent text-[9px] text-[#343a36] outline-none placeholder:text-[#9ca39f]" />
            {layerQuery ? <button type="button" aria-label="Clear layer search" onClick={() => setLayerQuery("")} className="grid size-5 place-items-center rounded hover:bg-[#eef1ef]"><X size={10} /></button> : null}
          </label>
        </div>

        <div className="min-h-0 overflow-auto px-2 py-2">
          <div className="mb-1 flex items-center gap-1.5 px-1.5 py-1.5 text-[10px] text-[#5e6762]"><CaretRight size={11} weight="bold" /><FrameCorners size={12} /><strong>{screen.title}</strong></div>
          {filteredNodes.map((node) => {
            const visible = isNodeVisible(node, activeVisualState);
            return (
              <button
                key={node.id}
                type="button"
                data-testid={`layer-${node.id}`}
                data-state-visible={visible}
                onClick={() => { onSelectNode(node.id); setMobilePanel(null); }}
                className={`group flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[10px] ${node.id === selectedNodeId ? "bg-[#dceae3] font-medium text-[#214d3f]" : visible ? "text-[#5e6762] hover:bg-[#ecefec] hover:text-[#222725]" : "text-[#9ba29e] hover:bg-[#ecefec] hover:text-[#6a736e]"}`}
              >
                <DotsSixVertical size={12} className="opacity-35" />
                {node.kind === "primary-action" ? <Selection size={12} /> : node.kind === "money-input" ? <TextT size={12} /> : <Stack size={12} />}
                <span className="min-w-0 flex-1 truncate">{node.intent.label ?? nodeNames[node.kind]}</span>
                {visible ? <Eye size={11} className="opacity-0 group-hover:opacity-55" /> : <EyeSlash size={11} aria-label={`Hidden in ${activeVisualState} state`} />}
              </button>
            );
          })}
          {filteredNodes.length === 0 ? <div className="mx-1 mt-3 rounded-lg border border-dashed border-[#d4d9d5] px-3 py-5 text-center text-[9px] leading-relaxed text-[#818984]">No layers match “{layerQuery}”.</div> : null}
        </div>
      </aside>

      <section className="relative grid h-full min-h-0 min-w-0 grid-rows-[44px_minmax(0,1fr)_34px] bg-[#e1e4e1]">
        <div className="relative flex items-center justify-between border-b border-[#cfd4d0] bg-[#f8f9f7]/96 px-2.5 text-[#343936] shadow-[0_1px_0_rgba(255,255,255,.9)] backdrop-blur-xl">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              aria-label="Open pages and layers"
              aria-controls="editor-structure-panel"
              aria-expanded={mobilePanel === "structure"}
              onClick={() => toggleEditorPanel("structure")}
              className={`min-h-8 items-center gap-1.5 rounded-lg px-2 text-[9px] font-medium text-[#5c6560] hover:bg-[#e9edea] ${desktopPanels.structure ? "inline-flex xl:hidden" : "inline-flex"}`}
            >
              <Stack size={13} /> Layers
            </button>
            <button type="button" aria-label="Open command menu" title="Commands · ⌘K" aria-expanded={commandOpen} onClick={() => setCommandOpen((open) => !open)} className="inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2 text-[9px] font-medium text-[#5c6560] hover:bg-[#e9edea]">
              <Command size={13} /> <span className="hidden 2xl:inline">Commands</span><kbd className="ml-1 hidden rounded border border-[#d7dcd8] bg-white px-1 font-mono text-[7px] text-[#8a928d] 2xl:inline">⌘K</kbd>
            </button>
          </div>
          <div className="absolute left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-[9px] border border-[#cbd0cc] bg-white p-0.5 shadow-[0_7px_18px_-14px_rgba(22,30,26,.65)]">
            {([
              { id: "select", label: "Select", icon: Cursor },
              { id: "hand", label: "Pan", icon: Hand },
            ] as const).map((item) => {
              const Icon = item.icon;
              return <button key={item.id} type="button" aria-label={item.label} aria-pressed={tool === item.id} onClick={() => setTool(item.id)} className={`grid size-7 place-items-center rounded-[7px] ${tool === item.id ? "bg-[#397461] text-white shadow-[0_4px_10px_-6px_rgba(36,84,68,.9)]" : "text-[#69706c] hover:bg-[#edf0ed]"}`}><Icon size={14} weight={tool === item.id ? "fill" : "regular"} /></button>;
            })}
            <span className="mx-1 h-4 w-px bg-[#d9ddda]" />
            <button type="button" aria-label="Undo" disabled={!canUndo} onClick={onUndo} className="grid size-7 place-items-center rounded-md text-[#69706c] hover:bg-[#edf0ed] disabled:opacity-25"><ArrowCounterClockwise size={14} /></button>
            <button type="button" aria-label="Redo" disabled={!canRedo} onClick={onRedo} className="grid size-7 place-items-center rounded-md text-[#69706c] hover:bg-[#edf0ed] disabled:opacity-25"><ArrowClockwise size={14} /></button>
          </div>
          <div className="flex items-center gap-1.5">
            <button type="button" aria-label="Toggle preview mode" aria-pressed={previewMode} onClick={() => setPreviewMode((current) => !current)} className={`inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 text-[9px] font-medium ${previewMode ? "bg-[#dceae3] text-[#214d3f]" : "text-[#5c6560] hover:bg-[#e9edea]"}`}><MonitorPlay size={13} weight={previewMode ? "fill" : "regular"} /> Preview</button>
            <button
              type="button"
              aria-label="Open design inspector"
              aria-controls="editor-inspector-panel"
              aria-expanded={mobilePanel === "inspector"}
              onClick={() => toggleEditorPanel("inspector")}
              className={`min-h-8 items-center gap-1.5 rounded-lg px-2 text-[9px] font-medium text-[#5c6560] hover:bg-[#e9edea] ${desktopPanels.inspector ? "inline-flex xl:hidden" : "inline-flex"}`}
            >
              Design <Selection size={13} />
            </button>
          </div>
        </div>

        <div
          ref={canvasRef}
          className={`editor-canvas relative min-h-0 overflow-auto p-14 md:p-20 ${tool === "hand" ? "cursor-grab active:cursor-grabbing" : ""}`}
          onPointerDown={(event) => {
            if ((tool !== "hand" && event.button !== 1) || !canvasRef.current) return;
            event.preventDefault();
            panOrigin.current = { x: event.clientX, y: event.clientY, left: canvasRef.current.scrollLeft, top: canvasRef.current.scrollTop };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (!panOrigin.current || !canvasRef.current) return;
            canvasRef.current.scrollLeft = panOrigin.current.left - (event.clientX - panOrigin.current.x);
            canvasRef.current.scrollTop = panOrigin.current.top - (event.clientY - panOrigin.current.y);
          }}
          onPointerUp={(event) => {
            if (!panOrigin.current) return;
            panOrigin.current = null;
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onWheel={(event) => {
            if (!event.metaKey && !event.ctrlKey) return;
            event.preventDefault();
            setZoom((value) => Math.max(40, Math.min(130, value + (event.deltaY < 0 ? 5 : -5))));
          }}
          onClick={(event) => { if (event.currentTarget === event.target) onSelectNode(null); }}
        >
          <div className="mx-auto w-fit origin-top transition-transform duration-300 ease-[cubic-bezier(.16,1,.3,1)]" style={{ transform: `scale(${canvasScale})` }}>
            <div className="mb-2.5 flex items-center justify-between px-1 text-[9px] font-medium text-[#68716c]"><span>{screen.title} <span className="px-1 text-[#abb1ad]">/</span> <span className="capitalize">{activeVisualState}</span></span><span className="font-mono">{activeProfile.label} · {activeProfile.detail}</span></div>
            <div
              className="relative flex flex-col overflow-hidden border-[9px] border-[#202421] bg-[#fbfcf9] px-7 pb-7 pt-5 text-[#181c1a] shadow-[0_38px_80px_-34px_rgba(25,35,30,.5),inset_0_0_0_1px_rgba(255,255,255,.22)] transition-[width,height,border-radius] duration-300"
              style={{ width: activeProfile.width, height: activeProfile.height, borderRadius: activeProfile.breakpoint === "compact" ? 42 : 48 }}
              data-testid="device-frame"
              data-breakpoint={activeProfile.breakpoint}
              data-visual-state={activeVisualState}
            >
              <div className="mx-auto mb-6 h-5 w-24 rounded-full bg-[#202421]" />
              <span className="text-[9px] font-bold uppercase tracking-[.16em] text-[#397461]">{graph.product.name}</span>
              <h2 className="mb-5 mt-1 text-[24px] font-semibold tracking-[-.055em]">{screen.title}</h2>
              <div className="flex min-h-0 flex-1 flex-col gap-4">
                {visibleNodes.map((node) => {
                  const selected = node.id === selectedNodeId;
                  const persistent = node.kind === "primary-action" && node.layout.placement?.[activeProfile.breakpoint] === "persistent-bottom";
                  return (
                    <motion.div
                      layout
                      drag={!previewMode && tool === "select" && node.kind === "primary-action" ? "y" : false}
                      dragConstraints={{ top: -72, bottom: 72 }}
                      dragElastic={0.12}
                      dragSnapToOrigin
                      onDragEnd={(_, info) => {
                        if (node.kind !== "primary-action") return;
                        const breakpoint = activeProfile.breakpoint;
                        if (info.offset.y > 28 && node.layout.placement?.[breakpoint] !== "persistent-bottom") {
                          onSelectNode(node.id);
                          updateNodeById(node.id, (draft) => { if (draft.layout.placement) draft.layout.placement[breakpoint] = "persistent-bottom"; }, `Anchored primary action to the ${breakpoint} bottom safe area.`);
                        } else if (info.offset.y < -28 && node.layout.placement?.[breakpoint] === "persistent-bottom") {
                          onSelectNode(node.id);
                          updateNodeById(node.id, (draft) => { if (draft.layout.placement) draft.layout.placement[breakpoint] = "inline"; }, `Returned primary action to the ${breakpoint} semantic stack.`);
                        }
                      }}
                      key={node.id}
                      data-testid={`canvas-node-${node.id}`}
                      role="button"
                      tabIndex={previewMode ? -1 : 0}
                      aria-label={`Select ${nodeNames[node.kind]}`}
                      onClick={(event) => { event.stopPropagation(); if (!previewMode) onSelectNode(node.id); }}
                      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelectNode(node.id); } }}
                      className={`relative rounded-[18px] outline-none ${persistent ? "mt-auto" : ""} ${!previewMode && tool === "select" && node.kind === "primary-action" ? "cursor-ns-resize" : "cursor-default"}`}
                    >
                      <CanvasNodePreview node={node} />
                      {selected && !previewMode ? (
                        <>
                          <span className="pointer-events-none absolute -inset-1.5 rounded-[20px] border-2 border-[#3787f0]" />
                          {[["-left-2.5", "-top-2.5"], ["-right-2.5", "-top-2.5"], ["-bottom-2.5", "-left-2.5"], ["-bottom-2.5", "-right-2.5"]].map((position) => <span key={position.join()} className={`pointer-events-none absolute size-2 rounded-[2px] border border-[#1769ce] bg-white ${position.join(" ")}`} />)}
                          <span className="pointer-events-none absolute -top-7 left-0 rounded-md bg-[#1769ce] px-2 py-1 font-mono text-[8px] text-white">{nodeNames[node.kind]}</span>
                        </>
                      ) : null}
                      {selected && persistent && !previewMode ? <span className="pointer-events-none absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-[#85b4ee] bg-[#edf5ff] px-2 py-1 font-mono text-[8px] text-[#1769ce]">Bottom safe area · {activeProfile.breakpoint}</span> : null}
                    </motion.div>
                  );
                })}
                {visibleNodes.length === 0 ? <div className="grid flex-1 place-items-center rounded-2xl border border-dashed border-[#c8cfca] px-8 text-center text-[10px] leading-relaxed text-[#747d77]">No nodes are bound to the {activeVisualState} state yet. Add a state-specific pattern or change the preview fixture.</div> : null}
              </div>
              <div className="mx-auto mt-5 h-1 w-24 rounded-full bg-[#202421]" />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-[#cfd4d0] bg-[#f5f7f5] px-2 text-[9px] text-[#6f7772]">
          <div className="flex min-w-0 items-center gap-1.5">
            <label className="relative flex items-center gap-1.5 rounded-md border border-[#c8ceca] bg-white px-2 text-[#5f6863]">
              <DeviceMobile size={11} aria-hidden="true" />
              <span className="sr-only">Preview device</span>
              <select aria-label="Preview device" value={activeProfile.id} onChange={(event) => selectDevice(event.target.value)} className="min-h-7 max-w-32 appearance-none bg-transparent pr-3 text-[9px] font-semibold outline-none">
                {deviceProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.label} · {profile.detail}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-1.5 rounded-md border border-[#c8ceca] bg-white px-2 text-[#5f6863]">
              <span className="size-1.5 rounded-full bg-[#397461]" aria-hidden="true" />
              <span className="sr-only">Visual state</span>
              <select aria-label="Visual state" value={activeVisualState} onChange={(event) => selectVisualState(event.target.value as VisualState)} className="min-h-7 appearance-none bg-transparent pr-3 text-[9px] font-semibold capitalize outline-none">
                {availableStates.map((state) => <option key={state} value={state}>{state}</option>)}
              </select>
            </label>
            <span className="hidden truncate font-mono text-[8px] 2xl:inline">{previewMode ? "Preview mode · selection chrome hidden" : tool === "select" ? `Drag action → ${activeProfile.breakpoint} placement` : `${tool[0]?.toUpperCase()}${tool.slice(1)} tool`}</span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button type="button" aria-label="Fit canvas" title="Fit canvas · 0" onClick={fitCanvas} className="grid size-7 place-items-center rounded-md border border-[#c8ceca] bg-white text-[#707873] hover:bg-[#e5e9e6]"><ArrowsOutSimple size={11} /></button>
            <div className="flex items-center gap-1 rounded-md border border-[#c8ceca] bg-white p-0.5">
              <button type="button" aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(40, value - 10))} className="grid size-6 place-items-center rounded text-[#707873] hover:bg-[#edf0ed]"><Minus size={10} /></button>
              <span className="w-9 text-center font-mono">{zoom}%</span>
              <button type="button" aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(130, value + 10))} className="grid size-6 place-items-center rounded text-[#707873] hover:bg-[#edf0ed]"><Plus size={10} /></button>
            </div>
            <button type="button" aria-label="Show keyboard shortcuts" title="Keyboard shortcuts · ?" aria-expanded={shortcutsOpen} onClick={() => setShortcutsOpen((open) => !open)} className="grid size-7 place-items-center rounded-md border border-[#c8ceca] bg-white text-[#707873] hover:bg-[#e5e9e6]"><Keyboard size={12} /></button>
          </div>
        </div>
      </section>

      <aside
        id="editor-inspector-panel"
        aria-label="Design inspector"
        className={`${mobilePanel === "inspector" ? "block" : "hidden"} ${desktopPanels.inspector ? "xl:block" : "xl:hidden"} absolute inset-y-0 right-0 z-[3] w-[310px] min-h-0 overflow-auto border-l border-[#d7dbd8] bg-[#f8f9f7] text-[#29302c] shadow-[-24px_0_52px_-32px_rgba(24,34,28,.32)] xl:static xl:z-auto xl:w-auto xl:shadow-none`}
      >
        <div className="flex h-11 items-center justify-between border-b border-[#dde1de] px-3">
          <div className="flex items-center gap-2"><span className="text-[10px] font-semibold text-[#303632]">Design</span><span className="rounded-md bg-[#e2ebe6] px-1.5 py-0.5 font-mono text-[7px] text-[#356652]">semantic</span></div>
          <button type="button" aria-label="Close design inspector" onClick={() => closeEditorPanel("inspector")} className="grid size-7 place-items-center rounded-md text-[#727b76] hover:bg-[#e9edea] hover:text-[#222725]"><X size={13} /></button>
        </div>
        {selectedNode ? (
          <div data-testid="semantic-inspector" className="divide-y divide-[#e1e5e2]">
            <section className="grid gap-2 p-4">
              <label className="grid gap-2 text-[9px] text-[#747d78]">
                Screen name
                <input
                  key={screen.id + screen.title}
                  defaultValue={screen.title}
                  onBlur={(event) => updateScreenTitle(event.target.value.trim())}
                  className="min-h-8 rounded-lg border border-[#d7dcd8] bg-white px-2.5 text-[10px] text-[#2f3531] outline-none focus:border-[#6c9a85] focus:shadow-[0_0_0_3px_rgba(57,116,97,.08)]"
                />
              </label>
              <span className="font-mono text-[8px] text-[#8a928d]">{screen.route}</span>
            </section>
            <section className="p-4">
              <div className="flex items-center justify-between">
                <div className="min-w-0"><span className="block text-[10px] font-semibold">{nodeNames[selectedNode.kind]}</span><span className="mt-1 block truncate font-mono text-[8px] text-[#8a928d]">{selectedNode.id}</span></div>
                <div className="flex gap-1">
                  <button type="button" aria-label="Duplicate layer" onClick={duplicateNode} className="grid size-7 place-items-center rounded-md text-[#747d78] hover:bg-[#e8ece9] hover:text-[#29302c]"><Copy size={12} /></button>
                  <button type="button" aria-label="Move layer up" onClick={() => reorderNode(-1)} className="grid size-7 place-items-center rounded-md text-[#747d78] hover:bg-[#e8ece9] hover:text-[#29302c]"><ArrowUp size={12} /></button>
                  <button type="button" aria-label="Move layer down" onClick={() => reorderNode(1)} className="grid size-7 place-items-center rounded-md text-[#747d78] hover:bg-[#e8ece9] hover:text-[#29302c]"><ArrowDown size={12} /></button>
                  <button type="button" aria-label="Delete layer" onClick={deleteNode} disabled={screen.nodes.length <= 1} className="grid size-7 place-items-center rounded-md text-[#747d78] hover:bg-[#f3e5e1] hover:text-[#9b4432] disabled:opacity-25"><Trash size={12} /></button>
                </div>
              </div>
            </section>

            <section className="grid gap-4 p-4">
              <h3 className="text-[10px] font-semibold">Content</h3>
              <label className="grid gap-2 text-[9px] text-[#747d78]">
                Label
                <input
                  key={selectedNode.id + selectedNode.intent.label}
                  defaultValue={selectedNode.intent.label}
                  onBlur={(event) => {
                    const label = event.target.value.trim();
                    if (label && label !== selectedNode.intent.label) updateNode((node) => { node.intent.label = label; node.accessibility.label = label; }, "Updated visible and accessible label.");
                  }}
                  className="min-h-8 rounded-lg border border-[#d7dcd8] bg-white px-2.5 text-[10px] text-[#2f3531] outline-none focus:border-[#6c9a85] focus:shadow-[0_0_0_3px_rgba(57,116,97,.08)]"
                />
              </label>
            </section>

            <section className="grid gap-4 p-4">
              <div className="flex items-center justify-between"><h3 className="text-[10px] font-semibold">Semantic layout</h3><Stack size={13} className="text-[#8a928d]" /></div>
              <SegmentedControl label="Axis" value={selectedNode.layout.axis} options={[{ value: "vertical", label: "Vertical" }, { value: "horizontal", label: "Horizontal" }, { value: "overlay", label: "Overlay" }]} onChange={(value) => updateNode((node) => { node.layout.axis = value; }, `Changed layout axis to ${value}.`)} />
              <SegmentedControl label="Width" value={selectedNode.layout.width} options={[{ value: "hug", label: "Hug" }, { value: "fill", label: "Fill" }, { value: "fixed", label: "Fixed" }]} onChange={(value) => updateNode((node) => { node.layout.width = value; }, `Changed semantic width to ${value}.`)} />
              <div className="grid grid-cols-2 gap-2">
                <label className="grid gap-2 text-[9px] text-[#747d78]">Gap token<select value={selectedNode.layout.gapToken} onChange={(event) => updateNode((node) => { node.layout.gapToken = event.target.value; }, `Bound gap to ${event.target.value}.`)} className="min-h-8 rounded-lg border border-[#d7dcd8] bg-white px-2 text-[9px] text-[#2f3531] outline-none focus:border-[#6c9a85]">{Object.keys(graph.tokens.spacing).map((token) => <option key={token}>{token}</option>)}</select></label>
                <label className="grid gap-2 text-[9px] text-[#747d78]">Padding token<select value={selectedNode.layout.paddingToken} onChange={(event) => updateNode((node) => { node.layout.paddingToken = event.target.value; }, `Bound padding to ${event.target.value}.`)} className="min-h-8 rounded-lg border border-[#d7dcd8] bg-white px-2 text-[9px] text-[#2f3531] outline-none focus:border-[#6c9a85]">{Object.keys(graph.tokens.spacing).map((token) => <option key={token}>{token}</option>)}</select></label>
              </div>
              {selectedNode.kind === "primary-action" && selectedNode.layout.placement ? (
                <SegmentedControl label={`${activeProfile.breakpoint === "compact" ? "Compact" : "Regular"} placement`} value={selectedNode.layout.placement[activeProfile.breakpoint]} options={[{ value: "inline", label: "Inline" }, { value: "persistent-bottom", label: "Bottom safe area" }]} onChange={(value) => updateNode((node) => { if (node.layout.placement) node.layout.placement[activeProfile.breakpoint] = value; }, value === "persistent-bottom" ? `Anchored action to the ${activeProfile.breakpoint} bottom safe area.` : `Returned action to the ${activeProfile.breakpoint} semantic stack.`)} />
              ) : null}
              {selectedNode.states.length > 0 ? <div className="rounded-lg border border-[#d7dfda] bg-[#edf3ef] p-3 text-[9px] text-[#68716c]"><span className="block font-medium text-[#385c4c]">State visibility</span><span className="mt-1 block font-mono text-[8px]">{selectedNode.states.map((state) => state.name).join(", ")}</span></div> : null}
            </section>

            <section className="grid gap-4 p-4">
              <h3 className="text-[10px] font-semibold">Style intent</h3>
              <SegmentedControl label="Emphasis" value={selectedNode.style.emphasis} options={[{ value: "quiet", label: "Quiet" }, { value: "normal", label: "Normal" }, { value: "strong", label: "Strong" }]} onChange={(value) => updateNode((node) => { node.style.emphasis = value; }, `Changed semantic emphasis to ${value}.`)} />
              <div className="rounded-lg border border-[#d7dfda] bg-[#edf3ef] p-3">
                <div className="flex items-center gap-2 text-[9px] font-medium text-[#385c4c]"><Selection size={12} className="text-[#397461]" /> Compiles responsively</div>
                <p className="mt-2 text-[8px] leading-relaxed text-[#737d78]">Manual edits change graph properties, never viewport coordinates. React and SwiftUI lower the same relation differently.</p>
              </div>
            </section>
          </div>
        ) : (
          <div className="grid min-h-72 place-items-center p-6 text-center"><div><span className="mx-auto grid size-10 place-items-center rounded-xl border border-[#dce1dd] bg-white text-[#7b847f]"><Cursor size={18} /></span><p className="mt-3 text-[10px] text-[#7b847f]">Select a layer to edit its semantic properties.</p></div></div>
        )}
      </aside>
    </div>
  );
}
