import { describe, expect, it } from "vitest";
import { demoGraph } from "@intentform/proof-report/demo";
import { graphFingerprint as serverGraphFingerprint } from "@intentform/mcp-server/fingerprint";
import { graphFingerprint, hasUnsavedLocalChanges, serializedGraphFingerprint } from "./project-save-state";

describe("project save state", () => {
  it("matches the canonical local-project fingerprint algorithm", () => {
    expect(graphFingerprint(demoGraph)).toMatch(/^[a-f0-9]{8}$/);
    expect(graphFingerprint(demoGraph)).toBe(serverGraphFingerprint(demoGraph));
    expect(serializedGraphFingerprint("canonical input")).toBe("e9f1a78d");
  });

  it("reports dirty state only for a changed local project", () => {
    const fingerprint = graphFingerprint(demoGraph);
    expect(hasUnsavedLocalChanges(demoGraph, null)).toBe(false);
    expect(hasUnsavedLocalChanges(demoGraph, fingerprint)).toBe(false);

    const edited = structuredClone(demoGraph);
    edited.product.name = "Edited locally";
    expect(hasUnsavedLocalChanges(edited, fingerprint)).toBe(true);
    expect(hasUnsavedLocalChanges(edited, graphFingerprint(edited))).toBe(false);
  });
});
