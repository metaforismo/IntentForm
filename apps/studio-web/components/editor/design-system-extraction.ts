import {
  flattenSemanticNodes,
  parseGraph,
  type SemanticInterfaceGraph,
  type SemanticNode,
} from "@intentform/semantic-schema";

export type ExtractableTokenGroup =
  | "colors"
  | "spacing"
  | "radii"
  | "fontFamilies"
  | "fontWeights"
  | "fontSizes"
  | "lineHeights"
  | "letterSpacing";

export interface TokenSuggestion {
  id: string;
  group: ExtractableTokenGroup;
  key: string;
  value: string | number;
  occurrences: number;
  nodeIds: string[];
  nearValues: Array<string | number>;
}

export interface ComponentCandidate {
  id: string;
  name: string;
  sourceNodeId: string;
  nodeIds: string[];
  occurrences: number;
  nodeCount: number;
}

export interface DesignSystemAnalysis {
  screenId: string;
  tokens: TokenSuggestion[];
  components: ComponentCandidate[];
}

export interface TokenExtractionSelection {
  suggestionId: string;
  key: string;
}

export interface DesignSystemExtractionReview {
  screenId: string;
  tokens: TokenExtractionSelection[];
  component?: { candidateId: string; name: string };
}

interface CollectedValue {
  group: ExtractableTokenGroup;
  value: string | number;
  nodeId: string;
}

const groupPrefix: Record<ExtractableTokenGroup, string> = {
  colors: "color.extracted.",
  spacing: "space.extracted.",
  radii: "radius.extracted.",
  fontFamilies: "font.family.extracted.",
  fontWeights: "font.weight.extracted.",
  fontSizes: "font.size.extracted.",
  lineHeights: "font.line-height.extracted.",
  letterSpacing: "font.letter-spacing.extracted.",
};

const normalizedValue = (value: string | number) => typeof value === "string" ? value.trim().toLowerCase() : value;

function valueLabel(value: string | number): string {
  if (typeof value === "number") return String(value).replace("-", "minus-").replace(".", "-");
  const color = value.match(/^#([0-9a-f]{3,8})$/i)?.[1];
  if (color) return color.toLowerCase();
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 28) || "value";
}

function uniqueKey(group: ExtractableTokenGroup, value: string | number, existing: Set<string>): string {
  const stem = `${groupPrefix[group]}${valueLabel(value)}`;
  let key = stem;
  let index = 2;
  while (existing.has(key)) {
    key = `${stem}-${index}`;
    index += 1;
  }
  existing.add(key);
  return key;
}

function collectNodeValues(node: SemanticNode): CollectedValue[] {
  const values: CollectedValue[] = [];
  const push = (group: ExtractableTokenGroup, value: string | number | undefined) => {
    if (value !== undefined && value !== "") values.push({ group, value, nodeId: node.id });
  };
  if (node.layout.gap !== undefined) push("spacing", node.layout.gap);
  const appearance = node.style.appearance;
  if (!appearance) return values;
  for (const fill of appearance.fills) {
    if (fill.type === "solid") push("colors", fill.color.token ? undefined : fill.color.color);
    else for (const stop of fill.stops) push("colors", stop.color.token ? undefined : stop.color.color);
  }
  push("colors", appearance.stroke?.color.token ? undefined : appearance.stroke?.color.color);
  for (const effect of appearance.effects) {
    if (effect.type === "shadow" || effect.type === "inner-shadow") push("colors", effect.color.token ? undefined : effect.color.color);
  }
  const radius = appearance.radius;
  if (radius && !radius.token && radius.topLeft === radius.topRight && radius.topLeft === radius.bottomRight && radius.topLeft === radius.bottomLeft) {
    push("radii", radius.topLeft);
  }
  const typography = appearance.typography;
  if (typography) {
    push("fontFamilies", typography.familyToken ? undefined : typography.family);
    push("fontWeights", typography.weightToken ? undefined : typography.weight);
    push("fontSizes", typography.sizeToken ? undefined : typography.size);
    push("lineHeights", typography.lineHeightToken ? undefined : typography.lineHeight);
    push("letterSpacing", typography.letterSpacingToken ? undefined : typography.letterSpacing);
  }
  return values;
}

