import { createHash, randomUUID } from "node:crypto";
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
import { basename, dirname, join } from "node:path";
import {
  applyGraphPatch,
  graphPatchSchema,
  parseGraph,
  semanticDiff,
  type SemanticInterfaceGraph,
} from "@intentform/semantic-schema";
import { graphFingerprint } from "./fingerprint.ts";
import {
  semanticThreeWayMerge,
  type MergeConflict,
  type SemanticMergeResult,
} from "./semantic-merge.ts";

export const MAX_HISTORY_OPERATIONS = 200;
const HISTORY_VERSION = 1 as const;
const BRANCH_NAME = /^[a-z][a-z0-9-]{0,62}$/;
const OPERATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CHECKPOINT_FILE = /^[a-f0-9]{8}-[a-f0-9]{16}\.json$/;
let temporaryFileSequence = 0;

export type HistoryAuthor = "human" | "agent" | "system";
export type HistoryOperationKind = "seed" | "save" | "branch-create" | "branch-edit" | "merge" | "cherry-pick" | "revert";

export interface HistoryProvenance {
  author: HistoryAuthor;
  kind?: HistoryOperationKind;
  sourceId?: string;
}

export interface HistoryOperation {
  version: 1;
  id: string;
  sequence: number;
  at: string;
  branch: string;
  kind: HistoryOperationKind;
  author: HistoryAuthor;
  reason: string;
  parentOperationId: string | null;
  sourceId: string | null;
  baseFingerprint: string | null;
  resultFingerprint: string;
  baseCheckpoint: string | null;
  resultCheckpoint: string;
  changes: HistoryChange[];
  checksum: string;
}

export interface HistoryChange {
  path: string;
  before: unknown | null;
  after: unknown | null;
  beforeMissing: boolean;
  afterMissing: boolean;
}

export interface HistoryBranch {
  name: string;
  createdAt: string;
  updatedAt: string;
  baseOperationId: string | null;
  baseFingerprint: string;
  baseCheckpoint: string;
  headOperationId: string | null;
  headFingerprint: string;
  headCheckpoint: string;
}

export interface HistoryManifest {
  version: 1;
  sequence: number;
  currentBranch: "main";
  compactedBeforeSequence: number | null;
  branches: Record<string, HistoryBranch>;
}

export interface PreparedHistoryOperation {
  baseSequence: number;
  manifest: HistoryManifest;
  operation: HistoryOperation;
  operationFile: string;
}

export class HistoryIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HistoryIntegrityError";
  }
}

export class HistoryConflictError extends Error {
  readonly conflicts: MergeConflict[];

  constructor(conflicts: MergeConflict[]) {
    super(`Semantic merge requires review for ${conflicts.length} conflicting path${conflicts.length === 1 ? "" : "s"}.`);
    this.name = "HistoryConflictError";
    this.conflicts = conflicts;
  }
}

const historyDir = (projectDir: string) => join(projectDir, "history");
const manifestPath = (projectDir: string) => join(historyDir(projectDir), "manifest.json");
const operationsDir = (projectDir: string) => join(historyDir(projectDir), "operations");
const checkpointsDir = (projectDir: string) => join(historyDir(projectDir), "checkpoints");

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const input = value as Record<string, unknown>;
  return `{${Object.keys(input).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(input[key])}`).join(",")}}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function writePrivateFileAtomic(path: string, content: string): void {
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
    if (process.platform !== "win32") {
      const parentDescriptor = openSync(parent, "r");
      try {
        fsyncSync(parentDescriptor);
      } finally {
        closeSync(parentDescriptor);
      }
    }
  } catch (error) {
    if (descriptor !== null) closeSync(descriptor);
    rmSync(temporaryPath, { force: true });
    throw error;
  }
}

function safeBranchName(name: string): string {
  if (!BRANCH_NAME.test(name) || name === "main") {
    throw new Error("Branch names must start with a lowercase letter, contain only lowercase letters, numbers or hyphens, be at most 63 characters, and not be 'main'.");
  }
  return name;
}

