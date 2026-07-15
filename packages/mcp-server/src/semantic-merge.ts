import {
  parseGraph,
  semanticDiff,
  type SemanticChange,
  type SemanticInterfaceGraph,
} from "@intentform/semantic-schema";

export interface MergeConflict {
  path: string;
  reason: "both-modified" | "delete-modify" | "order-conflict";
  base: unknown;
  ours: unknown;
  theirs: unknown;
}

export interface SemanticMergeResult {
  graph: SemanticInterfaceGraph;
  conflicts: MergeConflict[];
  changes: SemanticChange[];
}

const MISSING = Symbol("missing");
type MergeValue = unknown | typeof MISSING;
type KeyedRecord = Record<string, unknown>;
type StableKey = "id" | "name" | "screenId" | "target" | "event";

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const input = value as Record<string, unknown>;
  return `{${Object.keys(input).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(input[key])}`).join(",")}}`;
}

function deepEqual(left: MergeValue, right: MergeValue): boolean {
  if (left === MISSING || right === MISSING) return left === right;
  return canonicalJson(left) === canonicalJson(right);
}

function copyValue<T extends MergeValue>(value: T): T {
  return value === MISSING ? value : structuredClone(value) as T;
}

function isRecord(value: MergeValue): value is KeyedRecord {
  return value !== MISSING && value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasUniqueStringKey(value: unknown[], key: StableKey): value is KeyedRecord[] {
  const keys = new Set<string>();
  return value.every((item) => {
    if (!isRecord(item) || typeof item[key] !== "string" || keys.has(item[key])) return false;
    keys.add(item[key]);
    return true;
  });
}

function sharedStableKey(base: unknown[], ours: unknown[], theirs: unknown[]): StableKey | null {
  for (const key of ["id", "name", "screenId", "target", "event"] as const) {
    if (hasUniqueStringKey(base, key) && hasUniqueStringKey(ours, key) && hasUniqueStringKey(theirs, key)) return key;
  }
  return null;
}

function conflictReason(base: MergeValue, ours: MergeValue, theirs: MergeValue): MergeConflict["reason"] {
  if ((ours === MISSING || theirs === MISSING) && base !== MISSING) return "delete-modify";
  return "both-modified";
}

function publicValue(value: MergeValue): unknown {
  return value === MISSING ? undefined : value;
}

function mergeKeyedArray(
  base: KeyedRecord[],
  ours: KeyedRecord[],
  theirs: KeyedRecord[],
  key: StableKey,
  path: string,
  conflicts: MergeConflict[],
): KeyedRecord[] {
  const valueKey = (item: KeyedRecord) => item[key] as string;
  const baseByKey = new Map(base.map((item) => [valueKey(item), item]));
  const oursByKey = new Map(ours.map((item) => [valueKey(item), item]));
  const theirsByKey = new Map(theirs.map((item) => [valueKey(item), item]));
  const mergedByKey = new Map<string, KeyedRecord>();
  const allKeys = [...new Set([...baseByKey.keys(), ...oursByKey.keys(), ...theirsByKey.keys()])];
  for (const stableKey of allKeys) {
    const next = mergeValue(
      baseByKey.get(stableKey) ?? MISSING,
      oursByKey.get(stableKey) ?? MISSING,
      theirsByKey.get(stableKey) ?? MISSING,
      `${path}[${key}=${stableKey}]`,
      conflicts,
    );
    if (next !== MISSING && isRecord(next) && typeof next[key] === "string") mergedByKey.set(stableKey, next);
  }
  const retained = new Set(mergedByKey.keys());
  const baseOrder = base.map(valueKey).filter((value) => retained.has(value));
  const oursOrder = ours.map(valueKey).filter((value) => retained.has(value));
  const theirsOrder = theirs.map(valueKey).filter((value) => retained.has(value));
  let order: string[];
  if (deepEqual(oursOrder, theirsOrder)) order = oursOrder;
  else if (deepEqual(baseOrder, oursOrder)) order = theirsOrder;
  else if (deepEqual(baseOrder, theirsOrder)) order = oursOrder;
  else {
    conflicts.push({ path: `${path}.$order`, reason: "order-conflict", base: baseOrder, ours: oursOrder, theirs: theirsOrder });
    order = oursOrder;
  }
  for (const stableKey of allKeys) if (retained.has(stableKey) && !order.includes(stableKey)) order.push(stableKey);
  return order.map((stableKey) => mergedByKey.get(stableKey)!);
}

function mergeValue(base: MergeValue, ours: MergeValue, theirs: MergeValue, path: string, conflicts: MergeConflict[]): MergeValue {
  if (deepEqual(ours, theirs)) return copyValue(ours);
  if (deepEqual(base, ours)) return copyValue(theirs);
  if (deepEqual(base, theirs)) return copyValue(ours);

  if (isRecord(base) && isRecord(ours) && isRecord(theirs)) {
    const merged: Record<string, unknown> = {};
    const keys = [...new Set([...Object.keys(base), ...Object.keys(ours), ...Object.keys(theirs)])].sort();
    for (const key of keys) {
      const next = mergeValue(
        Object.hasOwn(base, key) ? base[key] : MISSING,
        Object.hasOwn(ours, key) ? ours[key] : MISSING,
        Object.hasOwn(theirs, key) ? theirs[key] : MISSING,
        `${path}.${key}`,
        conflicts,
      );
      if (next !== MISSING) merged[key] = next;
    }
    return merged;
  }

  if (Array.isArray(base) && Array.isArray(ours) && Array.isArray(theirs)) {
    const stableKey = sharedStableKey(base, ours, theirs);
    if (stableKey) return mergeKeyedArray(base, ours, theirs, stableKey, path, conflicts);
  }

  conflicts.push({
    path,
    reason: conflictReason(base, ours, theirs),
    base: publicValue(base),
    ours: publicValue(ours),
    theirs: publicValue(theirs),
  });
  return copyValue(ours);
}

export function semanticThreeWayMerge(
  base: SemanticInterfaceGraph,
  ours: SemanticInterfaceGraph,
  theirs: SemanticInterfaceGraph,
): SemanticMergeResult {
  const conflicts: MergeConflict[] = [];
  const merged = mergeValue(base, ours, theirs, "$", conflicts);
  const graph = parseGraph(merged);
  return { graph, conflicts, changes: semanticDiff(ours, graph) };
}