function nodeSignature(node: SemanticNode): string {
  return `${node.kind}:${node.layout.axis}:${node.style.role}[${node.children.map(nodeSignature).join(",")}]`;
}

function componentName(node: SemanticNode): string {
  const label = node.intent.label ?? node.intent.purpose;
  return label.replace(/[^a-z0-9 ]+/gi, " ").replace(/\s+/g, " ").trim().slice(0, 48) || "Reusable pattern";
}

export function analyzeDesignSystem(graph: SemanticInterfaceGraph, screenId: string): DesignSystemAnalysis {
  const screen = graph.screens.find((candidate) => candidate.id === screenId);
  if (!screen) return { screenId, tokens: [], components: [] };
  const nodes = flattenSemanticNodes(screen.nodes);
  const existing = new Set(Object.values(graph.tokens.modes).flatMap((mode) => Object.values(mode.values).flatMap((group) => Object.keys(group ?? {}))));
  const buckets = new Map<string, CollectedValue[]>();
  for (const item of nodes.flatMap(collectNodeValues)) {
    const key = `${item.group}:${String(normalizedValue(item.value))}`;
    buckets.set(key, [...(buckets.get(key) ?? []), item]);
  }
  const numericByGroup = new Map<ExtractableTokenGroup, number[]>();
  for (const items of buckets.values()) {
    const first = items[0];
    if (first && typeof first.value === "number") numericByGroup.set(first.group, [...(numericByGroup.get(first.group) ?? []), first.value]);
  }
  const tokens = [...buckets.values()]
    .filter((items) => items.length >= 2)
    .map((items) => {
      const first = items[0]!;
      const numericValue = typeof first.value === "number" ? first.value : null;
      const nearValues = numericValue !== null
        ? [...new Set((numericByGroup.get(first.group) ?? []).filter((value) => value !== numericValue && Math.abs(value - numericValue) <= 2))].sort((a, b) => a - b)
        : [];
      const key = uniqueKey(first.group, first.value, existing);
      return {
        id: `${first.group}:${String(normalizedValue(first.value))}`,
        group: first.group,
        key,
        value: first.value,
        occurrences: items.length,
        nodeIds: [...new Set(items.map((item) => item.nodeId))].sort(),
        nearValues,
      } satisfies TokenSuggestion;
    })
    .sort((left, right) => right.occurrences - left.occurrences || left.key.localeCompare(right.key));

  const signatures = new Map<string, SemanticNode[]>();
  for (const node of nodes.filter((candidate) => candidate.children.length > 0)) {
    const signature = nodeSignature(node);
    signatures.set(signature, [...(signatures.get(signature) ?? []), node]);
  }
  const components = [...signatures.entries()]
    .filter(([, matches]) => matches.length >= 2)
    .map(([signature, matches]) => ({
      id: `component:${signature}`,
      name: componentName(matches[0]!),
      sourceNodeId: matches[0]!.id,
      nodeIds: matches.map((node) => node.id).sort(),
      occurrences: matches.length,
      nodeCount: flattenSemanticNodes([matches[0]!]).length,
    }))
    .sort((left, right) => right.occurrences - left.occurrences || right.nodeCount - left.nodeCount || left.sourceNodeId.localeCompare(right.sourceNodeId))
    .slice(0, 8);
  return { screenId, tokens, components };
}

function assertKey(group: ExtractableTokenGroup, key: string): void {
  if (!key.startsWith(groupPrefix[group]) || !/^[a-z][a-z0-9.-]{2,79}$/.test(key)) {
    throw new Error(`Invalid ${group} token key: ${key}`);
  }
}