function operationPayload(operation: Omit<HistoryOperation, "checksum">): Omit<HistoryOperation, "checksum"> {
  return operation;
}

function withChecksum(operation: Omit<HistoryOperation, "checksum">): HistoryOperation {
  return { ...operation, checksum: sha256(canonicalJson(operation)) };
}

function validateOperation(input: unknown): HistoryOperation {
  if (!input || typeof input !== "object") throw new HistoryIntegrityError("A history operation is not an object.");
  const operation = input as Partial<HistoryOperation>;
  const { checksum, ...payload } = operation;
  if (operation.version !== HISTORY_VERSION
    || typeof operation.id !== "string" || !OPERATION_ID.test(operation.id)
    || !Number.isSafeInteger(operation.sequence) || (operation.sequence ?? 0) < 1
    || typeof operation.at !== "string"
    || typeof operation.branch !== "string" || (operation.branch !== "main" && !BRANCH_NAME.test(operation.branch))
    || !["seed", "save", "branch-create", "branch-edit", "merge", "cherry-pick", "revert"].includes(operation.kind ?? "")
    || !["human", "agent", "system"].includes(operation.author ?? "")
    || typeof operation.reason !== "string" || operation.reason.length < 1 || operation.reason.length > 160
    || (operation.parentOperationId !== null && (typeof operation.parentOperationId !== "string" || !OPERATION_ID.test(operation.parentOperationId)))
    || (operation.sourceId !== null && (typeof operation.sourceId !== "string" || operation.sourceId.length > 160))
    || (operation.baseFingerprint !== null && (typeof operation.baseFingerprint !== "string" || !/^[a-f0-9]{8}$/.test(operation.baseFingerprint)))
    || !/^[a-f0-9]{8}$/.test(operation.resultFingerprint ?? "")
    || (operation.baseCheckpoint !== null && (typeof operation.baseCheckpoint !== "string" || !CHECKPOINT_FILE.test(operation.baseCheckpoint)))
    || typeof operation.resultCheckpoint !== "string" || !CHECKPOINT_FILE.test(operation.resultCheckpoint)
    || !Array.isArray(operation.changes)
    || !operation.changes.every((change) => (
      Boolean(change) && typeof change === "object"
      && typeof (change as Partial<HistoryChange>).path === "string"
      && Object.hasOwn(change as object, "before")
      && Object.hasOwn(change as object, "after")
      && typeof (change as Partial<HistoryChange>).beforeMissing === "boolean"
      && typeof (change as Partial<HistoryChange>).afterMissing === "boolean"
    ))
    || typeof checksum !== "string" || checksum !== sha256(canonicalJson(payload))) {
    throw new HistoryIntegrityError(`History operation ${String(operation.id ?? "unknown")} failed integrity validation.`);
  }
  return input as HistoryOperation;
}

function validateBranch(input: unknown, key: string): HistoryBranch {
  if (!input || typeof input !== "object") throw new HistoryIntegrityError(`History branch ${key} is malformed.`);
  const branch = input as Partial<HistoryBranch>;
  const validName = key === "main" ? branch.name === "main" : branch.name === key && BRANCH_NAME.test(key);
  if (!validName
    || typeof branch.createdAt !== "string" || typeof branch.updatedAt !== "string"
    || (branch.baseOperationId !== null && (typeof branch.baseOperationId !== "string" || !OPERATION_ID.test(branch.baseOperationId)))
    || !/^[a-f0-9]{8}$/.test(branch.baseFingerprint ?? "") || !CHECKPOINT_FILE.test(branch.baseCheckpoint ?? "")
    || (branch.headOperationId !== null && (typeof branch.headOperationId !== "string" || !OPERATION_ID.test(branch.headOperationId)))
    || !/^[a-f0-9]{8}$/.test(branch.headFingerprint ?? "") || !CHECKPOINT_FILE.test(branch.headCheckpoint ?? "")) {
    throw new HistoryIntegrityError(`History branch ${key} failed integrity validation.`);
  }
  return branch as HistoryBranch;
}

