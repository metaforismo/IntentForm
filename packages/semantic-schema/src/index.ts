import { z } from "zod";
import {
  DEVICE_REGISTRY,
  deviceConfigurationSchema,
  resolveDeviceConfiguration,
} from "@intentform/device-registry";
import { synchronizeComponentInstances } from "./component-library.ts";

export type DeviceClass = "compact" | "regular";

/* One layout-viewport contract is shared by the editor, verifiers and both
   compilers. A viewport is regular only when it clears both compact limits;
   this keeps narrow portrait and short landscape layouts in the compact mode. */
export const DEVICE_CLASS_LIMITS = {
  compactMaxWidth: 390,
  compactMaxHeight: 700,
} as const;

export const CANONICAL_DEVICE_VIEWPORTS = {
  compactPhone: DEVICE_REGISTRY.find((entry) => entry.profile.id === "neutral.phone.compact")!.profile.viewport,
  regularPhone: DEVICE_REGISTRY.find((entry) => entry.profile.id === "neutral.phone.regular")!.profile.viewport,
  regularTablet: DEVICE_REGISTRY.find((entry) => entry.profile.id === "neutral.tablet.regular")!.profile.viewport,
} as const;

export const GRAPH_LIMITS = {
  maxSerializedBytes: 12_000_000,
  maxIdLength: 96,
  maxTextLength: 1_000,
  maxFixtureStringLength: 2_000,
  maxScreens: 128,
  maxNodesPerScreen: 256,
  maxChildrenPerNode: 128,
  maxNodeDepth: 16,
  maxTotalNodesPerScreen: 4_096,
  maxTotalNodes: 12_000,
  maxComponents: 128,
  maxComponentProperties: 32,
  maxComponentSlots: 16,
  maxComponentVariants: 32,
  maxComponentStates: 16,
  maxComponentInstanceDepth: 16,
  maxFlows: 32,
  maxStepsPerFlow: 128,
  maxContracts: 32,
  maxFixtures: 160,
  maxFieldsPerContract: 48,
  maxEventsPerContract: 48,
  maxInteractionsPerNode: 16,
  maxPatchOperations: 64,
  maxTokensPerGroup: 128,
  maxTokenModes: 16,
  maxTokenAliases: 256,
  maxAssets: 256,
  maxAssetVariants: 16,
  maxWebFrames: 12,
  maxWebBreakpoints: 12,
  maxWebBreakpointOverrides: 12,
  maxExpressionDepth: 12,
  maxDependencies: 128,
  maxDependencyExports: 512,
} as const;

// Block line separators and bidirectional controls as well as ASCII controls;
// graph-authored text is lowered into generated React and Swift source.
const controlCharacterPattern = /[\u0000-\u001F\u007F\u2028-\u202E\u2066-\u2069]/;
const boundedStringSchema = (maximum: number = GRAPH_LIMITS.maxTextLength) => z.string()
  .max(maximum)
  .refine((value) => !controlCharacterPattern.test(value), "Control characters are not allowed");
const safeTextSchema = (maximum: number = GRAPH_LIMITS.maxTextLength) => boundedStringSchema(maximum).min(1);
const idSchema = z.string()
  .min(1)
  .max(GRAPH_LIMITS.maxIdLength)
  .regex(/^[a-z][a-z0-9.-]*$/);
const identifierSchema = z.string()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/)
  .refine((value) => !["__proto__", "prototype", "constructor"].includes(value), "Reserved identifier");
const tokenKeySchema = z.string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9.-]*$/)
  .refine((value) => !["prototype", "constructor"].includes(value), "Reserved token key");
const overrideKeySchema = z.string()
  .min(1)
  .max(96)
  .regex(/^[a-z][a-zA-Z0-9.-]*$/)
  .refine((value) => !["prototype", "constructor", "__proto__"].includes(value), "Reserved override key");
const colorTokenKeySchema = tokenKeySchema.refine(
  (key) => key.startsWith("color."),
  "Color token keys must start with color.",
);
const spacingTokenKeySchema = tokenKeySchema.refine(
  (key) => key.startsWith("space."),
  "Spacing token keys must start with space.",
);
const radiusTokenKeySchema = tokenKeySchema.refine(
  (key) => key.startsWith("radius."),
  "Radius token keys must start with radius.",
);
const colorValueSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const exactSemverSchema = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
const packageIdSchema = z.string()
  .min(3)
  .max(160)
  .regex(/^@[a-z0-9][a-z0-9.-]*\/[a-z0-9][a-z0-9.-]*$/);
const assetStorageKeySchema = z.string()
  .min(72)
  .max(112)
  .regex(/^assets\/[a-f0-9]{64}\.[a-z0-9]{2,8}$/);
const jsonExtensionsSchema = z.record(
  z.string().min(1).max(160).refine((key) => !key.startsWith("$"), "Extension keys cannot start with $"),
  z.json(),
).refine((record) => Object.keys(record).length <= 64, "Extensions must contain at most 64 entries");
const visualStateSchema = z.enum(["idle", "loading", "empty", "failed", "completed"]);
const fixtureValueSchema = z.union([
  boundedStringSchema(GRAPH_LIMITS.maxFixtureStringLength),
  z.number().finite(),
  z.boolean(),
]);

const componentValueTypeSchema = z.enum(["string", "number", "boolean"]);
const componentBindingFieldSchema = z.enum([
  "intent.label",
  "intent.purpose",
  "accessibility.label",
  "accessibility.hint",
  "layout.fixedWidth",
  "layout.fixedHeight",
  "visible",
]);

const tokenModeValuesSchema = z.strictObject({
  colors: z.record(colorTokenKeySchema, colorValueSchema).refine(
    (record) => Object.keys(record).length <= GRAPH_LIMITS.maxTokensPerGroup,
    `Colors must contain at most ${GRAPH_LIMITS.maxTokensPerGroup} entries`,
  ),
  spacing: z.record(spacingTokenKeySchema, z.number().positive().max(512)).refine(
    (record) => Object.keys(record).length <= GRAPH_LIMITS.maxTokensPerGroup,
    `Spacing must contain at most ${GRAPH_LIMITS.maxTokensPerGroup} entries`,
  ),
  radii: z.record(radiusTokenKeySchema, z.number().nonnegative().max(256)).refine(
    (record) => Object.keys(record).length <= GRAPH_LIMITS.maxTokensPerGroup,
    `Radii must contain at most ${GRAPH_LIMITS.maxTokensPerGroup} entries`,
  ),
});

export const tokenCollectionSchema = z.strictObject({
  defaultMode: idSchema,
  activeMode: idSchema,
  modes: z.record(idSchema, z.strictObject({
    name: safeTextSchema(120),
    description: safeTextSchema(500).optional(),
    values: tokenModeValuesSchema,
  })).refine(
    (record) => Object.keys(record).length > 0 && Object.keys(record).length <= GRAPH_LIMITS.maxTokenModes,
    `Tokens require 1 through ${GRAPH_LIMITS.maxTokenModes} modes`,
  ),
  aliases: z.record(tokenKeySchema, tokenKeySchema).refine(
    (record) => Object.keys(record).length <= GRAPH_LIMITS.maxTokenAliases,
    `Tokens must contain at most ${GRAPH_LIMITS.maxTokenAliases} aliases`,
  ).default({}),
  deprecated: z.record(tokenKeySchema, z.union([z.boolean(), safeTextSchema(500)])).refine(
    (record) => Object.keys(record).length <= GRAPH_LIMITS.maxTokenAliases,
    `Tokens must contain at most ${GRAPH_LIMITS.maxTokenAliases} deprecation entries`,
  ).default({}),
  extensions: jsonExtensionsSchema.default({}),
});

export type TokenCollection = z.infer<typeof tokenCollectionSchema>;
export type ResolvedTokenMode = z.infer<typeof tokenModeValuesSchema>;

const tokenGroupForKey = (key: string): keyof ResolvedTokenMode => {
  if (key.startsWith("color.")) return "colors";
  if (key.startsWith("space.")) return "spacing";
  if (key.startsWith("radius.")) return "radii";
  throw new Error(`Unsupported token group: ${key}`);
};

export function resolveTokenMode(tokens: TokenCollection, requestedMode = tokens.activeMode): ResolvedTokenMode {
  const fallback = tokens.modes[tokens.defaultMode];
  const selected = tokens.modes[requestedMode];
  if (!fallback) throw new Error(`Unknown default token mode: ${tokens.defaultMode}`);
  if (!selected) throw new Error(`Unknown active token mode: ${requestedMode}`);
  const concrete: ResolvedTokenMode = {
    colors: { ...fallback.values.colors, ...selected.values.colors },
    spacing: { ...fallback.values.spacing, ...selected.values.spacing },
    radii: { ...fallback.values.radii, ...selected.values.radii },
  };
  const resolving = new Set<string>();
  const resolvedAliases = new Map<string, string | number>();
  const resolveAlias = (key: string): string | number => {
    const cached = resolvedAliases.get(key);
    if (cached !== undefined) return cached;
    if (resolving.has(key)) throw new Error(`Token alias cycle: ${[...resolving, key].join(" -> ")}`);
    resolving.add(key);
    const target = tokens.aliases[key];
    if (!target) throw new Error(`Unknown token alias: ${key}`);
    if (tokenGroupForKey(key) !== tokenGroupForKey(target)) {
      throw new Error(`Token alias type mismatch: ${key} -> ${target}`);
    }
    const group = tokenGroupForKey(target);
    const value = Object.hasOwn(concrete[group], target)
      ? concrete[group][target as never] as string | number
      : resolveAlias(target);
    resolving.delete(key);
    resolvedAliases.set(key, value);
    return value;
  };
  for (const key of Object.keys(tokens.aliases).sort()) {
    const group = tokenGroupForKey(key);
    (concrete[group] as Record<string, string | number>)[key] = resolveAlias(key);
  }
  return {
    colors: Object.fromEntries(Object.entries(concrete.colors).sort(([left], [right]) => left.localeCompare(right))),
    spacing: Object.fromEntries(Object.entries(concrete.spacing).sort(([left], [right]) => left.localeCompare(right))),
    radii: Object.fromEntries(Object.entries(concrete.radii).sort(([left], [right]) => left.localeCompare(right))),
  };
}

export const assetKindSchema = z.enum(["raster", "svg", "icon", "video", "audio", "font"]);
const assetMediaTypes: Record<z.infer<typeof assetKindSchema>, readonly string[]> = {
  raster: ["image/png", "image/jpeg", "image/gif", "image/webp"],
  svg: ["image/svg+xml"],
  icon: ["image/svg+xml"],
  video: ["video/mp4", "video/webm"],
  audio: ["audio/mpeg", "audio/ogg", "audio/wav"],
  font: ["font/woff", "font/woff2", "font/ttf", "font/otf"],
};
const assetMediaExtensions: Record<string, readonly string[]> = {
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/gif": [".gif"],
  "image/webp": [".webp"],
  "image/svg+xml": [".svg"],
  "video/mp4": [".mp4"],
  "video/webm": [".webm"],
  "audio/mpeg": [".mp3"],
  "audio/ogg": [".ogg"],
  "audio/wav": [".wav"],
  "font/woff": [".woff"],
  "font/woff2": [".woff2"],
  "font/ttf": [".ttf"],
  "font/otf": [".otf"],
};
const assetFileSchema = z.strictObject({
  digest: sha256Schema,
  mediaType: safeTextSchema(120),
  byteLength: z.number().int().positive().max(100_000_000),
  storageKey: assetStorageKeySchema,
  width: z.number().int().positive().max(100_000).optional(),
  height: z.number().int().positive().max(100_000).optional(),
  durationMs: z.number().int().positive().max(86_400_000).optional(),
});

