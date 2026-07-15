"use client";

import {
  ArrowLeft,
  ArrowRight,
  BracketsCurly,
  Browser,
  BookOpen,
  Check,
  Cube,
  DotsThree,
  FileArrowUp,
  FolderOpen,
  Gear,
  HardDrives,
  List,
  Plus,
  SquaresFour,
  Sparkle,
  ClockCounterClockwise,
  House,
  MagnifyingGlass,
  Warning,
  X,
} from "@phosphor-icons/react";
import { parseGraph, type SemanticInterfaceGraph } from "@intentform/semantic-schema";
import { previewGraphMigration } from "@intentform/semantic-schema/migrations";
import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  clearBrowserProject,
  loadBrowserProject,
  saveBrowserProject,
  type BrowserProjectLoadResult,
  type BrowserProjectMetadata,
  type ProjectType,
} from "../lib/browser-projects";
import { createStarterGraph, projectExamples } from "../lib/project-starters";
import { filterProjectExamples, projectMatchesQuery, type LauncherSection } from "../lib/launcher-model";

const MAX_IMPORT_BYTES = 512_000;

type LauncherView = "projects" | "new";
type CatalogView = "grid" | "list";
type BridgeStatus = "checking" | "available" | "unavailable";

interface LocalMigrationState {
  sourceFingerprint: string;
  fromVersion: string;
  toVersion: string;
  diagnostics: Array<{ severity: string; code: string; path: string; message: string }>;
}

const projectTypeOptions: Array<{ id: ProjectType; label: string; detail: string; icon: typeof Cube }> = [
  { id: "application", label: "Application", detail: "A product workflow with screens, state, data, and platform output.", icon: BracketsCurly },
  { id: "prototype", label: "Prototype", detail: "A focused concept intended for fast semantic iteration and testing.", icon: Sparkle },
  { id: "component-library", label: "Component library", detail: "A reusable catalog of intent roles, tokens, and variants.", icon: Cube },
  { id: "responsive-web", label: "Responsive web", detail: "A semantic site or web app with intrinsic layout and declared breakpoints.", icon: Browser },
];

function validationMessage(error: unknown): string {
  if (error && typeof error === "object" && "issues" in error && Array.isArray((error as { issues?: unknown }).issues)) {
    const issues = (error as { issues: Array<{ path?: PropertyKey[]; message?: string }> }).issues.slice(0, 4);
    return issues.map((issue) => `${issue.path?.length ? `${issue.path.join(".")}: ` : ""}${issue.message ?? "Invalid value"}`).join(" · ");
  }
  return error instanceof Error ? error.message.slice(0, 500) : "The project could not be validated.";
}

function projectTypeLabel(projectType: ProjectType): string {
  if (projectType === "component-library") return "Component library";
  if (projectType === "responsive-web") return "Responsive web";
  return projectType[0]!.toUpperCase() + projectType.slice(1);
}

const inferredProjectType = (graph: SemanticInterfaceGraph): ProjectType => graph.web ? "responsive-web" : "application";

function ProjectThumbnail({ graph }: { graph: SemanticInterfaceGraph }) {
  const mode = graph.tokens.modes[graph.tokens.activeMode] ?? graph.tokens.modes[graph.tokens.defaultMode];
  const colors = mode?.values.colors ?? {};
  const accent = colors["color.accent"] ?? "#3478e5";
  const ink = colors["color.ink"] ?? "#202020";
  const canvas = colors["color.canvas"] ?? "#eeeeec";
  const surface = colors["color.surface"] ?? "#ffffff";
  return (
    <span className="relative block aspect-[16/10] overflow-hidden rounded-t-[8px] border-b border-[var(--if-border-subtle)]" style={{ color: ink, background: canvas }} aria-hidden="true">
      <span className="absolute inset-x-[8%] top-[10%] flex h-[8%] items-center justify-between">
        <span className="h-1.5 w-[22%] rounded-sm" style={{ background: ink, opacity: 0.72 }} />
        <span className="h-1.5 w-[12%] rounded-sm" style={{ background: accent, opacity: 0.78 }} />
      </span>
      <span className="absolute inset-x-[8%] top-[26%] grid h-[61%] grid-cols-[1.2fr_.8fr] gap-[5%]">
        <span className="grid content-between rounded-[5px] p-[9%]" style={{ background: surface }}>
          <span className="grid gap-1.5"><span className="h-2 w-[68%] rounded-sm" style={{ background: ink, opacity: 0.84 }} /><span className="h-1.5 w-[88%] rounded-sm" style={{ background: ink, opacity: 0.2 }} /><span className="h-1.5 w-[56%] rounded-sm" style={{ background: ink, opacity: 0.16 }} /></span>
          <span className="h-4 w-[46%] rounded-[4px]" style={{ background: accent }} />
        </span>
        <span className="grid grid-rows-[1fr_.65fr] gap-[8%]"><span className="rounded-[5px]" style={{ background: accent, opacity: 0.72 }} /><span className="rounded-[5px]" style={{ background: surface }} /></span>
      </span>
    </span>
  );
}