function readManifest(projectDir: string): HistoryManifest | null {
  if (!existsSync(manifestPath(projectDir))) return null;
  let input: unknown;
  try {
    input = JSON.parse(readFileSync(manifestPath(projectDir), "utf8"));
  } catch {
    throw new HistoryIntegrityError("The history manifest is not valid JSON.");
  }
  if (!input || typeof input !== "object") throw new HistoryIntegrityError("The history manifest is malformed.");
  const manifest = input as Partial<HistoryManifest>;
  if (manifest.version !== HISTORY_VERSION
    || !Number.isSafeInteger(manifest.sequence) || (manifest.sequence ?? -1) < 0
    || manifest.currentBranch !== "main"
    || (manifest.compactedBeforeSequence !== null && (!Number.isSafeInteger(manifest.compactedBeforeSequence) || (manifest.compactedBeforeSequence ?? -1) < 1))
    || !manifest.branches || typeof manifest.branches !== "object" || Array.isArray(manifest.branches)) {
    throw new HistoryIntegrityError("The history manifest failed integrity validation.");
  }
  const branches = Object.fromEntries(Object.entries(manifest.branches).map(([name, branch]) => [name, validateBranch(branch, name)]));
  if (!branches.main) throw new HistoryIntegrityError("The history manifest has no main branch.");
  return { ...manifest, branches } as HistoryManifest;
}

function checkpointGraph(projectDir: string, file: string): SemanticInterfaceGraph {
  if (!CHECKPOINT_FILE.test(file)) throw new HistoryIntegrityError("A history checkpoint path is invalid.");
  const path = join(checkpointsDir(projectDir), file);
  if (!existsSync(path)) throw new HistoryIntegrityError(`History checkpoint ${file} is missing.`);
  const source = readFileSync(path, "utf8");
  const digest = file.slice(9, 25);
  if (sha256(source).slice(0, 16) !== digest) throw new HistoryIntegrityError(`History checkpoint ${file} failed its content digest.`);
  try {
    const graph = parseGraph(JSON.parse(source));
    if (graphFingerprint(graph) !== file.slice(0, 8)) throw new Error("fingerprint mismatch");
    return graph;
  } catch {
    throw new HistoryIntegrityError(`History checkpoint ${file} is not a valid graph.`);
  }
}

function writeCheckpoint(projectDir: string, graph: SemanticInterfaceGraph, fingerprint: string): string {
  const source = `${JSON.stringify(graph, null, 2)}\n`;
  const file = `${fingerprint}-${sha256(source).slice(0, 16)}.json`;
  if (!existsSync(join(checkpointsDir(projectDir), file))) {
    writePrivateFileAtomic(join(checkpointsDir(projectDir), file), source);
  }
  return file;
}

function operationFilename(operation: HistoryOperation): string {
  return `${String(operation.sequence).padStart(10, "0")}-${operation.id}.json`;
}

function listOperationFiles(projectDir: string): string[] {
  if (!existsSync(operationsDir(projectDir))) return [];
  return readdirSync(operationsDir(projectDir)).filter((file) => /^\d{10}-[0-9a-f-]{36}\.json$/i.test(file)).sort();
}

function removeUnreferencedCheckpoints(projectDir: string, candidates: Array<string | null>): void {
  try {
    const referenced = new Set<string>();
    const manifest = readManifest(projectDir);
    for (const branch of Object.values(manifest?.branches ?? {})) {
      referenced.add(branch.baseCheckpoint);
      referenced.add(branch.headCheckpoint);
    }
    for (const file of listOperationFiles(projectDir)) {
      const operation = readOperationFile(projectDir, file);
      if (operation.baseCheckpoint) referenced.add(operation.baseCheckpoint);
      referenced.add(operation.resultCheckpoint);
    }
    for (const checkpoint of candidates) {
      if (checkpoint && !referenced.has(checkpoint)) rmSync(join(checkpointsDir(projectDir), checkpoint), { force: true });
    }
  } catch {
    // Never delete checkpoint evidence when reference integrity is uncertain.
  }
}