export const assetDefinitionSchema = assetFileSchema.extend({
  id: idSchema,
  name: safeTextSchema(160),
  kind: assetKindSchema,
  variants: z.array(assetFileSchema.extend({ id: idSchema, label: safeTextSchema(120) }))
    .max(GRAPH_LIMITS.maxAssetVariants).default([]),
  license: z.strictObject({
    name: safeTextSchema(160),
    spdx: z.string().min(1).max(80).regex(/^[A-Za-z0-9.+-]+$/).optional(),
    sourceUrl: z.url().max(2_000).optional(),
    attribution: safeTextSchema(1_000).optional(),
    redistribution: z.enum(["allowed", "restricted", "unknown"]),
  }),
  exportPolicy: z.enum(["copy", "reference", "blocked"]),
  metadata: jsonExtensionsSchema.default({}),
});

export type AssetDefinition = z.infer<typeof assetDefinitionSchema>;

export function classifyDevice(viewport: { width: number; height: number }): DeviceClass {
  if (!Number.isFinite(viewport.width) || !Number.isFinite(viewport.height)
    || viewport.width <= 0 || viewport.height <= 0) {
    throw new RangeError("Device viewport dimensions must be finite positive numbers");
  }
  return viewport.width <= DEVICE_CLASS_LIMITS.compactMaxWidth
    || viewport.height <= DEVICE_CLASS_LIMITS.compactMaxHeight
    ? "compact"
    : "regular";
}

export const platformTargetSchema = z.enum([
  "react",
  "swiftui",
  "expo",
  "compose",
  "web",
]);

export const placementSchema = z.strictObject({
  compact: z.enum(["inline", "persistent-bottom"]),
  regular: z.enum(["inline", "persistent-bottom"]),
});

export const LEAF_NODE_KINDS = [
  "balance-summary",
  "transaction-list",
  "money-input",
  "recipient-identity",
  "primary-action",
  "secondary-action",
  "status-message",
  "receipt-summary",
] as const;

export const CONTAINER_NODE_KINDS = [
  "stack",
  "grid",
  "overlay",
  "scroll",
  "safe-area",
  "adaptive",
  "wrap",
  "split",
  "freeform",
  "page-flow",
] as const;

export type LeafNodeKind = typeof LEAF_NODE_KINDS[number];
export type ContainerNodeKind = typeof CONTAINER_NODE_KINDS[number];
export type SemanticNodeKind = LeafNodeKind | ContainerNodeKind;

export const semanticNodeKindSchema = z.enum([...LEAF_NODE_KINDS, ...CONTAINER_NODE_KINDS]);
const containerNodeKindSchema = z.enum(CONTAINER_NODE_KINDS);
const dimensionPolicySchema = z.enum(["hug", "fill", "fixed"]);
const alignmentSchema = z.enum(["start", "center", "end", "stretch"]);
const justificationSchema = z.enum(["start", "center", "end", "space-between"]);
const boundedDimensionSchema = z.number().finite().nonnegative().max(10_000);

export const webBreakpointSchema = z.strictObject({
  id: idSchema,
  label: safeTextSchema(120),
  minWidth: z.number().int().nonnegative().max(10_000),
  maxWidth: z.number().int().positive().max(10_000).optional(),
}).superRefine((breakpoint, context) => {
  if (breakpoint.maxWidth !== undefined && breakpoint.maxWidth < breakpoint.minWidth) {
    context.addIssue({ code: "custom", path: ["maxWidth"], message: "Breakpoint maximum width cannot be below its minimum width" });
  }
});

export const webFrameSchema = z.strictObject({
  id: idSchema,
  label: safeTextSchema(120),
  mode: z.enum(["fluid", "custom", "browser", "content"]),
  width: z.number().int().positive().max(10_000).optional(),
  height: z.number().int().positive().max(10_000).default(900),
  minWidth: z.number().int().positive().max(10_000).optional(),
  maxWidth: z.number().int().positive().max(10_000).optional(),
}).superRefine((frame, context) => {
  if (["custom", "browser"].includes(frame.mode) && frame.width === undefined) {
    context.addIssue({ code: "custom", path: ["width"], message: `${frame.mode} frames require an explicit width` });
  }
  if (frame.minWidth !== undefined && frame.maxWidth !== undefined && frame.minWidth > frame.maxWidth) {
    context.addIssue({ code: "custom", path: ["minWidth"], message: "Frame minimum width cannot exceed its maximum width" });
  }
  if (frame.width !== undefined && frame.minWidth !== undefined && frame.width < frame.minWidth) {
    context.addIssue({ code: "custom", path: ["width"], message: "Frame width cannot be below its minimum width" });
  }
  if (frame.width !== undefined && frame.maxWidth !== undefined && frame.width > frame.maxWidth) {
    context.addIssue({ code: "custom", path: ["width"], message: "Frame width cannot exceed its maximum width" });
  }
});

export const webProjectProfileSchema = z.strictObject({
  strategy: z.literal("responsive-web"),
  defaultFrame: idSchema,
  frames: z.array(webFrameSchema).min(1).max(GRAPH_LIMITS.maxWebFrames),
  breakpoints: z.array(webBreakpointSchema).min(1).max(GRAPH_LIMITS.maxWebBreakpoints),
  contentMaxWidth: z.number().int().positive().max(10_000).default(1200),
  inlinePaddingToken: spacingTokenKeySchema,
});

export const expoRenderStrategySchema = z.enum([
  "universal-react-native",
  "platform-native",
  "project-component",
]);

export const expoProjectProfileSchema = z.strictObject({
  strategy: z.literal("expo-router"),
  sdkVersion: z.literal("57.0.0"),
  slug: z.string().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  scheme: z.string().min(1).max(80).regex(/^[a-z][a-z0-9+.-]*$/),
  defaultRenderStrategy: z.literal("universal-react-native"),
  developmentBuild: z.boolean().default(false),
});

export const expoNodeAdapterSchema = z.discriminatedUnion("strategy", [
  z.strictObject({ strategy: z.literal("universal-react-native") }),
  z.strictObject({
    strategy: z.literal("platform-native"),
    adapter: idSchema,
  }),
  z.strictObject({
    strategy: z.literal("project-component"),
    componentId: idSchema,
  }),
]);

const webNodeStyleFields = {
  display: z.enum(["block", "flex", "grid"]),
  direction: z.enum(["row", "column"]),
  wrap: z.enum(["nowrap", "wrap"]),
  position: z.enum(["static", "relative", "sticky", "fixed"]),
  insetBlockStart: z.number().finite().min(-2_000).max(2_000),
  overflowX: z.enum(["visible", "clip", "hidden", "auto", "scroll"]),
  overflowY: z.enum(["visible", "clip", "hidden", "auto", "scroll"]),
  aspectRatio: z.number().finite().min(0.1).max(10),
  containerType: z.enum(["normal", "inline-size"]),
  gridMinColumnWidth: z.number().int().min(80).max(1_600),
  gridMaxColumns: z.number().int().min(1).max(12),
} as const;

export const webNodeStyleOverrideSchema = z.strictObject(Object.fromEntries(
  Object.entries(webNodeStyleFields).map(([key, schema]) => [key, schema.optional()]),
) as { [Key in keyof typeof webNodeStyleFields]: z.ZodOptional<(typeof webNodeStyleFields)[Key]> }).superRefine((override, context) => {
  if (override.display !== undefined && override.display !== "grid"
    && (override.gridMinColumnWidth !== undefined || override.gridMaxColumns !== undefined)) {
    context.addIssue({ code: "custom", path: ["display"], message: "Breakpoint grid column controls require grid display" });
  }
  if (override.position !== undefined && !["sticky", "fixed"].includes(override.position)
    && override.insetBlockStart !== undefined) {
    context.addIssue({ code: "custom", path: ["insetBlockStart"], message: "Breakpoint block inset requires sticky or fixed positioning" });
  }
});

export const webNodeLayoutSchema = z.strictObject({
  display: webNodeStyleFields.display.default("block"),
  direction: webNodeStyleFields.direction.default("column"),
  wrap: webNodeStyleFields.wrap.default("nowrap"),
  position: webNodeStyleFields.position.default("static"),
  insetBlockStart: webNodeStyleFields.insetBlockStart.optional(),
  overflowX: webNodeStyleFields.overflowX.default("visible"),
  overflowY: webNodeStyleFields.overflowY.default("visible"),
  aspectRatio: webNodeStyleFields.aspectRatio.optional(),
  containerType: webNodeStyleFields.containerType.default("normal"),
  gridMinColumnWidth: webNodeStyleFields.gridMinColumnWidth.default(240),
  gridMaxColumns: webNodeStyleFields.gridMaxColumns.default(4),
  breakpointOverrides: z.record(idSchema, webNodeStyleOverrideSchema).refine(
    (record) => Object.keys(record).length <= GRAPH_LIMITS.maxWebBreakpointOverrides,
    `Web layout must contain at most ${GRAPH_LIMITS.maxWebBreakpointOverrides} breakpoint overrides`,
  ).default({}),
}).superRefine((web, context) => {
  if (web.display !== "grid" && (web.gridMinColumnWidth !== 240 || web.gridMaxColumns !== 4)) {
    context.addIssue({ code: "custom", path: ["display"], message: "Grid column controls require grid display" });
  }
  if (!["sticky", "fixed"].includes(web.position) && web.insetBlockStart !== undefined) {
    context.addIssue({ code: "custom", path: ["insetBlockStart"], message: "Block inset requires sticky or fixed positioning" });
  }
});

export const semanticLayoutSchema = z.strictObject({
  axis: z.enum(["vertical", "horizontal", "overlay"]).default("vertical"),
  width: dimensionPolicySchema.default("fill"),
  height: dimensionPolicySchema.default("hug"),
  fixedWidth: boundedDimensionSchema.positive().optional(),
  fixedHeight: boundedDimensionSchema.positive().optional(),
  minWidth: boundedDimensionSchema.optional(),
  maxWidth: boundedDimensionSchema.optional(),
  minHeight: boundedDimensionSchema.optional(),
  maxHeight: boundedDimensionSchema.optional(),
  align: alignmentSchema.default("stretch"),
  justify: justificationSchema.default("start"),
  overflow: z.enum(["visible", "clip", "scroll"]).default("visible"),
  columns: z.number().int().min(1).max(12).default(2),
  splitRatio: z.number().finite().min(0.1).max(0.9).default(0.5),
  adaptive: z.strictObject({
    compact: containerNodeKindSchema.exclude(["adaptive"]),
    regular: containerNodeKindSchema.exclude(["adaptive"]),
  }).optional(),
  position: z.strictObject({
    x: z.number().finite().min(-10_000).max(10_000),
    y: z.number().finite().min(-10_000).max(10_000),
    z: z.number().int().min(-1_000).max(1_000).default(0),
  }).optional(),
  gapToken: tokenKeySchema.default("space.16"),
  paddingToken: tokenKeySchema.default("space.20"),
  placement: placementSchema.optional(),
}).superRefine((layout, context) => {
  for (const dimension of ["Width", "Height"] as const) {
    const minimum = layout[`min${dimension}`];
    const maximum = layout[`max${dimension}`];
    if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
      context.addIssue({
        code: "custom",
        path: [`min${dimension}`],
        message: `Minimum ${dimension.toLowerCase()} cannot exceed maximum ${dimension.toLowerCase()}`,
      });
    }
  }
});

export const componentOverrideSchema = z.discriminatedUnion("op", [
  z.strictObject({ op: z.literal("set-label"), target: idSchema, value: safeTextSchema(240) }),
  z.strictObject({ op: z.literal("set-purpose"), target: idSchema, value: safeTextSchema().min(3) }),
  z.strictObject({
    op: z.literal("set-importance"),
    target: idSchema,
    value: z.enum(["primary", "secondary", "supporting"]),
  }),
  z.strictObject({
    op: z.literal("set-emphasis"),
    target: idSchema,
    value: z.enum(["quiet", "normal", "strong"]),
  }),
  z.strictObject({ op: z.literal("set-gap-token"), target: idSchema, value: spacingTokenKeySchema }),
  z.strictObject({ op: z.literal("set-padding-token"), target: idSchema, value: spacingTokenKeySchema }),
  z.strictObject({ op: z.literal("set-included"), target: idSchema, value: z.boolean() }),
]);

