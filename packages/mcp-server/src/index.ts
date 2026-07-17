import { pathToFileURL } from "node:url";
import { parseGraph } from "@intentform/semantic-schema";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { InMemoryTaskStore } from "@modelcontextprotocol/sdk/experimental/tasks/stores/in-memory.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  LATEST_PROTOCOL_VERSION,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import {
  applyMigration,
  applyPatch,
  applyProjectPackageUpdate,
  applyProjectReviewBundle,
  auditProjectAccessibility,
  applyProjectBranchPatch,
  applyProjectHistoryOperation,
  collectProjectAssets,
  cancelProjectPreview,
  compileProject,
  componentSchema,
  createProjectBranch,
  describeProject,
  deviceProfileResource,
  deviceBezelResource,
  deleteProjectBranch,
  diffAgainstRevision,
  exportProjectTokens,
  exportProjectReviewBundle,
  getGraph,
  importProjectAssetFromInbox,
  importProjectTokens,
  instantiateProjectComponent,
  listTokenModes,
  mergeProjectBranch,
  previewProjectBranchMerge,
  previewProjectHistoryOperation,
  previewProjectPackageUpdate,
  previewProjectReviewBundle,
  projectHistory,
  projectAccessibilityResource,
  projectRevisions,
  projectPreviewStatus,
  projectEcosystemResource,
  previewMigration,
  previewPatch,
  replaceGraph,
  recoverProjectHistory,
  runProjectPreview,
  revertProject,
  searchComponents,
  searchProjectAssets,
  setProjectPluginPermissions,
  verifyProject,
  verifyWebProject,
  verifyProjectRemoteEvidence,
  type ScenarioId,
} from "./tools.ts";
import { resolveProjectDir } from "./store.ts";
import type { PreviewTarget } from "@intentform/preview-daemon";
import type { AccessibilitySuppression } from "@intentform/verifier";
import type { EncryptedReviewBundle, PluginPermission } from "@intentform/ecosystem";
import { SemanticTransactionService } from "./transactions.ts";
import { agentAccessForTool, readAgentActivity, recordAgentActivity, type AgentActivityOutcome } from "./activity.ts";

/* The MCP 2025-11-25 server exposes the same validated project operations as
   Studio over frame-clean stdio or authenticated loopback Streamable HTTP. */

export const PROTOCOL_VERSION = LATEST_PROTOCOL_VERSION;
const projectDir = resolveProjectDir();
const semanticTransactions = new SemanticTransactionService();
const readCanonicalGraph = () => parseGraph(JSON.parse(getGraph(projectDir)));

export interface ToolContext {
  ownerId: string;
  signal: AbortSignal;
  transport: "stdio" | "http";
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run(args: Record<string, unknown>, context: ToolContext): unknown | Promise<unknown>;
}

const DEVICE_PROFILES_URI = "intentform://device-profiles";

export const resourceDefinitions = [{
  uri: "intentform://project/summary",
  name: "IntentForm project summary",
  description: "Current product, targets, screens, components, token modes, verification and compiler status without the full graph payload.",
  mimeType: "application/json",
  read: () => describeProject(projectDir),
}, {
  uri: "intentform://project/graph",
  name: "IntentForm canonical graph",
  description: "The complete validated Semantic Interface Graph as canonical deterministic JSON.",
  mimeType: "application/json",
  read: () => getGraph(projectDir),
}, {
  uri: "intentform://project/scope",
  name: "IntentForm explicit editing scope",
  description: "Unambiguous project, file, page, device, visual-state and selection scope. Null selection means no implicit active-layer mutation is permitted.",
  mimeType: "application/json",
  read: () => {
    const graph = readCanonicalGraph();
    return { project: graph.product.name, file: "project.intentform", tab: "design", page: graph.screens[0]?.id ?? null, device: graph.devices.defaultProfile, visualState: "idle", selection: null };
  },
}, {
  uri: "intentform://project/tokens",
  name: "IntentForm token modes",
  description: "Canonical token modes, aliases and active mode without generated output.",
  mimeType: "application/json",
  read: () => readCanonicalGraph().tokens,
}, {
  uri: "intentform://project/components",
  name: "IntentForm component definitions",
  description: "Local component definitions, typed properties, slots, variants and states.",
  mimeType: "application/json",
  read: () => readCanonicalGraph().components,
}, {
  uri: "intentform://project/screens",
  name: "IntentForm screens and flows",
  description: "Screen outline and semantic navigation flows without authored fixture values.",
  mimeType: "application/json",
  read: () => {
    const graph = readCanonicalGraph();
    return { screens: graph.screens.map(({ id, title, purpose, route, nodes }) => ({ id, title, purpose, route, rootNodeIds: nodes.map((node) => node.id) })), flows: graph.flows, prototype: graph.prototype, reviewThreads: graph.reviewThreads };
  },
}, {
  uri: "intentform://project/diagnostics",
  name: "IntentForm verification diagnostics",
  description: "Current compact verification diagnostics bound to the canonical graph fingerprint.",
  mimeType: "application/json",
  read: () => verifyProject(projectDir, "compact"),
}, {
  uri: "intentform://project/capabilities",
  name: "IntentForm agent capabilities",
  description: "Versioned semantic tool categories and explicit permission model for connected clients.",
  mimeType: "application/json",
  read: () => ({ version: "1.0.0", defaultPermission: "read-only", permissions: ["read-only", "write"], scopes: ["project", "file", "tab", "page", "device", "visual-state", "selection"], mutationPath: ["begin", "preview", "commit", "rollback", "verify", "revert"] }),
}, {
  uri: "intentform://project/revisions",
  name: "IntentForm project revisions",
  description: "Newest-first local revision checkpoints with reasons and fingerprints.",
  mimeType: "application/json",
  read: () => projectRevisions(projectDir),
}, {
  uri: "intentform://project/history",
  name: "IntentForm operation history and branches",
  description: "Integrity-checked named operations, branch heads, compaction boundary and current semantic history state without checkpoint graph payloads.",
  mimeType: "application/json",
  read: () => projectHistory(projectDir),
}, {
  uri: "intentform://project/accessibility",
  name: "IntentForm accessibility audit",
  description: "Versioned WCAG 2.2 AA audits for enabled output targets across baseline, long-text, RTL and increased-contrast profiles. Authored copy is excluded from evidence.",
  mimeType: "application/json",
  read: () => projectAccessibilityResource(projectDir),
}, {
  uri: "intentform://project/previews",
  name: "IntentForm local preview evidence",
  description: "Freshness-bound browser, Expo iOS, Expo Android and SwiftUI local build evidence.",
  mimeType: "application/json",
  read: () => projectPreviewStatus(projectDir),
}, {
  uri: "intentform://project/ecosystem",
  name: "IntentForm local ecosystem and collaboration policy",
  description: "Locked signed packages, declarative plugin grants, local cache integrity, and optional encrypted sync configuration without secret material.",
  mimeType: "application/json",
  read: () => projectEcosystemResource(projectDir),
}, {
  uri: "intentform://agent/activity",
  name: "IntentForm agent access and activity",
  description: "Metadata-only local MCP access policy and recent tool outcomes. Arguments, tokens, paths, content and outputs are excluded.",
  mimeType: "application/json",
  read: () => readAgentActivity(projectDir),
}, {
  uri: DEVICE_PROFILES_URI,
  name: "IntentForm device profiles",
  description: "Resolved, checksummed logical device geometry, safe areas, inputs and capabilities for the active project.",
  mimeType: "application/json",
  read: () => deviceProfileResource(projectDir),
}, {
  uri: "intentform://device-bezel-packs",
  name: "IntentForm local device bezel packs",
  description: "Read-only capability and metadata for explicitly enabled, locally supplied, checksum-verified bezel packs; never includes asset bytes or source paths.",
  mimeType: "application/json",
  read: () => deviceBezelResource(projectDir),
}] as const;

