import {
  applyGraphPatch,
  graphPatchSchema,
  type GraphPatch,
  type SemanticInterfaceGraph,
} from "@intentform/semantic-schema";
import { contrastRatio, type VerificationFinding } from "@intentform/verifier";
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

  if (finding.id.includes("tokens.contrast.primary-action")) {
    const token = finding.evidence.find((item) => item.label === "Token")?.value;
    const value = finding.evidence.find((item) => item.label === "Token value")?.value;
    const minimum = finding.evidence.find((item) => item.label === "Required minimum")?.value;
    if (typeof token !== "string" || typeof value !== "string" || typeof minimum !== "number") {
      throw new Error(`Finding ${finding.id} does not identify a repairable token.`);
    }
    return {
      layer: "tokens",
      summary: `Darkened ${token} to the nearest shade that satisfies the ${minimum}:1 contrast requirement.`,
      patch: {
        id: `repair.${finding.id}`,
        rationale: finding.violatedIntent,
        operations: [{ op: "set-color-token", token, value: darkenUntilContrast(value, "#ffffff", minimum) }],
      },
    };
  }

  throw new Error(`No safe deterministic repair is registered for ${finding.id}`);
}

/* Deterministically walk the color toward black in 2% steps until the white
   foreground reaches the required ratio. Same input always yields the same
   repaired shade. */
export function darkenUntilContrast(hex: string, foreground: string, minimum: number): string {
  const expanded = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) throw new Error(`Cannot repair non-hex color: ${hex}`);
  const base = [
    parseInt(expanded.slice(0, 2), 16),
    parseInt(expanded.slice(2, 4), 16),
    parseInt(expanded.slice(4, 6), 16),
  ] as const;

  for (let step = 0; step <= 50; step += 1) {
    const factor = 1 - step * 0.02;
    const candidate = `#${base
      .map((channel) => Math.round(channel * factor).toString(16).padStart(2, "0"))
      .join("")}`;
    const ratio = contrastRatio(foreground, candidate);
    if (ratio !== null && ratio >= minimum) return candidate;
  }
  return "#000000";
}

export function applyRepair(
  graph: SemanticInterfaceGraph,
  proposalInput: RepairProposal,
): SemanticInterfaceGraph {
  const proposal = repairProposalSchema.parse(proposalInput);
  return applyGraphPatch(graph, proposal.patch as GraphPatch);
}
