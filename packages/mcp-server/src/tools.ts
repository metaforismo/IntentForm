import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { compileExpo } from "@intentform/compiler-expo";
import { compileReact } from "@intentform/compiler-react";
import { compileSwiftUI } from "@intentform/compiler-swiftui";
import { compileWeb } from "@intentform/compiler-web";
import { resolveDeviceConfiguration } from "@intentform/device-registry";
import { inspectLocalBezelPacks } from "@intentform/device-bezels";
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
  type PlatformTarget,
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
import {
  ACCESSIBILITY_PROFILES,
  auditAccessibility,
  verifyGraph,
  type AccessibilitySuppression,
  type VerificationFinding,
} from "@intentform/verifier";
import { verifyResponsiveWeb } from "@intentform/web-verifier";
import {
  assertFreshReviewSequence,
  decryptReviewBundle,
  encryptReviewBundle,
  pluginGrantSchema,
  sha256,
  verifyRemoteEvidence,
  type EncryptedReviewBundle,
  type PluginPermission,
} from "@intentform/ecosystem";
import {
  PREVIEW_TARGETS,
  PreviewBindingCache,
  PreviewSupervisor,
  readPreviewEvidence,
  recoverOrphanedPreviewEvidence,
  resolvePreviewEvidence,
  runLocalPreview,
  type PreviewTarget,
} from "@intentform/preview-daemon";
import {
  graphFingerprint,
  listRevisions,
  loadProject,
  loadRevisionGraph,
  migrateProject,
  previewProjectMigration,
  saveProject,
  withProjectWriteLock,
  type RevisionEntry,
} from "./store.ts";
import {
  HistoryConflictError,
  applyHistoryBranchPatch,
  createHistoryBranch,
  deleteHistoryBranch,
  inspectOperationHistory,
  previewHistoryBranchMerge,
  previewHistoryOperationTransform,
  recoverOperationHistory,
  type HistoryAuthor,
  type HistoryOperation,
  type HistoryProvenance,
} from "./history.ts";
import { semanticThreeWayMerge } from "./semantic-merge.ts";
import {
  inspectEcosystem,
  previewStoredPackageUpdate,
  readPackageArtifact,
  readReviewHighWaterMarks,
  readEcosystemTrust,
  recordReviewSequence,
  writePackageArtifact,
  writePluginGrant,
} from "./ecosystem-store.ts";

export type ScenarioId = "compact" | "regular";

const scenarios: Record<ScenarioId, { width: number; height: number }> = {
  compact: CANONICAL_DEVICE_VIEWPORTS.compactPhone,
  regular: CANONICAL_DEVICE_VIEWPORTS.regularPhone,
};

const previewSupervisor = new PreviewSupervisor(2, 180_000);
const previewBindingCache = new PreviewBindingCache();

function previewTargetStatus(
  dir: string,
  graph: SemanticInterfaceGraph,
  fingerprint: string,
  target: PreviewTarget,
  profileId?: string,
) {
  try {
    const binding = previewBindingCache.resolve(graph, fingerprint, target, profileId);
    const current = previewSupervisor.current(dir, target);
    const manifest = current ?? recoverOrphanedPreviewEvidence(dir, target);
    return resolvePreviewEvidence(dir, binding, manifest);
  } catch (error) {
    return {
      target,
      unavailable: true as const,
      message: error instanceof Error ? error.message.slice(0, 500) : "This preview target is unavailable.",
    };
  }
}

export function projectPreviewStatus(dir: string, profileId?: string) {
  const { graph, fingerprint } = loadProject(dir);
  return {
    fingerprint,
    targets: PREVIEW_TARGETS.map((target) => previewTargetStatus(dir, graph, fingerprint, target, profileId)),
  };
}

