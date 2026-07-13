import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { SemanticInterfaceGraph } from "@intentform/semantic-schema";
import type { VerificationFinding } from "@intentform/verifier";
import { applyRepair, repairProposalSchema, type RepairProposal } from "./index";

export async function planRepairWithOpenAI(options: {
  graph: SemanticInterfaceGraph;
  finding: VerificationFinding;
  apiKey: string;
  model?: string;
  signal?: AbortSignal;
}): Promise<RepairProposal> {
  const client = new OpenAI({ apiKey: options.apiKey });
  const response = await client.responses.parse(
    {
      model: options.model ?? "gpt-5.6",
      reasoning: { effort: "medium" },
      text: { verbosity: "low", format: zodTextFormat(repairProposalSchema, "repair_proposal") },
      input: [
        {
          role: "system",
          content:
            "You are IntentForm's evidence critic. Propose the smallest typed repair. Never emit source code. Preserve shared product intent and change the graph unless evidence proves a compiler defect.",
        },
        {
          role: "user",
          content: JSON.stringify({ finding: options.finding, graph: options.graph }),
        },
      ],
      max_output_tokens: 2_500,
      store: false,
    },
    { signal: options.signal },
  );

  if (!response.output_parsed) throw new Error("GPT-5.6 returned no repair proposal.");
  const proposal = repairProposalSchema.parse(response.output_parsed);
  applyRepair(options.graph, proposal);
  return proposal;
}