const componentInstanceBaseSchema = z.strictObject({
  definitionId: idSchema,
  variant: identifierSchema.optional(),
  state: identifierSchema.optional(),
  props: z.record(identifierSchema, fixtureValueSchema).refine(
    (record) => Object.keys(record).length <= GRAPH_LIMITS.maxComponentProperties,
    `Component instance props must contain at most ${GRAPH_LIMITS.maxComponentProperties} entries`,
  ).default({}),
  overrides: z.array(componentOverrideSchema).max(GRAPH_LIMITS.maxPatchOperations).default([]),
});

export const expressionSchema: z.ZodType<Expression> = z.lazy(() =>
  z.discriminatedUnion("op", [
    z.strictObject({ op: z.literal("value"), value: fixtureValueSchema }),
    z.strictObject({ op: z.literal("field"), path: z.string().max(70).regex(/^data\.[a-zA-Z_][a-zA-Z0-9_]*$/) }),
    z.strictObject({ op: z.literal("eq"), left: expressionSchema, right: expressionSchema }),
    z.strictObject({ op: z.literal("not"), value: expressionSchema }),
  ]),
);

export type Expression =
  | { op: "value"; value: string | number | boolean }
  | { op: "field"; path: string }
  | { op: "eq"; left: Expression; right: Expression }
  | { op: "not"; value: Expression };

const semanticNodeBaseSchema = z.strictObject({
  id: idSchema,
  kind: semanticNodeKindSchema,
  intent: z.strictObject({
    purpose: safeTextSchema().min(3),
    label: safeTextSchema(240).optional(),
    importance: z.enum(["primary", "secondary", "supporting"]).default("supporting"),
  }),
  layout: semanticLayoutSchema,
  style: z.strictObject({
    role: tokenKeySchema.default("surface"),
    emphasis: z.enum(["quiet", "normal", "strong"]).default("normal"),
  }),
  accessibility: z.strictObject({
    label: safeTextSchema(240),
    hint: safeTextSchema(500).optional(),
    live: z.enum(["off", "polite", "assertive"]).default("off"),
  }),
  asset: z.strictObject({
    assetId: idSchema,
    variantId: idSchema.optional(),
    fit: z.enum(["contain", "cover", "fill", "none"]).default("contain"),
    focalPoint: z.strictObject({
      x: z.number().finite().min(0).max(1),
      y: z.number().finite().min(0).max(1),
    }).default({ x: 0.5, y: 0.5 }),
    decorative: z.boolean().default(false),
  }).optional(),
  web: webNodeLayoutSchema.optional(),
  expo: expoNodeAdapterSchema.optional(),
  states: z.array(z.strictObject({ name: visualStateSchema, visibleWhen: expressionSchema.optional() })).max(5).default([]),
  interactions: z.array(
    z.strictObject({
      event: identifierSchema,
      requires: z.array(identifierSchema).max(GRAPH_LIMITS.maxFieldsPerContract).default([]),
    }),
  ).max(GRAPH_LIMITS.maxInteractionsPerNode).default([]),
  platformOverrides: z
    .record(
      tokenKeySchema,
      z.record(overrideKeySchema, fixtureValueSchema).refine(
        (record) => Object.keys(record).length <= 32,
        "Record must contain at most 32 entries",
      ),
    )
    .refine((record) => Object.keys(record).length <= 8, "Platform overrides must contain at most 8 targets")
    .optional(),
  provenance: z.strictObject({
    author: z.enum(["human", "gpt-5.6", "system"]),
    revision: z.number().int().nonnegative(),
  }),
});

type SemanticNodeBase = z.infer<typeof semanticNodeBaseSchema>;

export interface ComponentInstance extends z.infer<typeof componentInstanceBaseSchema> {
  slots: Record<string, SemanticNode[]>;
}

export interface SemanticNode extends SemanticNodeBase {
  children: SemanticNode[];
  componentInstance?: ComponentInstance | undefined;
}

export const semanticNodeSchema: z.ZodType<SemanticNode> = z.lazy(() =>
  semanticNodeBaseSchema.extend({
    children: z.array(semanticNodeSchema).max(GRAPH_LIMITS.maxChildrenPerNode).default([]),
    componentInstance: componentInstanceBaseSchema.extend({
      slots: z.record(
        identifierSchema,
        z.array(semanticNodeSchema).max(GRAPH_LIMITS.maxChildrenPerNode),
      ).refine(
        (record) => Object.keys(record).length <= GRAPH_LIMITS.maxComponentSlots,
        `Component instance slots must contain at most ${GRAPH_LIMITS.maxComponentSlots} entries`,
      ).default({}),
    }).optional(),
  }).superRefine((node, context) => {
    const container = (CONTAINER_NODE_KINDS as readonly string[]).includes(node.kind);
    if (!container && node.children.length > 0) {
      context.addIssue({ code: "custom", path: ["children"], message: `Leaf node ${node.kind} cannot contain children` });
    }
    if (node.kind === "adaptive" && !node.layout.adaptive) {
      context.addIssue({ code: "custom", path: ["layout", "adaptive"], message: "Adaptive containers require compact and regular modes" });
    }
    if (node.kind !== "adaptive" && node.layout.adaptive) {
      context.addIssue({ code: "custom", path: ["layout", "adaptive"], message: "Only adaptive containers can declare compact and regular modes" });
    }
    const canResolveToFreeform = node.kind === "freeform"
      || (node.kind === "adaptive" && (
        node.layout.adaptive?.compact === "freeform"
        || node.layout.adaptive?.regular === "freeform"
      ));
    if (canResolveToFreeform) {
      node.children.forEach((child, index) => {
        if (!child.layout.position) {
          context.addIssue({
            code: "custom",
            path: ["children", index, "layout", "position"],
            message: "Containers that resolve to freeform require every child to have an explicit semantic position",
          });
        }
      });
    }
  }),
);

const componentPropertySchema = z.strictObject({
  name: identifierSchema,
  type: componentValueTypeSchema,
  required: z.boolean().default(false),
  default: fixtureValueSchema.optional(),
  bindings: z.array(z.strictObject({
    target: idSchema,
    field: componentBindingFieldSchema,
  })).min(1).max(16),
}).superRefine((property, context) => {
  if (property.default !== undefined && typeof property.default !== property.type) {
    context.addIssue({ code: "custom", path: ["default"], message: `Default value must be ${property.type}` });
  }
  for (const [index, binding] of property.bindings.entries()) {
    const expected = binding.field === "layout.fixedWidth" || binding.field === "layout.fixedHeight"
      ? "number"
      : binding.field === "visible" ? "boolean" : "string";
    if (property.type !== expected) {
      context.addIssue({
        code: "custom",
        path: ["bindings", index, "field"],
        message: `${binding.field} requires a ${expected} property`,
      });
    }
  }
});

const componentSlotSchema = z.strictObject({
  name: identifierSchema,
  target: idSchema,
  allowedKinds: z.array(semanticNodeKindSchema).min(1).max(LEAF_NODE_KINDS.length + CONTAINER_NODE_KINDS.length),
  required: z.boolean().default(false),
  maxChildren: z.number().int().min(1).max(GRAPH_LIMITS.maxChildrenPerNode).default(GRAPH_LIMITS.maxChildrenPerNode),
});

const componentModeSchema = z.strictObject({
  id: identifierSchema,
  label: safeTextSchema(120),
  overrides: z.array(componentOverrideSchema).max(GRAPH_LIMITS.maxPatchOperations).default([]),
});

export const componentDefinitionSchema = z.strictObject({
  id: idSchema,
  name: safeTextSchema(120),
  description: safeTextSchema(500),
  version: z.string().regex(/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/),
  template: semanticNodeSchema,
  properties: z.array(componentPropertySchema).max(GRAPH_LIMITS.maxComponentProperties).default([]),
  slots: z.array(componentSlotSchema).max(GRAPH_LIMITS.maxComponentSlots).default([]),
  variants: z.array(componentModeSchema).max(GRAPH_LIMITS.maxComponentVariants).default([]),
  defaultVariant: identifierSchema.optional(),
  states: z.array(componentModeSchema).max(GRAPH_LIMITS.maxComponentStates).default([]),
  defaultState: identifierSchema.optional(),
  deprecated: z.strictObject({
    message: safeTextSchema(500),
    replacementId: idSchema.optional(),
  }).optional(),
});

export const localComponentLibrarySchema = z.strictObject({
  abiVersion: z.literal("1.0.0"),
  id: idSchema,
  name: safeTextSchema(120),
  version: z.string().regex(/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/),
  definitions: z.array(componentDefinitionSchema).min(1).max(GRAPH_LIMITS.maxComponents),
}).superRefine((library, context) => {
  const seen = new Set<string>();
  library.definitions.forEach((definition, index) => {
    if (seen.has(definition.id)) {
      context.addIssue({ code: "custom", path: ["definitions", index, "id"], message: `Duplicate component id: ${definition.id}` });
    }
    seen.add(definition.id);
  });
});

export type ComponentOverride = z.infer<typeof componentOverrideSchema>;
export type ComponentDefinition = z.infer<typeof componentDefinitionSchema>;

export function parseLocalComponentLibrary(input: unknown) {
  return localComponentLibrarySchema.parse(input);
}

export interface SemanticNodeVisit {
  node: SemanticNode;
  parent: SemanticNode | null;
  depth: number;
  indexPath: number[];
}

export function walkSemanticNodes(
  roots: readonly SemanticNode[],
  visit: (entry: SemanticNodeVisit) => void,
): void {
  const walk = (nodes: readonly SemanticNode[], parent: SemanticNode | null, depth: number, path: number[]) => {
    for (const [index, node] of nodes.entries()) {
      const indexPath = [...path, index];
      visit({ node, parent, depth, indexPath });
      walk(node.children, node, depth + 1, indexPath);
    }
  };
  walk(roots, null, 1, []);
}

export function flattenSemanticNodes(roots: readonly SemanticNode[]): SemanticNode[] {
  const nodes: SemanticNode[] = [];
  const pending = [...roots].reverse();
  while (pending.length > 0) {
    const node = pending.pop()!;
    nodes.push(node);
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      pending.push(node.children[index]!);
    }
  }
  return nodes;
}

export function findSemanticNode(roots: readonly SemanticNode[], nodeId: string): SemanticNode | undefined {
  const pending = [...roots].reverse();
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (node.id === nodeId) return node;
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      pending.push(node.children[index]!);
    }
  }
  return undefined;
}

export function flattenGraphNodes(graph: Pick<SemanticInterfaceGraph, "screens">): SemanticNode[] {
  return graph.screens.flatMap((screen) => flattenSemanticNodes(screen.nodes));
}

export function findGraphNode(
  graph: Pick<SemanticInterfaceGraph, "screens">,
  nodeId: string,
): SemanticNode | undefined {
  for (const screen of graph.screens) {
    const node = findSemanticNode(screen.nodes, nodeId);
    if (node) return node;
  }
  return undefined;
}

export interface SemanticNodeLocation {
  screen: SemanticInterfaceGraph["screens"][number];
  node: SemanticNode;
  parent: SemanticNode | null;
  siblings: SemanticNode[];
  index: number;
}

export function findGraphNodeLocation(
  graph: Pick<SemanticInterfaceGraph, "screens">,
  nodeId: string,
): SemanticNodeLocation | undefined {
  for (const screen of graph.screens) {
    const visit = (siblings: SemanticNode[], parent: SemanticNode | null): SemanticNodeLocation | undefined => {
      for (const [index, node] of siblings.entries()) {
        if (node.id === nodeId) return { screen, node, parent, siblings, index };
        const nested = visit(node.children, node);
        if (nested) return nested;
      }
      return undefined;
    };
    const match = visit(screen.nodes, null);
    if (match) return match;
  }
  return undefined;
}

export function isContainerNode(node: SemanticNode): node is SemanticNode & { kind: ContainerNodeKind } {
  return (CONTAINER_NODE_KINDS as readonly string[]).includes(node.kind);
}

