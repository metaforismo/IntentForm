import { describe, expect, it } from "vitest";
import { demoGraph } from "@intentform/proof-report/demo";
import {
  BROWSER_PROJECT_KEY,
  BROWSER_MIGRATION_BACKUP_KEY,
  LEGACY_DRAFT_KEY,
  clearBrowserProject,
  loadBrowserProject,
  saveBrowserProject,
} from "./browser-projects";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
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
    expect(storage.getItem(BROWSER_PROJECT_KEY)).toBeTruthy();
    expect(storage.getItem(LEGACY_DRAFT_KEY)).toBeNull();
    expect(storage.getItem(BROWSER_MIGRATION_BACKUP_KEY)).toBe(source);
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
    expect(legacyStorage.getItem(BROWSER_PROJECT_KEY)).toBeNull();

    storage.setItem(BROWSER_PROJECT_KEY, "current");
    storage.setItem(LEGACY_DRAFT_KEY, "legacy");
    storage.setItem(BROWSER_MIGRATION_BACKUP_KEY, "backup");
    clearBrowserProject(storage);
    expect(storage.length).toBe(0);
  });
});