const PATCH_CONTRACT = `A GraphPatch is {"id": string, "rationale": string, "operations": Operation[]} where Operation is one of:
{"op":"set-label","target":nodeId,"label":string} · {"op":"set-placement","target":nodeId,"compact":"inline"|"persistent-bottom","regular":"inline"|"persistent-bottom"} · {"op":"set-purpose","target":nodeId,"purpose":string} · {"op":"set-emphasis","target":nodeId,"emphasis":"quiet"|"normal"|"strong"} · {"op":"set-gap-token","target":nodeId,"token":string} · {"op":"set-padding-token","target":nodeId,"token":string} · {"op":"set-layout","target":nodeId, ...layoutFields} · {"op":"set-web-layout","target":nodeId,"layout":typedWebLayout|null} · {"op":"move-node","target":nodeId,"screenId":screenId,"parent":nodeId|null,"index"?:number} · {"op":"set-color-token","token":colorTokenName,"value":"#rrggbb"} · {"op":"set-token-mode","mode":modeId} · {"op":"bind-asset","target":nodeId,"assetId":assetId,"variantId"?:variantId,"fit":"contain"|"cover"|"fill"|"none","focalPoint":{"x":0..1,"y":0..1},"decorative":boolean} · {"op":"clear-asset","target":nodeId} · {"op":"set-fixture-value","screenId":screenId,"state":"idle"|"loading"|"empty"|"failed"|"completed","field":contractField,"value":string|number|boolean} · {"op":"set-prototype-action","target":nodeId,"action":prototypeAction|null} · {"op":"add-review-thread","thread":reviewThread} · {"op":"reply-review-thread","threadId":threadId,"message":reviewMessage} · {"op":"resolve-review-thread","threadId":threadId,"resolvedAt":datetime|null,"resolvedBy":reviewAuthor|null}.
Node IDs are stable; discover them with intentform_describe_project. The patch is schema-validated and rejected atomically if any operation is invalid.`;

const PATCH_INPUT_SCHEMA = {
  type: "object",
  properties: {
    patch: {
      type: "object",
      description: "GraphPatch object: {id, rationale, operations[]}",
      properties: {
        id: { type: "string" },
        rationale: { type: "string" },
        operations: { type: "array", items: { type: "object" } },
      },
      required: ["id", "rationale", "operations"],
    },
  },
  required: ["patch"],
} satisfies Record<string, unknown>;

