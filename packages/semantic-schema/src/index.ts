import { z } from "zod";

export const platformTargetSchema = z.enum([
  "react",
  "swiftui",
  "expo",
  "compose",
  "web",
]);

export const placementSchema = z.object({
  compact: z.enum(["inline", "persistent-bottom"]),
  regular: z.enum(["inline", "persistent-bottom"]),
});

export const semanticLayoutSchema = z.object({
  axis: z.enum(["vertical", "horizontal", "overlay"]).default("vertical"),
  width: z.enum(["hug", "fill", "fixed"]).default("fill"),
  gapToken: z.string().default("space.16"),
  paddingToken: z.string().default("space.20"),
  placement: placementSchema.optional(),
});

export const expressionSchema: z.ZodType<Expression> = z.lazy(() =>
  z.discriminatedUnion("op", [
    z.object({ op: z.literal("value"), value: z.union([z.string(), z.number(), z.boolean()]) }),
    z.object({ op: z.literal("field"), path: z.string().regex(/^data\.[a-zA-Z0-9_.-]+$/) }),
    z.object({ op: z.literal("eq"), left: expressionSchema, right: expressionSchema }),
    z.object({ op: z.literal("not"), value: expressionSchema }),
  ]),
);

export type Expression =
  | { op: "value"; value: string | number | boolean }
  | { op: "field"; path: string }
  | { op: "eq"; left: Expression; right: Expression }
  | { op: "not"; value: Expression };

export const semanticNodeSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9.-]+$/),
  kind: z.enum([
    "balance-summary",
    "transaction-list",
    "money-input",
    "recipient-identity",
    "primary-action",
    "secondary-action",
    "status-message",
    "receipt-summary",
  ]),
  intent: z.object({
    purpose: z.string().min(3),
    label: z.string().optional(),
    importance: z.enum(["primary", "secondary", "supporting"]).default("supporting"),
  }),
  layout: semanticLayoutSchema,
  style: z.object({
    role: z.string().default("surface"),
    emphasis: z.enum(["quiet", "normal", "strong"]).default("normal"),
  }),
  accessibility: z.object({
    label: z.string().min(1),
    hint: z.string().optional(),
    live: z.enum(["off", "polite", "assertive"]).default("off"),
  }),
  states: z.array(z.object({ name: z.string(), visibleWhen: expressionSchema.optional() })).default([]),
  interactions: z.array(
    z.object({
      event: z.string().regex(/^[a-zA-Z_$][a-zA-Z0-9_$]*$/),
      requires: z.array(z.string()).default([]),
    }),
  ).default([]),
  platformOverrides: z
    .record(z.string(), z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])))
    .optional(),
  provenance: z.object({
    author: z.enum(["human", "gpt-5.6", "system"]),
    revision: z.number().int().nonnegative(),
  }),
});

export const screenSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]+$/),
  title: z.string().min(1),
  purpose: z.string().min(3),
  route: z.string().startsWith("/"),
  nodes: z.array(semanticNodeSchema).min(1),
});

export const uiContractSchema = z.object({
  screenId: z.string(),
  data: z.array(
    z.object({
      name: z.string().regex(/^[a-zA-Z_$][a-zA-Z0-9_$]*$/),
      type: z.enum(["string", "number", "boolean", "money", "status"]),
      required: z.boolean().default(true),
    }),
  ),
  events: z.array(
    z.object({
      name: z.string().regex(/^[a-zA-Z_$][a-zA-Z0-9_$]*$/),
      payload: z.enum(["string", "number", "boolean"]).optional(),
    }),
  ),
  visualStates: z.array(z.enum(["idle", "loading", "empty", "failed", "completed"])),
  fixtures: z.array(z.string()),
});

export const fixtureSetSchema = z.object({
  id: z.string(),
  screenId: z.string(),
  state: z.enum(["idle", "loading", "empty", "failed", "completed"]),
  data: z.record(z.string(), z.unknown()),
});