export const screenSchema = z.strictObject({
  id: z.string().min(1).max(64).regex(/^[a-z][a-z0-9-]*$/),
  title: safeTextSchema(160),
  purpose: safeTextSchema().min(3),
  route: z.string().max(200).regex(/^\/(?:[a-z0-9-]+(?:\/[a-z0-9-]+)*)?$/),
  nodes: z.array(semanticNodeSchema).min(1).max(GRAPH_LIMITS.maxNodesPerScreen),
});

export const uiContractSchema = z.strictObject({
  screenId: z.string().min(1).max(64).regex(/^[a-z][a-z0-9-]*$/),
  data: z.array(
    z.strictObject({
      name: identifierSchema,
      type: z.enum(["string", "number", "boolean", "money", "status"]),
      required: z.boolean().default(true),
    }),
  ).max(GRAPH_LIMITS.maxFieldsPerContract),
  events: z.array(
    z.strictObject({
      name: identifierSchema,
      payload: z.enum(["string", "number", "boolean"]).optional(),
    }),
  ).max(GRAPH_LIMITS.maxEventsPerContract),
  visualStates: z.array(visualStateSchema).min(1).max(5),
  fixtures: z.array(idSchema).max(10),
});

export const fixtureSetSchema = z.strictObject({
  id: idSchema,
  screenId: z.string().min(1).max(64).regex(/^[a-z][a-z0-9-]*$/),
  state: visualStateSchema,
  data: z.record(identifierSchema, fixtureValueSchema).refine(
    (record) => Object.keys(record).length <= GRAPH_LIMITS.maxFieldsPerContract,
    `Fixture data must contain at most ${GRAPH_LIMITS.maxFieldsPerContract} fields`,
  ),
});

/**
 * Immutable package provenance embedded in the graph. Package bytes remain in
 * the local content-addressed cache; compilers consume only the validated,
 * vendored definitions in this graph and never fetch from a registry.
 */
export const ecosystemDependencySchema = z.strictObject({
  id: packageIdSchema,
  version: exactSemverSchema,
  kind: z.enum(["component-library", "token-library", "plugin"]),
  manifestDigest: sha256Schema,
  artifactDigest: sha256Schema,
  publisherKeyId: z.string().min(1).max(160).regex(/^[a-zA-Z0-9._:-]+$/),
  visibility: z.enum(["public", "private", "local"]),
  registry: z.string().url().max(2_048).superRefine((value, context) => {
    const url = new URL(value);
    const loopback = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !loopback) {
      context.addIssue({ code: "custom", message: "Registry origins must use HTTPS or loopback HTTP" });
    }
    if (url.username || url.password) {
      context.addIssue({ code: "custom", message: "Registry URLs cannot contain credentials" });
    }
    if (url.hash) {
      context.addIssue({ code: "custom", message: "Registry URLs cannot contain fragments" });
    }
  }).nullable(),
  publishedAt: z.string().datetime({ offset: true }),
  sourceRevision: z.string().min(1).max(200),
  license: z.string().min(1).max(160),
  exports: z.array(
    z.string().min(1).max(200).regex(/^[a-z][a-z0-9.:/-]*$/),
  ).max(GRAPH_LIMITS.maxDependencyExports),
});
export type EcosystemDependency = z.infer<typeof ecosystemDependencySchema>;

export function isTransactionalScreen(
  screen: ScreenDefinition,
  contract?: UIContract,
): boolean {
  return (contract?.events.length ?? 0) > 0
    || flattenSemanticNodes(screen.nodes).some((node) => node.interactions.length > 0);
}

