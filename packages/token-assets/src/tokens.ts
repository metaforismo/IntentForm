import {
  GRAPH_LIMITS,
  resolveTokenMode,
  stableSerialize,
  tokenCollectionSchema,
  type ResolvedTokenMode,
  type TokenCollection,
} from "@intentform/semantic-schema";

export const DTCG_FORMAT_VERSION = "2025.10" as const;
export const INTENTFORM_DTCG_EXTENSION = "org.intentform.tokens" as const;

const MAX_DTCG_BYTES = 512_000;
const MAX_DTCG_DEPTH = 32;

type JsonObject = Record<string, unknown>;
type TokenGroup = keyof ResolvedTokenMode;

export interface DtcgDiagnostic {
  severity: "info" | "warning";
  code: string;
  path: string;
  message: string;
}

export interface DtcgImportResult {
  tokens: TokenCollection;
  diagnostics: DtcgDiagnostic[];
}

interface PreservedMetadata {
  rootExtensions?: JsonObject;
  tokens?: Record<string, { description?: string; extensions?: JsonObject }>;
  groups?: Record<string, { description?: string; deprecated?: boolean | string; extensions?: JsonObject }>;
}

interface IntentFormExtension {
  formatVersion?: string;
  defaultMode?: string;
  activeMode?: string;
  modes?: Record<string, {
    name: string;
    description?: string;
    values: ResolvedTokenMode;
  }>;
}

function record(value: unknown, path: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as JsonObject;
}

function jsonSize(input: unknown): number {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(input);
  } catch {
    throw new Error("DTCG input must be JSON-serializable");
  }
  if (serialized === undefined) throw new Error("DTCG input must be a JSON object");
  return new TextEncoder().encode(serialized).byteLength;
}

function normalizedName(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!normalized) throw new Error(`DTCG name cannot map to an IntentForm key: ${value}`);
  return normalized;
}

function internalKey(path: readonly string[], type: string): string {
  const prefix = type === "color" ? "color" : type === "dimension"
    ? path[0] === "radius" ? "radius" : "space"
    : "";
  if (!prefix) throw new Error(`Unsupported DTCG token type: ${type}`);
  const parts = path.map(normalizedName);
  if (parts[0] === prefix) return parts.join(".");
  return [prefix, ...parts].join(".");
}

function dtcgPathToInternal(reference: string, type: string): string {
  if (reference.startsWith("{") && reference.endsWith("}")) {
    return internalKey(reference.slice(1, -1).split("."), type);
  }
  if (reference.startsWith("#/")) {
    const parts = reference.slice(2).split("/").map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
    return internalKey(parts, type);
  }
  throw new Error(`Unsupported DTCG reference: ${reference}`);
}

function hexFromColor(value: unknown, path: string): string {
  const color = record(value, path);
  if (color.colorSpace !== "srgb" || !Array.isArray(color.components) || color.components.length < 3) {
    throw new Error(`${path} must be an sRGB color with three components`);
  }
  const components = color.components.slice(0, 3).map((component) => {
    if (typeof component !== "number" || !Number.isFinite(component) || component < 0 || component > 1) {
      throw new Error(`${path} contains an invalid sRGB component`);
    }
    return Math.round(component * 255).toString(16).padStart(2, "0");
  });
  if ("alpha" in color && (typeof color.alpha !== "number" || color.alpha !== 1)) {
    throw new Error(`${path} uses alpha, which the current IntentForm color token contract does not support`);
  }
  return `#${components.join("")}`;
}

function dimensionFromValue(value: unknown, path: string): number {
  const dimension = record(value, path);
  if (dimension.unit !== "px" || typeof dimension.value !== "number" || !Number.isFinite(dimension.value)) {
    throw new Error(`${path} must be a finite px dimension`);
  }
  return dimension.value;
}

function groupForKey(key: string): TokenGroup {
  if (key.startsWith("color.")) return "colors";
  if (key.startsWith("space.")) return "spacing";
  if (key.startsWith("radius.")) return "radii";
  throw new Error(`Unsupported token key: ${key}`);
}

