import type {
  AssetDefinition,
  ContainerNodeKind,
  Expression,
  PlatformTarget,
  SemanticInterfaceGraph,
  SemanticNode,
  UIContract,
} from "@intentform/semantic-schema";
import { isContainerNode, resolveTokenMode, type ResolvedTokenMode, type TokenCollection } from "@intentform/semantic-schema";
import { layoutCoverage } from "@intentform/layout-engine";
import { resolveDeviceConfiguration, type ResolvedDeviceConfiguration } from "@intentform/device-registry";

export type PlatformIRField = UIContract["data"][number];

export interface PlatformIREvent {
  name: string;
  payload?: "string" | "number" | "boolean";
  payloadField: PlatformIRField | null;
}

export interface PlatformIRFixture {
  id: string;
  state: string;
  data: Record<string, string | number | boolean>;
}

export interface CompilerDiagnostic {
  severity: "warning" | "error";
  path: string;
  message: string;
}

export interface PlatformIRNode {
  id: string;
  kind: SemanticNode["kind"];
  intent: {
    label: string;
    purpose: string;
    importance: SemanticNode["intent"]["importance"];
  };
  layout: {
    compactMode: ContainerNodeKind | "leaf";
    regularMode: ContainerNodeKind | "leaf";
    axis: SemanticNode["layout"]["axis"];
    width: SemanticNode["layout"]["width"];
    height: SemanticNode["layout"]["height"];
    fixedWidth?: number;
    fixedHeight?: number;
    minWidth?: number;
    maxWidth?: number;
    minHeight?: number;
    maxHeight?: number;
    align: SemanticNode["layout"]["align"];
    justify: SemanticNode["layout"]["justify"];
    overflow: SemanticNode["layout"]["overflow"];
    columns: number;
    splitRatio: number;
    position?: { x: number; y: number; z: number };
    gapToken: string;
    paddingToken: string;
    gap: number;
    padding: number;
    compactPlacement: "inline" | "persistent-bottom";
    regularPlacement: "inline" | "persistent-bottom";
  };
  style: SemanticNode["style"];
  accessibility: SemanticNode["accessibility"];
  asset: {
    id: string;
    kind: AssetDefinition["kind"];
    digest: string;
    mediaType: string;
    storageKey: string;
    exportPolicy: AssetDefinition["exportPolicy"];
    license: AssetDefinition["license"];
    fit: NonNullable<SemanticNode["asset"]>["fit"];
    focalPoint: NonNullable<SemanticNode["asset"]>["focalPoint"];
    decorative: boolean;
  } | null;
  web: SemanticNode["web"] | null;
  expo: NonNullable<SemanticNode["expo"]> | null;
  events: PlatformIREvent[];
  visibility: Array<{ state: string; expression?: Expression }>;
  bindings: {
    value: PlatformIRField | null;
    detail: PlatformIRField | null;
    status: PlatformIRField | null;
  };
  children: PlatformIRNode[];
}

export interface PlatformIRScreen {
  id: string;
  title: string;
  purpose: string;
  route: string;
  nodes: PlatformIRNode[];
  fixtures: PlatformIRFixture[];
  defaultFixture: PlatformIRFixture;
  eventTargets: Record<string, string>;
  layoutCoverage: ReturnType<typeof layoutCoverage>;
  contract?: UIContract;
}

export interface PlatformIR {
  target: PlatformTarget;
  productName: string;
  tokens: ResolvedTokenMode;
  tokenCollection: TokenCollection;
  tokenModes: Record<string, ResolvedTokenMode>;
  activeTokenMode: string;
  assets: AssetDefinition[];
  devices: ResolvedDeviceConfiguration;
  web: SemanticInterfaceGraph["web"];
  expo: SemanticInterfaceGraph["expo"];
  screens: PlatformIRScreen[];
  diagnostics: CompilerDiagnostic[];
}

export interface GeneratedFile {
  path: string;
  content: string;
}

export interface GeneratedFileSet {
  target: PlatformTarget;
  files: GeneratedFile[];
  fingerprint: string;
  diagnostics: CompilerDiagnostic[];
}

export interface CapabilityMatrix {
  target: PlatformTarget;
  nativeSafeArea: boolean;
  adaptivePlacement: boolean;
  accessibility: boolean;
}

