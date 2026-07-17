import { parseGraph, semanticInterfaceGraphSchema, type SemanticInterfaceGraph } from "@intentform/semantic-schema";
import { previewGraphMigration } from "@intentform/semantic-schema/migrations";
import { z } from "zod";
import {
  clearBrowserProject,
  loadBrowserProject,
  type BrowserProjectMetadata,
  type ProjectSource,
  type ProjectType,
} from "./browser-projects";
import { graphFingerprint } from "./project-save-state";

export const BROWSER_CATALOG_DB = "intentform-project-catalog";
export const BROWSER_CATALOG_VERSION = 1;
export const ACTIVE_BROWSER_PROJECT_KEY = "intentform-active-project-id";

const documentTabSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    id: z.string().min(1).max(240),
    kind: z.literal("screen"),
    screenId: z.string().min(1).max(240),
    title: z.string().min(1).max(240),
  }),
  z.strictObject({
    id: z.string().min(1).max(240),
    kind: z.literal("output"),
    target: z.enum(["react", "web", "expo", "swiftui"]),
    title: z.string().min(1).max(240),
  }),
]);

const workspaceStateSchema = z.strictObject({
  openTabs: z.array(documentTabSchema).min(1).max(32),
  activeTabId: z.string().min(1).max(240),
  recentlyClosed: z.array(documentTabSchema).max(12),
});

const thumbnailSchema = z.strictObject({
  accent: z.string().min(1).max(80),
  canvas: z.string().min(1).max(80),
  surface: z.string().min(1).max(80),
  screenCount: z.number().int().nonnegative(),
  graphFingerprint: z.string().regex(/^[a-f0-9]{8}$/).optional(),
});

const catalogProjectSchema = z.strictObject({
  version: z.literal(1),
  id: z.string().min(1).max(120),
  name: z.string().min(1).max(120),
  graph: semanticInterfaceGraphSchema,
  projectType: z.enum(["application", "prototype", "component-library", "responsive-web"]),
  source: z.enum(["created", "example", "imported", "local", "recovery"]),
  localFingerprint: z.string().regex(/^[a-f0-9]{8}$/).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  lastOpenedAt: z.string().datetime(),
  archivedAt: z.string().datetime().optional(),
  missingLocalPath: z.boolean(),
  revision: z.number().int().positive(),
  folder: z.string().min(1).max(120).optional(),
  tags: z.array(z.string().min(1).max(48)).max(20).default([]),
  searchIndex: z.array(z.string().min(1).max(240)).max(128).default([]),
  thumbnail: thumbnailSchema,
  workspace: workspaceStateSchema,
  lastKnownGood: z.strictObject({
    graph: semanticInterfaceGraphSchema,
    savedAt: z.string().datetime(),
    revision: z.number().int().positive(),
  }).optional(),
});

export type BrowserDocumentTab = z.infer<typeof documentTabSchema>;
export type BrowserWorkspaceState = z.infer<typeof workspaceStateSchema>;
export type BrowserCatalogProject = z.infer<typeof catalogProjectSchema>;

export type CatalogWriteResult =
  | { ok: true; project: BrowserCatalogProject }
  | { ok: false; code: "conflict" | "quota" | "missing" | "unavailable"; message: string };

export interface CatalogMigrationResult {
  migratedProjectId: string | null;
  warning: string | null;
}

interface BrowserProjectCatalogDatabase {
  list(includeArchived?: boolean): Promise<BrowserCatalogProject[]>;
  get(id: string): Promise<BrowserCatalogProject | null>;
  create(graph: SemanticInterfaceGraph, metadata: BrowserProjectMetadata, now?: string): Promise<CatalogWriteResult>;
  save(
    id: string,
    graph: SemanticInterfaceGraph,
    workspace: BrowserWorkspaceState,
    expectedRevision: number,
    metadata?: Partial<Pick<BrowserCatalogProject, "localFingerprint" | "missingLocalPath" | "projectType" | "source">>,
    now?: string,
  ): Promise<CatalogWriteResult>;
  touch(id: string, now?: string): Promise<CatalogWriteResult>;
  rename(id: string, name: string, now?: string): Promise<CatalogWriteResult>;
  archive(id: string, archived: boolean, now?: string): Promise<CatalogWriteResult>;
  organize(id: string, folder: string | null, tags: string[], now?: string): Promise<CatalogWriteResult>;
  markMissing(id: string, missing: boolean, now?: string): Promise<CatalogWriteResult>;
  delete(id: string): Promise<boolean>;
}

