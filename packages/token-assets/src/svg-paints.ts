export interface SvgPaint {
  value: string;
  normalized: string;
  usages: number;
  properties: Array<"fill" | "stroke">;
}

const PAINT_ATTRIBUTE = /\b(fill|stroke)\s*=\s*(["'])([^"']{1,64})\2/gi;
const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export function normalizeSvgHexColor(value: string): string | null {
  const match = value.trim().match(HEX_COLOR);
  if (!match) return null;
  const hex = match[1]!.toLowerCase();
  if (hex.length === 3 || hex.length === 4) return `#${[...hex].map((character) => character.repeat(2)).join("")}`;
  return `#${hex}`;
}

export function extractSvgPaints(source: string): SvgPaint[] {
  const paints = new Map<string, SvgPaint>();
  for (const match of source.matchAll(PAINT_ATTRIBUTE)) {
    const property = match[1]!.toLowerCase() as "fill" | "stroke";
    const value = match[3]!.trim();
    const normalized = normalizeSvgHexColor(value);
    if (!normalized) continue;
    const current = paints.get(normalized);
    if (current) {
      current.usages += 1;
      if (!current.properties.includes(property)) current.properties.push(property);
    } else {
      paints.set(normalized, { value, normalized, usages: 1, properties: [property] });
    }
  }
  return [...paints.values()];
}

export function replaceSvgPaint(
  source: string,
  target: string,
  replacement: string,
): { source: string; replacements: number } {
  const normalizedTarget = normalizeSvgHexColor(target);
  const normalizedReplacement = normalizeSvgHexColor(replacement);
  if (!normalizedTarget) throw new Error("SVG paint target must be a literal hexadecimal color");
  if (!normalizedReplacement || normalizedReplacement.length !== 7) {
    throw new Error("SVG paint replacement must be an opaque six-digit hexadecimal color");
  }
  const appliedReplacement = normalizedTarget.length === 9
    ? `${normalizedReplacement}${normalizedTarget.slice(7)}`
    : normalizedReplacement;
  let replacements = 0;
  const next = source.replace(PAINT_ATTRIBUTE, (attribute, _property: string, _quote: string, value: string) => {
    if (normalizeSvgHexColor(value) !== normalizedTarget) return attribute;
    replacements += 1;
    return attribute.replace(value, appliedReplacement);
  });
  return { source: next, replacements };
}