export interface CompilerBackend {
  id: PlatformTarget;
  capabilities(): CapabilityMatrix;
  lower(graph: SemanticInterfaceGraph): PlatformIR;
  generate(ir: PlatformIR): GeneratedFileSet;
  validate(output: GeneratedFileSet): CompilerDiagnostic[];
}

export class CompilerValidationError extends Error {
  readonly diagnostics: CompilerDiagnostic[];

  constructor(target: PlatformTarget, diagnostics: CompilerDiagnostic[]) {
    super(`${target} compiler produced ${diagnostics.length} blocking diagnostic${diagnostics.length === 1 ? "" : "s"}: ${diagnostics.map((item) => `${item.path}: ${item.message}`).join("; ")}`);
    this.name = "CompilerValidationError";
    this.diagnostics = diagnostics;
  }
}

export function validateGeneratedOutput(
  compiler: CompilerBackend,
  output: GeneratedFileSet,
): GeneratedFileSet {
  const genericDiagnostics: CompilerDiagnostic[] = [];
  if (output.target !== compiler.id) {
    genericDiagnostics.push({ severity: "error", path: "output", message: `Expected ${compiler.id} output, received ${output.target}` });
  }
  const paths = new Set<string>();
  for (const file of output.files) {
    if (file.path.startsWith("/") || file.path.split("/").includes("..")) {
      genericDiagnostics.push({ severity: "error", path: file.path, message: "Generated file path must stay inside the output root" });
    }
    if (paths.has(file.path)) {
      genericDiagnostics.push({ severity: "error", path: file.path, message: "Generated file path is duplicated" });
    }
    paths.add(file.path);
  }
  const diagnostics = [...output.diagnostics, ...genericDiagnostics, ...compiler.validate(output)]
    .filter((diagnostic, index, all) => all.findIndex((candidate) =>
      candidate.severity === diagnostic.severity
      && candidate.path === diagnostic.path
      && candidate.message === diagnostic.message,
    ) === index)
    .sort((left, right) => left.path.localeCompare(right.path)
      || left.severity.localeCompare(right.severity)
      || left.message.localeCompare(right.message));
  const errors = diagnostics
    .filter((diagnostic) => diagnostic.severity === "error");
  if (errors.length > 0) throw new CompilerValidationError(compiler.id, errors);
  output.diagnostics = diagnostics;
  return output;
}

const statePriority = ["idle", "completed", "loading", "empty", "failed"];

function defaultFieldValue(field: PlatformIRField, state: string): string | number | boolean {
  if (field.type === "number") return 0;
  if (field.type === "boolean") return false;
  if (field.type === "money") return "0.00";
  if (field.type === "status") return state;
  return "";
}

function completeFixture(
  contract: UIContract,
  state: string,
  data: Record<string, string | number | boolean>,
): Record<string, string | number | boolean> {
  return Object.fromEntries(contract.data.flatMap((field) => {
    const value = data[field.name];
    if (value !== undefined) return [[field.name, value]];
    return field.required ? [[field.name, defaultFieldValue(field, state)]] : [];
  }));
}

function chooseField(
  fields: PlatformIRField[],
  types: PlatformIRField["type"][],
  preferredNames: RegExp,
): PlatformIRField | null {
  return fields.find((field) => types.includes(field.type) && preferredNames.test(field.name))
    ?? fields.find((field) => types.includes(field.type))
    ?? null;
}

function bindingsForNode(
  node: SemanticNode,
  fields: PlatformIRField[],
): PlatformIRNode["bindings"] {
  const status = chooseField(fields, ["status"], /status|state/i);
  if (node.kind === "balance-summary") {
    return {
      value: chooseField(fields, ["money", "number"], /balance|total|amount|value/i),
      detail: null,
      status,
    };
  }
  if (node.kind === "money-input") {
    return {
      value: chooseField(fields, ["money", "number"], /amount|value|total|balance/i),
      detail: null,
      status,
    };
  }
  if (node.kind === "recipient-identity") {
    const value = chooseField(fields, ["string"], /recipient|name|handle|email/i);
    const detail = chooseField(fields, ["string"], /handle|email|detail/i);
    return {
      value,
      detail: detail?.name === value?.name ? null : detail,
      status,
    };
  }
  if (node.kind === "transaction-list") {
    return {
      value: chooseField(fields, ["string"], /transaction|activity|description|summary/i),
      detail: null,
      status,
    };
  }
  if (node.kind === "receipt-summary") {
    return {
      value: chooseField(fields, ["string"], /reference|receipt|identifier|id/i),
      detail: chooseField(fields, ["money", "number"], /amount|total|value/i),
      status,
    };
  }
  return { value: null, detail: null, status };
}

