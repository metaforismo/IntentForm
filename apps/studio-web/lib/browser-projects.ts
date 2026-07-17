import {
  parseGraph,
  semanticInterfaceGraphSchema,
  type SemanticInterfaceGraph,
} from "@intentform/semantic-schema";
import { LARGE_DOCUMENT_PROFILE, joinSnapshot, splitSnapshot } from "@intentform/graph-runtime";
import { previewGraphMigration } from "@intentform/semantic-schema/migrations";
import { z } from "zod";

export const BROWSER_PROJECT_KEY = "intentform-browser-project-v1";
export const BROWSER_PROJECT_MANIFEST_KEY = "intentform-browser-project-v2-manifest";
export const BROWSER_PROJECT_CHUNK_PREFIX = "intentform-browser-project-v2-chunk:";
export const LEGACY_DRAFT_KEY = "intentform-project-draft-v1";
export const BROWSER_MIGRATION_BACKUP_KEY = "intentform-browser-migration-backup-v1";

export type ProjectType = "application" | "prototype" | "component-library" | "responsive-web";
export type ProjectSource = "created" | "example" | "imported" | "local" | "recovery";

const browserProjectSchema = z.strictObject({
  version: z.literal(1),
  graph: semanticInterfaceGraphSchema,
  savedAt: z.string().datetime(),
  projectType: z.enum(["application", "prototype", "component-library", "responsive-web"]),
  source: z.enum(["created", "example", "imported", "local", "recovery"]),
  localFingerprint: z.string().regex(/^[a-f0-9]{8}$/).optional(),
});

const browserProjectInputSchema = browserProjectSchema.extend({ graph: z.unknown() });

const browserProjectManifestSchema = z.strictObject({
  version: z.literal(1),
  generation: z.string().min(1).max(120).regex(/^[a-z0-9-]+$/),
  checksum: z.string().regex(/^[a-f0-9]{8}$/),
  characters: z.number().int().nonnegative(),
  chunkCount: z.number().int().min(1).max(LARGE_DOCUMENT_PROFILE.maxBrowserChunks),
});

export type BrowserProject = z.infer<typeof browserProjectSchema>;

export interface BrowserProjectMetadata {
  projectType: ProjectType;
  source: ProjectSource;
  localFingerprint?: string;
}

export type BrowserProjectLoadResult =
  | { status: "empty" }
  | { status: "ready"; project: BrowserProject }
  | { status: "invalid"; message: string };

export type BrowserProjectSaveResult =
  | { ok: true; project: BrowserProject }
  | { ok: false; message: string };

function parseCurrentProject(source: string): BrowserProjectLoadResult {
  let input: unknown;
  try {
    input = JSON.parse(source);
  } catch {
    return { status: "invalid", message: "The recovery file is not valid JSON." };
  }
  if (input && typeof input === "object" && "version" in input && (input as { version?: unknown }).version !== 1) {
    return { status: "invalid", message: "This draft uses a newer browser project format and was left untouched." };
  }
  const parsed = browserProjectInputSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const location = issue?.path.length ? ` at ${issue.path.join(".")}` : "";
    return { status: "invalid", message: `The recovery project is invalid${location}: ${issue?.message ?? "schema validation failed"}.` };
  }
  try {
    return {
      status: "ready",
      project: browserProjectSchema.parse({ ...parsed.data, graph: previewGraphMigration(parsed.data.graph).graph }),
    };
  } catch (error) {
    return { status: "invalid", message: error instanceof Error ? `The recovery project graph is invalid: ${error.message.slice(0, 240)}.` : "The recovery project graph is invalid." };
  }
}

function chunkKey(generation: string, index: number): string {
  return `${BROWSER_PROJECT_CHUNK_PREFIX}${generation}:${String(index).padStart(3, "0")}`;
}

function storageKeys(storage: Storage): string[] {
  return Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter((key): key is string => key !== null);
}

function loadChunkedProject(storage: Storage, source: string): BrowserProjectLoadResult {
  let input: unknown;
  try {
    input = JSON.parse(source);
  } catch {
    return { status: "invalid", message: "The recovery manifest is not valid JSON." };
  }
  const parsed = browserProjectManifestSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid", message: "The recovery manifest is invalid and was left untouched." };
  const manifest = parsed.data;
  const chunks = Array.from({ length: manifest.chunkCount }, (_, index) => storage.getItem(chunkKey(manifest.generation, index)));
  if (chunks.some((chunk) => chunk === null)) {
    return { status: "invalid", message: "The recovery project is incomplete and was left untouched." };
  }
  try {
    return parseCurrentProject(joinSnapshot({
      version: 1,
      checksum: manifest.checksum,
      characters: manifest.characters,
      chunks: chunks as string[],
    }));
  } catch {
    return { status: "invalid", message: "The recovery project failed integrity validation and was left untouched." };
  }
}

