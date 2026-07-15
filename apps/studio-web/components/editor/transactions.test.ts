import { describe, expect, it } from "vitest";
import { demoGraph } from "@intentform/proof-report/demo";
import { flattenGraphNodes, stableSerialize } from "@intentform/semantic-schema";
import {
  applyEditorTransaction,
  duplicateNodeTransaction,
  duplicateNodesTransaction,
  duplicateScreenTransaction,
  editorTransactionError,
  insertChildTransaction,
  insertionStateBindings,
  locateEditorNode,
  moveSelectionTransaction,
  moveNodeTransaction,
  removeNodeTransaction,
  removeNodesTransaction,
  reorderChildrenTransaction,
  setFreeformPositionsTransaction,
  updateNodeLayoutTransaction,
  wrapNodesTransaction,
} from "./transactions";

describe("editor transactions", () => {
  it("duplicates a contracted screen with remapped node and fixture references", () => {
    const result = duplicateScreenTransaction(demoGraph, "payment-request");
    const screen = result.graph.screens.find((item) => item.id === result.screenId);
    const contract = result.graph.contracts.find((item) => item.screenId === result.screenId);
    const fixtures = result.graph.fixtures.filter((item) => item.screenId === result.screenId);

    expect(result.screenId).toBe("payment-request-copy");
    expect(screen?.nodes.every((node) => node.id.startsWith("payment-request-copy."))).toBe(true);
    expect(contract?.fixtures).toEqual(fixtures.map((fixture) => fixture.id));
    expect(contract?.fixtures.every((id) => id.startsWith("payment-request-copy."))).toBe(true);
    expect(contract?.fixtures).not.toContain("payment-request.idle");
  });

  it("allocates independent references for repeated screen copies", () => {
    const first = duplicateScreenTransaction(demoGraph, "payment-request");
    const second = duplicateScreenTransaction(first.graph, "payment-request");
    const contract = second.graph.contracts.find((item) => item.screenId === second.screenId);

    expect(second.screenId).toBe("payment-request-copy-2");
    expect(contract?.fixtures).toEqual([
      "payment-request-copy-2.idle",
      "payment-request-copy-2.failed",
    ]);
    expect(new Set(flattenGraphNodes(second.graph).map((node) => node.id)).size)
      .toBe(flattenGraphNodes(second.graph).length);
  });

  it("remaps every descendant when duplicating a recursive screen", () => {
    const result = duplicateScreenTransaction(demoGraph, "layout-lab");
    const copied = result.graph.screens.find((screen) => screen.id === result.screenId)!;
    const copiedNodes = flattenGraphNodes({ screens: [copied] });

    expect(copiedNodes).toHaveLength(20);
    expect(copiedNodes.every((node) => node.id.startsWith("layout-lab-copy."))).toBe(true);
    expect(new Set(copiedNodes.map((node) => node.id)).size).toBe(copiedNodes.length);
  });

  it("duplicates a recursive node beside its source with fresh descendant ids", () => {
    const result = duplicateNodeTransaction(demoGraph, "layout-lab.grid");
    const copy = locateEditorNode(result.graph, result.nodeId)!;

    expect(result.nodeId).toBe("layout-lab.grid-copy");
    expect(copy.parent?.id).toBe("layout-lab.safe-area");
    expect(copy.node.children.map((node) => node.id)).toEqual([
      "layout-lab.grid-a-copy",
      "layout-lab.grid-b-copy",
    ]);
    expect(copy.node.intent.label).toBe("layout-lab.grid copy");
  });

  it("duplicates a normalized multi-selection atomically in semantic order", () => {
    const result = duplicateNodesTransaction(demoGraph, [
      "layout-lab.grid-a",
      "layout-lab.grid-b",
      "layout-lab.grid-a",
    ]);
    expect(result.nodeIds).toEqual(["layout-lab.grid-a-copy", "layout-lab.grid-b-copy"]);
    expect(locateEditorNode(result.graph, "layout-lab.grid")?.node.children.map((node) => node.id)).toEqual([
      "layout-lab.grid-a",
      "layout-lab.grid-a-copy",
      "layout-lab.grid-b",
      "layout-lab.grid-b-copy",
    ]);

    const before = stableSerialize(demoGraph);
    expect(() => duplicateNodesTransaction(demoGraph, ["payment-request.amount", "payment-request.confirm"]))
      .toThrow(/more than one primary action/);
    expect(stableSerialize(demoGraph)).toBe(before);
  });

  it("locates, reorders, moves, inserts, wraps, and removes recursive nodes atomically", () => {
    expect(locateEditorNode(demoGraph, "layout-lab.grid-a")).toMatchObject({
      parent: { id: "layout-lab.grid" },
      index: 0,
    });

    const reordered = reorderChildrenTransaction(
      demoGraph,
      "layout-lab",
      "layout-lab.grid",
      ["layout-lab.grid-b", "layout-lab.grid-a"],
    );
    expect(locateEditorNode(reordered, "layout-lab.grid")?.node.children.map((node) => node.id))
      .toEqual(["layout-lab.grid-b", "layout-lab.grid-a"]);

    const moved = moveNodeTransaction(reordered, "layout-lab.grid-a", "layout-lab.overlay", 1);
    expect(locateEditorNode(moved, "layout-lab.grid-a")?.parent?.id).toBe("layout-lab.overlay");
    expect(locateEditorNode(moved, "layout-lab.grid-a")?.node.provenance.revision).toBe(1);

    const insertedNode = structuredClone(locateEditorNode(moved, "layout-lab.grid-b")!.node);
    insertedNode.id = "layout-lab.grid-c";
    const inserted = insertChildTransaction(moved, "layout-lab", "layout-lab.grid", insertedNode, 0);
    expect(locateEditorNode(inserted, insertedNode.id)?.parent?.id).toBe("layout-lab.grid");

    const wrapper = structuredClone(locateEditorNode(inserted, "layout-lab.stack")!.node);
    wrapper.id = "layout-lab.overlay-stack";
    wrapper.children = [];
    const wrapped = wrapNodesTransaction(
      inserted,
      "layout-lab",
      ["layout-lab.overlay-a", "layout-lab.grid-a"],
      wrapper,
    );
    expect(locateEditorNode(wrapped, wrapper.id)?.node.children.map((node) => node.id))
      .toEqual(["layout-lab.overlay-a", "layout-lab.grid-a"]);

    const removed = removeNodeTransaction(wrapped, "layout-lab.grid-c");
    expect(locateEditorNode(removed, "layout-lab.grid-c")).toBeNull();
  });

  it("rejects hierarchy cycles, incomplete reorders, and implicit freeform placement", () => {
    expect(() => moveNodeTransaction(
      demoGraph,
      "layout-lab.adaptive",
      "layout-lab.grid",
    )).toThrow(/descendants/);
    expect(() => moveNodeTransaction(
      demoGraph,
      "layout-lab.grid-a",
      "layout-lab.freeform",
    )).toThrow(/explicit semantic position/);
    const lockedTarget = structuredClone(demoGraph);
    locateEditorNode(lockedTarget, "layout-lab.overlay")!.node.editor = { locked: true, hidden: false };
    expect(() => moveNodeTransaction(
      lockedTarget,
      "layout-lab.grid-a",
      "layout-lab.overlay",
    )).toThrow(/locked nodes/i);
    expect(() => reorderChildrenTransaction(
      demoGraph,
      "layout-lab",
      "layout-lab.grid",
      ["layout-lab.grid-a"],
    )).toThrow(/every existing sibling exactly once/);
  });

  it("moves multi-selection blocks and rejects cross-parent keyboard reorders", () => {
    const movedDown = moveSelectionTransaction(
      demoGraph,
      ["layout-lab.grid-a"],
      1,
    );
    expect(locateEditorNode(movedDown, "layout-lab.grid")?.node.children.map((node) => node.id))
      .toEqual(["layout-lab.grid-b", "layout-lab.grid-a"]);
    const movedBack = moveSelectionTransaction(movedDown, ["layout-lab.grid-a"], -1);
    expect(locateEditorNode(movedBack, "layout-lab.grid")?.node.children.map((node) => node.id))
      .toEqual(["layout-lab.grid-a", "layout-lab.grid-b"]);
    expect(() => moveSelectionTransaction(
      demoGraph,
      ["layout-lab.grid-a", "layout-lab.overlay-a"],
      1,
    )).toThrow(/shared parent/);
  });

  it("removes selected subtrees once and preserves atomic screen bounds", () => {
    const removed = removeNodesTransaction(demoGraph, [
      "layout-lab.grid",
      "layout-lab.grid-a",
      "layout-lab.overlay",
    ]);
    expect(locateEditorNode(removed, "layout-lab.grid")).toBeNull();
    expect(locateEditorNode(removed, "layout-lab.grid-a")).toBeNull();
    expect(locateEditorNode(removed, "layout-lab.overlay")).toBeNull();

    const oneRoot = structuredClone(demoGraph);
    oneRoot.screens.find((screen) => screen.id === "layout-lab")!.nodes = [
      oneRoot.screens.find((screen) => screen.id === "layout-lab")!.nodes[0]!,
    ];
    expect(() => removeNodesTransaction(oneRoot, ["layout-lab.adaptive"]))
      .toThrow(/Too small|>=1/);
  });

  it("commits fixed dimensions and freeform positions through validated layout transactions", () => {
    const resized = updateNodeLayoutTransaction(demoGraph, "layout-lab.grid-a", (layout) => {
      layout.width = "fixed";
      layout.fixedWidth = 184;
      layout.height = "fixed";
      layout.fixedHeight = 72;
    });
    expect(locateEditorNode(resized, "layout-lab.grid-a")?.node.layout).toMatchObject({
      width: "fixed",
      fixedWidth: 184,
      height: "fixed",
      fixedHeight: 72,
    });

    const positioned = setFreeformPositionsTransaction(demoGraph, {
      "layout-lab.freeform-a": { x: 32, y: 48 },
      "layout-lab.freeform-b": { x: 104, y: 72 },
    });
    expect(locateEditorNode(positioned, "layout-lab.freeform-a")?.node.layout.position)
      .toEqual({ x: 32, y: 48, z: 2 });
    expect(() => setFreeformPositionsTransaction(demoGraph, {
      "layout-lab.grid-a": { x: 8, y: 8 },
    })).toThrow(/not in a freeform relation/);
  });

  it("rejects an invalid draft without mutating the canonical input", () => {
    const before = stableSerialize(demoGraph);

    expect(() => applyEditorTransaction(demoGraph, (draft) => {
      const screen = draft.screens.find((item) => item.id === "payment-request")!;
      const primary = structuredClone(screen.nodes.find((node) => node.kind === "primary-action")!);
      primary.id = "payment-request.second-primary";
      screen.nodes.push(primary);
    })).toThrow(/more than one primary action/);

    expect(stableSerialize(demoGraph)).toBe(before);
  });

  it("rejects manipulation of locked or hidden nodes atomically", () => {
    const protectedGraph = structuredClone(demoGraph);
    locateEditorNode(protectedGraph, "layout-lab.grid-a")!.node.editor = { locked: true, hidden: false };
    const before = stableSerialize(protectedGraph);
    expect(() => updateNodeLayoutTransaction(protectedGraph, "layout-lab.grid-a", (layout) => {
      layout.fixedWidth = 200;
    })).toThrow(/locked nodes/i);
    expect(() => moveNodeTransaction(protectedGraph, "layout-lab.grid-a", "layout-lab.overlay")).toThrow(/locked nodes/i);
    expect(() => removeNodeTransaction(protectedGraph, "layout-lab.grid-a")).toThrow(/locked nodes/i);
    expect(stableSerialize(protectedGraph)).toBe(before);

    const hiddenGraph = structuredClone(demoGraph);
    locateEditorNode(hiddenGraph, "layout-lab.grid-b")!.node.editor = { locked: false, hidden: true };
    expect(() => setFreeformPositionsTransaction(hiddenGraph, { "layout-lab.grid-b": { x: 1, y: 1 } }))
      .toThrow(/hidden nodes/i);
  });

  it("scopes new layers to the active non-idle state", () => {
    expect(insertionStateBindings("idle")).toEqual([]);
    expect(insertionStateBindings("failed")).toEqual([{ name: "failed" }]);
    expect(insertionStateBindings("completed")).toEqual([{ name: "completed" }]);
  });

  it("turns validation failures into concise atomicity diagnostics", () => {
    const message = editorTransactionError(new Error("Screen payment-request has more than one primary action"));
    expect(message).toBe("Edit rejected: Screen payment-request has more than one primary action. No changes were saved.");
  });
});