function readOperationFile(projectDir: string, file: string): HistoryOperation {
  let input: unknown;
  try {
    input = JSON.parse(readFileSync(join(operationsDir(projectDir), basename(file)), "utf8"));
  } catch {
    throw new HistoryIntegrityError(`History operation file ${basename(file)} is not valid JSON.`);
  }
  const operation = validateOperation(input);
  if (operationFilename(operation) !== basename(file)) throw new HistoryIntegrityError(`History operation file ${basename(file)} does not match its contents.`);
  return operation;
}

function defaultManifest(): HistoryManifest {
  return { version: HISTORY_VERSION, sequence: 0, currentBranch: "main", compactedBeforeSequence: null, branches: {} };
}

function cleanSourceId(sourceId: string | undefined): string | null {
  if (!sourceId) return null;
  const value = sourceId.trim();
  if (!value || value.length > 160 || /[\u0000-\u001f]/.test(value)) throw new Error("History source identifiers must be 1–160 printable characters.");
  return value;
}

function historyChanges(before: SemanticInterfaceGraph, after: SemanticInterfaceGraph): HistoryChange[] {
  return semanticDiff(before, after).map((change) => ({
    path: change.path,
    before: change.before === undefined ? null : change.before,
    after: change.after === undefined ? null : change.after,
    beforeMissing: change.before === undefined,
    afterMissing: change.after === undefined,
  }));
}

export function prepareHistoryOperation(
  projectDir: string,
  before: SemanticInterfaceGraph | null,
  beforeFingerprint: string | null,
  after: SemanticInterfaceGraph,
  afterFingerprint: string,
  reason: string,
  provenance: HistoryProvenance,
  branchName = "main",
): PreparedHistoryOperation {
  const normalizedReason = reason.trim();
  if (!normalizedReason || normalizedReason.length > 160) throw new Error("History reasons must be 1–160 characters.");
  const manifest = readManifest(projectDir) ?? defaultManifest();
  const branch = manifest.branches[branchName];
  if (branchName !== "main" && !branch) throw new Error(`Unknown history branch: ${branchName}`);
  if (branch && beforeFingerprint !== null && branch.headFingerprint !== beforeFingerprint) {
    throw new HistoryIntegrityError(`History branch ${branchName} head ${branch.headFingerprint} does not match graph ${beforeFingerprint}; recover before writing.`);
  }
  const baseCheckpoint = before && beforeFingerprint ? writeCheckpoint(projectDir, before, beforeFingerprint) : null;
  const resultCheckpoint = writeCheckpoint(projectDir, after, afterFingerprint);
  const sequence = manifest.sequence + 1;
  const operation = withChecksum(operationPayload({
    version: HISTORY_VERSION,
    id: randomUUID(),
    sequence,
    at: new Date().toISOString(),
    branch: branchName,
    kind: provenance.kind ?? (before ? "save" : "seed"),
    author: provenance.author,
    reason: normalizedReason,
    parentOperationId: branch?.headOperationId ?? null,
    sourceId: cleanSourceId(provenance.sourceId),
    baseFingerprint: beforeFingerprint,
    resultFingerprint: afterFingerprint,
    baseCheckpoint,
    resultCheckpoint,
    changes: before ? historyChanges(before, after) : [],
  }));
  const operationFile = operationFilename(operation);
  writePrivateFileAtomic(join(operationsDir(projectDir), operationFile), `${JSON.stringify(operation, null, 2)}\n`);
  return { baseSequence: manifest.sequence, manifest, operation, operationFile };
}

