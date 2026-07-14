import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import {
  applyGraphPatch,
  graphPatchSchema,
  parseGraph,
  semanticInterfaceGraphSchema,
  stableSerialize,
  type GraphPatch,
  type SemanticInterfaceGraph,
} from "@intentform/semantic-schema";

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface ModelTrace {
  requestId: string;
  requestFingerprint: string;
  attempts: number;
  usage?: ModelUsage;
}

export interface InterpretationResult {
  graph: SemanticInterfaceGraph;
  mode: "live" | "replay";
  model: string;
  note: string;
  trace: ModelTrace;
}

export interface SemanticEditResult {
  graph: SemanticInterfaceGraph;
  patch: GraphPatch;
  mode: "live" | "replay";
  model: string;
  note: string;
  trace: ModelTrace;
}

interface StructuredRequest {
  schema: z.ZodType;
  schemaName: string;
  system: string;
  user: string;
  maxOutputTokens: number;
  signal?: AbortSignal;
}

interface StructuredResponse {
  id: string;
  output: unknown;
  usage?: ModelUsage;
}

export type StructuredGenerator = (request: StructuredRequest) => Promise<StructuredResponse>;

export const capabilityCatalog = {
  nodeKinds: [
    "balance-summary",
    "transaction-list",
    "money-input",
    "recipient-identity",
    "primary-action",
    "secondary-action",
    "status-message",
    "receipt-summary",
  ],
  layouts: ["vertical", "horizontal", "overlay"],
  widths: ["hug", "fill", "fixed"],
  placements: ["inline", "persistent-bottom"],
  visualStates: ["idle", "loading", "empty", "failed", "completed"],
  patchOperations: [
    "set-placement",
    "set-label",
    "set-purpose",
    "set-emphasis",
    "set-gap-token",
    "set-padding-token",
    "set-color-token",
    "set-fixture-value",
  ],
} as const;

const systemPrompt = `You are IntentForm's product-intent interpreter.
Translate a mobile interface brief into the supplied Semantic Interface Graph schema.
Preserve meaning, accessibility, explicit visual states and platform-aware adaptive placement.
Use only the capability catalog. Do not emit source code or arbitrary JavaScript.
Every transactional screen needs exactly one primary action. On compact screens, that action must be persistent-bottom; on regular screens it should remain inline.
Never expose blockchain terminology in user-facing labels.`;

const editSystemPrompt = `You are IntentForm's semantic editor.
Return the smallest valid typed patch that implements the requested product-intent change.
Only target stable node IDs present in the current graph. Use only the capability catalog.
Do not regenerate the graph, emit source code, or modify unrelated nodes.`;

