import { describe, expect, it } from "vitest";
import {
  GRAPH_LIMITS,
  applyGraphPatch,
  graphPatchSchema,
  parseGraph,
  resolveTokenMode,
  semanticDiff,
  stableSerialize,
} from "./index";

function makeValidGraph() {
  const contentNode = {
    id: "receipt.content",
    kind: "receipt-summary",
    intent: { purpose: "Show the receipt", label: "Receipt", importance: "primary" },
    layout: { axis: "vertical", width: "fill", gapToken: "space.16", paddingToken: "space.20" },
    style: { role: "receipt-summary", emphasis: "strong" },
    accessibility: { label: "Receipt", live: "off" },
    states: [],
    interactions: [],
    provenance: { author: "system", revision: 0 },
  };

  return {
    schemaVersion: "0.4.0",
    product: {
      name: "Invariant test",
      audience: ["product teams"],
      principles: ["Keep generated output deterministic"],
    },
    tokens: {
      defaultMode: "default",
      activeMode: "default",
      modes: { default: { name: "Default", values: {
        colors: { "color.accent": "#397461", "color.surface": "#fbfcf9" },
        spacing: { "space.16": 16, "space.20": 20 },
        radii: { "radius.surface": 24 },
      } } },
      aliases: {},
      deprecated: {},
      extensions: {},
    },
    assets: [],
    platforms: [{ target: "react", enabled: true, capabilities: ["responsive-layout"] }],
    components: [{
      id: "intent.receipt-summary",
      name: "Receipt summary",
      description: "A reusable receipt summary.",
      version: "1.0.0",
      template: {
        ...structuredClone(contentNode),
        id: "receipt-summary.root",
        children: [],
      },
      properties: [],
      slots: [],
      variants: [],
      states: [],
    }],
    screens: [
      {
        id: "home",
        title: "Home",
        purpose: "Submit a request",
        route: "/",
        nodes: [{
          id: "home.submit",
          kind: "primary-action",
          intent: { purpose: "Submit the request", label: "Submit", importance: "primary" },
          layout: {
            axis: "vertical",
            width: "fill",
            gapToken: "space.16",
            paddingToken: "space.20",
            placement: { compact: "persistent-bottom", regular: "inline" },
          },
          style: { role: "primary-action", emphasis: "strong" },
          accessibility: { label: "Submit", hint: "Submits this request", live: "off" },
          states: [],
          interactions: [{ event: "submit", requires: ["amount"] }],
          provenance: { author: "system", revision: 0 },
        }],
      },
      {
        id: "receipt",
        title: "Receipt",
        purpose: "Show the completed request",
        route: "/receipt",
        nodes: [contentNode],
      },
    ],
    flows: [{ id: "submit-request", steps: [{ from: "home", event: "submit", to: "receipt" }] }],
    contracts: [
      {
        screenId: "home",
        data: [
          { name: "amount", type: "money", required: true },
          { name: "status", type: "status", required: true },
        ],
        events: [{ name: "submit" }],
        visualStates: ["idle", "completed"],
        fixtures: ["home.idle"],
      },
      {
        screenId: "receipt",
        data: [{ name: "reference", type: "string", required: true }],
        events: [],
        visualStates: ["completed"],
        fixtures: ["receipt.completed"],
      },
    ],
    fixtures: [
      { id: "home.idle", screenId: "home", state: "idle", data: { amount: "1.00", status: "idle" } },
      { id: "receipt.completed", screenId: "receipt", state: "completed", data: { reference: "IF-1" } },
    ],
  };
}

// Invalid-payload tests deliberately mutate the graph outside its inferred type.
// Keeping the escape hatch local makes those malformed cases explicit.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GraphDraft = any;

function expectInvalid(change: (graph: GraphDraft) => void, message: string | RegExp) {
  const graph = structuredClone(makeValidGraph());
  change(graph);
  expect(() => parseGraph(graph)).toThrow(message);
}

