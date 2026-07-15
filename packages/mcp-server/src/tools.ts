import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { compileReact } from "@intentform/compiler-react";
import { compileSwiftUI } from "@intentform/compiler-swiftui";
import {
  CANONICAL_DEVICE_VIEWPORTS,
  applyGraphPatch,
  flattenSemanticNodes,
  graphPatchSchema,
  parseGraph,
  resolveTokenMode,
  semanticDiff,
  stableSerialize,
  type SemanticChange,
  type SemanticInterfaceGraph,
  type SemanticNode,
} from "@intentform/semantic-schema";
import { instantiateComponent as instantiateGraphComponent } from "@intentform/semantic-schema/component-library";
import {
  importDtcg,
  serializeDtcg,
  tokenCount,
} from "@intentform/token-assets";
import {
  exportProjectAssets,
  garbageCollectProjectAssets,
  importProjectAsset,
  inspectProjectAssets,
  type ImportProjectAssetInput,
} from "@intentform/token-assets/assets";
import { verifyGraph, type VerificationFinding } from "@intentform/verifier";
import {
  graphFingerprint,
  listRevisions,
  loadProject,
  loadRevisionGraph,
  migrateProject,
  previewProjectMigration,
  saveProject,
  type RevisionEntry,
} from "./store.ts";

export type ScenarioId = "compact" | "regular";

const scenarios: Record<ScenarioId, { width: number; height: number }> = {
  compact: CANONICAL_DEVICE_VIEWPORTS.compactPhone,
  regular: CANONICAL_DEVICE_VIEWPORTS.regularPhone,
};

function verificationSummary(graph: SemanticInterfaceGraph, scenario: ScenarioId) {
  const result = verifyGraph(graph, { target: "swiftui", viewport: scenarios[scenario], buildStatus: "not-run" });
  return {
    scenario,
    viewport: scenarios[scenario],
    buildStatus: result.scenario.buildStatus,
    passed: result.passed,
    findings: result.findings,
  };
}

type CompilerTarget = "react" | "swiftui";

function outputSummary(graph: SemanticInterfaceGraph, target: CompilerTarget) {
  const platform = graph.platforms.find((candidate) => candidate.target === target);
  if (!platform?.enabled) {
    return {
      status: "disabled" as const,
      fingerprint: null,
      message: `The ${target} target is not enabled by this graph.`,
    };
  }

  try {
    const output = target === "react" ? compileReact(graph) : compileSwiftUI(graph);
    return {
      status: "generated" as const,
      fingerprint: output.fingerprint,
      diagnosticCount: output.diagnostics.length,
      diagnostics: output.diagnostics,
      message: null,
    };
  } catch (error) {
    return {
      status: "failed" as const,
      fingerprint: null,
      message: error instanceof Error
        ? error.message.slice(0, 500)
        : `The ${target} compiler failed without a diagnostic.`,
    };
  }
}