function eventsForNode(node: SemanticNode, contract: UIContract | undefined): PlatformIREvent[] {
  return node.interactions.flatMap((interaction) => {
    const definition = contract?.events.find((event) => event.name === interaction.event);
    if (!definition) return [];
    const payloadField = definition.payload
      ? contract?.data.find((field) => field.type === definition.payload)
        ?? (definition.payload === "string"
          ? contract?.data.find((field) => ["money", "status"].includes(field.type))
          : undefined)
        ?? null
      : null;
    return [{
      name: definition.name,
      ...(definition.payload ? { payload: definition.payload } : {}),
      payloadField,
    }];
  });
}

type ResolvedNodeSemantics = Pick<PlatformIRNode, "intent" | "layout" | "style" | "accessibility">;

const axisValues = new Set<SemanticNode["layout"]["axis"]>(["vertical", "horizontal", "overlay"]);
const widthValues = new Set<SemanticNode["layout"]["width"]>(["hug", "fill", "fixed"]);
const heightValues = new Set<SemanticNode["layout"]["height"]>(["hug", "fill", "fixed"]);
const alignValues = new Set<SemanticNode["layout"]["align"]>(["start", "center", "end", "stretch"]);
const justifyValues = new Set<SemanticNode["layout"]["justify"]>(["start", "center", "end", "space-between"]);
const overflowValues = new Set<SemanticNode["layout"]["overflow"]>(["visible", "clip", "scroll"]);
const emphasisValues = new Set<SemanticNode["style"]["emphasis"]>(["quiet", "normal", "strong"]);
const importanceValues = new Set<SemanticNode["intent"]["importance"]>(["primary", "secondary", "supporting"]);
const liveValues = new Set<SemanticNode["accessibility"]["live"]>(["off", "polite", "assertive"]);
const placementValues = new Set(["inline", "persistent-bottom"] as const);

