import {
  parseGraph,
  semanticInterfaceGraphSchema,
  type SemanticInterfaceGraph,
} from "@intentform/semantic-schema";
import { previewGraphMigration } from "@intentform/semantic-schema/migrations";
import { z } from "zod";

export const BROWSER_PROJECT_KEY = "intentform-browser-project-v1";
export const LEGACY_DRAFT_KEY = "intentform-project-draft-v1";
export const BROWSER_MIGRATION_BACKUP_KEY = "intentform-browser-migration-backup-v1";

export type ProjectType = "application" | "prototype" | "component-library";
export type ProjectSource = "created" | "example" | "imported" | "local" | "recovery";

const browserProjectSchema = z.strictObject({
  version: z.literal(1),
  graph: semanticInterfaceGraphSchema,
  savedAt: z.string().datetime(),
  projectType: z.enum(["application", "prototype", "component-library"]),
  source: z.enum(["created", "example", "imported", "local", "recovery"]),
  localFingerprint: z.string().regex(/^[a-f0-9]{8}$/).optional(),
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
  const parsed = browserProjectSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const location = issue?.path.length ? ` at ${issue.path.join(".")}` : "";
    return { status: "invalid", message: `The recovery project is invalid${location}: ${issue?.message ?? "schema validation failed"}.` };
  }
  return { status: "ready", project: parsed.data };
}

export function loadBrowserProject(storage: Storage): BrowserProjectLoadResult {
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
  try {
    const legacy = storage.getItem(LEGACY_DRAFT_KEY);
    if (legacy !== null && storage.getItem(BROWSER_MIGRATION_BACKUP_KEY) === null) {
      storage.setItem(BROWSER_MIGRATION_BACKUP_KEY, legacy);
    }
    storage.setItem(BROWSER_PROJECT_KEY, JSON.stringify(project));
    storage.removeItem(LEGACY_DRAFT_KEY);
    return { ok: true, project };
  } catch {
    return { ok: false, message: "This browser could not save the project for recovery." };
  }
}

export function clearBrowserProject(storage: Storage): void {
  storage.removeItem(BROWSER_PROJECT_KEY);
  storage.removeItem(LEGACY_DRAFT_KEY);
  storage.removeItem(BROWSER_MIGRATION_BACKUP_KEY);
}