function emptyValues(): ResolvedTokenMode {
  return { colors: {}, spacing: {}, radii: {} };
}

function normalizedGroupPath(path: readonly string[], type: string | undefined): string {
  const normalized = path.map(normalizedName);
  if (type === "color" && normalized[0] !== "color") return ["color", ...normalized].join(".");
  if (type === "dimension") {
    const prefix = normalized[0] === "radius" ? "radius" : "space";
    if (normalized[0] !== prefix) return [prefix, ...normalized].join(".");
  }
  return normalized.join(".");
}

function walkDtcg(
  group: JsonObject,
  path: string[],
  inheritedType: string | undefined,
  values: ResolvedTokenMode,
  aliases: Record<string, string>,
  deprecated: Record<string, boolean | string>,
  metadata: PreservedMetadata,
  depth: number,
  inheritedDeprecated?: boolean | string,
): void {
  if (depth > MAX_DTCG_DEPTH) throw new Error(`DTCG input exceeds ${MAX_DTCG_DEPTH} nested groups`);
  if ("$extends" in group) throw new Error(`DTCG group extension is not supported at ${path.join(".") || "$"}`);
  const groupType = typeof group.$type === "string" ? group.$type : inheritedType;
  const groupDeprecated = typeof group.$deprecated === "boolean" || typeof group.$deprecated === "string"
    ? group.$deprecated
    : inheritedDeprecated;
  if (path.length > 0 && (group.$description || group.$deprecated !== undefined || group.$extensions)) {
    metadata.groups ??= {};
    metadata.groups[normalizedGroupPath(path, groupType)] = {
      ...(typeof group.$description === "string" ? { description: group.$description } : {}),
      ...(typeof group.$deprecated === "boolean" || typeof group.$deprecated === "string"
        ? { deprecated: group.$deprecated }
        : {}),
      ...(group.$extensions ? { extensions: structuredClone(record(group.$extensions, `${path.join(".")}.$extensions`)) } : {}),
    };
  }
  for (const [name, raw] of Object.entries(group)) {
    if (name.startsWith("$")) continue;
    if (/[{}.]/.test(name)) throw new Error(`Invalid DTCG token or group name: ${name}`);
    const value = record(raw, [...path, name].join("."));
    if ("$value" in value || "$ref" in value) {
      const type = typeof value.$type === "string" ? value.$type : groupType;
      if (!type) throw new Error(`DTCG token ${[...path, name].join(".")} has no resolved $type`);
      const key = internalKey([...path, name], type);
      const groupName = groupForKey(key);
      if (Object.hasOwn(values[groupName], key) || Object.hasOwn(aliases, key)) {
        throw new Error(`Duplicate DTCG token after normalization: ${key}`);
      }
      const tokenValue = "$ref" in value ? value.$ref : value.$value;
      if (typeof tokenValue === "string" && ((tokenValue.startsWith("{") && tokenValue.endsWith("}")) || tokenValue.startsWith("#/"))) {
        aliases[key] = dtcgPathToInternal(tokenValue, type);
      } else if (type === "color") {
        values.colors[key] = hexFromColor(tokenValue, `${key}.$value`);
      } else if (type === "dimension") {
        const dimension = dimensionFromValue(tokenValue, `${key}.$value`);
        if (groupName === "spacing" && dimension <= 0) throw new Error(`Spacing token must be positive: ${key}`);
        if (groupName === "radii" && dimension < 0) throw new Error(`Radius token cannot be negative: ${key}`);
        values[groupName][key] = dimension;
      } else {
        throw new Error(`Unsupported DTCG token type: ${type}`);
      }
      const tokenDeprecated = typeof value.$deprecated === "boolean" || typeof value.$deprecated === "string"
        ? value.$deprecated
        : groupDeprecated;
      if (tokenDeprecated !== undefined) deprecated[key] = tokenDeprecated;
      if (value.$description || value.$extensions) {
        metadata.tokens ??= {};
        metadata.tokens[key] = {
          ...(typeof value.$description === "string" ? { description: value.$description } : {}),
          ...(value.$extensions ? { extensions: structuredClone(record(value.$extensions, `${key}.$extensions`)) } : {}),
        };
      }
    } else {
      walkDtcg(value, [...path, name], groupType, values, aliases, deprecated, metadata, depth + 1, groupDeprecated);
    }
  }
}