export function abortPreparedHistoryOperation(projectDir: string, prepared: PreparedHistoryOperation): void {
  try {
    const current = readManifest(projectDir);
    if ((current?.sequence ?? 0) === prepared.baseSequence) {
      rmSync(join(operationsDir(projectDir), prepared.operationFile), { force: true });
      removeUnreferencedCheckpoints(projectDir, [prepared.operation.baseCheckpoint, prepared.operation.resultCheckpoint]);
    }
  } catch {
    // Recovery will quarantine an unreferenced staged operation if metadata is damaged.
  }
}

function compactHistory(projectDir: string, manifest: HistoryManifest): HistoryManifest {
  const files = listOperationFiles(projectDir);
  if (files.length <= MAX_HISTORY_OPERATIONS) return manifest;
  const protectedIds = new Set(Object.values(manifest.branches).flatMap((branch) => [branch.baseOperationId, branch.headOperationId]).filter(Boolean));
  const keep = new Set(files.slice(-MAX_HISTORY_OPERATIONS));
  for (const file of files) {
    const id = file.slice(11, -5);
    if (protectedIds.has(id)) keep.add(file);
  }
  const stale = files.filter((file) => !keep.has(file));
  const compactedBeforeSequence = stale.reduce((maximum, file) => Math.max(maximum, Number.parseInt(file.slice(0, 10), 10)), manifest.compactedBeforeSequence ?? 0);
  const next = compactedBeforeSequence > 0 ? { ...manifest, compactedBeforeSequence } : manifest;
  const referencedCheckpoints = new Set<string>();
  for (const branch of Object.values(next.branches)) {
    referencedCheckpoints.add(branch.baseCheckpoint);
    referencedCheckpoints.add(branch.headCheckpoint);
  }
  for (const file of keep) {
    try {
      const operation = readOperationFile(projectDir, file);
      if (operation.baseCheckpoint) referencedCheckpoints.add(operation.baseCheckpoint);
      referencedCheckpoints.add(operation.resultCheckpoint);
    } catch {
      // Integrity inspection reports retained corrupt files; compaction never hides them.
    }
  }
  try {
    for (const file of stale) unlinkSync(join(operationsDir(projectDir), file));
    if (existsSync(checkpointsDir(projectDir))) {
      for (const file of readdirSync(checkpointsDir(projectDir)).filter((entry) => CHECKPOINT_FILE.test(entry))) {
        if (!referencedCheckpoints.has(file)) unlinkSync(join(checkpointsDir(projectDir), file));
      }
    }
  } catch {
    // Retaining stale immutable files is safe; future compaction can retry.
  }
  return next;
}

export function finalizeHistoryOperation(projectDir: string, prepared: PreparedHistoryOperation): HistoryOperation {
  const current = readManifest(projectDir) ?? defaultManifest();
  if (current.sequence !== prepared.baseSequence) throw new HistoryIntegrityError("History changed while an operation was being committed.");
  const operation = prepared.operation;
  const priorBranch = current.branches[operation.branch];
  const baseCheckpoint = priorBranch?.baseCheckpoint ?? operation.baseCheckpoint ?? operation.resultCheckpoint;
  const baseFingerprint = priorBranch?.baseFingerprint ?? operation.baseFingerprint ?? operation.resultFingerprint;
  const branch: HistoryBranch = {
    name: operation.branch,
    createdAt: priorBranch?.createdAt ?? operation.at,
    updatedAt: operation.at,
    baseOperationId: priorBranch ? priorBranch.baseOperationId : operation.parentOperationId,
    baseFingerprint,
    baseCheckpoint,
    headOperationId: operation.id,
    headFingerprint: operation.resultFingerprint,
    headCheckpoint: operation.resultCheckpoint,
  };
  let next: HistoryManifest = {
    ...current,
    sequence: operation.sequence,
    branches: { ...current.branches, [operation.branch]: branch },
  };
  writePrivateFileAtomic(manifestPath(projectDir), `${JSON.stringify(next, null, 2)}\n`);
  try {
    const compacted = compactHistory(projectDir, next);
    if (compacted.compactedBeforeSequence !== next.compactedBeforeSequence) {
      next = compacted;
      writePrivateFileAtomic(manifestPath(projectDir), `${JSON.stringify(next, null, 2)}\n`);
    }
  } catch {
    // The committed manifest and graph remain authoritative; compaction retries later.
  }
  return operation;
}

