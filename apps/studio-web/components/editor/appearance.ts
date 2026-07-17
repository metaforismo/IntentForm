import { resolveTokenMode, type SemanticInterfaceGraph, type SemanticNode } from "@intentform/semantic-schema";
import type { CSSProperties } from "react";

type Appearance = NonNullable<SemanticNode["style"]["appearance"]>;
export type AppearanceColorBinding = Appearance["fills"][number] extends infer Fill
  ? Fill extends { color: infer Color } ? Color : never
  : never;

function resolveColor(binding: AppearanceColorBinding, graph: SemanticInterfaceGraph): string {
  const tokens = resolveTokenMode(graph.tokens);
  return binding.color ?? (binding.token ? tokens.colors[binding.token] : undefined) ?? "transparent";
}

function translucent(color: string, opacity: number): string {
  return opacity === 1 ? color : `color-mix(in srgb, ${color} ${Math.round(opacity * 10_000) / 100}%, transparent)`;
}

export function nodeAppearanceStyle(node: SemanticNode, graph: SemanticInterfaceGraph): CSSProperties {
  const appearance = node.style.appearance;
  const style: CSSProperties = node.layout.rotation ? { transform: `rotate(${node.layout.rotation}deg)` } : {};
  if (!appearance) return style;
  const tokens = resolveTokenMode(graph.tokens);
  const fills = appearance.fills.filter((fill) => fill.visible);
  if (fills.length === 1 && fills[0]?.type === "solid") {
    style.background = translucent(resolveColor(fills[0].color, graph), fills[0].opacity);
  } else if (fills.length > 0) {
    style.backgroundImage = fills.map((fill) => {
      if (fill.type === "solid") {
        const color = translucent(resolveColor(fill.color, graph), fill.opacity);
        return `linear-gradient(${color}, ${color})`;
      }
      return `linear-gradient(${fill.angle}deg, ${fill.stops.map((stop) => `${resolveColor(stop.color, graph)} ${Math.round(stop.position * 10_000) / 100}%`).join(", ")})`;
    }).join(", ");
  }
  if (appearance.stroke?.visible) {
    const color = resolveColor(appearance.stroke.color, graph);
    if (appearance.stroke.alignment === "outside") {
      style.outline = `${appearance.stroke.width}px ${appearance.stroke.style} ${color}`;
    } else {
      style.border = `${appearance.stroke.width}px ${appearance.stroke.style} ${color}`;
    }
  }
  if (appearance.radius) {
    const tokenRadius = appearance.radius.token ? tokens.radii[appearance.radius.token] : undefined;
    style.borderRadius = tokenRadius ?? `${appearance.radius.topLeft}px ${appearance.radius.topRight}px ${appearance.radius.bottomRight}px ${appearance.radius.bottomLeft}px`;
  }
  const effects = appearance.effects.filter((effect) => effect.visible);
  const shadows = effects.flatMap((effect) => effect.type === "shadow" || effect.type === "inner-shadow"
    ? [`${effect.type === "inner-shadow" ? "inset " : ""}${effect.x}px ${effect.y}px ${effect.blur}px ${effect.spread}px ${resolveColor(effect.color, graph)}`]
    : []);
  if (shadows.length > 0) style.boxShadow = shadows.join(", ");
  const blur = effects.find((effect) => effect.type === "blur");
  if (blur?.type === "blur") style.filter = `blur(${blur.radius}px)`;
  const backdrop = effects.find((effect) => effect.type === "backdrop-blur");
  if (backdrop?.type === "backdrop-blur") style.backdropFilter = `blur(${backdrop.radius}px)`;
  style.opacity = appearance.opacity;
  style.mixBlendMode = appearance.blendMode;
  const typography = appearance.typography;
  if (typography) {
    style.fontFamily = typography.family ?? (typography.familyToken ? tokens.fontFamilies[typography.familyToken] : undefined);
    style.fontStyle = typography.style;
    style.fontWeight = typography.weight ?? (typography.weightToken ? tokens.fontWeights[typography.weightToken] : undefined);
    style.fontSize = typography.size ?? (typography.sizeToken ? tokens.fontSizes[typography.sizeToken] : undefined);
    style.lineHeight = typography.lineHeight ? `${typography.lineHeight}px` : typography.lineHeightToken && tokens.lineHeights[typography.lineHeightToken] ? `${tokens.lineHeights[typography.lineHeightToken]}px` : undefined;
    style.letterSpacing = typography.letterSpacing ?? (typography.letterSpacingToken ? tokens.letterSpacing[typography.letterSpacingToken] : undefined);
    style.textAlign = typography.align;
    style.textTransform = typography.transform;
    if (typography.wrapping === "nowrap") style.whiteSpace = "nowrap";
    if (typography.wrapping === "balance") style.textWrap = "balance";
    if (typography.truncation !== "none") {
      style.overflow = "hidden";
      style.textOverflow = typography.truncation;
    }
    if (typography.maxLines) {
      style.display = "-webkit-box";
      style.WebkitBoxOrient = "vertical";
      style.WebkitLineClamp = typography.maxLines;
      style.overflow = "hidden";
    }
    if (typography.features.length > 0) style.fontFeatureSettings = typography.features.map((feature) => `"${feature}" 1`).join(", ");
  }
  return style;
}

