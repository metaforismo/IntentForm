import { describe, expect, it } from "vitest";
import { demoGraph } from "@intentform/proof-report/demo";
import { parseGraph } from "@intentform/semantic-schema";
import { compileStudioTarget } from "./target-compilation";

describe("Studio target compilation", () => {
  it("generates enabled targets without changing compiler fingerprints", () => {
    const result = compileStudioTarget(demoGraph, "react");
    expect(result.status).toBe("generated");
    expect(result.output?.target).toBe("react");
    expect(result.output?.fingerprint).toMatch(/^[a-f0-9]{8}$/);
    expect(result.message).toBeNull();
  });

  it("reports a disabled target without throwing or fabricating output", () => {
    const disabled = structuredClone(demoGraph);
    disabled.platforms.find((platform) => platform.target === "react")!.enabled = false;
    const result = compileStudioTarget(parseGraph(disabled), "react");

    expect(result).toEqual({
      target: "react",
      status: "disabled",
      output: null,
      message: expect.stringMatching(/react target is not enabled/i),
    });
  });

  it("reports a target omitted by a valid graph as disabled", () => {
    const omitted = structuredClone(demoGraph);
    omitted.platforms = omitted.platforms.filter((platform) => platform.target !== "swiftui");
    const result = compileStudioTarget(parseGraph(omitted), "swiftui");

    expect(result.status).toBe("disabled");
    expect(result.output).toBeNull();
  });
});