describe("semantic graph invariants", () => {
  it("accepts a canonical graph and a stateless contract-free screen", () => {
    const graph: GraphDraft = makeValidGraph();
    const manual = structuredClone(graph.screens[1]!);
    manual.id = "manual";
    manual.route = "/manual";
    manual.nodes[0]!.id = "manual.content";
    graph.screens.push(manual);

    expect(parseGraph(graph).screens.at(-1)?.id).toBe("manual");
  });

  it("migrates flat roots into recursive nodes with deterministic layout defaults", () => {
    const parsed = parseGraph(makeValidGraph());
    expect(parsed.schemaVersion).toBe("0.4.0");
    expect(parsed.screens[0]?.nodes[0]).toMatchObject({
      children: [],
      layout: {
        height: "hug",
        align: "stretch",
        justify: "start",
        overflow: "visible",
        columns: 2,
        splitRatio: 0.5,
      },
    });
  });

  it("accepts nested semantic containers and patches descendant nodes by stable id", () => {
    const graph: GraphDraft = makeValidGraph();
    const leaf = structuredClone(graph.screens[1]!.nodes[0]!);
    leaf.id = "receipt.content";
    graph.screens[1]!.nodes = [{
      ...structuredClone(leaf),
      id: "receipt.stack",
      kind: "stack",
      children: [leaf],
    }];
    const parsed = parseGraph(graph);
    const patched = applyGraphPatch(parsed, {
      id: "nested-label",
      rationale: "Rename a nested leaf",
      operations: [{ op: "set-label", target: "receipt.content", label: "Nested receipt" }],
    });
    expect(patched.screens[1]?.nodes[0]?.children[0]?.intent.label).toBe("Nested receipt");
  });

  it("rejects invalid recursive shape, constraints, freeform position, and adaptive modes", () => {
    expectInvalid((graph) => {
      graph.screens[1]!.nodes[0]!.children = [structuredClone(graph.screens[1]!.nodes[0]!)];
    }, /Leaf node receipt-summary cannot contain children/);
    expectInvalid((graph) => {
      graph.screens[1]!.nodes[0]!.layout.minWidth = 300;
      graph.screens[1]!.nodes[0]!.layout.maxWidth = 200;
    }, /Minimum width cannot exceed maximum width/);
    expectInvalid((graph) => {
      graph.screens[1]!.nodes[0]!.layout.position = { x: 12, y: 20, z: 1 };
    }, /position outside a freeform relation/);
    expectInvalid((graph) => {
      graph.screens[1]!.nodes[0]!.layout.adaptive = { compact: "stack", regular: "grid" };
    }, /Only adaptive containers/);
    expectInvalid((graph) => {
      const leaf = structuredClone(graph.screens[1]!.nodes[0]!);
      leaf.id = "receipt.free-child";
      graph.screens[1]!.nodes = [{ ...structuredClone(leaf), id: "receipt.free", kind: "freeform", children: [leaf] }];
    }, /resolve to freeform require every child/);
    expectInvalid((graph) => {
      const leaf = structuredClone(graph.screens[1]!.nodes[0]!);
      leaf.id = "receipt.adaptive-child";
      graph.screens[1]!.nodes = [{ ...structuredClone(leaf), id: "receipt.adaptive", kind: "adaptive", children: [leaf] }];
    }, /Adaptive containers require compact and regular modes/);
    expectInvalid((graph) => {
      const leaf = structuredClone(graph.screens[1]!.nodes[0]!);
      leaf.id = "receipt.adaptive-child";
      graph.screens[1]!.nodes = [{
        ...structuredClone(leaf),
        id: "receipt.adaptive-freeform",
        kind: "adaptive",
        layout: {
          ...leaf.layout,
          adaptive: { compact: "stack", regular: "freeform" },
        },
        children: [leaf],
      }];
    }, /resolve to freeform require every child/);
  });

  it("bounds recursive depth and total nodes per screen", () => {
    expectInvalid((graph) => {
      let child = structuredClone(graph.screens[1]!.nodes[0]!);
      child.id = "receipt.depth-leaf";
      for (let depth = GRAPH_LIMITS.maxNodeDepth; depth >= 1; depth -= 1) {
        child = { ...structuredClone(child), id: `receipt.depth-${depth}`, kind: "stack", children: [child] };
      }
      graph.screens[1]!.nodes = [child];
    }, /maximum depth/);

    expectInvalid((graph) => {
      const template = structuredClone(graph.screens[1]!.nodes[0]!);
      graph.screens[1]!.nodes = Array.from({ length: 9 }, (_, group) => ({
        ...structuredClone(template),
        id: `receipt.group-${group}`,
        kind: "stack",
        children: Array.from({ length: 64 }, (_, index) => ({
          ...structuredClone(template),
          id: `receipt.leaf-${group}-${index}`,
        })),
      }));
    }, /exceeds 512 total nodes/);
  });

  it("rejects duplicate descendant ids and in-memory reference cycles", () => {
    expectInvalid((graph) => {
      const first = structuredClone(graph.screens[1]!.nodes[0]!);
      first.id = "receipt.same";
      const second = structuredClone(first);
      graph.screens[1]!.nodes = [{ ...structuredClone(first), id: "receipt.group", kind: "stack", children: [first, second] }];
    }, /Duplicate node id: receipt.same/);

    const cyclic = makeValidGraph();
    const node = cyclic.screens[1]!.nodes[0]! as GraphDraft;
    node.children = [node];
    expect(() => parseGraph(cyclic)).toThrow(/JSON-serializable/);
  });

  it("rejects unknown persisted fields instead of silently deleting them", () => {
    expectInvalid((graph) => { graph.futureRoot = { enabled: true }; }, /Unrecognized key/);
    expectInvalid((graph) => { graph.screens[0]!.nodes[0]!.futureNode = true; }, /Unrecognized key/);
    expectInvalid((graph) => { graph.contracts[0]!.data[0]!.futureField = "metadata"; }, /Unrecognized key/);
    expect(() => graphPatchSchema.parse({
      id: "unknown-patch-field",
      rationale: "Fail closed",
      operations: [{ op: "set-label", target: "home.submit", label: "Submit", future: true }],
    })).toThrow(/Unrecognized key/);
  });

  it("rejects duplicate identities, routes and declarations", () => {
    expectInvalid((graph) => graph.screens.push(structuredClone(graph.screens[0]!)), /Duplicate screen id: home/);
    expectInvalid((graph) => {
      const duplicateRoute = structuredClone(graph.screens[1]!);
      duplicateRoute.id = "manual";
      duplicateRoute.route = "/";
      duplicateRoute.nodes[0]!.id = "manual.content";
      graph.screens.push(duplicateRoute);
    }, /Duplicate screen route: \//);
    expectInvalid((graph) => { graph.screens[1]!.nodes[0]!.id = "home.submit"; }, /Duplicate node id: home.submit/);
    expectInvalid((graph) => graph.components.push(structuredClone(graph.components[0]!)), /Duplicate component id/);
    expectInvalid((graph) => graph.platforms.push(structuredClone(graph.platforms[0]!)), /Duplicate platform target/);
    expectInvalid((graph) => graph.flows.push(structuredClone(graph.flows[0]!)), /Duplicate flow id/);
    expectInvalid((graph) => graph.contracts.push(structuredClone(graph.contracts[0]!)), /Duplicate contract screen/);
    expectInvalid((graph) => graph.contracts[0]!.data.push(structuredClone(graph.contracts[0]!.data[0]!)), /Duplicate contract field/);
    expectInvalid((graph) => graph.contracts[0]!.events.push(structuredClone(graph.contracts[0]!.events[0]!)), /Duplicate contract event/);
    expectInvalid((graph) => graph.fixtures.push(structuredClone(graph.fixtures[0]!)), /Duplicate fixture id/);
  });

  it("enforces contract and fixture referential integrity", () => {
    expectInvalid((graph) => { graph.contracts[0]!.screenId = "missing"; }, /Unknown contract screen: missing/);
    expectInvalid((graph) => { graph.contracts[0]!.fixtures[0] = "home.missing"; }, /Contract references unknown fixture/);
    expectInvalid((graph) => { graph.fixtures[0]!.id = "home.completed"; }, /Fixture id must be home.idle/);
    expectInvalid((graph) => {
      const duplicateState = structuredClone(graph.fixtures[0]!);
      duplicateState.id = "home.copy";
      graph.fixtures.push(duplicateState);
    }, /Duplicate fixture screen\/state/);
    expectInvalid((graph) => { graph.fixtures[0]!.data.extra = "unexpected"; }, /Fixture contains unknown contract field/);
    expectInvalid((graph) => { delete graph.fixtures[0]!.data.amount; }, /Fixture is missing required field/);
    expectInvalid((graph) => { graph.fixtures[0]!.data.amount = 12; }, /Fixture field has invalid money value/);
    expectInvalid((graph) => { graph.fixtures[0]!.data.amount = "1e9"; }, /Fixture money field is not a bounded decimal/);
    expectInvalid((graph) => { graph.fixtures[0]!.data.status = "completed"; }, /Fixture status must match its visual state/);
    expectInvalid((graph) => {
      graph.fixtures[0]!.id = "home.failed";
      graph.fixtures[0]!.state = "failed";
      graph.contracts[0]!.fixtures[0] = "home.failed";
    }, /Fixture state is not declared by contract/);
  });

  it("enforces event wiring, flow destinations and primary-action cardinality", () => {
    expectInvalid((graph) => { graph.screens[0]!.nodes[0]!.interactions[0]!.event = "missing"; }, /Interaction references undeclared event/);
    expectInvalid((graph) => { graph.screens[0]!.nodes[0]!.interactions[0]!.requires = ["missing"]; }, /Interaction requires unknown contract field/);
    expectInvalid((graph) => { graph.flows[0]!.steps[0]!.to = "missing"; }, /references an unknown screen/);
    expectInvalid((graph) => { graph.screens[0]!.nodes[0]!.interactions = []; }, /Flow event is not emitted by a source node/);
    expectInvalid((graph) => {
      const secondFlow = structuredClone(graph.flows[0]!);
      secondFlow.id = "second-flow";
      graph.flows.push(secondFlow);
    }, /Ambiguous flow destination for event/);
    expectInvalid((graph) => { graph.screens[0]!.nodes[0]!.kind = "secondary-action"; }, /must have exactly one primary action/);
    expectInvalid((graph) => {
      const secondPrimary = structuredClone(graph.screens[0]!.nodes[0]!);
      secondPrimary.id = "home.second";
      secondPrimary.interactions = [];
      graph.screens[0]!.nodes.push(secondPrimary);
    }, /more than one primary action/);
  });

  it("rejects broken expressions and excessive expression depth", () => {
    expectInvalid((graph) => {
      graph.screens[1]!.nodes[0]!.states = [{
        name: "completed",
        visibleWhen: { op: "field", path: "data.missing" },
      }];
    }, /Expression references unknown contract field/);
    expectInvalid((graph) => {
      let expression: Record<string, unknown> = { op: "field", path: "data.reference" };
      for (let index = 0; index < GRAPH_LIMITS.maxExpressionDepth; index += 1) {
        expression = { op: "not", value: expression };
      }
      graph.screens[1]!.nodes[0]!.states = [{ name: "completed", visibleWhen: expression }];
    }, /Expression exceeds maximum depth/);
    expectInvalid((graph) => {
      graph.screens[0]!.nodes[0]!.states = [{
        name: "idle",
        visibleWhen: {
          op: "eq",
          left: { op: "field", path: "data.status" },
          right: { op: "value", value: 1 },
        },
      }];
    }, /Expression compares incompatible string and number values/);
    expectInvalid((graph) => {
      graph.screens[1]!.nodes[0]!.states = [{
        name: "completed",
        visibleWhen: { op: "not", value: { op: "field", path: "data.reference" } },
      }];
    }, /Expression not requires a boolean value/);
    expectInvalid((graph) => {
      graph.screens[1]!.nodes[0]!.states = [{ name: "completed" }];
    }, /Node state without an expression requires a status field/);
  });

  it("rejects unsafe token, override and generated-text inputs", () => {
    expectInvalid((graph) => { graph.screens[0]!.nodes[0]!.layout.gapToken = "space.missing"; }, /Unknown spacing token/);
    expectInvalid((graph) => { graph.screens[0]!.nodes[0]!.layout.gapToken = "constructor"; }, /Reserved token key/);
    expectInvalid((graph) => { graph.tokens.modes.default!.values.colors["color.accent"] = "url(javascript:alert(1))"; }, /Invalid string/);
    expectInvalid((graph) => { graph.tokens.modes.default!.values.spacing["space.16"] = 513; }, /Too big/);
    expectInvalid((graph) => { graph.screens[0]!.nodes[0]!.intent.label = "Submit\nmalicious"; }, /Control characters are not allowed/);
    expectInvalid((graph) => { graph.screens[0]!.nodes[0]!.intent.label = "Submit\u202Ehidden"; }, /Control characters are not allowed/);
    expectInvalid((graph) => {
      graph.screens[0]!.nodes[0]!.platformOverrides = { ghost: { flag: true } };
    }, /Unknown platform override target/);
    expectInvalid((graph) => { graph.contracts[0]!.data[0]!.name = "constructor"; }, /Reserved identifier/);
    expectInvalid((graph) => { graph.contracts[0]!.data[0]!.name = "$amount"; }, /Invalid string/);
  });

  it("resolves sparse token modes and aliases, then patches the active mode atomically", () => {
    const draft: GraphDraft = makeValidGraph();
    draft.tokens.modes.night = {
      name: "Night",
      values: { colors: { "color.accent": "#88aacc" }, spacing: {}, radii: {} },
    };
    draft.tokens.aliases["color.action"] = "color.accent";
    draft.tokens.deprecated["color.action"] = "Use color.accent";
    const graph = parseGraph(draft);

    expect(resolveTokenMode(graph.tokens, "night")).toMatchObject({
      colors: {
        "color.accent": "#88aacc",
        "color.action": "#88aacc",
        "color.surface": "#fbfcf9",
      },
      spacing: { "space.16": 16, "space.20": 20 },
    });
    const switched = applyGraphPatch(graph, {
      id: "tokens.switch-night",
      rationale: "Preview the low-light token mode",
      operations: [{ op: "set-token-mode", mode: "night" }],
    });
    const edited = applyGraphPatch(switched, {
      id: "tokens.edit-night",
      rationale: "Tune the low-light accent",
      operations: [{ op: "set-color-token", token: "color.accent", value: "#7799bb" }],
    });
    expect(edited.tokens.modes.night?.values.colors["color.accent"]).toBe("#7799bb");
    expect(graph.tokens.modes.default?.values.colors["color.accent"]).toBe("#397461");
    expect(semanticDiff(graph, edited)).toEqual(expect.arrayContaining([
      { path: "tokens.activeMode", before: "default", after: "night" },
      { path: "tokens.modes.night.values.colors.color.accent", before: "#88aacc", after: "#7799bb" },
    ]));
  });

  it("rejects cyclic, cross-type, concrete, missing, and stale token metadata", () => {
    expectInvalid((graph) => {
      graph.tokens.aliases = { "color.one": "color.two", "color.two": "color.one" };
    }, /alias cycle/i);
    expectInvalid((graph) => {
      graph.tokens.aliases = { "color.action": "space.16" };
    }, /alias type mismatch/i);
    expectInvalid((graph) => {
      graph.tokens.aliases = { "color.accent": "color.surface" };
    }, /both concrete and an alias/i);
    expectInvalid((graph) => {
      graph.tokens.aliases = { "color.action": "color.missing" };
    }, /unknown token alias/i);
    expectInvalid((graph) => {
      graph.tokens.deprecated = { "color.missing": true };
    }, /deprecated token does not exist/i);
  });

  it("binds licensed content-addressed assets through typed reversible patches", () => {
    const draft: GraphDraft = makeValidGraph();
    const digest = "a".repeat(64);
    draft.assets = [{
      id: "brand.hero",
      name: "Brand hero",
      kind: "raster",
      digest,
      mediaType: "image/png",
      byteLength: 128,
      storageKey: `assets/${digest}.png`,
      width: 1200,
      height: 800,
      variants: [],
      license: { name: "Project-owned", redistribution: "allowed" },
      exportPolicy: "copy",
      metadata: { role: "hero" },
    }];
    const graph = parseGraph(draft);
    const bound = applyGraphPatch(graph, {
      id: "assets.bind-hero",
      rationale: "Bind the licensed hero asset",
      operations: [{
        op: "bind-asset",
        target: "receipt.content",
        assetId: "brand.hero",
        fit: "cover",
        focalPoint: { x: 0.4, y: 0.25 },
        decorative: false,
      }],
    });
    expect(bound.screens[1]?.nodes[0]?.asset).toEqual({
      assetId: "brand.hero",
      fit: "cover",
      focalPoint: { x: 0.4, y: 0.25 },
      decorative: false,
    });
    expect(semanticDiff(graph, bound)).toContainEqual(expect.objectContaining({ path: "receipt.content.asset" }));
    const cleared = applyGraphPatch(bound, {
      id: "assets.clear-hero",
      rationale: "Return to semantic-only content",
      operations: [{ op: "clear-asset", target: "receipt.content" }],
    });
    expect(cleared.screens[1]?.nodes[0]?.asset).toBeUndefined();
    expect(semanticDiff(bound, cleared)).toContainEqual(expect.objectContaining({ path: "receipt.content.asset" }));
  });

  it("fails closed for invalid asset media, licensing, digests, variants, and bindings", () => {
    const addAsset = (graph: GraphDraft, overrides: Record<string, unknown> = {}) => {
      const digest = "a".repeat(64);
      graph.assets = [{
        id: "brand.hero",
        name: "Brand hero",
        kind: "raster",
        digest,
        mediaType: "image/png",
        byteLength: 128,
        storageKey: `assets/${digest}.png`,
        variants: [],
        license: { name: "Project-owned", redistribution: "allowed" },
        exportPolicy: "copy",
        metadata: {},
        ...overrides,
      }];
    };
    expectInvalid((graph) => addAsset(graph, { mediaType: "text/html" }), /media type.*does not match kind/i);
    expectInvalid((graph) => addAsset(graph, { storageKey: `assets/${"a".repeat(64)}.svg` }), /extension does not match/i);
    expectInvalid((graph) => addAsset(graph, { digest: "b".repeat(64) }), /storage key must contain/i);
    expectInvalid((graph) => addAsset(graph, {
      license: { name: "Restricted", redistribution: "restricted" },
    }), /license that allows redistribution/i);
    expectInvalid((graph) => {
      graph.screens[1]!.nodes[0]!.asset = { assetId: "missing", fit: "contain", focalPoint: { x: 0.5, y: 0.5 }, decorative: false };
    }, /unknown asset/i);
    expectInvalid((graph) => {
      addAsset(graph);
      graph.screens[1]!.nodes[0]!.asset = { assetId: "brand.hero", variantId: "missing", fit: "contain", focalPoint: { x: 0.5, y: 0.5 }, decorative: false };
    }, /unknown asset variant/i);
    expectInvalid((graph) => {
      addAsset(graph, { kind: "font", mediaType: "font/woff2", storageKey: `assets/${"a".repeat(64)}.woff2` });
      graph.screens[1]!.nodes[0]!.asset = { assetId: "brand.hero", fit: "contain", focalPoint: { x: 0.5, y: 0.5 }, decorative: false };
    }, /font assets cannot be bound/i);
  });

  it("bounds graphs, patches and serialized request size", () => {
    const operations = Array.from({ length: GRAPH_LIMITS.maxPatchOperations }, () => ({
      op: "set-label" as const,
      target: "home.submit",
      label: "Safe label",
    }));
    expect(graphPatchSchema.parse({ id: "max-patch", rationale: "Boundary test", operations }).operations).toHaveLength(64);
    expect(() => graphPatchSchema.parse({
      id: "large-patch",
      rationale: "Boundary test",
      operations: [...operations, operations[0]],
    })).toThrow(/Too big/);
    expect(() => graphPatchSchema.parse({
      id: "unsafe-patch",
      rationale: "Boundary test",
      operations: [{ op: "set-gap-token", target: "home.submit", token: "constructor" }],
    })).toThrow(/Reserved token key/);
    expect(() => applyGraphPatch(parseGraph(makeValidGraph()), {
      id: "missing-token",
      rationale: "Unknown token test",
      operations: [{ op: "set-gap-token", target: "home.submit", token: "space.missing" }],
    })).toThrow(/Unknown spacing token/);

    expectInvalid((graph) => {
      for (let index = 1; index <= GRAPH_LIMITS.maxTokenModes; index += 1) {
        graph.tokens.modes[`mode-${index}`] = { name: `Mode ${index}`, values: { colors: {}, spacing: {}, radii: {} } };
      }
    }, /tokens require 1 through/i);
    expectInvalid((graph) => {
      graph.tokens.aliases = Object.fromEntries(Array.from(
        { length: GRAPH_LIMITS.maxTokenAliases + 1 },
        (_, index) => [`color.alias-${index}`, "color.accent"],
      ));
    }, /at most 256 aliases/i);
    expectInvalid((graph) => {
      const digest = "a".repeat(64);
      graph.assets = Array.from({ length: GRAPH_LIMITS.maxAssets + 1 }, (_, index) => ({
        id: `asset-${index}`,
        name: `Asset ${index}`,
        kind: "raster",
        digest,
        mediaType: "image/png",
        byteLength: 1,
        storageKey: `assets/${digest}.png`,
        variants: [],
        license: { name: "Project-owned", redistribution: "allowed" },
        exportPolicy: "copy",
        metadata: {},
      }));
    }, /too big/i);

    expectInvalid((graph) => {
      const content = structuredClone(graph.screens[1]!.nodes[0]!);
      graph.screens[1]!.nodes = Array.from({ length: GRAPH_LIMITS.maxNodesPerScreen + 1 }, (_, index) => ({
        ...structuredClone(content),
        id: `receipt.content.${index}`,
      }));
    }, /Too big/);

    const oversized = { ...makeValidGraph(), ignored: "x".repeat(GRAPH_LIMITS.maxSerializedBytes) };
    expect(() => parseGraph(oversized)).toThrow(/serialized bytes/);
  });

  it("parses and serializes equivalent inputs deterministically", () => {
    for (let index = 0; index < 10; index += 1) {
      const graph = makeValidGraph();
      graph.tokens.modes.default!.values.colors["color.accent"] = `#${index.toString(16).padStart(6, "0")}`;
      const first = stableSerialize(parseGraph(graph));
      const second = stableSerialize(parseGraph(JSON.parse(first)));
      expect(second).toBe(first);
    }
  });
});