export const semanticInterfaceGraphSchema = z
  .strictObject({
    schemaVersion: z.literal("0.8.0"),
    product: z.strictObject({
      name: safeTextSchema(120),
      audience: z.array(safeTextSchema(240)).min(1).max(20),
      principles: z.array(safeTextSchema(500)).min(1).max(20),
    }),
    tokens: tokenCollectionSchema,
    assets: z.array(assetDefinitionSchema).max(GRAPH_LIMITS.maxAssets).default([]),
    dependencies: z.array(ecosystemDependencySchema).max(GRAPH_LIMITS.maxDependencies).default([]),
    devices: deviceConfigurationSchema,
    web: webProjectProfileSchema.optional(),
    expo: expoProjectProfileSchema.optional(),
    platforms: z.array(
      z.strictObject({
        target: platformTargetSchema,
        enabled: z.boolean(),
        capabilities: z.array(tokenKeySchema).max(32),
      }),
    ).max(5),
    components: z.array(componentDefinitionSchema).max(GRAPH_LIMITS.maxComponents),
    screens: z.array(screenSchema).min(1).max(GRAPH_LIMITS.maxScreens),
    flows: z.array(
      z.strictObject({
        id: idSchema,
        steps: z.array(z.strictObject({
          from: z.string().min(1).max(64).regex(/^[a-z][a-z0-9-]*$/),
          event: identifierSchema,
          to: z.string().min(1).max(64).regex(/^[a-z][a-z0-9-]*$/),
        })).min(1).max(GRAPH_LIMITS.maxStepsPerFlow),
      }),
    ).max(GRAPH_LIMITS.maxFlows),
    contracts: z.array(uiContractSchema).max(GRAPH_LIMITS.maxContracts),
    fixtures: z.array(fixtureSetSchema).max(GRAPH_LIMITS.maxFixtures),
  })
  .superRefine((graph, context) => {
    const addIssue = (message: string, path: Array<string | number> = []) => {
      context.addIssue({ code: "custom", message, path });
    };
    const checkUnique = (
      values: string[],
      label: string,
      path: Array<string | number>,
    ) => {
      const seen = new Set<string>();
      values.forEach((value, index) => {
        if (seen.has(value)) addIssue(`Duplicate ${label}: ${value}`, [...path, index]);
        seen.add(value);
      });
    };

    checkUnique(graph.screens.map((screen) => screen.id), "screen id", ["screens"]);
    checkUnique(graph.screens.map((screen) => screen.route), "screen route", ["screens"]);
    checkUnique(graph.components.map((component) => component.id), "component id", ["components"]);
    checkUnique(graph.platforms.map((platform) => platform.target), "platform target", ["platforms"]);
    checkUnique(graph.flows.map((flow) => flow.id), "flow id", ["flows"]);
    checkUnique(graph.contracts.map((contract) => contract.screenId), "contract screen", ["contracts"]);
    checkUnique(graph.fixtures.map((fixture) => fixture.id), "fixture id", ["fixtures"]);
    checkUnique(graph.assets.map((asset) => asset.id), "asset id", ["assets"]);
    checkUnique(graph.dependencies.map((dependency) => dependency.id), "dependency id", ["dependencies"]);
    try {
      resolveDeviceConfiguration(graph.devices);
    } catch (error) {
      addIssue(error instanceof Error ? error.message : "Device profile resolution failed", ["devices"]);
    }
    if (graph.web) {
      checkUnique(graph.web.frames.map((frame) => frame.id), "web frame id", ["web", "frames"]);
      checkUnique(graph.web.breakpoints.map((breakpoint) => breakpoint.id), "web breakpoint id", ["web", "breakpoints"]);
      if (!graph.web.frames.some((frame) => frame.id === graph.web?.defaultFrame)) {
        addIssue(`Unknown default web frame: ${graph.web.defaultFrame}`, ["web", "defaultFrame"]);
      }
      const orderedBreakpoints = [...graph.web.breakpoints].sort((left, right) => left.minWidth - right.minWidth);
      orderedBreakpoints.forEach((breakpoint, index) => {
        const previous = orderedBreakpoints[index - 1];
        if (previous && (previous.maxWidth === undefined || breakpoint.minWidth <= previous.maxWidth)) {
          addIssue(`Web breakpoint ranges overlap: ${previous.id} and ${breakpoint.id}`, ["web", "breakpoints"]);
        }
      });
    }

    let activeTokens: ResolvedTokenMode = { colors: {}, spacing: {}, radii: {} };
    if (!graph.tokens.modes[graph.tokens.defaultMode]) {
      addIssue(`Unknown default token mode: ${graph.tokens.defaultMode}`, ["tokens", "defaultMode"]);
    }
    if (!graph.tokens.modes[graph.tokens.activeMode]) {
      addIssue(`Unknown active token mode: ${graph.tokens.activeMode}`, ["tokens", "activeMode"]);
    }
    for (const modeId of Object.keys(graph.tokens.modes).sort()) {
      try {
        const resolved = resolveTokenMode(graph.tokens, modeId);
        if (modeId === graph.tokens.activeMode) activeTokens = resolved;
      } catch (error) {
        addIssue(error instanceof Error ? error.message : "Token mode resolution failed", ["tokens", "modes", modeId]);
      }
    }
    const allConcreteTokenKeys = new Set(Object.values(graph.tokens.modes).flatMap((mode) => [
      ...Object.keys(mode.values.colors),
      ...Object.keys(mode.values.spacing),
      ...Object.keys(mode.values.radii),
    ]));
    for (const key of Object.keys(graph.tokens.aliases)) {
      if (allConcreteTokenKeys.has(key)) {
        addIssue(`Token cannot be both concrete and an alias: ${key}`, ["tokens", "aliases", key]);
      }
    }
    for (const key of Object.keys(graph.tokens.deprecated)) {
      if (!allConcreteTokenKeys.has(key) && !Object.hasOwn(graph.tokens.aliases, key)) {
        addIssue(`Deprecated token does not exist: ${key}`, ["tokens", "deprecated", key]);
      }
    }

    const assetById = new Map(graph.assets.map((asset) => [asset.id, asset]));
    graph.assets.forEach((asset, assetIndex) => {
      const assetPath: Array<string | number> = ["assets", assetIndex];
      const validateFileMetadata = (
        file: Pick<AssetDefinition, "mediaType" | "storageKey">,
        path: Array<string | number>,
      ) => {
        if (!assetMediaTypes[asset.kind].includes(file.mediaType)) {
          addIssue(`Asset media type ${file.mediaType} does not match kind ${asset.kind}`, [...path, "mediaType"]);
        }
        const extensions = assetMediaExtensions[file.mediaType] ?? [];
        if (!extensions.some((extension) => file.storageKey.endsWith(extension))) {
          addIssue(`Asset storage extension does not match media type ${file.mediaType}`, [...path, "storageKey"]);
        }
      };
      validateFileMetadata(asset, assetPath);
      if (!asset.storageKey.includes(asset.digest)) {
        addIssue("Asset storage key must contain its SHA-256 digest", [...assetPath, "storageKey"]);
      }
      if (asset.exportPolicy === "copy" && asset.license.redistribution !== "allowed") {
        addIssue("Copy export requires a license that allows redistribution", [...assetPath, "exportPolicy"]);
      }
      checkUnique(asset.variants.map((variant) => variant.id), "asset variant id", [...assetPath, "variants"]);
      asset.variants.forEach((variant, variantIndex) => {
        validateFileMetadata(variant, [...assetPath, "variants", variantIndex]);
        if (!variant.storageKey.includes(variant.digest)) {
          addIssue("Asset variant storage key must contain its SHA-256 digest", [...assetPath, "variants", variantIndex, "storageKey"]);
        }
      });
    });

    const screenById = new Map(graph.screens.map((screen) => [screen.id, screen]));
    const contractByScreen = new Map(graph.contracts.map((contract) => [contract.screenId, contract]));
    const fixtureById = new Map(graph.fixtures.map((fixture) => [fixture.id, fixture]));
    const platformTargets = new Set(graph.platforms.map((platform) => platform.target));
    const webTarget = graph.platforms.find((platform) => platform.target === "web");
    const expoTarget = graph.platforms.find((platform) => platform.target === "expo");
    if (webTarget?.enabled && !graph.web) {
      addIssue("The enabled web target requires a responsive-web profile", ["web"]);
    }
    if (expoTarget?.enabled && !graph.expo) {
      addIssue("The enabled Expo target requires an Expo Router profile", ["expo"]);
    }
    if (graph.web && !Object.hasOwn(activeTokens.spacing, graph.web.inlinePaddingToken)) {
      addIssue(`Unknown web inline padding token: ${graph.web.inlinePaddingToken}`, ["web", "inlinePaddingToken"]);
    }
    const nodeIds = new Set<string>();
    const componentById = new Map(graph.components.map((component) => [component.id, component]));

    const validateNodeAsset = (node: SemanticNode, path: Array<string | number>) => {
      if (!node.asset) return;
      const asset = assetById.get(node.asset.assetId);
      if (!asset) {
        addIssue(`Node references unknown asset: ${node.asset.assetId}`, [...path, "asset", "assetId"]);
        return;
      }
      if (node.asset.variantId && !asset.variants.some((variant) => variant.id === node.asset?.variantId)) {
        addIssue(`Node references unknown asset variant: ${node.asset.assetId}.${node.asset.variantId}`, [...path, "asset", "variantId"]);
      }
      if (asset.kind === "font") {
        addIssue("Font assets cannot be bound as node content", [...path, "asset", "assetId"]);
      }
    };

    const validateNodeWeb = (node: SemanticNode, path: Array<string | number>) => {
      if (!node.web) return;
      if (!graph.web) {
        addIssue("Node web layout requires a responsive-web project profile", [...path, "web"]);
        return;
      }
      const breakpoints = new Set(graph.web.breakpoints.map((breakpoint) => breakpoint.id));
      for (const breakpointId of Object.keys(node.web.breakpointOverrides)) {
        if (!breakpoints.has(breakpointId)) {
          addIssue(`Node references unknown web breakpoint: ${breakpointId}`, [...path, "web", "breakpointOverrides", breakpointId]);
        }
      }
    };

    const validateNodeExpo = (node: SemanticNode, path: Array<string | number>) => {
      if (node.expo && !graph.expo) {
        addIssue("Node Expo adaptation requires an Expo Router project profile", [...path, "expo"]);
      }
    };

    const validateOverrideTargets = (
      overrides: readonly ComponentOverride[],
      nodesById: Map<string, SemanticNode>,
      rootId: string,
      path: Array<string | number>,
    ) => {
      overrides.forEach((override, index) => {
        if (!nodesById.has(override.target)) {
          addIssue(`Component override references unknown template node: ${override.target}`, [...path, index, "target"]);
        }
        if (override.op === "set-included" && override.target === rootId) {
          addIssue("A component override cannot remove the template root", [...path, index]);
        }
        if ((override.op === "set-gap-token" || override.op === "set-padding-token")
          && !Object.hasOwn(activeTokens.spacing, override.value)) {
          addIssue(`Unknown component spacing token: ${override.value}`, [...path, index, "value"]);
        }
      });
    };

    const validateComponentInstance = (
      instance: ComponentInstance,
      path: Array<string | number>,
      instanceDepth = 1,
    ) => {
      if (instanceDepth > GRAPH_LIMITS.maxComponentInstanceDepth) {
        addIssue(`Component instance nesting exceeds ${GRAPH_LIMITS.maxComponentInstanceDepth} levels`, path);
        return;
      }
      const definition = componentById.get(instance.definitionId);
      if (!definition) {
        addIssue(`Component instance references unknown definition: ${instance.definitionId}`, [...path, "definitionId"]);
        return;
      }
      const propertyByName = new Map(definition.properties.map((property) => [property.name, property]));
      for (const [name, value] of Object.entries(instance.props)) {
        const property = propertyByName.get(name);
        if (!property) {
          addIssue(`Component instance provides unknown property: ${instance.definitionId}.${name}`, [...path, "props", name]);
        } else if (typeof value !== property.type) {
          addIssue(`Component property ${instance.definitionId}.${name} must be ${property.type}`, [...path, "props", name]);
        }
      }
      definition.properties.forEach((property) => {
        if (property.required && property.default === undefined && instance.props[property.name] === undefined) {
          addIssue(`Component instance is missing required property: ${instance.definitionId}.${property.name}`, [...path, "props"]);
        }
      });
      if (instance.variant && !definition.variants.some((variant) => variant.id === instance.variant)) {
        addIssue(`Unknown component variant: ${instance.definitionId}.${instance.variant}`, [...path, "variant"]);
      }
      if (instance.state && !definition.states.some((state) => state.id === instance.state)) {
        addIssue(`Unknown component state: ${instance.definitionId}.${instance.state}`, [...path, "state"]);
      }
      const slotByName = new Map(definition.slots.map((slot) => [slot.name, slot]));
      for (const [name, children] of Object.entries(instance.slots)) {
        const slot = slotByName.get(name);
        if (!slot) {
          addIssue(`Component instance provides unknown slot: ${instance.definitionId}.${name}`, [...path, "slots", name]);
          continue;
        }
        if (children.length > slot.maxChildren) {
          addIssue(`Component slot ${instance.definitionId}.${name} exceeds ${slot.maxChildren} children`, [...path, "slots", name]);
        }
        children.forEach((child, childIndex) => {
          if (!slot.allowedKinds.includes(child.kind)) {
            addIssue(`Component slot ${instance.definitionId}.${name} does not accept ${child.kind}`, [...path, "slots", name, childIndex, "kind"]);
          }
          const visitNestedInstance = (node: SemanticNode, nestedPath: Array<string | number>) => {
            if (node.componentInstance) {
              validateComponentInstance(node.componentInstance, [...nestedPath, "componentInstance"], instanceDepth + 1);
            }
            node.children.forEach((nestedChild, nestedIndex) =>
              visitNestedInstance(nestedChild, [...nestedPath, "children", nestedIndex]));
          };
          visitNestedInstance(child, [...path, "slots", name, childIndex]);
        });
      }
      definition.slots.forEach((slot) => {
        if (slot.required && (instance.slots[slot.name]?.length ?? 0) === 0) {
          addIssue(`Component instance is missing required slot: ${instance.definitionId}.${slot.name}`, [...path, "slots"]);
        }
      });
      const templateNodes = flattenSemanticNodes([definition.template]);
      validateOverrideTargets(
        instance.overrides,
        new Map(templateNodes.map((node) => [node.id, node])),
        definition.template.id,
        [...path, "overrides"],
      );
    };

    const componentDependencies = new Map<string, Set<string>>();
    for (const [componentIndex, component] of graph.components.entries()) {
      const componentPath: Array<string | number> = ["components", componentIndex];
      const templateNodes = flattenSemanticNodes([component.template]);
      const templateById = new Map(templateNodes.map((node) => [node.id, node]));
      checkUnique(templateNodes.map((node) => node.id), "component template node id", [...componentPath, "template"]);
      checkUnique(component.properties.map((property) => property.name), "component property", [...componentPath, "properties"]);
      checkUnique(component.slots.map((slot) => slot.name), "component slot", [...componentPath, "slots"]);
      checkUnique(component.variants.map((variant) => variant.id), "component variant", [...componentPath, "variants"]);
      checkUnique(component.states.map((state) => state.id), "component state", [...componentPath, "states"]);
      if (templateNodes.length > GRAPH_LIMITS.maxTotalNodesPerScreen) {
        addIssue(`Component ${component.id} exceeds ${GRAPH_LIMITS.maxTotalNodesPerScreen} template nodes`, [...componentPath, "template"]);
      }
      if (component.defaultVariant && !component.variants.some((variant) => variant.id === component.defaultVariant)) {
        addIssue(`Unknown default component variant: ${component.id}.${component.defaultVariant}`, [...componentPath, "defaultVariant"]);
      }
      if (component.defaultState && !component.states.some((state) => state.id === component.defaultState)) {
        addIssue(`Unknown default component state: ${component.id}.${component.defaultState}`, [...componentPath, "defaultState"]);
      }
      component.properties.forEach((property, propertyIndex) => {
        property.bindings.forEach((binding, bindingIndex) => {
          if (!templateById.has(binding.target)) {
            addIssue(`Component property binding references unknown template node: ${binding.target}`, [...componentPath, "properties", propertyIndex, "bindings", bindingIndex, "target"]);
          }
        });
      });
      component.slots.forEach((slot, slotIndex) => {
        const target = templateById.get(slot.target);
        if (!target) {
          addIssue(`Component slot references unknown template node: ${slot.target}`, [...componentPath, "slots", slotIndex, "target"]);
        } else if (!isContainerNode(target)) {
          addIssue(`Component slot target must be a container: ${slot.target}`, [...componentPath, "slots", slotIndex, "target"]);
        }
      });
      component.variants.forEach((variant, variantIndex) => validateOverrideTargets(
        variant.overrides,
        templateById,
        component.template.id,
        [...componentPath, "variants", variantIndex, "overrides"],
      ));
      component.states.forEach((state, stateIndex) => validateOverrideTargets(
        state.overrides,
        templateById,
        component.template.id,
        [...componentPath, "states", stateIndex, "overrides"],
      ));
      walkSemanticNodes([component.template], ({ node, parent, depth, indexPath }) => {
        const nodePath = [...componentPath, "template", ...indexPath.flatMap((index, depthIndex) =>
          depthIndex === 0 ? [index] : ["children", index])];
        if (depth > GRAPH_LIMITS.maxNodeDepth) {
          addIssue(`Component template exceeds maximum node depth ${GRAPH_LIMITS.maxNodeDepth}`, nodePath);
        }
        validateNodeAsset(node, nodePath);
        validateNodeWeb(node, nodePath);
        validateNodeExpo(node, nodePath);
        if (!Object.hasOwn(activeTokens.spacing, node.layout.gapToken)) {
          addIssue(`Unknown spacing token: ${node.layout.gapToken}`, [...nodePath, "layout", "gapToken"]);
        }
        if (!Object.hasOwn(activeTokens.spacing, node.layout.paddingToken)) {
          addIssue(`Unknown spacing token: ${node.layout.paddingToken}`, [...nodePath, "layout", "paddingToken"]);
        }
        const parentResolvesToFreeform = parent?.kind === "freeform"
          || (parent?.kind === "adaptive" && (
            parent.layout.adaptive?.compact === "freeform"
            || parent.layout.adaptive?.regular === "freeform"
          ));
        if (node.layout.position && !parentResolvesToFreeform) {
          addIssue(`Node ${node.id} has a position outside a freeform relation`, [...nodePath, "layout", "position"]);
        }
        for (const target of Object.keys(node.platformOverrides ?? {})) {
          if (!platformTargets.has(target as PlatformTarget)) {
            addIssue(`Unknown platform override target: ${target}`, [...nodePath, "platformOverrides", target]);
          }
        }
      });
      if (component.deprecated?.replacementId) {
        if (component.deprecated.replacementId === component.id) {
          addIssue("A deprecated component cannot replace itself", [...componentPath, "deprecated", "replacementId"]);
        } else if (!componentById.has(component.deprecated.replacementId)) {
          addIssue(`Unknown component replacement: ${component.deprecated.replacementId}`, [...componentPath, "deprecated", "replacementId"]);
        }
      }
      const dependencies = new Set<string>();
      const visitAuthored = (node: SemanticNode, path: Array<string | number>) => {
        if (node.componentInstance) {
          dependencies.add(node.componentInstance.definitionId);
          validateComponentInstance(node.componentInstance, [...path, "componentInstance"]);
          Object.values(node.componentInstance.slots).flat().forEach((child, index) => visitAuthored(child, [...path, "componentInstance", "slots", index]));
        }
        node.children.forEach((child, index) => visitAuthored(child, [...path, "children", index]));
      };
      visitAuthored(component.template, [...componentPath, "template"]);
      componentDependencies.set(component.id, dependencies);
    }

    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visitComponentDependency = (componentId: string, trail: string[]) => {
      if (trail.length >= GRAPH_LIMITS.maxComponentInstanceDepth) {
        addIssue(
          `Component dependency nesting exceeds ${GRAPH_LIMITS.maxComponentInstanceDepth} levels: ${[...trail, componentId].join(" -> ")}`,
          ["components"],
        );
        return;
      }
      if (visiting.has(componentId)) {
        addIssue(`Component dependency cycle: ${[...trail, componentId].join(" -> ")}`, ["components"]);
        return;
      }
      if (visited.has(componentId)) return;
      visiting.add(componentId);
      for (const dependency of componentDependencies.get(componentId) ?? []) {
        if (componentById.has(dependency)) visitComponentDependency(dependency, [...trail, componentId]);
      }
      visiting.delete(componentId);
      visited.add(componentId);
    };
    graph.components.forEach((component) => visitComponentDependency(component.id, []));

    for (const [contractIndex, contract] of graph.contracts.entries()) {
      if (!screenById.has(contract.screenId)) {
        addIssue(`Unknown contract screen: ${contract.screenId}`, ["contracts", contractIndex, "screenId"]);
      }
      checkUnique(contract.data.map((field) => field.name), "contract field", ["contracts", contractIndex, "data"]);
      checkUnique(contract.events.map((event) => event.name), "contract event", ["contracts", contractIndex, "events"]);
      checkUnique(contract.visualStates, "contract visual state", ["contracts", contractIndex, "visualStates"]);
      checkUnique(contract.fixtures, "contract fixture reference", ["contracts", contractIndex, "fixtures"]);
    }

    type ExpressionValueType = "string" | "number" | "boolean" | "unknown";
    const visitExpression = (
      expression: Expression,
      fields: Map<string, ExpressionValueType>,
      path: Array<string | number>,
      depth = 1,
    ): ExpressionValueType => {
      if (depth > GRAPH_LIMITS.maxExpressionDepth) {
        addIssue(`Expression exceeds maximum depth ${GRAPH_LIMITS.maxExpressionDepth}`, path);
        return "unknown";
      }
      if (expression.op === "value") {
        return typeof expression.value === "number"
          ? "number"
          : typeof expression.value === "boolean"
            ? "boolean"
            : "string";
      }
      if (expression.op === "field") {
        const field = expression.path.slice("data.".length);
        const fieldType = fields.get(field);
        if (!fieldType) addIssue(`Expression references unknown contract field: ${field}`, path);
        return fieldType ?? "unknown";
      }
      if (expression.op === "eq") {
        const left = visitExpression(expression.left, fields, [...path, "left"], depth + 1);
        const right = visitExpression(expression.right, fields, [...path, "right"], depth + 1);
        if (left !== "unknown" && right !== "unknown" && left !== right) {
          addIssue(`Expression compares incompatible ${left} and ${right} values`, path);
        }
        return "boolean";
      }
      const operand = visitExpression(expression.value, fields, [...path, "value"], depth + 1);
      if (operand !== "unknown" && operand !== "boolean") {
        addIssue(`Expression not requires a boolean value, received ${operand}`, path);
      }
      return "boolean";
    };

    let totalNodeCount = 0;
    for (const [screenIndex, screen] of graph.screens.entries()) {
      const contract = contractByScreen.get(screen.id);
      const contractFields = new Set(contract?.data.map((field) => field.name) ?? []);
      const expressionFields = new Map<string, ExpressionValueType>(contract?.data.map((field) => [
        field.name,
        field.type === "number" ? "number" : field.type === "boolean" ? "boolean" : "string",
      ]) ?? []);
      const contractEvents = new Set(contract?.events.map((event) => event.name) ?? []);
      const visualStates = new Set(contract?.visualStates ?? []);
      const screenNodes = flattenSemanticNodes(screen.nodes);
      const primaryActions = screenNodes.filter((node) => node.kind === "primary-action");
      const transactional = isTransactionalScreen(screen, contract);

      if (primaryActions.length > 1) {
        addIssue(`Screen ${screen.id} has more than one primary action`, ["screens", screenIndex, "nodes"]);
      }
      if (transactional && primaryActions.length !== 1) {
        addIssue(`Transactional screen ${screen.id} must have exactly one primary action`, ["screens", screenIndex, "nodes"]);
      }

      if (screenNodes.length > GRAPH_LIMITS.maxTotalNodesPerScreen) {
        addIssue(
          `Screen ${screen.id} exceeds ${GRAPH_LIMITS.maxTotalNodesPerScreen} total nodes`,
          ["screens", screenIndex, "nodes"],
        );
      }
      totalNodeCount += screenNodes.length;

      walkSemanticNodes(screen.nodes, ({ node, parent, depth, indexPath }) => {
        const nodePath: Array<string | number> = ["screens", screenIndex, "nodes", indexPath[0]!];
        for (const childIndex of indexPath.slice(1)) nodePath.push("children", childIndex);
        if (depth > GRAPH_LIMITS.maxNodeDepth) {
          addIssue(`Node tree exceeds maximum depth ${GRAPH_LIMITS.maxNodeDepth}`, nodePath);
        }
        if (nodeIds.has(node.id)) addIssue(`Duplicate node id: ${node.id}`, [...nodePath, "id"]);
        nodeIds.add(node.id);
        if (node.componentInstance) {
          validateComponentInstance(node.componentInstance, [...nodePath, "componentInstance"]);
        }

        const parentResolvesToFreeform = parent?.kind === "freeform"
          || (parent?.kind === "adaptive" && (
            parent.layout.adaptive?.compact === "freeform"
            || parent.layout.adaptive?.regular === "freeform"
          ));
        if (node.layout.position && !parentResolvesToFreeform) {
          addIssue(
            `Node ${node.id} has a position outside a freeform relation`,
            [...nodePath, "layout", "position"],
          );
        }

        validateNodeAsset(node, nodePath);
        validateNodeWeb(node, nodePath);
        validateNodeExpo(node, nodePath);
        if (!Object.hasOwn(activeTokens.spacing, node.layout.gapToken)) {
          addIssue(`Unknown spacing token: ${node.layout.gapToken}`, [...nodePath, "layout", "gapToken"]);
        }
        if (!Object.hasOwn(activeTokens.spacing, node.layout.paddingToken)) {
          addIssue(`Unknown spacing token: ${node.layout.paddingToken}`, [...nodePath, "layout", "paddingToken"]);
        }
        for (const target of Object.keys(node.platformOverrides ?? {})) {
          if (!platformTargets.has(target as PlatformTarget)) {
            addIssue(`Unknown platform override target: ${target}`, [...nodePath, "platformOverrides", target]);
          }
        }

        if (!contract && (node.interactions.length > 0 || node.states.length > 0)) {
          addIssue(`Screen ${screen.id} needs a contract for stateful or interactive nodes`, nodePath);
        }
        checkUnique(node.interactions.map((interaction) => interaction.event), "node interaction event", [...nodePath, "interactions"]);
        checkUnique(node.states.map((state) => state.name), "node visual state", [...nodePath, "states"]);

        for (const [interactionIndex, interaction] of node.interactions.entries()) {
          const interactionPath = [...nodePath, "interactions", interactionIndex];
          if (!contractEvents.has(interaction.event)) {
            addIssue(`Interaction references undeclared event: ${screen.id}.${interaction.event}`, [...interactionPath, "event"]);
          }
          checkUnique(interaction.requires, "required interaction field", [...interactionPath, "requires"]);
          for (const [fieldIndex, field] of interaction.requires.entries()) {
            if (!contractFields.has(field)) {
              addIssue(`Interaction requires unknown contract field: ${field}`, [...interactionPath, "requires", fieldIndex]);
            }
          }
        }

        for (const [stateIndex, state] of node.states.entries()) {
          const statePath = [...nodePath, "states", stateIndex];
          if (contract && !visualStates.has(state.name)) {
            addIssue(`Node state is not declared by contract: ${screen.id}.${state.name}`, [...statePath, "name"]);
          }
          if (state.visibleWhen) {
            visitExpression(state.visibleWhen, expressionFields, [...statePath, "visibleWhen"]);
          } else if (contract && !contract.data.some((field) => field.type === "status")) {
            addIssue(`Node state without an expression requires a status field: ${screen.id}.${state.name}`, statePath);
          }
        }
      });
    }

    if (totalNodeCount > GRAPH_LIMITS.maxTotalNodes) {
      addIssue(`Graph exceeds ${GRAPH_LIMITS.maxTotalNodes} total nodes`, ["screens"]);
    }

    const fixtureStateKeys = new Set<string>();
    const moneyPattern = /^-?(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/;
    for (const [fixtureIndex, fixture] of graph.fixtures.entries()) {
      const fixturePath: Array<string | number> = ["fixtures", fixtureIndex];
      const compositeKey = `${fixture.screenId}\u0000${fixture.state}`;
      if (fixtureStateKeys.has(compositeKey)) {
        addIssue(`Duplicate fixture screen/state: ${fixture.screenId}.${fixture.state}`, fixturePath);
      }
      fixtureStateKeys.add(compositeKey);

      if (fixture.id !== `${fixture.screenId}.${fixture.state}`) {
        addIssue(`Fixture id must be ${fixture.screenId}.${fixture.state}`, [...fixturePath, "id"]);
      }
      if (!screenById.has(fixture.screenId)) {
        addIssue(`Unknown fixture screen: ${fixture.screenId}`, [...fixturePath, "screenId"]);
      }
      const contract = contractByScreen.get(fixture.screenId);
      if (!contract) {
        addIssue(`Fixture screen has no contract: ${fixture.screenId}`, [...fixturePath, "screenId"]);
        continue;
      }
      if (!contract.visualStates.includes(fixture.state)) {
        addIssue(`Fixture state is not declared by contract: ${fixture.screenId}.${fixture.state}`, [...fixturePath, "state"]);
      }
      if (!contract.fixtures.includes(fixture.id)) {
        addIssue(`Fixture is not referenced by its contract: ${fixture.id}`, fixturePath);
      }

      const fields = new Map(contract.data.map((field) => [field.name, field]));
      for (const key of Object.keys(fixture.data)) {
        if (!fields.has(key)) addIssue(`Fixture contains unknown contract field: ${fixture.screenId}.${key}`, [...fixturePath, "data", key]);
      }
      for (const field of contract.data) {
        const value = fixture.data[field.name];
        if (value === undefined) {
          if (field.required) addIssue(`Fixture is missing required field: ${fixture.screenId}.${field.name}`, [...fixturePath, "data"]);
          continue;
        }
        const typeMatches = field.type === "boolean"
          ? typeof value === "boolean"
          : field.type === "number"
            ? typeof value === "number" && Number.isFinite(value)
            : typeof value === "string";
        if (!typeMatches) {
          addIssue(`Fixture field has invalid ${field.type} value: ${fixture.screenId}.${field.name}`, [...fixturePath, "data", field.name]);
          continue;
        }
        if (field.type === "money" && (typeof value !== "string" || !moneyPattern.test(value))) {
          addIssue(`Fixture money field is not a bounded decimal: ${fixture.screenId}.${field.name}`, [...fixturePath, "data", field.name]);
        }
        if (field.type === "status" && value !== fixture.state) {
          addIssue(`Fixture status must match its visual state: ${fixture.screenId}.${fixture.state}`, [...fixturePath, "data", field.name]);
        }
      }
    }

    for (const [contractIndex, contract] of graph.contracts.entries()) {
      for (const [referenceIndex, fixtureId] of contract.fixtures.entries()) {
        const fixture = fixtureById.get(fixtureId);
        if (!fixture) {
          addIssue(`Contract references unknown fixture: ${fixtureId}`, ["contracts", contractIndex, "fixtures", referenceIndex]);
        } else if (fixture.screenId !== contract.screenId) {
          addIssue(`Contract fixture belongs to another screen: ${fixtureId}`, ["contracts", contractIndex, "fixtures", referenceIndex]);
        }
      }
    }

    const routedEvents = new Set<string>();
    for (const [flowIndex, flow] of graph.flows.entries()) {
      for (const [stepIndex, step] of flow.steps.entries()) {
        const stepPath: Array<string | number> = ["flows", flowIndex, "steps", stepIndex];
        const source = screenById.get(step.from);
        if (!source || !screenById.has(step.to)) {
          addIssue(`Flow ${flow.id} references an unknown screen`, stepPath);
          continue;
        }
        const contract = contractByScreen.get(step.from);
        if (!contract?.events.some((event) => event.name === step.event)) {
          addIssue(`Flow event is not declared by source contract: ${step.from}.${step.event}`, [...stepPath, "event"]);
        }
        if (!flattenSemanticNodes(source.nodes).some((node) =>
          node.interactions.some((interaction) => interaction.event === step.event))) {
          addIssue(`Flow event is not emitted by a source node: ${step.from}.${step.event}`, [...stepPath, "event"]);
        }
        const routeKey = `${step.from}\u0000${step.event}`;
        if (routedEvents.has(routeKey)) {
          addIssue(`Ambiguous flow destination for event: ${step.from}.${step.event}`, stepPath);
        }
        routedEvents.add(routeKey);
      }
    }
  });

export type PlatformTarget = z.infer<typeof platformTargetSchema>;
export type ExpoRenderStrategy = z.infer<typeof expoRenderStrategySchema>;
export type ExpoNodeAdapter = z.infer<typeof expoNodeAdapterSchema>;
export type ExpoProjectProfile = z.infer<typeof expoProjectProfileSchema>;
export type ScreenDefinition = z.infer<typeof screenSchema>;
export type SemanticInterfaceGraph = z.infer<typeof semanticInterfaceGraphSchema>;
export type UIContract = z.infer<typeof uiContractSchema>;

export const graphPatchSchema = z.strictObject({
  id: idSchema,
  rationale: safeTextSchema(1_000),
  operations: z.array(
    z.discriminatedUnion("op", [
      z.strictObject({
        op: z.literal("set-placement"),
        target: idSchema,
        compact: z.enum(["inline", "persistent-bottom"]),
        regular: z.enum(["inline", "persistent-bottom"]),
      }),
      z.strictObject({ op: z.literal("set-label"), target: idSchema, label: safeTextSchema(240) }),
      z.strictObject({ op: z.literal("set-purpose"), target: idSchema, purpose: safeTextSchema().min(3) }),
      z.strictObject({
        op: z.literal("set-emphasis"),
        target: idSchema,
        emphasis: z.enum(["quiet", "normal", "strong"]),
      }),
      z.strictObject({ op: z.literal("set-gap-token"), target: idSchema, token: spacingTokenKeySchema }),
      z.strictObject({ op: z.literal("set-padding-token"), target: idSchema, token: spacingTokenKeySchema }),
      z.strictObject({
        op: z.literal("set-layout"),
        target: idSchema,
        axis: z.enum(["vertical", "horizontal", "overlay"]).optional(),
        width: dimensionPolicySchema.optional(),
        height: dimensionPolicySchema.optional(),
        fixedWidth: boundedDimensionSchema.positive().nullable().optional(),
        fixedHeight: boundedDimensionSchema.positive().nullable().optional(),
        minWidth: boundedDimensionSchema.nullable().optional(),
        maxWidth: boundedDimensionSchema.nullable().optional(),
        minHeight: boundedDimensionSchema.nullable().optional(),
        maxHeight: boundedDimensionSchema.nullable().optional(),
        align: alignmentSchema.optional(),
        justify: justificationSchema.optional(),
        overflow: z.enum(["visible", "clip", "scroll"]).optional(),
        columns: z.number().int().min(1).max(12).optional(),
        splitRatio: z.number().finite().min(0.1).max(0.9).optional(),
        adaptive: z.strictObject({
          compact: containerNodeKindSchema.exclude(["adaptive"]),
          regular: containerNodeKindSchema.exclude(["adaptive"]),
        }).nullable().optional(),
        position: z.strictObject({
          x: z.number().finite().min(-10_000).max(10_000),
          y: z.number().finite().min(-10_000).max(10_000),
          z: z.number().int().min(-1_000).max(1_000).default(0),
        }).nullable().optional(),
      }).refine((operation) => Object.keys(operation).some((key) => !["op", "target"].includes(key)), {
        message: "set-layout requires at least one layout field",
      }),
      z.strictObject({
        op: z.literal("move-node"),
        target: idSchema,
        screenId: z.string().min(1).max(64).regex(/^[a-z][a-z0-9-]*$/),
        parent: idSchema.nullable(),
        index: z.number().int().nonnegative().max(GRAPH_LIMITS.maxChildrenPerNode).optional(),
      }),
      z.strictObject({
        op: z.literal("set-color-token"),
        token: colorTokenKeySchema,
        value: colorValueSchema,
      }),
      z.strictObject({
        op: z.literal("set-token-mode"),
        mode: idSchema,
      }),
      z.strictObject({
        op: z.literal("bind-asset"),
        target: idSchema,
        assetId: idSchema,
        variantId: idSchema.optional(),
        fit: z.enum(["contain", "cover", "fill", "none"]).default("contain"),
        focalPoint: z.strictObject({
          x: z.number().finite().min(0).max(1),
          y: z.number().finite().min(0).max(1),
        }).default({ x: 0.5, y: 0.5 }),
        decorative: z.boolean().default(false),
      }),
      z.strictObject({ op: z.literal("clear-asset"), target: idSchema }),
      z.strictObject({
        op: z.literal("set-web-layout"),
        target: idSchema,
        layout: webNodeLayoutSchema.nullable(),
      }),
      z.strictObject({
        op: z.literal("set-fixture-value"),
        screenId: z.string().min(1).max(64).regex(/^[a-z][a-z0-9-]*$/),
        state: visualStateSchema,
        field: identifierSchema,
        value: fixtureValueSchema,
      }),
    ]),
  ).min(1).max(GRAPH_LIMITS.maxPatchOperations),
});

export type GraphPatch = z.infer<typeof graphPatchSchema>;

export function parseGraph(input: unknown): SemanticInterfaceGraph {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(input);
  } catch {
    throw new Error("Graph input must be JSON-serializable");
  }
  if (serialized === undefined) throw new Error("Graph input must be a JSON object");
  if (new TextEncoder().encode(serialized).byteLength > GRAPH_LIMITS.maxSerializedBytes) {
    throw new Error(`Graph input exceeds ${GRAPH_LIMITS.maxSerializedBytes} serialized bytes`);
  }
  const authored = semanticInterfaceGraphSchema.parse(input);
  const synchronized = synchronizeComponentInstances(authored);
  return synchronized === authored ? authored : semanticInterfaceGraphSchema.parse(synchronized);
}

