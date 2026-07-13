import { compileReact } from "@intentform/compiler-react";
import { compileSwiftUI } from "@intentform/compiler-swiftui";
import { applyRepair, planDeterministicRepair, type RepairProposal } from "@intentform/repair-planner";
import { semanticDiff, type SemanticChange, type SemanticInterfaceGraph } from "@intentform/semantic-schema";
import {
  reconcileFindings,
  verifyGraph,
  type VerificationFinding,
  type VerificationResult,
} from "@intentform/verifier";

export interface ProofReport {
  before: {
    graph: SemanticInterfaceGraph;
    reactFingerprint: string;
    swiftFingerprint: string;
    verification: VerificationResult;
  };
  repair: RepairProposal;
  changes: SemanticChange[];
  after: {
    graph: SemanticInterfaceGraph;
    reactFingerprint: string;
    swiftFingerprint: string;
    verification: VerificationResult;
  };
  reconciledFindings: VerificationFinding[];
}

export function buildProofReport(graph: SemanticInterfaceGraph): ProofReport {
  const scenario = { target: "swiftui" as const, viewport: { width: 375, height: 667 }, buildPassed: true };
  const reactBefore = compileReact(graph);
  const swiftBefore = compileSwiftUI(graph);
  const verificationBefore = verifyGraph(graph, scenario);
  const repairable = verificationBefore.findings.find((finding) =>
    finding.id.endsWith("primary.compact-reachability") && finding.screenId === "payment-request",
  );
  if (!repairable) throw new Error("Demo graph does not contain the expected controlled finding.");

  const repair = planDeterministicRepair(repairable);
  const repairedGraph = applyRepair(graph, repair);
  const reactAfter = compileReact(repairedGraph);
  const swiftAfter = compileSwiftUI(repairedGraph);
  const verificationAfter = verifyGraph(repairedGraph, scenario);

  return {
    before: {
      graph,
      reactFingerprint: reactBefore.fingerprint,
      swiftFingerprint: swiftBefore.fingerprint,
      verification: verificationBefore,
    },
    repair,
    changes: semanticDiff(graph, repairedGraph),
    after: {
      graph: repairedGraph,
      reactFingerprint: reactAfter.fingerprint,
      swiftFingerprint: swiftAfter.fingerprint,
      verification: verificationAfter,
    },
    reconciledFindings: reconcileFindings(verificationBefore.findings, verificationAfter.findings),
  };
}