export const toolDefinitions: ToolDefinition[] = [
  {
    name: "intentform_preview_migration",
    description: "Inspect the local graph schema without modifying files. Returns whether migration is required, the exact source fingerprint to use for conflict-safe application, and deterministic diagnostics. Call this before intentform_apply_migration.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: () => previewMigration(projectDir),
  },
  {
    name: "intentform_apply_migration",
    description: "Explicitly migrate a previously previewed local graph. Requires the preview's source fingerprint, checkpoints the exact original bytes, and atomically writes canonical current-schema JSON. Fails if the file changed after preview.",
    inputSchema: {
      type: "object",
      properties: {
        expectedSourceFingerprint: {
          type: "string",
          pattern: "^[a-f0-9]{64}$",
          description: "Source fingerprint returned by intentform_preview_migration",
        },
      },
      required: ["expectedSourceFingerprint"],
      additionalProperties: false,
    },
    run: (args) => applyMigration(projectDir, String(args.expectedSourceFingerprint ?? "")),
  },
  {
    name: "intentform_describe_project",
    description: "Inspect the IntentForm project: product, screens with stable node IDs, token modes, licensed assets, flows, contracts, current verification status, and each compiler target's generation status and fingerprint when available. Call this first to discover node IDs before editing.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: () => describeProject(projectDir),
  },
  {
    name: "intentform_list_token_modes",
    description: "List every token mode with its sparse override count and fully resolved values, plus aliases and deprecation metadata. This is read-only and returns the current graph fingerprint.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: () => listTokenModes(projectDir),
  },
  {
    name: "intentform_import_dtcg",
    description: "Import a bounded W3C Design Tokens Community Group 2025.10 JSON document. Values, aliases, modes, deprecation, and vendor extensions are validated; invalid references and cycles fail atomically. Creates exactly one project revision.",
    inputSchema: {
      type: "object",
      properties: { document: { type: "object", description: "Parsed DTCG 2025.10 JSON document" } },
      required: ["document"],
      additionalProperties: false,
    },
    run: (args) => importProjectTokens(projectDir, args.document),
  },
  {
    name: "intentform_export_dtcg",
    description: "Export the current project tokens as deterministic DTCG 2025.10 JSON, including aliases, modes, deprecation, and preserved vendor metadata. This is read-only.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: () => exportProjectTokens(projectDir),
  },
  {
    name: "intentform_search_assets",
    description: "Search the local content-addressed asset manifest by id, name, kind, media type, or license. Returns license/export policy and integrity diagnostics without exposing source filesystem paths.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", maxLength: 120, description: "Empty returns the complete asset manifest" } },
      additionalProperties: false,
    },
    run: (args) => searchProjectAssets(projectDir, typeof args.query === "string" ? args.query : ""),
  },
  {
    name: "intentform_import_asset",
    description: "Import one licensed file already placed directly in .intentform/imports. The file is type-checked, SVG-sanitized, content-addressed, stripped of its source path, added to the graph, and committed as one revision.",
    inputSchema: {
      type: "object",
      properties: {
        importName: { type: "string", minLength: 1, maxLength: 180, description: "Basename of a file directly inside .intentform/imports" },
        id: { type: "string", pattern: "^[a-z][a-z0-9-]*$" },
        name: { type: "string", minLength: 1, maxLength: 120 },
        kind: { type: "string", enum: ["raster", "svg", "icon", "video", "audio", "font"] },
        license: {
          type: "object",
          properties: {
            name: { type: "string", minLength: 1, maxLength: 160 },
            spdx: { type: "string", minLength: 1, maxLength: 80 },
            sourceUrl: { type: "string", format: "uri", maxLength: 500 },
            attribution: { type: "string", minLength: 1, maxLength: 500 },
            redistribution: { type: "string", enum: ["allowed", "restricted", "unknown"] },
          },
          required: ["name", "redistribution"],
          additionalProperties: false,
        },
        exportPolicy: { type: "string", enum: ["copy", "reference", "blocked"] },
        metadata: { type: "object", additionalProperties: true },
      },
      required: ["importName", "id", "name", "license", "exportPolicy"],
      additionalProperties: false,
    },
    run: (args) => importProjectAssetFromInbox(projectDir, {
      importName: String(args.importName ?? ""),
      id: String(args.id ?? ""),
      name: String(args.name ?? ""),
      ...(typeof args.kind === "string" ? { kind: args.kind as "raster" | "svg" | "icon" | "video" | "audio" | "font" } : {}),
      license: (args.license ?? {}) as { name: string; spdx?: string; sourceUrl?: string; attribution?: string; redistribution: "allowed" | "restricted" | "unknown" },
      exportPolicy: args.exportPolicy as "copy" | "reference" | "blocked",
      ...(args.metadata && typeof args.metadata === "object" ? { metadata: args.metadata as Record<string, unknown> } : {}),
    }),
  },
  {
    name: "intentform_asset_gc",
    description: "Preview unreferenced files in the content-addressed asset store. Set apply=true to delete only verified unused regular files; referenced files and symlinks are never removed.",
    inputSchema: {
      type: "object",
      properties: { apply: { type: "boolean", description: "Defaults to false for a read-only preview" } },
      additionalProperties: false,
    },
    run: (args) => collectProjectAssets(projectDir, args.apply === true),
  },
  {
    name: "intentform_get_graph",
    description: "Return the full Semantic Interface Graph as canonical, deterministic JSON. Use for detailed inspection or as the basis for intentform_replace_graph.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: () => getGraph(projectDir),
  },
  {
    name: "intentform_search_components",
    description: "Search the versioned local component library by id, name, or description. Returns typed props, slots, variants, states, deprecation, and the graph fingerprint without modifying the project.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", maxLength: 120, description: "Empty returns the complete local library" } },
      additionalProperties: false,
    },
    run: (args) => searchComponents(projectDir, typeof args.query === "string" ? args.query : ""),
  },
  {
    name: "intentform_component_schema",
    description: "Return the executable schema for one local component definition, or every definition when id is omitted. Includes the stable local-library ABI and full template/prop/slot/variant/state contracts.",
    inputSchema: {
      type: "object",
      properties: { definitionId: { type: "string" } },
      additionalProperties: false,
    },
    run: (args) => componentSchema(projectDir, typeof args.definitionId === "string" ? args.definitionId : undefined),
  },
  {
    name: "intentform_instantiate_component",
    description: "Instantiate a typed local component on a screen or inside a container. The operation expands deterministically, validates the whole graph, creates one revision, and returns the exact semantic diff and fingerprint.",
    inputSchema: {
      type: "object",
      properties: {
        definitionId: { type: "string" },
        instanceId: { type: "string", description: "New globally unique semantic node id" },
        screenId: { type: "string" },
        parentId: { type: ["string", "null"] },
        index: { type: "integer", minimum: 0, maximum: 64 },
        variant: { type: "string" },
        state: { type: "string" },
        props: { type: "object", additionalProperties: { type: ["string", "number", "boolean"] } },
      },
      required: ["definitionId", "instanceId", "screenId"],
      additionalProperties: false,
    },
    run: (args) => instantiateProjectComponent(projectDir, {
      definitionId: String(args.definitionId ?? ""),
      instanceId: String(args.instanceId ?? ""),
      screenId: String(args.screenId ?? ""),
      ...(typeof args.parentId === "string" || args.parentId === null ? { parentId: args.parentId } : {}),
      ...(typeof args.index === "number" ? { index: args.index } : {}),
      ...(typeof args.variant === "string" ? { variant: args.variant } : {}),
      ...(typeof args.state === "string" ? { state: args.state } : {}),
      ...(args.props && typeof args.props === "object" ? { props: args.props as Record<string, string | number | boolean> } : {}),
    }),
  },
  {
    name: "intentform_preview_patch",
    description: `Preview a typed semantic transaction without writing the project. Returns the exact semantic diff, candidate graph fingerprint, and fresh compact verification that intentform_apply_patch would commit. ${PATCH_CONTRACT}`,
    inputSchema: PATCH_INPUT_SCHEMA,
    run: (args) => previewPatch(projectDir, args.patch),
  },
  {
    name: "intentform_apply_patch",
    description: `Apply a typed semantic patch to the project graph. Preferred way to edit: smallest change, schema-validated, revisioned, and re-verified. ${PATCH_CONTRACT} Returns the semantic diff, the new fingerprint and the compact-scenario verification findings.`,
    inputSchema: PATCH_INPUT_SCHEMA,
    run: (args) => applyPatch(projectDir, args.patch),
  },
  {
    name: "intentform_replace_graph",
    description: "Replace the entire Semantic Interface Graph (current schemaVersion 0.11.0). Use for structural edits a typed operation cannot express. Recursive hierarchy, components, token modes, licensed assets, locked ecosystem dependencies, prototype actions, anchored review threads, logical device profiles, responsive-web and Expo profiles, node-count and layout constraints are fully validated; invalid graphs are rejected without side effects. Returns the semantic diff and fresh verification findings.",
    inputSchema: {
      type: "object",
      properties: {
        graph: { type: "object", description: "Complete SemanticInterfaceGraph JSON" },
        reason: { type: "string", description: "Why the graph changed (stored in the revision log)" },
      },
      required: ["graph", "reason"],
    },
    run: (args) => replaceGraph(projectDir, args.graph, String(args.reason ?? "agent edit")),
  },
  {
    name: "intentform_verify",
    description: "Run the deterministic verification rules against the current graph for a device scenario ('compact' 375×667 or 'regular' 402×874). Returns findings with violated intent, evidence and the responsible layer (graph, tokens or compiler).",
    inputSchema: {
      type: "object",
      properties: { scenario: { type: "string", enum: ["compact", "regular"], description: "Defaults to compact" } },
    },
    run: (args) => verifyProject(projectDir, (args.scenario === "regular" ? "regular" : "compact") as ScenarioId),
  },
  {
    name: "intentform_audit_accessibility",
    description: "Run the versioned WCAG 2.2 AA audit matrix for one generated target. Findings include deterministic evidence, a repair direction, long-text/RTL/text-scale profiles, and any explicit reasoned suppressions. Audit evidence never includes authored labels or fixture values.",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", enum: ["react", "swiftui", "expo", "compose", "web"], description: "Defaults to react" },
        suppressions: {
          type: "array",
          maxItems: 100,
          items: {
            type: "object",
            properties: {
              ruleId: { type: "string", enum: ["accessible-name", "label-in-name", "live-region-role", "assertive-live-region", "target-size", "text-resize", "rtl-logical-order", "drag-alternative"] },
              reason: { type: "string", minLength: 8, maxLength: 500 },
              screenId: { type: "string", pattern: "^[a-z][a-z0-9.-]*$" },
              nodeId: { type: "string", pattern: "^[a-z][a-z0-9.-]*$" },
              profileId: { type: "string", enum: ["baseline", "long-text", "rtl", "high-contrast"] },
            },
            required: ["ruleId", "reason"],
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
    run: (args) => auditProjectAccessibility(
      projectDir,
      (["react", "swiftui", "expo", "compose", "web"].includes(String(args.target)) ? args.target : "react") as "react" | "swiftui" | "expo" | "compose" | "web",
      Array.isArray(args.suppressions) ? args.suppressions as AccessibilitySuppression[] : [],
    ),
  },
  {
    name: "intentform_verify_web",
    description: "Verify the responsive-web profile, frame-to-breakpoint coverage, fixed/live-region risks, compiler diagnostics, semantic landmarks, and intrinsic CSS output. Returns the generated web fingerprint when compilation succeeds.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: () => verifyWebProject(projectDir),
  },
  {
    name: "intentform_preview_status",
    description: "Read local browser, Expo iOS, Expo Android and SwiftUI build evidence for the exact current graph/compiler/device binding. Stale evidence is always returned as not-run and cannot satisfy verification.",
    inputSchema: {
      type: "object",
      properties: { profileId: { type: "string", pattern: "^(device|web):[a-z][a-z0-9.-]*$" } },
      additionalProperties: false,
    },
    run: (args) => projectPreviewStatus(projectDir, typeof args.profileId === "string" ? args.profileId : undefined),
  },
  {
    name: "intentform_run_preview",
    description: "Start or restart one bounded local preview build using fixed argument arrays and the current graph. Requires the current project fingerprint and returns immediately; poll intentform_preview_status for evidence.",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", enum: ["browser", "expo-ios", "expo-android", "swiftui"] },
        expectedFingerprint: { type: "string", pattern: "^[a-f0-9]{8}$" },
        restart: { type: "boolean", description: "Cancel an active run for this target before starting the current binding" },
        profileId: { type: "string", pattern: "^(device|web):[a-z][a-z0-9.-]*$" },
      },
      required: ["target", "expectedFingerprint"],
      additionalProperties: false,
    },
    run: (args) => runProjectPreview(
      projectDir,
      (["browser", "expo-ios", "expo-android", "swiftui"].includes(String(args.target)) ? args.target : "browser") as PreviewTarget,
      String(args.expectedFingerprint ?? ""),
      args.restart === true,
      typeof args.profileId === "string" ? args.profileId : undefined,
    ),
  },
  {
    name: "intentform_cancel_preview",
    description: "Cancel one queued or running local preview process without mutating the graph. Requires the current graph fingerprint and records a terminal cancelled state.",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", enum: ["browser", "expo-ios", "expo-android", "swiftui"] },
        expectedFingerprint: { type: "string", pattern: "^[a-f0-9]{8}$" },
        profileId: { type: "string", pattern: "^(device|web):[a-z][a-z0-9.-]*$" },
      },
      required: ["target", "expectedFingerprint"],
      additionalProperties: false,
    },
    run: (args) => cancelProjectPreview(
      projectDir,
      (["browser", "expo-ios", "expo-android", "swiftui"].includes(String(args.target)) ? args.target : "browser") as PreviewTarget,
      String(args.expectedFingerprint ?? ""),
      typeof args.profileId === "string" ? args.profileId : undefined,
    ),
  },
  {
    name: "intentform_compile",
    description: "Compile the current graph with a deterministic backend ('react', 'swiftui', 'expo', or 'web'). With write=true generated files and license-permitted copy-policy assets are emitted under .intentform/output/<target>/. Expo emits an owned Expo Router TypeScript project with explicit adapter boundaries. Same graph + same compiler always yields byte-identical source output.",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", enum: ["react", "swiftui", "expo", "web"] },
        write: { type: "boolean", description: "Write generated files to .intentform/output/<target>/ (default true)" },
      },
      required: ["target"],
    },
    run: (args) => compileProject(projectDir, args.target === "swiftui" ? "swiftui" : args.target === "expo" ? "expo" : args.target === "web" ? "web" : "react", args.write !== false),
  },
  {
    name: "intentform_list_revisions",
    description: "List the project's revision history (newest first) with timestamps, reasons and graph fingerprints.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: () => projectRevisions(projectDir),
  },
  {
    name: "intentform_diff",
    description: "Semantic diff of the current graph against a revision (defaults to the most recent one). Reports token, intent, placement, state and interaction changes by stable node ID.",
    inputSchema: {
      type: "object",
      properties: { revision: { type: "string", description: "Revision id from intentform_list_revisions" } },
    },
    run: (args) => diffAgainstRevision(projectDir, typeof args.revision === "string" ? args.revision : undefined),
  },
  {
    name: "intentform_revert",
    description: "Restore the graph stored in a previous revision. The current graph is snapshotted first, so a revert is itself reversible.",
    inputSchema: {
      type: "object",
      properties: { revision: { type: "string" } },
      required: ["revision"],
    },
    run: (args) => revertProject(projectDir, String(args.revision)),
  },
  {
    name: "intentform_list_history",
    description: "List integrity-checked named operations and branch heads. Checkpoint graph payloads and filesystem paths are not returned.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: () => projectHistory(projectDir),
  },
  {
    name: "intentform_create_branch",
    description: "Create an isolated semantic branch from the exact current main graph. The branch stores an immutable checkpoint and does not change graph.json.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", pattern: "^[a-z][a-z0-9-]{0,62}$" } },
      required: ["name"],
      additionalProperties: false,
    },
    run: (args) => createProjectBranch(projectDir, String(args.name ?? "")),
  },
  {
    name: "intentform_apply_branch_patch",
    description: `Apply a typed GraphPatch to an isolated branch head. Main remains unchanged. Requires the branch head fingerprint for conflict safety. ${PATCH_CONTRACT}`,
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", pattern: "^[a-z][a-z0-9-]{0,62}$" },
        expectedFingerprint: { type: "string", pattern: "^[a-f0-9]{8}$" },
        patch: PATCH_INPUT_SCHEMA.properties.patch,
      },
      required: ["name", "expectedFingerprint", "patch"],
      additionalProperties: false,
    },
    run: (args) => applyProjectBranchPatch(
      projectDir,
      String(args.name ?? ""),
      args.patch,
      String(args.expectedFingerprint ?? ""),
    ),
  },
  {
    name: "intentform_preview_branch_merge",
    description: "Preview a three-way semantic merge from a branch into main without writing. Independent stable properties auto-merge; same-property and competing reorder changes return explicit conflicts.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", pattern: "^[a-z][a-z0-9-]{0,62}$" } },
      required: ["name"],
      additionalProperties: false,
    },
    run: (args) => previewProjectBranchMerge(projectDir, String(args.name ?? "")),
  },
  {
    name: "intentform_merge_branch",
    description: "Commit a previously reviewable clean branch merge as one named main operation. Requires the exact main fingerprint and refuses every unresolved semantic conflict.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", pattern: "^[a-z][a-z0-9-]{0,62}$" },
        expectedFingerprint: { type: "string", pattern: "^[a-f0-9]{8}$" },
      },
      required: ["name", "expectedFingerprint"],
      additionalProperties: false,
    },
    run: (args) => mergeProjectBranch(projectDir, String(args.name ?? ""), String(args.expectedFingerprint ?? "")),
  },
  {
    name: "intentform_delete_branch",
    description: "Delete one isolated non-main branch pointer. Main and immutable operations remain unchanged; unreachable checkpoints are reclaimed by bounded compaction.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", pattern: "^[a-z][a-z0-9-]{0,62}$" } },
      required: ["name"],
      additionalProperties: false,
    },
    run: (args) => deleteProjectBranch(projectDir, String(args.name ?? "")),
  },
  {
    name: "intentform_preview_history_operation",
    description: "Preview cherry-picking or reverting one immutable operation against current main using the same semantic three-way merge and conflict rules. Does not write.",
    inputSchema: {
      type: "object",
      properties: {
        operationId: { type: "string", format: "uuid" },
        direction: { type: "string", enum: ["cherry-pick", "revert"] },
      },
      required: ["operationId", "direction"],
      additionalProperties: false,
    },
    run: (args) => previewProjectHistoryOperation(
      projectDir,
      String(args.operationId ?? ""),
      args.direction === "revert" ? "revert" : "cherry-pick",
    ),
  },
  {
    name: "intentform_apply_history_operation",
    description: "Commit a clean cherry-pick or inverse revert as one new named operation. Requires the exact current main fingerprint and refuses unresolved conflicts.",
    inputSchema: {
      type: "object",
      properties: {
        operationId: { type: "string", format: "uuid" },
        direction: { type: "string", enum: ["cherry-pick", "revert"] },
        expectedFingerprint: { type: "string", pattern: "^[a-f0-9]{8}$" },
      },
      required: ["operationId", "direction", "expectedFingerprint"],
      additionalProperties: false,
    },
    run: (args) => applyProjectHistoryOperation(
      projectDir,
      String(args.operationId ?? ""),
      args.direction === "revert" ? "revert" : "cherry-pick",
      String(args.expectedFingerprint ?? ""),
    ),
  },
  {
    name: "intentform_recover_history",
    description: "Explicitly rebuild a damaged history manifest from valid immutable operation/checkpoint evidence and the current graph. The old manifest is preserved under history/recovery.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: () => recoverProjectHistory(projectDir),
  },
  {
    name: "intentform_preview_package_update",
    description: "Verify a typed data-only package against the project's explicit Ed25519 trust roots, exact dependency locks, artifact digest and declared exports. Returns the graph diff without writing package bytes or changing the graph.",
    inputSchema: {
      type: "object",
      properties: {
        signedManifest: { type: "object", description: "Signed IntentForm package manifest" },
        artifact: { type: "object", description: "Typed component, token, or declarative plugin package artifact" },
      },
      required: ["signedManifest", "artifact"],
      additionalProperties: false,
    },
    run: (args) => previewProjectPackageUpdate(projectDir, args.signedManifest, args.artifact),
  },
  {
    name: "intentform_apply_package_update",
    description: "Apply an already-reviewable signed package candidate. Re-verifies trust and integrity, writes canonical bytes to the content-addressed local cache, embeds exact provenance in the graph and creates one fingerprint-checked revision.",
    inputSchema: {
      type: "object",
      properties: {
        signedManifest: { type: "object" },
        artifact: { type: "object" },
        expectedFingerprint: { type: "string", pattern: "^[a-f0-9]{8}$" },
      },
      required: ["signedManifest", "artifact", "expectedFingerprint"],
      additionalProperties: false,
    },
    run: (args) => applyProjectPackageUpdate(
      projectDir,
      args.signedManifest,
      args.artifact,
      String(args.expectedFingerprint ?? ""),
    ),
  },
  {
    name: "intentform_set_plugin_permissions",
    description: "Replace the local permission grant for one installed declarative plugin. The grant is bound to the exact signed manifest digest; undeclared permissions and stale plugin versions fail closed. No plugin code is executed.",
    inputSchema: {
      type: "object",
      properties: {
        pluginId: { type: "string", pattern: "^@[a-z0-9][a-z0-9.-]*/[a-z0-9][a-z0-9.-]*$" },
        manifestDigest: { type: "string", pattern: "^[a-f0-9]{64}$" },
        permissions: {
          type: "array",
          maxItems: 16,
          uniqueItems: true,
          items: { enum: ["project.read", "project.write", "history.read", "compile.run", "preview.run", "review.export"] },
        },
        grantedBy: { type: "string", minLength: 1, maxLength: 160 },
        expectedFingerprint: { type: "string", pattern: "^[a-f0-9]{8}$" },
      },
      required: ["pluginId", "manifestDigest", "permissions", "grantedBy", "expectedFingerprint"],
      additionalProperties: false,
    },
    run: (args) => setProjectPluginPermissions(projectDir, {
      pluginId: String(args.pluginId ?? ""),
      manifestDigest: String(args.manifestDigest ?? ""),
      permissions: args.permissions as PluginPermission[],
      grantedBy: String(args.grantedBy ?? ""),
      expectedFingerprint: String(args.expectedFingerprint ?? ""),
    }),
  },
  {
    name: "intentform_export_review_bundle",
    description: "Export one conflict-free local branch as an AES-256-GCM encrypted review bundle. The 32-byte key is used in memory only and is never persisted, returned, or included in agent activity records.",
    inputSchema: {
      type: "object",
      properties: {
        branch: { type: "string", minLength: 1, maxLength: 64 },
        projectId: { type: "string", pattern: "^[a-z][a-z0-9.-]*$" },
        tenantId: { type: "string", minLength: 1, maxLength: 160 },
        actorId: { type: "string", minLength: 1, maxLength: 160 },
        sequence: { type: "integer", minimum: 1 },
        expiresAt: { type: "string", format: "date-time" },
        keyId: { type: "string", minLength: 1, maxLength: 160 },
        keyBase64: { type: "string", minLength: 44, maxLength: 44, description: "Out-of-band 32-byte review key encoded as canonical base64" },
      },
      required: ["branch", "projectId", "tenantId", "actorId", "sequence", "expiresAt", "keyId", "keyBase64"],
      additionalProperties: false,
    },
    run: (args) => exportProjectReviewBundle(projectDir, {
      branch: String(args.branch ?? ""),
      projectId: String(args.projectId ?? ""),
      tenantId: String(args.tenantId ?? ""),
      actorId: String(args.actorId ?? ""),
      sequence: Number(args.sequence),
      expiresAt: String(args.expiresAt ?? ""),
      keyId: String(args.keyId ?? ""),
      keyBase64: String(args.keyBase64 ?? ""),
    }),
  },
  {
    name: "intentform_preview_review_bundle",
    description: "Decrypt and preview a review bundle using semantic three-way merge. Exact project, tenant, current fingerprint, expiry and actor sequence are checked; no graph or replay state is written.",
    inputSchema: {
      type: "object",
      properties: {
        envelope: { type: "object" },
        keyBase64: { type: "string", minLength: 44, maxLength: 44 },
        expectedFingerprint: { type: "string", pattern: "^[a-f0-9]{8}$" },
        expectedProjectId: { type: "string", pattern: "^[a-z][a-z0-9.-]*$" },
        expectedTenantId: { type: "string", minLength: 1, maxLength: 160 },
      },
      required: ["envelope", "keyBase64", "expectedFingerprint", "expectedProjectId", "expectedTenantId"],
      additionalProperties: false,
    },
    run: (args) => previewProjectReviewBundle(
      projectDir,
      args.envelope as EncryptedReviewBundle,
      String(args.keyBase64 ?? ""),
      String(args.expectedFingerprint ?? ""),
      String(args.expectedProjectId ?? ""),
      String(args.expectedTenantId ?? ""),
    ),
  },
  {
    name: "intentform_apply_review_bundle",
    description: "Apply a previously reviewable encrypted bundle as one local merge revision. Every conflict is refused; the actor sequence is recorded only after a fingerprint-checked commit so replayed bundles fail closed.",
    inputSchema: {
      type: "object",
      properties: {
        envelope: { type: "object" },
        keyBase64: { type: "string", minLength: 44, maxLength: 44 },
        expectedFingerprint: { type: "string", pattern: "^[a-f0-9]{8}$" },
        expectedProjectId: { type: "string", pattern: "^[a-z][a-z0-9.-]*$" },
        expectedTenantId: { type: "string", minLength: 1, maxLength: 160 },
      },
      required: ["envelope", "keyBase64", "expectedFingerprint", "expectedProjectId", "expectedTenantId"],
      additionalProperties: false,
    },
    run: (args) => applyProjectReviewBundle(
      projectDir,
      args.envelope as EncryptedReviewBundle,
      String(args.keyBase64 ?? ""),
      String(args.expectedFingerprint ?? ""),
      String(args.expectedProjectId ?? ""),
      String(args.expectedTenantId ?? ""),
    ),
  },
  {
    name: "intentform_verify_remote_evidence",
    description: "Verify an externally produced Ed25519-signed build statement against an explicit remote-evidence trust root and the exact current graph/compiler/target/device binding. Accepted remote evidence remains separate and never overwrites local preview evidence.",
    inputSchema: {
      type: "object",
      properties: {
        target: { enum: ["browser", "expo-ios", "expo-android", "swiftui"] },
        signedEvidence: { type: "object" },
        expectedTenantId: { type: "string", minLength: 1, maxLength: 160 },
        profileId: { type: "string", minLength: 1, maxLength: 160 },
      },
      required: ["target", "signedEvidence", "expectedTenantId"],
      additionalProperties: false,
    },
    run: (args) => verifyProjectRemoteEvidence(
      projectDir,
      String(args.target ?? "") as PreviewTarget,
      args.signedEvidence,
      String(args.expectedTenantId ?? ""),
      typeof args.profileId === "string" ? args.profileId : undefined,
    ),
  },
  {
    name: "intentform_begin_transaction",
    description: "Open an isolated, expiring semantic transaction against an exact project fingerprint. This does not mutate the graph; preview and commit remain separate explicit operations.",
    inputSchema: {
      type: "object",
      properties: {
        expectedFingerprint: { type: "string", pattern: "^[a-f0-9]{8}$" },
        rationale: { type: "string", minLength: 1, maxLength: 160 },
        commentId: { type: "string", pattern: "^[A-Za-z0-9._:-]{1,160}$", description: "Optional unresolved canvas review thread to bind to this transaction." },
      },
      required: ["expectedFingerprint", "rationale"],
      additionalProperties: false,
    },
    run: (args, context) => semanticTransactions.begin(
      projectDir,
      context.ownerId,
      String(args.expectedFingerprint ?? ""),
      String(args.rationale ?? ""),
      context.transport,
      typeof args.commentId === "string" ? args.commentId : undefined,
    ),
  },
  {
    name: "intentform_preview_transaction",
    description: `Validate and retain one typed patch inside an open semantic transaction. Returns the exact candidate fingerprint, semantic diff and verification without writing the project. ${PATCH_CONTRACT}`,
    inputSchema: {
      type: "object",
      properties: {
        transactionId: { type: "string", format: "uuid" },
        patch: PATCH_INPUT_SCHEMA.properties.patch,
      },
      required: ["transactionId", "patch"],
      additionalProperties: false,
    },
    run: (args, context) => semanticTransactions.preview(
      projectDir,
      context.ownerId,
      String(args.transactionId ?? ""),
      args.patch,
    ),
  },
  {
    name: "intentform_commit_transaction",
    description: "Commit the exact previously previewed semantic transaction. Fails closed if the graph changed, creates one normal revision, and guarantees the committed fingerprint matches the reviewed preview.",
    inputSchema: {
      type: "object",
      properties: { transactionId: { type: "string", format: "uuid" } },
      required: ["transactionId"],
      additionalProperties: false,
    },
    run: (args, context) => semanticTransactions.commit(
      projectDir,
      context.ownerId,
      String(args.transactionId ?? ""),
    ),
  },
  {
    name: "intentform_rollback_transaction",
    description: "Discard an open semantic transaction without changing the graph or creating a revision.",
    inputSchema: {
      type: "object",
      properties: { transactionId: { type: "string", format: "uuid" } },
      required: ["transactionId"],
      additionalProperties: false,
    },
    run: (args, context) => semanticTransactions.rollback(
      projectDir,
      context.ownerId,
      String(args.transactionId ?? ""),
    ),
  },
];

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    result: {},
    scope: {
      type: "object",
      properties: {
        project: { type: "string" }, file: { type: "string" }, tab: { type: "string" },
        page: { type: ["string", "null"] }, device: { type: "string" }, visualState: { type: "string" }, selection: { type: "null" },
      },
      required: ["project", "file", "tab", "page", "device", "visualState", "selection"],
      additionalProperties: false,
    },
  },
  required: ["result", "scope"],
  additionalProperties: false,
} as const;