export interface SelectionColor {
  key: string;
  color: string;
  token?: string;
  usages: number;
  nodes: number;
  opacity?: number;
  mixedOpacity: boolean;
  origins: Array<"fill" | "stroke">;
}

export function selectionColorKey(binding: AppearanceColorBinding, graph: SemanticInterfaceGraph): string {
  return `${binding.token ?? "literal"}:${resolveColor(binding, graph)}`;
}

export function selectionColors(nodes: readonly SemanticNode[], graph: SemanticInterfaceGraph): SelectionColor[] {
  const colors = new Map<string, SelectionColor & { nodeIds: Set<string>; opacities: Set<number> }>();
  const add = (nodeId: string, binding: AppearanceColorBinding, origin: "fill" | "stroke", opacity?: number) => {
    const color = resolveColor(binding, graph);
    const key = selectionColorKey(binding, graph);
    const existing = colors.get(key);
    if (existing) {
      existing.usages += 1;
      existing.nodeIds.add(nodeId);
      if (opacity !== undefined) existing.opacities.add(opacity);
      if (!existing.origins.includes(origin)) existing.origins.push(origin);
    } else {
      colors.set(key, {
        key,
        color,
        ...(binding.token ? { token: binding.token } : {}),
        usages: 1,
        nodes: 1,
        mixedOpacity: false,
        origins: [origin],
        nodeIds: new Set([nodeId]),
        opacities: new Set(opacity === undefined ? [] : [opacity]),
      });
    }
  };
  for (const node of nodes) {
    for (const fill of node.style.appearance?.fills ?? []) {
      if (!fill.visible) continue;
      if (fill.type === "solid") add(node.id, fill.color, "fill", fill.opacity);
      else for (const stop of fill.stops) add(node.id, stop.color, "fill", fill.opacity);
    }
    if (node.style.appearance?.stroke?.visible) add(node.id, node.style.appearance.stroke.color, "stroke");
  }
  return [...colors.values()].map(({ nodeIds, opacities, ...color }) => ({
    ...color,
    nodes: nodeIds.size,
    ...(opacities.size === 1 ? { opacity: [...opacities][0]! } : {}),
    mixedOpacity: opacities.size > 1,
  })).sort((left, right) => right.usages - left.usages || left.color.localeCompare(right.color));
}

export function replaceSelectionColor(
  node: SemanticNode,
  graph: SemanticInterfaceGraph,
  key: string,
  replacement: AppearanceColorBinding,
): void {
  const replace = (binding: AppearanceColorBinding): AppearanceColorBinding => selectionColorKey(binding, graph) === key
    ? structuredClone(replacement)
    : binding;
  for (const fill of node.style.appearance?.fills ?? []) {
    if (fill.type === "solid") fill.color = replace(fill.color);
    else for (const stop of fill.stops) stop.color = replace(stop.color);
  }
  const stroke = node.style.appearance?.stroke;
  if (stroke) stroke.color = replace(stroke.color);
}

export function setSelectionColorOpacity(node: SemanticNode, graph: SemanticInterfaceGraph, key: string, opacity: number): void {
  for (const fill of node.style.appearance?.fills ?? []) {
    const matches = fill.type === "solid"
      ? selectionColorKey(fill.color, graph) === key
      : fill.stops.some((stop) => selectionColorKey(stop.color, graph) === key);
    if (matches) fill.opacity = Math.min(1, Math.max(0, opacity));
  }
}
