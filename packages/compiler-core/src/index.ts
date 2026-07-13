import type {
  PlatformTarget,
  SemanticInterfaceGraph,
  SemanticNode,
  UIContract,
} from "@intentform/semantic-schema";

export interface PlatformIRNode {
  id: string;
  kind: SemanticNode["kind"];
  label: string;
  accessibilityLabel: string;
  importance: "primary" | "secondary" | "supporting";
  compactPlacement: "inline" | "persistent-bottom";
  regularPlacement: "inline" | "persistent-bottom";
  eventName: string | null;
  visibleStates: string[];
}

export interface PlatformIRScreen {
  id: string;
  title: string;
  route: string;
  nodes: PlatformIRNode[];
  fixture: Record<string, unknown>;
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

export function lowerGraph(graph: SemanticInterfaceGraph, target: PlatformTarget): PlatformIR {
  return {
    target,
    productName: graph.product.name,
    tokens: graph.tokens,
    screens: graph.screens.map((screen) => {
      const contract = graph.contracts.find((candidate) => candidate.screenId === screen.id);
      const fixture = graph.fixtures.find(
        (candidate) => candidate.screenId === screen.id && candidate.state !== "failed",
      )?.data ?? {};
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
          eventName: node.interactions[0]?.event ?? null,
          visibleStates: node.states.map((state) => state.name),
        })),
        fixture,
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
