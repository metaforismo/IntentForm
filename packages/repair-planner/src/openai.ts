import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { SemanticInterfaceGraph } from "@intentform/semantic-schema";
import type { VerificationFinding } from "@intentform/verifier";
import { applyRepair, repairProposalSchema, type RepairProposal } from "./index";

export interface RepairEvidencePacket {
  screenshotPath?: string;
  bounds?: { x: number; y: number; width: number; height: number };
  build?: { passed: boolean; diagnostics: string[] };
}

export interface RepairPlanResult {
  proposal: RepairProposal;
  trace: {
    requestId: string;
    requestFingerprint: string;
    attempts: number;
    usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
  };
}

function fingerprint(value: unknown): string {
  const input = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export async function planRepairWithOpenAI(options: {
  graph: SemanticInterfaceGraph;
  finding: VerificationFinding;
  evidence?: RepairEvidencePacket;
  apiKey: string;
  model?: string;
  signal?: AbortSignal;
}): Promise<RepairPlanResult> {
  const client = new OpenAI({ apiKey: options.apiKey });
  const model = options.model ?? "gpt-5.6";
  const requestFingerprint = fingerprint({ graph: options.graph, finding: options.finding, evidence: options.evidence });
  let lastError: unknown;
  let usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await client.responses.parse(
        {
          model,
          reasoning: { effort: "medium" },
          text: { verbosity: "low", format: zodTextFormat(repairProposalSchema, "repair_proposal") },
          input: [
            {
              role: "system",
              content:
                "You are IntentForm's evidence critic and repair planner. Classify the responsible layer and propose the smallest typed patch. Never emit source code. Preserve shared product intent. Only use node IDs and spacing tokens present in the graph. If the finding is compiler-specific, classify it honestly and return no graph operations.",
            },
            {
              role: "user",
              content: JSON.stringify({
                finding: options.finding,
                evidence: options.evidence ?? {},
                graph: options.graph,
                ...(attempt === 2
                  ? { correction: `The previous proposal failed validation: ${lastError instanceof Error ? lastError.message.slice(0, 500) : "unknown error"}` }
                  : {}),
              }),
            },
          ],
          max_output_tokens: 2_500,
          store: false,
        },
        { signal: options.signal },
      );

      if (response.usage) {
        usage = {
          inputTokens: usage.inputTokens + response.usage.input_tokens,
          outputTokens: usage.outputTokens + response.usage.output_tokens,
          totalTokens: usage.totalTokens + response.usage.total_tokens,
        };
      }
      if (!response.output_parsed) throw new Error("GPT-5.6 returned no repair proposal.");
      const proposal = repairProposalSchema.parse(response.output_parsed);
      if (proposal.layer === "compiler" && proposal.patch.operations.length > 0) {
        throw new Error("A compiler finding cannot be repaired by mutating the product graph.");
      }
      if (proposal.layer !== "compiler" && proposal.patch.operations.length === 0) {
        throw new Error("A graph or token repair must contain at least one typed operation.");
      }
      applyRepair(options.graph, proposal);
      return {
        proposal,
        trace: {
          requestId: response.id,
          requestFingerprint,
          attempts: attempt,
          usage,
        },
      };
    } catch (error) {
      lastError = error;
      if (options.signal?.aborted) throw error;
    }
  }

  throw new Error(`Repair proposal remained invalid after one corrective retry: ${lastError instanceof Error ? lastError.message : "unknown error"}`);
}
