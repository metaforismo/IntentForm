import type {
  Expression,
  PlatformTarget,
  SemanticInterfaceGraph,
  SemanticNode,
  UIContract,
} from "@intentform/semantic-schema";

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

export interface PlatformIRNode {
  id: string;
  kind: SemanticNode["kind"];
  label: string;
  accessibilityLabel: string;
  importance: "primary" | "secondary" | "supporting";
  compactPlacement: "inline" | "persistent-bottom";
  regularPlacement: "inline" | "persistent-bottom";
  events: PlatformIREvent[];
  visibility: Array<{ state: string; expression?: Expression }>;
  bindings: {
    value: PlatformIRField | null;
    detail: PlatformIRField | null;
    status: PlatformIRField | null;
  };
}

export interface PlatformIRScreen {
  id: string;
  title: string;
  route: string;
  nodes: PlatformIRNode[];
  fixtures: PlatformIRFixture[];
  defaultFixture: PlatformIRFixture;
  eventTargets: Record<string, string>;
  contract?: UIContract;
}

export interface PlatformIR {
  target: PlatformTarget;
  productName: string;
  tokens: SemanticInterfaceGraph["tokens"];
  screens: PlatformIRScreen[];
}

export interface GeneratedFile {
  path: string;
  content: string;
}

export interface GeneratedFileSet {
  target: PlatformTarget;
  files: GeneratedFile[];
  fingerprint: string;
}

export interface CompilerDiagnostic {
  severity: "warning" | "error";
  path: string;
  message: string;
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
  const errors = [...genericDiagnostics, ...compiler.validate(output)]
    .filter((diagnostic) => diagnostic.severity === "error");
  if (errors.length > 0) throw new CompilerValidationError(compiler.id, errors);
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

export function lowerGraph(graph: SemanticInterfaceGraph, target: PlatformTarget): PlatformIR {
  const platform = graph.platforms.find((candidate) => candidate.target === target);
  if (!platform?.enabled) throw new Error(`The ${target} target is not enabled by this graph`);
  return {
    target,
    productName: graph.product.name,
    tokens: graph.tokens,
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
      return {
        id: screen.id,
        title: screen.title,
        route: screen.route,
        nodes: screen.nodes.map((node) => ({
          id: node.id,
          kind: node.kind,
          label: node.intent.label ?? node.intent.purpose,
          accessibilityLabel: node.accessibility.label,
          importance: node.intent.importance,
          compactPlacement: node.layout.placement?.compact ?? "inline",
          regularPlacement: node.layout.placement?.regular ?? "inline",
          events: eventsForNode(node, contract),
          visibility: node.states.map((state) => ({
            state: state.name,
            ...(state.visibleWhen ? { expression: state.visibleWhen } : {}),
          })),
          bindings: bindingsForNode(node, contract?.data ?? []),
        })),
        fixtures,
        defaultFixture,
        eventTargets,
        ...(contract ? { contract } : {}),
      };
    }),
  };
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
  return screen.nodes.find((node) => node.kind === "primary-action");
}
