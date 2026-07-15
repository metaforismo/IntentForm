import { describe, expect, it } from "vitest";
import { defaultDeviceConfiguration } from "@intentform/device-registry";
import {
  findGraphNode,
  parseGraph,
  parseLocalComponentLibrary,
  semanticDiff,
  stableSerialize,
  type SemanticInterfaceGraph,
  type SemanticNode,
} from "./index.ts";
import {
  clearComponentOverride,
  detachComponentInstance,
  exportLocalComponentLibrary,
  importLocalComponentLibrary,
  instantiateComponent,
  removeComponentDefinition,
  resetComponentInstance,
  setComponentOverride,
  setComponentProperty,
  setComponentState,
  setComponentVariant,
  updateComponentDefinition,
} from "./component-library.ts";

function node(id: string, kind: SemanticNode["kind"], label: string): SemanticNode {
  return {
    id,
    kind,
    intent: { purpose: `Render ${label.toLowerCase()}`, label, importance: "supporting" },
    layout: {
      axis: "vertical",
      width: "fill",
      height: "hug",
      align: "stretch",
      justify: "start",
      overflow: "visible",
      columns: 2,
      splitRatio: 0.5,
      gapToken: "space.12",
      paddingToken: "space.20",
    },
    style: { role: kind, emphasis: "normal" },
    accessibility: { label, live: "off" },
    states: [],
    interactions: [],
    provenance: { author: "system", revision: 0 },
    children: [],
  };
}

const balanceTemplate = node("balance.root", "balance-summary", "Available balance");
balanceTemplate.intent.importance = "primary";
balanceTemplate.style.emphasis = "strong";
const moneyTemplate = node("money.root", "money-input", "Amount");
moneyTemplate.intent.importance = "primary";
const actionTemplate = node("action.root", "primary-action", "Continue");
actionTemplate.intent.importance = "primary";
actionTemplate.style.emphasis = "strong";
const cardTemplate = node("card.root", "stack", "Surface card");

const demoGraph = parseGraph({
  schemaVersion: "0.6.0",
  product: {
    name: "Component tests",
    audience: ["interface teams"],
    principles: ["Prefer reusable semantic definitions"],
  },
  tokens: {
    defaultMode: "default",
    activeMode: "default",
    modes: { default: { name: "Default", values: {
      colors: { "color.accent": "#397461", "color.surface": "#fbfcf9" },
      spacing: { "space.8": 8, "space.12": 12, "space.16": 16, "space.20": 20 },
      radii: { "radius.surface": 24 },
    } } },
    aliases: {},
    deprecated: {},
    extensions: {},
  },
  assets: [],
  devices: defaultDeviceConfiguration(),
  platforms: [{ target: "react", enabled: true, capabilities: ["responsive-layout"] }],
  components: [
    {
      id: "intent.balance-summary",
      name: "Balance summary",
      description: "A prioritized account balance.",
      version: "1.0.0",
      template: balanceTemplate,
      properties: [{
        name: "label",
        type: "string",
        default: "Available balance",
        bindings: [
          { target: "balance.root", field: "intent.label" },
          { target: "balance.root", field: "accessibility.label" },
        ],
      }],
      slots: [],
      variants: [],
      states: [],
    },
    {
      id: "intent.money-input",
      name: "Money input",
      description: "A currency-aware amount field.",
      version: "1.0.0",
      template: moneyTemplate,
      properties: [{
        name: "label",
        type: "string",
        required: true,
        default: "Amount",
        bindings: [{ target: "money.root", field: "intent.label" }],
      }],
      slots: [],
      variants: [],
      states: [],
    },
    {
      id: "intent.primary-action",
      name: "Primary action",
      description: "The dominant action.",
      version: "1.0.0",
      template: actionTemplate,
      properties: [{
        name: "label",
        type: "string",
        required: true,
        default: "Continue",
        bindings: [{ target: "action.root", field: "intent.label" }],
      }],
      slots: [],
      variants: [
        { id: "prominent", label: "Prominent", overrides: [{ op: "set-emphasis", target: "action.root", value: "strong" }] },
        { id: "quiet", label: "Quiet", overrides: [{ op: "set-emphasis", target: "action.root", value: "quiet" }] },
      ],
      defaultVariant: "prominent",
      states: [
        { id: "ready", label: "Ready", overrides: [] },
        { id: "working", label: "Working", overrides: [{ op: "set-label", target: "action.root", value: "Working…" }] },
      ],
      defaultState: "ready",
    },
    {
      id: "intent.surface-card",
      name: "Surface card",
      description: "A surface with typed content.",
      version: "1.0.0",
      template: cardTemplate,
      properties: [],
      slots: [{
        name: "content",
        target: "card.root",
        allowedKinds: ["status-message", "stack"],
        maxChildren: 12,
      }],
      variants: [
        { id: "comfortable", label: "Comfortable", overrides: [{ op: "set-gap-token", target: "card.root", value: "space.16" }] },
        { id: "compact", label: "Compact", overrides: [{ op: "set-gap-token", target: "card.root", value: "space.12" }] },
      ],
      defaultVariant: "comfortable",
      states: [],
    },
  ],
  screens: [{
    id: "layout-lab",
    title: "Layout lab",
    purpose: "Exercise component behavior",
    route: "/",
    nodes: [node("layout-lab.grid-a", "status-message", "Ready")],
  }],
  flows: [],
  contracts: [],
  fixtures: [],
});

