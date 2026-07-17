import { demoGraph } from "@intentform/proof-report/demo";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  catalogWriteFailure,
  createCatalogProject,
  defaultWorkspaceState,
  nextCatalogProject,
  normalizeCatalogProjectRecord,
  normalizeWorkspaceState,
  subscribeCatalogChanges,
  withCatalogProjectLock,
} from "./browser-project-catalog";

afterEach(() => vi.unstubAllGlobals());

describe("browser project catalog records", () => {
  it("creates a versioned project with stable document identity and thumbnail metadata", () => {
    const project = createCatalogProject(
      demoGraph,
      { projectType: "application", source: "created" },
      "2026-07-16T10:00:00.000Z",
      "verdant-pay",
    );

    expect(project).toMatchObject({
      version: 1,
      id: "verdant-pay",
      name: demoGraph.product.name,
      revision: 1,
      missingLocalPath: false,
      workspace: {
        activeTabId: `screen:${demoGraph.screens[0]!.id}`,
        openTabs: [{
          id: `screen:${demoGraph.screens[0]!.id}`,
          kind: "screen",
          screenId: demoGraph.screens[0]!.id,
        }],
      },
      tags: [],
      searchIndex: expect.arrayContaining([demoGraph.product.name, "react"]),
      thumbnail: { screenCount: demoGraph.screens.length, graphFingerprint: expect.stringMatching(/^[a-f0-9]{8}$/) },
    });
  });

  it("migrates stored catalog graphs and recovery snapshots before current-schema validation", () => {
    const current = createCatalogProject(demoGraph, { projectType: "application", source: "created" }, "2026-07-16T10:00:00.000Z", "legacy");
    const legacy = structuredClone(current) as unknown as { graph: { schemaVersion: string }; lastKnownGood?: { graph: { schemaVersion: string } } };
    legacy.graph.schemaVersion = "0.9.0";
    legacy.lastKnownGood = { graph: structuredClone(legacy.graph), savedAt: current.updatedAt, revision: current.revision } as never;
    const migrated = normalizeCatalogProjectRecord(legacy);
    expect(migrated.graph.schemaVersion).toBe("0.11.0");
    expect(migrated.lastKnownGood?.graph.schemaVersion).toBe("0.11.0");
  });

  it("keeps the previous committed graph as last-known-good on every atomic revision", () => {
    const current = createCatalogProject(
      demoGraph,
      { projectType: "application", source: "created" },
      "2026-07-16T10:00:00.000Z",
      "verdant-pay",
    );
    const edited = structuredClone(demoGraph);
    edited.product.name = "Verdant Pay Revised";

    const next = nextCatalogProject(
      current,
      edited,
      current.workspace,
      "2026-07-16T10:01:00.000Z",
    );

    expect(next.revision).toBe(2);
    expect(next.graph.product.name).toBe("Verdant Pay Revised");
    expect(next.lastKnownGood).toEqual({
      graph: current.graph,
      savedAt: current.updatedAt,
      revision: 1,
    });
  });

  it("removes stale tabs and deterministically repairs active document state", () => {
    const first = demoGraph.screens[0]!;
    const workspace = defaultWorkspaceState(demoGraph);
    const normalized = normalizeWorkspaceState(demoGraph, {
      activeTabId: "screen:removed",
      openTabs: [
        { id: "screen:removed", kind: "screen", screenId: "removed", title: "Removed" },
        { id: `screen:${first.id}`, kind: "screen", screenId: first.id, title: "Stale title" },
      ],
      recentlyClosed: [
        { id: `screen:${first.id}`, kind: "screen", screenId: first.id, title: first.title },
      ],
    });

    expect(normalized).toEqual({
      activeTabId: workspace.activeTabId,
      openTabs: workspace.openTabs,
      recentlyClosed: [],
    });
  });

  it("keeps local-path and quota failures explicit without discarding recovery state", () => {
    const current = createCatalogProject(
      demoGraph,
      { projectType: "application", source: "local", localFingerprint: "1234abcd" },
      "2026-07-16T10:00:00.000Z",
      "desktop-linked",
    );
    const missing = nextCatalogProject(current, demoGraph, current.workspace, "2026-07-16T10:01:00.000Z", {
      missingLocalPath: true,
    });

    expect(missing).toMatchObject({
      source: "local",
      localFingerprint: "1234abcd",
      missingLocalPath: true,
      lastKnownGood: { revision: 1 },
    });
    expect(catalogWriteFailure(new DOMException("full", "QuotaExceededError"))).toEqual({
      ok: false,
      code: "quota",
      message: "Browser storage is full. Archive or delete a project, then try again.",
    });
    expect(catalogWriteFailure({ name: "NS_ERROR_DOM_QUOTA_REACHED" })).toEqual({
      ok: false,
      code: "quota",
      message: "Browser storage is full. Archive or delete a project, then try again.",
    });
  });

  it("accepts only bounded cross-tab catalog invalidations and closes subscriptions", () => {
    class FakeBroadcastChannel {
      static current: FakeBroadcastChannel;
      listener: ((event: MessageEvent<unknown>) => void) | null = null;
      closed = false;
      constructor(readonly name: string) { FakeBroadcastChannel.current = this; }
      addEventListener(_type: string, listener: EventListenerOrEventListenerObject) { this.listener = listener as (event: MessageEvent<unknown>) => void; }
      removeEventListener() { this.listener = null; }
      postMessage() {}
      close() { this.closed = true; }
      emit(data: unknown) { this.listener?.({ data } as MessageEvent<unknown>); }
    }
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
    const events: string[] = [];
    const unsubscribe = subscribeCatalogChanges((event) => events.push(`${event.kind}:${event.projectId}`));
    expect(FakeBroadcastChannel.current.name).toBe("intentform-project-catalog-v1");
    FakeBroadcastChannel.current.emit({ version: 1, projectId: "project-a", kind: "save" });
    FakeBroadcastChannel.current.emit({ version: 1, projectId: "project-a", kind: "unknown" });
    FakeBroadcastChannel.current.emit({ version: 2, projectId: "project-a", kind: "save" });
    expect(events).toEqual(["save:project-a"]);
    unsubscribe();
    expect(FakeBroadcastChannel.current.closed).toBe(true);
  });

  it("serializes project writes through the browser lock manager when available", async () => {
    const requests: string[] = [];
    const manager = {
      request: (async (name: string, options: LockOptions, callback: () => Promise<string>) => {
        requests.push(`${name}:${options.mode}`);
        return callback();
      }) as LockManager["request"],
    };
    await expect(withCatalogProjectLock("project-a", async () => "saved", manager)).resolves.toBe("saved");
    await expect(withCatalogProjectLock("project-b", async () => "fallback", null)).resolves.toBe("fallback");
    expect(requests).toEqual(["intentform-catalog:project-a:exclusive"]);
  });
});
