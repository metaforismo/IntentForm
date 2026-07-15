import { describe, expect, it } from "vitest";
import { emptyTokenModeValues, type ContainerNodeKind, type SemanticInterfaceGraph, type SemanticNode } from "@intentform/semantic-schema";
import {
  buildNodeIndex,
  compareLayoutEvidence,
  computeNeutralLayout,
  deterministicMeasurement,
  layoutCoverage,
  resolvedContainerMode,
} from "./index";

const graph = {
  tokens: {
    defaultMode: "default",
    activeMode: "default",
    modes: {
      default: {
        name: "Default",
        values: { ...emptyTokenModeValues(), spacing: { "space.8": 8, "space.16": 16 } },
      },
    },
    aliases: {},
    deprecated: {},
    extensions: {},
  },
} as Pick<SemanticInterfaceGraph, "tokens">;

function layout(overrides: Partial<SemanticNode["layout"]> = {}): SemanticNode["layout"] {
  return {
    axis: "vertical",
    width: "fill",
    height: "hug",
    align: "stretch",
    justify: "start",
    overflow: "visible",
    columns: 2,
    splitRatio: 0.5,
    gapToken: "space.8",
    paddingToken: "space.16",
    ...overrides,
  };
}

function node(
  id: string,
  kind: SemanticNode["kind"] = "status-message",
  children: SemanticNode[] = [],
  layoutOverrides: Partial<SemanticNode["layout"]> = {},
): SemanticNode {
  return {
    id,
    kind,
    intent: { purpose: `Describe ${id}`, label: id, importance: "supporting" },
    layout: layout(layoutOverrides),
    style: { role: "surface", emphasis: "normal" },
    accessibility: { label: id, live: "off" },
    states: [],
    interactions: [],
    provenance: { author: "system", revision: 0 },
    children,
  };
}