function outputTarget(graph: SemanticInterfaceGraph): "react" | "web" | "expo" | "swiftui" {
  const enabled = graph.platforms.find((platform) => platform.enabled)?.target;
  return enabled === "web" || enabled === "expo" || enabled === "swiftui" ? enabled : "react";
}

export function defaultWorkspaceState(graph: SemanticInterfaceGraph): BrowserWorkspaceState {
  const firstScreen = graph.screens[0];
  if (firstScreen) {
    const tab: BrowserDocumentTab = {
      id: `screen:${firstScreen.id}`,
      kind: "screen",
      screenId: firstScreen.id,
      title: firstScreen.title,
    };
    return { openTabs: [tab], activeTabId: tab.id, recentlyClosed: [] };
  }
  const target = outputTarget(graph);
  const tab: BrowserDocumentTab = { id: `output:${target}`, kind: "output", target, title: `${target} output` };
  return { openTabs: [tab], activeTabId: tab.id, recentlyClosed: [] };
}

export function normalizeWorkspaceState(
  graph: SemanticInterfaceGraph,
  input: BrowserWorkspaceState | undefined,
): BrowserWorkspaceState {
  const availableScreens = new Map(graph.screens.map((screen) => [screen.id, screen]));
  const availableTargets = new Set(graph.platforms.filter((platform) => platform.enabled).map((platform) => platform.target));
  const valid = (input?.openTabs ?? []).flatMap((tab): BrowserDocumentTab[] => {
    if (tab.kind === "screen") {
      const screen = availableScreens.get(tab.screenId);
      return screen ? [{ ...tab, title: screen.title }] : [];
    }
    return availableTargets.has(tab.target) ? [tab] : [];
  });
  const openTabs = valid.length > 0 ? valid : defaultWorkspaceState(graph).openTabs;
  const activeTabId = openTabs.some((tab) => tab.id === input?.activeTabId) ? input!.activeTabId : openTabs[0]!.id;
  const recentlyClosed = (input?.recentlyClosed ?? []).filter((tab) => !openTabs.some((open) => open.id === tab.id)).slice(0, 12);
  return { openTabs, activeTabId, recentlyClosed };
}

function projectThumbnail(graph: SemanticInterfaceGraph): BrowserCatalogProject["thumbnail"] {
  const mode = graph.tokens.modes[graph.tokens.activeMode] ?? graph.tokens.modes[graph.tokens.defaultMode];
  const colors = mode?.values.colors ?? {};
  return {
    accent: colors["color.accent"] ?? "#3478e5",
    canvas: colors["color.canvas"] ?? "#eeeeec",
    surface: colors["color.surface"] ?? "#ffffff",
    screenCount: graph.screens.length,
    graphFingerprint: graphFingerprint(graph),
  };
}

function projectSearchIndex(graph: SemanticInterfaceGraph, tags: string[] = [], folder?: string): string[] {
  return [
    graph.product.name,
    ...graph.screens.map((screen) => screen.title),
    ...graph.platforms.filter((platform) => platform.enabled).map((platform) => platform.target),
    ...tags,
    ...(folder ? [folder] : []),
  ].slice(0, 128);
}

function projectId(graph: SemanticInterfaceGraph): string {
  const slug = graph.product.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "project";
  const suffix = globalThis.crypto?.randomUUID?.().slice(0, 8) ?? Math.random().toString(16).slice(2, 10);
  return `${slug}-${suffix}`;
}