function fingerprint(value: unknown): string {
  const input = stableSerialize(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function validationSummary(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues.slice(0, 8).map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`).join("; ");
  }
  return error instanceof Error ? error.message.slice(0, 600) : "unknown schema error";
}

function mergeUsage(current: ModelUsage | undefined, next: ModelUsage | undefined): ModelUsage | undefined {
  if (!current) return next;
  if (!next) return current;
  return {
    inputTokens: current.inputTokens + next.inputTokens,
    outputTokens: current.outputTokens + next.outputTokens,
    totalTokens: current.totalTokens + next.totalTokens,
  };
}

function createOpenAIGenerator(apiKey: string, model: string): StructuredGenerator {
  const client = new OpenAI({ apiKey });
  return async (request) => {
    const response = await client.responses.parse(
      {
        model,
        reasoning: { effort: "medium" },
        text: { verbosity: "low", format: zodTextFormat(request.schema, request.schemaName) },
        input: [
          { role: "system", content: request.system },
          { role: "user", content: request.user },
        ],
        max_output_tokens: request.maxOutputTokens,
        store: false,
      },
      { signal: request.signal },
    );

    if (!response.output_parsed) throw new Error("The model returned no structured output.");
    const usage = response.usage ? {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      totalTokens: response.usage.total_tokens,
    } : undefined;
    return {
      id: response.id,
      output: response.output_parsed,
      ...(usage ? { usage } : {}),
    };
  };
}

async function generateWithCorrection<T>(options: {
  schema: z.ZodType<T>;
  schemaName: string;
  system: string;
  user: string;
  maxOutputTokens: number;
  generate: StructuredGenerator;
  signal?: AbortSignal;
  validate?: (value: T) => T;
}): Promise<{ value: T; trace: Omit<ModelTrace, "requestFingerprint"> }> {
  let lastError: unknown;
  let usage: ModelUsage | undefined;
  let requestId = "unavailable";

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await options.generate({
        schema: options.schema,
        schemaName: options.schemaName,
        system: options.system,
        user: attempt === 1
          ? options.user
          : `${options.user}\n\nCorrection required: the previous structured result failed validation: ${validationSummary(lastError)}. Return a complete corrected result.`,
        maxOutputTokens: options.maxOutputTokens,
        ...(options.signal ? { signal: options.signal } : {}),
      });
      requestId = response.id;
      usage = mergeUsage(usage, response.usage);
      const parsed = options.schema.parse(response.output);
      const value = options.validate ? options.validate(parsed) : parsed;
      return { value, trace: { requestId, attempts: attempt, ...(usage ? { usage } : {}) } };
    } catch (error) {
      lastError = error;
      if (options.signal?.aborted) throw error;
    }
  }

  throw new Error(`Structured output remained invalid after one corrective retry: ${validationSummary(lastError)}`);
}

function deterministicEdit(instruction: string, graph: SemanticInterfaceGraph, screenId?: string): GraphPatch {
  const scope = screenId ? graph.screens.find((screen) => screen.id === screenId)?.nodes ?? [] : graph.screens.flatMap((screen) => screen.nodes);
  const primary = scope.find((node) => node.kind === "primary-action");
  if (!primary) throw new Error("The replay graph has no primary action to edit safely.");

  const quoted = instruction.match(/[“"]([^”"]+)[”"]/u)?.[1];
  if (/label|rename|copy|text/i.test(instruction) && quoted) {
    return {
      id: `edit.${fingerprint(instruction)}`,
      rationale: instruction,
      operations: [{ op: "set-label", target: primary.id, label: quoted }],
    };
  }
  if (/compact|bottom|reachable|inline/i.test(instruction)) {
    return {
      id: `edit.${fingerprint(instruction)}`,
      rationale: instruction,
      operations: [{ op: "set-placement", target: primary.id, compact: "persistent-bottom", regular: "inline" }],
    };
  }
  throw new Error("This edit needs the live model. Replay supports quoted primary-action renames and adaptive placement edits.");
}

export async function interpretBrief(options: {
  brief: string;
  fallbackGraph: SemanticInterfaceGraph;
  apiKey?: string;
  model?: string;
  signal?: AbortSignal;
  generate?: StructuredGenerator;
}): Promise<InterpretationResult> {
  const requestFingerprint = fingerprint({ kind: "create", brief: options.brief, capabilities: capabilityCatalog });
  if (!options.apiKey && !options.generate) {
    return {
      graph: structuredClone(options.fallbackGraph),
      mode: "replay",
      model: "deterministic-sample",
      note: "No server API key is configured. Showing the reproducible Build Week sample.",
      trace: { requestId: "replay.create", requestFingerprint, attempts: 0 },
    };
  }

  const model = options.model ?? "gpt-5.6";
  const generate = options.generate ?? createOpenAIGenerator(options.apiKey!, model);
  const result = await generateWithCorrection({
    schema: semanticInterfaceGraphSchema,
    schemaName: "semantic_interface_graph",
    system: systemPrompt,
    user: `Product brief:\n${options.brief}\n\nCapability catalog:\n${JSON.stringify(capabilityCatalog)}\n\nUse product name ${options.fallbackGraph.product.name}.`,
    maxOutputTokens: 12_000,
    generate,
    ...(options.signal ? { signal: options.signal } : {}),
  });

  return {
    graph: parseGraph(result.value),
    mode: "live",
    model,
    note: `GPT-5.6 produced a validated graph in ${result.trace.attempts} attempt${result.trace.attempts === 1 ? "" : "s"}. Code generation remains deterministic.`,
    trace: { ...result.trace, requestFingerprint },
  };
}

export async function interpretSemanticEdit(options: {
  instruction: string;
  graph: SemanticInterfaceGraph;
  screenId?: string;
  apiKey?: string;
  model?: string;
  signal?: AbortSignal;
  generate?: StructuredGenerator;
}): Promise<SemanticEditResult> {
  const graph = parseGraph(options.graph);
  const requestFingerprint = fingerprint({ kind: "edit", instruction: options.instruction, screenId: options.screenId, graph });
  if (!options.apiKey && !options.generate) {
    const patch = deterministicEdit(options.instruction, graph, options.screenId);
    return {
      graph: applyGraphPatch(graph, patch),
      patch,
      mode: "replay",
      model: "deterministic-edit",
      note: "Applied a deterministic typed semantic edit.",
      trace: { requestId: "replay.edit", requestFingerprint, attempts: 0 },
    };
  }

  const model = options.model ?? "gpt-5.6";
  const generate = options.generate ?? createOpenAIGenerator(options.apiKey!, model);
  const result = await generateWithCorrection({
    schema: graphPatchSchema,
    schemaName: "semantic_graph_patch",
    system: editSystemPrompt,
    user: `Requested edit:\n${options.instruction}\n\nSelected screen scope: ${options.screenId ?? "entire graph"}\n\nCapability catalog:\n${JSON.stringify(capabilityCatalog)}\n\nCurrent validated graph:\n${stableSerialize(graph)}`,
    maxOutputTokens: 2_500,
    generate,
    validate: (patch) => {
      applyGraphPatch(graph, patch);
      return patch;
    },
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const patch = graphPatchSchema.parse(result.value);
  const edited = applyGraphPatch(graph, patch);

  return {
    graph: edited,
    patch,
    mode: "live",
    model,
    note: `GPT-5.6 applied ${patch.operations.length} validated semantic operation${patch.operations.length === 1 ? "" : "s"}.`,
    trace: { ...result.trace, requestFingerprint },
  };
}
