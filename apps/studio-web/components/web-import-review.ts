import type { SemanticChange } from "@intentform/semantic-schema";

export type ImportChangeKind = "added" | "removed" | "updated";

export interface ImportChangeSummary {
  added: number;
  removed: number;
  updated: number;
  total: number;
  destructive: boolean;
}

export function importChangeKind(change: SemanticChange): ImportChangeKind {
  if (change.before === undefined) return "added";
  if (change.after === undefined) return "removed";
  return "updated";
}

export function summarizeImportChanges(changes: SemanticChange[]): ImportChangeSummary {
  const summary: ImportChangeSummary = { added: 0, removed: 0, updated: 0, total: changes.length, destructive: false };
  for (const change of changes) summary[importChangeKind(change)] += 1;
  summary.destructive = summary.removed > 0;
  return summary;
}

export function formatImportChangeValue(value: unknown, maximum = 180): string {
  if (value === undefined) return "Not present";
  if (value === null) return "null";
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  const normalized = (serialized ?? String(value)).replace(/\s+/g, " ").trim();
  if (normalized.length <= maximum) return normalized;
  const sliced = normalized.slice(0, Math.max(0, maximum - 1));
  const last = sliced.charCodeAt(sliced.length - 1);
  // Never cut a surrogate pair in half at the truncation boundary.
  return `${last >= 0xd800 && last <= 0xdbff ? sliced.slice(0, -1) : sliced}…`;
}