export function setFixtureValue(
  graph: SemanticInterfaceGraph,
  screenId: string,
  state: "idle" | "loading" | "empty" | "failed" | "completed",
  fieldName: string,
  value: string | number | boolean,
): SemanticInterfaceGraph {
  const clone = structuredClone(graph);
  const contract = clone.contracts.find((item) => item.screenId === screenId);
  const field = contract?.data.find((item) => item.name === fieldName);
  if (!contract || !field) throw new Error(`Unknown fixture field: ${screenId}.${fieldName}`);
  if (!contract.visualStates.includes(state)) {
    throw new Error(`Unsupported visual state for ${screenId}: ${state}`);
  }

  const validValue = field.type === "boolean" ? typeof value === "boolean"
    : field.type === "number" ? typeof value === "number" && Number.isFinite(value)
      : typeof value === "string";
  if (!validValue) throw new Error(`Invalid ${field.type} value for ${screenId}.${fieldName}`);
  if (field.type === "status" && value !== state) {
    throw new Error(`Status fixture value must match its visual state: ${state}`);
  }

  let fixture = clone.fixtures.find((item) => item.screenId === screenId && item.state === state);
  if (!fixture) {
    const fixtureId = `${screenId}.${state}`;
    const collision = clone.fixtures.find((item) => item.id === fixtureId);
    if (collision) throw new Error(`Fixture id is already in use: ${fixtureId}`);

    const idle = clone.fixtures.find((item) => item.screenId === screenId && item.state === "idle");
    const data = structuredClone(idle?.data ?? {});
    for (const contractField of contract.data) {
      if (!(contractField.name in data)) {
        data[contractField.name] = contractField.type === "boolean" ? false
          : contractField.type === "number" ? 0
            : contractField.type === "money" ? "0.00"
              : contractField.type === "status" ? state
                : "";
      }
      if (contractField.type === "status") data[contractField.name] = state;
    }
    fixture = { id: fixtureId, screenId, state, data };
    clone.fixtures.push(fixture);
    if (!contract.fixtures.includes(fixture.id)) contract.fixtures.push(fixture.id);
  }
  fixture.data[fieldName] = value;
  return parseGraph(clone);
}

