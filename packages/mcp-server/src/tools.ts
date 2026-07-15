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
  semanticDiff,
  stableSerialize,
  type SemanticChange,
  type SemanticInterfaceGraph,
  type SemanticNode,
} from "@intentform/semantic-schema";
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
      graphFile: join(dir, ".intentform", "graph.json"),
    },
    product: graph.product,
    schemaVersion: graph.schemaVersion,
    fingerprint,
    seeded,
    tokens: graph.tokens,
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
  if (write) {
    for (const file of output.files) {
      const destination = join(outputRoot, file.path);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, file.content, "utf8");
      written.push(destination);
    }
  }
  return {
    target,
    fingerprint: output.fingerprint,
    diagnostics: output.diagnostics,
    fileCount: output.files.length,
    files: output.files.map((file) => file.path),
    ...(write ? { writtenTo: outputRoot, written } : {}),
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