function commit(graph: SemanticInterfaceGraph): SemanticInterfaceGraph {
  return parseGraph(graph);
}

function instantiate(
  definitionId: string,
  instanceId: string,
  options: Partial<Parameters<typeof instantiateComponent>[1]> = {},
): SemanticInterfaceGraph {
  return commit(instantiateComponent(demoGraph, {
    definitionId,
    instanceId,
    screenId: "layout-lab",
    ...options,
  }));
}

function componentNode(id: string, child?: SemanticNode): SemanticNode {
  const template = structuredClone(demoGraph.components.find((definition) =>
    definition.id === "intent.surface-card")!.template);
  template.id = id;
  template.children = [];
  template.componentInstance = {
    definitionId: "intent.surface-card",
    props: {},
    slots: child ? { content: [child] } : {},
    overrides: [],
  };
  return template;
}

describe("local component libraries", () => {
  it("materializes typed props, variants, states, and instance overrides in deterministic precedence", () => {
    let graph = instantiate("intent.primary-action", "layout-lab.action", {
      props: { label: "Pay now" },
      variant: "quiet",
      state: "working",
    });
    let node = findGraphNode(graph, "layout-lab.action")!;
    expect(node).toMatchObject({
      id: "layout-lab.action",
      intent: { label: "Working…" },
      style: { emphasis: "quiet" },
      componentInstance: {
        definitionId: "intent.primary-action",
        props: { label: "Pay now" },
        variant: "quiet",
        state: "working",
      },
    });

    graph = commit(setComponentOverride(graph, node.id, {
      op: "set-label",
      target: "action.root",
      value: "Retry payment",
    }));
    expect(findGraphNode(graph, node.id)?.intent.label).toBe("Retry payment");

    graph = commit(clearComponentOverride(graph, node.id, "set-label", "action.root"));
    expect(findGraphNode(graph, node.id)?.intent.label).toBe("Working…");

    graph = commit(setComponentState(graph, node.id, "ready"));
    graph = commit(setComponentVariant(graph, node.id, "prominent"));
    graph = commit(setComponentProperty(graph, node.id, "label", "Send securely"));
    node = findGraphNode(graph, node.id)!;
    expect(node.intent.label).toBe("Send securely");
    expect(node.style.emphasis).toBe("strong");
  });

  it("updates every attached instance from one definition while preserving instance-owned outer layout", () => {
    let graph = instantiate("intent.balance-summary", "layout-lab.balance", { props: { label: "Team balance" } });
    const before = findGraphNode(graph, "layout-lab.balance")!;
    before.layout.width = "fixed";
    before.layout.fixedWidth = 320;
    graph = commit(graph);

    const definition = structuredClone(graph.components.find((candidate) =>
      candidate.id === "intent.balance-summary")!);
    definition.version = "1.1.0";
    definition.template.intent.purpose = "Show the current available team balance";
    definition.template.style.emphasis = "quiet";
    graph = commit(updateComponentDefinition(graph, definition));

    expect(findGraphNode(graph, "layout-lab.balance")).toMatchObject({
      intent: { label: "Team balance", purpose: "Show the current available team balance" },
      layout: { width: "fixed", fixedWidth: 320 },
      style: { emphasis: "quiet" },
      componentInstance: { definitionId: "intent.balance-summary" },
    });
    expect(stableSerialize(commit(graph))).toBe(stableSerialize(graph));
  });

  it("fills typed slots, detaches without visual loss, and removes a definition with detached fallbacks", () => {
    const slotChild = structuredClone(findGraphNode(demoGraph, "layout-lab.grid-a")!);
    slotChild.id = "catalog.slot-copy";
    let graph = instantiate("intent.surface-card", "layout-lab.card", {
      variant: "compact",
      slots: { content: [slotChild] },
    });
    expect(findGraphNode(graph, "layout-lab.card")?.children.map((node) => node.id))
      .toEqual(["catalog.slot-copy"]);
    expect(findGraphNode(graph, "layout-lab.card")?.layout.gapToken).toBe("space.12");

    const rendered = structuredClone(findGraphNode(graph, "layout-lab.card")!);
    delete rendered.componentInstance;
    const attached = graph;
    graph = commit(detachComponentInstance(graph, "layout-lab.card"));
    expect(findGraphNode(graph, "layout-lab.card")).toEqual(rendered);
    expect(semanticDiff(attached, graph)).toEqual([expect.objectContaining({
      path: "layout-lab.card.componentInstance",
      after: undefined,
    })]);

    graph = instantiate("intent.surface-card", "layout-lab.card", {
      slots: { content: [slotChild] },
    });
    graph = commit(removeComponentDefinition(graph, "intent.surface-card"));
    expect(graph.components.some((definition) => definition.id === "intent.surface-card")).toBe(false);
    expect(findGraphNode(graph, "layout-lab.card")).toMatchObject({ children: [{ id: "catalog.slot-copy" }] });
    expect(findGraphNode(graph, "layout-lab.card")).not.toHaveProperty("componentInstance");
  });

  it("resets explicit instance choices to definition defaults", () => {
    let graph = instantiate("intent.primary-action", "layout-lab.action", {
      props: { label: "Custom label" },
      variant: "quiet",
      state: "working",
    });
    graph = commit(setComponentOverride(graph, "layout-lab.action", {
      op: "set-purpose",
      target: "action.root",
      value: "Retry a failed transaction",
    }));
    graph = commit(resetComponentInstance(graph, "layout-lab.action"));

    expect(findGraphNode(graph, "layout-lab.action")).toMatchObject({
      intent: { label: "Continue" },
      style: { emphasis: "strong" },
      componentInstance: { props: {}, slots: {}, overrides: [] },
    });
    expect(findGraphNode(graph, "layout-lab.action")?.componentInstance).not.toHaveProperty("variant");
    expect(findGraphNode(graph, "layout-lab.action")?.componentInstance).not.toHaveProperty("state");
  });

  it("exports and imports a strict, versioned, conflict-aware local library ABI", () => {
    const library = exportLocalComponentLibrary(demoGraph, {
      id: "verdant.core",
      name: "Verdant core",
      version: "1.0.0",
    }, ["intent.balance-summary", "intent.surface-card"]);
    expect(parseLocalComponentLibrary(library)).toEqual(library);

    const empty = commit({ ...structuredClone(demoGraph), components: [] });
    const imported = commit(importLocalComponentLibrary(empty, library));
    expect(imported.components.map((definition) => definition.id)).toEqual([
      "intent.balance-summary",
      "intent.surface-card",
    ]);
    expect(() => importLocalComponentLibrary(imported, library)).toThrow(/already exists/i);

    const replacement = structuredClone(library);
    replacement.definitions[0]!.version = "2.0.0";
    expect(commit(importLocalComponentLibrary(imported, replacement, "replace")).components[0]?.version)
      .toBe("2.0.0");
    expect(() => parseLocalComponentLibrary({ ...library, abiVersion: "2.0.0" }))
      .toThrow(/1\.0\.0/i);
    expect(() => parseLocalComponentLibrary({
      ...library,
      definitions: [library.definitions[0], library.definitions[0]],
    })).toThrow(/duplicate component id/i);
  });

  it("fails closed for bad props, modes, definitions, deprecation, cycles, and excessive nesting", () => {
    let graph = instantiate("intent.money-input", "layout-lab.amount");
    expect(() => setComponentProperty(graph, "layout-lab.amount", "label", 42)).toThrow(/must be string/i);
    expect(() => setComponentVariant(graph, "layout-lab.amount", "unknown")).toThrow(/unknown component variant/i);
    expect(() => setComponentState(graph, "layout-lab.amount", "unknown")).toThrow(/unknown component state/i);
    expect(() => setComponentOverride(graph, "layout-lab.amount", {
      op: "set-label",
      target: "missing.node",
      value: "Missing",
    })).toThrow(/target is unavailable/i);

    graph = structuredClone(demoGraph);
    graph.components.find((definition) => definition.id === "intent.money-input")!.deprecated = {
      message: "Use the next money field",
    };
    expect(() => instantiateComponent(graph, {
      definitionId: "intent.money-input",
      instanceId: "layout-lab.deprecated",
      screenId: "layout-lab",
    })).toThrow(/deprecated/i);

    const missing = structuredClone(demoGraph);
    findGraphNode(missing, "layout-lab.grid-a")!.componentInstance = {
      definitionId: "intent.missing",
      props: {},
      slots: {},
      overrides: [],
    };
    expect(() => parseGraph(missing)).toThrow(/unknown definition/i);

    const cyclic = structuredClone(demoGraph);
    const card = cyclic.components.find((definition) => definition.id === "intent.surface-card")!;
    card.template.componentInstance = {
      definitionId: card.id,
      props: {},
      slots: {},
      overrides: [],
    };
    expect(() => parseGraph(cyclic)).toThrow(/component dependency cycle/i);

    const unknownToken = structuredClone(demoGraph);
    unknownToken.components[0]!.template.layout.gapToken = "space.missing";
    expect(() => parseGraph(unknownToken)).toThrow(/unknown spacing token/i);

    const unknownVariantToken = structuredClone(demoGraph);
    unknownVariantToken.components[2]!.variants[0]!.overrides = [{
      op: "set-gap-token",
      target: "action.root",
      value: "space.missing",
    }];
    expect(() => parseGraph(unknownVariantToken)).toThrow(/unknown component spacing token/i);

    const slottedDependency = structuredClone(demoGraph);
    slottedDependency.components.find((definition) => definition.id === "intent.surface-card")!
      .slots[0]!.allowedKinds.push("money-input");
    const nestedMoney = structuredClone(moneyTemplate);
    nestedMoney.id = "dependency.money";
    nestedMoney.componentInstance = {
      definitionId: "intent.money-input",
      props: {},
      slots: {},
      overrides: [],
    };
    const dependentDefinition = slottedDependency.components.find((definition) =>
      definition.id === "intent.balance-summary")!;
    dependentDefinition.template = componentNode("dependency.card", nestedMoney);
    dependentDefinition.properties = [];
    const validSlottedDependency = parseGraph(slottedDependency);
    expect(() => removeComponentDefinition(validSlottedDependency, "intent.money-input"))
      .toThrow(/used by definition intent\.balance-summary/i);

    let nested = componentNode("deep.leaf");
    for (let index = 0; index < 16; index += 1) nested = componentNode(`deep.level-${index}`, nested);
    expect(() => instantiateComponent(demoGraph, {
      definitionId: "intent.surface-card",
      instanceId: "layout-lab.deep-root",
      screenId: "layout-lab",
      slots: { content: [nested] },
    })).toThrow(/nesting exceeds 16 levels/i);
  });
});