describe("deterministic recursive layout", () => {
  it("indexes nested nodes with stable parent, depth, and index paths", () => {
    const roots = [node("root", "stack", [
      node("first"),
      node("group", "stack", [node("nested")]),
    ])];
    const index = buildNodeIndex(roots);

    expect([...index.keys()]).toEqual(["root", "first", "group", "nested"]);
    expect(index.get("root")).toMatchObject({ parentId: null, depth: 1, indexPath: [0] });
    expect(index.get("nested")).toMatchObject({ parentId: "group", depth: 3, indexPath: [0, 1, 0] });
  });

  it("lays out vertical stacks and grids without coordinate ambiguity", () => {
    const roots = [node("stack", "stack", [
      node("lead"),
      node("grid", "grid", [node("a"), node("b"), node("c")], { columns: 2 }),
    ])];
    const first = computeNeutralLayout({ nodes: roots }, graph, { width: 400, height: 800 });
    const second = computeNeutralLayout({ nodes: roots }, graph, { width: 400, height: 800 });

    expect(first.roots).toEqual(second.roots);
    expect(first.byId.get("lead")?.frame).toMatchObject({ x: 16, y: 16, width: 368 });
    expect(first.byId.get("grid")!.frame.y).toBeGreaterThan(first.byId.get("lead")!.frame.y);
    expect(first.byId.get("a")?.frame.x).toBe(32);
    expect(first.byId.get("b")!.frame.x).toBeGreaterThan(first.byId.get("a")!.frame.x);
    expect(first.byId.get("c")!.frame.y).toBeGreaterThan(first.byId.get("a")!.frame.y);
  });

  it("resolves adaptive modes by the shared compact contract", () => {
    const adaptive = node("adaptive", "adaptive", [node("a"), node("b")], {
      adaptive: { compact: "stack", regular: "grid" },
    });
    expect(resolvedContainerMode(adaptive, { width: 375, height: 667 })).toBe("stack");
    expect(resolvedContainerMode(adaptive, { width: 768, height: 1024 })).toBe("grid");

    const compact = computeNeutralLayout({ nodes: [adaptive] }, graph, { width: 375, height: 667 });
    const regular = computeNeutralLayout({ nodes: [adaptive] }, graph, { width: 768, height: 1024 });
    expect(compact.byId.get("b")!.frame.y).toBeGreaterThan(compact.byId.get("a")!.frame.y);
    expect(regular.byId.get("b")!.frame.x).toBeGreaterThan(regular.byId.get("a")!.frame.x);
  });

  it("supports overlay, split, wrap, freeform, scroll, safe-area, and page-flow relations", () => {
    const modes: ContainerNodeKind[] = [
      "overlay", "split", "wrap", "freeform", "scroll", "safe-area", "page-flow",
    ];
    const roots = modes.map((mode) => node(mode, mode, [
      node(`${mode}.a`, "status-message", [], mode === "freeform" ? { position: { x: 12, y: 18, z: 2 } } : {}),
      node(`${mode}.b`, "status-message", [], mode === "freeform" ? { position: { x: 3, y: 5, z: 1 } } : {}),
    ], mode === "split" ? { axis: "horizontal", splitRatio: 0.4 } : {}));
    const result = computeNeutralLayout({ nodes: roots }, graph, { width: 480, height: 900 });

    expect(result.byId.get("overlay.a")?.frame.x).toBe(result.byId.get("overlay.b")?.frame.x);
    expect(result.byId.get("split.b")!.frame.x).toBeGreaterThan(result.byId.get("split.a")!.frame.x);
    expect(result.byId.get("wrap.b")!.frame.x).toBeGreaterThan(result.byId.get("wrap.a")!.frame.x);
    expect(result.byId.get("freeform.a")!.frame.x).toBeGreaterThan(result.byId.get("freeform.b")!.frame.x);
    expect(result.byId.get("scroll")?.scrollable).toBe(true);
    expect(result.byId.get("safe-area.a")!.frame.y - result.byId.get("safe-area")!.frame.y).toBe(32);
    expect(result.byId.get("page-flow.b")!.frame.y).toBeGreaterThan(result.byId.get("page-flow.a")!.frame.y);
    expect(layoutCoverage(roots)).toMatchObject({ nodeCount: 21, maxDepth: 2 });
  });

  it("projects registry safe-area geometry without presentation-chrome offsets", () => {
    const root = node("safe", "safe-area", [node("content")]);
    const viewport = {
      width: 402,
      height: 874,
      safeArea: { top: 59, right: 13, bottom: 34, left: 11 },
    };
    const result = computeNeutralLayout({ nodes: [root] }, graph, viewport);
    expect(result.byId.get("content")?.frame).toMatchObject({
      x: 27,
      y: 75,
      width: 346,
    });
    expect(result.viewport).toEqual(viewport);
  });

  it("applies fixed and min/max sizing constraints deterministically", () => {
    const constrained = node("constrained", "status-message", [], {
      width: "fixed",
      fixedWidth: 600,
      maxWidth: 320,
      height: "fixed",
      fixedHeight: 20,
      minHeight: 44,
      overflow: "clip",
    });
    const result = computeNeutralLayout({ nodes: [constrained] }, graph, { width: 500, height: 800 });
    expect(result.byId.get("constrained")).toMatchObject({
      frame: { width: 320, height: 44 },
      clipped: true,
    });
  });

  it("applies cross-axis alignment and main-axis justification to linear containers", () => {
    const centered = node("centered", "stack", [node("child", "status-message", [], { width: "hug" })], {
      height: "fixed",
      fixedHeight: 300,
      align: "center",
      justify: "end",
    });
    const result = computeNeutralLayout({ nodes: [centered] }, graph, { width: 400, height: 800 });
    const parentFrame = result.byId.get("centered")!.frame;
    const childFrame = result.byId.get("child")!.frame;

    expect(childFrame.x).toBe(parentFrame.x + (parentFrame.width - childFrame.width) / 2);
    expect(childFrame.y + childFrame.height).toBe(parentFrame.y + parentFrame.height - 16);
  });

  it("distributes positive and negative free space with explicit flex factors", () => {
    const growing = node("growing", "stack", [
      node("grow-a", "text", [], { width: "hug", flexBasis: 100, flexGrow: 1 }),
      node("grow-b", "text", [], { width: "hug", flexBasis: 100, flexGrow: 3 }),
    ], { axis: "horizontal", width: "fixed", fixedWidth: 400 });
    const shrinking = node("shrinking", "stack", [
      node("shrink-a", "text", [], { width: "hug", flexBasis: 120, flexShrink: 1 }),
      node("shrink-b", "text", [], { width: "hug", flexBasis: 120, flexShrink: 3 }),
    ], { axis: "horizontal", width: "fixed", fixedWidth: 200 });
    const result = computeNeutralLayout({ nodes: [growing, shrinking] }, graph, { width: 500, height: 800 });

    expect(result.byId.get("grow-a")?.frame.width).toBe(140);
    expect(result.byId.get("grow-b")?.frame.width).toBe(220);
    expect(result.byId.get("shrink-a")?.frame.width).toBe(100);
    expect(result.byId.get("shrink-b")?.frame.width).toBe(60);
  });

  it("honors explicit grid rows, spans, and baseline alignment", () => {
    const grid = node("grid", "grid", [
      node("grid-a", "text", [], { gridColumn: { start: 1, span: 2 }, gridRow: { start: 1, span: 1 } }),
      node("grid-b", "text", [], { gridColumn: { start: 2, span: 1 }, gridRow: { start: 2, span: 1 } }),
    ], { columns: 2, gridTracks: [1, 2], gridRows: [1, 2], height: "fixed", fixedHeight: 332 });
    const baseline = node("baseline", "stack", [node("short", "text"), node("tall", "text")], {
      axis: "horizontal", align: "baseline", width: "fixed", fixedWidth: 300,
    });
    const result = computeNeutralLayout({ nodes: [grid, baseline] }, graph, { width: 400, height: 800 }, {
      measurement: {
        measure(item, maximumWidth) {
          if (item.id === "short") return { width: Math.min(60, maximumWidth), height: 30, baseline: 10 };
          if (item.id === "tall") return { width: Math.min(80, maximumWidth), height: 50, baseline: 30 };
          return deterministicMeasurement.measure(item, maximumWidth);
        },
      },
    });

    expect(result.byId.get("grid-a")!.frame.width).toBeGreaterThan(result.byId.get("grid-b")!.frame.width);
    expect(result.byId.get("grid-b")!.frame.y).toBeGreaterThan(result.byId.get("grid-a")!.frame.y);
    const short = result.byId.get("short")!;
    const tall = result.byId.get("tall")!;
    expect(short.frame.y + short.baseline).toBe(tall.frame.y + tall.baseline);
  });

  it("accepts real measurement providers and reports browser-bound divergences", () => {
    const root = node("measured", "text", [], { width: "hug" });
    const result = computeNeutralLayout({ nodes: [root] }, graph, { width: 300, height: 500 }, {
      measurement: { measure: () => ({ width: 123, height: 45, baseline: 31 }) },
    });
    expect(result.byId.get("measured")).toMatchObject({ frame: { width: 123, height: 45 }, baseline: 31 });

    const exact = [{ id: "measured", frame: { ...result.byId.get("measured")!.frame, width: 124 } }];
    expect(compareLayoutEvidence(result, exact, 2)).toEqual([]);
    expect(compareLayoutEvidence(result, [{ id: "measured", frame: { x: 0, y: 0, width: 140, height: 45 } }, { id: "extra", frame: { x: 0, y: 0, width: 1, height: 1 } }], 2)).toEqual([
      expect.objectContaining({ id: "extra", code: "layout.browser.unexpected" }),
      expect.objectContaining({ id: "measured", code: "layout.browser.diverged", maximumDelta: 17 }),
    ]);
    expect(compareLayoutEvidence(result, [], 2)).toEqual([
      expect.objectContaining({ id: "measured", code: "layout.browser.missing" }),
    ]);
  });

  it("keeps every frame finite and deterministic across a seeded layout matrix", () => {
    const modes: ContainerNodeKind[] = [
      "stack", "grid", "overlay", "scroll", "safe-area", "adaptive", "wrap", "split", "freeform", "page-flow",
    ];
    let state = 0x51f15e;
    const random = () => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      return state / 0x1_0000_0000;
    };

    for (let sample = 0; sample < 120; sample += 1) {
      const mode = modes[sample % modes.length]!;
      const children = Array.from({ length: 1 + Math.floor(random() * 6) }, (_, index) => node(
        `sample-${sample}-${index}`,
        "status-message",
        [],
        {
          width: random() > 0.5 ? "fill" : "hug",
          minWidth: Math.floor(random() * 40),
          maxWidth: 180 + Math.floor(random() * 260),
          ...(mode === "freeform" ? { position: { x: Math.floor(random() * 90), y: Math.floor(random() * 120), z: index } } : {}),
        },
      ));
      const root = node(`sample-${sample}`, mode, children, {
        axis: random() > 0.5 ? "horizontal" : "vertical",
        columns: 1 + Math.floor(random() * 4),
        splitRatio: 0.1 + random() * 0.8,
        align: (["start", "center", "end", "stretch"] as const)[Math.floor(random() * 4)]!,
        justify: (["start", "center", "end", "space-between"] as const)[Math.floor(random() * 4)]!,
        ...(mode === "adaptive" ? { adaptive: { compact: "stack", regular: "grid" } } : {}),
        ...(mode === "freeform" ? { height: "fixed", fixedHeight: 260 } : {}),
      });
      const viewport = {
        width: 320 + Math.floor(random() * 700),
        height: 568 + Math.floor(random() * 600),
      };
      const first = computeNeutralLayout({ nodes: [root] }, graph, viewport);
      const second = computeNeutralLayout({ nodes: [root] }, graph, viewport);

      expect(first.roots).toEqual(second.roots);
      expect(first.byId.size).toBe(children.length + 1);
      for (const laidOut of first.byId.values()) {
        expect(Object.values(laidOut.frame).every(Number.isFinite)).toBe(true);
        expect(laidOut.frame.width).toBeGreaterThanOrEqual(0);
        expect(laidOut.frame.height).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
