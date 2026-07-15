import { describe, expect, it } from "vitest";
import { demoGraph } from "@intentform/proof-report/demo";
import {
  SpatialIndex,
  normalizeNodeSelection,
  reconcileGraphSelection,
  resolveFreeformMove,
  resolveReorderCandidate,
  resolveResizeCandidate,
  selectionParentId,
  updateNodeSelection,
} from "./direct-manipulation";

describe("direct manipulation candidate engine", () => {
  const order = ["a", "b", "c", "d"];

  it("supports replace, toggle, and anchored range selection in semantic order", () => {
    expect(updateNodeSelection(["b"], "d", order, "replace")).toEqual(["d"]);
    expect(updateNodeSelection(["b"], "d", order, "toggle")).toEqual(["b", "d"]);
    expect(updateNodeSelection(["b", "d"], "b", order, "toggle")).toEqual(["d"]);
    expect(updateNodeSelection(["b"], "d", order, "range")).toEqual(["b", "c", "d"]);
    expect(updateNodeSelection(["d"], "b", order, "range")).toEqual(["b", "c", "d"]);
  });

  it("normalizes missing and descendant selections to one operation per subtree", () => {
    expect(normalizeNodeSelection(demoGraph, "layout-lab", [
      "layout-lab.adaptive",
      "layout-lab.grid",
      "layout-lab.grid-a",
      "missing",
    ])).toEqual(["layout-lab.adaptive"]);
    expect(selectionParentId(demoGraph, ["layout-lab.grid-a", "layout-lab.grid-b"]))
      .toBe("layout-lab.grid");
    expect(selectionParentId(demoGraph, ["layout-lab.grid-a", "layout-lab.overlay-a"]))
      .toBeUndefined();
  });

  it("retains recursive selections across graph reconciliation", () => {
    expect(reconcileGraphSelection(demoGraph, "layout-lab", "layout-lab.grid-a")).toEqual({
      screenId: "layout-lab",
      nodeId: "layout-lab.grid-a",
    });
    expect(reconcileGraphSelection(demoGraph, "layout-lab", "missing")).toEqual({
      screenId: "layout-lab",
      nodeId: "layout-lab.adaptive",
    });
    expect(reconcileGraphSelection({ screens: [] }, "missing", "missing")).toEqual({
      screenId: "",
      nodeId: null,
    });
  });

  it("returns a final sibling order and insertion guide without mutating inputs", () => {
    const items = [
      { id: "a", start: 0, end: 40 },
      { id: "b", start: 50, end: 90 },
      { id: "c", start: 100, end: 140 },
      { id: "d", start: 150, end: 190 },
    ];
    const snapshot = structuredClone(items);
    expect(resolveReorderCandidate(items, ["b"], 180)).toEqual({
      orderedIds: ["a", "c", "d", "b"],
      insertionIndex: 3,
      guide: 190,
    });
    expect(resolveReorderCandidate(items, ["b", "c"], 10)).toEqual({
      orderedIds: ["b", "c", "a", "d"],
      insertionIndex: 0,
      guide: 0,
    });
    expect(items).toEqual(snapshot);
  });

  it("snaps freeform movement once at the selection anchor and preserves offsets", () => {
    expect(resolveFreeformMove({ a: { x: 12, y: 18 }, b: { x: 84, y: 44 } }, { x: 9, y: 13 }, {
      x: [24],
      y: [32],
    })).toEqual({
      positions: { a: { x: 24, y: 32 }, b: { x: 96, y: 58 } },
      snappedX: true,
      snappedY: true,
    });
  });

  it("preserves signed freeform coordinates beyond the semantic origin", () => {
    expect(resolveFreeformMove({ a: { x: 4, y: 6 } }, { x: -40, y: -40 }).positions.a)
      .toEqual({ x: -32, y: -32 });
  });

  it("snaps and bounds each resize handle deterministically", () => {
    expect(resolveResizeCandidate({ width: 101, height: 59 }, { x: 18, y: 0 }, "east"))
      .toEqual({ width: 120, height: 59 });
    expect(resolveResizeCandidate({ width: 101, height: 59 }, { x: 0, y: 19 }, "south"))
      .toEqual({ width: 101, height: 80 });
    expect(resolveResizeCandidate({ width: 101, height: 59 }, { x: 17, y: 0 }, "west"))
      .toEqual({ width: 88, height: 59, offsetX: 13 });
    expect(resolveResizeCandidate({ width: 101, height: 59 }, { x: 0, y: 19 }, "north"))
      .toEqual({ width: 101, height: 40, offsetY: 19 });
    expect(resolveResizeCandidate({ width: 120, height: 60 }, { x: 40, y: 20 }, "northwest"))
      .toEqual({ width: 80, height: 40, offsetX: 40, offsetY: 20 });
    expect(resolveResizeCandidate({ width: 120, height: 60 }, { x: 41, y: 3 }, "southeast", { preserveAspect: true }))
      .toEqual({ width: 160, height: 80 });
    expect(resolveResizeCandidate({ width: 30, height: 30 }, { x: -100, y: 4_000 }, "southeast"))
      .toEqual({ width: 24, height: 2_048 });
  });

  it("orders spatial hits by deepest, smallest, then stable id", () => {
    const index = new SpatialIndex([
      { id: "root", parentId: null, depth: 1, x: 0, y: 0, width: 200, height: 200 },
      { id: "b", parentId: "root", depth: 2, x: 20, y: 20, width: 80, height: 80 },
      { id: "a", parentId: "root", depth: 2, x: 20, y: 20, width: 40, height: 40 },
    ]);
    expect(index.at({ x: 30, y: 30 }).map((entry) => entry.id)).toEqual(["a", "b", "root"]);
    expect(index.at({ x: 300, y: 300 })).toEqual([]);
  });

  it("indexes negative positions and entries spanning spatial buckets", () => {
    const index = new SpatialIndex([
      { id: "negative", parentId: null, depth: 1, x: -300, y: -20, width: 80, height: 40 },
      { id: "boundary", parentId: null, depth: 1, x: 250, y: 250, width: 20, height: 20 },
    ]);
    expect(index.at({ x: -256, y: 0 }).map((entry) => entry.id)).toEqual(["negative"]);
    expect(index.at({ x: 260, y: 260 }).map((entry) => entry.id)).toEqual(["boundary"]);
  });

  it("is stable across a seeded matrix of reorder pointers and resize deltas", () => {
    let seed = 0x18f0;
    const random = () => {
      seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
      return seed / 0x1_0000_0000;
    };
    const items = order.map((id, index) => ({ id, start: index * 48, end: index * 48 + 40 }));
    for (let index = 0; index < 160; index += 1) {
      const pointer = random() * 240 - 24;
      const candidate = resolveReorderCandidate(items, [order[index % order.length]!], pointer);
      expect(candidate.orderedIds).toHaveLength(order.length);
      expect(new Set(candidate.orderedIds)).toEqual(new Set(order));
      expect(resolveReorderCandidate(items, [order[index % order.length]!], pointer)).toEqual(candidate);

      const delta = { x: random() * 4_000 - 2_000, y: random() * 4_000 - 2_000 };
      const size = resolveResizeCandidate({ width: 320, height: 180 }, delta, "southeast");
      expect(size.width).toBeGreaterThanOrEqual(24);
      expect(size.height).toBeGreaterThanOrEqual(24);
      expect(size.width).toBeLessThanOrEqual(2_048);
      expect(size.height).toBeLessThanOrEqual(2_048);
    }
  });
});
