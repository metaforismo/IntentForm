import { describe, expect, it } from "vitest";
import { filterProjectExamples, projectMatchesQuery } from "./launcher-model";
import { projectExamples } from "./project-starters";

describe("launcher model", () => {
  it("matches normalized multi-term queries across project metadata", () => {
    expect(projectMatchesQuery("creme FIELD", ["Crème Research", "Field notes"])).toBe(true);
    expect(projectMatchesQuery("field missing", ["Crème Research", "Field notes"])).toBe(false);
    expect(projectMatchesQuery("   ", ["Anything"])).toBe(true);
  });

  it("filters examples by label, summary, product, and project type", () => {
    expect(filterProjectExamples(projectExamples, "aster original").map((example) => example.id)).toEqual(["aster-sound"]);
    expect(filterProjectExamples(projectExamples, "component-library").map((example) => example.id)).toEqual(["foundry-mobile-kit"]);
    expect(filterProjectExamples(projectExamples, "no matching project")).toEqual([]);
  });
});