function resolveNodeSemantics(
  graph: SemanticInterfaceGraph,
  screenId: string,
  node: SemanticNode,
  target: PlatformTarget,
  diagnostics: CompilerDiagnostic[],
): ResolvedNodeSemantics {
  const tokens = resolveTokenMode(graph.tokens);
  const resolved: ResolvedNodeSemantics = {
    intent: {
      label: node.intent.label ?? node.intent.purpose,
      purpose: node.intent.purpose,
      importance: node.intent.importance,
    },
    layout: {
      compactMode: isContainerNode(node)
        ? node.kind === "adaptive" ? node.layout.adaptive?.compact ?? "stack" : node.kind
        : "leaf",
      regularMode: isContainerNode(node)
        ? node.kind === "adaptive" ? node.layout.adaptive?.regular ?? "stack" : node.kind
        : "leaf",
      axis: node.layout.axis,
      width: node.layout.width,
      height: node.layout.height,
      ...(node.layout.fixedWidth !== undefined ? { fixedWidth: node.layout.fixedWidth } : {}),
      ...(node.layout.fixedHeight !== undefined ? { fixedHeight: node.layout.fixedHeight } : {}),
      ...(node.layout.minWidth !== undefined ? { minWidth: node.layout.minWidth } : {}),
      ...(node.layout.maxWidth !== undefined ? { maxWidth: node.layout.maxWidth } : {}),
      ...(node.layout.minHeight !== undefined ? { minHeight: node.layout.minHeight } : {}),
      ...(node.layout.maxHeight !== undefined ? { maxHeight: node.layout.maxHeight } : {}),
      align: node.layout.align,
      justify: node.layout.justify,
      overflow: node.layout.overflow,
      columns: node.layout.columns,
      splitRatio: node.layout.splitRatio,
      ...(node.layout.position ? { position: node.layout.position } : {}),
      gapToken: node.layout.gapToken,
      paddingToken: node.layout.paddingToken,
      gap: tokens.spacing[node.layout.gapToken] ?? 0,
      padding: tokens.spacing[node.layout.paddingToken] ?? 0,
      compactPlacement: node.layout.placement?.compact ?? "inline",
      regularPlacement: node.layout.placement?.regular ?? "inline",
    },
    style: { ...node.style },
    accessibility: { ...node.accessibility },
  };
  const overrides = node.platformOverrides?.[target] ?? {};
  const overridePath = `screens.${screenId}.nodes.${node.id}.platformOverrides.${target}`;
  const warn = (key: string, message: string) => diagnostics.push({
    severity: "warning",
    path: `${overridePath}.${key}`,
    message,
  });
  const readEnum = <T extends string>(key: string, values: Set<T>, apply: (value: T) => void) => {
    const value = overrides[key];
    if (typeof value === "string" && values.has(value as T)) apply(value as T);
    else warn(key, `Expected one of: ${[...values].join(", ")}. The shared semantic value was used.`);
  };
  const readText = (key: string, apply: (value: string) => void, minimum = 1) => {
    const value = overrides[key];
    if (typeof value === "string" && value.trim().length >= minimum) apply(value);
    else warn(key, "Expected a non-empty string. The shared semantic value was used.");
  };
  const readSpacingToken = (key: string, property: "gapToken" | "paddingToken") => {
    const value = overrides[key];
    if (typeof value === "string" && Object.hasOwn(tokens.spacing, value)) {
      resolved.layout[property] = value;
      resolved.layout[property === "gapToken" ? "gap" : "padding"] = tokens.spacing[value] ?? 0;
    } else {
      warn(key, "Expected an existing spacing token. The shared semantic token was used.");
    }
  };
  const readNumber = (
    key: string,
    minimum: number,
    maximum: number,
    apply: (value: number) => void,
  ) => {
    const value = overrides[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum) apply(value);
    else warn(key, `Expected a number from ${minimum} through ${maximum}. The shared semantic value was used.`);
  };

  const knownOverrides: Record<string, () => void> = {
    "intent.label": () => readText("intent.label", (value) => { resolved.intent.label = value; }),
    "intent.purpose": () => readText("intent.purpose", (value) => { resolved.intent.purpose = value; }, 3),
    "intent.importance": () => readEnum("intent.importance", importanceValues, (value) => { resolved.intent.importance = value; }),
    "layout.axis": () => readEnum("layout.axis", axisValues, (value) => { resolved.layout.axis = value; }),
    "layout.width": () => readEnum("layout.width", widthValues, (value) => { resolved.layout.width = value; }),
    "layout.height": () => readEnum("layout.height", heightValues, (value) => { resolved.layout.height = value; }),
    "layout.align": () => readEnum("layout.align", alignValues, (value) => { resolved.layout.align = value; }),
    "layout.justify": () => readEnum("layout.justify", justifyValues, (value) => { resolved.layout.justify = value; }),
    "layout.overflow": () => readEnum("layout.overflow", overflowValues, (value) => { resolved.layout.overflow = value; }),
    "layout.fixedWidth": () => readNumber("layout.fixedWidth", 1, 10_000, (value) => { resolved.layout.fixedWidth = value; }),
    "layout.fixedHeight": () => readNumber("layout.fixedHeight", 1, 10_000, (value) => { resolved.layout.fixedHeight = value; }),
    "layout.minWidth": () => readNumber("layout.minWidth", 0, 10_000, (value) => { resolved.layout.minWidth = value; }),
    "layout.maxWidth": () => readNumber("layout.maxWidth", 0, 10_000, (value) => { resolved.layout.maxWidth = value; }),
    "layout.minHeight": () => readNumber("layout.minHeight", 0, 10_000, (value) => { resolved.layout.minHeight = value; }),
    "layout.maxHeight": () => readNumber("layout.maxHeight", 0, 10_000, (value) => { resolved.layout.maxHeight = value; }),
    "layout.columns": () => readNumber("layout.columns", 1, 12, (value) => { resolved.layout.columns = Math.round(value); }),
    "layout.splitRatio": () => readNumber("layout.splitRatio", 0.1, 0.9, (value) => { resolved.layout.splitRatio = value; }),
    "layout.gapToken": () => readSpacingToken("layout.gapToken", "gapToken"),
    "layout.gap-token": () => readSpacingToken("layout.gap-token", "gapToken"),
    "layout.paddingToken": () => readSpacingToken("layout.paddingToken", "paddingToken"),
    "layout.padding-token": () => readSpacingToken("layout.padding-token", "paddingToken"),
    "layout.placement.compact": () => readEnum("layout.placement.compact", placementValues, (value) => { resolved.layout.compactPlacement = value; }),
    "layout.placement.regular": () => readEnum("layout.placement.regular", placementValues, (value) => { resolved.layout.regularPlacement = value; }),
    "style.role": () => readText("style.role", (value) => { resolved.style.role = value; }),
    "style.emphasis": () => readEnum("style.emphasis", emphasisValues, (value) => { resolved.style.emphasis = value; }),
    "accessibility.label": () => readText("accessibility.label", (value) => { resolved.accessibility.label = value; }),
    "accessibility.hint": () => readText("accessibility.hint", (value) => { resolved.accessibility.hint = value; }),
    "accessibility.live": () => readEnum("accessibility.live", liveValues, (value) => { resolved.accessibility.live = value; }),
  };

  for (const key of Object.keys(overrides).sort()) {
    const apply = knownOverrides[key];
    if (apply) apply();
    else warn(key, "This platform override is not supported and was ignored.");
  }
  for (const dimension of ["Width", "Height"] as const) {
    const minimumKey = `min${dimension}` as "minWidth" | "minHeight";
    const maximumKey = `max${dimension}` as "maxWidth" | "maxHeight";
    const minimum = resolved.layout[minimumKey];
    const maximum = resolved.layout[maximumKey];
    if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
      diagnostics.push({
        severity: "warning",
        path: `${overridePath}.layout.${minimumKey}`,
        message: `The target minimum ${dimension.toLowerCase()} exceeded its maximum; shared constraints were restored.`,
      });
      const sharedMinimum = node.layout[minimumKey];
      const sharedMaximum = node.layout[maximumKey];
      if (sharedMinimum === undefined) delete resolved.layout[minimumKey];
      else resolved.layout[minimumKey] = sharedMinimum;
      if (sharedMaximum === undefined) delete resolved.layout[maximumKey];
      else resolved.layout[maximumKey] = sharedMaximum;
    }
  }
  if (resolved.layout.width === "fixed" && resolved.layout.fixedWidth === undefined) {
    diagnostics.push({
      severity: "warning",
      path: `screens.${screenId}.nodes.${node.id}.layout.width`,
      message: "Fixed width requires an explicit dimension; the compiler uses fill width.",
    });
  }
  if (resolved.layout.height === "fixed" && resolved.layout.fixedHeight === undefined) {
    diagnostics.push({
      severity: "warning",
      path: `screens.${screenId}.nodes.${node.id}.layout.height`,
      message: "Fixed height requires an explicit dimension; the compiler uses intrinsic height.",
    });
  }
  if (target === "swiftui" && resolved.accessibility.live === "assertive") {
    diagnostics.push({
      severity: "warning",
      path: `screens.${screenId}.nodes.${node.id}.accessibility.live`,
      message: "SwiftUI does not expose assertive live-region urgency; the compiler uses the updatesFrequently accessibility trait.",
    });
  }
  return resolved;
}

