import { describe, expect, it } from "vitest";
import { createCatalogProject } from "./browser-project-catalog";
import { filterAndSortProjects, filterProjectExamples, inferProjectType, projectMatchesQuery, projectSearchIndex } from "./launcher-model";
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

  it("preserves declared project identity and uses bounded structural fallbacks", () => {
    const application = projectExamples.find((example) => example.projectType === "application")!;
    const responsive = projectExamples.find((example) => example.projectType === "responsive-web")!;
    const library = projectExamples.find((example) => example.projectType === "component-library")!;
    expect(inferProjectType(application.graph, "prototype")).toBe("prototype");
    expect(inferProjectType(responsive.graph)).toBe("responsive-web");
    expect(inferProjectType(library.graph, library.projectType)).toBe("component-library");
    expect(projectSearchIndex(application.graph, ["Research"], "Field work")).toContain("Research");
  });

  it("sorts and filters bounded catalog metadata without walking the graph", () => {
    const firstExample = projectExamples[0]!;
    const secondExample = projectExamples[1]!;
    const first = createCatalogProject(firstExample.graph, { projectType: firstExample.projectType, source: "example" }, "2026-07-16T10:00:00.000Z", "first");
    const second = createCatalogProject(secondExample.graph, { projectType: secondExample.projectType, source: "example" }, "2026-07-16T11:00:00.000Z", "second");
    const projects = [first, { ...second, tags: ["Priority"], searchIndex: [...second.searchIndex, "Priority"] }];
    expect(filterAndSortProjects(projects, "priority", { type: "all", platform: "all", missingOnly: false }, "modified").map((project) => project.id)).toEqual(["second"]);
    expect(filterAndSortProjects(projects, "", { type: "all", platform: "all", missingOnly: false }, "name").map((project) => project.name)).toEqual([...projects.map((project) => project.name)].sort());
  });
});
