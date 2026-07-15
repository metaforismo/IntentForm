import { describe, expect, it } from "vitest";
import { demoGraph } from "@intentform/proof-report/demo";
import { findGraphNodeLocation } from "@intentform/semantic-schema";
import {
  CLIPBOARD_PAYLOAD_LIMIT,
  createNodeClipboardPayload,
  createStyleClipboardPayload,
  parseNodeClipboardPayload,
  pasteNodesTransaction,
  pasteStyleTransaction,
  plainTextFromHtml,
  serializeClipboardPayload,
} from "./clipboard";

describe("editor clipboard transactions", () => {
  it("serializes only semantic operation roots and validates round trips", () => {
    const payload = createNodeClipboardPayload(demoGraph, "layout-lab", ["layout-lab.grid", "layout-lab.grid-a"]);
    expect(payload.nodes.map((node) => node.id)).toEqual(["layout-lab.grid"]);
    expect(parseNodeClipboardPayload(serializeClipboardPayload(payload))).toEqual(payload);
  });

  it("rejects malformed, empty, and oversized clipboard payloads", () => {
    expect(() => parseNodeClipboardPayload("{")) .toThrow(/valid JSON/);
    expect(() => parseNodeClipboardPayload(JSON.stringify({ format: "intentform/nodes", version: 1, nodes: [] })))
      .toThrow(/outside the supported range/);
    expect(() => parseNodeClipboardPayload("x".repeat(CLIPBOARD_PAYLOAD_LIMIT + 1))).toThrow(/exceeds/);
  });

  it("pastes recursively with stable unique ids and remapped component references", () => {
    const payload = createNodeClipboardPayload(demoGraph, "layout-lab", ["layout-lab.grid"]);
    const first = pasteNodesTransaction(demoGraph, "layout-lab", ["layout-lab.overlay"], payload, "after");
    expect(first.nodeIds).toEqual(["layout-lab.grid-copy"]);
    expect(findGraphNodeLocation(first.graph, "layout-lab.grid-a-copy")?.parent?.id).toBe("layout-lab.grid-copy");
    const second = pasteNodesTransaction(first.graph, "layout-lab", ["layout-lab.overlay"], payload, "after");
    expect(second.nodeIds).toEqual(["layout-lab.grid-copy-2"]);
  });

  it("supports paste into containers, paste in place, and atomic replacement", () => {
    const payload = createNodeClipboardPayload(demoGraph, "layout-lab", ["layout-lab.grid-a"]);
    const inside = pasteNodesTransaction(demoGraph, "layout-lab", ["layout-lab.overlay"], payload, "after");
    expect(findGraphNodeLocation(inside.graph, inside.nodeIds[0]!)?.parent?.id).toBe("layout-lab.overlay");

    const freeformPayload = createNodeClipboardPayload(demoGraph, "layout-lab", ["layout-lab.freeform-a"]);
    const inPlace = pasteNodesTransaction(demoGraph, "layout-lab", ["layout-lab.freeform-b"], freeformPayload, "in-place");
    expect(findGraphNodeLocation(inPlace.graph, inPlace.nodeIds[0]!)?.node.layout.position).toEqual({ x: 12, y: 18, z: 2 });
    const offset = pasteNodesTransaction(demoGraph, "layout-lab", ["layout-lab.freeform-b"], freeformPayload, "after");
    expect(findGraphNodeLocation(offset.graph, offset.nodeIds[0]!)?.node.layout.position).toEqual({ x: 28, y: 34, z: 2 });

    const replaced = pasteNodesTransaction(demoGraph, "layout-lab", ["layout-lab.grid-a"], payload, "replace");
    expect(findGraphNodeLocation(replaced.graph, "layout-lab.grid-a")).toBeUndefined();
    expect(findGraphNodeLocation(replaced.graph, replaced.nodeIds[0]!)?.parent?.id).toBe("layout-lab.grid");
  });

  it("rejects paste into locked or hidden hierarchy destinations", () => {
    const payload = createNodeClipboardPayload(demoGraph, "layout-lab", ["layout-lab.grid-a"]);
    const locked = structuredClone(demoGraph);
    findGraphNodeLocation(locked, "layout-lab.overlay")!.node.editor = { locked: true, hidden: false };
    expect(() => pasteNodesTransaction(locked, "layout-lab", ["layout-lab.overlay"], payload, "after"))
      .toThrow(/Locked layer/);
    const hidden = structuredClone(demoGraph);
    findGraphNodeLocation(hidden, "layout-lab.grid-a")!.node.editor = { locked: false, hidden: true };
    expect(() => pasteNodesTransaction(hidden, "layout-lab", ["layout-lab.grid-a"], payload, "replace"))
      .toThrow(/Hidden layer/);
  });

  it("copies semantic styles without replacing content, identity, or placement", () => {
    const source = findGraphNodeLocation(demoGraph, "payment-request.confirm")!.node;
    const target = findGraphNodeLocation(demoGraph, "payment-request.failure")!.node;
    const result = pasteStyleTransaction(demoGraph, [target.id], createStyleClipboardPayload(source));
    const styled = findGraphNodeLocation(result, target.id)!.node;
    expect(styled.style).toEqual(source.style);
    expect(styled.intent).toEqual(target.intent);
    expect(styled.id).toBe(target.id);
    expect(styled.layout.position).toEqual(target.layout.position);
  });

  it("extracts safe Unicode text from HTML and reports discarded styles", () => {
    expect(plainTextFromHtml('<style>bad</style><p dir="rtl">مرحبا <strong>🌍</strong></p><script>alert(1)</script>')).toEqual({
      text: "مرحبا 🌍",
      diagnostics: [{ code: "clipboard.html.styles-ignored", message: "Pasted HTML as safe text; unsupported markup and styles were ignored." }],
    });
    expect(plainTextFromHtml("<div>&#x1F44D; &amp; cafe&#769;</div>").text).toBe("👍 & café");
    expect(plainTextFromHtml("<p>Safe</p><script>alert(1)").text).toBe("Safe");
    expect(plainTextFromHtml("<p>&#xD800;</p>").text).toBe("&#xD800;");
    expect(plainTextFromHtml("<img src=x>").diagnostics[0]?.code).toBe("clipboard.html.empty");
  });
});
