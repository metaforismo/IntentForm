"use client";

import {
  ArrowDown,
  ArrowUp,
  CheckCircle,
  Copy,
  PencilSimple,
  Trash,
  Warning,
} from "@phosphor-icons/react";
import { findSemanticNode, type SemanticInterfaceGraph, type SemanticNode } from "@intentform/semantic-schema";
import { motion } from "motion/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { NodePreview, semanticNodeBoxStyle } from "./node-preview";
import { SelectionOverlay } from "./selection-overlay";
import type { Point, ResizeCandidate, SelectionIntent } from "./direct-manipulation";
import {
  FRAME_GAP,
  FRAME_HEADER_WORLD,
  fixtureFor,
  isNodeVisible,
  nodeNames,
  tokenColor,
  type DeviceProfile,
  type EditorTool,
  type FrameStatus,
  type NodeCommand,
  type VisualState,
} from "./support";

export interface CanvasApi {
  fitAll(smooth?: boolean): void;
  fitScreen(screenId: string, smooth?: boolean): void;
  zoomBy(factor: number): void;
  zoomTo(scale: number): void;
}

interface ViewTransform {
  x: number;
  y: number;
  scale: number;
}

interface CanvasStageProps {
  graph: SemanticInterfaceGraph;
  selectedScreen: string;
  selectedNodeId: string | null;
  selectedNodeIds: readonly string[];
  hoveredNodeId: string | null;
  tool: EditorTool;
  spaceHeld: boolean;
  previewMode: boolean;
  showDeviceChrome: boolean;
  bezelOverlay: {
    src: string;
    image: { width: number; height: number };
    viewport: { x: number; y: number; width: number; height: number };
  } | null;
  profile: DeviceProfile;
  apiRef: RefObject<CanvasApi | null>;
  visualStateFor(screenId: string): VisualState;
  frameStatus(screenId: string): FrameStatus;
  onSelectScreen(screenId: string): void;
  onSelectNode(nodeId: string | null, intent?: SelectionIntent): void;
  onAnchor(nodeId: string, placement: "inline" | "persistent-bottom"): void;
  onReorderSelection(screenId: string, parentId: string | null, orderedIds: string[]): void;
  onMoveFreeform(positions: Readonly<Record<string, Point>>): void;
  onResizeNode(nodeId: string, size: ResizeCandidate): void;
  onGroupSelection(): void;
  onDuplicateSelection(): void;
  onDeleteSelection(): void;
  onMoveSelection(direction: -1 | 1): void;
  onNodeCommand(command: NodeCommand, nodeId: string, screenId: string): void;
  onRenameNode(nodeId: string, screenId: string, label: string): void;
  onOpenVerify(): void;
  onZoomChange(percent: number): void;
}

const MIN_SCALE = 0.12;
const MAX_SCALE = 2.5;
const EASE = "cubic-bezier(.22, 1, .36, 1)";

const clampScale = (value: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));

