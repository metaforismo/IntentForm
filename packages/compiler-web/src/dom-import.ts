import {
  GRAPH_LIMITS,
  parseGraph,
  resolveTokenMode,
  semanticDiff,
  type SemanticChange,
  type SemanticInterfaceGraph,
  type SemanticNode,
} from "@intentform/semantic-schema";

export const DOM_IMPORT_LIMITS = {
  maxHtmlBytes: 300_000,
  maxCssBytes: 200_000,
  maxNodes: 256,
  maxDepth: Math.min(12, GRAPH_LIMITS.maxNodeDepth),
} as const;

export interface ComputedDomStyle {
  display: string;
  flexDirection: string;
  flexWrap: string;
  position: string;
  insetBlockStart: number | null;
  overflowX: string;
  overflowY: string;
  gap: number;
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
  alignItems: string;
  justifyContent: string;
  width: number;
  height: number;
  gridTemplateColumns: number[];
  color: string;
  backgroundColor: string;
  borderColor: string;
  borderWidth: number;
  borderStyle: string;
  borderRadius: number;
  opacity: number;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  letterSpacing: number;
  textAlign: string;
}

export interface ComputedDomNode {
  tag: string;
  text: string;
  accessibleName: string;
  hasImageSource: boolean;
  unsupported: string[];
  style: ComputedDomStyle;
  children: ComputedDomNode[];
}

export interface DomImportDiagnostic {
  severity: "warning" | "error";
  path: string;
  message: string;
}

export interface DomImportProjection {
  graph: SemanticInterfaceGraph;
  changes: SemanticChange[];
  diagnostics: DomImportDiagnostic[];
  importedNodes: number;
}

const finite = (value: number, fallback = 0) => Number.isFinite(value) ? value : fallback;
const bounded = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, finite(value)));
const text = (value: string, maximum: number) => value.replace(/[\u0000-\u001f\u007f\u2028-\u202e\u2066-\u2069]+/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum);

function closestToken(tokens: Record<string, number>, value: number, fallback: string): { key: string; exact: boolean } {
  const entries = Object.entries(tokens);
  if (entries.length === 0) return { key: fallback, exact: false };
  const [key, resolved] = entries.reduce((best, candidate) =>
    Math.abs(candidate[1] - value) < Math.abs(best[1] - value) ? candidate : best,
  );
  return { key, exact: Math.abs(resolved - value) <= 0.5 };
}

function alignment(value: string): SemanticNode["layout"]["align"] {
  if (value === "center") return "center";
  if (value === "flex-end" || value === "end") return "end";
  if (value === "stretch") return "stretch";
  if (value === "baseline") return "baseline";
  return "start";
}

function justification(value: string): SemanticNode["layout"]["justify"] {
  if (value === "center") return "center";
  if (value === "flex-end" || value === "end") return "end";
  if (value === "space-between") return "space-between";
  if (value === "space-around" || value === "space-evenly") return "space-between";
  return "start";
}

function overflow(value: string): SemanticNode["layout"]["overflow"] {
  if (value === "auto" || value === "scroll") return "scroll";
  if (value === "clip" || value === "hidden") return "clip";
  return "visible";
}