export function describeProject(dir: string) {
  const { graph, fingerprint, seeded } = loadProject(dir);
  const verification = verificationSummary(graph, "compact");
  const describeNode = (node: SemanticNode, parentId: string | null, depth: number): Record<string, unknown> => ({
    id: node.id,
    parentId,
    depth,
    kind: node.kind,
    label: node.intent.label,
    importance: node.intent.importance,
    layout: {
      axis: node.layout.axis,
      width: node.layout.width,
      height: node.layout.height,
      align: node.layout.align,
      justify: node.layout.justify,
      overflow: node.layout.overflow,
      columns: node.layout.columns,
      splitRatio: node.layout.splitRatio,
      adaptive: node.layout.adaptive,
      position: node.layout.position,
      placement: node.layout.placement,
    },
    states: node.states.map((state) => state.name),
    events: node.interactions.map((interaction) => interaction.event),
    children: node.children.map((child) => describeNode(child, node.id, depth + 1)),
  });
  return {
    project: {
      kind: "local" as const,
      root: dir,
      graphFile: join(dir, "graph.json"),
    },
    product: graph.product,
    schemaVersion: graph.schemaVersion,
    fingerprint,
    seeded,
    tokens: graph.tokens,
    tokenSummary: {
      defaultMode: graph.tokens.defaultMode,
      activeMode: graph.tokens.activeMode,
      modeCount: Object.keys(graph.tokens.modes).length,
      tokenCount: tokenCount(graph.tokens),
      resolved: resolveTokenMode(graph.tokens),
    },
    assets: {
      count: graph.assets.length,
      diagnostics: inspectProjectAssets(dir, graph.assets),
      items: graph.assets.map((asset) => ({
        id: asset.id,
        name: asset.name,
        kind: asset.kind,
        digest: asset.digest,
        mediaType: asset.mediaType,
        byteLength: asset.byteLength,
        variants: asset.variants.map(({ id, digest, mediaType, byteLength }) => ({ id, digest, mediaType, byteLength })),
        license: asset.license,
        exportPolicy: asset.exportPolicy,
      })),
    },
    components: graph.components.map((definition) => ({
      id: definition.id,
      name: definition.name,
      description: definition.description,
      version: definition.version,
      properties: definition.properties.map((property) => ({
        name: property.name,
        type: property.type,
        required: property.required,
        default: property.default,
      })),
      slots: definition.slots.map((slot) => ({
        name: slot.name,
        required: slot.required,
        allowedKinds: slot.allowedKinds,
        maxChildren: slot.maxChildren,
      })),
      variants: definition.variants.map((variant) => variant.id),
      states: definition.states.map((state) => state.id),
      deprecated: definition.deprecated ?? null,
    })),
    screens: graph.screens.map((screen) => ({
      id: screen.id,
      title: screen.title,
      route: screen.route,
      purpose: screen.purpose,
      nodeCount: flattenSemanticNodes(screen.nodes).length,
      nodes: screen.nodes.map((node) => describeNode(node, null, 1)),
    })),
    flows: graph.flows,
    contracts: graph.contracts.map((contract) => ({
      screenId: contract.screenId,
      data: contract.data,
      events: contract.events.map((event) => event.name),
      visualStates: contract.visualStates,
    })),
    verification: {
      buildStatus: verification.buildStatus,
      passed: verification.passed,
      findingCount: verification.findings.length,
    },
    outputs: {
      react: outputSummary(graph, "react"),
      swiftui: outputSummary(graph, "swiftui"),
    },
  };
}

export function getGraph(dir: string): string {
  return stableSerialize(loadProject(dir).graph);
}

export function previewMigration(dir: string) {
  return previewProjectMigration(dir);
}

export function applyMigration(dir: string, expectedSourceFingerprint: string) {
  const result = migrateProject(dir, expectedSourceFingerprint);
  const { graph: _graph, ...summary } = result;
  return summary;
}

export interface MutationResult {
  changes: SemanticChange[];
  fingerprint: string;
  revision: RevisionEntry | null;
  verification: {
    buildStatus: "passed" | "failed" | "not-run";
    passed: boolean;
    findings: VerificationFinding[];
  };
}

function commit(
  dir: string,
  before: SemanticInterfaceGraph,
  after: SemanticInterfaceGraph,
  reason: string,
  expectedFingerprint: string,
): MutationResult {
  const saved = saveProject(dir, after, reason, expectedFingerprint);
  const verification = verificationSummary(after, "compact");
  return {
    changes: semanticDiff(before, after),
    fingerprint: saved.fingerprint,
    revision: saved.revision,
    verification: {
      buildStatus: verification.buildStatus,
      passed: verification.passed,
      findings: verification.findings,
    },
  };
}

export function applyPatch(dir: string, patchInput: unknown): MutationResult {
  const patch = graphPatchSchema.parse(patchInput);
  const { graph, fingerprint } = loadProject(dir);
  const after = applyGraphPatch(graph, patch);
  return commit(dir, graph, after, patch.rationale || `patch ${patch.id}`, fingerprint);
}

