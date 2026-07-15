import { describe, expect, it } from "vitest";
import { demoGraph } from "@intentform/proof-report/demo";
import {
  BROWSER_PROJECT_KEY,
  BROWSER_PROJECT_CHUNK_PREFIX,
  BROWSER_PROJECT_MANIFEST_KEY,
  BROWSER_MIGRATION_BACKUP_KEY,
  LEGACY_DRAFT_KEY,
  clearBrowserProject,
  loadBrowserProject,
  saveBrowserProject,
} from "./browser-projects";

class MemoryStorage implements Storage {
  protected values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

class ControlledStorage extends MemoryStorage {
  failKey: string | null = null;
  override setItem(key: string, value: string) {
    if (key === this.failKey) throw new Error("quota");
    super.setItem(key, value);
  }
}

function largeGraph() {
  const graph = structuredClone(demoGraph);
  const leaf = structuredClone(graph.screens[0]!.nodes[0]!);
  graph.components = [];
  graph.assets = [];
  graph.flows = [];
  graph.contracts = [];
  graph.fixtures = [];
  graph.screens = Array.from({ length: 20 }, (_, screenIndex) => {
    const screenId = `large-${screenIndex}`;
    return {
      id: screenId,
      title: `Large screen ${screenIndex}`,
      purpose: "Exercise chunked browser recovery",
      route: `/large-${screenIndex}`,
      nodes: Array.from({ length: 20 }, (_, nodeIndex) => ({
        ...structuredClone(leaf),
        id: `${screenId}.node-${nodeIndex}`,
      })),
    };
  });
  return graph;
}

function legacyDemoGraph() {
  const legacy = structuredClone(demoGraph) as unknown as Record<string, unknown> & {
    tokens: unknown;
    assets?: unknown;
  };
  legacy.schemaVersion = "0.0.1";
  legacy.tokens = structuredClone(demoGraph.tokens.modes[demoGraph.tokens.defaultMode]!.values);
  delete legacy.assets;
  return legacy;
}

function migratedLegacyDemoGraph() {
  const migrated = structuredClone(demoGraph);
  migrated.tokens = {
    defaultMode: "default",
    activeMode: "default",
    modes: {
      default: {
        name: "Default",
        values: structuredClone(demoGraph.tokens.modes[demoGraph.tokens.defaultMode]!.values),
      },
    },
    aliases: {},
    deprecated: {},
    extensions: {},
  };
  migrated.assets = [];
  return migrated;
}

describe("browser project recovery", () => {
  it("round-trips a versioned project envelope with local bridge identity", () => {
    const storage = new MemoryStorage();
    const saved = saveBrowserProject(storage, demoGraph, {
      projectType: "application",
      source: "local",
      localFingerprint: "1234abcd",
    }, "2026-07-14T20:00:00.000Z");

    expect(saved.ok).toBe(true);
    expect(loadBrowserProject(storage)).toEqual({
      status: "ready",
      project: expect.objectContaining({
        version: 1,
        graph: demoGraph,
        savedAt: "2026-07-14T20:00:00.000Z",
        projectType: "application",
        source: "local",
        localFingerprint: "1234abcd",
      }),
    });
  });

  it("migrates the legacy raw graph without mutating it", () => {
    const storage = new MemoryStorage();
    const source = JSON.stringify(demoGraph);
    storage.setItem(LEGACY_DRAFT_KEY, source);

    const loaded = loadBrowserProject(storage);
    expect(loaded).toEqual({
      status: "ready",
      project: expect.objectContaining({ graph: demoGraph, source: "recovery" }),
    });
    expect(storage.getItem(BROWSER_PROJECT_MANIFEST_KEY)).toBeTruthy();
    expect(storage.getItem(LEGACY_DRAFT_KEY)).toBeNull();
    expect(storage.getItem(BROWSER_MIGRATION_BACKUP_KEY)).toBe(source);
  });

  it("chunks large projects and fails closed when a generation is torn", () => {
    const storage = new MemoryStorage();
    expect(saveBrowserProject(storage, largeGraph(), {
      projectType: "application",
      source: "created",
    }, "2026-07-14T20:00:00.000Z").ok).toBe(true);

    const chunkKeys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
      .filter((key): key is string => key?.startsWith(BROWSER_PROJECT_CHUNK_PREFIX) === true);
    expect(chunkKeys.length).toBeGreaterThan(1);
    storage.setItem(chunkKeys[0]!, "torn");
    expect(loadBrowserProject(storage)).toEqual(expect.objectContaining({
      status: "invalid",
      message: expect.stringMatching(/integrity/i),
    }));
  });

  it("keeps the previous committed generation when the next manifest swap fails", () => {
    const storage = new ControlledStorage();
    expect(saveBrowserProject(storage, demoGraph, {
      projectType: "application",
      source: "created",
    }, "2026-07-14T20:00:00.000Z").ok).toBe(true);
    const previousManifest = storage.getItem(BROWSER_PROJECT_MANIFEST_KEY);

    storage.failKey = BROWSER_PROJECT_MANIFEST_KEY;
    expect(saveBrowserProject(storage, largeGraph(), {
      projectType: "prototype",
      source: "created",
    }, "2026-07-14T20:01:00.000Z").ok).toBe(false);
    expect(storage.getItem(BROWSER_PROJECT_MANIFEST_KEY)).toBe(previousManifest);
    expect(loadBrowserProject(storage)).toEqual(expect.objectContaining({
      status: "ready",
      project: expect.objectContaining({ projectType: "application", graph: demoGraph }),
    }));
  });

  it("upgrades a 0.0.1 browser draft and preserves the exact original source", () => {
    const storage = new MemoryStorage();
    const legacy = legacyDemoGraph();
    const source = ` ${JSON.stringify(legacy)}\n`;
    storage.setItem(LEGACY_DRAFT_KEY, source);

    const loaded = loadBrowserProject(storage);
    expect(loaded).toEqual({
      status: "ready",
      project: expect.objectContaining({ graph: migratedLegacyDemoGraph(), source: "recovery" }),
    });
    expect(storage.getItem(BROWSER_MIGRATION_BACKUP_KEY)).toBe(source);
  });

  it("returns actionable diagnostics for corrupt and unsupported drafts", () => {
    const corrupt = new MemoryStorage();
    corrupt.setItem(BROWSER_PROJECT_KEY, "{not-json");
    expect(loadBrowserProject(corrupt)).toEqual(expect.objectContaining({
      status: "invalid",
      message: expect.stringMatching(/valid JSON/i),
    }));

    const future = new MemoryStorage();
    future.setItem(BROWSER_PROJECT_KEY, JSON.stringify({ version: 9, graph: demoGraph }));
    expect(loadBrowserProject(future)).toEqual(expect.objectContaining({
      status: "invalid",
      message: expect.stringMatching(/newer browser project format/i),
    }));
  });

  it("reports storage failures and clears both current and legacy keys", () => {
    const storage = new MemoryStorage();
    const failing = new Proxy(storage, {
      get(target, property, receiver) {
        if (property === "setItem") return () => { throw new Error("quota"); };
        return Reflect.get(target, property, receiver);
      },
    });
    expect(saveBrowserProject(failing, demoGraph, { projectType: "application", source: "created" })).toEqual({
      ok: false,
      message: "This browser could not save the project for recovery.",
    });

    const legacyStorage = new MemoryStorage();
    legacyStorage.setItem(LEGACY_DRAFT_KEY, JSON.stringify(demoGraph));
    const backupFailure = new Proxy(legacyStorage, {
      get(target, property, receiver) {
        if (property === "setItem") return (key: string, value: string) => {
          if (key === BROWSER_MIGRATION_BACKUP_KEY) throw new Error("quota");
          target.setItem(key, value);
        };
        return Reflect.get(target, property, receiver);
      },
    });
    expect(loadBrowserProject(backupFailure)).toEqual(expect.objectContaining({ status: "invalid" }));
    expect(legacyStorage.getItem(LEGACY_DRAFT_KEY)).toBeTruthy();
    expect(legacyStorage.getItem(BROWSER_PROJECT_MANIFEST_KEY)).toBeNull();

    storage.setItem(BROWSER_PROJECT_KEY, "current");
    storage.setItem(BROWSER_PROJECT_MANIFEST_KEY, "manifest");
    storage.setItem(`${BROWSER_PROJECT_CHUNK_PREFIX}generation:000`, "chunk");
    storage.setItem(LEGACY_DRAFT_KEY, "legacy");
    storage.setItem(BROWSER_MIGRATION_BACKUP_KEY, "backup");
    clearBrowserProject(storage);
    expect(storage.length).toBe(0);
  });
});
