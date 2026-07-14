import { describe, expect, it } from "vitest";
import { demoGraph } from "../../proof-report/src/demo";
import { semanticDiff } from "@intentform/semantic-schema";
import {
  interpretBrief,
  interpretSemanticEdit,
  type StructuredGenerator,
} from "./index";

describe("GPT-5.6 intent integration", () => {
  it("keeps judge access deterministic when no server key is present", async () => {
    const result = await interpretBrief({ brief: "A payment flow", fallbackGraph: demoGraph });
    expect(result.mode).toBe("replay");
    expect(result.trace.attempts).toBe(0);
    expect(result.graph).toEqual(demoGraph);
    expect(result.graph).not.toBe(demoGraph);
  });

  it("performs exactly one corrective retry for invalid structured graph output", async () => {
    let calls = 0;
    const generate: StructuredGenerator = async () => {
      calls += 1;
      return {
        id: `response-${calls}`,
        output: calls === 1 ? { schemaVersion: "invalid" } : demoGraph,
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      };
    };

    const result = await interpretBrief({ brief: "A payment flow", fallbackGraph: demoGraph, generate });
    expect(calls).toBe(2);
    expect(result.mode).toBe("live");
    expect(result.trace).toMatchObject({ requestId: "response-2", attempts: 2 });
    expect(result.trace.usage?.totalTokens).toBe(60);
  });

  it("applies a replay edit as a narrow, deterministic semantic patch", async () => {
    const instruction = "Rename the primary action label to “Send now”";
    const first = await interpretSemanticEdit({ instruction, graph: demoGraph, screenId: "payment-request" });
    const second = await interpretSemanticEdit({ instruction, graph: demoGraph, screenId: "payment-request" });

    expect(first.patch).toEqual(second.patch);
    expect(semanticDiff(demoGraph, first.graph)).toEqual([
      {
        path: "payment-request.confirm.intent.label",
        before: "Confirm request",
        after: "Send now",
      },
    ]);
  });

  it("retries a schema-valid patch when its stable target is not in the graph", async () => {
    let calls = 0;
    const generate: StructuredGenerator = async () => {
      calls += 1;
      return {
        id: `edit-${calls}`,
        output: {
          id: `patch-${calls}`,
          rationale: "Rename the primary action",
          operations: [{
            op: "set-label",
            target: calls === 1 ? "missing.node" : "payment-request.confirm",
            label: "Review transfer",
          }],
        },
      };
    };

    const result = await interpretSemanticEdit({ instruction: "Rename the primary action", graph: demoGraph, generate });
    expect(calls).toBe(2);
    expect(result.trace.attempts).toBe(2);
    expect(result.graph.screens[1]?.nodes.find((node) => node.id === "payment-request.confirm")?.intent.label).toBe("Review transfer");
  });
});