export function searchComponents(dir: string, query: string) {
  const normalized = query.trim().toLowerCase();
  if (normalized.length > 120) throw new Error("Component search query exceeds 120 characters");
  const { graph, fingerprint } = loadProject(dir);
  const definitions = graph.components.filter((definition) =>
    !normalized || `${definition.id} ${definition.name} ${definition.description}`.toLowerCase().includes(normalized));
  return {
    fingerprint,
    query: normalized,
    count: definitions.length,
    components: definitions.map((definition) => ({
      id: definition.id,
      name: definition.name,
      description: definition.description,
      version: definition.version,
      props: definition.properties.map((property) => ({
        name: property.name,
        type: property.type,
        required: property.required,
        default: property.default,
      })),
      slots: definition.slots,
      variants: definition.variants.map(({ id, label }) => ({ id, label })),
      states: definition.states.map(({ id, label }) => ({ id, label })),
      deprecated: definition.deprecated ?? null,
    })),
  };
}

export function componentSchema(dir: string, definitionId?: string) {
  const { graph, fingerprint } = loadProject(dir);
  const definitions = definitionId
    ? graph.components.filter((definition) => definition.id === definitionId)
    : graph.components;
  if (definitionId && definitions.length === 0) {
    throw new Error(`Unknown component definition: ${definitionId}`);
  }
  return {
    abiVersion: "1.0.0" as const,
    schemaVersion: graph.schemaVersion,
    fingerprint,
    definitions,
  };
}

export function instantiateProjectComponent(
  dir: string,
  input: {
    definitionId: string;
    instanceId: string;
    screenId: string;
    parentId?: string | null;
    index?: number;
    variant?: string;
    state?: string;
    props?: Record<string, string | number | boolean>;
  },
): MutationResult {
  const { graph, fingerprint } = loadProject(dir);
  const draft = instantiateGraphComponent(graph, input);
  const after = parseGraph(draft);
  return commit(dir, graph, after, `instantiate ${input.definitionId} as ${input.instanceId}`, fingerprint);
}

export function listTokenModes(dir: string) {
  const { graph, fingerprint } = loadProject(dir);
  return {
    fingerprint,
    defaultMode: graph.tokens.defaultMode,
    activeMode: graph.tokens.activeMode,
    aliases: graph.tokens.aliases,
    deprecated: graph.tokens.deprecated,
    modes: Object.entries(graph.tokens.modes)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, mode]) => ({
        id,
        name: mode.name,
        description: mode.description ?? null,
        overrideCount: Object.values(mode.values).reduce((count, group) => count + Object.keys(group).length, 0),
        resolved: resolveTokenMode(graph.tokens, id),
      })),
  };
}

export function exportProjectTokens(dir: string) {
  const { graph, fingerprint } = loadProject(dir);
  return {
    fingerprint,
    format: "DTCG",
    formatVersion: "2025.10",
    mediaType: "application/json",
    suggestedName: `${graph.product.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "intentform"}.tokens.json`,
    tokenCount: tokenCount(graph.tokens),
    content: serializeDtcg(graph.tokens),
  };
}

export function importProjectTokens(dir: string, document: unknown): MutationResult & { diagnostics: ReturnType<typeof importDtcg>["diagnostics"] } {
  const imported = importDtcg(document);
  const { graph, fingerprint } = loadProject(dir);
  const draft = structuredClone(graph);
  draft.tokens = imported.tokens;
  const after = parseGraph(draft);
  return {
    ...commit(dir, graph, after, "import DTCG 2025.10 token document", fingerprint),
    diagnostics: imported.diagnostics,
  };
}

export function searchProjectAssets(dir: string, query = "") {
  const normalized = query.trim().toLowerCase();
  if (normalized.length > 120) throw new Error("Asset search query exceeds 120 characters");
  const { graph, fingerprint } = loadProject(dir);
  const diagnostics = inspectProjectAssets(dir, graph.assets);
  const assets = graph.assets.filter((asset) => !normalized || [
    asset.id,
    asset.name,
    asset.kind,
    asset.mediaType,
    asset.license.name,
    asset.license.spdx ?? "",
  ].join(" ").toLowerCase().includes(normalized));
  return {
    fingerprint,
    query: normalized,
    count: assets.length,
    assets: assets.map((asset) => ({
      ...asset,
      diagnostics: diagnostics.filter((item) => item.assetId === asset.id),
    })),
  };
}