export function applyGraphPatch(
  graph: SemanticInterfaceGraph,
  patchInput: GraphPatch,
): SemanticInterfaceGraph {
  const patch = graphPatchSchema.parse(patchInput);
  const clone = structuredClone(graph);

  for (const operation of patch.operations) {
    if (operation.op === "set-color-token") {
      const resolved = resolveTokenMode(clone.tokens);
      if (!Object.hasOwn(resolved.colors, operation.token)) {
        throw new Error(`Unknown color token: ${operation.token}`);
      }
      if (Object.hasOwn(clone.tokens.aliases, operation.token)) {
        throw new Error(`Color token is an alias and cannot be assigned directly: ${operation.token}`);
      }
      clone.tokens.modes[clone.tokens.activeMode]!.values.colors[operation.token] = operation.value;
      continue;
    }

    if (operation.op === "set-token-mode") {
      if (!clone.tokens.modes[operation.mode]) throw new Error(`Unknown token mode: ${operation.mode}`);
      clone.tokens.activeMode = operation.mode;
      continue;
    }

    if (operation.op === "set-fixture-value") {
      const updated = setFixtureValue(
        clone,
        operation.screenId,
        operation.state,
        operation.field,
        operation.value,
      );
      clone.contracts = updated.contracts;
      clone.fixtures = updated.fixtures;
      continue;
    }

    if (operation.op === "move-node") {
      const source = findGraphNodeLocation(clone, operation.target);
      if (!source) throw new Error(`Patch target not found: ${operation.target}`);
      if (source.screen.id !== operation.screenId) {
        throw new Error(`Move source ${operation.target} is not on screen ${operation.screenId}`);
      }
      const parentLocation = operation.parent ? findGraphNodeLocation(clone, operation.parent) : undefined;
      if (operation.parent && !parentLocation) throw new Error(`Move parent not found: ${operation.parent}`);
      if (parentLocation?.screen.id !== undefined && parentLocation.screen.id !== operation.screenId) {
        throw new Error("A typed move cannot cross screen boundaries");
      }
      if (parentLocation && !isContainerNode(parentLocation.node)) {
        throw new Error(`Move parent is not a container: ${operation.parent}`);
      }
      if (operation.parent === operation.target
        || flattenSemanticNodes(source.node.children).some((node) => node.id === operation.parent)) {
        throw new Error("A node cannot move into itself or one of its descendants");
      }
      const parentResolvesToFreeform = parentLocation?.node.kind === "freeform"
        || (parentLocation?.node.kind === "adaptive" && (
          parentLocation.node.layout.adaptive?.compact === "freeform"
          || parentLocation.node.layout.adaptive?.regular === "freeform"
        ));
      if (parentResolvesToFreeform && !source.node.layout.position) {
        throw new Error("Moving into freeform requires an explicit semantic position");
      }
      const targetSiblings = parentLocation?.node.children ?? source.screen.nodes;
      const requestedIndex = operation.index ?? targetSiblings.length;
      const sameSiblings = targetSiblings === source.siblings;
      source.siblings.splice(source.index, 1);
      const adjustedIndex = sameSiblings && requestedIndex > source.index ? requestedIndex - 1 : requestedIndex;
      targetSiblings.splice(Math.max(0, Math.min(targetSiblings.length, adjustedIndex)), 0, source.node);
      source.node.provenance.revision += 1;
      continue;
    }

    const node = findGraphNode(clone, operation.target);
    if (!node) throw new Error(`Patch target not found: ${operation.target}`);

    if (operation.op === "set-layout") {
      if (operation.axis !== undefined) node.layout.axis = operation.axis;
      if (operation.width !== undefined) node.layout.width = operation.width;
      if (operation.height !== undefined) node.layout.height = operation.height;
      if (operation.align !== undefined) node.layout.align = operation.align;
      if (operation.justify !== undefined) node.layout.justify = operation.justify;
      if (operation.overflow !== undefined) node.layout.overflow = operation.overflow;
      if (operation.columns !== undefined) node.layout.columns = operation.columns;
      if (operation.splitRatio !== undefined) node.layout.splitRatio = operation.splitRatio;
      for (const field of ["fixedWidth", "fixedHeight", "minWidth", "maxWidth", "minHeight", "maxHeight"] as const) {
        if (!Object.hasOwn(operation, field)) continue;
        const value = operation[field];
        if (value === null) delete node.layout[field];
        else if (value !== undefined) node.layout[field] = value;
      }
      if (Object.hasOwn(operation, "adaptive")) {
        if (operation.adaptive === null) delete node.layout.adaptive;
        else if (operation.adaptive !== undefined) node.layout.adaptive = operation.adaptive;
      }
      if (Object.hasOwn(operation, "position")) {
        if (operation.position === null) delete node.layout.position;
        else if (operation.position !== undefined) node.layout.position = operation.position;
      }
    } else if (operation.op === "bind-asset") {
      node.asset = {
        assetId: operation.assetId,
        ...(operation.variantId ? { variantId: operation.variantId } : {}),
        fit: operation.fit,
        focalPoint: operation.focalPoint,
        decorative: operation.decorative,
      };
    } else if (operation.op === "clear-asset") {
      delete node.asset;
    } else if (operation.op === "set-web-layout") {
      if (operation.layout === null) delete node.web;
      else node.web = operation.layout;
    } else if (operation.op === "set-placement") {
      node.layout.placement = { compact: operation.compact, regular: operation.regular };
    } else if (operation.op === "set-label") {
      node.intent.label = operation.label;
    } else if (operation.op === "set-purpose") {
      node.intent.purpose = operation.purpose;
    } else if (operation.op === "set-emphasis") {
      node.style.emphasis = operation.emphasis;
    } else if (operation.op === "set-gap-token") {
      if (!Object.hasOwn(resolveTokenMode(clone.tokens).spacing, operation.token)) {
        throw new Error(`Unknown spacing token: ${operation.token}`);
      }
      node.layout.gapToken = operation.token;
    } else if (operation.op === "set-padding-token") {
      if (!Object.hasOwn(resolveTokenMode(clone.tokens).spacing, operation.token)) {
        throw new Error(`Unknown spacing token: ${operation.token}`);
      }
      node.layout.paddingToken = operation.token;
    }
    node.provenance.revision += 1;
  }

  return parseGraph(clone);
}