export function createHistoryBranch(
  projectDir: string,
  nameInput: string,
  graph: SemanticInterfaceGraph,
  fingerprint: string,
  author: HistoryAuthor,
): HistoryOperation {
  const name = safeBranchName(nameInput.trim());
  const manifest = readManifest(projectDir) ?? defaultManifest();
  if (manifest.branches[name]) throw new Error(`History branch already exists: ${name}`);
  const main = manifest.branches.main;
  if (main && main.headFingerprint !== fingerprint) {
    throw new HistoryIntegrityError(`Main history head ${main.headFingerprint} does not match graph ${fingerprint}; recover before branching.`);
  }
  const checkpoint = writeCheckpoint(projectDir, graph, fingerprint);
  const at = new Date().toISOString();
  const operation = withChecksum(operationPayload({
    version: HISTORY_VERSION,
    id: randomUUID(),
    sequence: manifest.sequence + 1,
    at,
    branch: name,
    kind: "branch-create",
    author,
    reason: `create branch ${name}`,
    parentOperationId: main?.headOperationId ?? null,
    sourceId: null,
    baseFingerprint: fingerprint,
    resultFingerprint: fingerprint,
    baseCheckpoint: checkpoint,
    resultCheckpoint: checkpoint,
    changes: [],
  }));
  const operationFile = operationFilename(operation);
  writePrivateFileAtomic(join(operationsDir(projectDir), operationFile), `${JSON.stringify(operation, null, 2)}\n`);
  const branch: HistoryBranch = {
    name,
    createdAt: at,
    updatedAt: at,
    baseOperationId: main?.headOperationId ?? null,
    baseFingerprint: fingerprint,
    baseCheckpoint: checkpoint,
    headOperationId: operation.id,
    headFingerprint: fingerprint,
    headCheckpoint: checkpoint,
  };
  const mainBranch: HistoryBranch = main ?? {
    name: "main",
    createdAt: at,
    updatedAt: at,
    baseOperationId: null,
    baseFingerprint: fingerprint,
    baseCheckpoint: checkpoint,
    headOperationId: null,
    headFingerprint: fingerprint,
    headCheckpoint: checkpoint,
  };
  let next: HistoryManifest = { ...manifest, sequence: operation.sequence, branches: { ...manifest.branches, main: mainBranch, [name]: branch } };
  try {
    writePrivateFileAtomic(manifestPath(projectDir), `${JSON.stringify(next, null, 2)}\n`);
  } catch (error) {
    rmSync(join(operationsDir(projectDir), operationFile), { force: true });
    removeUnreferencedCheckpoints(projectDir, [checkpoint]);
    throw error;
  }
  try {
    const compacted = compactHistory(projectDir, next);
    if (compacted.compactedBeforeSequence !== next.compactedBeforeSequence) {
      next = compacted;
      writePrivateFileAtomic(manifestPath(projectDir), `${JSON.stringify(next, null, 2)}\n`);
    }
  } catch {
    // The branch creation is committed; stale immutable files are harmless.
  }
  return operation;
}

