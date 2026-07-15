"use client";

import {
  findGraphNodeLocation,
  type SemanticInterfaceGraph,
  type SemanticNode,
} from "@intentform/semantic-schema";
import {
  normalizeNodeSelection,
  resolveFreeformMove,
  resolveReorderCandidate,
  resolveResizeCandidate,
  selectionAxis,
  selectionParentId,
  type Point,
  type ResizeCandidate,
  type ResizeHandle,
} from "./direct-manipulation";
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface MeasuredBox extends Box {
  graph: SemanticInterfaceGraph;
  selectionKey: string;
}

interface SelectionOverlayProps {
  graph: SemanticInterfaceGraph;
  screenId: string;
  selectedNodeIds: readonly string[];
  worldRef: RefObject<HTMLDivElement | null>;
  enabled: boolean;
  breakpoint: "compact" | "regular";
  getScale(): number;
  onReorder(screenId: string, parentId: string | null, orderedIds: string[]): void;
  onMoveFreeform(positions: Readonly<Record<string, Point>>): void;
  onResize(nodeId: string, size: ResizeCandidate): void;
  onAnchor(nodeId: string, placement: "inline" | "persistent-bottom"): void;
  onOpenContextMenu(clientPosition?: Point): void;
}

type DragSession = {
  pointerId: number;
  startClient: Point;
  kind: "freeform" | "reorder" | "placement";
  selectedIds: string[];
  elements: HTMLElement[];
  parentId: string | null;
  axis: "horizontal" | "vertical";
  items: Array<{ id: string; start: number; end: number }>;
  initialPositions: Record<string, Point>;
  guides: { x: number[]; y: number[] };
  initialPlacement: "inline" | "persistent-bottom" | undefined;
  candidate?: ReturnType<typeof resolveReorderCandidate>;
  freeformCandidate?: ReturnType<typeof resolveFreeformMove>;
  placementCandidate: "inline" | "persistent-bottom" | undefined;
};

type ResizeSession = {
  pointerId: number;
  nodeId: string;
  startClient: Point;
  start: { width: number; height: number };
  handle: ResizeHandle;
  candidate: ResizeCandidate;
};

function freeformParent(parent: SemanticNode | null): boolean {
  return parent?.kind === "freeform"
    || (parent?.kind === "adaptive" && (
      parent.layout.adaptive?.compact === "freeform"
      || parent.layout.adaptive?.regular === "freeform"
    ));
}

function clearTranslations(elements: readonly HTMLElement[]) {
  for (const element of elements) element.style.translate = "";
}