export const semanticInterfaceGraphSchema = z
  .object({
    schemaVersion: z.literal("0.1.0"),
    product: z.object({
      name: z.string().min(1),
      audience: z.array(z.string()).min(1),
      principles: z.array(z.string()).min(1),
    }),
    tokens: z.object({
      colors: z.record(z.string(), z.string()),
      spacing: z.record(z.string(), z.number().positive()),
      radii: z.record(z.string(), z.number().nonnegative()),
    }),
    platforms: z.array(
      z.object({ target: platformTargetSchema, enabled: z.boolean(), capabilities: z.array(z.string()) }),
    ),
    components: z.array(z.object({ id: z.string(), kind: z.string(), description: z.string() })),
    screens: z.array(screenSchema).min(1),
    flows: z.array(
      z.object({
        id: z.string(),
        steps: z.array(z.object({ from: z.string(), event: z.string(), to: z.string() })),
      }),
    ),
    contracts: z.array(uiContractSchema),
    fixtures: z.array(fixtureSetSchema),
  })
  .superRefine((graph, context) => {
    const screenIds = new Set(graph.screens.map((screen) => screen.id));
    const nodeIds = new Set<string>();

    for (const screen of graph.screens) {
      for (const node of screen.nodes) {
        if (nodeIds.has(node.id)) {
          context.addIssue({ code: "custom", message: `Duplicate node id: ${node.id}` });
        }
        nodeIds.add(node.id);
      }
    }

    for (const contract of graph.contracts) {
      if (!screenIds.has(contract.screenId)) {
        context.addIssue({ code: "custom", message: `Unknown contract screen: ${contract.screenId}` });
      }
    }

    for (const flow of graph.flows) {
      for (const step of flow.steps) {
        if (!screenIds.has(step.from) || !screenIds.has(step.to)) {
          context.addIssue({ code: "custom", message: `Flow ${flow.id} references an unknown screen` });
        }
      }
    }
  });

export type PlatformTarget = z.infer<typeof platformTargetSchema>;
export type SemanticNode = z.infer<typeof semanticNodeSchema>;
export type ScreenDefinition = z.infer<typeof screenSchema>;
export type SemanticInterfaceGraph = z.infer<typeof semanticInterfaceGraphSchema>;
export type UIContract = z.infer<typeof uiContractSchema>;

export const graphPatchSchema = z.object({
  id: z.string(),
  rationale: z.string(),
  operations: z.array(
    z.discriminatedUnion("op", [
      z.object({
        op: z.literal("set-placement"),
        target: z.string(),
        compact: z.enum(["inline", "persistent-bottom"]),
        regular: z.enum(["inline", "persistent-bottom"]),
      }),
      z.object({ op: z.literal("set-label"), target: z.string(), label: z.string().min(1) }),
      z.object({ op: z.literal("set-purpose"), target: z.string(), purpose: z.string().min(3) }),
      z.object({
        op: z.literal("set-emphasis"),
        target: z.string(),
        emphasis: z.enum(["quiet", "normal", "strong"]),
      }),
      z.object({ op: z.literal("set-gap-token"), target: z.string(), token: z.string().min(1) }),
      z.object({ op: z.literal("set-padding-token"), target: z.string(), token: z.string().min(1) }),
      z.object({
        op: z.literal("set-color-token"),
        token: z.string().min(1),
        value: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      }),
      z.object({
        op: z.literal("set-fixture-value"),
        screenId: z.string().min(1),
        state: z.enum(["idle", "loading", "empty", "failed", "completed"]),
        field: z.string().min(1),
        value: z.union([z.string(), z.number(), z.boolean()]),
      }),
    ]),
  ),
});

export type GraphPatch = z.infer<typeof graphPatchSchema>;

export function parseGraph(input: unknown): SemanticInterfaceGraph {
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
      if (!(operation.token in clone.tokens.colors)) {
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

    const node = clone.screens.flatMap((screen) => screen.nodes).find((item) => item.id === operation.target);
    if (!node) throw new Error(`Patch target not found: ${operation.target}`);

    if (operation.op === "set-placement") {
      node.layout.placement = { compact: operation.compact, regular: operation.regular };
    } else if (operation.op === "set-label") {
      node.intent.label = operation.label;
    } else if (operation.op === "set-purpose") {
      node.intent.purpose = operation.purpose;
    } else if (operation.op === "set-emphasis") {
      node.style.emphasis = operation.emphasis;
    } else if (operation.op === "set-gap-token") {
      if (!(operation.token in clone.tokens.spacing)) {
        throw new Error(`Unknown spacing token: ${operation.token}`);
      }
      node.layout.gapToken = operation.token;
    } else {
      if (!(operation.token in clone.tokens.spacing)) {
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

  const beforeNodes = new Map(before.screens.flatMap((screen) => screen.nodes).map((node) => [node.id, node]));
  const afterNodeIds = new Set(after.screens.flatMap((screen) => screen.nodes).map((node) => node.id));

  for (const node of before.screens.flatMap((screen) => screen.nodes)) {
    if (!afterNodeIds.has(node.id)) {
      changes.push({ path: node.id, before: node, after: undefined });
    }
  }

  for (const node of after.screens.flatMap((screen) => screen.nodes)) {
    const previous = beforeNodes.get(node.id);
    if (!previous) {
      changes.push({ path: node.id, before: undefined, after: node });
      continue;
    }
    if (previous.intent.label !== node.intent.label) {
      changes.push({ path: `${node.id}.intent.label`, before: previous.intent.label, after: node.intent.label });
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