export function runProjectPreview(
  dir: string,
  target: PreviewTarget,
  expectedFingerprint: string,
  restart: boolean,
  profileId?: string,
) {
  const { graph, fingerprint } = loadProject(dir);
  if (fingerprint !== expectedFingerprint) throw new Error(`Project fingerprint conflict: expected ${expectedFingerprint}, current ${fingerprint}.`);
  const binding = previewBindingCache.resolve(graph, fingerprint, target, profileId);
  const manifest = restart
    ? previewSupervisor.restart({ projectDir: dir, graph, binding, runner: runLocalPreview })
    : previewSupervisor.start({ projectDir: dir, graph, binding, runner: runLocalPreview });
  return { fingerprint, target: resolvePreviewEvidence(dir, binding, manifest) };
}

export function cancelProjectPreview(
  dir: string,
  target: PreviewTarget,
  expectedFingerprint: string,
  profileId?: string,
) {
  const { graph, fingerprint } = loadProject(dir);
  if (fingerprint !== expectedFingerprint) throw new Error(`Project fingerprint conflict: expected ${expectedFingerprint}, current ${fingerprint}.`);
  const binding = previewBindingCache.resolve(graph, fingerprint, target, profileId);
  const manifest = previewSupervisor.cancel(dir, target);
  return {
    fingerprint,
    target: resolvePreviewEvidence(dir, binding, manifest ?? readPreviewEvidence(dir, target)),
  };
}

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

type CompilerTarget = "react" | "swiftui" | "expo" | "web";

const compileTarget = (graph: SemanticInterfaceGraph, target: CompilerTarget) => {
  if (target === "react") return compileReact(graph);
  if (target === "swiftui") return compileSwiftUI(graph);
  if (target === "expo") return compileExpo(graph);
  return compileWeb(graph);
};

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
    const output = compileTarget(graph, target);
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
    web: node.web ?? null,
    expo: node.expo ?? null,
    states: node.states.map((state) => state.name),
    events: node.interactions.map((interaction) => interaction.event),
    prototypeActions: node.prototypeActions,
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
    devices: deviceProfileResource(dir),
    deviceBezels: deviceBezelResource(dir),
    web: graph.web ? {
      ...graph.web,
      verification: verifyResponsiveWeb(graph),
    } : null,
    expo: graph.expo ?? null,
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
    prototype: graph.prototype,
    reviewThreads: graph.reviewThreads,
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
      expo: outputSummary(graph, "expo"),
      web: outputSummary(graph, "web"),
    },
  };
}

export function deviceProfileResource(dir: string) {
  const { graph, fingerprint } = loadProject(dir);
  const resolved = resolveDeviceConfiguration(graph.devices);
  const entries = new Map(graph.devices.profiles.map((entry) => [
    entry.source === "registry" ? entry.id : entry.profile.id,
    entry,
  ]));
  return {
    schemaVersion: graph.schemaVersion,
    fingerprint,
    registryVersion: graph.devices.registryVersion,
    defaultProfile: resolved.defaultProfile.id,
    profiles: resolved.profiles.map((profile) => {
      const entry = entries.get(profile.id)!;
      return {
        source: entry.source,
        checksum: entry.checksum,
        ...profile,
      };
    }),
  };
}

export function deviceBezelResource(dir: string) {
  const inspection = inspectLocalBezelPacks(dir);
  return {
    enabled: inspection.enabled,
    diagnostics: inspection.diagnostics,
    packs: inspection.packs.map(({ manifest, manifestChecksum }) => ({
      packId: manifest.packId,
      version: manifest.version,
      name: manifest.name,
      publisher: manifest.publisher,
      revoked: manifest.revoked,
      manifestChecksum,
      license: manifest.license,
      profiles: manifest.profiles.map((profile) => ({
        deviceProfileId: profile.deviceProfileId,
        assetDigest: profile.asset.digest,
        mediaType: profile.asset.mediaType,
        image: { width: profile.asset.width, height: profile.asset.height },
        viewport: profile.viewport,
      })),
    })),
  };
}

export function getGraph(dir: string): string {
  return stableSerialize(loadProject(dir).graph);
}

export function previewMigration(dir: string) {
  return previewProjectMigration(dir);
}

