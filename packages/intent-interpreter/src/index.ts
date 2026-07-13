import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import {
  parseGraph,
  semanticInterfaceGraphSchema,
  type SemanticInterfaceGraph,
} from "@intentform/semantic-schema";

export interface InterpretationResult {
  graph: SemanticInterfaceGraph;
  mode: "live" | "replay";
  model: string;
  note: string;
}

const systemPrompt = `You are IntentForm's product-intent interpreter.
Translate a mobile interface brief into the supplied Semantic Interface Graph schema.
Preserve meaning, accessibility, explicit visual states and platform-aware adaptive placement.
Use only the component kinds supported by the schema. Do not emit source code.
Every transactional screen needs exactly one primary action. On compact screens, that action must be persistent-bottom; on regular screens it should remain inline.
Never expose blockchain terminology in user-facing labels.`;

export async function interpretBrief(options: {
  brief: string;
  fallbackGraph: SemanticInterfaceGraph;
  apiKey?: string;
  model?: string;
  signal?: AbortSignal;
}): Promise<InterpretationResult> {
  if (!options.apiKey) {
    return {
      graph: structuredClone(options.fallbackGraph),
      mode: "replay",
      model: "deterministic-sample",
      note: "No server API key is configured. Showing the reproducible Build Week sample.",
    };
  }

  const client = new OpenAI({ apiKey: options.apiKey });
  const model = options.model ?? "gpt-5.6";
  const response = await client.responses.parse(
    {
      model,
      reasoning: { effort: "medium" },
      text: {
        verbosity: "low",
        format: zodTextFormat(semanticInterfaceGraphSchema, "semantic_interface_graph"),
      },
      input: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Product brief:\n${options.brief}\n\nUse product name ${options.fallbackGraph.product.name}.`,
        },
      ],
      max_output_tokens: 12_000,
      store: false,
    },
    { signal: options.signal },
  );

  if (!response.output_parsed) {
    throw new Error("GPT-5.6 returned no structured graph.");
  }

  return {
    graph: parseGraph(response.output_parsed),
    mode: "live",
    model,
    note: "GPT-5.6 interpreted the brief into a validated graph. Code generation remains deterministic.",
  };
}
