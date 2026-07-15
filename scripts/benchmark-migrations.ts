import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { previewGraphMigration } from "../packages/semantic-schema/src/migrations.ts";

const requestedIterations = Number.parseInt(process.env.MIGRATION_BENCH_ITERATIONS ?? "1000", 10);
const iterations = Number.isSafeInteger(requestedIterations)
  ? Math.min(100_000, Math.max(1, requestedIterations))
  : 1_000;
const input = JSON.parse(readFileSync(
  new URL("../packages/semantic-schema/src/fixtures/migrations/0.0.1.json", import.meta.url),
  "utf8",
)) as unknown;
const expected = previewGraphMigration(input).canonical;

for (let index = 0; index < 25; index += 1) previewGraphMigration(input);
const startedAt = performance.now();
for (let index = 0; index < iterations; index += 1) {
  const result = previewGraphMigration(input);
  if (result.canonical !== expected) throw new Error(`Migration output changed at iteration ${index}.`);
}
const durationMs = performance.now() - startedAt;
const operationsPerSecond = Math.round(iterations / (durationMs / 1_000));

console.log(JSON.stringify({
  fixture: "0.0.1-to-0.9.0",
  iterations,
  durationMs: Number(durationMs.toFixed(2)),
  operationsPerSecond,
  canonicalBytes: Buffer.byteLength(expected, "utf8"),
}));