export function SelectionOverlay({
  graph,
  screenId,
  selectedNodeIds,
  worldRef,
  enabled,
  breakpoint,
  getScale,
  onReorder,
  onMoveFreeform,
  onResize,
  onAnchor,
  onOpenContextMenu,
}: SelectionOverlayProps) {
  const [box, setBox] = useState<MeasuredBox | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const guideRef = useRef<HTMLDivElement>(null);
  const crossGuideRef = useRef<HTMLDivElement>(null);
  const hudRef = useRef<HTMLDivElement>(null);
  const dragSession = useRef<DragSession | null>(null);
  const resizeSession = useRef<ResizeSession | null>(null);
  const normalizedIds = useMemo(
    () => normalizeNodeSelection(graph, screenId, selectedNodeIds),
    [graph, screenId, selectedNodeIds],
  );
  const selectionKey = normalizedIds.join("\u0000");

  const selectedElements = useCallback((): HTMLElement[] => {
    const world = worldRef.current;
    if (!world) return [];
    return normalizedIds.flatMap((id) => {
      const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id;
      const element = world.querySelector<HTMLElement>(`[data-testid="canvas-node-${escaped}"]`);
      return element ? [element] : [];
    });
  }, [normalizedIds, worldRef]);

  const measure = useCallback(() => {
    const world = worldRef.current;
    const elements = selectedElements();
    if (!world || elements.length === 0) {
      setBox(null);
      return;
    }
    const worldRect = world.getBoundingClientRect();
    const scale = getScale();
    const rects = elements.map((element) => element.getBoundingClientRect());
    const left = Math.min(...rects.map((rect) => rect.left));
    const top = Math.min(...rects.map((rect) => rect.top));
    const right = Math.max(...rects.map((rect) => rect.right));
    const bottom = Math.max(...rects.map((rect) => rect.bottom));
    const next = {
      left: (left - worldRect.left) / scale,
      top: (top - worldRect.top) / scale,
      width: (right - left) / scale,
      height: (bottom - top) / scale,
      graph,
      selectionKey,
    };
    setBox((current) => current
      && current.graph === graph
      && current.selectionKey === selectionKey
      && Math.abs(current.left - next.left) < 0.1
      && Math.abs(current.top - next.top) < 0.1
      && Math.abs(current.width - next.width) < 0.1
      && Math.abs(current.height - next.height) < 0.1
      ? current
      : next);
  }, [getScale, graph, selectedElements, selectionKey, worldRef]);

  useLayoutEffect(() => {
    measure();
    const frame = requestAnimationFrame(measure);
    const observer = new ResizeObserver(measure);
    const mutationObserver = new MutationObserver(() => {
      if (!dragSession.current && !resizeSession.current) measure();
    });
    for (const element of selectedElements()) {
      observer.observe(element);
      mutationObserver.observe(element, { attributes: true, attributeFilter: ["style", "class"] });
    }
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      mutationObserver.disconnect();
    };
  }, [graph, measure, selectedElements]);

  const updateHud = (message: string) => {
    if (hudRef.current) {
      hudRef.current.hidden = false;
      hudRef.current.textContent = message;
    }
  };

  const hideHud = () => { if (hudRef.current) hudRef.current.hidden = true; };

  const hideGuides = () => {
    if (guideRef.current) guideRef.current.hidden = true;
    if (crossGuideRef.current) crossGuideRef.current.hidden = true;
  };

  const showReorderGuide = (session: DragSession, guide: number) => {
    const world = worldRef.current;
    const element = guideRef.current;
    if (!world || !element) return;
    const siblingElements = session.items.flatMap((item) => {
      const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(item.id) : item.id;
      const sibling = world.querySelector<HTMLElement>(`[data-testid="canvas-node-${escaped}"]`);
      return sibling ? [sibling] : [];
    });
    if (siblingElements.length === 0) return;
    const worldRect = world.getBoundingClientRect();
    const scale = getScale();
    const rects = siblingElements.map((sibling) => sibling.getBoundingClientRect());
    const crossStart = session.axis === "vertical"
      ? Math.min(...rects.map((rect) => rect.left))
      : Math.min(...rects.map((rect) => rect.top));
    const crossEnd = session.axis === "vertical"
      ? Math.max(...rects.map((rect) => rect.right))
      : Math.max(...rects.map((rect) => rect.bottom));
    element.hidden = false;
    if (session.axis === "vertical") {
      Object.assign(element.style, {
        left: `${(crossStart - worldRect.left) / scale}px`,
        top: `${guide}px`,
        width: `${(crossEnd - crossStart) / scale}px`,
        height: "0px",
        borderTopWidth: `${2 / scale}px`,
        borderLeftWidth: "0px",
      });
    } else {
      Object.assign(element.style, {
        left: `${guide}px`,
        top: `${(crossStart - worldRect.top) / scale}px`,
        width: "0px",
        height: `${(crossEnd - crossStart) / scale}px`,
        borderLeftWidth: `${2 / scale}px`,
        borderTopWidth: "0px",
      });
    }
  };

  const startDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!enabled || event.button !== 0 || normalizedIds.length === 0) return;
    const elements = selectedElements();
    const locations = normalizedIds.map((id) => findGraphNodeLocation(graph, id));
    if (elements.length !== normalizedIds.length || locations.some((location) => !location)) return;
    const parentId = selectionParentId(graph, normalizedIds);
    if (parentId === undefined) {
      updateHud("Group layers before moving across parents");
      return;
    }
    const parent = locations[0]?.parent ?? null;
    const rootPrimary = normalizedIds.length === 1
      && locations[0]?.node.kind === "primary-action"
      && parent === null;
    const isFreeform = locations.every((location) => freeformParent(location?.parent ?? null));
    const axis = selectionAxis(parent);
    const world = worldRef.current;
    if (!world) return;
    const worldRect = world.getBoundingClientRect();
    const scale = getScale();
    const siblings = locations[0]!.siblings;
    const items = siblings.flatMap((sibling) => {
      const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(sibling.id) : sibling.id;
      const siblingElement = world.querySelector<HTMLElement>(`[data-testid="canvas-node-${escaped}"]`);
      if (!siblingElement) return [];
      const rect = siblingElement.getBoundingClientRect();
      return [{
        id: sibling.id,
        start: axis === "vertical" ? (rect.top - worldRect.top) / scale : (rect.left - worldRect.left) / scale,
        end: axis === "vertical" ? (rect.bottom - worldRect.top) / scale : (rect.right - worldRect.left) / scale,
      }];
    });
    const initialPositions = Object.fromEntries(locations.flatMap((location) => location?.node.layout.position
      ? [[location.node.id, { x: location.node.layout.position.x, y: location.node.layout.position.y }]]
      : []));
    const unselectedPositions = siblings
      .filter((sibling) => !normalizedIds.includes(sibling.id))
      .flatMap((sibling) => sibling.layout.position ? [sibling.layout.position] : []);
    dragSession.current = {
      pointerId: event.pointerId,
      startClient: { x: event.clientX, y: event.clientY },
      kind: rootPrimary ? "placement" : isFreeform ? "freeform" : "reorder",
      selectedIds: normalizedIds,
      elements,
      parentId,
      axis,
      items,
      initialPositions,
      guides: {
        x: unselectedPositions.map((position) => position.x),
        y: unselectedPositions.map((position) => position.y),
      },
      initialPlacement: rootPrimary ? locations[0]!.node.layout.placement?.[breakpoint] : undefined,
      placementCandidate: undefined,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    updateHud(rootPrimary
      ? `Drag to change ${breakpoint} placement`
      : isFreeform
        ? "x 0 · y 0"
        : `Move in ${parent?.intent.label ?? "screen"}`);
  };

  const moveDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const session = dragSession.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const scale = getScale();
    const delta = {
      x: (event.clientX - session.startClient.x) / scale,
      y: (event.clientY - session.startClient.y) / scale,
    };
    for (const element of session.elements) element.style.translate = `${delta.x}px ${delta.y}px`;

    if (session.kind === "placement") {
      const next = delta.y > 48 ? "persistent-bottom" : delta.y < -48 ? "inline" : session.initialPlacement;
      session.placementCandidate = next;
      updateHud(next === "persistent-bottom"
        ? `Bottom safe area · ${breakpoint}`
        : next === "inline"
          ? `Semantic stack · ${breakpoint}`
          : `Drag ${session.initialPlacement === "persistent-bottom" ? "up" : "down"} to change placement`);
      return;
    }

    if (session.kind === "freeform") {
      const candidate = resolveFreeformMove(session.initialPositions, delta, session.guides);
      session.freeformCandidate = candidate;
      const first = candidate.positions[session.selectedIds[0]!]!;
      const initial = session.initialPositions[session.selectedIds[0]!]!;
      const snappedDelta = { x: first.x - initial.x, y: first.y - initial.y };
      for (const element of session.elements) element.style.translate = `${snappedDelta.x}px ${snappedDelta.y}px`;
      updateHud(`x ${Math.round(first.x)} · y ${Math.round(first.y)}`);
      if (crossGuideRef.current) {
        crossGuideRef.current.hidden = !(candidate.snappedX || candidate.snappedY);
        crossGuideRef.current.dataset.axis = candidate.snappedX && candidate.snappedY
          ? "both"
          : candidate.snappedX ? "vertical" : "horizontal";
      }
      return;
    }

    const world = worldRef.current;
    if (!world) return;
    const worldRect = world.getBoundingClientRect();
    const pointer = session.axis === "vertical"
      ? (event.clientY - worldRect.top) / scale
      : (event.clientX - worldRect.left) / scale;
    const candidate = resolveReorderCandidate(session.items, session.selectedIds, pointer);
    session.candidate = candidate;
    showReorderGuide(session, candidate.guide);
    updateHud(`Order ${candidate.insertionIndex + 1} of ${session.items.length}`);
  };

  const finishDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const session = dragSession.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const cancelled = event.type === "pointercancel";
    clearTranslations(session.elements);
    hideGuides();
    hideHud();
    dragSession.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!cancelled && session.kind === "placement" && session.placementCandidate
      && session.placementCandidate !== session.initialPlacement) {
      onAnchor(session.selectedIds[0]!, session.placementCandidate);
    } else if (!cancelled && session.kind === "freeform" && session.freeformCandidate) {
      onMoveFreeform(session.freeformCandidate.positions);
    } else if (!cancelled && session.kind === "reorder" && session.candidate
      && session.candidate.orderedIds.some((id, index) => id !== session.items[index]?.id)) {
      onReorder(screenId, session.parentId, session.candidate.orderedIds);
    }
    requestAnimationFrame(measure);
  };

  const startResize = (handle: ResizeHandle) => (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!box || normalizedIds.length !== 1 || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    resizeSession.current = {
      pointerId: event.pointerId,
      nodeId: normalizedIds[0]!,
      startClient: { x: event.clientX, y: event.clientY },
      start: { width: box.width, height: box.height },
      handle,
      candidate: { width: box.width, height: box.height },
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    updateHud(`${Math.round(box.width)} × ${Math.round(box.height)}`);
  };

  const moveResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    const session = resizeSession.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const scale = getScale();
    const candidate = resolveResizeCandidate(session.start, {
      x: (event.clientX - session.startClient.x) / scale,
      y: (event.clientY - session.startClient.y) / scale,
    }, session.handle, { preserveAspect: event.shiftKey });
    session.candidate = candidate;
    if (overlayRef.current) {
      overlayRef.current.style.transformOrigin = session.handle.includes("west")
        ? session.handle.includes("north") ? "right bottom" : session.handle.includes("south") ? "right top" : "right center"
        : session.handle.includes("east")
          ? session.handle.includes("north") ? "left bottom" : session.handle.includes("south") ? "left top" : "left center"
          : session.handle === "north" ? "center bottom" : "center top";
      overlayRef.current.style.transform = `scale(${candidate.width / session.start.width}, ${candidate.height / session.start.height})`;
    }
    updateHud(`${Math.round(candidate.width)} × ${Math.round(candidate.height)}${event.shiftKey ? " · ratio" : ""}`);
  };

  const finishResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    const session = resizeSession.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const cancelled = event.type === "pointercancel";
    resizeSession.current = null;
    hideHud();
    if (overlayRef.current) overlayRef.current.style.transform = "";
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!cancelled && (session.candidate.width !== session.start.width || session.candidate.height !== session.start.height)) {
      onResize(session.nodeId, session.candidate);
    }
    requestAnimationFrame(measure);
  };

  if (!enabled || !box || box.graph !== graph || box.selectionKey !== selectionKey || normalizedIds.length === 0) return null;
  const inverseScale = 1 / getScale();
  const selectionLabel = normalizedIds.length === 1
    ? findGraphNodeLocation(graph, normalizedIds[0]!)?.node.intent.label ?? normalizedIds[0]
    : `${normalizedIds.length} layers`;
  return (
    <>
      <div
        ref={guideRef}
        hidden
        aria-hidden="true"
        className="pointer-events-none absolute border-[var(--select)]"
      />
      <div
        ref={crossGuideRef}
        hidden
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 border border-dashed border-[var(--select)]/50"
      />
      <div
        ref={overlayRef}
        data-testid="selection-overlay"
        data-selection-count={normalizedIds.length}
        data-selection-ids={normalizedIds.join(" ")}
        className="pointer-events-none absolute z-[5] border border-[var(--select)]"
        style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
      >
        <button
          type="button"
          aria-label={`Move ${normalizedIds.length === 1 ? "selected layer" : `${normalizedIds.length} selected layers`}`}
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onOpenContextMenu({ x: event.clientX, y: event.clientY });
          }}
          onKeyDown={(event) => {
            if (event.shiftKey && event.key === "F10") {
              event.preventDefault();
              onOpenContextMenu();
            }
          }}
          className="pointer-events-auto absolute inset-0 cursor-move bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-[var(--select)] focus-visible:ring-offset-2"
        />
        {normalizedIds.length === 1 ? ([
          ["northwest", "left-[-10px] top-[-10px] cursor-nwse-resize", `scale(${inverseScale})`],
          ["north", "left-1/2 top-[-10px] cursor-ns-resize", `translateX(-50%) scale(${inverseScale})`],
          ["northeast", "right-[-10px] top-[-10px] cursor-nesw-resize", `scale(${inverseScale})`],
          ["east", "right-[-10px] top-1/2 cursor-ew-resize", `translateY(-50%) scale(${inverseScale})`],
          ["southeast", "bottom-[-10px] right-[-10px] cursor-nwse-resize", `scale(${inverseScale})`],
          ["south", "bottom-[-10px] left-1/2 cursor-ns-resize", `translateX(-50%) scale(${inverseScale})`],
          ["southwest", "bottom-[-10px] left-[-10px] cursor-nesw-resize", `scale(${inverseScale})`],
          ["west", "left-[-10px] top-1/2 cursor-ew-resize", `translateY(-50%) scale(${inverseScale})`],
        ] as const).map(([handle, position, transform]) => (
          <button
            key={handle}
            type="button"
            aria-label={`Resize selected layer ${handle}`}
            onPointerDown={startResize(handle)}
            onPointerMove={moveResize}
            onPointerUp={finishResize}
            onPointerCancel={finishResize}
            className={`pointer-events-auto absolute grid size-6 place-items-center bg-transparent ${position}`}
            style={{ transform }}
          ><span aria-hidden="true" className="block size-[7px] rounded-[1px] border border-[var(--select-deep)] bg-white shadow-sm" /></button>
        )) : null}
        <span className="pointer-events-none absolute bottom-[calc(100%+5px)] left-0 whitespace-nowrap rounded-[3px] bg-[var(--select-deep)] px-1.5 py-0.5 text-[10px] font-medium text-white" style={{ transform: `scale(${inverseScale})`, transformOrigin: "left bottom" }}>{selectionLabel}</span>
        <span ref={hudRef} data-testid="selection-dimension-hud" hidden className="pointer-events-none absolute left-1/2 top-[calc(100%+8px)] -translate-x-1/2 whitespace-nowrap rounded-[4px] bg-[var(--if-raised)] px-2 py-1 font-mono text-[10px] text-[var(--if-text)] shadow-[var(--if-shadow-menu)]" style={{ scale: `${inverseScale}`, transformOrigin: "center top" }} />
      </div>
    </>
  );
}