const READ_ONLY_TOOLS = new Set([
  "intentform_preview_migration",
  "intentform_describe_project",
  "intentform_list_token_modes",
  "intentform_export_dtcg",
  "intentform_search_assets",
  "intentform_get_graph",
  "intentform_search_components",
  "intentform_component_schema",
  "intentform_preview_patch",
  "intentform_verify",
  "intentform_audit_accessibility",
  "intentform_verify_web",
  "intentform_preview_status",
  "intentform_list_revisions",
  "intentform_diff",
  "intentform_list_history",
  "intentform_preview_branch_merge",
  "intentform_preview_history_operation",
  "intentform_preview_transaction",
  "intentform_preview_package_update",
  "intentform_export_review_bundle",
  "intentform_preview_review_bundle",
  "intentform_verify_remote_evidence",
]);

const NON_IDEMPOTENT_READ_ONLY_TOOLS = new Set([
  "intentform_export_review_bundle",
]);

const DESTRUCTIVE_TOOLS = new Set([
  "intentform_replace_graph",
  "intentform_revert",
  "intentform_asset_gc",
  "intentform_delete_branch",
  "intentform_apply_history_operation",
  "intentform_recover_history",
]);

const GRAPH_MUTATION_TOOLS = new Set([
  "intentform_apply_migration",
  "intentform_import_dtcg",
  "intentform_import_asset",
  "intentform_instantiate_component",
  "intentform_apply_patch",
  "intentform_replace_graph",
  "intentform_revert",
  "intentform_merge_branch",
  "intentform_apply_history_operation",
  "intentform_commit_transaction",
  "intentform_apply_package_update",
  "intentform_apply_review_bundle",
]);

