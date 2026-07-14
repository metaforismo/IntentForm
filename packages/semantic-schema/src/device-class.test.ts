import { describe, expect, it } from "vitest";
import {
  CANONICAL_DEVICE_VIEWPORTS,
  classifyDevice,
} from "./index";

describe("shared device-class contract", () => {
  it.each([
    [{ width: 390, height: 701 }, "compact"],
    [{ width: 391, height: 700 }, "compact"],
    [{ width: 391, height: 701 }, "regular"],
    [{ width: 874, height: 402 }, "compact"],
  ] as const)("classifies %o as %s", (viewport, expected) => {
    expect(classifyDevice(viewport)).toBe(expected);
  });

  it("classifies every canonical viewport explicitly", () => {
    expect(classifyDevice(CANONICAL_DEVICE_VIEWPORTS.compactPhone)).toBe("compact");
    expect(classifyDevice(CANONICAL_DEVICE_VIEWPORTS.regularPhone)).toBe("regular");
    expect(classifyDevice(CANONICAL_DEVICE_VIEWPORTS.regularTablet)).toBe("regular");
  });

  it.each([
    { width: 0, height: 700 },
    { width: Number.NaN, height: 700 },
    { width: 390, height: Number.POSITIVE_INFINITY },
  ])("rejects an invalid viewport %o", (viewport) => {
    expect(() => classifyDevice(viewport)).toThrow("finite positive numbers");
  });
});