export function applyMigration(dir: string, expectedSourceFingerprint: string) {
  const result = migrateProject(dir, expectedSourceFingerprint, "agent");
  const { graph: _graph, ...summary } = result;
  return summary;
}

export interface MutationResult {
  changes: SemanticChange[];
  fingerprint: string;
  revision: RevisionEntry | null;
  operation: HistoryOperation | null;
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
  provenance: HistoryProvenance = { author: "agent", kind: "save" },
): MutationResult {
  const saved = saveProject(dir, after, reason, expectedFingerprint, provenance);
  const verification = verificationSummary(after, "compact");
  return {
    changes: semanticDiff(before, after),
    fingerprint: saved.fingerprint,
    revision: saved.revision,
    operation: saved.operation,
    verification: {
      buildStatus: verification.buildStatus,
      passed: verification.passed,
      findings: verification.findings,
    },
  };
}

export function projectEcosystemResource(dir: string) {
  const { graph, fingerprint } = loadProject(dir);
  return { fingerprint, ...inspectEcosystem(dir, graph) };
}

export function previewProjectPackageUpdate(dir: string, signed: unknown, artifact: unknown) {
  const { graph, fingerprint } = loadProject(dir);
  const preview = previewStoredPackageUpdate(dir, graph, signed, artifact);
  return {
    fingerprint,
    previewFingerprint: graphFingerprint(preview.graph),
    dependency: preview.dependency,
    changes: preview.changes,
  };
}

export function applyProjectPackageUpdate(
  dir: string,
  signed: unknown,
  artifact: unknown,
  expectedFingerprint: string,
): MutationResult & { dependency: ReturnType<typeof previewStoredPackageUpdate>["dependency"]; cacheStatus: "verified" } {
  const { graph, fingerprint } = loadProject(dir);
  if (fingerprint !== expectedFingerprint) throw new Error(`Project fingerprint conflict: expected ${expectedFingerprint}, current ${fingerprint}.`);
  const preview = previewStoredPackageUpdate(dir, graph, signed, artifact);
  writePackageArtifact(dir, preview.dependency.artifactDigest, preview.artifactCanonical);
  return {
    ...commit(
      dir,
      graph,
      preview.graph,
      `install ${preview.dependency.id}@${preview.dependency.version}`,
      fingerprint,
      { author: "agent", kind: "save", sourceId: preview.dependency.manifestDigest },
    ),
    dependency: preview.dependency,
    cacheStatus: "verified",
  };
}

export function setProjectPluginPermissions(
  dir: string,
  input: {
    pluginId: string;
    manifestDigest: string;
    permissions: PluginPermission[];
    grantedBy: string;
    expectedFingerprint: string;
  },
) {
  loadProject(dir);
  return withProjectWriteLock(dir, () => {
    const { graph, fingerprint } = loadProject(dir);
    if (fingerprint !== input.expectedFingerprint) throw new Error(`Project fingerprint conflict: expected ${input.expectedFingerprint}, current ${fingerprint}.`);
    const dependency = graph.dependencies.find((entry) => entry.id === input.pluginId && entry.kind === "plugin");
    if (!dependency) throw new Error(`Unknown installed plugin: ${input.pluginId}.`);
    if (dependency.manifestDigest !== input.manifestDigest) throw new Error("Plugin manifest changed after permission review.");
    const artifact = readPackageArtifact(dir, dependency.artifactDigest);
    if (artifact.kind !== "plugin" || artifact.plugin.id !== input.pluginId) throw new Error("Installed plugin cache failed identity validation.");
    const requested = new Set(artifact.plugin.permissions);
    for (const permission of input.permissions) {
      if (!requested.has(permission)) throw new Error(`Plugin did not request permission ${permission}.`);
    }
    const grant = pluginGrantSchema.parse({
      pluginId: input.pluginId,
      manifestDigest: input.manifestDigest,
      permissions: [...new Set(input.permissions)].sort(),
      grantedAt: new Date().toISOString(),
      grantedBy: input.grantedBy,
    });
    writePluginGrant(dir, grant);
    return { fingerprint, pluginId: input.pluginId, requestedPermissions: artifact.plugin.permissions, grantedPermissions: grant.permissions };
  });
}

