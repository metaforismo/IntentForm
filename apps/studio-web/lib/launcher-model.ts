import type { ProjectExample } from "./project-starters";

export type LauncherSection = "projects" | "recents" | "examples";

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
