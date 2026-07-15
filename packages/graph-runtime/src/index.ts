import {
  stableSerialize,
  type SemanticInterfaceGraph,
  type SemanticNode,
} from "@intentform/semantic-schema";

export const LARGE_DOCUMENT_PROFILE = {
  targetNodes: 10_000,
  canvasOverscanFrames: 1,
  browserChunkCharacters: 128_000,
  maxBrowserChunks: 128,
  maxWorkerMessageBytes: 12_500_000,
  maxCompilerCacheEntries: 12,
} as const;

export interface IndexedNodeLocation {
  screenId: string;
  node: SemanticNode;
  parentId: string | null;
  depth: number;
  indexPath: readonly number[];
}

export interface ScreenGraphIndex {
  screen: SemanticInterfaceGraph["screens"][number];
  canonical: string;
  nodes: readonly SemanticNode[];
  nodesById: ReadonlyMap<string, SemanticNode>;
  locationsById: ReadonlyMap<string, IndexedNodeLocation>;
}

export interface GraphIndex {
  graph: SemanticInterfaceGraph;
  screenById: ReadonlyMap<string, SemanticInterfaceGraph["screens"][number]>;
  screenIndexes: ReadonlyMap<string, ScreenGraphIndex>;
  nodeById: ReadonlyMap<string, SemanticNode>;
  locationById: ReadonlyMap<string, IndexedNodeLocation>;
  contractByScreenId: ReadonlyMap<string, SemanticInterfaceGraph["contracts"][number]>;
  fixturesByScreenId: ReadonlyMap<string, readonly SemanticInterfaceGraph["fixtures"][number][]>;
  nodeCount: number;
  reusedScreenCount: number;
}

function indexScreen(screen: SemanticInterfaceGraph["screens"][number], canonical: string): ScreenGraphIndex {
  const nodes: SemanticNode[] = [];
  const nodesById = new Map<string, SemanticNode>();
  const locationsById = new Map<string, IndexedNodeLocation>();
  const pending = [...screen.nodes].reverse().map((node, reversedIndex) => ({
    node,
    parentId: null as string | null,
    depth: 1,
    indexPath: [screen.nodes.length - reversedIndex - 1],
  }));
  while (pending.length > 0) {
    const entry = pending.pop()!;
    const location: IndexedNodeLocation = { screenId: screen.id, ...entry };
    nodes.push(entry.node);
    nodesById.set(entry.node.id, entry.node);
    locationsById.set(entry.node.id, location);
    for (let index = entry.node.children.length - 1; index >= 0; index -= 1) {
      pending.push({
        node: entry.node.children[index]!,
        parentId: entry.node.id,
        depth: entry.depth + 1,
        indexPath: [...entry.indexPath, index],
      });
    }
  }
  return { screen, canonical, nodes, nodesById, locationsById };
}

export function createGraphIndex(graph: SemanticInterfaceGraph, previous?: GraphIndex): GraphIndex {
  const screenById = new Map<string, SemanticInterfaceGraph["screens"][number]>();
  const screenIndexes = new Map<string, ScreenGraphIndex>();
  const nodeById = new Map<string, SemanticNode>();
  const locationById = new Map<string, IndexedNodeLocation>();
  let reusedScreenCount = 0;

  for (const screen of graph.screens) {
    screenById.set(screen.id, screen);
    const canonical = stableSerialize(screen);
    const prior = previous?.screenIndexes.get(screen.id);
    const screenIndex: ScreenGraphIndex = prior?.canonical === canonical
      ? { ...prior, screen }
      : indexScreen(screen, canonical);
    if (prior?.canonical === canonical) reusedScreenCount += 1;
    screenIndexes.set(screen.id, screenIndex);
    for (const node of screenIndex.nodes) nodeById.set(node.id, node);
    for (const [nodeId, location] of screenIndex.locationsById) {
      locationById.set(nodeId, screenIndex === prior ? location : { ...location, node: screenIndex.nodesById.get(nodeId)! });
    }
  }

  const fixturesByScreenId = new Map<string, SemanticInterfaceGraph["fixtures"][number][]>();
  for (const fixture of graph.fixtures) {
    const fixtures = fixturesByScreenId.get(fixture.screenId) ?? [];
    fixtures.push(fixture);
    fixturesByScreenId.set(fixture.screenId, fixtures);
  }

  return {
    graph,
    screenById,
    screenIndexes,
    nodeById,
    locationById,
    contractByScreenId: new Map(graph.contracts.map((contract) => [contract.screenId, contract])),
    fixturesByScreenId,
    nodeCount: nodeById.size,
    reusedScreenCount,
  };
}

export interface HorizontalFrame {
  id: string;
  index: number;
  x: number;
  width: number;
}

export interface HorizontalFrameIndex {
  frames: readonly HorizontalFrame[];
  frameById: ReadonlyMap<string, HorizontalFrame>;
  stride: number;
  worldWidth: number;
}

