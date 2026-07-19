"use client";

import {
  ArrowUp,
  CaretRight,
  Copy,
  Eye,
  Lock,
  PaintBrush,
  PencilSimple,
  Scissors,
  Trash,
  Warning,
} from "@phosphor-icons/react";
import { findSemanticNode, flattenSemanticNodes, type SemanticInterfaceGraph, type SemanticNode } from "@intentform/semantic-schema";
import { createHorizontalFrameIndex, queryHorizontalFrames } from "@intentform/graph-runtime";
import { motion, type MotionStyle } from "motion/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import { NodePreview, semanticNodeBoxStyle } from "./node-preview";
import { SelectionOverlay } from "./selection-overlay";
import type { EditorGuide } from "./guides";
import {
  fitWorldRect,
  translateViewBetweenViewports,
  usableEditorViewport,
  type EditorViewportInsets,
  type EditorViewportRect,
} from "./editor-viewport";
import {
  beginInlineTextEdit,
  inlineTextCommitValue,
  loadLatestInlineText,
  reconcileInlineTextEdit,
  updateInlineTextDraft,
  type InlineTextEditState,
} from "./inline-text-edit";
import {
  resolveSelectionAlignment,
  type Point,
  type ResizeCandidate,
  type SelectionAlignment,
  type SelectionIntent,
} from "./direct-manipulation";
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
  focusNode(nodeId: string, smooth?: boolean): boolean;
  zoomBy(factor: number): void;
  zoomTo(scale: number): void;
  alignSelection(action: SelectionAlignment): boolean;
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
  agentPreviewNodeIds: readonly string[];
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
  viewportInsets: EditorViewportInsets;
  guides: readonly EditorGuide[];
  guidesVisible: boolean;
  snapToGuides: boolean;
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
  onCopySelection(): void;
  onCutSelection(): void;
  onPaste(mode: "after" | "in-place" | "replace"): void;
  onCopyStyles(): void;
  onPasteStyles(): void;
  onMoveSelection(direction: -1 | 1): void;
  onNodeCommand(command: NodeCommand, nodeId: string, screenId: string): void;
  onRenameNode(nodeId: string, screenId: string, label: string): void;
  onPrototypeAction(action: SemanticNode["prototypeActions"][number], sourceScreenId: string): void;
  onReviewAnchor(screenId: string, nodeId: string): void;
  onSelectReviewThread(threadId: string): void;
  onOpenVerify(): void;
  onZoomChange(percent: number): void;
}

const MIN_SCALE = 0.12;
const MAX_SCALE = 2.5;
const EASE = "cubic-bezier(.22, 1, .36, 1)";

const clampScale = (value: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));

interface InlineTextSession {
  nodeId: string;
  screenId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  multiline: boolean;
  textStyle: CSSProperties;
  edit: InlineTextEditState;
}

function scaledPixels(value: string, scale: number, minimum?: number): number | undefined {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return undefined;
  const scaled = parsed * scale;
  return minimum === undefined ? scaled : Math.max(minimum, scaled);
}

function editingSurfaceColor(element: HTMLElement, boundary: HTMLElement): string | undefined {
  let current: HTMLElement | null = element;
  while (current && current !== boundary) {
    const color = window.getComputedStyle(current).backgroundColor;
    if (color !== "transparent" && color !== "rgba(0, 0, 0, 0)") return color;
    current = current.parentElement;
  }
  return undefined;
}