export function applyHistoryBranchPatch(
  projectDir: string,
  nameInput: string,
  patchInput: unknown,
  expectedFingerprint: string,
  author: HistoryAuthor,
): { operation: HistoryOperation; graph: SemanticInterfaceGraph; fingerprint: string; changes: HistoryChange[] } {
  const name = safeBranchName(nameInput.trim());
  const manifest = readManifest(projectDir);
  const branch = manifest?.branches[name];
  if (!branch) throw new Error(`Unknown history branch: ${name}`);
  if (branch.headFingerprint !== expectedFingerprint) {
    throw new Error(`Branch fingerprint conflict: expected ${expectedFingerprint}, current ${branch.headFingerprint}.`);
  }
  const before = checkpointGraph(projectDir, branch.headCheckpoint);
  const patch = graphPatchSchema.parse(patchInput);
  const after = applyGraphPatch(before, patch);
  const fingerprint = graphFingerprint(after);
  if (fingerprint === branch.headFingerprint) throw new Error("The branch patch does not change the graph.");
  const prepared = prepareHistoryOperation(
    projectDir,
    before,
    branch.headFingerprint,
    after,
    fingerprint,
    patch.rationale || `patch ${patch.id}`,
    { author, kind: "branch-edit", sourceId: patch.id },
    name,
  );
  let operation: HistoryOperation;
  try {
    operation = finalizeHistoryOperation(projectDir, prepared);
  } catch (error) {
    abortPreparedHistoryOperation(projectDir, prepared);
    throw error;
  }
  return { operation, graph: after, fingerprint, changes: operation.changes };
}

