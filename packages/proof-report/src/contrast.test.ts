import { describe, expect, it } from "vitest";
import {
  applyRepair,
  darkenUntilContrast,
  planDeterministicRepair,
} from "@intentform/repair-planner";
import { applyGraphPatch, parseGraph } from "@intentform/semantic-schema";
import { contrastRatio, verifyGraph } from "@intentform/verifier";
import { demoGraph } from "./demo";

const scenario = { target: "swiftui" as const, viewport: { width: 375, height: 667 }, buildStatus: "passed" as const };

describe("token-layer contrast verification and repair", () => {
  it("accepts the sample palette without token findings", () => {
    const findings = verifyGraph(demoGraph, scenario).findings;
    expect(findings.filter((finding) => finding.responsibleLayer === "tokens")).toHaveLength(0);
  });

  it("flags a low-contrast accent as a tokens-layer error with evidence", () => {
    const themed = structuredClone(demoGraph);
    themed.tokens.colors["color.accent"] = "#cde5da";
    const finding = verifyGraph(parseGraph(themed), scenario).findings
      .find((item) => item.id.endsWith("tokens.contrast.primary-action"));
    expect(finding?.responsibleLayer).toBe("tokens");
    expect(finding?.severity).toBe("error");
    expect(finding?.evidence.find((item) => item.label === "Token")?.value).toBe("color.accent");
    expect(finding?.evidence.find((item) => item.label === "Token value")?.value).toBe("#cde5da");
  });

  it("repairs contrast deterministically through a typed color-token patch", () => {
    const themed = structuredClone(demoGraph);
    themed.tokens.colors["color.accent"] = "#cde5da";
    const graph = parseGraph(themed);
    const finding = verifyGraph(graph, scenario).findings
      .find((item) => item.id.endsWith("tokens.contrast.primary-action"));
    expect(finding).toBeDefined();

    const proposal = planDeterministicRepair(finding!);
    expect(proposal.layer).toBe("tokens");
    expect(proposal.patch.operations[0]).toMatchObject({ op: "set-color-token", token: "color.accent" });

    const repaired = applyRepair(graph, proposal);
    expect(verifyGraph(repaired, scenario).findings.filter((item) => item.responsibleLayer === "tokens")).toHaveLength(0);
    expect(applyRepair(graph, proposal)).toEqual(repaired);
  });

  it("darkens deterministically until the required ratio is met", () => {
    const dark = darkenUntilContrast("#cde5da", "#ffffff", 3);
    expect(dark).toMatch(/^#[0-9a-f]{6}$/);
    expect(contrastRatio("#ffffff", dark)!).toBeGreaterThanOrEqual(3);
    expect(darkenUntilContrast("#cde5da", "#ffffff", 3)).toBe(dark);
  });

  it("rejects color-token patches for unknown tokens or invalid values", () => {
    expect(() => applyGraphPatch(demoGraph, {
      id: "patch.bad-token",
      rationale: "test",
      operations: [{ op: "set-color-token", token: "color.missing", value: "#123456" }],
    })).toThrow(/Unknown color token/);
    expect(() => applyGraphPatch(demoGraph, {
      id: "patch.bad-value",
      rationale: "test",
      operations: [{ op: "set-color-token", token: "color.accent", value: "not-a-color" as never }],
    })).toThrow();
  });
});