export function lowerGraph(graph: SemanticInterfaceGraph, target: PlatformTarget): PlatformIR {
  const platform = graph.platforms.find((candidate) => candidate.target === target);
  if (!platform?.enabled) throw new Error(`The ${target} target is not enabled by this graph`);
  const diagnostics: CompilerDiagnostic[] = [];
  const assetsById = new Map(graph.assets.map((asset) => [asset.id, asset]));
  const ir: PlatformIR = {
    target,
    productName: graph.product.name,
    tokens: resolveTokenMode(graph.tokens),
    tokenCollection: graph.tokens,
    tokenModes: Object.fromEntries(Object.keys(graph.tokens.modes).sort().map((modeId) => [
      modeId,
      resolveTokenMode(graph.tokens, modeId),
    ])),
    activeTokenMode: graph.tokens.activeMode,
    assets: graph.assets,
    devices: resolveDeviceConfiguration(graph.devices),
    web: graph.web,
    expo: graph.expo,
    screens: graph.screens.map((screen) => {
      const contract = graph.contracts.find((candidate) => candidate.screenId === screen.id);
      const referencedFixtures = contract
        ? contract.fixtures.flatMap((id) => {
          const fixture = graph.fixtures.find((candidate) => candidate.id === id);
          return fixture ? [fixture] : [];
        })
        : [];
      const defaultState = [...referencedFixtures]
        .sort((left, right) => statePriority.indexOf(left.state) - statePriority.indexOf(right.state))[0]?.state
        ?? contract?.visualStates[0]
        ?? "idle";
      const fixtures: PlatformIRFixture[] = contract
        ? referencedFixtures.map((fixture) => ({
          id: fixture.id,
          state: fixture.state,
          data: completeFixture(contract, fixture.state, fixture.data),
        }))
        : [];
      const defaultFixture = fixtures.find((fixture) => fixture.state === defaultState) ?? {
        id: `${screen.id}.${defaultState}`,
        state: defaultState,
        data: contract ? completeFixture(contract, defaultState, {}) : {},
      };
      const eventTargets = Object.fromEntries(
        graph.flows.flatMap((flow) => flow.steps)
          .filter((step) => step.from === screen.id)
          .map((step) => [step.event, step.to]),
      );
      const lowerNode = (node: SemanticNode): PlatformIRNode => {
        const semantics = resolveNodeSemantics(graph, screen.id, node, target, diagnostics);
        const definition = node.asset ? assetsById.get(node.asset.assetId) : undefined;
        const variant = node.asset?.variantId
          ? definition?.variants.find((candidate) => candidate.id === node.asset?.variantId)
          : undefined;
        const file = variant ?? definition;
        if (definition?.exportPolicy === "blocked") {
          diagnostics.push({
            severity: "warning",
            path: `screens.${screen.id}.nodes.${node.id}.asset`,
            message: `Asset ${definition.id} is blocked from generated output; the target uses a semantic fallback.`,
          });
        }
        if (definition?.exportPolicy === "reference") {
          diagnostics.push({
            severity: "warning",
            path: `screens.${screen.id}.nodes.${node.id}.asset`,
            message: `Asset ${definition.id} is reference-only; generated output expects the host application to provide /${file?.storageKey ?? definition.storageKey}.`,
          });
        }
        if (target === "swiftui" && definition && ["svg", "icon", "video", "audio"].includes(definition.kind)) {
          diagnostics.push({
            severity: "warning",
            path: `screens.${screen.id}.nodes.${node.id}.asset`,
            message: `SwiftUI raw ${definition.kind} assets require a platform adapter; the target uses a semantic fallback.`,
          });
        }
        return {
          id: node.id,
          kind: node.kind,
          ...semantics,
          asset: node.asset && definition && file ? {
            id: definition.id,
            kind: definition.kind,
            digest: file.digest,
            mediaType: file.mediaType,
            storageKey: file.storageKey,
            exportPolicy: definition.exportPolicy,
            license: definition.license,
            fit: node.asset.fit,
            focalPoint: node.asset.focalPoint,
            decorative: node.asset.decorative,
          } : null,
          web: node.web ?? null,
          expo: node.expo ?? (graph.expo ? { strategy: graph.expo.defaultRenderStrategy } : null),
          events: eventsForNode(node, contract),
          visibility: node.states.map((state) => ({
            state: state.name,
            ...(state.visibleWhen ? { expression: state.visibleWhen } : {}),
          })),
          bindings: bindingsForNode(node, contract?.data ?? []),
          children: node.children.map(lowerNode),
        };
      };
      return {
        id: screen.id,
        title: screen.title,
        purpose: screen.purpose,
        route: screen.route,
        nodes: screen.nodes.map(lowerNode),
        fixtures,
        defaultFixture,
        eventTargets,
        layoutCoverage: layoutCoverage(screen.nodes),
        ...(contract ? { contract } : {}),
      };
    }),
    diagnostics,
  };
  ir.diagnostics.sort((left, right) => left.path.localeCompare(right.path) || left.message.localeCompare(right.message));
  return ir;
}

export function fingerprintFiles(files: GeneratedFile[]): string {
  let hash = 2166136261;
  const source = [...files]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((file) => `${file.path}\0${file.content}`)
    .join("\0");
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function findPrimaryAction(screen: PlatformIRScreen): PlatformIRNode | undefined {
  return flattenIRNodes(screen.nodes).find((node) => node.kind === "primary-action");
}

export function flattenIRNodes(roots: readonly PlatformIRNode[]): PlatformIRNode[] {
  const nodes: PlatformIRNode[] = [];
  const visit = (items: readonly PlatformIRNode[]) => {
    for (const node of items) {
      nodes.push(node);
      visit(node.children);
    }
  };
  visit(roots);
  return nodes;
}
