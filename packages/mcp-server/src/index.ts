import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import {
  applyMigration,
  applyPatch,
  compileProject,
  describeProject,
  diffAgainstRevision,
  getGraph,
  projectRevisions,
  previewMigration,
  previewPatch,
  replaceGraph,
  revertProject,
  verifyProject,
  type ScenarioId,
} from "./tools.ts";
import { resolveProjectDir } from "./store.ts";

/* A minimal MCP stdio server (JSON-RPC 2.0, newline-delimited) with no
   transport dependencies. It exposes the IntentForm project in `.intentform/`
   to coding agents: inspect the semantic graph, apply typed patches, compile
   both platforms and verify the result — the same operations the Studio uses. */

const PROTOCOL_VERSION = "2024-11-05";
const projectDir = resolveProjectDir();

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run(args: Record<string, unknown>): unknown;
}

const PATCH_CONTRACT = `A GraphPatch is {"id": string, "rationale": string, "operations": Operation[]} where Operation is one of:
{"op":"set-label","target":nodeId,"label":string} · {"op":"set-placement","target":nodeId,"compact":"inline"|"persistent-bottom","regular":"inline"|"persistent-bottom"} · {"op":"set-purpose","target":nodeId,"purpose":string} · {"op":"set-emphasis","target":nodeId,"emphasis":"quiet"|"normal"|"strong"} · {"op":"set-gap-token","target":nodeId,"token":string} · {"op":"set-padding-token","target":nodeId,"token":string} · {"op":"set-layout","target":nodeId, ...layoutFields} · {"op":"move-node","target":nodeId,"screenId":screenId,"parent":nodeId|null,"index"?:number} · {"op":"set-color-token","token":colorTokenName,"value":"#rrggbb"} · {"op":"set-fixture-value","screenId":screenId,"state":"idle"|"loading"|"empty"|"failed"|"completed","field":contractField,"value":string|number|boolean}.
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
    description: "Inspect the IntentForm project: product, screens with stable node IDs, design tokens, flows, contracts, current verification status, and each compiler target's generation status and fingerprint when available. Call this first to discover node IDs before editing.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: () => describeProject(projectDir),
  },
  {
    name: "intentform_get_graph",
    description: "Return the full Semantic Interface Graph as canonical, deterministic JSON. Use for detailed inspection or as the basis for intentform_replace_graph.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: () => getGraph(projectDir),
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
    description: "Replace the entire Semantic Interface Graph (current schemaVersion 0.2.0). Use for structural edits a typed patch cannot express (adding screens or nodes). Recursive hierarchy, depth, node-count and layout constraints are fully validated; invalid graphs are rejected without side effects. Returns the semantic diff and fresh verification findings.",
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
    name: "intentform_compile",
    description: "Compile the current graph with a deterministic backend ('react' or 'swiftui'). With write=true the files are emitted under .intentform/output/<target>/ so you can read them from disk. Same graph + same compiler always yields byte-identical output.",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", enum: ["react", "swiftui"] },
        write: { type: "boolean", description: "Write generated files to .intentform/output/<target>/ (default true)" },
      },
      required: ["target"],
    },
    run: (args) => compileProject(projectDir, args.target === "swiftui" ? "swiftui" : "react", args.write !== false),
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
        capabilities: { tools: {} },
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
