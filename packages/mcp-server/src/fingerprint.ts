import { stableSerialize, type SemanticInterfaceGraph } from "@intentform/semantic-schema";

export function graphFingerprint(graph: SemanticInterfaceGraph): string {
  const input = stableSerialize(graph);
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
