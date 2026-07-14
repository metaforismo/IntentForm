import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { demoGraph } from "@intentform/proof-report/demo";
import {
  parseGraph,
  stableSerialize,
  type SemanticInterfaceGraph,
} from "@intentform/semantic-schema";

const MAX_REVISIONS = 50;

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
    mkdirSync(dir, { recursive: true });
    const graph = structuredClone(demoGraph);
    writeFileSync(graphPath(dir), stableSerialize(graph), "utf8");
    return { graph, fingerprint: graphFingerprint(graph), seeded: true };
  }
  const graph = parseGraph(JSON.parse(readFileSync(graphPath(dir), "utf8")));
  return { graph, fingerprint: graphFingerprint(graph), seeded: false };
}

export function saveProject(
  dir: string,
  next: SemanticInterfaceGraph,
  reason: string,
): { revision: RevisionEntry | null; fingerprint: string } {
  const graph = parseGraph(next);
  mkdirSync(revisionsDir(dir), { recursive: true });

  let revision: RevisionEntry | null = null;
  if (existsSync(graphPath(dir))) {
    const current = readFileSync(graphPath(dir), "utf8");
    const currentGraph = parseGraph(JSON.parse(current));
    const currentFingerprint = graphFingerprint(currentGraph);
    if (currentFingerprint !== graphFingerprint(graph)) {
      const at = new Date().toISOString();
      const id = `${at.replace(/[:.]/g, "-")}-${currentFingerprint}`;
      writeFileSync(
        join(revisionsDir(dir), `${id}.json`),
        JSON.stringify({ at, reason, fingerprint: currentFingerprint, graph: currentGraph }, null, 2),
        "utf8",
      );
      revision = { id, at, reason, fingerprint: currentFingerprint };
      pruneRevisions(dir);
    }
  }

  writeFileSync(graphPath(dir), stableSerialize(graph), "utf8");
  return { revision, fingerprint: graphFingerprint(graph) };
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