const HISTORY_MUTATION_TOOLS = new Set([
  "intentform_create_branch",
  "intentform_apply_branch_patch",
  "intentform_delete_branch",
  "intentform_recover_history",
]);

const PREVIEW_MUTATION_TOOLS = new Set([
  "intentform_run_preview",
  "intentform_cancel_preview",
]);

const ECOSYSTEM_MUTATION_TOOLS = new Set([
  "intentform_set_plugin_permissions",
]);

const validatorProvider = new AjvJsonSchemaValidator();
const argumentValidators = new Map(toolDefinitions.map((tool) => [
  tool.name,
  validatorProvider.getValidator<Record<string, unknown>>(tool.inputSchema),
]));

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : "The operation failed.")
    .replace(/\b(?:sk|rk|pk)_[A-Za-z0-9_-]{12,}\b/g, "[redacted]")
    .replace(/\b(api[-_]?key|authorization|token|secret|password)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .slice(0, 1_000);
}

function callToolResult(result: unknown, taskId?: string): CallToolResult {
  const value = result ?? null;
  const graph = readCanonicalGraph();
  const scope = {
    project: graph.product.name,
    file: "project.intentform",
    tab: "design",
    page: graph.screens[0]?.id ?? null,
    device: graph.devices.defaultProfile,
    visualState: "idle",
    selection: null,
  };
  return {
    content: [{ type: "text", text: JSON.stringify({ scope, result: value }, null, 2) }],
    structuredContent: { result: value, scope },
    ...(taskId ? { _meta: { "io.modelcontextprotocol/related-task": { taskId } } } : {}),
  };
}

