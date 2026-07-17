import { describe, expect, it } from "vitest";
import { formatImportChangeValue, importChangeKind, summarizeImportChanges } from "./web-import-review";

describe("HTML/CSS import review model", () => {
  const changes = [
    { path: "old-node", before: { kind: "text" }, after: undefined },
    { path: "new-node", before: undefined, after: { kind: "stack" } },
    { path: "new-node.layout.gap", before: 8, after: 16 },
  ];

  it("classifies and summarizes exact semantic impact", () => {
    expect(changes.map(importChangeKind)).toEqual(["removed", "added", "updated"]);
    expect(summarizeImportChanges(changes)).toEqual({
      added: 1,
      removed: 1,
      updated: 1,
      total: 3,
      destructive: true,
    });
  });

  it("formats absent, scalar, and bounded structured values without ambiguity", () => {
    expect(formatImportChangeValue(undefined)).toBe("Not present");
    expect(formatImportChangeValue("Readable label")).toBe("Readable label");
    expect(formatImportChangeValue({ nested: [1, 2] })).toBe('{"nested":[1,2]}');
    expect(formatImportChangeValue("abcdefghij", 6)).toBe("abcde…");
  });
});
