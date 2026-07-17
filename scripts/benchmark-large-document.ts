import { performance } from "node:perf_hooks";
import { createStudioCompilationCache } from "../apps/studio-web/components/target-compilation.ts";
import {
  BoundedLruCache,
  createGraphIndex,
  createHorizontalFrameIndex,
  queryHorizontalFrames,
} from "../packages/graph-runtime/src/index.ts";
import { computeNeutralLayout } from "../packages/layout-engine/src/index.ts";
import {
  GRAPH_LIMITS,
  applyGraphPatch,
  parseGraph,
  semanticDiff,
  stableSerialize,
} from "../packages/semantic-schema/src/index.ts";
import { createLargeDocumentGraph, LARGE_DOCUMENT_NODE_COUNT } from "./large-document-fixture.ts";

const budgets = {
  openMs: 2_000,
  indexMs: 1_000,
  editMs: 3_000,
  diffMs: 1_000,
  layoutMs: 1_000,
  codegenMs: 3_000,
  cachedCodegenMs: 25,
  panZoomQueriesMs: 100,
  longSessionMs: 6_000,
  retainedHeapBytes: 64 * 1024 * 1024,
} as const;

function collect(): void {
  (globalThis as typeof globalThis & { gc?: () => void }).gc?.();
}

function measure<Value>(run: () => Value): { value: Value; ms: number } {
  collect();
  const started = performance.now();
  const value = run();
  return { value, ms: performance.now() - started };
}

const sourceGraph = createLargeDocumentGraph();
const SIMULATED_SESSION_MINUTES = 60;
const SESSION_TICKS = SIMULATED_SESSION_MINUTES * 60;
const source = stableSerialize(sourceGraph);
const serializedBytes = new TextEncoder().encode(source).byteLength;
if (serializedBytes > GRAPH_LIMITS.maxSerializedBytes) {
  throw new Error(`10k fixture is ${serializedBytes} bytes, above the ${GRAPH_LIMITS.maxSerializedBytes}-byte graph limit.`);
}

const opened = measure(() => parseGraph(JSON.parse(source)));
const indexed = measure(() => createGraphIndex(opened.value));
if (indexed.value.nodeCount !== LARGE_DOCUMENT_NODE_COUNT) {
  throw new Error(`Index contains ${indexed.value.nodeCount} nodes instead of ${LARGE_DOCUMENT_NODE_COUNT}.`);
}

const edited = measure(() => applyGraphPatch(opened.value, {
  id: "large-document-edit",
  rationale: "Measure a stable-property edit at scale",
  operations: [{
    op: "set-label",
    target: "scale-050.node-050",
    label: "Edited indexed item",
  }],
}));
const diffed = measure(() => semanticDiff(opened.value, edited.value));
const laidOut = measure(() => opened.value.screens.map((screen) => computeNeutralLayout(
  screen,
  opened.value,
  { width: 402, height: 874 },
)));
if (laidOut.value.reduce((count, layout) => count + layout.byId.size, 0) !== LARGE_DOCUMENT_NODE_COUNT) {
  throw new Error("Large-document layout omitted nodes.");
}

const frameIndex = createHorizontalFrameIndex(opened.value.screens.map((screen) => screen.id), 402, 180);
const panZoom = measure(() => {
  let visible = 0;
  for (let index = 0; index < 5_000; index += 1) {
    const left = (index * 97) % Math.max(1, frameIndex.worldWidth - 1_200);
    visible += queryHorizontalFrames(frameIndex, { left, right: left + 1_200 }).length;
  }
  return visible;
});

const compilationCache = createStudioCompilationCache();
const codegen = measure(() => compilationCache.compile(opened.value, "react"));
if (codegen.value.status !== "generated" || !codegen.value.output) throw new Error(codegen.value.message ?? "10k React codegen failed.");
const cachedCodegen = measure(() => compilationCache.compile(opened.value, "react"));
if (cachedCodegen.value !== codegen.value) throw new Error("Compiler cache did not reuse the immutable graph result.");

collect();
const heapBefore = process.memoryUsage().heapUsed;
const longSession = measure(() => {
  const cache = new BoundedLruCache<number, ReturnType<typeof createGraphIndex>>(4);
  let rebuiltIndexes = 0;
  for (let iteration = 0; iteration < SESSION_TICKS; iteration += 1) {
    if (iteration % 150 === 0) {
      cache.set(rebuiltIndexes, createGraphIndex(opened.value, indexed.value));
      rebuiltIndexes += 1;
    }
    const left = (iteration * 1_337) % Math.max(1, frameIndex.worldWidth - 900);
    queryHorizontalFrames(frameIndex, { left, right: left + 900 }, { includeIds: ["scale-050"] });
  }
  return { retainedIndexes: cache.size, rebuiltIndexes, interactions: SESSION_TICKS };
});
collect();
const retainedHeapBytes = Math.max(0, process.memoryUsage().heapUsed - heapBefore);

const measurements = {
  openMs: opened.ms,
  indexMs: indexed.ms,
  editMs: edited.ms,
  diffMs: diffed.ms,
  layoutMs: laidOut.ms,
  codegenMs: codegen.ms,
  cachedCodegenMs: cachedCodegen.ms,
  panZoomQueriesMs: panZoom.ms,
  longSessionMs: longSession.ms,
  retainedHeapBytes,
};

const regressions = Object.entries(budgets).flatMap(([name, budget]) => {
  const measured = measurements[name as keyof typeof measurements];
  return measured > budget ? [`${name}: ${measured.toFixed(2)} > ${budget}`] : [];
});

console.log(JSON.stringify({
  profile: {
    nodes: indexed.value.nodeCount,
    screens: opened.value.screens.length,
    serializedBytes,
    diffChanges: diffed.value.length,
    generatedFiles: codegen.value.output.files.length,
    generatedBytes: codegen.value.output.files.reduce((bytes, file) => bytes + Buffer.byteLength(file.content), 0),
    panZoomVisibleFrames: panZoom.value,
    retainedIndexes: longSession.value.retainedIndexes,
    simulatedSessionMinutes: SIMULATED_SESSION_MINUTES,
    longSessionInteractions: longSession.value.interactions,
    rebuiltIndexes: longSession.value.rebuiltIndexes,
  },
  budgets,
  measurements: Object.fromEntries(Object.entries(measurements).map(([key, value]) => [key, Number(value.toFixed(2))])),
  regressions,
}, null, 2));

if (regressions.length > 0) process.exitCode = 1;
