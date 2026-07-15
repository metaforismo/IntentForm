import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import {
  applyMigration,
  applyPatch,
  collectProjectAssets,
  cancelProjectPreview,
  compileProject,
  componentSchema,
  describeProject,
  deviceProfileResource,
  deviceBezelResource,
  diffAgainstRevision,
  exportProjectTokens,
  getGraph,
  importProjectAssetFromInbox,
  importProjectTokens,
  instantiateProjectComponent,
  listTokenModes,
  projectRevisions,
  projectPreviewStatus,
  previewMigration,
  previewPatch,
  replaceGraph,
  runProjectPreview,
  revertProject,
  searchComponents,
  searchProjectAssets,
  verifyProject,
  verifyWebProject,
  type ScenarioId,
} from "./tools.ts";
import { resolveProjectDir } from "./store.ts";
import type { PreviewTarget } from "@intentform/preview-daemon";

/* A minimal MCP stdio server (JSON-RPC 2.0, newline-delimited) with no
   transport dependencies. It exposes the IntentForm project in `.intentform/`
   to coding agents: inspect the semantic graph, apply typed patches, compile
   every enabled platform and verify the result — the same operations the Studio uses. */

const PROTOCOL_VERSION = "2024-11-05";
const projectDir = resolveProjectDir();

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run(args: Record<string, unknown>): unknown;
}

const DEVICE_PROFILES_URI = "intentform://device-profiles";

export const resourceDefinitions = [{
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
{"op":"set-label","target":nodeId,"label":string} · {"op":"set-placement","target":nodeId,"compact":"inline"|"persistent-bottom","regular":"inline"|"persistent-bottom"} · {"op":"set-purpose","target":nodeId,"purpose":string} · {"op":"set-emphasis","target":nodeId,"emphasis":"quiet"|"normal"|"strong"} · {"op":"set-gap-token","target":nodeId,"token":string} · {"op":"set-padding-token","target":nodeId,"token":string} · {"op":"set-layout","target":nodeId, ...layoutFields} · {"op":"set-web-layout","target":nodeId,"layout":typedWebLayout|null} · {"op":"move-node","target":nodeId,"screenId":screenId,"parent":nodeId|null,"index"?:number} · {"op":"set-color-token","token":colorTokenName,"value":"#rrggbb"} · {"op":"set-token-mode","mode":modeId} · {"op":"bind-asset","target":nodeId,"assetId":assetId,"variantId"?:variantId,"fit":"contain"|"cover"|"fill"|"none","focalPoint":{"x":0..1,"y":0..1},"decorative":boolean} · {"op":"clear-asset","target":nodeId} · {"op":"set-fixture-value","screenId":screenId,"state":"idle"|"loading"|"empty"|"failed"|"completed","field":contractField,"value":string|number|boolean}.
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
    description: "Replace the entire Semantic Interface Graph (current schemaVersion 0.7.0). Use for structural edits a typed operation cannot express. Recursive hierarchy, components, token modes, licensed assets, logical device profiles, responsive-web and Expo profiles, node-count and layout constraints are fully validated; invalid graphs are rejected without side effects. Returns the semantic diff and fresh verification findings.",
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
];

function write(message: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function handle(message: { id?: number | string | null; method?: string; params?: Record<string, unknown> }): void {
  const { id, method, params } = message;
  if (method === "initialize") {
    write({
      jsonrpc: "2.0",
      id: id ?? null,
      result: {
        protocolVersion: typeof params?.protocolVersion === "string" ? params.protocolVersion : PROTOCOL_VERSION,
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: "intentform", version: "0.1.0" },
      },
    });
    return;
  }
  if (method === "ping") {
    write({ jsonrpc: "2.0", id: id ?? null, result: {} });
    return;
  }
  if (method === "tools/list") {
    write({
      jsonrpc: "2.0",
      id: id ?? null,
      result: { tools: toolDefinitions.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) },
    });
    return;
  }
  if (method === "resources/list") {
    write({
      jsonrpc: "2.0",
      id: id ?? null,
      result: { resources: resourceDefinitions.map(({ read: _read, ...resource }) => resource) },
    });
    return;
  }
  if (method === "resources/read") {
    const uri = typeof params?.uri === "string" ? params.uri : "";
    const resource = resourceDefinitions.find((candidate) => candidate.uri === uri);
    if (!resource) {
      write({ jsonrpc: "2.0", id: id ?? null, error: { code: -32602, message: `Unknown resource: ${uri}` } });
      return;
    }
    try {
      write({
        jsonrpc: "2.0",
        id: id ?? null,
        result: { contents: [{ uri: resource.uri, mimeType: resource.mimeType, text: JSON.stringify(resource.read(), null, 2) }] },
      });
    } catch (error) {
      write({ jsonrpc: "2.0", id: id ?? null, error: { code: -32603, message: error instanceof Error ? error.message : "Resource read failed." } });
    }
    return;
  }
  if (method === "tools/call") {
    const name = typeof params?.name === "string" ? params.name : "";
    const tool = toolDefinitions.find((candidate) => candidate.name === name);
    if (!tool) {
      write({ jsonrpc: "2.0", id: id ?? null, error: { code: -32602, message: `Unknown tool: ${name}` } });
      return;
    }
    try {
      const args = (params?.arguments ?? {}) as Record<string, unknown>;
      const result = tool.run(args);
      const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
      write({ jsonrpc: "2.0", id: id ?? null, result: { content: [{ type: "text", text }] } });
    } catch (error) {
      write({
        jsonrpc: "2.0",
        id: id ?? null,
        result: {
          content: [{ type: "text", text: error instanceof Error ? error.message : "The operation failed." }],
          isError: true,
        },
      });
    }
    return;
  }
  if (typeof method === "string" && method.startsWith("notifications/")) return;
  if (id !== undefined && id !== null) {
    write({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method ?? "unknown"}` } });
  }
}

export function startServer(): void {
  const reader = createInterface({ input: process.stdin, terminal: false });
  reader.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      handle(JSON.parse(trimmed));
    } catch {
      write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}
