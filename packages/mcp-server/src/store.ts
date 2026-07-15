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

export function graphFingerprint(graph: SemanticInterfaceGraph): string {
  const input = stableSerialize(graph);
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

const graphPath = (dir: string) => join(dir, "graph.json");
const revisionsDir = (dir: string) => join(dir, "revisions");
const writeLockPath = (dir: string) => join(dir, ".write.lock");

export class ProjectConflictError extends Error {
  constructor(
    readonly expectedFingerprint: string | null,
    readonly currentFingerprint: string | null,
  ) {
    super("The local project changed after it was opened. Reopen it before saving so agent edits are not overwritten.");
    this.name = "ProjectConflictError";
  }
}

export class ProjectBusyError extends Error {
  constructor() {
    super("The local project is being saved by another process. Try again after that write finishes.");
    this.name = "ProjectBusyError";
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

function withProjectWriteLock<T>(dir: string, operation: () => T): T {
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

export function loadProject(dir: string): LoadedProject {
  if (!existsSync(graphPath(dir))) {
    return withProjectWriteLock(dir, () => {
      if (existsSync(graphPath(dir))) {
        const graph = parseGraph(JSON.parse(readFileSync(graphPath(dir), "utf8")));
        return { graph, fingerprint: graphFingerprint(graph), seeded: false };
      }
      const graph = structuredClone(demoGraph);
      writeFileAtomic(graphPath(dir), stableSerialize(graph));
      return { graph, fingerprint: graphFingerprint(graph), seeded: true };
    });
  }
  const graph = parseGraph(JSON.parse(readFileSync(graphPath(dir), "utf8")));
  return { graph, fingerprint: graphFingerprint(graph), seeded: false };
}

export function saveProject(
  dir: string,
  next: SemanticInterfaceGraph,
  reason: string,
  expectedFingerprint: string | null,
): { revision: RevisionEntry | null; fingerprint: string } {
  const graph = parseGraph(next);
  const nextFingerprint = graphFingerprint(graph);

  return withProjectWriteLock(dir, () => {
    mkdirSync(revisionsDir(dir), { recursive: true });
    const currentGraph = existsSync(graphPath(dir))
      ? parseGraph(JSON.parse(readFileSync(graphPath(dir), "utf8")))
      : null;
    const currentFingerprint = currentGraph ? graphFingerprint(currentGraph) : null;
    if (currentFingerprint !== expectedFingerprint) {
      throw new ProjectConflictError(expectedFingerprint, currentFingerprint);
    }
    if (currentFingerprint === nextFingerprint) {
      return { revision: null, fingerprint: nextFingerprint };
    }

    let revision: RevisionEntry | null = null;
    if (currentGraph && currentFingerprint) {
      const at = new Date().toISOString();
      const id = `${at.replace(/[:.]/g, "-")}-${currentFingerprint}`;
      writeFileAtomic(
        join(revisionsDir(dir), `${id}.json`),
        JSON.stringify({ at, reason, fingerprint: currentFingerprint, graph: currentGraph }, null, 2),
      );
      revision = { id, at, reason, fingerprint: currentFingerprint };
      pruneRevisions(dir);
    }

    writeFileAtomic(graphPath(dir), stableSerialize(graph));
    return { revision, fingerprint: nextFingerprint };
  });
}

function pruneRevisions(dir: string): void {
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