export interface SemanticChange {
  path: string;
  before: unknown;
  after: unknown;
}

export function semanticDiff(
  before: SemanticInterfaceGraph,
  after: SemanticInterfaceGraph,
): SemanticChange[] {
  const changes: SemanticChange[] = [];

  if (before.tokens.defaultMode !== after.tokens.defaultMode) {
    changes.push({ path: "tokens.defaultMode", before: before.tokens.defaultMode, after: after.tokens.defaultMode });
  }
  if (before.tokens.activeMode !== after.tokens.activeMode) {
    changes.push({ path: "tokens.activeMode", before: before.tokens.activeMode, after: after.tokens.activeMode });
  }
  for (const modeId of new Set([...Object.keys(before.tokens.modes), ...Object.keys(after.tokens.modes)])) {
    const beforeMode = before.tokens.modes[modeId];
    const afterMode = after.tokens.modes[modeId];
    if (!beforeMode || !afterMode) {
      changes.push({ path: `tokens.modes.${modeId}`, before: beforeMode, after: afterMode });
      continue;
    }
    if (beforeMode.name !== afterMode.name) {
      changes.push({ path: `tokens.modes.${modeId}.name`, before: beforeMode.name, after: afterMode.name });
    }
    if (beforeMode.description !== afterMode.description) {
      changes.push({ path: `tokens.modes.${modeId}.description`, before: beforeMode.description, after: afterMode.description });
    }
    for (const group of ["colors", "spacing", "radii"] as const) {
      const beforeTokens: Record<string, unknown> = beforeMode.values[group];
      const afterTokens: Record<string, unknown> = afterMode.values[group];
      for (const key of new Set([...Object.keys(beforeTokens), ...Object.keys(afterTokens)])) {
        if (beforeTokens[key] !== afterTokens[key]) {
          changes.push({ path: `tokens.modes.${modeId}.values.${group}.${key}`, before: beforeTokens[key], after: afterTokens[key] });
        }
      }
    }
  }
  for (const field of ["aliases", "deprecated", "extensions"] as const) {
    if (JSON.stringify(before.tokens[field]) !== JSON.stringify(after.tokens[field])) {
      changes.push({ path: `tokens.${field}`, before: before.tokens[field], after: after.tokens[field] });
    }
  }

  const beforeAssets = new Map(before.assets.map((asset) => [asset.id, asset]));
  const afterAssets = new Map(after.assets.map((asset) => [asset.id, asset]));
  for (const id of new Set([...beforeAssets.keys(), ...afterAssets.keys()])) {
    const previous = beforeAssets.get(id);
    const next = afterAssets.get(id);
    if (JSON.stringify(previous) !== JSON.stringify(next)) {
      changes.push({ path: `assets.${id}`, before: previous, after: next });
    }
  }
  const beforeDependencies = new Map(before.dependencies.map((dependency) => [dependency.id, dependency]));
  const afterDependencies = new Map(after.dependencies.map((dependency) => [dependency.id, dependency]));
  for (const id of new Set([...beforeDependencies.keys(), ...afterDependencies.keys()])) {
    const previous = beforeDependencies.get(id);
    const next = afterDependencies.get(id);
    if (JSON.stringify(previous) !== JSON.stringify(next)) {
      changes.push({ path: `dependencies.${id}`, before: previous, after: next });
    }
  }
  if (JSON.stringify(before.web) !== JSON.stringify(after.web)) {
    changes.push({ path: "web", before: before.web, after: after.web });
  }
  if (JSON.stringify(before.devices) !== JSON.stringify(after.devices)) {
    changes.push({ path: "devices", before: before.devices, after: after.devices });
  }

  const beforeComponents = new Map(before.components.map((definition) => [definition.id, definition]));
  const afterComponents = new Map(after.components.map((definition) => [definition.id, definition]));
  for (const id of new Set([...beforeComponents.keys(), ...afterComponents.keys()])) {
    const previous = beforeComponents.get(id);
    const next = afterComponents.get(id);
    if (JSON.stringify(previous) !== JSON.stringify(next)) {
      changes.push({ path: `components.${id}`, before: previous, after: next });
    }
  }

  const beforeFixtures = new Map(before.fixtures.map((fixture) => [fixture.id, fixture]));
  const afterFixtures = new Map(after.fixtures.map((fixture) => [fixture.id, fixture]));
  for (const id of new Set([...beforeFixtures.keys(), ...afterFixtures.keys()])) {
    const previous = beforeFixtures.get(id);
    const next = afterFixtures.get(id);
    if (!previous || !next) {
      changes.push({ path: `fixtures.${id}`, before: previous, after: next });
      continue;
    }
    for (const field of new Set([...Object.keys(previous.data), ...Object.keys(next.data)])) {
      if (JSON.stringify(previous.data[field]) !== JSON.stringify(next.data[field])) {
        changes.push({ path: `fixtures.${id}.data.${field}`, before: previous.data[field], after: next.data[field] });
      }
    }
  }

  const beforeGraphNodes = flattenGraphNodes(before);
  const afterGraphNodes = flattenGraphNodes(after);
  const beforeNodes = new Map(beforeGraphNodes.map((node) => [node.id, node]));
  const afterNodeIds = new Set(afterGraphNodes.map((node) => node.id));

  for (const node of beforeGraphNodes) {
    if (!afterNodeIds.has(node.id)) {
      changes.push({ path: node.id, before: node, after: undefined });
    }
  }

  for (const node of afterGraphNodes) {
    const previous = beforeNodes.get(node.id);
    if (!previous) {
      changes.push({ path: node.id, before: undefined, after: node });
      continue;
    }
    if (previous.intent.label !== node.intent.label) {
      changes.push({ path: `${node.id}.intent.label`, before: previous.intent.label, after: node.intent.label });
    }
    if (previous.kind !== node.kind) {
      changes.push({ path: `${node.id}.kind`, before: previous.kind, after: node.kind });
    }
    if (previous.intent.purpose !== node.intent.purpose) {
      changes.push({ path: `${node.id}.intent.purpose`, before: previous.intent.purpose, after: node.intent.purpose });
    }
    if (previous.intent.importance !== node.intent.importance) {
      changes.push({ path: `${node.id}.intent.importance`, before: previous.intent.importance, after: node.intent.importance });
    }
    if (previous.style.emphasis !== node.style.emphasis) {
      changes.push({ path: `${node.id}.style.emphasis`, before: previous.style.emphasis, after: node.style.emphasis });
    }
    if (JSON.stringify(previous.componentInstance) !== JSON.stringify(node.componentInstance)) {
      changes.push({
        path: `${node.id}.componentInstance`,
        before: previous.componentInstance,
        after: node.componentInstance,
      });
    }
    if (JSON.stringify(previous.asset) !== JSON.stringify(node.asset)) {
      changes.push({ path: `${node.id}.asset`, before: previous.asset, after: node.asset });
    }
    if (JSON.stringify(previous.web) !== JSON.stringify(node.web)) {
      changes.push({ path: `${node.id}.web`, before: previous.web, after: node.web });
    }
    if (previous.layout.gapToken !== node.layout.gapToken) {
      changes.push({ path: `${node.id}.layout.gapToken`, before: previous.layout.gapToken, after: node.layout.gapToken });
    }
    if (previous.layout.paddingToken !== node.layout.paddingToken) {
      changes.push({ path: `${node.id}.layout.paddingToken`, before: previous.layout.paddingToken, after: node.layout.paddingToken });
    }
    for (const property of [
      "axis",
      "width",
      "height",
      "fixedWidth",
      "fixedHeight",
      "minWidth",
      "maxWidth",
      "minHeight",
      "maxHeight",
      "align",
      "justify",
      "overflow",
      "columns",
      "splitRatio",
      "adaptive",
      "position",
    ] as const) {
      if (JSON.stringify(previous.layout[property]) !== JSON.stringify(node.layout[property])) {
        changes.push({
          path: `${node.id}.layout.${property}`,
          before: previous.layout[property],
          after: node.layout[property],
        });
      }
    }
    if (JSON.stringify(previous.layout.placement) !== JSON.stringify(node.layout.placement)) {
      changes.push({
        path: `${node.id}.layout.placement`,
        before: previous.layout.placement,
        after: node.layout.placement,
      });
    }
    if (JSON.stringify(previous.states) !== JSON.stringify(node.states)) {
      changes.push({
        path: `${node.id}.states`,
        before: previous.states.map((state) => state.name),
        after: node.states.map((state) => state.name),
      });
    }
    if (JSON.stringify(previous.interactions) !== JSON.stringify(node.interactions)) {
      changes.push({
        path: `${node.id}.interactions`,
        before: previous.interactions.map((interaction) => interaction.event),
        after: node.interactions.map((interaction) => interaction.event),
      });
    }
    const previousChildren = previous.children.map((child) => child.id);
    const nextChildren = node.children.map((child) => child.id);
    if (JSON.stringify(previousChildren) !== JSON.stringify(nextChildren)) {
      changes.push({ path: `${node.id}.children`, before: previousChildren, after: nextChildren });
    }
  }

  return changes;
}

export function stableSerialize(value: unknown): string {
  const normalize = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(normalize);
    if (input && typeof input === "object") {
      return Object.fromEntries(
        Object.entries(input as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, child]) => [key, normalize(child)]),
      );
    }
    return input;
  };
  return `${JSON.stringify(normalize(value), null, 2)}\n`;
}