function toolErrorResult(error: unknown, taskId?: string): CallToolResult {
  return {
    content: [{ type: "text", text: safeError(error) }],
    isError: true,
    ...(taskId ? { _meta: { "io.modelcontextprotocol/related-task": { taskId } } } : {}),
  };
}

function publicToolDefinition(tool: ToolDefinition) {
  const readOnly = READ_ONLY_TOOLS.has(tool.name);
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    outputSchema: OUTPUT_SCHEMA,
    annotations: {
      title: tool.name.replace(/^intentform_/, "").replaceAll("_", " "),
      readOnlyHint: readOnly,
      destructiveHint: DESTRUCTIVE_TOOLS.has(tool.name),
      idempotentHint: readOnly && !NON_IDEMPOTENT_READ_ONLY_TOOLS.has(tool.name),
      openWorldHint: false,
    },
    execution: { taskSupport: tool.name === "intentform_run_preview" ? "optional" as const : "forbidden" as const },
  };
}

function affectedResourceUris(toolName: string): string[] {
  const resources = ["intentform://agent/activity"];
  if (GRAPH_MUTATION_TOOLS.has(toolName)) {
    return [...new Set([...resources, ...resourceDefinitions.map((resource) => resource.uri)])];
  }
  if (HISTORY_MUTATION_TOOLS.has(toolName)) resources.push("intentform://project/history");
  if (PREVIEW_MUTATION_TOOLS.has(toolName)) resources.push("intentform://project/previews");
  if (ECOSYSTEM_MUTATION_TOOLS.has(toolName)) resources.push("intentform://project/ecosystem");
  return resources;
}

