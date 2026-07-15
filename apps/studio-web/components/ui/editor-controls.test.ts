import { describe, expect, it } from "vitest";
import { numericStep } from "./editor-controls.tsx";

describe("numericStep", () => {
  it("supports editor keyboard increments in both directions", () => {
    expect(numericStep(-8, 1, 1, false, false)).toBe(-7);
    expect(numericStep(-8, -1, 1, true, false)).toBe(-18);
  });

  it("supports precision increments without floating-point drift", () => {
    expect(numericStep(0.2, 1, 1, false, true)).toBe(0.3);
    expect(numericStep(0.3, -1, 0.05, false, true)).toBe(0.295);
  });
});