export function Launcher() {
  const router = useRouter();
  const importInput = useRef<HTMLInputElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<LauncherView>("projects");
  const [catalogView, setCatalogView] = useState<CatalogView>("grid");
  const [section, setSection] = useState<LauncherSection>("recents");
  const [projectQuery, setProjectQuery] = useState("");
  const [recovery, setRecovery] = useState<BrowserProjectLoadResult | null>(null);
  const [bridge, setBridge] = useState<BridgeStatus>("checking");
  const [localMigration, setLocalMigration] = useState<LocalMigrationState | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [projectType, setProjectType] = useState<ProjectType>("application");
  const [name, setName] = useState("");
  const [audience, setAudience] = useState("");
  const [purpose, setPurpose] = useState("");
  const [reactTarget, setReactTarget] = useState(true);
  const [swiftTarget, setSwiftTarget] = useState(true);
  const [expoTarget, setExpoTarget] = useState(true);
  const [webTarget, setWebTarget] = useState(true);
  const [startFrom, setStartFrom] = useState<"empty" | "patterns" | "example">("empty");
  const [projectTheme, setProjectTheme] = useState<"light" | "dark" | "both">("both");

  useEffect(() => {
    try {
      setRecovery(loadBrowserProject(window.localStorage));
    } catch {
      setRecovery({ status: "invalid", message: "Browser recovery storage is unavailable in this context." });
    }
    const controller = new AbortController();
    void fetch("/api/project?capability=1", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const result = await response.json() as { available?: unknown };
        setBridge(result.available === true ? "available" : "unavailable");
      })
      .catch(() => {
        if (!controller.signal.aborted) setBridge("unavailable");
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key === "k") {
        event.preventDefault();
        searchInput.current?.focus();
      } else if (key === "n") {
        event.preventDefault();
        setView("new");
      } else if (key === "o") {
        event.preventDefault();
        importInput.current?.click();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const persistAndOpen = (
    graph: SemanticInterfaceGraph,
    metadata: BrowserProjectMetadata,
    operationId: string,
  ) => {
    setOpening(operationId);
    setError(null);
    try {
      const saved = saveBrowserProject(window.localStorage, graph, metadata);
      if (!saved.ok) {
        setOpening(null);
        setError(saved.message);
        return;
      }
      router.push("/studio");
    } catch (cause) {
      setOpening(null);
      setError(validationMessage(cause));
    }
  };

  const openLocalProject = () => {
    setOpening("local");
    setError(null);
    void (async () => {
      try {
        const response = await fetch("/api/project", { cache: "no-store" });
        const result = (await response.json()) as {
          error?: string;
          graph?: unknown;
          fingerprint?: string;
          migration?: LocalMigrationState;
        };
        if (response.status === 409 && result.migration) {
          setOpening(null);
          setLocalMigration(result.migration);
          return;
        }
        if (!response.ok || !result.graph || typeof result.fingerprint !== "string") {
          throw new Error(result.error ?? "No local .intentform project is available.");
        }
        const graph = parseGraph(result.graph);
        setLocalMigration(null);
        persistAndOpen(graph, {
          projectType: inferredProjectType(graph),
          source: "local",
          localFingerprint: result.fingerprint,
        }, "local");
      } catch (cause) {
        setOpening(null);
        setError(validationMessage(cause));
      }
    })();
  };

  const applyLocalMigration = () => {
    if (!localMigration) return;
    setOpening("migration");
    setError(null);
    void (async () => {
      try {
        const response = await fetch("/api/project", {
          method: "POST",
          cache: "no-store",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ expectedSourceFingerprint: localMigration.sourceFingerprint }),
        });
        const result = await response.json() as { error?: string; graph?: unknown; fingerprint?: string };
        if (!response.ok || !result.graph || typeof result.fingerprint !== "string") {
          throw new Error(result.error ?? "The local project could not be migrated.");
        }
        const graph = parseGraph(result.graph);
        setLocalMigration(null);
        persistAndOpen(graph, {
          projectType: inferredProjectType(graph),
          source: "local",
          localFingerprint: result.fingerprint,
        }, "migration");
      } catch (cause) {
        setOpening(null);
        setLocalMigration(null);
        setError(`${validationMessage(cause)} Open the local project again to refresh its migration preview.`);
      }
    })();
  };

  const createProject = (event: FormEvent) => {
    event.preventDefault();
    try {
      const targets = [reactTarget ? "react" : null, swiftTarget ? "swiftui" : null, expoTarget ? "expo" : null, projectType === "responsive-web" && webTarget ? "web" : null]
        .filter((target): target is "react" | "swiftui" | "expo" | "web" => target !== null);
      const graph = createStarterGraph({ name, audience, purpose, projectType, targets, startFrom, theme: projectTheme });
      persistAndOpen(graph, { projectType, source: "created" }, "create");
    } catch (cause) {
      setError(validationMessage(cause));
    }
  };

  const importProject = (file: File | undefined) => {
    if (!file) return;
    setOpening("import");
    setError(null);
    void (async () => {
      try {
        if (file.size > MAX_IMPORT_BYTES) throw new Error("The project file is larger than the 512 KB import limit.");
        const graph = previewGraphMigration(JSON.parse(await file.text())).graph;
        persistAndOpen(graph, { projectType: inferredProjectType(graph), source: "imported" }, "import");
      } catch (cause) {
        setOpening(null);
        setError(`Import failed: ${validationMessage(cause)}`);
      } finally {
        if (importInput.current) importInput.current.value = "";
      }
    })();
  };

  const discardRecovery = () => {
    try {
      clearBrowserProject(window.localStorage);
      setRecovery({ status: "empty" });
      setError(null);
    } catch {
      setError("The browser blocked removal of the recovery project.");
    }
  };

  const visibleExamples = filterProjectExamples(projectExamples, projectQuery);
  const recoveryMatches = recovery?.status === "ready"
    ? projectMatchesQuery(projectQuery, [recovery.project.graph.product.name, recovery.project.projectType, recovery.project.source])
    : projectQuery.trim().length === 0;
  const showRecents = section !== "examples";
  const showExamples = section !== "recents";

  const selectSection = (next: LauncherSection) => {
    setView("projects");
    setSection(next);
    setError(null);
  };

  return (
    <main className="studio-grain flex min-h-[100dvh] text-[var(--if-text)]">
      <input ref={importInput} type="file" accept="application/json,.json,.intentform" onChange={(event) => importProject(event.target.files?.[0])} className="sr-only" aria-label="Import IntentForm project" />
      <aside className="hidden w-[232px] shrink-0 flex-col border-r border-[var(--if-border-subtle)] bg-[var(--if-panel)] p-3 lg:flex" aria-label="Project launcher navigation">
        <div className="flex h-10 items-center gap-2 px-2"><span className="grid size-6 place-items-center rounded-md bg-[var(--if-blue)] text-white"><BracketsCurly size={13} weight="bold" /></span><strong className="text-[13px] font-semibold">IntentForm</strong></div>
        <nav className="mt-5 grid gap-0.5 text-[12px]">
          {([
            { id: "recents", label: "Recents", icon: ClockCounterClockwise },
            { id: "projects", label: "Projects", icon: House },
            { id: "examples", label: "Examples", icon: Sparkle },
          ] satisfies Array<{ id: LauncherSection; label: string; icon: typeof House }>).map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" aria-current={section === id ? "page" : undefined} onClick={() => selectSection(id)} className={`flex h-8 items-center gap-2 rounded-md px-2 text-left ${section === id ? "bg-[var(--if-pressed)] text-[var(--if-text)]" : "text-[var(--if-text-secondary)] hover:bg-[var(--if-hover)] hover:text-[var(--if-text)]"}`}><Icon size={15} /><span>{label}</span></button>
          ))}
        </nav>
        <div className="my-4 border-t border-[var(--if-border-subtle)]" />
        <nav className="grid gap-0.5 text-[12px]">
          <button type="button" onClick={() => importInput.current?.click()} className="flex h-8 items-center gap-2 rounded-md px-2 text-left text-[var(--if-text-secondary)] hover:bg-[var(--if-hover)] hover:text-[var(--if-text)]"><FolderOpen size={15} /> Files</button>
          <button type="button" onClick={() => selectSection("examples")} className="flex h-8 items-center gap-2 rounded-md px-2 text-left text-[var(--if-text-secondary)] hover:bg-[var(--if-hover)] hover:text-[var(--if-text)]"><BookOpen size={15} /> Learn</button>
          <button type="button" disabled className="flex h-8 items-center gap-2 rounded-md px-2 text-left text-[var(--if-text-disabled)]"><Gear size={15} /> Settings</button>
        </nav>
        <div className="mt-auto border-t border-[var(--if-border-subtle)] px-2 pt-3">
          <div className="flex items-center gap-2 text-[11px] font-medium"><span className={`size-1.5 rounded-full ${bridge === "available" ? "bg-[var(--if-green)]" : "bg-[var(--if-text-tertiary)]"}`} />{bridge === "available" ? "Agent bridge connected" : "Browser workspace"}</div>
          <p className="mt-1 text-[10px] leading-relaxed text-[var(--if-text-tertiary)]">Local-first · no account required</p>
        </div>
      </aside>

      <section className="min-w-0 flex-1 bg-[var(--if-app)]">
        <header className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-b border-[var(--if-border-subtle)] bg-[var(--if-panel)] px-4 py-2 sm:px-6 lg:px-8">
          <h1 className="text-[22px] font-semibold leading-7 tracking-[-.025em]">{section === "examples" ? "Examples" : section === "projects" ? "Projects" : "Recents"}</h1>
          <nav aria-label="Project sections" className="order-3 flex w-full items-center gap-1 border-t border-[var(--if-border-subtle)] pt-2 lg:hidden">
            {(["recents", "projects", "examples"] as const).map((id) => <button key={id} type="button" aria-current={section === id ? "page" : undefined} onClick={() => selectSection(id)} className={`h-7 rounded-md px-2.5 text-[11px] font-medium ${section === id ? "bg-[var(--if-pressed)] text-[var(--if-text)]" : "text-[var(--if-text-secondary)] hover:bg-[var(--if-hover)]"}`}>{id[0]!.toUpperCase() + id.slice(1)}</button>)}
          </nav>
          <div className="flex min-w-0 items-center gap-2">
            <div className="hidden rounded-md border border-[var(--if-border)] bg-[var(--if-input)] p-0.5 sm:flex" aria-label="Project view">
              <button type="button" aria-label="Grid view" aria-pressed={catalogView === "grid"} onClick={() => setCatalogView("grid")} className={`grid size-7 place-items-center rounded-[4px] ${catalogView === "grid" ? "bg-[var(--if-pressed)] text-[var(--if-text)]" : "text-[var(--if-text-secondary)] hover:bg-[var(--if-hover)]"}`}><SquaresFour size={14} /></button>
              <button type="button" aria-label="List view" aria-pressed={catalogView === "list"} onClick={() => setCatalogView("list")} className={`grid size-7 place-items-center rounded-[4px] ${catalogView === "list" ? "bg-[var(--if-pressed)] text-[var(--if-text)]" : "text-[var(--if-text-secondary)] hover:bg-[var(--if-hover)]"}`}><List size={14} /></button>
            </div>
            <label className="relative"><MagnifyingGlass size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--if-text-tertiary)]" /><input ref={searchInput} value={projectQuery} onChange={(event) => { setProjectQuery(event.target.value); if (event.target.value.trim()) setSection("projects"); }} aria-label="Search projects" placeholder="Search" className="h-8 w-32 rounded-md border border-[var(--if-border)] bg-[var(--if-input)] pl-8 pr-2 text-[11px] outline-none focus:border-[var(--if-blue)] sm:w-56" /></label>
            <button type="button" onClick={openLocalProject} disabled={bridge !== "available" || opening !== null} className="hidden h-8 items-center gap-1.5 rounded-md border border-[var(--if-border)] bg-[var(--if-raised)] px-3 text-[11px] font-medium hover:bg-[var(--if-hover)] disabled:opacity-45 sm:inline-flex"><FolderOpen size={13} /> Open project</button>
            <button type="button" onClick={() => { setView("new"); setError(null); }} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--if-blue)] px-3 text-[11px] font-semibold text-white hover:bg-[var(--if-blue-hover)]"><Plus size={13} /> New file</button>
          </div>
        </header>

        <div className="mx-auto max-w-[1440px] p-4 sm:p-6 lg:p-8">
          {error ? <div role="alert" className="mb-5 flex items-start gap-3 rounded-lg border border-[var(--if-red)] bg-[var(--if-red-soft)] px-3 py-2.5 text-[12px]"><Warning size={15} weight="fill" className="mt-0.5 shrink-0 text-[var(--if-red)]" /><span className="min-w-0 flex-1">{error}</span><button type="button" aria-label="Dismiss launcher error" onClick={() => setError(null)} className="rounded p-1 hover:bg-[var(--if-hover)]"><X size={13} /></button></div> : null}
          {localMigration ? <div role="status" className="mb-5 flex flex-wrap items-center gap-3 rounded-lg border border-[var(--if-amber)] bg-[var(--if-amber-soft)] px-3 py-2.5 text-[11px]"><Warning size={15} weight="fill" className="text-[var(--if-amber)]" /><span className="min-w-0 flex-1">Schema {localMigration.fromVersion} needs an atomic update to {localMigration.toVersion}.</span><button type="button" onClick={applyLocalMigration} disabled={opening !== null} className="rounded-md bg-[var(--if-amber)] px-3 py-1.5 font-semibold text-white">Checkpoint and update</button><button type="button" onClick={() => setLocalMigration(null)} className="rounded-md px-2 py-1.5 hover:bg-[var(--if-hover)]">Not now</button></div> : null}

          {showRecents ? <section aria-labelledby="recent-projects-title">
            <div className="mb-4 flex items-center justify-between"><div><h2 id="recent-projects-title" className="text-[13px] font-semibold">{section === "projects" ? "Recent projects" : "Recents"}</h2><p className="mt-0.5 text-[11px] text-[var(--if-text-secondary)]">Projects on this device</p></div>{recovery?.status === "ready" ? <button type="button" onClick={discardRecovery} className="text-[11px] text-[var(--if-text-secondary)] hover:text-[var(--if-red)]">Discard recovery</button> : null}</div>
            {recovery === null ? <div className="aspect-[16/10] max-w-80 animate-pulse rounded-lg bg-[var(--if-panel-alt)]" /> : recovery.status === "ready" && recoveryMatches ? (
              <div className={catalogView === "grid" ? "grid grid-cols-[repeat(auto-fill,minmax(260px,320px))] gap-5" : "grid gap-2"}>
                <button type="button" disabled={opening !== null} onClick={() => persistAndOpen(recovery.project.graph, { projectType: recovery.project.projectType, source: "recovery", ...(recovery.project.localFingerprint ? { localFingerprint: recovery.project.localFingerprint } : {}) }, "recovery")} className={`group overflow-hidden rounded-lg border border-[var(--if-border)] bg-[var(--if-panel)] text-left hover:border-[var(--if-blue)] disabled:opacity-60 ${catalogView === "list" ? "grid grid-cols-[112px_minmax(0,1fr)]" : ""}`}>
                  <ProjectThumbnail graph={recovery.project.graph} />
                  <span className="flex items-start gap-3 p-3"><span className="min-w-0 flex-1"><strong className="block truncate text-[13px] font-medium">{recovery.project.graph.product.name}</strong><span className="mt-1 block truncate text-[11px] text-[var(--if-text-secondary)]">{new Date(recovery.project.savedAt).toLocaleString()} · {projectTypeLabel(recovery.project.projectType)}</span><span className="mt-2 inline-flex items-center gap-1.5 text-[10px] text-[var(--if-amber)]"><span className="size-1.5 rounded-full bg-current" />Recovery available</span></span><DotsThree size={16} className="shrink-0 text-[var(--if-text-tertiary)]" /></span>
                </button>
              </div>
            ) : recovery.status === "invalid" && projectQuery.trim().length === 0 ? <div className="max-w-xl rounded-lg border border-[var(--if-amber)] bg-[var(--if-amber-soft)] p-4 text-[12px]"><strong>Recovery needs attention</strong><p className="mt-1 text-[var(--if-text-secondary)]">{recovery.message}</p><button type="button" onClick={discardRecovery} className="mt-3 rounded-md border border-[var(--if-border)] px-3 py-1.5 font-medium">Discard</button></div> : <div className="max-w-xl rounded-lg border border-dashed border-[var(--if-border)] px-5 py-8"><strong className="text-[13px]">{projectQuery.trim() ? `No recent project matches “${projectQuery.trim()}”` : "No recent projects"}</strong><p className="mt-1 text-[11px] text-[var(--if-text-secondary)]">Create a new project, open a local file, or explore an example.</p><div className="mt-4 flex gap-2"><button type="button" onClick={() => setView("new")} className="rounded-md bg-[var(--if-blue)] px-3 py-2 text-[11px] font-semibold text-white">New project</button><button type="button" onClick={() => importInput.current?.click()} className="rounded-md border border-[var(--if-border)] px-3 py-2 text-[11px] font-medium">Open project</button></div></div>}
          </section> : null}

          {showExamples ? <section aria-labelledby="example-projects-title" className={showRecents ? "mt-10 border-t border-[var(--if-border-subtle)] pt-7" : ""}>
            <div className="mb-4"><h2 id="example-projects-title" className="text-[13px] font-semibold">Working examples</h2><p className="mt-0.5 text-[11px] text-[var(--if-text-secondary)]">Open as a copy; source examples never change.</p></div>
            {visibleExamples.length > 0 ? <div className={catalogView === "grid" ? "grid grid-cols-[repeat(auto-fill,minmax(260px,320px))] gap-5" : "grid gap-2"}>
              {visibleExamples.map((example) => <button key={example.id} type="button" disabled={opening !== null} onClick={() => persistAndOpen(structuredClone(example.graph), { projectType: example.projectType, source: "example" }, example.id)} className={`group overflow-hidden rounded-lg border border-[var(--if-border)] bg-[var(--if-panel)] text-left hover:border-[var(--if-blue)] disabled:opacity-60 ${catalogView === "list" ? "grid grid-cols-[112px_minmax(0,1fr)]" : ""}`}><ProjectThumbnail graph={example.graph} /><span className="flex items-start gap-3 p-3"><span className="min-w-0 flex-1"><strong className="block truncate text-[13px] font-medium">{example.graph.product.name}</strong><span className="mt-1 block line-clamp-2 text-[11px] leading-4 text-[var(--if-text-secondary)]">{example.summary}</span><span className="mt-2 block font-mono text-[10px] text-[var(--if-text-tertiary)]">Example · {projectTypeLabel(example.projectType)}</span></span><ArrowRight size={14} className="mt-0.5 shrink-0 text-[var(--if-text-tertiary)] transition-transform group-hover:translate-x-0.5" /></span></button>)}
            </div> : <div role="status" className="rounded-lg border border-dashed border-[var(--if-border)] px-5 py-8 text-[12px]">No examples match “{projectQuery.trim()}”.</div>}
          </section> : null}
        </div>
      </section>

      {view === "new" ? <div className="fixed inset-0 z-20 grid place-items-center bg-[var(--backdrop)] p-4" onPointerDown={(event) => { if (event.target === event.currentTarget) setView("projects"); }}>
        <motion.form initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16, ease: [.2, .8, .2, 1] }} onSubmit={createProject} role="dialog" aria-modal="true" aria-labelledby="new-project-title" className="max-h-[calc(100dvh-32px)] w-full max-w-[640px] overflow-auto rounded-[10px] border border-[var(--if-border-strong)] bg-[var(--if-raised)] shadow-[var(--if-shadow-dialog)]">
          <header className="flex items-start justify-between border-b border-[var(--if-border-subtle)] p-5"><div><h2 id="new-project-title" className="text-[16px] font-semibold">New project</h2><p className="mt-1 text-[11px] text-[var(--if-text-secondary)]">Create a valid local-first semantic project.</p></div><button type="button" aria-label="Close new project" onClick={() => setView("projects")} className="grid size-7 place-items-center rounded-md text-[var(--if-text-secondary)] hover:bg-[var(--if-hover)]"><X size={14} /></button></header>
          <div className="space-y-5 p-5">
            <fieldset><legend className="text-[11px] font-medium">Project type</legend><div className="mt-2 grid gap-1 rounded-lg border border-[var(--if-border)] p-1">{projectTypeOptions.map((option) => { const Icon = option.icon; const selected = projectType === option.id; return <label key={option.id} className={`flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 ${selected ? "bg-[var(--if-blue-soft)]" : "hover:bg-[var(--if-hover)]"}`}><input type="radio" name="project-type" value={option.id} checked={selected} onChange={() => setProjectType(option.id)} className="sr-only" /><Icon size={15} className={selected ? "text-[var(--if-blue)]" : "text-[var(--if-text-secondary)]"} /><span className="min-w-0 flex-1"><strong className="block text-[12px] font-medium">{option.label}</strong><span className="block truncate text-[10px] text-[var(--if-text-secondary)]">{option.detail}</span></span>{selected ? <Check size={13} weight="bold" className="text-[var(--if-blue)]" /> : null}</label>; })}</div></fieldset>
            <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1.5 text-[11px] font-medium">Project name<input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="Northline Field Notes" className="h-9 rounded-md border border-[var(--if-border)] bg-[var(--if-input)] px-3 text-[12px] font-normal outline-none focus:border-[var(--if-blue)]" /></label><label className="grid gap-1.5 text-[11px] font-medium">Primary audience<input required maxLength={240} value={audience} onChange={(event) => setAudience(event.target.value)} placeholder="Distributed research teams" className="h-9 rounded-md border border-[var(--if-border)] bg-[var(--if-input)] px-3 text-[12px] font-normal outline-none focus:border-[var(--if-blue)]" /></label><label className="grid gap-1.5 text-[11px] font-medium sm:col-span-2">First outcome<textarea required minLength={3} maxLength={500} value={purpose} onChange={(event) => setPurpose(event.target.value)} placeholder="Review and organize field observations" className="min-h-20 resize-y rounded-md border border-[var(--if-border)] bg-[var(--if-input)] px-3 py-2 text-[12px] font-normal outline-none focus:border-[var(--if-blue)]" /></label></div>
            <fieldset><legend className="text-[11px] font-medium">Targets</legend><div className="mt-2 grid gap-1 sm:grid-cols-2">{[["React", reactTarget, setReactTarget], ["SwiftUI", swiftTarget, setSwiftTarget], ["Expo Adaptive", expoTarget, setExpoTarget]] .map(([label, checked, setter]) => <label key={String(label)} className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-[11px] hover:bg-[var(--if-hover)]"><input type="checkbox" checked={Boolean(checked)} onChange={(event) => (setter as (value: boolean) => void)(event.target.checked)} className="accent-[var(--if-blue)]" />{String(label)}</label>)}{projectType === "responsive-web" ? <label className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-[11px] hover:bg-[var(--if-hover)]"><input type="checkbox" checked={webTarget} onChange={(event) => setWebTarget(event.target.checked)} className="accent-[var(--if-blue)]" />Responsive web</label> : null}</div></fieldset>
            <div className="grid gap-3 sm:grid-cols-3"><label className="grid gap-1.5 text-[11px] font-medium">Starter<select value={startFrom} onChange={(event) => setStartFrom(event.target.value as typeof startFrom)} className="select-control h-9"><option value="empty">Empty</option><option value="patterns">Core patterns</option><option value="example">Example</option></select></label><label className="grid gap-1.5 text-[11px] font-medium">Theme<select value={projectTheme} onChange={(event) => setProjectTheme(event.target.value as typeof projectTheme)} className="select-control h-9"><option value="both">Light and dark</option><option value="light">Light</option><option value="dark">Dark</option></select></label><label className="grid gap-1.5 text-[11px] font-medium">Location<span className="flex h-9 items-center rounded-md border border-[var(--if-border)] bg-[var(--if-panel-alt)] px-3 text-[10px] font-normal text-[var(--if-text-secondary)]">Browser recovery</span></label></div>
          </div>
          <footer className="flex items-center justify-between gap-4 border-t border-[var(--if-border-subtle)] px-5 py-4"><span className="min-w-0 truncate text-[10px] text-[var(--if-text-secondary)]">{name.trim() || "Untitled project"} · {projectTypeLabel(projectType)} · {projectTheme}</span><div className="flex gap-2"><button type="button" onClick={() => setView("projects")} className="h-8 rounded-md px-3 text-[11px] font-medium hover:bg-[var(--if-hover)]">Cancel</button><button type="submit" disabled={opening !== null} className="h-8 rounded-md bg-[var(--if-blue)] px-4 text-[11px] font-semibold text-white hover:bg-[var(--if-blue-hover)] disabled:opacity-60">Create project</button></div></footer>
        </motion.form>
      </div> : null}
    </main>
  );
}