export function createCatalogProject(
  graphInput: SemanticInterfaceGraph,
  metadata: BrowserProjectMetadata,
  now = new Date().toISOString(),
  id = projectId(graphInput),
): BrowserCatalogProject {
  const graph = parseGraph(graphInput);
  return catalogProjectSchema.parse({
    version: 1,
    id,
    name: graph.product.name,
    graph,
    projectType: metadata.projectType,
    source: metadata.source,
    ...(metadata.localFingerprint ? { localFingerprint: metadata.localFingerprint } : {}),
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
    missingLocalPath: false,
    revision: 1,
    tags: [],
    searchIndex: projectSearchIndex(graph),
    thumbnail: projectThumbnail(graph),
    workspace: defaultWorkspaceState(graph),
  });
}

export function nextCatalogProject(
  current: BrowserCatalogProject,
  graphInput: SemanticInterfaceGraph,
  workspaceInput: BrowserWorkspaceState,
  now = new Date().toISOString(),
  metadata: Partial<Pick<BrowserCatalogProject, "localFingerprint" | "missingLocalPath" | "projectType" | "source">> = {},
): BrowserCatalogProject {
  const graph = parseGraph(graphInput);
  return catalogProjectSchema.parse({
    ...current,
    ...metadata,
    name: graph.product.name,
    graph,
    updatedAt: now,
    revision: current.revision + 1,
    thumbnail: projectThumbnail(graph),
    searchIndex: projectSearchIndex(graph, current.tags, current.folder),
    workspace: normalizeWorkspaceState(graph, workspaceInput),
    lastKnownGood: {
      graph: current.graph,
      savedAt: current.updatedAt,
      revision: current.revision,
    },
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error ?? new Error("IndexedDB request failed.")), { once: true });
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener("abort", () => reject(transaction.error ?? new Error("IndexedDB transaction was aborted.")), { once: true });
    transaction.addEventListener("error", () => reject(transaction.error ?? new Error("IndexedDB transaction failed.")), { once: true });
  });
}

export function catalogWriteFailure(error: unknown): CatalogWriteResult {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "QuotaExceededError") {
    return { ok: false, code: "quota", message: "Browser storage is full. Archive or delete a project, then try again." };
  }
  return { ok: false, code: "unavailable", message: "The browser project catalog is unavailable in this context." };
}

async function openDatabase(): Promise<IDBDatabase> {
  if (!globalThis.indexedDB) throw new Error("IndexedDB is unavailable.");
  const request = indexedDB.open(BROWSER_CATALOG_DB, BROWSER_CATALOG_VERSION);
  request.addEventListener("upgradeneeded", () => {
    const database = request.result;
    if (!database.objectStoreNames.contains("projects")) {
      const store = database.createObjectStore("projects", { keyPath: "id" });
      store.createIndex("lastOpenedAt", "lastOpenedAt");
      store.createIndex("archivedAt", "archivedAt");
    }
  });
  return requestResult(request);
}

async function readProject(store: IDBObjectStore, id: string): Promise<BrowserCatalogProject | null> {
  const value = await requestResult(store.get(id));
  if (value === undefined) return null;
  return normalizeCatalogProjectRecord(value);
}

export function normalizeCatalogProjectRecord(value: unknown): BrowserCatalogProject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Catalog project must be an object");
  const record = structuredClone(value) as Record<string, unknown>;
  record.graph = previewGraphMigration(record.graph).graph;
  if (record.lastKnownGood && typeof record.lastKnownGood === "object" && !Array.isArray(record.lastKnownGood)) {
    const lastKnownGood = record.lastKnownGood as Record<string, unknown>;
    lastKnownGood.graph = previewGraphMigration(lastKnownGood.graph).graph;
  }
  const project = catalogProjectSchema.parse(record);
  return project.searchIndex.length > 0 && project.thumbnail.graphFingerprint
    ? project
    : catalogProjectSchema.parse({ ...project, searchIndex: projectSearchIndex(project.graph, project.tags, project.folder), thumbnail: projectThumbnail(project.graph) });
}

export async function withCatalogProjectLock<T>(
  projectId: string,
  operation: () => Promise<T>,
  manager: Pick<LockManager, "request"> | null = typeof navigator !== "undefined" && navigator.locks ? navigator.locks : null,
): Promise<T> {
  if (!manager) return operation();
  return manager.request(`intentform-catalog:${projectId}`, { mode: "exclusive" }, operation);
}

