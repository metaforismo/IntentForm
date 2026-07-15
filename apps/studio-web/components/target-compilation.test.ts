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

  it("generates the dedicated responsive-web target", () => {
    const graph = structuredClone(demoGraph);
    graph.platforms.push({ target: "web", enabled: true, capabilities: ["semantic-html", "responsive-layout"] });
    graph.web = {
      strategy: "responsive-web",
      defaultFrame: "desktop",
      frames: [{ id: "desktop", label: "Desktop", mode: "browser", width: 1440, height: 1000 }],
      breakpoints: [{ id: "large", label: "Large", minWidth: 0 }],
      contentMaxWidth: 1200,
      inlinePaddingToken: "space.20",
    };
    const result = compileStudioTarget(parseGraph(graph), "web");
    expect(result.status).toBe("generated");
    expect(result.output?.target).toBe("web");
    expect(result.output?.files.some((file) => file.path === "src/styles.css")).toBe(true);
  });
});
