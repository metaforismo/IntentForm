import { describe, expect, it } from "vitest";
import { demoGraph } from "@intentform/proof-report/demo";
import { parseGraph } from "@intentform/semantic-schema";
import {
  BoundedLruCache,
  LARGE_DOCUMENT_PROFILE,
  assertBoundedWorkerMessage,
  createGraphIndex,
  createHorizontalFrameIndex,
  joinSnapshot,
  queryHorizontalFrames,
  splitSnapshot,
} from "./index.ts";

describe("large-document graph runtime", () => {
  it("indexes nested nodes and reuses unchanged screen indexes", () => {
    const initial = createGraphIndex(demoGraph);
    const changed = structuredClone(demoGraph);
    changed.screens[1]!.title = "Changed title";
    const next = createGraphIndex(parseGraph(changed), initial);

    expect(initial.nodeCount).toBeGreaterThan(10);
    expect(next.locationById.get("layout-lab.grid-a")?.parentId).toBe("layout-lab.grid");
    expect(next.reusedScreenCount).toBe(demoGraph.screens.length - 1);
  });

  it("queries only visible frames with bounded overscan and a pinned selection", () => {
    const frames = createHorizontalFrameIndex(["one", "two", "three", "four", "five"], 400, 100);
    const visible = queryHorizontalFrames(frames, { left: 510, right: 890 }, { overscan: 0, includeIds: ["five"] });
    expect(visible.map((frame) => frame.id)).toEqual(["two", "five"]);
    expect(frames.worldWidth).toBe(2_400);
  });

  it("round-trips chunked Unicode snapshots and rejects torn data", () => {
    const snapshot = splitSnapshot("intent-🌍-form".repeat(50), 23);
    expect(snapshot.chunks.length).toBeGreaterThan(1);
    expect(joinSnapshot(snapshot)).toBe("intent-🌍-form".repeat(50));
    expect(() => joinSnapshot({ ...snapshot, chunks: [...snapshot.chunks.slice(0, -1), "broken"] })).toThrow(/integrity/);
  });

  it("bounds worker payloads before they cross the isolation boundary", () => {
    expect(assertBoundedWorkerMessage({ kind: "verify", value: "safe" })).toBeGreaterThan(0);
    expect(() => assertBoundedWorkerMessage(undefined)).toThrow(/JSON-serializable/);
    expect(() => assertBoundedWorkerMessage({ value: "x".repeat(LARGE_DOCUMENT_PROFILE.maxWorkerMessageBytes + 1) })).toThrow(/exceeds/);
  });

  it("evicts least-recently-used derived values", () => {
    const cache = new BoundedLruCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.get("a")).toBe(1);
    cache.set("c", 3);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(1);
    expect(cache.size).toBe(2);
  });
});