export function applyTokenExtraction(
  graph: SemanticInterfaceGraph,
  screenId: string,
  selections: readonly TokenExtractionSelection[],
): SemanticInterfaceGraph {
  const analysis = analyzeDesignSystem(graph, screenId);
  const chosen = selections.map((selection) => {
    const suggestion = analysis.tokens.find((candidate) => candidate.id === selection.suggestionId);
    if (!suggestion) throw new Error(`Unknown extraction suggestion: ${selection.suggestionId}`);
    assertKey(suggestion.group, selection.key);
    return { ...suggestion, key: selection.key };
  });
  const duplicate = chosen.find((item, index) => chosen.some((candidate, candidateIndex) => candidateIndex !== index && candidate.key === item.key));
  if (duplicate) throw new Error(`Duplicate extracted token key: ${duplicate.key}`);
  const next = structuredClone(graph);
  const mode = next.tokens.modes[next.tokens.activeMode];
  const screen = next.screens.find((candidate) => candidate.id === screenId);
  if (!mode || !screen) throw new Error("Extraction target is no longer available.");
  for (const item of chosen) {
    const group = mode.values[item.group] as Record<string, string | number>;
    const existing = group[item.key];
    if (existing !== undefined && normalizedValue(existing) !== normalizedValue(item.value)) throw new Error(`Token key already has a different value: ${item.key}`);
    group[item.key] = item.value;
  }
  const lookup = (group: ExtractableTokenGroup, value: string | number | undefined) => chosen.find((item) => value !== undefined && item.group === group && normalizedValue(item.value) === normalizedValue(value));
  for (const node of flattenSemanticNodes(screen.nodes)) {
    const gap = lookup("spacing", node.layout.gap);
    if (gap) { node.layout.gapToken = gap.key; delete node.layout.gap; }
    const appearance = node.style.appearance;
    if (!appearance) continue;
    for (const fill of appearance.fills) {
      if (fill.type === "solid") {
        const match = lookup("colors", fill.color.token ? undefined : fill.color.color);
        if (match) fill.color = { token: match.key };
      } else for (const stop of fill.stops) {
        const match = lookup("colors", stop.color.token ? undefined : stop.color.color);
        if (match) stop.color = { token: match.key };
      }
    }
    if (appearance.stroke) {
      const match = lookup("colors", appearance.stroke.color.token ? undefined : appearance.stroke.color.color);
      if (match) appearance.stroke.color = { token: match.key };
    }
    for (const effect of appearance.effects) if (effect.type === "shadow" || effect.type === "inner-shadow") {
      const match = lookup("colors", effect.color.token ? undefined : effect.color.color);
      if (match) effect.color = { token: match.key };
    }
    const radius = appearance.radius;
    if (radius && !radius.token) {
      const match = lookup("radii", radius.topLeft);
      if (match && radius.topLeft === radius.topRight && radius.topLeft === radius.bottomRight && radius.topLeft === radius.bottomLeft) radius.token = match.key;
    }
    const typography = appearance.typography;
    if (!typography) continue;
    const family = lookup("fontFamilies", typography.familyToken ? undefined : typography.family);
    if (family) { typography.familyToken = family.key; delete typography.family; }
    const weight = lookup("fontWeights", typography.weightToken ? undefined : typography.weight);
    if (weight) { typography.weightToken = weight.key; delete typography.weight; }
    const size = lookup("fontSizes", typography.sizeToken ? undefined : typography.size);
    if (size) { typography.sizeToken = size.key; delete typography.size; }
    const lineHeight = lookup("lineHeights", typography.lineHeightToken ? undefined : typography.lineHeight);
    if (lineHeight) { typography.lineHeightToken = lineHeight.key; delete typography.lineHeight; }
    const letterSpacing = lookup("letterSpacing", typography.letterSpacingToken ? undefined : typography.letterSpacing);
    if (letterSpacing) { typography.letterSpacingToken = letterSpacing.key; delete typography.letterSpacing; }
  }
  return parseGraph(next);
}