export function CanvasStage({
  graph,
  selectedScreen,
  selectedNodeId,
  selectedNodeIds,
  hoveredNodeId,
  tool,
  spaceHeld,
  previewMode,
  showDeviceChrome,
  bezelOverlay,
  profile,
  apiRef,
  visualStateFor,
  frameStatus,
  onSelectScreen,
  onSelectNode,
  onAnchor,
  onReorderSelection,
  onMoveFreeform,
  onResizeNode,
  onGroupSelection,
  onDuplicateSelection,
  onDeleteSelection,
  onMoveSelection,
  onNodeCommand,
  onRenameNode,
  onOpenVerify,
  onZoomChange,
}: CanvasStageProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<ViewTransform>({ x: 0, y: 0, scale: 0.6 });
  const panSession = useRef<{ pointerId: number; x: number; y: number; view: ViewTransform } | null>(null);
  const interacted = useRef(false);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const contextMenuReturnFocus = useRef<HTMLElement | null>(null);
  const renameReturnFocus = useRef<HTMLElement | null>(null);
  const renameWasOpen = useRef(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId: string; screenId: string } | null>(null);
  const [rename, setRename] = useState<{ nodeId: string; screenId: string; x: number; y: number; width: number; value: string } | null>(null);

  const frames = useMemo(
    () => graph.screens.map((screen, index) => ({ screen, x: index * (profile.width + FRAME_GAP) })),
    [graph.screens, profile.width],
  );
  const worldWidth = frames.length > 0 ? frames.length * profile.width + (frames.length - 1) * FRAME_GAP : profile.width;
  const worldHeight = profile.height + FRAME_HEADER_WORLD;

  const applyView = useCallback((next: ViewTransform, smooth: boolean) => {
    const world = worldRef.current;
    const viewport = viewportRef.current;
    viewRef.current = next;
    if (!world || !viewport) return;
    const transition = smooth
      ? `transform 320ms ${EASE}`
      : "none";
    world.style.transition = transition;
    world.style.transform = `translate(${next.x}px, ${next.y}px) scale(${next.scale})`;
    world.style.setProperty("--s", String(next.scale));
    world.style.setProperty("--inv", String(1 / next.scale));
    viewport.style.transition = smooth
      ? `background-position 320ms ${EASE}, background-size 320ms ${EASE}`
      : "none";
    viewport.style.backgroundPosition = `${next.x}px ${next.y}px`;
    viewport.style.backgroundSize = `${24 * next.scale}px ${24 * next.scale}px`;
    // The dot grid reads as noise once frames are small; fade it out.
    viewport.style.backgroundImage = next.scale < 0.45 ? "none" : "";
    onZoomChange(Math.round(next.scale * 100));
  }, [onZoomChange]);

  const fitAll = useCallback((smooth = true) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const scale = clampScale(Math.min(
      (viewport.clientWidth - 150) / worldWidth,
      (viewport.clientHeight - 130) / worldHeight,
      1,
    ));
    applyView({
      scale,
      x: (viewport.clientWidth - worldWidth * scale) / 2,
      y: (viewport.clientHeight - worldHeight * scale) / 2 + FRAME_HEADER_WORLD * scale * 0.4,
    }, smooth);
  }, [applyView, worldHeight, worldWidth]);

  const fitScreen = useCallback((screenId: string, smooth = true) => {
    const viewport = viewportRef.current;
    const frame = frames.find((item) => item.screen.id === screenId);
    if (!viewport || !frame) return;
    const compactWorkspace = viewport.clientWidth < 640;
    const horizontalInset = compactWorkspace ? 40 : 260;
    const topInset = compactWorkspace ? 104 : 0;
    const bottomInset = compactWorkspace ? 56 : 0;
    const availableHeight = viewport.clientHeight - topInset - bottomInset;
    const scale = clampScale(Math.min(
      (viewport.clientWidth - horizontalInset) / profile.width,
      (compactWorkspace ? availableHeight : viewport.clientHeight - 150) / worldHeight,
      1.1,
    ));
    applyView({
      scale,
      x: viewport.clientWidth / 2 - (frame.x + profile.width / 2) * scale,
      y: compactWorkspace
        ? topInset + (availableHeight - worldHeight * scale) / 2 + FRAME_HEADER_WORLD * scale * 0.4
        : (viewport.clientHeight - worldHeight * scale) / 2 + FRAME_HEADER_WORLD * scale * 0.4,
    }, smooth);
  }, [applyView, frames, profile.width, worldHeight]);

  const zoomAt = useCallback((px: number, py: number, nextScale: number, smooth = false) => {
    const view = viewRef.current;
    const scale = clampScale(nextScale);
    applyView({
      scale,
      x: px - ((px - view.x) * scale) / view.scale,
      y: py - ((py - view.y) * scale) / view.scale,
    }, smooth);
  }, [applyView]);

  const zoomBy = useCallback((factor: number) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    interacted.current = true;
    zoomAt(viewport.clientWidth / 2, viewport.clientHeight / 2, viewRef.current.scale * factor, true);
  }, [zoomAt]);

  const zoomTo = useCallback((scale: number) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    interacted.current = true;
    zoomAt(viewport.clientWidth / 2, viewport.clientHeight / 2, scale, true);
  }, [zoomAt]);

  useEffect(() => {
    apiRef.current = { fitAll, fitScreen, zoomBy, zoomTo };
  }, [apiRef, fitAll, fitScreen, zoomBy, zoomTo]);

  /* Wheel: two-finger scroll pans the board, ⌘/ctrl+wheel (and trackpad pinch)
     zooms into the pointer. Registered natively so preventDefault sticks. */
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      interacted.current = true;
      setContextMenu(null);
      setRename(null);
      const view = viewRef.current;
      if (event.ctrlKey || event.metaKey) {
        const rect = viewport.getBoundingClientRect();
        const factor = Math.exp(-event.deltaY * (event.deltaMode === 1 ? 0.05 : 0.0021));
        zoomAt(event.clientX - rect.left, event.clientY - rect.top, view.scale * factor);
      } else {
        applyView({ ...view, x: view.x - event.deltaX, y: view.y - event.deltaY }, false);
      }
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, [applyView, zoomAt]);

  const selectedScreenRef = useRef(selectedScreen);
  selectedScreenRef.current = selectedScreen;
  const fitScreenRef = useRef(fitScreen);
  fitScreenRef.current = fitScreen;

  /* Open on the selected frame at a readable zoom (neighbors peeking in)
     instead of a distant fit-all — the board invites editing immediately.
     Refit only when the device or the number of frames changes; ordinary
     graph edits must never move the camera. */
  useLayoutEffect(() => {
    fitScreenRef.current(selectedScreenRef.current, false);
    // The initial framing runs once; later dependency changes refit below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fitScreenRef.current(selectedScreenRef.current, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id, frames.length]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(() => {
      if (!interacted.current) fitScreenRef.current(selectedScreenRef.current, false);
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    requestAnimationFrame(() => contextMenuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus());
    const close = () => setContextMenu(null);
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
      if (contextMenuReturnFocus.current?.isConnected) contextMenuReturnFocus.current.focus();
    };
  }, [contextMenu]);

  useEffect(() => {
    const wasOpen = renameWasOpen.current;
    renameWasOpen.current = Boolean(rename);
    if (!rename && wasOpen && renameReturnFocus.current?.isConnected) renameReturnFocus.current.focus();
  }, [rename]);

  const panActive = tool === "hand" || spaceHeld;

  const beginPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!panActive && event.button !== 1) return;
    event.preventDefault();
    interacted.current = true;
    panSession.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, view: viewRef.current };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const startRename = useCallback((node: SemanticNode, screenId: string) => {
    const viewport = viewportRef.current;
    const element = viewport?.querySelector(`[data-testid="canvas-node-${window.CSS ? CSS.escape(node.id) : node.id}"]`);
    if (!viewport || !element) return;
    const nodeRect = element.getBoundingClientRect();
    const viewportRect = viewport.getBoundingClientRect();
    renameReturnFocus.current = element as HTMLElement;
    setRename({
      nodeId: node.id,
      screenId,
      x: nodeRect.left - viewportRect.left,
      y: nodeRect.bottom - viewportRect.top + 8,
      width: Math.max(220, Math.min(360, nodeRect.width)),
      value: node.intent.label ?? "",
    });
  }, []);

  const openContextMenu = (
    element: HTMLElement,
    nodeId: string,
    screenId: string,
    clientPosition?: { x: number; y: number },
  ) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const viewportRect = viewport.getBoundingClientRect();
    const nodeRect = element.getBoundingClientRect();
    contextMenuReturnFocus.current = element;
    element.focus();
    setContextMenu({
      x: (clientPosition?.x ?? nodeRect.right) - viewportRect.left,
      y: (clientPosition?.y ?? nodeRect.top) - viewportRect.top,
      nodeId,
      screenId,
    });
  };

  const commitRename = () => {
    if (!rename) return;
    const value = rename.value.trim();
    setRename(null);
    if (value) onRenameNode(rename.nodeId, rename.screenId, value);
  };

  const accent = tokenColor(graph, "color.accent", "#397461");
  /* Parent re-renders on every integer zoom change (zoom readout state), so
     reading the live scale here stays in sync without an extra prop. */
  const headerCompact = viewRef.current.scale < 0.55;

  const flowEdges = useMemo(() => {
    const index = new Map(frames.map((frame, position) => [frame.screen.id, position]));
    return graph.flows.flatMap((flow) => flow.steps.flatMap((step) => {
      const from = index.get(step.from);
      const to = index.get(step.to);
      if (from === undefined || to === undefined || from === to) return [];
      const x1 = frames[from]!.x + profile.width;
      const x2 = frames[to]!.x;
      const y = FRAME_HEADER_WORLD + Math.min(150, profile.height * 0.22);
      const forward = to > from;
      const path = forward
        ? `M ${x1} ${y} C ${x1 + FRAME_GAP * 0.55} ${y}, ${x2 - FRAME_GAP * 0.55} ${y}, ${x2 - 10} ${y}`
        : `M ${frames[from]!.x} ${y} C ${frames[from]!.x - 90} ${y - 150}, ${x1 + 90} ${y - 150}, ${frames[to]!.x + profile.width + 10} ${y}`;
      const labelX = forward ? (x1 + x2) / 2 : (frames[to]!.x + profile.width + frames[from]!.x) / 2;
      const labelY = forward ? y - 14 : y - 160;
      return [{ id: `${flow.id}.${step.from}.${step.event}`, path, event: step.event, labelX, labelY }];
    }));
  }, [frames, graph.flows, profile.height, profile.width]);

  return (
    <div
      ref={viewportRef}
      data-testid="canvas-viewport"
      className={`editor-viewport absolute inset-0 overflow-hidden ${panActive ? "cursor-grab active:cursor-grabbing" : ""}`}
      onPointerDown={(event) => {
        if (panActive || event.button === 1) {
          beginPan(event);
          return;
        }
        if (event.target === event.currentTarget || (event.target as HTMLElement).dataset?.canvasBg === "true") {
          onSelectNode(null);
        }
      }}
      onPointerMove={(event) => {
        const session = panSession.current;
        if (!session || session.pointerId !== event.pointerId) return;
        applyView({
          ...session.view,
          x: session.view.x + (event.clientX - session.x),
          y: session.view.y + (event.clientY - session.y),
        }, false);
      }}
      onPointerUp={(event) => {
        if (panSession.current?.pointerId === event.pointerId) {
          panSession.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onDoubleClick={(event) => {
        if (event.target === event.currentTarget) fitAll(true);
      }}
    >
      <div ref={worldRef} className="editor-world absolute left-0 top-0" style={{ width: worldWidth, height: worldHeight }}>
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute overflow-visible"
          style={{ left: 0, top: 0, width: worldWidth, height: worldHeight }}
        >
          <defs>
            <marker id="flow-arrow" viewBox="0 0 8 8" refX="6.4" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0.6 L 7.4 4 L 0 7.4 z" fill="var(--flow-edge)" />
            </marker>
          </defs>
          {flowEdges.map((edge) => (
            <g key={edge.id}>
              <path d={edge.path} fill="none" stroke="var(--flow-edge)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" markerEnd="url(#flow-arrow)" />
              <text
                x={edge.labelX}
                y={edge.labelY}
                textAnchor="middle"
                fontSize={15}
                fontFamily="var(--font-geist-mono), monospace"
                fill="var(--flow-label)"
                paintOrder="stroke"
                stroke="var(--board)"
                strokeWidth={5}
              >
                {edge.event}
              </text>
            </g>
          ))}
        </svg>

        {frames.map(({ screen, x }) => {
          const isSelectedScreen = screen.id === selectedScreen;
          const state = visualStateFor(screen.id);
          const status = frameStatus(screen.id);
          const visibleNodes = screen.nodes.filter((node) => isNodeVisible(node, state));
          const fixture = fixtureFor(graph, screen.id, state);
          return (
            <div key={screen.id} className="absolute transition-[left,width,height] duration-300 ease-[cubic-bezier(.22,1,.36,1)]" style={{ left: x, top: FRAME_HEADER_WORLD, width: profile.width, height: profile.height }}>
              <div
                className="absolute left-0 flex items-end justify-between gap-3"
                style={{
                  bottom: "100%",
                  width: `calc(${profile.width}px * var(--s, 1))`,
                  transform: "scale(var(--inv, 1)) translateY(-6px)",
                  transformOrigin: "left bottom",
                }}
              >
                <button
                  type="button"
                  title="Double-click to zoom to this screen"
                  onClick={() => { onSelectScreen(screen.id); onSelectNode(screen.nodes[0]?.id ?? null); }}
                  onDoubleClick={() => fitScreen(screen.id, true)}
                  className={`flex min-w-0 items-baseline gap-2 rounded-md px-1.5 py-1 text-left text-[12px] font-semibold tracking-[-.01em] ${isSelectedScreen ? "text-[var(--accent-dark)]" : "text-[var(--muted)] hover:text-[var(--ink)]"}`}
                >
                  <span className="min-w-0 truncate">{screen.title}</span>
                  {isSelectedScreen && !headerCompact ? <span className="shrink-0 font-mono text-[10px] font-normal text-[var(--faint)]">{screen.route}</span> : null}
                  {state !== "idle" && !headerCompact ? <span className="shrink-0 rounded-full bg-[var(--chip)] px-1.5 py-0.5 font-mono text-[10px] font-medium capitalize text-[var(--muted)]">{state}</span> : null}
                </button>
                {status.errors > 0 ? (
                  <button type="button" onClick={onOpenVerify} className="flex shrink-0 items-center gap-1 rounded-full bg-[var(--danger-soft)] px-2 py-1 text-[10px] font-semibold text-[var(--danger)] hover:brightness-95">
                    <Warning size={11} weight="fill" /> {status.errors} {status.errors === 1 ? "issue" : "issues"}
                  </button>
                ) : status.warnings > 0 ? (
                  <button type="button" onClick={onOpenVerify} className="flex shrink-0 items-center gap-1 rounded-full bg-[var(--warn-soft)] px-2 py-1 text-[10px] font-semibold text-[var(--warn)] hover:brightness-95">
                    <Warning size={11} weight="fill" /> {status.warnings}
                  </button>
                ) : (
                  <span className="flex shrink-0 items-center gap-1 rounded-full bg-[var(--accent-soft)] px-2 py-1 text-[10px] font-semibold text-[var(--accent-dark)]">
                    <CheckCircle size={11} weight="fill" /> Pass
                  </span>
                )}
              </div>

              <div
                data-testid={isSelectedScreen ? "device-frame" : undefined}
                data-device-profile={profile.registryId}
                data-safe-area={`${profile.safeArea.top},${profile.safeArea.right},${profile.safeArea.bottom},${profile.safeArea.left}`}
                data-cutout-count={profile.cutouts.length}
                data-screen-id={screen.id}
                data-breakpoint={profile.breakpoint}
                data-visual-state={state}
                data-canvas-bg="false"
                onPointerDown={() => { if (!panActive && !isSelectedScreen) onSelectScreen(screen.id); }}
                className={`relative flex h-full w-full flex-col overflow-hidden bg-[#fcfdfb] text-[#181c1a] transition-shadow ${profile.presentation === "device" ? "" : "px-7 pb-7 pt-4"} ${isSelectedScreen ? "shadow-[0_44px_90px_-42px_rgba(24,35,29,.55),0_0_0_1.5px_var(--line-strong)]" : "shadow-[0_30px_60px_-40px_rgba(24,35,29,.45),0_0_0_1px_var(--line-strong)]"}`}
                style={{
                  borderRadius: profile.presentation === "device" ? profile.corners.radius : profile.presentation === "browser" ? 12 : 2,
                  ...(profile.presentation === "device" ? {
                    paddingTop: Math.max(16, profile.safeArea.top),
                    paddingRight: Math.max(28, profile.safeArea.right),
                    paddingBottom: Math.max(28, profile.safeArea.bottom),
                    paddingLeft: Math.max(28, profile.safeArea.left),
                  } : {}),
                }}
              >
                {profile.presentation === "device" && showDeviceChrome ? <>
                  <div data-testid={isSelectedScreen ? "device-status-chrome" : undefined} className="pointer-events-none absolute inset-x-5 top-2 z-[1] flex items-center justify-between text-[12px] font-semibold text-[#2a2f2c]" aria-hidden="true">
                    <span className="pl-1 font-mono tracking-[-.02em]">9:41</span>
                    <span className="flex items-center gap-1 pr-1">
                      <span className="h-2 w-3.5 rounded-[2px] border border-[#2a2f2c]/70" />
                      <span className="h-2 w-2 rounded-full border border-[#2a2f2c]/70" />
                    </span>
                  </div>
                  {profile.cutouts.map((cutout) => (
                    <span
                      key={cutout.id}
                      data-testid={isSelectedScreen ? `device-cutout-${cutout.id}` : undefined}
                      className="pointer-events-none absolute z-[2] bg-[#171a18]"
                      aria-hidden="true"
                      style={{
                        left: cutout.x,
                        top: cutout.y,
                        width: cutout.width,
                        height: cutout.height,
                        borderRadius: cutout.shape === "circle" ? "50%" : cutout.shape === "capsule" ? 999 : 4,
                      }}
                    />
                  ))}
                </> : profile.presentation === "browser" ? <div className="-mx-7 -mt-4 mb-7 flex h-11 shrink-0 items-center gap-2 border-b border-zinc-200 bg-zinc-100 px-4">
                  <span className="size-2 rounded-full bg-red-400" /><span className="size-2 rounded-full bg-amber-400" /><span className="size-2 rounded-full bg-emerald-400" />
                  <span className="ml-3 truncate rounded-md bg-white px-3 py-1 font-mono text-[10px] text-zinc-500">{screen.route}</span>
                </div> : null}
                <span className="text-[11px] font-bold uppercase tracking-[.16em]" style={{ color: accent }}>{graph.product.name}</span>
                <h2 className="mb-6 mt-1.5 text-[27px] font-semibold leading-[1.05] tracking-[-.045em]">{screen.title}</h2>
                <div data-testid={isSelectedScreen ? "device-content" : undefined} className="flex min-h-0 flex-1 flex-col" style={{ gap: 18 }}>
                  {visibleNodes.map((node) => {
                    const selected = selectedNodeIds.includes(node.id) && isSelectedScreen;
                    const persistent = node.kind === "primary-action" && node.layout.placement?.[profile.breakpoint] === "persistent-bottom";
                    const flowStep = previewMode && node.interactions[0]
                      ? graph.flows.flatMap((flow) => flow.steps).find((step) => step.from === screen.id && step.event === node.interactions[0]?.event)
                      : undefined;
                    return (
                      <motion.div
                        layout
                        key={node.id}
                        data-testid={`canvas-node-${node.id}`}
                        data-selected={selected}
                        data-cross-hover={hoveredNodeId === node.id}
                        role="button"
                        tabIndex={previewMode ? (flowStep ? 0 : -1) : 0}
                        aria-label={previewMode && flowStep
                          ? `Follow ${node.intent.label} to ${graph.screens.find((item) => item.id === flowStep.to)?.title ?? flowStep.to}`
                          : `Select ${nodeNames[node.kind]}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (panActive) return;
                          if (previewMode) {
                            if (flowStep) {
                              onSelectScreen(flowStep.to);
                              fitScreen(flowStep.to, true);
                            }
                            return;
                          }
                          onSelectScreen(screen.id);
                          onSelectNode(node.id, event.shiftKey ? "range" : event.metaKey || event.ctrlKey ? "toggle" : "replace");
                        }}
                        onDoubleClick={(event) => {
                          event.stopPropagation();
                          if (!previewMode && node.intent.label !== undefined) startRename(node, screen.id);
                        }}
                        onContextMenu={(event) => {
                          if (previewMode) return;
                          event.preventDefault();
                          event.stopPropagation();
                          onSelectScreen(screen.id);
                          onSelectNode(node.id);
                          openContextMenu(
                            event.currentTarget,
                            node.id,
                            screen.id,
                            event.clientX || event.clientY ? { x: event.clientX, y: event.clientY } : undefined,
                          );
                        }}
                        onKeyDown={(event) => {
                          if (event.shiftKey && event.key === "F10" && !previewMode) {
                            event.preventDefault();
                            openContextMenu(event.currentTarget, node.id, screen.id);
                            return;
                          }
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            if (previewMode && flowStep) {
                              onSelectScreen(flowStep.to);
                              fitScreen(flowStep.to, true);
                              return;
                            }
                            onSelectScreen(screen.id);
                            onSelectNode(node.id);
                          }
                        }}
                        className={`canvas-node relative rounded-[18px] outline-none ${persistent ? "mt-auto" : ""} ${flowStep ? "cursor-pointer" : "cursor-default"}`}
                        style={semanticNodeBoxStyle(node, graph, profile)}
                      >
                        <NodePreview
                          node={node}
                          graph={graph}
                          fixture={fixture}
                          state={state}
                          viewport={profile}
                          selectedNodeId={isSelectedScreen ? selectedNodeId : null}
                          selectedNodeIds={isSelectedScreen ? selectedNodeIds : []}
                          hoveredNodeId={hoveredNodeId}
                          {...(!previewMode && isSelectedScreen ? { onSelectNode: (nodeId: string, intent: SelectionIntent) => onSelectNode(nodeId, intent) } : {})}
                        />
                      </motion.div>
                    );
                  })}
                  {visibleNodes.length === 0 ? (
                    <div className="grid flex-1 place-items-center rounded-3xl border border-dashed border-[#c8cfca] px-8 text-center text-[13px] leading-relaxed text-[#747d77]">
                      No nodes are bound to the {state} state yet. Bind a layer to this state or switch the preview fixture.
                    </div>
                  ) : null}
                </div>
                {profile.presentation === "device" && showDeviceChrome ? <div data-testid={isSelectedScreen ? "device-home-indicator" : undefined} className="pointer-events-none absolute bottom-2 left-1/2 h-[5px] w-28 -translate-x-1/2 rounded-full bg-[#1d211f]" aria-hidden="true" /> : null}
              </div>
              {profile.presentation === "device" && bezelOverlay ? (
                <img
                  data-testid={isSelectedScreen ? "local-device-bezel" : undefined}
                  alt=""
                  aria-hidden="true"
                  draggable={false}
                  src={bezelOverlay.src}
                  className="pointer-events-none absolute z-[3] max-w-none select-none"
                  style={{
                    left: -bezelOverlay.viewport.x,
                    top: -bezelOverlay.viewport.y,
                    width: bezelOverlay.image.width,
                    height: bezelOverlay.image.height,
                  }}
                />
              ) : null}
            </div>
          );
        })}
        <SelectionOverlay
          graph={graph}
          screenId={selectedScreen}
          selectedNodeIds={selectedNodeIds}
          worldRef={worldRef}
          enabled={!previewMode && tool === "select"}
          breakpoint={profile.breakpoint}
          getScale={() => viewRef.current.scale}
          onReorder={onReorderSelection}
          onMoveFreeform={onMoveFreeform}
          onResize={onResizeNode}
          onAnchor={onAnchor}
          onGroup={onGroupSelection}
          onDuplicate={onDuplicateSelection}
          onDelete={onDeleteSelection}
          onOpenContextMenu={(clientPosition) => {
            const nodeId = selectedNodeId ?? selectedNodeIds.at(-1);
            const escaped = nodeId && typeof CSS !== "undefined" && CSS.escape ? CSS.escape(nodeId) : nodeId;
            const element = escaped ? worldRef.current?.querySelector<HTMLElement>(`[data-testid="canvas-node-${escaped}"]`) : null;
            if (element && nodeId) openContextMenu(element, nodeId, selectedScreen, clientPosition);
          }}
        />
      </div>

      {rename ? (
        <div className="absolute z-20" style={{ left: rename.x, top: rename.y, width: rename.width }}>
          <input
            autoFocus
            aria-label="Rename layer label"
            value={rename.value}
            onChange={(event) => setRename((current) => current ? { ...current, value: event.target.value } : current)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitRename();
              if (event.key === "Escape") setRename(null);
            }}
            className="floating-chrome w-full rounded-lg px-3 py-2 text-[12px] text-[var(--ink)] outline-none"
          />
        </div>
      ) : null}

      {contextMenu ? (
        <div
          ref={contextMenuRef}
          role="menu"
          aria-label="Layer actions"
          className="menu-pop absolute z-20 w-52 p-1.5"
          style={{ left: Math.min(contextMenu.x, (viewportRef.current?.clientWidth ?? 600) - 220), top: Math.min(contextMenu.y, (viewportRef.current?.clientHeight ?? 500) - 240) }}
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')];
            const current = items.indexOf(document.activeElement as HTMLElement);
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const offset = event.key === "ArrowDown" ? 1 : -1;
              items[(current + offset + items.length) % items.length]?.focus();
            } else if (event.key === "Home") {
              event.preventDefault();
              items[0]?.focus();
            } else if (event.key === "End") {
              event.preventDefault();
              items.at(-1)?.focus();
            }
          }}
        >
          {([
            { label: "Rename label", icon: PencilSimple, run: () => {
              const screen = graph.screens.find((item) => item.id === contextMenu.screenId);
              const node = screen ? findSemanticNode(screen.nodes, contextMenu.nodeId) : undefined;
              if (node && screen) startRename(node, screen.id);
            } },
            { label: selectedNodeIds.length > 1 ? "Duplicate selection" : "Duplicate", icon: Copy, shortcut: "⌘D", run: () => selectedNodeIds.length > 1 && selectedNodeIds.includes(contextMenu.nodeId) ? onDuplicateSelection() : onNodeCommand("duplicate", contextMenu.nodeId, contextMenu.screenId) },
            { label: "Move up", icon: ArrowUp, shortcut: "⌥↑", run: () => selectedNodeIds.length > 1 && selectedNodeIds.includes(contextMenu.nodeId) ? onMoveSelection(-1) : onNodeCommand("move-up", contextMenu.nodeId, contextMenu.screenId) },
            { label: "Move down", icon: ArrowDown, shortcut: "⌥↓", run: () => selectedNodeIds.length > 1 && selectedNodeIds.includes(contextMenu.nodeId) ? onMoveSelection(1) : onNodeCommand("move-down", contextMenu.nodeId, contextMenu.screenId) },
            { label: selectedNodeIds.length > 1 ? "Delete selection" : "Delete", icon: Trash, shortcut: "⌫", run: () => selectedNodeIds.length > 1 && selectedNodeIds.includes(contextMenu.nodeId) ? onDeleteSelection() : onNodeCommand("delete", contextMenu.nodeId, contextMenu.screenId), danger: true },
          ] as const).map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                onClick={() => { item.run(); setContextMenu(null); }}
                className={`flex min-h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[11px] ${"danger" in item && item.danger ? "text-[var(--danger)] hover:bg-[var(--danger-soft)]" : "text-[var(--t-strong)] hover:bg-[var(--hover)]"}`}
              >
                <Icon size={13} />
                <span className="flex-1">{item.label}</span>
                {"shortcut" in item && item.shortcut ? <kbd className="font-mono text-[9px] text-[var(--faint)]">{item.shortcut}</kbd> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