function validatedModeValues(value: unknown, modeId: string): ResolvedTokenMode {
  const mode = record(value, `${INTENTFORM_DTCG_EXTENSION}.modes.${modeId}.values`);
  return {
    colors: record(mode.colors ?? {}, `${modeId}.colors`) as Record<string, string>,
    spacing: record(mode.spacing ?? {}, `${modeId}.spacing`) as Record<string, number>,
    radii: record(mode.radii ?? {}, `${modeId}.radii`) as Record<string, number>,
  };
}

export function importDtcg(input: unknown): DtcgImportResult {
  if (jsonSize(input) > MAX_DTCG_BYTES) throw new Error(`DTCG input exceeds ${MAX_DTCG_BYTES} serialized bytes`);
  const root = record(input, "$" );
  const values = emptyValues();
  const aliases: Record<string, string> = {};
  const deprecated: Record<string, boolean | string> = {};
  const metadata: PreservedMetadata = {};
  walkDtcg(root, [], undefined, values, aliases, deprecated, metadata, 1);

  const rootExtensions = root.$extensions ? structuredClone(record(root.$extensions, "$.$extensions")) : {};
  const ownExtension = rootExtensions[INTENTFORM_DTCG_EXTENSION]
    ? record(rootExtensions[INTENTFORM_DTCG_EXTENSION], `$.$extensions.${INTENTFORM_DTCG_EXTENSION}`) as IntentFormExtension
    : undefined;
  if (ownExtension?.formatVersion !== undefined && ownExtension.formatVersion !== DTCG_FORMAT_VERSION) {
    throw new Error(`Unsupported IntentForm DTCG extension version: ${String(ownExtension.formatVersion)}`);
  }
  delete rootExtensions[INTENTFORM_DTCG_EXTENSION];
  if (Object.keys(rootExtensions).length > 0) metadata.rootExtensions = rootExtensions;

  const defaultMode = typeof ownExtension?.defaultMode === "string" ? ownExtension.defaultMode : "default";
  const activeMode = typeof ownExtension?.activeMode === "string" ? ownExtension.activeMode : defaultMode;
  const modes: TokenCollection["modes"] = {
    [defaultMode]: { name: "Default", values },
  };
  const extensionModes = ownExtension?.modes === undefined
    ? {}
    : record(ownExtension.modes, `$.$extensions.${INTENTFORM_DTCG_EXTENSION}.modes`);
  for (const [modeId, rawMode] of Object.entries(extensionModes)) {
    const mode = record(rawMode, `${INTENTFORM_DTCG_EXTENSION}.modes.${modeId}`);
    modes[modeId] = {
      name: typeof mode.name === "string" ? mode.name : modeId,
      ...(typeof mode.description === "string" ? { description: mode.description } : {}),
      values: validatedModeValues(mode.values ?? {}, modeId),
    };
  }
  const extensions: TokenCollection["extensions"] = {};
  if (Object.keys(metadata).length > 0) {
    extensions["org.intentform.dtcg-preserved"] = structuredClone(metadata) as unknown as TokenCollection["extensions"][string];
  }
  const tokens = tokenCollectionSchema.parse({
    defaultMode,
    activeMode,
    modes,
    aliases,
    deprecated,
    extensions,
  });
  for (const modeId of Object.keys(tokens.modes)) resolveTokenMode(tokens, modeId);
  return {
    tokens,
    diagnostics: [{
      severity: "info",
      code: "dtcg.imported.2025.10",
      path: "$",
      message: `Imported ${Object.values(values).reduce((count, group) => count + Object.keys(group).length, 0) + Object.keys(aliases).length} tokens across ${Object.keys(modes).length} mode(s).`,
    }],
  };
}

function colorValue(hex: string): JsonObject {
  const value = hex.slice(1);
  return {
    colorSpace: "srgb",
    components: [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255),
    hex: hex.toLowerCase(),
  };
}

