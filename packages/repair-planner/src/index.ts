import {
  applyGraphPatch,
  graphPatchSchema,
  type GraphPatch,
  type SemanticInterfaceGraph,
} from "@intentform/semantic-schema";
import type { VerificationFinding } from "@intentform/verifier";
import { z } from "zod";

export const repairProposalSchema = z.object({
  layer: z.enum(["graph", "tokens", "compiler"]),
  summary: z.string().min(4),
  patch: graphPatchSchema,
});

export type RepairProposal = z.infer<typeof repairProposalSchema>;

export function planDeterministicRepair(finding: VerificationFinding): RepairProposal {
  if (finding.id.endsWith("primary.compact-reachability")) {
    const target = finding.evidence.find((item) => item.label === "Node ID")?.value;
    if (typeof target !== "string") {
      throw new Error(`Finding ${finding.id} does not identify a safe patch target.`);
    }
    return {
      layer: "graph",
      summary: "Keep the primary action inside the normal flow on regular screens and anchor it to the bottom safe area on compact screens.",
      patch: {
        id: `repair.${finding.id}`,
        rationale: finding.violatedIntent,
        operations: [
          {
            op: "set-placement",
            target,
            compact: "persistent-bottom",
            regular: "inline",
          },
        ],
      },
    };
  }

  throw new Error(`No safe deterministic repair is registered for ${finding.id}`);
}

export function applyRepair(
  graph: SemanticInterfaceGraph,
  proposalInput: RepairProposal,
): SemanticInterfaceGraph {
  const proposal = repairProposalSchema.parse(proposalInput);
  return applyGraphPatch(graph, proposal.patch as GraphPatch);
}