export function browserProjectCatalog(): BrowserProjectCatalogDatabase {
  return {
    async list(includeArchived = false) {
      const database = await openDatabase();
      try {
        const transaction = database.transaction("projects", "readonly");
        const values = await requestResult(transaction.objectStore("projects").getAll());
        await transactionDone(transaction);
        return values
          .map(normalizeCatalogProjectRecord)
          .filter((project) => includeArchived || !project.archivedAt)
          .sort((left, right) => right.lastOpenedAt.localeCompare(left.lastOpenedAt));
      } finally {
        database.close();
      }
    },
    async get(id) {
      const database = await openDatabase();
      try {
        const transaction = database.transaction("projects", "readonly");
        const project = await readProject(transaction.objectStore("projects"), id);
        await transactionDone(transaction);
        return project;
      } finally {
        database.close();
      }
    },
    async create(graph, metadata, now) {
      try {
        const project = createCatalogProject(graph, metadata, now);
        const database = await openDatabase();
        try {
          const transaction = database.transaction("projects", "readwrite");
          transaction.objectStore("projects").add(project);
          await transactionDone(transaction);
          return { ok: true, project };
        } finally {
          database.close();
        }
      } catch (error) {
        return catalogWriteFailure(error);
      }
    },
    async save(id, graph, workspace, expectedRevision, metadata, now) {
      return withCatalogProjectLock(id, async () => {
        try {
          const database = await openDatabase();
          try {
            const transaction = database.transaction("projects", "readwrite");
            const store = transaction.objectStore("projects");
            const current = await readProject(store, id);
            if (!current) {
              transaction.abort();
              return { ok: false, code: "missing", message: "This project no longer exists in the browser catalog." };
            }
            if (current.revision !== expectedRevision) {
              transaction.abort();
              return { ok: false, code: "conflict", message: "This project changed in another window. Reopen it before saving." };
            }
            const project = nextCatalogProject(current, graph, workspace, now, metadata);
            store.put(project);
            await transactionDone(transaction);
            return { ok: true, project };
          } finally {
            database.close();
          }
        } catch (error) {
          return catalogWriteFailure(error);
        }
      });
    },
    async touch(id, now = new Date().toISOString()) {
      try {
        const database = await openDatabase();
        try {
          const transaction = database.transaction("projects", "readwrite");
          const store = transaction.objectStore("projects");
          const current = await readProject(store, id);
          if (!current) {
            transaction.abort();
            return { ok: false, code: "missing", message: "This project no longer exists in the browser catalog." };
          }
          const project = catalogProjectSchema.parse({ ...current, lastOpenedAt: now });
          store.put(project);
          await transactionDone(transaction);
          return { ok: true, project };
        } finally {
          database.close();
        }
      } catch (error) {
        return catalogWriteFailure(error);
      }
    },
    async rename(id, name, now = new Date().toISOString()) {
      const trimmed = name.trim();
      if (!trimmed) return { ok: false, code: "unavailable", message: "Project names cannot be empty." };
      try {
        const database = await openDatabase();
        try {
          const transaction = database.transaction("projects", "readwrite");
          const store = transaction.objectStore("projects");
          const current = await readProject(store, id);
          if (!current) {
            transaction.abort();
            return { ok: false, code: "missing", message: "This project no longer exists in the browser catalog." };
          }
          const graph = structuredClone(current.graph);
          graph.product.name = trimmed;
          const project = nextCatalogProject(current, graph, current.workspace, now);
          store.put(project);
          await transactionDone(transaction);
          return { ok: true, project };
        } finally {
          database.close();
        }
      } catch (error) {
        return catalogWriteFailure(error);
      }
    },
    async archive(id, archived, now = new Date().toISOString()) {
      try {
        const database = await openDatabase();
        try {
          const transaction = database.transaction("projects", "readwrite");
          const store = transaction.objectStore("projects");
          const current = await readProject(store, id);
          if (!current) {
            transaction.abort();
            return { ok: false, code: "missing", message: "This project no longer exists in the browser catalog." };
          }
          const project = catalogProjectSchema.parse({
            ...current,
            updatedAt: now,
            revision: current.revision + 1,
            ...(archived ? { archivedAt: now } : { archivedAt: undefined }),
          });
          store.put(project);
          await transactionDone(transaction);
          return { ok: true, project };
        } finally {
          database.close();
        }
      } catch (error) {
        return catalogWriteFailure(error);
      }
    },
    async organize(id, folder, tags, now = new Date().toISOString()) {
      const normalizedFolder = folder?.trim() || undefined;
      const normalizedTags = [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))].slice(0, 20);
      try {
        const database = await openDatabase();
        try {
          const transaction = database.transaction("projects", "readwrite");
          const store = transaction.objectStore("projects");
          const current = await readProject(store, id);
          if (!current) {
            transaction.abort();
            return { ok: false, code: "missing", message: "This project no longer exists in the browser catalog." };
          }
          const project = catalogProjectSchema.parse({
            ...current,
            folder: normalizedFolder,
            tags: normalizedTags,
            searchIndex: projectSearchIndex(current.graph, normalizedTags, normalizedFolder),
            updatedAt: now,
            revision: current.revision + 1,
          });
          store.put(project);
          await transactionDone(transaction);
          return { ok: true, project };
        } finally {
          database.close();
        }
      } catch (error) {
        return catalogWriteFailure(error);
      }
    },
    async markMissing(id, missing, now = new Date().toISOString()) {
      try {
        const database = await openDatabase();
        try {
          const transaction = database.transaction("projects", "readwrite");
          const store = transaction.objectStore("projects");
          const current = await readProject(store, id);
          if (!current) {
            transaction.abort();
            return { ok: false, code: "missing", message: "This project no longer exists in the browser catalog." };
          }
          const project = catalogProjectSchema.parse({
            ...current,
            missingLocalPath: missing,
            updatedAt: now,
            revision: current.revision + 1,
          });
          store.put(project);
          await transactionDone(transaction);
          return { ok: true, project };
        } finally {
          database.close();
        }
      } catch (error) {
        return catalogWriteFailure(error);
      }
    },
    async delete(id) {
      const database = await openDatabase();
      try {
        const transaction = database.transaction("projects", "readwrite");
        transaction.objectStore("projects").delete(id);
        await transactionDone(transaction);
        return true;
      } finally {
        database.close();
      }
    },
  };
}

