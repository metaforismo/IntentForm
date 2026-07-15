import { stableSerialize, type SemanticInterfaceGraph } from "@intentform/semantic-schema";

export function serializedGraphFingerprint(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function graphFingerprint(graph: SemanticInterfaceGraph): string {
  return serializedGraphFingerprint(stableSerialize(graph));
}

export function hasUnsavedLocalChanges(
  graph: SemanticInterfaceGraph,
  localProjectFingerprint: string | null,
): boolean {
  return localProjectFingerprint !== null && graphFingerprint(graph) !== localProjectFingerprint;
}