function reviewKey(value: string): Buffer {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error("Review key must be canonical base64.");
  const key = Buffer.from(value, "base64");
  if (key.byteLength !== 32 || key.toString("base64") !== value) throw new Error("Review key must be canonical base64 for exactly 32 bytes.");
  return key;
}

export function exportProjectReviewBundle(
  dir: string,
  input: {
    branch: string;
    projectId: string;
    tenantId: string;
    actorId: string;
    sequence: number;
    expiresAt: string;
    keyId: string;
    keyBase64: string;
  },
) {
  const { graph, fingerprint } = loadProject(dir);
  const branch = previewHistoryBranchMerge(dir, graph, fingerprint, input.branch);
  if (branch.conflicts.length > 0) throw new HistoryConflictError(branch.conflicts);
  const createdAt = new Date().toISOString();
  const payload = {
    version: "1.0.0" as const,
    bundleId: randomUUID(),
    projectId: input.projectId,
    tenantId: input.tenantId,
    actorId: input.actorId,
    sequence: input.sequence,
    createdAt,
    expiresAt: input.expiresAt,
    baseGraphDigest: sha256(stableSerialize(graph)),
    proposedGraphDigest: sha256(stableSerialize(branch.graph)),
    baseGraph: graph,
    proposedGraph: branch.graph,
  };
  return {
    fingerprint,
    branch: input.branch,
    changes: branch.changes,
    envelope: encryptReviewBundle(payload, reviewKey(input.keyBase64), input.keyId),
  };
}

function reviewBundlePreview(
  dir: string,
  envelope: EncryptedReviewBundle,
  keyBase64: string,
  expectedFingerprint: string,
  expectedProjectId: string,
  expectedTenantId: string,
) {
  const { graph, fingerprint } = loadProject(dir);
  if (fingerprint !== expectedFingerprint) throw new Error(`Project fingerprint conflict: expected ${expectedFingerprint}, current ${fingerprint}.`);
  const payload = decryptReviewBundle(envelope, reviewKey(keyBase64));
  if (payload.projectId !== expectedProjectId) throw new Error("Review bundle belongs to another project.");
  if (payload.tenantId !== expectedTenantId) throw new Error("Review bundle belongs to another tenant.");
  assertFreshReviewSequence(payload, readReviewHighWaterMarks(dir));
  const merge = semanticThreeWayMerge(payload.baseGraph, graph, payload.proposedGraph);
  return { graph, fingerprint, payload, merge, previewFingerprint: graphFingerprint(merge.graph) };
}

export function previewProjectReviewBundle(
  dir: string,
  envelope: EncryptedReviewBundle,
  keyBase64: string,
  expectedFingerprint: string,
  expectedProjectId: string,
  expectedTenantId: string,
) {
  const preview = reviewBundlePreview(dir, envelope, keyBase64, expectedFingerprint, expectedProjectId, expectedTenantId);
  return {
    fingerprint: preview.fingerprint,
    previewFingerprint: preview.previewFingerprint,
    bundleId: preview.payload.bundleId,
    actorId: preview.payload.actorId,
    sequence: preview.payload.sequence,
    conflicts: preview.merge.conflicts,
    changes: preview.merge.changes,
  };
}

export function applyProjectReviewBundle(
  dir: string,
  envelope: EncryptedReviewBundle,
  keyBase64: string,
  expectedFingerprint: string,
  expectedProjectId: string,
  expectedTenantId: string,
): MutationResult & { bundleId: string; actorId: string; sequence: number } {
  const preview = reviewBundlePreview(dir, envelope, keyBase64, expectedFingerprint, expectedProjectId, expectedTenantId);
  if (preview.merge.conflicts.length > 0) throw new HistoryConflictError(preview.merge.conflicts);
  const result = commit(
    dir,
    preview.graph,
    preview.merge.graph,
    `apply encrypted review ${preview.payload.bundleId}`,
    preview.fingerprint,
    { author: "agent", kind: "merge", sourceId: preview.payload.bundleId },
  );
  recordReviewSequence(dir, preview.payload.actorId, preview.payload.sequence);
  return { ...result, bundleId: preview.payload.bundleId, actorId: preview.payload.actorId, sequence: preview.payload.sequence };
}

