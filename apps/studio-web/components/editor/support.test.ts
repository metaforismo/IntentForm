import { describe, expect, it } from "vitest";
import { demoGraph } from "../../../../packages/proof-report/src/demo";
import { classifyDevice, semanticDiff } from "@intentform/semantic-schema";
import { deviceProfiles, fixtureFor, withFixtureValue } from "./support";

describe("editor device profiles", () => {
  it("derives every breakpoint from the shared viewport contract", () => {
    for (const profile of deviceProfiles) {
      expect(profile.breakpoint).toBe(classifyDevice(profile));
      expect(profile.detail).toBe(`${profile.width} × ${profile.height}`);
    }
  });
});

describe("fixture editing", () => {
  it("creates a missing state fixture from idle data and keeps the state coherent", () => {
    const edited = withFixtureValue(demoGraph, "payment-request", "loading", "recipientName", "Elena Serra");
    const fixture = edited.fixtures.find((item) => item.id === "payment-request.loading");

    expect(fixture).toEqual({
      id: "payment-request.loading",
      screenId: "payment-request",
      state: "loading",
      data: { amount: "120.00", recipientName: "Elena Serra", status: "loading" },
    });
    expect(edited.contracts.find((item) => item.screenId === "payment-request")?.fixtures).toContain("payment-request.loading");
    expect(fixtureFor(edited, "payment-request", "loading").recipientName).toBe("Elena Serra");
    expect(demoGraph.fixtures.some((item) => item.id === "payment-request.loading")).toBe(false);
  });

  it("updates an existing fixture without changing unrelated states", () => {
    const edited = withFixtureValue(demoGraph, "payment-request", "failed", "amount", "318.40");
    expect(fixtureFor(edited, "payment-request", "failed").amount).toBe("318.40");
    expect(fixtureFor(edited, "payment-request", "idle").amount).toBe("120.00");
    expect(semanticDiff(demoGraph, edited)).toContainEqual({
      path: "fixtures.payment-request.failed.data.amount",
      before: "120.00",
      after: "318.40",
    });
  });

  it("rejects fields outside the screen contract atomically", () => {
    expect(() => withFixtureValue(demoGraph, "receipt", "completed", "secret", "value"))
      .toThrow("Unknown fixture field");
    expect(fixtureFor(demoGraph, "receipt", "completed")).not.toHaveProperty("secret");
  });

  it("keeps the status discriminator aligned with the selected visual state", () => {
    expect(() => withFixtureValue(demoGraph, "payment-request", "failed", "status", "loading"))
      .toThrow("Status fixture value must match its visual state");
    expect(fixtureFor(demoGraph, "payment-request", "failed").status).toBe("failed");
  });
});