function visual(style: ComputedDomStyle): NonNullable<NonNullable<SemanticNode["web"]>["visual"]> {
  const result: NonNullable<NonNullable<SemanticNode["web"]>["visual"]> = {};
  if (style.color) result.color = style.color;
  if (style.backgroundColor && style.backgroundColor !== "rgba(0, 0, 0, 0)") result.backgroundColor = style.backgroundColor;
  if (style.borderWidth > 0) {
    result.borderWidth = bounded(style.borderWidth, 0, 256);
    if (["solid", "dashed", "dotted", "double"].includes(style.borderStyle)) {
      result.borderStyle = style.borderStyle as NonNullable<typeof result.borderStyle>;
    }
    if (style.borderColor) result.borderColor = style.borderColor;
  }
  if (style.borderRadius > 0) result.borderRadius = bounded(style.borderRadius, 0, 10_000);
  result.paddingTop = bounded(style.paddingTop, 0, 512);
  result.paddingRight = bounded(style.paddingRight, 0, 512);
  result.paddingBottom = bounded(style.paddingBottom, 0, 512);
  result.paddingLeft = bounded(style.paddingLeft, 0, 512);
  if (style.opacity < 1) result.opacity = bounded(style.opacity, 0, 1);
  if (style.fontFamily) result.fontFamily = text(style.fontFamily, 200).replace(/[^a-z0-9 ,"'_-]/gi, "");
  if (style.fontSize > 0) result.fontSize = bounded(style.fontSize, 1, 1_000);
  if (style.fontWeight > 0) result.fontWeight = bounded(style.fontWeight, 1, 1_000);
  if (style.lineHeight > 0) result.lineHeight = bounded(style.lineHeight, 1, 2_000);
  if (Number.isFinite(style.letterSpacing)) result.letterSpacing = bounded(style.letterSpacing, -100, 1_000);
  if (["start", "end", "left", "right", "center", "justify"].includes(style.textAlign)) {
    result.textAlign = style.textAlign as NonNullable<typeof result.textAlign>;
  }
  return result;
}

function leafKind(node: ComputedDomNode): SemanticNode["kind"] {
  if (node.tag === "img" || node.tag === "picture" || node.tag === "svg") return "image";
  if (node.tag === "button" || node.tag === "a") return "action";
  if (["input", "textarea", "select"].includes(node.tag)) return "input";
  if (node.tag === "hr") return "divider";
  return "text";
}

function isSemanticLeaf(tag: string): boolean {
  return [
    "a", "button", "input", "textarea", "select", "img", "picture", "svg", "hr",
    "p", "span", "strong", "em", "small", "label", "h1", "h2", "h3", "h4", "h5", "h6",
  ].includes(tag);
}

export function projectComputedDom(
  graph: SemanticInterfaceGraph,
  screenId: string,
  roots: ComputedDomNode[],
): DomImportProjection {
  const screenIndex = graph.screens.findIndex((screen) => screen.id === screenId);
  if (screenIndex < 0) throw new Error("The selected screen is not available for HTML/CSS import.");
  const diagnostics: DomImportDiagnostic[] = [];
  const candidate = structuredClone(graph);
  const resolved = resolveTokenMode(candidate.tokens);
  let sequence = 0;

  const convert = (source: ComputedDomNode, depth: number, path: string): SemanticNode | null => {
    if (depth > DOM_IMPORT_LIMITS.maxDepth) {
      diagnostics.push({ severity: "warning", path, message: `Content deeper than ${DOM_IMPORT_LIMITS.maxDepth} levels was omitted.` });
      return null;
    }
    if (sequence >= DOM_IMPORT_LIMITS.maxNodes) {
      diagnostics.push({ severity: "warning", path, message: `Only the first ${DOM_IMPORT_LIMITS.maxNodes} supported elements were imported.` });
      return null;
    }
    sequence += 1;
    const id = `web-import.${sequence}`;
    const children = (isSemanticLeaf(source.tag) ? [] : source.children).flatMap((child, index) => {
      const converted = convert(child, depth + 1, `${path}.children.${index}`);
      return converted ? [converted] : [];
    });
    const isContainer = !isSemanticLeaf(source.tag) && children.length > 0;
    const grid = source.style.display === "grid";
    const wrapped = source.style.flexWrap === "wrap";
    const kind: SemanticNode["kind"] = isContainer ? grid ? "grid" : wrapped ? "wrap" : "stack" : leafKind(source);
    const label = text(source.accessibleName || source.text || source.tag, 240) || "Imported element";
    const gap = bounded(source.style.gap, -128, 512);
    const gapToken = closestToken(resolved.spacing, gap, "space.16");
    const paddingValues = [source.style.paddingTop, source.style.paddingRight, source.style.paddingBottom, source.style.paddingLeft]
      .map((value) => bounded(value, 0, 512));
    const paddingTokens = paddingValues.map((value) => closestToken(resolved.spacing, value, "space.20"));
    if (!gapToken.exact && gap !== 0) diagnostics.push({ severity: "warning", path: `${path}.style.gap`, message: `Computed gap ${gap}px was preserved for Web and linked to the nearest shared spacing token.` });
    paddingTokens.forEach((token, index) => {
      if (!token.exact && paddingValues[index] !== 0) diagnostics.push({ severity: "warning", path: `${path}.style.padding`, message: "Computed padding was linked to the nearest shared spacing token." });
    });
    for (const property of source.unsupported) {
      diagnostics.push({ severity: "warning", path: `${path}.style.${property}`, message: `${property} remains unsupported and was not silently approximated.` });
    }
    if (source.hasImageSource) diagnostics.push({ severity: "warning", path: `${path}.source`, message: "Image bytes are not embedded by HTML/CSS import; add the image through Assets to preserve licensing and export policy." });
    const tracks = source.style.gridTemplateColumns.filter((value) => value > 0);
    const firstTrack = tracks[0] ?? 1;
    const layout: SemanticNode["layout"] = {
      axis: source.style.flexDirection.startsWith("row") ? "horizontal" : "vertical",
      width: "fill",
      height: "hug",
      align: alignment(source.style.alignItems),
      justify: justification(source.style.justifyContent),
      overflow: overflow(source.style.overflowY === "visible" ? source.style.overflowX : source.style.overflowY),
      columns: Math.max(1, Math.min(12, tracks.length || 1)),
      ...(tracks.length ? { gridTracks: tracks.slice(0, 12).map((value) => {
        const ratio = bounded(value / firstTrack, 0.01, 12);
        const integer = Math.round(ratio);
        return Math.abs(ratio - integer) <= 0.01 ? integer : Math.round(ratio * 1_000) / 1_000;
      }) } : {}),
      splitRatio: 0.5,
      gapToken: gapToken.key,
      gap,
      paddingToken: paddingTokens[0]!.key,
      paddingTokens: {
        top: paddingTokens[0]!.key,
        right: paddingTokens[1]!.key,
        bottom: paddingTokens[2]!.key,
        left: paddingTokens[3]!.key,
      },
    };
    const position = ["static", "relative", "sticky", "fixed"].includes(source.style.position)
      ? source.style.position as NonNullable<SemanticNode["web"]>["position"]
      : "static";
    return {
      id,
      kind,
      intent: { purpose: `Imported ${source.tag} element`, label, importance: "supporting" },
      layout,
      style: { role: kind === "action" ? "action" : kind === "text" ? "text" : "surface", emphasis: source.style.fontWeight >= 600 ? "strong" : "normal" },
      accessibility: { label, live: "off" },
      web: {
        display: grid ? "grid" : isContainer ? "flex" : "block",
        direction: source.style.flexDirection.startsWith("row") ? "row" : "column",
        wrap: wrapped ? "wrap" : "nowrap",
        position,
        ...(source.style.insetBlockStart !== null && (position === "sticky" || position === "fixed")
          ? { insetBlockStart: bounded(source.style.insetBlockStart, -2_000, 2_000) }
          : {}),
        overflowX: ["visible", "clip", "hidden", "auto", "scroll"].includes(source.style.overflowX) ? source.style.overflowX as NonNullable<SemanticNode["web"]>["overflowX"] : "visible",
        overflowY: ["visible", "clip", "hidden", "auto", "scroll"].includes(source.style.overflowY) ? source.style.overflowY as NonNullable<SemanticNode["web"]>["overflowY"] : "visible",
        ...(source.style.width > 0 && source.style.height > 0 ? { aspectRatio: bounded(source.style.width / source.style.height, 0.1, 10) } : {}),
        containerType: "normal",
        gridMinColumnWidth: tracks.length ? Math.max(80, Math.min(1_600, Math.round(Math.min(...tracks)))) : 240,
        gridMaxColumns: Math.max(1, Math.min(12, tracks.length || 4)),
        visual: visual(source.style),
        breakpointOverrides: {},
      },
      states: [],
      interactions: [],
      provenance: { author: "human", revision: 0 },
      children,
    };
  };

  const imported = roots.flatMap((root, index) => {
    const node = convert(root, 0, `screens.${screenId}.import.${index}`);
    return node ? [node] : [];
  });
  if (imported.length === 0) throw new Error("The HTML did not contain any supported visible elements.");
  const previousNodes = graph.screens[screenIndex]!.nodes;
  const flatten = (nodes: SemanticNode[]): SemanticNode[] => nodes.flatMap((node) => [node, ...flatten(node.children)]);
  const previousFlat = flatten(previousNodes);
  const importedFlat = flatten(imported);
  const previousPrimary = previousFlat.find((node) => node.kind === "primary-action");
  const importedAction = importedFlat.find((node) => node.kind === "action");
  const requiredInteractions = previousFlat.flatMap((node) => node.interactions)
    .filter((interaction, index, all) => all.findIndex((candidate) => candidate.event === interaction.event) === index);
  if (previousPrimary && importedAction) {
    importedAction.kind = "primary-action";
    importedAction.style.role = previousPrimary.style.role;
  } else if (previousPrimary) {
    imported.push(structuredClone(previousPrimary));
    diagnostics.push({ severity: "warning", path: `screens.${screenId}.nodes`, message: "The existing primary action was retained because the imported document did not include an actionable element required by this screen contract." });
  }
  const interactionTarget = importedAction ?? (previousPrimary ? flatten(imported).find((node) => node.id === previousPrimary.id) : undefined);
  if (interactionTarget && requiredInteractions.length > 0) {
    interactionTarget.interactions = requiredInteractions.map((interaction) => ({ ...interaction, requires: [...interaction.requires] }));
    diagnostics.push({ severity: "warning", path: `screens.${screenId}.interactions`, message: "Existing typed screen events were retained on the imported primary action so flows remain valid." });
  }
  candidate.screens[screenIndex]!.nodes = imported;
  const next = parseGraph(candidate);
  return { graph: next, changes: semanticDiff(graph, next), diagnostics, importedNodes: sequence };
}