export function createHorizontalFrameIndex(
  ids: readonly string[],
  frameWidth: number,
  gap: number,
): HorizontalFrameIndex {
  if (!Number.isFinite(frameWidth) || frameWidth <= 0 || !Number.isFinite(gap) || gap < 0) {
    throw new Error("Frame width and gap must be finite non-negative geometry.");
  }
  const stride = frameWidth + gap;
  const frames = ids.map((id, index) => ({ id, index, x: index * stride, width: frameWidth }));
  return {
    frames,
    frameById: new Map(frames.map((frame) => [frame.id, frame])),
    stride,
    worldWidth: frames.length === 0 ? frameWidth : frames.length * frameWidth + (frames.length - 1) * gap,
  };
}

export function queryHorizontalFrames(
  index: HorizontalFrameIndex,
  visibleWorld: { left: number; right: number },
  options: { overscan?: number; includeIds?: readonly string[] } = {},
): HorizontalFrame[] {
  if (!Number.isFinite(visibleWorld.left) || !Number.isFinite(visibleWorld.right) || visibleWorld.right < visibleWorld.left) {
    throw new Error("Visible world bounds must be finite and ordered.");
  }
  if (index.frames.length === 0) return [];
  const overscan = Math.max(0, Math.floor(options.overscan ?? LARGE_DOCUMENT_PROFILE.canvasOverscanFrames));
  const first = Math.max(0, Math.floor(visibleWorld.left / index.stride) - overscan);
  const last = Math.min(index.frames.length - 1, Math.floor(visibleWorld.right / index.stride) + overscan);
  const visible = new Map(index.frames.slice(first, last + 1).map((frame) => [frame.id, frame]));
  for (const id of options.includeIds ?? []) {
    const frame = index.frameById.get(id);
    if (frame) visible.set(frame.id, frame);
  }
  return [...visible.values()].sort((left, right) => left.index - right.index);
}

function checksum(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export interface ChunkedSnapshot {
  version: 1;
  checksum: string;
  characters: number;
  chunks: readonly string[];
}

export function splitSnapshot(
  source: string,
  chunkCharacters: number = LARGE_DOCUMENT_PROFILE.browserChunkCharacters,
): ChunkedSnapshot {
  if (!Number.isSafeInteger(chunkCharacters) || chunkCharacters < 1) throw new Error("Chunk size must be a positive integer.");
  const chunks: string[] = [];
  for (let offset = 0; offset < source.length; offset += chunkCharacters) {
    chunks.push(source.slice(offset, offset + chunkCharacters));
  }
  if (chunks.length === 0) chunks.push("");
  if (chunks.length > LARGE_DOCUMENT_PROFILE.maxBrowserChunks) {
    throw new Error(`Snapshot exceeds ${LARGE_DOCUMENT_PROFILE.maxBrowserChunks} chunks.`);
  }
  return { version: 1, checksum: checksum(source), characters: source.length, chunks };
}

export function joinSnapshot(snapshot: ChunkedSnapshot): string {
  if (snapshot.version !== 1 || !Array.isArray(snapshot.chunks)
    || snapshot.chunks.length < 1 || snapshot.chunks.length > LARGE_DOCUMENT_PROFILE.maxBrowserChunks) {
    throw new Error("Chunked snapshot manifest is invalid.");
  }
  const source = snapshot.chunks.join("");
  if (source.length !== snapshot.characters || checksum(source) !== snapshot.checksum) {
    throw new Error("Chunked snapshot failed integrity validation.");
  }
  return source;
}

export function assertBoundedWorkerMessage(input: unknown): number {
  let source: string | undefined;
  try {
    source = JSON.stringify(input);
  } catch {
    throw new Error("Worker message must be JSON-serializable.");
  }
  if (source === undefined) throw new Error("Worker message must be JSON-serializable.");
  const bytes = new TextEncoder().encode(source).byteLength;
  if (bytes > LARGE_DOCUMENT_PROFILE.maxWorkerMessageBytes) {
    throw new Error(`Worker message exceeds ${LARGE_DOCUMENT_PROFILE.maxWorkerMessageBytes} bytes.`);
  }
  return bytes;
}

export class BoundedLruCache<Key, Value> {
  readonly #maximum: number;
  readonly #values = new Map<Key, Value>();

  constructor(maximum: number) {
    if (!Number.isSafeInteger(maximum) || maximum < 1) throw new Error("Cache capacity must be a positive integer.");
    this.#maximum = maximum;
  }

  get size(): number { return this.#values.size; }

  get(key: Key): Value | undefined {
    const value = this.#values.get(key);
    if (value === undefined) return undefined;
    this.#values.delete(key);
    this.#values.set(key, value);
    return value;
  }

  set(key: Key, value: Value): void {
    this.#values.delete(key);
    this.#values.set(key, value);
    while (this.#values.size > this.#maximum) this.#values.delete(this.#values.keys().next().value!);
  }

  clear(): void { this.#values.clear(); }
}