export function CanvasStage({
  graph,
  selectedScreen,
  selectedNodeId,
  selectedNodeIds,
  agentPreviewNodeIds,
  hoveredNodeId,
  tool,
  spaceHeld,
  previewMode,
  showDeviceChrome,
  bezelOverlay,
  profile,
  viewportInsets,
  guides,
  guidesVisible,
  snapToGuides,
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
  onCopySelection,
  onCutSelection,
  onPaste,
  onCopyStyles,
  onPasteStyles,
  onMoveSelection,
  onNodeCommand,
  onRenameNode,
  onPrototypeAction,
  onReviewAnchor,
  onSelectReviewThread,
  onOpenVerify,
  onZoomChange,
}: CanvasStageProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<ViewTransform>({ x: 0, y: 0, scale: 0.6 });
  const panSession = useRef<{ pointerId: number; x: number; y: number; view: ViewTransform } | null>(null);
  const safeViewportRef = useRef<EditorViewportRect | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const contextMenuReturnFocus = useRef<HTMLElement | null>(null);
  const renameReturnFocus = useRef<HTMLElement | null>(null);
  const renameWasOpen = useRef(false);
  const renameComposing = useRef(false);
  const renameBlurredDuringComposition = useRef(false);
  const visibilityFrame = useRef<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId: string; screenId: string } | null>(null);
  const [contextSubmenu, setContextSubmenu] = useState<"paste" | "arrange" | null>(null);
  const [rename, setRename] = useState<InlineTextSession | null>(null);

  const frameSpatialIndex = useMemo(
    () => createHorizontalFrameIndex(graph.screens.map((screen) => screen.id), profile.width, FRAME_GAP),
    [graph.screens, profile.width],
  );
  const frames = useMemo(
    () => frameSpatialIndex.frames.map((frame) => ({ frame, screen: graph.screens[frame.index]!, x: frame.x })),
    [frameSpatialIndex, graph.screens],
  );
  const [visibleFrameIds, setVisibleFrameIds] = useState<readonly string[]>([selectedScreen]);
  const worldWidth = frameSpatialIndex.worldWidth;
  const worldHeight = profile.height + FRAME_HEADER_WORLD;

  const safeViewport = useCallback(() => {
    const viewport = viewportRef.current;
    return viewport
      ? usableEditorViewport(viewport.clientWidth, viewport.clientHeight, viewportInsets)
      : null;
  }, [viewportInsets]);

  const refreshFrameVisibility = useCallback((view: ViewTransform) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const visible = queryHorizontalFrames(frameSpatialIndex, {
      left: -view.x / view.scale,
      right: (viewport.clientWidth - view.x) / view.scale,
    }, { includeIds: [selectedScreen] }).map((frame) => frame.id);
    setVisibleFrameIds((current) => current.length === visible.length && current.every((id, index) => id === visible[index])
      ? current
      : visible);
  }, [frameSpatialIndex, selectedScreen]);

  const scheduleFrameVisibility = useCallback((view: ViewTransform) => {
    if (visibilityFrame.current !== null) cancelAnimationFrame(visibilityFrame.current);
    visibilityFrame.current = requestAnimationFrame(() => {
      visibilityFrame.current = null;
      refreshFrameVisibility(view);
    });
  }, [refreshFrameVisibility]);

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
    scheduleFrameVisibility(next);
    onZoomChange(Math.round(next.scale * 100));
  }, [onZoomChange, scheduleFrameVisibility]);

  const fitAll = useCallback((smooth = true) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const safe = safeViewport();
    if (!safe) return;
    safeViewportRef.current = safe;
    applyView(fitWorldRect(
      { x: 0, y: 0, width: worldWidth, height: worldHeight },
      safe,
      { x: 36, y: 28 },
      1,
      MIN_SCALE,
    ), smooth);
  }, [applyView, safeViewport, worldHeight, worldWidth]);

  const fitScreen = useCallback((screenId: string, smooth = true) => {
    const viewport = viewportRef.current;
    const frame = frames.find((item) => item.screen.id === screenId);
    if (!viewport || !frame) return;
    const safe = safeViewport();
    if (!safe) return;
    safeViewportRef.current = safe;
    applyView(fitWorldRect(
      { x: frame.x, y: 0, width: profile.width, height: worldHeight },
      safe,
      { x: safe.width < 640 ? 20 : 56, y: 28 },
      1.1,
      MIN_SCALE,
    ), smooth);
  }, [applyView, frames, profile.width, safeViewport, worldHeight]);

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
    const safe = safeViewport();
    zoomAt(safe ? safe.x + safe.width / 2 : viewport.clientWidth / 2, safe ? safe.y + safe.height / 2 : viewport.clientHeight / 2, viewRef.current.scale * factor, true);
  }, [safeViewport, zoomAt]);

  const zoomTo = useCallback((scale: number) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const safe = safeViewport();
    zoomAt(safe ? safe.x + safe.width / 2 : viewport.clientWidth / 2, safe ? safe.y + safe.height / 2 : viewport.clientHeight / 2, scale, true);
  }, [safeViewport, zoomAt]);

  const focusNode = useCallback((nodeId: string, smooth = true) => {
    const viewport = viewportRef.current;
    const element = viewport?.querySelector<HTMLElement>(`[data-testid="canvas-node-${CSS.escape(nodeId)}"]`);
    if (!viewport || !element) return false;
    const viewportBounds = viewport.getBoundingClientRect();
    const nodeBounds = element.getBoundingClientRect();
    const view = viewRef.current;
    const safe = safeViewport();
    applyView({
      ...view,
      x: view.x + viewportBounds.left + (safe ? safe.x + safe.width / 2 : viewportBounds.width / 2) - (nodeBounds.left + nodeBounds.width / 2),
      y: view.y + viewportBounds.top + (safe ? safe.y + safe.height / 2 : viewportBounds.height / 2) - (nodeBounds.top + nodeBounds.height / 2),
    }, smooth);
    element.focus({ preventScroll: true });
    return true;
  }, [applyView, safeViewport]);

  const alignSelection = useCallback((action: SelectionAlignment) => {
    const viewport = viewportRef.current;
    const screen = graph.screens.find((item) => item.id === selectedScreen);
    if (!viewport || !screen || selectedNodeIds.length < 2) return false;
    const scale = viewRef.current.scale;
    const items = selectedNodeIds.flatMap((id) => {
      const node = findSemanticNode(screen.nodes, id);
      const position = node?.layout.position;
      const element = viewport.querySelector<HTMLElement>(`[data-testid="canvas-node-${CSS.escape(id)}"]`);
      const bounds = element?.getBoundingClientRect();
      return position && bounds ? [{
        id,
        x: position.x,
        y: position.y,
        width: bounds.width / scale,
        height: bounds.height / scale,
      }] : [];
    });
    if (items.length !== selectedNodeIds.length) return false;
    onMoveFreeform(resolveSelectionAlignment(items, action));
    return true;
  }, [graph.screens, onMoveFreeform, selectedNodeIds, selectedScreen]);

  useEffect(() => {
    apiRef.current = { fitAll, fitScreen, focusNode, zoomBy, zoomTo, alignSelection };
  }, [alignSelection, apiRef, fitAll, fitScreen, focusNode, zoomBy, zoomTo]);

  useEffect(() => () => {
    if (visibilityFrame.current !== null) cancelAnimationFrame(visibilityFrame.current);
  }, []);

  /* Wheel: two-finger scroll pans the board, ⌘/ctrl+wheel (and trackpad pinch)
     zooms into the pointer. Registered natively so preventDefault sticks. */
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
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
    const frame = requestAnimationFrame(() => fitScreenRef.current(selectedScreenRef.current, false));
    return () => cancelAnimationFrame(frame);
    // The initial framing runs once; later dependency changes refit below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Frames are laid out in array order, so adding, removing, or reordering
     them moves frame positions and needs a refit; ordinary edits inside a
     frame must never move the camera. */
  const frameLayoutKey = frames.map((entry) => entry.screen.id).join("|");
  useEffect(() => {
    fitScreenRef.current(selectedScreenRef.current, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id, frameLayoutKey]);

  const previousSelectedScreen = useRef(selectedScreen);
  useEffect(() => {
    if (previousSelectedScreen.current === selectedScreen) return;
    previousSelectedScreen.current = selectedScreen;
    fitScreenRef.current(selectedScreen, true);
  }, [selectedScreen]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(() => {
      const next = safeViewport();
      if (!next) return;
      const previous = safeViewportRef.current;
      safeViewportRef.current = next;
      if (previous) applyView(translateViewBetweenViewports(viewRef.current, previous, next), false);
      else fitScreenRef.current(selectedScreenRef.current, false);
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [applyView, safeViewport]);

  useLayoutEffect(() => {
    const next = safeViewport();
    if (!next) return;
    const previous = safeViewportRef.current;
    safeViewportRef.current = next;
    if (previous) applyView(translateViewBetweenViewports(viewRef.current, previous, next), false);
  }, [applyView, safeViewport, viewportInsets]);

  useEffect(() => {
    if (!contextMenu) return;
    setContextSubmenu(null);
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

  useEffect(() => {
    if (!previewMode) return;
    const source = graph.screens.find((screen) => screen.id === selectedScreen);
    const delayed = flattenSemanticNodes(source?.nodes ?? [])
      .flatMap((node) => node.prototypeActions)
      .filter((action) => action.trigger === "after-delay") ?? [];
    const timers = delayed.map((action) => window.setTimeout(() => onPrototypeAction(action, selectedScreen), action.delayMs ?? 0));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [graph.screens, onPrototypeAction, previewMode, selectedScreen]);

  const beginPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!panActive && event.button !== 1) return;
    event.preventDefault();
    panSession.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, view: viewRef.current };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const startRename = useCallback((node: SemanticNode, screenId: string) => {
    const viewport = viewportRef.current;
    const element = viewport?.querySelector<HTMLElement>(`[data-testid="canvas-node-${window.CSS ? CSS.escape(node.id) : node.id}"]`);
    if (!viewport || !element) return;
    const textElement = element.querySelector<HTMLElement>("[data-editable-text]") ?? element;
    const nodeRect = textElement.getBoundingClientRect();
    const viewportRect = viewport.getBoundingClientRect();
    const computed = window.getComputedStyle(textElement);
    const scale = viewRef.current.scale;
    renameReturnFocus.current = element;
    setRename({
      nodeId: node.id,
      screenId,
      x: nodeRect.left - viewportRect.left,
      y: nodeRect.top - viewportRect.top,
      width: Math.max(80, nodeRect.width),
      height: Math.max(36, nodeRect.height),
      multiline: node.kind === "text" || node.intent.label?.includes("\n") === true,
      textStyle: {
        backgroundColor: editingSurfaceColor(textElement, viewport),
        color: computed.color,
        fontFamily: computed.fontFamily,
        fontSize: scaledPixels(computed.fontSize, scale, 11),
        fontStyle: computed.fontStyle,
        fontWeight: computed.fontWeight,
        letterSpacing: computed.letterSpacing === "normal" ? undefined : scaledPixels(computed.letterSpacing, scale),
        lineHeight: computed.lineHeight === "normal" ? "normal" : scaledPixels(computed.lineHeight, scale, 13),
        textAlign: computed.textAlign as CSSProperties["textAlign"],
        textTransform: computed.textTransform as CSSProperties["textTransform"],
      },
      edit: beginInlineTextEdit(node.intent.label ?? ""),
    });
    renameComposing.current = false;
    renameBlurredDuringComposition.current = false;
  }, []);

  useEffect(() => {
    if (rename || previewMode || selectedNodeIds.length !== 1) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || target instanceof HTMLSelectElement
        || target instanceof HTMLButtonElement
        || target instanceof HTMLAnchorElement
        || (target instanceof HTMLElement && target.isContentEditable)) return;
      const node = findSemanticNode(graph.screens.find((item) => item.id === selectedScreen)?.nodes ?? [], selectedNodeIds[0]!);
      if (!node?.intent.label) return;
      event.preventDefault();
      startRename(node, selectedScreen);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [graph.screens, previewMode, rename, selectedNodeIds, selectedScreen, startRename]);

  useEffect(() => {
    setRename((current) => {
      if (!current) return current;
      const liveNode = findSemanticNode(
        graph.screens.find((screen) => screen.id === current.screenId)?.nodes ?? [],
        current.nodeId,
      );
      const latestValue = liveNode?.intent.label ?? null;
      const edit = reconcileInlineTextEdit(current.edit, latestValue, { preserveDraft: renameComposing.current });
      return edit === current.edit ? current : { ...current, edit };
    });
  }, [graph.screens]);

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

  const commitRename = (source?: string) => {
    if (!rename) return;
    const edit = source === undefined ? rename.edit : updateInlineTextDraft(rename.edit, source);
    if (edit.conflict) return;
    const value = inlineTextCommitValue(edit);
    setRename(null);
    if (value !== null) onRenameNode(rename.nodeId, rename.screenId, value);
  };

  const accent = tokenColor(graph, "color.accent", "#397461");
  /* Parent re-renders on every integer zoom change (zoom readout state), so
     reading the live scale here stays in sync without an extra prop. */
  const headerCompact = viewRef.current.scale < 0.55;

  const flowEdges = useMemo(() => {
    const index = new Map(frames.map((frame, position) => [frame.screen.id, position]));
    const steps = [
      ...graph.flows.flatMap((flow) => flow.steps.map((step) => ({ ...step, id: `${flow.id}.${step.from}.${step.event}`, label: step.event }))),
      ...graph.screens.flatMap((screen) => flattenSemanticNodes(screen.nodes).flatMap((node) => node.prototypeActions.flatMap((action) => action.targetScreenId ? [{ from: screen.id, to: action.targetScreenId, id: action.id, label: action.type }] : []))),
    ];
    return steps.flatMap((step) => {
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
      return [{
        id: step.id,
        fromId: step.from,
        toId: step.to,
        path,
        event: step.label,
        labelX,
        labelY,
      }];
    });
  }, [frames, graph.flows, graph.screens, profile.height, profile.width]);
  const visibleFrameSet = useMemo(() => new Set([...visibleFrameIds, selectedScreen]), [selectedScreen, visibleFrameIds]);
  const visibleFrames = frames.filter(({ screen }) => visibleFrameSet.has(screen.id));
  const visibleFlowEdges = flowEdges.filter((edge) => visibleFrameSet.has(edge.fromId) || visibleFrameSet.has(edge.toId));
  const contextNode = contextMenu
    ? findSemanticNode(graph.screens.find((item) => item.id === contextMenu.screenId)?.nodes ?? [], contextMenu.nodeId)
    : undefined;
  const contextTargetsSelection = Boolean(contextMenu && selectedNodeIds.length > 1 && selectedNodeIds.includes(contextMenu.nodeId));
  const finishContextAction = (action: () => void) => {
    action();
    setContextMenu(null);
  };

  return (
    <div
      ref={viewportRef}
      data-testid="canvas-viewport"
      data-rendered-screen-count={visibleFrames.length}
      data-total-screen-count={frames.length}
      data-safe-inset-top={viewportInsets.top}
      data-safe-inset-right={viewportInsets.right}
      data-safe-inset-bottom={viewportInsets.bottom}
      data-safe-inset-left={viewportInsets.left}
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
          {visibleFlowEdges.map((edge) => (
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

        {visibleFrames.map(({ screen, x }) => {
          const isSelectedScreen = screen.id === selectedScreen;
          const state = visualStateFor(screen.id);
          const status = frameStatus(screen.id);
          const visibleNodes = screen.nodes.filter((node) => isNodeVisible(node, state));
          const fixture = fixtureFor(graph, screen.id, state);
          return (
            <div key={screen.id} className="absolute transition-[left,width,height] duration-300 ease-[cubic-bezier(.22,1,.36,1)]" style={{ left: x, top: FRAME_HEADER_WORLD, width: profile.width, height: profile.height }}>
              {isSelectedScreen && guidesVisible ? <>
                <div data-testid="canvas-ruler-x" aria-hidden="true" className="pointer-events-none absolute -top-5 left-0 h-4 w-full border-b border-[var(--if-border-strong)] opacity-70" style={{ backgroundImage: "repeating-linear-gradient(90deg, transparent 0 7px, var(--if-border-strong) 7px 8px, transparent 8px 39px, var(--if-text-tertiary) 39px 40px)" }} />
                <div data-testid="canvas-ruler-y" aria-hidden="true" className="pointer-events-none absolute -left-5 top-0 h-full w-4 border-r border-[var(--if-border-strong)] opacity-70" style={{ backgroundImage: "repeating-linear-gradient(180deg, transparent 0 7px, var(--if-border-strong) 7px 8px, transparent 8px 39px, var(--if-text-tertiary) 39px 40px)" }} />
                {guides.filter((guide) => !guide.hidden).map((guide) => <span
                  key={guide.id}
                  data-testid={`canvas-guide-${guide.id}`}
                  data-axis={guide.axis}
                  data-locked={guide.locked || undefined}
                  aria-hidden="true"
                  className={`pointer-events-none absolute z-[4] bg-[var(--if-blue)] ${guide.locked ? "opacity-45" : "opacity-80"}`}
                  style={guide.axis === "vertical"
                    ? { left: guide.position, top: 0, width: 1, height: profile.height }
                    : { left: 0, top: guide.position, width: profile.width, height: 1 }}
                />)}
              </> : null}
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
                  className={`flex min-w-0 items-baseline gap-2 rounded-[5px] px-1.5 py-1 text-left text-[11.5px] font-medium tracking-[-.01em] ${isSelectedScreen ? "text-[var(--accent-dark)]" : "text-[var(--muted)] hover:text-[var(--ink)]"}`}
                >
                  <span className="min-w-0 truncate">{screen.title}</span>
                  {isSelectedScreen && !headerCompact ? <span className="shrink-0 font-mono text-[10px] font-normal text-[var(--faint)]">{screen.route}</span> : null}
                  {state !== "idle" && !headerCompact ? <span className="shrink-0 rounded-full bg-[var(--chip)] px-1.5 py-0.5 font-mono text-[10px] font-medium capitalize text-[var(--muted)]">{state}</span> : null}
                </button>
                {status.errors > 0 ? (
                  <button type="button" onClick={onOpenVerify} className="flex h-6 shrink-0 items-center gap-1 rounded-[5px] bg-[var(--danger-soft)] px-1.5 text-[10px] font-medium text-[var(--danger)] hover:brightness-95">
                    <Warning size={11} weight="fill" /> {status.errors} {status.errors === 1 ? "issue" : "issues"}
                  </button>
                ) : status.warnings > 0 ? (
                  <button type="button" onClick={onOpenVerify} className="flex h-6 shrink-0 items-center gap-1 rounded-[5px] bg-[var(--warn-soft)] px-1.5 text-[10px] font-medium text-[var(--warn)] hover:brightness-95">
                    <Warning size={11} weight="fill" /> {status.warnings}
                  </button>
                ) : null}
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
                    const agentPreviewed = agentPreviewNodeIds.includes(node.id) && isSelectedScreen;
                    const persistent = node.kind === "primary-action" && node.layout.placement?.[profile.breakpoint] === "persistent-bottom";
                    const previewNode = previewMode
                      ? flattenSemanticNodes([node]).find((candidate) => candidate.prototypeActions.length > 0 || candidate.interactions.length > 0)
                      : undefined;
                    const prototypeAction = previewNode?.prototypeActions[0];
                    const flowStep = previewMode && !prototypeAction && previewNode?.interactions[0]
                      ? graph.flows.flatMap((flow) => flow.steps).find((step) => step.from === screen.id && step.event === previewNode.interactions[0]?.event)
                      : undefined;
                    const previewAction = Boolean(prototypeAction || flowStep);
                    const nodeThreads = graph.reviewThreads.filter((thread) => thread.anchor.nodeId === node.id);
                    return (
                      <motion.div
                        layout
                        key={node.id}
                        data-testid={`canvas-node-${node.id}`}
                        data-selected={selected}
                        data-cross-hover={hoveredNodeId === node.id}
                        data-agent-preview={agentPreviewed || undefined}
                        role={selected && !previewMode ? undefined : "button"}
                        tabIndex={selected && !previewMode ? -1 : previewMode ? (previewAction ? 0 : -1) : 0}
                        aria-label={previewMode && (prototypeAction || flowStep)
                          ? prototypeAction ? `${prototypeAction.trigger} to ${prototypeAction.type}` : `Follow ${node.intent.label} to ${graph.screens.find((item) => item.id === flowStep?.to)?.title ?? flowStep?.to}`
                          : `Select ${nodeNames[node.kind]}`}
                        onClick={selected && !previewMode && tool !== "comment" ? undefined : (event) => {
                          event.stopPropagation();
                          if (panActive) return;
                          const layer = event.target instanceof Element
                            ? event.target.closest<HTMLElement>('[data-testid^="canvas-node-"]')
                            : null;
                          const nestedId = layer?.dataset.testid?.slice("canvas-node-".length);
                          const target = nestedId ? findSemanticNode(screen.nodes, nestedId) ?? node : node;
                          if (previewMode) {
                            const targetAction = target.prototypeActions[0];
                            const targetFlow = !targetAction && target.interactions[0]
                              ? graph.flows.flatMap((flow) => flow.steps).find((step) => step.from === screen.id && step.event === target.interactions[0]?.event)
                              : undefined;
                            if (targetAction && ["click", "tap", "press"].includes(targetAction.trigger)) onPrototypeAction(targetAction, screen.id);
                            else if (targetFlow) {
                              onSelectScreen(targetFlow.to);
                              fitScreen(targetFlow.to, true);
                            }
                            return;
                          }
                          if (tool === "comment") {
                            onReviewAnchor(screen.id, target.id);
                            return;
                          }
                          onSelectScreen(screen.id);
                          onSelectNode(node.id, event.shiftKey ? "range" : event.metaKey || event.ctrlKey ? "toggle" : "replace");
                        }}
                        onMouseEnter={() => { if (previewMode && prototypeAction?.trigger === "hover") onPrototypeAction(prototypeAction, screen.id); }}
                        onDoubleClick={(event) => {
                          event.stopPropagation();
                          if (previewMode) return;
                          const layer = event.target instanceof Element
                            ? event.target.closest<HTMLElement>('[data-testid^="canvas-node-"]')
                            : null;
                          const nestedId = layer?.dataset.testid?.slice("canvas-node-".length);
                          const target = nestedId ? findSemanticNode(screen.nodes, nestedId) ?? node : node;
                          if (target.intent.label !== undefined) startRename(target, screen.id);
                        }}
                        onContextMenu={(event) => {
                          if (previewMode) return;
                          event.preventDefault();
                          event.stopPropagation();
                          onSelectScreen(screen.id);
                          if (!selected) onSelectNode(node.id);
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
                            if (previewMode && prototypeAction?.trigger === "key") {
                              onPrototypeAction(prototypeAction, screen.id);
                              return;
                            }
                            if (previewMode && flowStep) {
                              onSelectScreen(flowStep.to);
                              fitScreen(flowStep.to, true);
                              return;
                            }
                            onSelectScreen(screen.id);
                            onSelectNode(node.id);
                          }
                        }}
                        className={`canvas-node relative outline-none ${persistent ? "mt-auto" : ""} ${previewAction || tool === "comment" ? "cursor-pointer" : "cursor-default"} ${agentPreviewed ? "rounded-[3px] shadow-[0_0_0_2px_var(--accent)]" : ""}`}
                        style={semanticNodeBoxStyle(node, graph, profile) as MotionStyle}
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
                          agentPreviewNodeIds={agentPreviewNodeIds}
                          {...(!previewMode && isSelectedScreen ? { onSelectNode: (nodeId: string, intent: SelectionIntent) => onSelectNode(nodeId, intent) } : {})}
                        />
                        {nodeThreads.map((thread, index) => <button key={thread.id} type="button" data-testid={`review-pin-${thread.id}`} aria-label={`Open review comment ${index + 1}`} onClick={(event) => { event.stopPropagation(); onSelectReviewThread(thread.id); }} className={`absolute -right-2.5 -top-2.5 z-[6] grid size-5 place-items-center rounded-full border-2 border-[var(--if-app)] text-[9px] font-semibold text-white shadow-md ${thread.resolvedAt ? "bg-[var(--if-green)]" : "bg-[var(--if-blue)]"}`}>{index + 1}</button>)}
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
          enabled={!previewMode && tool === "select" && !rename}
          breakpoint={profile.breakpoint}
          guides={guides}
          snapToGuides={snapToGuides}
          getScale={() => viewRef.current.scale}
          onReorder={onReorderSelection}
          onMoveFreeform={onMoveFreeform}
          onResize={onResizeNode}
          onAnchor={onAnchor}
          onEditNode={(nodeId) => {
            const node = findSemanticNode(graph.screens.find((item) => item.id === selectedScreen)?.nodes ?? [], nodeId);
            if (node?.intent.label !== undefined) startRename(node, selectedScreen);
          }}
          onOpenContextMenu={(clientPosition) => {
            const nodeId = selectedNodeId ?? selectedNodeIds.at(-1);
            const escaped = nodeId && typeof CSS !== "undefined" && CSS.escape ? CSS.escape(nodeId) : nodeId;
            const element = escaped ? worldRef.current?.querySelector<HTMLElement>(`[data-testid="canvas-node-${escaped}"]`) : null;
            if (element && nodeId) openContextMenu(element, nodeId, selectedScreen, clientPosition);
          }}
        />
      </div>

      {rename ? (
        <div className="absolute z-20" style={{ left: rename.x, top: rename.y, width: rename.width, minHeight: rename.height }}>
          <textarea
            autoFocus
            aria-label="Edit layer text"
            aria-describedby={rename.edit.conflict ? "inline-text-conflict" : undefined}
            aria-invalid={Boolean(rename.edit.conflict)}
            dir="auto"
            value={rename.edit.draftValue}
            onChange={(event) => setRename((current) => current ? { ...current, edit: updateInlineTextDraft(current.edit, event.target.value) } : current)}
            onFocus={(event) => event.currentTarget.setSelectionRange(event.currentTarget.value.length, event.currentTarget.value.length)}
            onCompositionStart={() => { renameComposing.current = true; }}
            onCompositionEnd={(event) => {
              renameComposing.current = false;
              const commitAfterComposition = renameBlurredDuringComposition.current;
              renameBlurredDuringComposition.current = false;
              if (commitAfterComposition) commitRename(event.currentTarget.value);
            }}
            onBlur={() => {
              if (renameComposing.current) renameBlurredDuringComposition.current = true;
              else if (!rename.edit.conflict) commitRename();
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setRename(null);
              } else if (event.key === "Enter" && !renameComposing.current && (!rename.multiline || event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                commitRename();
              }
            }}
            className="floating-chrome min-h-full w-full resize-none rounded-[4px] border border-[var(--select)] px-2 py-1.5 outline-none ring-2 ring-[var(--select)]/20"
            style={rename.textStyle}
          />
          {rename.edit.conflict ? (
            <div
              id="inline-text-conflict"
              role="alert"
              className="menu-pop mt-2 w-[min(320px,calc(100vw-32px))] p-3 text-[11px] leading-relaxed text-[var(--if-text)]"
              onPointerDown={(event) => event.preventDefault()}
            >
              {rename.edit.conflict === "removed" ? (
                <>
                  <p>The layer was removed while you were editing. Your draft was preserved but cannot be applied.</p>
                  <button type="button" onClick={() => setRename(null)} className="mt-2 h-7 rounded-[4px] bg-[var(--if-raised)] px-2.5 font-medium hover:bg-[var(--if-hover)]">Close editor</button>
                </>
              ) : (
                <>
                  <p>The graph changed this text while you were editing. Choose which value should remain.</p>
                  <p className="mt-1 truncate font-mono text-[10px] text-[var(--if-text-secondary)]" title={rename.edit.latestValue ?? undefined}>Latest: {rename.edit.latestValue}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => setRename((current) => current ? { ...current, edit: loadLatestInlineText(current.edit) } : current)}
                      className="h-7 rounded-[4px] bg-[var(--if-raised)] px-2.5 font-medium hover:bg-[var(--if-hover)]"
                    >
                      Load latest
                    </button>
                    <button
                      type="button"
                      disabled={!rename.edit.draftValue.trim()}
                      onClick={() => {
                        const value = rename.edit.draftValue.trim();
                        if (!value) return;
                        setRename(null);
                        onRenameNode(rename.nodeId, rename.screenId, value);
                      }}
                      className="h-7 rounded-[4px] bg-[var(--if-blue-action)] px-2.5 font-medium text-white hover:bg-[var(--if-blue-action-hover)] disabled:opacity-45"
                    >
                      Overwrite with mine
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {contextMenu ? (
        <div
          ref={contextMenuRef}
          role="menu"
          aria-label="Layer actions"
          className="menu-pop absolute z-20 w-[240px] overflow-visible p-1"
          style={{ left: Math.max(8, Math.min(contextMenu.x, (viewportRef.current?.clientWidth ?? 600) - 248)), top: Math.max(8, Math.min(contextMenu.y, (viewportRef.current?.clientHeight ?? 500) - 330)) }}
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            const active = document.activeElement as HTMLElement | null;
            const level = active?.dataset.menuLevel ?? "root";
            const items = [...event.currentTarget.querySelectorAll<HTMLElement>(`[role="menuitem"][data-menu-level="${level}"]`)];
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
            } else if (event.key === "ArrowRight" && active?.dataset.submenu) {
              event.preventDefault();
              const submenu = active.dataset.submenu as "paste" | "arrange";
              setContextSubmenu(submenu);
              requestAnimationFrame(() => contextMenuRef.current?.querySelector<HTMLElement>(`[role="menuitem"][data-menu-level="${submenu}"]`)?.focus());
            } else if (event.key === "ArrowLeft" && level !== "root") {
              event.preventDefault();
              setContextSubmenu(null);
              requestAnimationFrame(() => contextMenuRef.current?.querySelector<HTMLElement>(`[data-submenu="${level}"]`)?.focus());
            }
          }}
        >
          {([
            { label: "Edit text", icon: PencilSimple, run: () => { if (contextNode) startRename(contextNode, contextMenu.screenId); } },
            { label: "Cut", icon: Scissors, shortcut: "⌘X", run: onCutSelection },
            { label: "Copy", icon: Copy, shortcut: "⌘C", run: onCopySelection },
          ] as const).map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                data-menu-level="root"
                onClick={() => finishContextAction(item.run)}
                className="flex h-7 w-full items-center gap-2 rounded-[4px] px-2 text-left text-[11.5px] font-normal leading-4 text-[var(--t-strong)] hover:bg-[var(--hover)]"
              >
                <Icon size={12} className="text-[var(--muted)]" />
                <span className="flex-1">{item.label}</span>
                {"shortcut" in item && item.shortcut ? <kbd className="font-mono text-[9px] text-[var(--faint)]">{item.shortcut}</kbd> : null}
              </button>
            );
          })}
          <div className="relative">
            <button type="button" role="menuitem" data-menu-level="root" data-submenu="paste" aria-haspopup="menu" aria-expanded={contextSubmenu === "paste"} onPointerEnter={() => setContextSubmenu("paste")} onClick={() => setContextSubmenu((current) => current === "paste" ? null : "paste")} className="flex h-7 w-full items-center gap-2 rounded-[4px] px-2 text-left text-[11.5px] text-[var(--t-strong)] hover:bg-[var(--hover)]"><Copy size={12} className="text-[var(--muted)]" /><span className="flex-1">Paste</span><CaretRight size={11} className="text-[var(--faint)]" /></button>
            {contextSubmenu === "paste" ? <div role="menu" aria-label="Paste options" className={`menu-pop absolute top-[-4px] z-[1] w-[196px] p-1 ${contextMenu.x > (viewportRef.current?.clientWidth ?? 600) / 2 ? "right-full mr-1" : "left-full ml-1"}`}>
              {([
                ["Paste", "⌘V", "after"],
                ["Paste in place", "⇧⌘V", "in-place"],
                ["Paste to replace", "⇧⌘R", "replace"],
              ] as const).map(([label, shortcut, mode]) => <button key={mode} type="button" role="menuitem" data-menu-level="paste" onClick={() => finishContextAction(() => onPaste(mode))} className="flex h-7 w-full items-center rounded-[4px] px-2 text-left text-[11.5px] text-[var(--t-strong)] hover:bg-[var(--hover)]"><span className="flex-1">{label}</span><kbd className="font-mono text-[9px] text-[var(--faint)]">{shortcut}</kbd></button>)}
            </div> : null}
          </div>
          <button type="button" role="menuitem" data-menu-level="root" onClick={() => finishContextAction(() => contextTargetsSelection ? onDuplicateSelection() : onNodeCommand("duplicate", contextMenu.nodeId, contextMenu.screenId))} className="flex h-7 w-full items-center gap-2 rounded-[4px] px-2 text-left text-[11.5px] text-[var(--t-strong)] hover:bg-[var(--hover)]"><Copy size={12} className="text-[var(--muted)]" /><span className="flex-1">{contextTargetsSelection ? "Duplicate selection" : "Duplicate"}</span><kbd className="font-mono text-[9px] text-[var(--faint)]">⌘D</kbd></button>
          <div role="separator" className="my-1 h-px bg-[var(--line)]" />
          <button type="button" role="menuitem" data-menu-level="root" onClick={() => finishContextAction(onCopyStyles)} className="flex h-7 w-full items-center gap-2 rounded-[4px] px-2 text-left text-[11.5px] text-[var(--t-strong)] hover:bg-[var(--hover)]"><PaintBrush size={12} className="text-[var(--muted)]" /><span className="flex-1">Copy styles</span><kbd className="font-mono text-[9px] text-[var(--faint)]">⌥⌘C</kbd></button>
          <button type="button" role="menuitem" data-menu-level="root" onClick={() => finishContextAction(onPasteStyles)} className="flex h-7 w-full items-center gap-2 rounded-[4px] px-2 text-left text-[11.5px] text-[var(--t-strong)] hover:bg-[var(--hover)]"><PaintBrush size={12} className="text-[var(--muted)]" /><span className="flex-1">Paste styles</span><kbd className="font-mono text-[9px] text-[var(--faint)]">⌥⌘V</kbd></button>
          <div className="relative">
            <button type="button" role="menuitem" data-menu-level="root" data-submenu="arrange" aria-haspopup="menu" aria-expanded={contextSubmenu === "arrange"} onPointerEnter={() => setContextSubmenu("arrange")} onClick={() => setContextSubmenu((current) => current === "arrange" ? null : "arrange")} className="flex h-7 w-full items-center gap-2 rounded-[4px] px-2 text-left text-[11.5px] text-[var(--t-strong)] hover:bg-[var(--hover)]"><ArrowUp size={12} className="text-[var(--muted)]" /><span className="flex-1">Arrange</span><CaretRight size={11} className="text-[var(--faint)]" /></button>
            {contextSubmenu === "arrange" ? <div role="menu" aria-label="Arrange options" className={`menu-pop absolute top-[-4px] z-[1] w-[196px] p-1 ${contextMenu.x > (viewportRef.current?.clientWidth ?? 600) / 2 ? "right-full mr-1" : "left-full ml-1"}`}>
              {([
                ["Move up", "⌥↑", -1],
                ["Move down", "⌥↓", 1],
              ] as const).map(([label, shortcut, direction]) => <button key={direction} type="button" role="menuitem" data-menu-level="arrange" onClick={() => finishContextAction(() => contextTargetsSelection ? onMoveSelection(direction) : onNodeCommand(direction < 0 ? "move-up" : "move-down", contextMenu.nodeId, contextMenu.screenId))} className="flex h-7 w-full items-center rounded-[4px] px-2 text-left text-[11.5px] text-[var(--t-strong)] hover:bg-[var(--hover)]"><span className="flex-1">{label}</span><kbd className="font-mono text-[9px] text-[var(--faint)]">{shortcut}</kbd></button>)}
            </div> : null}
          </div>
          <div role="separator" className="my-1 h-px bg-[var(--line)]" />
          <button type="button" role="menuitem" data-menu-level="root" onClick={() => finishContextAction(() => onNodeCommand("toggle-hidden", contextMenu.nodeId, contextMenu.screenId))} className="flex h-7 w-full items-center gap-2 rounded-[4px] px-2 text-left text-[11.5px] text-[var(--t-strong)] hover:bg-[var(--hover)]"><Eye size={12} className="text-[var(--muted)]" /><span className="flex-1">{contextNode?.editor?.hidden ? "Show" : "Hide"}</span><kbd className="font-mono text-[9px] text-[var(--faint)]">⇧⌘H</kbd></button>
          <button type="button" role="menuitem" data-menu-level="root" onClick={() => finishContextAction(() => onNodeCommand("toggle-lock", contextMenu.nodeId, contextMenu.screenId))} className="flex h-7 w-full items-center gap-2 rounded-[4px] px-2 text-left text-[11.5px] text-[var(--t-strong)] hover:bg-[var(--hover)]"><Lock size={12} className="text-[var(--muted)]" /><span className="flex-1">{contextNode?.editor?.locked ? "Unlock" : "Lock"}</span><kbd className="font-mono text-[9px] text-[var(--faint)]">⇧⌘L</kbd></button>
          <div role="separator" className="my-1 h-px bg-[var(--line)]" />
          <button type="button" role="menuitem" data-menu-level="root" onClick={() => finishContextAction(() => contextTargetsSelection ? onDeleteSelection() : onNodeCommand("delete", contextMenu.nodeId, contextMenu.screenId))} className="flex h-7 w-full items-center gap-2 rounded-[4px] px-2 text-left text-[11.5px] text-[var(--danger)] hover:bg-[var(--danger-soft)]"><Trash size={12} /><span className="flex-1">{contextTargetsSelection ? "Delete selection" : "Delete"}</span><kbd className="font-mono text-[9px] text-[var(--faint)]">⌫</kbd></button>
        </div>
      ) : null}
    </div>
  );
}
