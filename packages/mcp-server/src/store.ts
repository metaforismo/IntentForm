import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { demoGraph } from "@intentform/proof-report/demo";
import {
  parseGraph,
  stableSerialize,
  type SemanticInterfaceGraph,
} from "@intentform/semantic-schema";
import {
  GraphMigrationError,
  previewGraphMigration,
  type MigrationDiagnostic,
} from "@intentform/semantic-schema/migrations";
import {
  abortPreparedHistoryOperation,
  finalizeHistoryOperation,
  prepareHistoryOperation,
  type HistoryOperation,
  type HistoryAuthor,
  type HistoryProvenance,
} from "./history.ts";
import { graphFingerprint } from "./fingerprint.ts";

const MAX_REVISIONS = 50;
let temporaryFileSequence = 0;

/* `.intentform/` is the canonical on-disk project: agents (via MCP) and the
   Studio (via /api/project) read and write the same validated graph. */
export function resolveProjectDir(explicit?: string): string {
  if (explicit) return resolve(explicit);
  if (process.env.INTENTFORM_PROJECT_DIR) return resolve(process.env.INTENTFORM_PROJECT_DIR);
  let current = process.cwd();
  while (true) {
    if (existsSync(join(current, "pnpm-workspace.yaml"))) return join(current, ".intentform");
    const parent = dirname(current);
    if (parent === current) return join(process.cwd(), ".intentform");
    current = parent;
  }
}

const graphPath = (dir: string) => join(dir, "graph.json");
const revisionsDir = (dir: string) => join(dir, "revisions");
const migrationCheckpointsDir = (dir: string) => join(dir, "migration-checkpoints");
const writeLockPath = (dir: string) => join(dir, ".write.lock");

export class ProjectConflictError extends Error {
  readonly expectedFingerprint: string | null;
  readonly currentFingerprint: string | null;

  constructor(
    expectedFingerprint: string | null,
    currentFingerprint: string | null,
  ) {
    super("The local project changed after it was opened. Reopen it before saving so agent edits are not overwritten.");
    this.name = "ProjectConflictError";
    this.expectedFingerprint = expectedFingerprint;
    this.currentFingerprint = currentFingerprint;
  }
}

export class ProjectBusyError extends Error {
  constructor() {
    super("The local project is being saved by another process. Try again after that write finishes.");
    this.name = "ProjectBusyError";
  }
}

export interface ProjectMigrationSummary {
  status: "current" | "migration-required";
  sourceFingerprint: string;
  fromVersion: string;
  toVersion: string;
  diagnostics: MigrationDiagnostic[];
}

export class ProjectMigrationRequiredError extends Error {
  readonly migration: ProjectMigrationSummary;

  constructor(migration: ProjectMigrationSummary) {
    super(`Project schema ${migration.fromVersion} must be migrated to ${migration.toVersion} before it can be opened.`);
    this.name = "ProjectMigrationRequiredError";
    this.migration = migration;
  }
}

export class ProjectMigrationConflictError extends Error {
  readonly expectedSourceFingerprint: string;
  readonly currentSourceFingerprint: string;

  constructor(
    expectedSourceFingerprint: string,
    currentSourceFingerprint: string,
  ) {
    super("The project file changed after migration was previewed. Preview it again before applying a migration.");
    this.name = "ProjectMigrationConflictError";
    this.expectedSourceFingerprint = expectedSourceFingerprint;
    this.currentSourceFingerprint = currentSourceFingerprint;
  }
}

