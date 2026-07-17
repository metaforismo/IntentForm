import type { SemanticInterfaceGraph } from "@intentform/semantic-schema";
import type { BrowserCatalogProject } from "./browser-project-catalog";
import type { ProjectType } from "./browser-projects";
import type { ProjectExample } from "./project-starters";

export type LauncherSection = "home" | "recents" | "projects" | "files" | "agents" | "builds" | "archive" | "examples" | "learn" | "settings";
export type CatalogSort = "modified" | "name" | "type" | "status";
export type CatalogTypeFilter = "all" | ProjectType;
export type CatalogPlatformFilter = "all" | "react" | "web" | "expo" | "swiftui";

export interface CatalogFilters {
  type: CatalogTypeFilter;
  platform: CatalogPlatformFilter;
  missingOnly: boolean;
}

function normalizeSearch(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase();
}

export function projectMatchesQuery(query: string, fields: Array<string | undefined>): boolean {
  const terms = normalizeSearch(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = normalizeSearch(fields.filter(Boolean).join(" "));
  return terms.every((term) => haystack.includes(term));
}

export function filterProjectExamples(examples: ProjectExample[], query: string): ProjectExample[] {
  return examples.filter((example) => projectMatchesQuery(query, [
    example.label,
    example.summary,
    example.graph.product.name,
    example.projectType,
  ]));
}

export function inferProjectType(graph: SemanticInterfaceGraph, declaredType?: unknown): ProjectType {
  if (declaredType === "application" || declaredType === "prototype" || declaredType === "component-library" || declaredType === "responsive-web") return declaredType;
  if (graph.web) return "responsive-web";
  if (graph.components.length > 0 && graph.screens.length <= 2) return "component-library";
  return "application";
}

export function projectSearchIndex(graph: SemanticInterfaceGraph, tags: string[] = [], folder?: string): string[] {
  return [
    graph.product.name,
    ...graph.screens.map((screen) => screen.title),
    ...graph.platforms.filter((platform) => platform.enabled).map((platform) => platform.target),
    ...tags,
    ...(folder ? [folder] : []),
  ].slice(0, 128);
}

function projectStatusRank(project: BrowserCatalogProject): number {
  if (project.missingLocalPath) return 0;
  if (project.archivedAt) return 1;
  return 2;
}

export function filterAndSortProjects(
  projects: BrowserCatalogProject[],
  query: string,
  filters: CatalogFilters,
  sort: CatalogSort,
): BrowserCatalogProject[] {
  const visible = projects.filter((project) => {
    if (filters.type !== "all" && project.projectType !== filters.type) return false;
    if (filters.platform !== "all" && !project.graph.platforms.some((platform) => platform.enabled && platform.target === filters.platform)) return false;
    if (filters.missingOnly && !project.missingLocalPath) return false;
    return projectMatchesQuery(query, [project.name, project.projectType, project.source, ...project.searchIndex]);
  });
  return [...visible].sort((left, right) => {
    if (sort === "name") return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
    if (sort === "type") return left.projectType.localeCompare(right.projectType) || left.name.localeCompare(right.name);
    if (sort === "status") return projectStatusRank(left) - projectStatusRank(right) || right.updatedAt.localeCompare(left.updatedAt);
    return right.lastOpenedAt.localeCompare(left.lastOpenedAt);
  });
}