function terminalPreviewPhase(phase: string): boolean {
  return ["ready", "failed", "cancelled", "toolchain-missing"].includes(phase);
}

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export interface IntentFormMcpRuntime {
  server: Server;
  close(): Promise<void>;
}

export type AgentPermission = "read-only" | "write";

export function availableToolDefinitions(permission: AgentPermission): ToolDefinition[] {
  return permission === "write"
    ? toolDefinitions
    : toolDefinitions.filter((tool) => READ_ONLY_TOOLS.has(tool.name)
      || ["intentform_begin_transaction", "intentform_preview_transaction", "intentform_rollback_transaction"].includes(tool.name));
}

export function createIntentFormMcpServer(
  ownerId = "stdio",
  permission: AgentPermission = process.env.INTENTFORM_MCP_PERMISSION === "write" ? "write" : "read-only",
): IntentFormMcpRuntime {
  const subscriptions = new Set<string>();
  const transactionOwners = new Set([ownerId]);
  const taskStore = new InMemoryTaskStore();
  const transport = ownerId.startsWith("http") ? "http" as const : "stdio" as const;
  const recordToolActivity = (toolName: string, startedAt: number, outcome: AgentActivityOutcome) => {
    recordAgentActivity(projectDir, {
      transport,
      tool: toolName,
      access: agentAccessForTool(toolName, READ_ONLY_TOOLS.has(toolName)),
      outcome,
      durationMs: performance.now() - startedAt,
    });
  };
  const server = new Server(
    {
      name: "intentform",
      title: "IntentForm local design system",
      version: "0.1.0",
      description: "Validated semantic design transactions, deterministic compilers and fingerprint-bound local previews.",
    },
    {
      capabilities: {
        tools: { listChanged: false },
        resources: { subscribe: true, listChanged: false },
        logging: {},
        tasks: { list: {}, cancel: {}, requests: { tools: { call: {} } } },
      },
      instructions: "Inspect project resources or call intentform_describe_project first. Prefer begin, preview and commit transaction for edits. Generated files are outputs, never the semantic source of truth.",
      taskStore,
    },
  );

  const notifyResources = async (toolName: string) => {
    for (const uri of affectedResourceUris(toolName)) {
      if (subscriptions.has(uri)) await server.sendResourceUpdated({ uri }).catch(() => undefined);
    }
  };

  const availableTools = availableToolDefinitions(permission);

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: availableTools.map(publicToolDefinition),
  }));

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: resourceDefinitions.map(({ read: _read, ...resource }) => ({ ...resource })),
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const resource = resourceDefinitions.find((candidate) => candidate.uri === request.params.uri);
    if (!resource) throw new McpError(ErrorCode.InvalidParams, `Unknown resource: ${request.params.uri}`);
    const value = await resource.read();
    return {
      contents: [{
        uri: resource.uri,
        mimeType: resource.mimeType,
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      }],
    };
  });

  server.setRequestHandler(SubscribeRequestSchema, async (request) => {
    if (!resourceDefinitions.some((resource) => resource.uri === request.params.uri)) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown resource: ${request.params.uri}`);
    }
    subscriptions.add(request.params.uri);
    return {};
  });

  server.setRequestHandler(UnsubscribeRequestSchema, async (request) => {
    subscriptions.delete(request.params.uri);
    return {};
  });

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const startedAt = performance.now();
    const tool = availableTools.find((candidate) => candidate.name === request.params.name);
    if (!tool) throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${request.params.name}`);
    const validation = argumentValidators.get(tool.name)!((request.params.arguments ?? {}) as unknown);
    if (!validation.valid) {
      recordToolActivity(tool.name, startedAt, "rejected");
      throw new McpError(ErrorCode.InvalidParams, `Invalid ${tool.name} arguments: ${validation.errorMessage}`);
    }
    const context: ToolContext = {
      ownerId: extra.sessionId ?? ownerId,
      signal: extra.signal,
      transport,
    };
    transactionOwners.add(context.ownerId);

    if (request.params.task) {
      if (tool.name !== "intentform_run_preview" || !extra.taskStore) {
        throw new McpError(ErrorCode.MethodNotFound, `${tool.name} does not support task execution.`);
      }
      const requestedTtl = extra.taskRequestedTtl ?? 5 * 60_000;
      const task = await extra.taskStore.createTask({
        ttl: Math.max(30_000, Math.min(requestedTtl, 10 * 60_000)),
        pollInterval: 500,
      });
      const taskId = task.taskId;
      const progressToken = request.params._meta?.progressToken;
      void (async () => {
        let progress = 0;
        let priorPhase = "";
        const sendProgress = async (message: string) => {
          if (progressToken === undefined) return;
          progress += 1;
          await extra.sendNotification({
            method: "notifications/progress",
            params: {
              progressToken,
              progress,
              total: 8,
              message,
              _meta: { "io.modelcontextprotocol/related-task": { taskId } },
            },
          }).catch(() => undefined);
        };
        try {
          await sendProgress("Starting fingerprint-bound local preview.");
          await tool.run(validation.data, context);
          while (true) {
            const currentTask = await extra.taskStore!.getTask(taskId);
            if (currentTask.status === "cancelled") {
              cancelProjectPreview(
                projectDir,
                String(validation.data.target) as PreviewTarget,
                String(validation.data.expectedFingerprint),
                typeof validation.data.profileId === "string" ? validation.data.profileId : undefined,
              );
              recordToolActivity(tool.name, startedAt, "cancelled");
              await notifyResources(tool.name);
              return;
            }
            const status = projectPreviewStatus(
              projectDir,
              typeof validation.data.profileId === "string" ? validation.data.profileId : undefined,
            );
            const target = status.targets.find((entry) => entry.target === validation.data.target);
            if (!target || "unavailable" in target) throw new Error(target?.message ?? "Preview target is unavailable.");
            if (target.phase !== priorPhase) {
              priorPhase = target.phase;
              await sendProgress(`Preview phase: ${target.phase}.`);
            }
            if (terminalPreviewPhase(target.phase)) {
              const result = callToolResult({ fingerprint: status.fingerprint, target }, taskId);
              const failed = target.phase !== "ready" || target.buildStatus !== "passed";
              if (failed) result.isError = true;
              await extra.taskStore!.storeTaskResult(taskId, failed ? "failed" : "completed", result);
              const finalTask = await extra.taskStore!.getTask(taskId);
              await extra.sendNotification({
                method: "notifications/tasks/status",
                params: {
                  ...finalTask,
                  _meta: { "io.modelcontextprotocol/related-task": { taskId } },
                },
              }).catch(() => undefined);
              recordToolActivity(tool.name, startedAt, failed ? "failed" : "succeeded");
              await notifyResources(tool.name);
              return;
            }
            await wait(200);
          }
        } catch (error) {
          const result = toolErrorResult(error, taskId);
          try {
            await extra.taskStore!.storeTaskResult(taskId, "failed", result);
            const failedTask = await extra.taskStore!.getTask(taskId);
            await extra.sendNotification({
              method: "notifications/tasks/status",
              params: {
                ...failedTask,
                statusMessage: safeError(error),
                _meta: { "io.modelcontextprotocol/related-task": { taskId } },
              },
            }).catch(() => undefined);
          } catch {
            // The task can legitimately expire while its local process is winding down.
          }
          recordToolActivity(tool.name, startedAt, "failed");
          await notifyResources(tool.name).catch(() => undefined);
        }
      })();
      return {
        task,
        _meta: {
          "io.modelcontextprotocol/model-immediate-response": "The local preview is running. Poll tasks/get and retrieve tasks/result after completion.",
        },
      };
    }

    try {
      if (extra.signal.aborted) throw new Error("The MCP request was cancelled before execution.");
      const progressToken = request.params._meta?.progressToken;
      if (progressToken !== undefined) {
        await extra.sendNotification({
          method: "notifications/progress",
          params: { progressToken, progress: 1, total: 2, message: `Running ${tool.name}.` },
        }).catch(() => undefined);
      }
      const result = await tool.run(validation.data, context);
      if (extra.signal.aborted) throw new Error("The MCP request was cancelled.");
      recordToolActivity(tool.name, startedAt, "succeeded");
      await notifyResources(tool.name);
      if (progressToken !== undefined) {
        await extra.sendNotification({
          method: "notifications/progress",
          params: { progressToken, progress: 2, total: 2, message: `${tool.name} completed.` },
        }).catch(() => undefined);
      }
      return callToolResult(result);
    } catch (error) {
      recordToolActivity(tool.name, startedAt, extra.signal.aborted ? "cancelled" : "failed");
      await notifyResources(tool.name).catch(() => undefined);
      return toolErrorResult(error);
    }
  });

  return {
    server,
    async close() {
      for (const transactionOwner of transactionOwners) semanticTransactions.clearOwner(transactionOwner);
      taskStore.cleanup();
      await server.close();
    },
  };
}

export async function startServer(): Promise<void> {
  const runtime = createIntentFormMcpServer("stdio");
  const transport = new StdioServerTransport();
  const shutdown = async () => {
    await runtime.close();
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
  await runtime.server.connect(transport);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer().catch((error) => {
    process.stderr.write(`IntentForm MCP failed: ${safeError(error)}\n`);
    process.exitCode = 1;
  });
}