function acquireProjectWriteLock(dir: string): number {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return openSync(writeLockPath(dir), "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let ownerSource: string;
      try {
        ownerSource = readFileSync(writeLockPath(dir), "utf8");
      } catch (readError) {
        if ((readError as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw readError;
      }
      const owner = Number.parseInt(ownerSource.trim(), 10);
      if (!Number.isSafeInteger(owner) || owner <= 0) throw new ProjectBusyError();
      try {
        process.kill(owner, 0);
        throw new ProjectBusyError();
      } catch (ownerError) {
        if (ownerError instanceof ProjectBusyError) throw ownerError;
        if ((ownerError as NodeJS.ErrnoException).code !== "ESRCH") throw new ProjectBusyError();
        try {
          unlinkSync(writeLockPath(dir));
        } catch (unlinkError) {
          if ((unlinkError as NodeJS.ErrnoException).code !== "ENOENT") throw unlinkError;
        }
      }
    }
  }
  throw new ProjectBusyError();
}

export function withProjectWriteLock<T>(dir: string, operation: () => T): T {
  mkdirSync(dir, { recursive: true });
  const descriptor = acquireProjectWriteLock(dir);

  try {
    writeFileSync(descriptor, `${process.pid}\n`, "utf8");
    fsyncSync(descriptor);
    return operation();
  } finally {
    closeSync(descriptor);
    unlinkSync(writeLockPath(dir));
  }
}

function fsyncDirectory(dir: string): void {
  if (process.platform === "win32") return;
  const descriptor = openSync(dir, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function writeFileAtomic(path: string, content: string): void {
  const parent = dirname(path);
  mkdirSync(parent, { recursive: true });
  temporaryFileSequence += 1;
  const temporaryPath = join(parent, `.${process.pid}-${temporaryFileSequence}-${basename(path)}.tmp`);
  let descriptor: number | null = null;
  try {
    descriptor = openSync(temporaryPath, "wx", 0o600);
    writeFileSync(descriptor, content, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    renameSync(temporaryPath, path);
    fsyncDirectory(parent);
  } catch (error) {
    if (descriptor !== null) closeSync(descriptor);
    rmSync(temporaryPath, { force: true });
    throw error;
  }
}

export interface RevisionEntry {
  id: string;
  at: string;
  reason: string;
  fingerprint: string;
}

export interface LoadedProject {
  graph: SemanticInterfaceGraph;
  fingerprint: string;
  seeded: boolean;
}

interface InspectedProjectMigration extends ProjectMigrationSummary {
  graph: SemanticInterfaceGraph;
  canonical: string;
}

function textFingerprint(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function inspectProjectSource(source: string): InspectedProjectMigration {
  let input: unknown;
  try {
    input = JSON.parse(source);
  } catch {
    throw new GraphMigrationError([{
      severity: "error",
      code: "schema.input.invalid-json",
      path: "$",
      message: "The project graph file is not valid JSON.",
    }]);
  }
  const preview = previewGraphMigration(input);
  return {
    status: preview.changed ? "migration-required" : "current",
    sourceFingerprint: textFingerprint(source),
    fromVersion: preview.fromVersion,
    toVersion: preview.toVersion,
    diagnostics: preview.diagnostics,
    graph: preview.graph,
    canonical: preview.canonical,
  };
}

function requireCurrentProject(source: string): SemanticInterfaceGraph {
  const inspection = inspectProjectSource(source);
  if (inspection.status === "migration-required") {
    const { graph: _graph, canonical: _canonical, ...summary } = inspection;
    throw new ProjectMigrationRequiredError(summary);
  }
  return inspection.graph;
}

export function previewProjectMigration(dir: string): ProjectMigrationSummary | { status: "missing" } {
  if (!existsSync(graphPath(dir))) return { status: "missing" };
  const inspection = inspectProjectSource(readFileSync(graphPath(dir), "utf8"));
  const { graph: _graph, canonical: _canonical, ...summary } = inspection;
  return summary;
}

export interface AppliedProjectMigration extends ProjectMigrationSummary {
  checkpoint: string | null;
  graph: SemanticInterfaceGraph;
  fingerprint: string;
}

export function migrateProject(
  dir: string,
  expectedSourceFingerprint: string,
  author: HistoryAuthor = "system",
): AppliedProjectMigration {
  return withProjectWriteLock(dir, () => {
    if (!existsSync(graphPath(dir))) throw new Error("No local graph exists to migrate.");
    const source = readFileSync(graphPath(dir), "utf8");
    const inspection = inspectProjectSource(source);
    if (inspection.sourceFingerprint !== expectedSourceFingerprint) {
      throw new ProjectMigrationConflictError(expectedSourceFingerprint, inspection.sourceFingerprint);
    }

    let checkpoint: string | null = null;
    if (inspection.status === "migration-required") {
      const at = new Date().toISOString();
      const id = `${at.replace(/[:.]/g, "-")}-${inspection.sourceFingerprint}`;
      checkpoint = join(migrationCheckpointsDir(dir), `${id}.json`);
      writeFileAtomic(checkpoint, source);
      const fingerprint = graphFingerprint(inspection.graph);
      const preparedHistory = prepareHistoryOperation(
        dir,
        null,
        null,
        inspection.graph,
        fingerprint,
        `migrate schema ${inspection.fromVersion} to ${inspection.toVersion}`,
        { author, kind: "save", sourceId: `${inspection.fromVersion}->${inspection.toVersion}` },
      );
      try {
        writeFileAtomic(graphPath(dir), inspection.canonical);
        finalizeHistoryOperation(dir, preparedHistory);
      } catch (error) {
        writeFileAtomic(graphPath(dir), source);
        abortPreparedHistoryOperation(dir, preparedHistory);
        if (checkpoint) rmSync(checkpoint, { force: true });
        throw error;
      }
    }

    const { graph: _graph, canonical: _canonical, ...summary } = inspection;
    return {
      ...summary,
      status: "current",
      checkpoint,
      graph: inspection.graph,
      fingerprint: graphFingerprint(inspection.graph),
    };
  });
}

export function loadProject(dir: string): LoadedProject {
  if (!existsSync(graphPath(dir))) {
    return withProjectWriteLock(dir, () => {
      if (existsSync(graphPath(dir))) {
        const graph = requireCurrentProject(readFileSync(graphPath(dir), "utf8"));
        return { graph, fingerprint: graphFingerprint(graph), seeded: false };
      }
      const graph = structuredClone(demoGraph);
      const fingerprint = graphFingerprint(graph);
      const preparedHistory = prepareHistoryOperation(
        dir,
        null,
        null,
        graph,
        fingerprint,
        "seed verified sample project",
        { author: "system" },
      );
      try {
        writeFileAtomic(graphPath(dir), stableSerialize(graph));
        finalizeHistoryOperation(dir, preparedHistory);
      } catch (error) {
        rmSync(graphPath(dir), { force: true });
        abortPreparedHistoryOperation(dir, preparedHistory);
        throw error;
      }
      return { graph, fingerprint, seeded: true };
    });
  }
  const graph = requireCurrentProject(readFileSync(graphPath(dir), "utf8"));
  return { graph, fingerprint: graphFingerprint(graph), seeded: false };
}

export function saveProject(
  dir: string,
  next: SemanticInterfaceGraph,
  reason: string,
  expectedFingerprint: string | null,
  provenance: HistoryProvenance = { author: "system", kind: "save" },
): { revision: RevisionEntry | null; fingerprint: string; operation: HistoryOperation | null } {
  const graph = parseGraph(next);
  const nextFingerprint = graphFingerprint(graph);

  return withProjectWriteLock(dir, () => {
    const currentGraph = existsSync(graphPath(dir))
      ? requireCurrentProject(readFileSync(graphPath(dir), "utf8"))
      : null;
    const currentFingerprint = currentGraph ? graphFingerprint(currentGraph) : null;
    if (currentFingerprint !== expectedFingerprint) {
      throw new ProjectConflictError(expectedFingerprint, currentFingerprint);
    }
    if (currentFingerprint === nextFingerprint) {
      return { revision: null, fingerprint: nextFingerprint, operation: null };
    }

    const preparedHistory = prepareHistoryOperation(
      dir,
      currentGraph,
      currentFingerprint,
      graph,
      nextFingerprint,
      reason,
      provenance,
    );
    let revision: RevisionEntry | null = null;
    let revisionPath: string | null = null;
    let operation: HistoryOperation;
    let graphWritten = false;
    try {
      if (currentGraph && currentFingerprint) {
        const at = new Date().toISOString();
        const id = `${at.replace(/[:.]/g, "-")}-${currentFingerprint}`;
        revisionPath = join(revisionsDir(dir), `${id}.json`);
        writeFileAtomic(
          revisionPath,
          JSON.stringify({ at, reason, fingerprint: currentFingerprint, graph: currentGraph }, null, 2),
        );
        revision = { id, at, reason, fingerprint: currentFingerprint };
      }
      writeFileAtomic(graphPath(dir), stableSerialize(graph));
      graphWritten = true;
      operation = finalizeHistoryOperation(dir, preparedHistory);
      try {
        pruneRevisions(dir);
      } catch {
        // Retaining an extra rollback snapshot is safe; a later save retries pruning.
      }
    } catch (error) {
      if (graphWritten) {
        if (currentGraph) writeFileAtomic(graphPath(dir), stableSerialize(currentGraph));
        else rmSync(graphPath(dir), { force: true });
      }
      abortPreparedHistoryOperation(dir, preparedHistory);
      if (revisionPath) rmSync(revisionPath, { force: true });
      throw error;
    }
    return { revision, fingerprint: nextFingerprint, operation };
  });
}

function pruneRevisions(dir: string): void {
  if (!existsSync(revisionsDir(dir))) return;
  const entries = readdirSync(revisionsDir(dir)).filter((file) => file.endsWith(".json")).sort();
  for (const stale of entries.slice(0, Math.max(0, entries.length - MAX_REVISIONS))) {
    rmSync(join(revisionsDir(dir), stale), { force: true });
  }
}

export function listRevisions(dir: string): RevisionEntry[] {
  if (!existsSync(revisionsDir(dir))) return [];
  return readdirSync(revisionsDir(dir))
    .filter((file) => file.endsWith(".json"))
    .sort()
    .reverse()
    .map((file) => {
      const parsed = JSON.parse(readFileSync(join(revisionsDir(dir), file), "utf8")) as {
        at: string;
        reason: string;
        fingerprint: string;
      };
      return { id: file.replace(/\.json$/, ""), at: parsed.at, reason: parsed.reason, fingerprint: parsed.fingerprint };
    });
}

export function loadRevisionGraph(dir: string, revisionId: string): SemanticInterfaceGraph {
  const file = join(revisionsDir(dir), `${revisionId.replace(/[^a-zA-Z0-9-]/g, "")}.json`);
  if (!existsSync(file)) throw new Error(`Unknown revision: ${revisionId}`);
  const parsed = JSON.parse(readFileSync(file, "utf8")) as { graph: unknown };
  return parseGraph(parsed.graph);
}

export { graphFingerprint } from "./fingerprint.ts";