export async function migrateLegacyBrowserProject(storage: Storage): Promise<CatalogMigrationResult> {
  const catalog = browserProjectCatalog();
  try {
    const existing = await catalog.list(true);
    if (existing.length > 0) return { migratedProjectId: null, warning: null };
    const legacy = loadBrowserProject(storage);
    if (legacy.status === "empty") return { migratedProjectId: null, warning: null };
    if (legacy.status === "invalid") return { migratedProjectId: null, warning: legacy.message };
    const created = await catalog.create(legacy.project.graph, {
      projectType: legacy.project.projectType,
      source: legacy.project.source,
      ...(legacy.project.localFingerprint ? { localFingerprint: legacy.project.localFingerprint } : {}),
    }, legacy.project.savedAt);
    if (!created.ok) return { migratedProjectId: null, warning: created.message };
    storage.setItem(ACTIVE_BROWSER_PROJECT_KEY, created.project.id);
    clearBrowserProject(storage);
    return { migratedProjectId: created.project.id, warning: null };
  } catch {
    return { migratedProjectId: null, warning: "The durable browser project catalog could not be opened." };
  }
}

export function activeBrowserProjectId(storage: Storage): string | null {
  const id = storage.getItem(ACTIVE_BROWSER_PROJECT_KEY)?.trim();
  return id || null;
}

export function setActiveBrowserProject(storage: Storage, id: string): void {
  storage.setItem(ACTIVE_BROWSER_PROJECT_KEY, id);
}

export function clearActiveBrowserProject(storage: Storage, id?: string): void {
  if (!id || activeBrowserProjectId(storage) === id) storage.removeItem(ACTIVE_BROWSER_PROJECT_KEY);
}

export type { ProjectSource, ProjectType };