export function loadBrowserProject(storage: Storage): BrowserProjectLoadResult {
  const manifest = storage.getItem(BROWSER_PROJECT_MANIFEST_KEY);
  if (manifest) return loadChunkedProject(storage, manifest);
  const current = storage.getItem(BROWSER_PROJECT_KEY);
  if (current) return parseCurrentProject(current);

  const legacy = storage.getItem(LEGACY_DRAFT_KEY);
  if (!legacy) return { status: "empty" };
  let input: unknown;
  try {
    input = JSON.parse(legacy);
  } catch {
    return { status: "invalid", message: "The legacy recovery draft is not valid JSON." };
  }
  try {
    const graph = previewGraphMigration(input).graph;
    const saved = saveBrowserProject(storage, graph, {
      projectType: "application",
      source: "recovery",
    });
    if (saved.ok) storage.removeItem(LEGACY_DRAFT_KEY);
    return saved.ok
      ? { status: "ready", project: saved.project }
      : { status: "invalid", message: saved.message };
  } catch (error) {
    return {
      status: "invalid",
      message: error instanceof Error
        ? `The legacy recovery draft is invalid: ${error.message.slice(0, 240)}.`
        : "The legacy recovery draft is invalid.",
    };
  }
}

export function saveBrowserProject(
  storage: Storage,
  graphInput: SemanticInterfaceGraph,
  metadata: BrowserProjectMetadata,
  savedAt = new Date().toISOString(),
): BrowserProjectSaveResult {
  const graph = parseGraph(graphInput);
  const project = browserProjectSchema.parse({
    version: 1,
    graph,
    savedAt,
    ...metadata,
  });
  const snapshot = splitSnapshot(JSON.stringify(project));
  const previousManifestSource = storage.getItem(BROWSER_PROJECT_MANIFEST_KEY);
  let previousManifest: z.infer<typeof browserProjectManifestSchema> | undefined;
  try {
    previousManifest = previousManifestSource
      ? browserProjectManifestSchema.safeParse(JSON.parse(previousManifestSource)).data
      : undefined;
  } catch {
    previousManifest = undefined;
  }
  const generationBase = `${savedAt.replace(/[^0-9]/g, "").slice(0, 17)}-${snapshot.checksum}`.toLowerCase();
  let generation = generationBase;
  let suffix = 1;
  while (storage.getItem(chunkKey(generation, 0)) !== null) generation = `${generationBase}-${suffix++}`;
  const written: string[] = [];
  try {
    const legacy = storage.getItem(LEGACY_DRAFT_KEY);
    if (legacy !== null && storage.getItem(BROWSER_MIGRATION_BACKUP_KEY) === null) {
      storage.setItem(BROWSER_MIGRATION_BACKUP_KEY, legacy);
    }
    snapshot.chunks.forEach((chunk, index) => {
      const key = chunkKey(generation, index);
      storage.setItem(key, chunk);
      written.push(key);
    });
    storage.setItem(BROWSER_PROJECT_MANIFEST_KEY, JSON.stringify({
      version: 1,
      generation,
      checksum: snapshot.checksum,
      characters: snapshot.characters,
      chunkCount: snapshot.chunks.length,
    }));
  } catch {
    for (const key of written) {
      try { storage.removeItem(key); } catch { /* Preserve the prior manifest when stale cleanup is denied. */ }
    }
    return { ok: false, message: "This browser could not save the project for recovery." };
  }
  // The manifest swap above is the commit point. Cleanup is best-effort so a
  // storage implementation that rejects deletion cannot corrupt the new head.
  try {
    for (const key of storageKeys(storage)) {
      if (key.startsWith(BROWSER_PROJECT_CHUNK_PREFIX) && !key.startsWith(`${BROWSER_PROJECT_CHUNK_PREFIX}${generation}:`)) {
        storage.removeItem(key);
      }
    }
    if (previousManifest && previousManifest.generation !== generation) {
      for (let index = 0; index < previousManifest.chunkCount; index += 1) storage.removeItem(chunkKey(previousManifest.generation, index));
    }
    storage.removeItem(BROWSER_PROJECT_KEY);
    storage.removeItem(LEGACY_DRAFT_KEY);
  } catch {
    // Stale generations are ignored because readers follow only the manifest.
  }
  return { ok: true, project };
}

export function clearBrowserProject(storage: Storage): void {
  for (const key of storageKeys(storage)) {
    if (key.startsWith(BROWSER_PROJECT_CHUNK_PREFIX)) storage.removeItem(key);
  }
  storage.removeItem(BROWSER_PROJECT_MANIFEST_KEY);
  storage.removeItem(BROWSER_PROJECT_KEY);
  storage.removeItem(LEGACY_DRAFT_KEY);
  storage.removeItem(BROWSER_MIGRATION_BACKUP_KEY);
}