export function verifyProjectRemoteEvidence(
  dir: string,
  target: PreviewTarget,
  signed: unknown,
  expectedTenantId: string,
  profileId?: string,
) {
  const { graph, fingerprint } = loadProject(dir);
  const binding = previewBindingCache.resolve(graph, fingerprint, target, profileId);
  const statement = verifyRemoteEvidence(signed, readEcosystemTrust(dir), binding, expectedTenantId);
  return {
    accepted: true as const,
    source: "remote" as const,
    localEvidenceChanged: false as const,
    fingerprint,
    statement,
  };
}

export function applyPatch(
  dir: string,
  patchInput: unknown,
  expectedFingerprint: string,
): MutationResult {
  const patch = graphPatchSchema.parse(patchInput);
  const { graph, fingerprint } = loadProject(dir);
  if (fingerprint !== expectedFingerprint) {
    throw new Error(`Project fingerprint conflict: expected ${expectedFingerprint}, current ${fingerprint}.`);
  }
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
        overrideCount: Object.values(mode.values).reduce((count, group) => count + Object.keys(group ?? {}).length, 0),
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

export function previewPatch(dir: string, patchInput: unknown, expectedFingerprint?: string) {
  const patch = graphPatchSchema.parse(patchInput);
  const { graph, fingerprint } = loadProject(dir);
  if (expectedFingerprint !== undefined && fingerprint !== expectedFingerprint) {
    throw new Error(`Project fingerprint conflict: expected ${expectedFingerprint}, current ${fingerprint}.`);
  }
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

export function replaceGraph(
  dir: string,
  graphInput: unknown,
  reason: string,
  expectedFingerprint: string,
): MutationResult {
  const { graph, fingerprint } = loadProject(dir);
  if (fingerprint !== expectedFingerprint) {
    throw new Error(`Project fingerprint conflict: expected ${expectedFingerprint}, current ${fingerprint}.`);
  }
  const after = parseGraph(graphInput);
  return commit(dir, graph, after, reason, fingerprint);
}

export function verifyProject(dir: string, scenario: ScenarioId) {
  const { graph } = loadProject(dir);
  return verificationSummary(graph, scenario);
}

export function auditProjectAccessibility(
  dir: string,
  target: PlatformTarget = "react",
  suppressions: readonly AccessibilitySuppression[] = [],
) {
  const { graph, fingerprint } = loadProject(dir);
  return {
    fingerprint,
    ...auditAccessibility(graph, { target, profiles: ACCESSIBILITY_PROFILES, suppressions }),
  };
}

export function projectAccessibilityResource(dir: string) {
  const { graph, fingerprint } = loadProject(dir);
  const targets = (["react", "swiftui", "expo", "web"] as const)
    .filter((target) => graph.platforms.some((platform) => platform.target === target && platform.enabled));
  return {
    fingerprint,
    audits: Object.fromEntries(targets.map((target) => [target, auditAccessibility(graph, {
      target,
      profiles: ACCESSIBILITY_PROFILES,
    })])),
  };
}

export function verifyWebProject(dir: string) {
  return verifyResponsiveWeb(loadProject(dir).graph);
}

export function compileProject(dir: string, target: CompilerTarget, write: boolean) {
  const { graph } = loadProject(dir);
  const output = compileTarget(graph, target);
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
  return commit(dir, graph, restored, `revert to ${revisionId}`, fingerprint, { author: "agent", kind: "revert", sourceId: revisionId });
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

export function projectHistory(dir: string) {
  const { fingerprint } = loadProject(dir);
  return inspectOperationHistory(dir, fingerprint);
}

export function createProjectBranch(dir: string, name: string, author: HistoryAuthor = "agent") {
  loadProject(dir);
  return withProjectWriteLock(dir, () => {
    const { graph, fingerprint } = loadProject(dir);
    const operation = createHistoryBranch(dir, name, graph, fingerprint, author);
    return { branch: name, fingerprint, operation, history: inspectOperationHistory(dir, fingerprint) };
  });
}

export function applyProjectBranchPatch(
  dir: string,
  name: string,
  patchInput: unknown,
  expectedFingerprint: string,
  author: HistoryAuthor = "agent",
) {
  loadProject(dir);
  return withProjectWriteLock(dir, () => {
    const result = applyHistoryBranchPatch(dir, name, patchInput, expectedFingerprint, author);
    const { graph: _graph, ...publicResult } = result;
    return publicResult;
  });
}

export function previewProjectBranchMerge(dir: string, name: string) {
  const { graph, fingerprint } = loadProject(dir);
  const preview = previewHistoryBranchMerge(dir, graph, fingerprint, name);
  const { graph: _graph, ...publicPreview } = preview;
  return publicPreview;
}

export function mergeProjectBranch(
  dir: string,
  name: string,
  expectedFingerprint: string,
  author: HistoryAuthor = "agent",
): MutationResult & { branch: string } {
  const { graph, fingerprint } = loadProject(dir);
  if (fingerprint !== expectedFingerprint) {
    throw new Error(`Project fingerprint conflict: expected ${expectedFingerprint}, current ${fingerprint}.`);
  }
  const preview = previewHistoryBranchMerge(dir, graph, fingerprint, name);
  if (preview.conflicts.length > 0) throw new HistoryConflictError(preview.conflicts);
  return {
    ...commit(
      dir,
      graph,
      preview.graph,
      `merge branch ${name}`,
      fingerprint,
      { author, kind: "merge", sourceId: name },
    ),
    branch: name,
  };
}

export function deleteProjectBranch(dir: string, name: string) {
  loadProject(dir);
  return withProjectWriteLock(dir, () => {
    const manifest = deleteHistoryBranch(dir, name);
    return { deleted: name, branches: Object.values(manifest.branches).map((branch) => branch.name).sort() };
  });
}

export function previewProjectHistoryOperation(
  dir: string,
  operationId: string,
  direction: "cherry-pick" | "revert",
) {
  const { graph, fingerprint } = loadProject(dir);
  const preview = previewHistoryOperationTransform(dir, graph, fingerprint, operationId, direction);
  const { graph: _graph, ...publicPreview } = preview;
  return publicPreview;
}

export function applyProjectHistoryOperation(
  dir: string,
  operationId: string,
  direction: "cherry-pick" | "revert",
  expectedFingerprint: string,
  author: HistoryAuthor = "agent",
): MutationResult & { sourceOperationId: string; direction: "cherry-pick" | "revert" } {
  const { graph, fingerprint } = loadProject(dir);
  if (fingerprint !== expectedFingerprint) {
    throw new Error(`Project fingerprint conflict: expected ${expectedFingerprint}, current ${fingerprint}.`);
  }
  const preview = previewHistoryOperationTransform(dir, graph, fingerprint, operationId, direction);
  if (preview.conflicts.length > 0) throw new HistoryConflictError(preview.conflicts);
  return {
    ...commit(
      dir,
      graph,
      preview.graph,
      `${direction} operation ${operationId}`,
      fingerprint,
      { author, kind: direction, sourceId: operationId },
    ),
    sourceOperationId: operationId,
    direction,
  };
}

export function recoverProjectHistory(dir: string) {
  loadProject(dir);
  return withProjectWriteLock(dir, () => {
    const { graph, fingerprint } = loadProject(dir);
    return recoverOperationHistory(dir, graph, fingerprint);
  });
}

export { graphFingerprint };