export function deleteHistoryBranch(projectDir: string, nameInput: string): HistoryManifest {
  const name = safeBranchName(nameInput.trim());
  const manifest = readManifest(projectDir);
  if (!manifest?.branches[name]) throw new Error(`Unknown history branch: ${name}`);
  const branches = { ...manifest.branches };
  delete branches[name];
  const next = { ...manifest, branches };
  writePrivateFileAtomic(manifestPath(projectDir), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

export function previewHistoryBranchMerge(
  projectDir: string,
  current: SemanticInterfaceGraph,
  currentFingerprint: string,
  nameInput: string,
): SemanticMergeResult & { branch: HistoryBranch; currentFingerprint: string; previewFingerprint: string } {
  const name = safeBranchName(nameInput.trim());
  const manifest = readManifest(projectDir);
  const branch = manifest?.branches[name];
  if (!branch) throw new Error(`Unknown history branch: ${name}`);
  const base = checkpointGraph(projectDir, branch.baseCheckpoint);
  const theirs = checkpointGraph(projectDir, branch.headCheckpoint);
  const result = semanticThreeWayMerge(base, current, theirs);
  return { ...result, branch, currentFingerprint, previewFingerprint: graphFingerprint(result.graph) };
}

export function loadHistoryOperation(projectDir: string, operationId: string): HistoryOperation {
  if (!OPERATION_ID.test(operationId)) throw new Error("History operation id is invalid.");
  const file = listOperationFiles(projectDir).find((entry) => entry.endsWith(`-${operationId}.json`));
  if (!file) throw new Error(`Unknown or compacted history operation: ${operationId}`);
  return readOperationFile(projectDir, file);
}

export function previewHistoryOperationTransform(
  projectDir: string,
  current: SemanticInterfaceGraph,
  currentFingerprint: string,
  operationId: string,
  direction: "cherry-pick" | "revert",
): SemanticMergeResult & { operation: HistoryOperation; currentFingerprint: string; previewFingerprint: string } {
  const operation = loadHistoryOperation(projectDir, operationId);
  if (!operation.baseCheckpoint) throw new Error("The selected operation has no reversible base checkpoint.");
  const base = checkpointGraph(projectDir, operation.baseCheckpoint);
  const result = checkpointGraph(projectDir, operation.resultCheckpoint);
  const merge = direction === "cherry-pick"
    ? semanticThreeWayMerge(base, current, result)
    : semanticThreeWayMerge(result, current, base);
  return { ...merge, operation, currentFingerprint, previewFingerprint: graphFingerprint(merge.graph) };
}

export function inspectOperationHistory(projectDir: string, currentFingerprint: string) {
  try {
    const manifest = readManifest(projectDir);
    if (!manifest) {
      return {
        version: HISTORY_VERSION,
        integrity: "valid" as const,
        currentFingerprint,
        compactedBeforeSequence: null,
        branches: [],
        operations: [],
        diagnostics: [],
      };
    }
    const files = listOperationFiles(projectDir);
    const operations = files
      .slice(-MAX_HISTORY_OPERATIONS)
      .reverse()
      .map((file) => readOperationFile(projectDir, file))
      .filter((operation) => operation.sequence <= manifest.sequence);
    for (const operation of operations) {
      if (operation.baseCheckpoint) checkpointGraph(projectDir, operation.baseCheckpoint);
      checkpointGraph(projectDir, operation.resultCheckpoint);
    }
    for (const branch of Object.values(manifest.branches)) {
      checkpointGraph(projectDir, branch.baseCheckpoint);
      checkpointGraph(projectDir, branch.headCheckpoint);
    }
    const main = manifest.branches.main!;
    const diagnostics = main.headFingerprint === currentFingerprint
      ? []
      : [`Main history head ${main.headFingerprint} does not match graph ${currentFingerprint}; recover before writing.`];
    return {
      version: HISTORY_VERSION,
      integrity: diagnostics.length === 0 ? "valid" as const : "needs-recovery" as const,
      currentFingerprint,
      compactedBeforeSequence: manifest.compactedBeforeSequence,
      branches: Object.values(manifest.branches).sort((left, right) => left.name.localeCompare(right.name)),
      operations,
      diagnostics,
    };
  } catch (error) {
    return {
      version: HISTORY_VERSION,
      integrity: "needs-recovery" as const,
      currentFingerprint,
      compactedBeforeSequence: null,
      branches: [],
      operations: [],
      diagnostics: [error instanceof Error ? error.message : "Operation history failed integrity validation."],
    };
  }
}

export function recoverOperationHistory(
  projectDir: string,
  graph: SemanticInterfaceGraph,
  fingerprint: string,
): ReturnType<typeof inspectOperationHistory> {
  const invalidFiles: string[] = [];
  const valid = listOperationFiles(projectDir).flatMap((file) => {
    try {
      const operation = readOperationFile(projectDir, file);
      if (operation.baseCheckpoint) checkpointGraph(projectDir, operation.baseCheckpoint);
      checkpointGraph(projectDir, operation.resultCheckpoint);
      return [operation];
    } catch {
      invalidFiles.push(file);
      return [];
    }
  });
  const matching = valid.filter((operation) => operation.branch === "main" && operation.resultFingerprint === fingerprint).sort((left, right) => right.sequence - left.sequence)[0];
  const checkpoint = writeCheckpoint(projectDir, graph, fingerprint);
  const at = new Date().toISOString();
  const manifest: HistoryManifest = {
    version: HISTORY_VERSION,
    sequence: Math.max(0, ...valid.map((operation) => operation.sequence)),
    currentBranch: "main",
    compactedBeforeSequence: null,
    branches: {
      main: {
        name: "main",
        createdAt: matching?.at ?? at,
        updatedAt: at,
        baseOperationId: matching?.parentOperationId ?? null,
        baseFingerprint: matching?.baseFingerprint ?? fingerprint,
        baseCheckpoint: matching?.baseCheckpoint ?? checkpoint,
        headOperationId: matching?.id ?? null,
        headFingerprint: fingerprint,
        headCheckpoint: matching?.resultCheckpoint ?? checkpoint,
      },
    },
  };
  if (existsSync(manifestPath(projectDir)) || invalidFiles.length > 0) {
    const recoveryDir = join(historyDir(projectDir), "recovery", `${Date.now()}-${randomUUID()}`);
    mkdirSync(recoveryDir, { recursive: true });
    if (existsSync(manifestPath(projectDir))) renameSync(manifestPath(projectDir), join(recoveryDir, "manifest.json"));
    for (const file of invalidFiles) renameSync(join(operationsDir(projectDir), file), join(recoveryDir, file));
  }
  writePrivateFileAtomic(manifestPath(projectDir), `${JSON.stringify(manifest, null, 2)}\n`);
  return inspectOperationHistory(projectDir, fingerprint);
}

export { graphFingerprint } from "./fingerprint.ts";
export { semanticThreeWayMerge } from "./semantic-merge.ts";
export type { MergeConflict, SemanticMergeResult } from "./semantic-merge.ts";