function dtcgValue(key: string, value: string | number): JsonObject {
  if (key.startsWith("color.")) return { $type: "color", $value: colorValue(String(value)) };
  return { $type: "dimension", $value: { value, unit: "px" } };
}

function setNested(root: JsonObject, path: string[], value: JsonObject): void {
  let current = root;
  for (const part of path.slice(0, -1)) {
    current[part] ??= {};
    current = record(current[part], part);
  }
  current[path.at(-1)!] = value;
}

function applyTokenMetadata(token: JsonObject, key: string, tokens: TokenCollection, preserved: PreservedMetadata): void {
  const info = preserved.tokens?.[key];
  if (info?.description) token.$description = info.description;
  if (info?.extensions) token.$extensions = structuredClone(info.extensions);
  if (tokens.deprecated[key] !== undefined) token.$deprecated = tokens.deprecated[key];
}

function applyGroupMetadata(root: JsonObject, groups: PreservedMetadata["groups"]): void {
  for (const [path, info] of Object.entries(groups ?? {}).sort(([left], [right]) => left.localeCompare(right))) {
    const parts = path.split(".");
    let group = root;
    for (const part of parts) {
      group[part] ??= {};
      group = record(group[part], path);
    }
    if (info.description) group.$description = info.description;
    if (info.deprecated !== undefined) group.$deprecated = info.deprecated;
    if (info.extensions) group.$extensions = structuredClone(info.extensions);
  }
}

export function exportDtcg(tokensInput: TokenCollection): JsonObject {
  const tokens = tokenCollectionSchema.parse(tokensInput);
  const defaultValues = resolveTokenMode(tokens, tokens.defaultMode);
  const root: JsonObject = {};
  const preserved = record(tokens.extensions["org.intentform.dtcg-preserved"] ?? {}, "tokens.extensions.org.intentform.dtcg-preserved") as PreservedMetadata;
  for (const group of ["colors", "spacing", "radii"] as const) {
    for (const [key, value] of Object.entries(defaultValues[group]).sort(([left], [right]) => left.localeCompare(right))) {
      if (Object.hasOwn(tokens.aliases, key)) continue;
      const token = dtcgValue(key, value);
      applyTokenMetadata(token, key, tokens, preserved);
      setNested(root, key.split("."), token);
    }
  }
  for (const [key, target] of Object.entries(tokens.aliases).sort(([left], [right]) => left.localeCompare(right))) {
    const group = groupForKey(key);
    const resolved = defaultValues[group][key as never] as string | number;
    const token = dtcgValue(key, resolved);
    token.$value = `{${target}}`;
    applyTokenMetadata(token, key, tokens, preserved);
    setNested(root, key.split("."), token);
  }
  applyGroupMetadata(root, preserved.groups);
  const rootExtensions = structuredClone(preserved.rootExtensions ?? {});
  rootExtensions[INTENTFORM_DTCG_EXTENSION] = {
    formatVersion: DTCG_FORMAT_VERSION,
    defaultMode: tokens.defaultMode,
    activeMode: tokens.activeMode,
    modes: Object.fromEntries(Object.entries(tokens.modes)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([modeId, mode]) => [modeId, {
        name: mode.name,
        ...(mode.description ? { description: mode.description } : {}),
        values: mode.values,
      }])),
  };
  root.$extensions = rootExtensions;
  return root;
}

export function serializeDtcg(tokens: TokenCollection): string {
  return `${stableSerialize(exportDtcg(tokens))}\n`;
}

export function tokenCount(tokens: TokenCollection): number {
  const resolved = resolveTokenMode(tokens, tokens.defaultMode);
  return Object.values(resolved).reduce((count, group) => count + Object.keys(group).length, 0);
}

export const TOKEN_ASSET_LIMITS = {
  maxDtcgBytes: MAX_DTCG_BYTES,
  maxDtcgDepth: MAX_DTCG_DEPTH,
  maxTokensPerGroup: GRAPH_LIMITS.maxTokensPerGroup,
} as const;
