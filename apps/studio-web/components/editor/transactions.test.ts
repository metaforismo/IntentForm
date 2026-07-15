import { describe, expect, it } from "vitest";
import { demoGraph } from "@intentform/proof-report/demo";
import { stableSerialize } from "@intentform/semantic-schema";
import {
  applyEditorTransaction,
  duplicateScreenTransaction,
  editorTransactionError,
  insertionStateBindings,
} from "./transactions";

describe("editor transactions", () => {
  it("duplicates a contracted screen with remapped node and fixture references", () => {
    const result = duplicateScreenTransaction(demoGraph, "payment-request");
    const screen = result.graph.screens.find((item) => item.id === result.screenId);
    const contract = result.graph.contracts.find((item) => item.screenId === result.screenId);
    const fixtures = result.graph.fixtures.filter((item) => item.screenId === result.screenId);

    expect(result.screenId).toBe("payment-request-copy");
    expect(screen?.nodes.every((node) => node.id.startsWith("payment-request-copy."))).toBe(true);
    expect(contract?.fixtures).toEqual(fixtures.map((fixture) => fixture.id));
    expect(contract?.fixtures.every((id) => id.startsWith("payment-request-copy."))).toBe(true);
    expect(contract?.fixtures).not.toContain("payment-request.idle");
  });

  it("allocates independent references for repeated screen copies", () => {
    const first = duplicateScreenTransaction(demoGraph, "payment-request");
    const second = duplicateScreenTransaction(first.graph, "payment-request");
    const contract = second.graph.contracts.find((item) => item.screenId === second.screenId);

    expect(second.screenId).toBe("payment-request-copy-2");
    expect(contract?.fixtures).toEqual([
      "payment-request-copy-2.idle",
      "payment-request-copy-2.failed",
    ]);
    expect(new Set(second.graph.screens.flatMap((screen) => screen.nodes.map((node) => node.id))).size)
      .toBe(second.graph.screens.flatMap((screen) => screen.nodes).length);
  });

  it("rejects an invalid draft without mutating the canonical input", () => {
    const before = stableSerialize(demoGraph);

    expect(() => applyEditorTransaction(demoGraph, (draft) => {
      const screen = draft.screens.find((item) => item.id === "payment-request")!;
      const primary = structuredClone(screen.nodes.find((node) => node.kind === "primary-action")!);
      primary.id = "payment-request.second-primary";
      screen.nodes.push(primary);
    })).toThrow(/more than one primary action/);

    expect(stableSerialize(demoGraph)).toBe(before);
  });

  it("scopes new layers to the active non-idle state", () => {
    expect(insertionStateBindings("idle")).toEqual([]);
    expect(insertionStateBindings("failed")).toEqual([{ name: "failed" }]);
    expect(insertionStateBindings("completed")).toEqual([{ name: "completed" }]);
  });

  it("turns validation failures into concise atomicity diagnostics", () => {
    const message = editorTransactionError(new Error("Screen payment-request has more than one primary action"));
    expect(message).toBe("Edit rejected: Screen payment-request has more than one primary action. No changes were saved.");
  });
});
