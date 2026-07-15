import { z } from "zod";

export type DeviceClass = "compact" | "regular";

/* One layout-viewport contract is shared by the editor, verifiers and both
   compilers. A viewport is regular only when it clears both compact limits;
   this keeps narrow portrait and short landscape layouts in the compact mode. */
export const DEVICE_CLASS_LIMITS = {
  compactMaxWidth: 390,
  compactMaxHeight: 700,
} as const;

export const CANONICAL_DEVICE_VIEWPORTS = {
  compactPhone: { width: 375, height: 667 },
  regularPhone: { width: 402, height: 874 },
  regularTablet: { width: 768, height: 1024 },
} as const;

export const GRAPH_LIMITS = {
  maxSerializedBytes: 512_000,
  maxIdLength: 96,
  maxTextLength: 1_000,
  maxFixtureStringLength: 2_000,
  maxScreens: 32,
  maxNodesPerScreen: 64,
  maxChildrenPerNode: 64,
  maxNodeDepth: 16,
  maxTotalNodesPerScreen: 512,
  maxTotalNodes: 4_096,
  maxComponents: 128,
  maxFlows: 32,
  maxStepsPerFlow: 128,
  maxContracts: 32,
  maxFixtures: 160,
  maxFieldsPerContract: 48,
  maxEventsPerContract: 48,
  maxInteractionsPerNode: 16,
  maxPatchOperations: 64,
  maxTokensPerGroup: 128,
  maxExpressionDepth: 12,
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
const visualStateSchema = z.enum(["idle", "loading", "empty", "failed", "completed"]);
const fixtureValueSchema = z.union([
  boundedStringSchema(GRAPH_LIMITS.maxFixtureStringLength),
  z.number().finite(),
  z.boolean(),
]);

const boundedRecord = <T extends z.ZodType>(valueSchema: T, maximum: number) =>
  z.record(tokenKeySchema, valueSchema).refine(
    (record) => Object.keys(record).length <= maximum,
    `Record must contain at most ${maximum} entries`,
  );

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

export interface SemanticNode extends SemanticNodeBase {
  children: SemanticNode[];
}

export const semanticNodeSchema: z.ZodType<SemanticNode> = z.lazy(() =>
  semanticNodeBaseSchema.extend({
    children: z.array(semanticNodeSchema).max(GRAPH_LIMITS.maxChildrenPerNode).default([]),
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
  walkSemanticNodes(roots, ({ node }) => nodes.push(node));
  return nodes;
}

export function findSemanticNode(roots: readonly SemanticNode[], nodeId: string): SemanticNode | undefined {
  let match: SemanticNode | undefined;
  walkSemanticNodes(roots, ({ node }) => {
    if (!match && node.id === nodeId) match = node;
  });
  return match;
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

export function isTransactionalScreen(
  screen: ScreenDefinition,
  contract?: UIContract,
): boolean {
  return (contract?.events.length ?? 0) > 0
    || flattenSemanticNodes(screen.nodes).some((node) => node.interactions.length > 0);
}

export const semanticInterfaceGraphSchema = z
  .strictObject({
    schemaVersion: z.literal("0.2.0"),
    product: z.strictObject({
      name: safeTextSchema(120),
      audience: z.array(safeTextSchema(240)).min(1).max(20),
      principles: z.array(safeTextSchema(500)).min(1).max(20),
    }),
    tokens: z.strictObject({
      colors: z.record(
        colorTokenKeySchema,
        colorValueSchema,
      ).refine(
        (record) => Object.keys(record).length <= GRAPH_LIMITS.maxTokensPerGroup,
        `Colors must contain at most ${GRAPH_LIMITS.maxTokensPerGroup} entries`,
      ),
      spacing: z.record(
        spacingTokenKeySchema,
        z.number().positive().max(512),
      ).refine(
        (record) => Object.keys(record).length <= GRAPH_LIMITS.maxTokensPerGroup,
        `Spacing must contain at most ${GRAPH_LIMITS.maxTokensPerGroup} entries`,
      ),
      radii: z.record(
        radiusTokenKeySchema,
        z.number().nonnegative().max(256),
      ).refine(
        (record) => Object.keys(record).length <= GRAPH_LIMITS.maxTokensPerGroup,
        `Radii must contain at most ${GRAPH_LIMITS.maxTokensPerGroup} entries`,
      ),
    }),
    platforms: z.array(
      z.strictObject({
        target: platformTargetSchema,
        enabled: z.boolean(),
        capabilities: z.array(tokenKeySchema).max(32),
      }),
    ).max(5),
    components: z.array(z.strictObject({
      id: idSchema,
      kind: tokenKeySchema,
      description: safeTextSchema(500),
    })).max(GRAPH_LIMITS.maxComponents),
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

    const screenById = new Map(graph.screens.map((screen) => [screen.id, screen]));
    const contractByScreen = new Map(graph.contracts.map((contract) => [contract.screenId, contract]));
    const fixtureById = new Map(graph.fixtures.map((fixture) => [fixture.id, fixture]));
    const platformTargets = new Set(graph.platforms.map((platform) => platform.target));
    const nodeIds = new Set<string>();

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

        if (!Object.hasOwn(graph.tokens.spacing, node.layout.gapToken)) {
          addIssue(`Unknown spacing token: ${node.layout.gapToken}`, [...nodePath, "layout", "gapToken"]);
        }
        if (!Object.hasOwn(graph.tokens.spacing, node.layout.paddingToken)) {
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
  return semanticInterfaceGraphSchema.parse(input);
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
      if (!Object.hasOwn(clone.tokens.colors, operation.token)) {
        throw new Error(`Unknown color token: ${operation.token}`);
      }
      clone.tokens.colors[operation.token] = operation.value;
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
    } else if (operation.op === "set-placement") {
      node.layout.placement = { compact: operation.compact, regular: operation.regular };
    } else if (operation.op === "set-label") {
      node.intent.label = operation.label;
    } else if (operation.op === "set-purpose") {
      node.intent.purpose = operation.purpose;
    } else if (operation.op === "set-emphasis") {
      node.style.emphasis = operation.emphasis;
    } else if (operation.op === "set-gap-token") {
      if (!Object.hasOwn(clone.tokens.spacing, operation.token)) {
        throw new Error(`Unknown spacing token: ${operation.token}`);
      }
      node.layout.gapToken = operation.token;
    } else if (operation.op === "set-padding-token") {
      if (!Object.hasOwn(clone.tokens.spacing, operation.token)) {
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

  for (const group of ["colors", "spacing", "radii"] as const) {
    const beforeTokens: Record<string, unknown> = before.tokens[group];
    const afterTokens: Record<string, unknown> = after.tokens[group];
    for (const key of new Set([...Object.keys(beforeTokens), ...Object.keys(afterTokens)])) {
      if (beforeTokens[key] !== afterTokens[key]) {
        changes.push({ path: `tokens.${group}.${key}`, before: beforeTokens[key], after: afterTokens[key] });
      }
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