export function importProjectAssetFromInbox(
  dir: string,
  input: ImportProjectAssetInput,
): MutationResult & { asset: ReturnType<typeof importProjectAsset> } {
  const { graph, fingerprint } = loadProject(dir);
  if (graph.assets.some((asset) => asset.id === input.id)) throw new Error(`Asset id already exists: ${input.id}`);
  const asset = importProjectAsset(dir, input);
  const draft = structuredClone(graph);
  draft.assets.push(asset);
  const after = parseGraph(draft);
  return {
    ...commit(dir, graph, after, `import licensed asset ${asset.id}`, fingerprint),
    asset,
  };
}

export function collectProjectAssets(dir: string, apply = false) {
  const { graph, fingerprint } = loadProject(dir);
  return {
    fingerprint,
    apply,
    ...garbageCollectProjectAssets(dir, graph.assets, apply),
  };
}

export function previewPatch(dir: string, patchInput: unknown) {
  const patch = graphPatchSchema.parse(patchInput);
  const { graph, fingerprint } = loadProject(dir);
  const after = applyGraphPatch(graph, patch);
  const verification = verificationSummary(after, "compact");
  return {
    patchId: patch.id,
    currentFingerprint: fingerprint,
    previewFingerprint: graphFingerprint(after),
    changes: semanticDiff(graph, after),
    verification: {
      buildStatus: verification.buildStatus,
      passed: verification.passed,
      findings: verification.findings,
    },
  };
}

export function replaceGraph(dir: string, graphInput: unknown, reason: string): MutationResult {
  const { graph, fingerprint } = loadProject(dir);
  const after = parseGraph(graphInput);
  return commit(dir, graph, after, reason, fingerprint);
}

export function verifyProject(dir: string, scenario: ScenarioId) {
  const { graph } = loadProject(dir);
  return verificationSummary(graph, scenario);
}

export function compileProject(dir: string, target: "react" | "swiftui", write: boolean) {
  const { graph } = loadProject(dir);
  const output = target === "react" ? compileReact(graph) : compileSwiftUI(graph);
  const outputRoot = join(dir, "output", target);
  const written: string[] = [];
  const assetDiagnostics = inspectProjectAssets(dir, graph.assets);
  let copiedAssets: string[] = [];
  if (write) {
    for (const file of output.files) {
      const destination = join(outputRoot, file.path);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, file.content, "utf8");
      written.push(destination);
    }
    const assetExport = exportProjectAssets(dir, graph.assets, outputRoot, target);
    copiedAssets = assetExport.copied;
  }
  return {
    target,
    fingerprint: output.fingerprint,
    diagnostics: output.diagnostics,
    assetDiagnostics,
    fileCount: output.files.length,
    files: output.files.map((file) => file.path),
    ...(write ? { writtenTo: outputRoot, written, copiedAssets } : {}),
  };
}

export function projectRevisions(dir: string) {
  const { fingerprint } = loadProject(dir);
  return { current: fingerprint, revisions: listRevisions(dir) };
}

export function revertProject(dir: string, revisionId: string): MutationResult {
  const { graph, fingerprint } = loadProject(dir);
  const restored = loadRevisionGraph(dir, revisionId);
  return commit(dir, graph, restored, `revert to ${revisionId}`, fingerprint);
}

export function diffAgainstRevision(dir: string, revisionId?: string) {
  const { graph, fingerprint } = loadProject(dir);
  const revisions = listRevisions(dir);
  const baselineId = revisionId ?? revisions[0]?.id;
  if (!baselineId) return { baseline: null, current: fingerprint, changes: [] as SemanticChange[] };
  const baseline = loadRevisionGraph(dir, baselineId);
  return {
    baseline: baselineId,
    current: fingerprint,
    changes: semanticDiff(baseline, graph),
  };
}

export { graphFingerprint };
