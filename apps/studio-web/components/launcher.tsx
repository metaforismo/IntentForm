"use client";

import {
  ArrowLeft,
  ArrowRight,
  BracketsCurly,
  Browser,
  Check,
  Code,
  Cube,
  FileArrowUp,
  FolderOpen,
  HardDrives,
  Plus,
  ShieldCheck,
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

export function Launcher() {
  const router = useRouter();
  const importInput = useRef<HTMLInputElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<LauncherView>("projects");
  const [section, setSection] = useState<LauncherSection>("projects");
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
    <main className="studio-grain flex min-h-[100dvh] bg-[var(--surface)] text-[var(--ink)]">
      <aside className="hidden w-[248px] shrink-0 flex-col border-r border-[var(--line)] bg-[var(--chrome)] p-3 lg:flex" aria-label="Project launcher navigation">
        <div className="flex h-11 items-center gap-2.5 px-2">
          <span className="grid size-7 place-items-center rounded-lg bg-[var(--select)] text-white"><BracketsCurly size={14} weight="bold" /></span>
          <strong className="text-[13px] tracking-[-.025em]">IntentForm</strong>
        </div>
        <nav className="mt-5 grid gap-1 text-[12px]">
          {([
            { id: "projects", label: "Projects", icon: House },
            { id: "recents", label: "Recents", icon: ClockCounterClockwise },
            { id: "examples", label: "Examples", icon: Sparkle },
          ] satisfies Array<{ id: LauncherSection; label: string; icon: typeof House }>).map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" aria-current={section === id ? "page" : undefined} onClick={() => selectSection(id)} className={`flex h-8 items-center gap-2 rounded-[7px] px-2 text-left ${section === id ? "bg-[var(--control-active,var(--hover))] text-[var(--ink)]" : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"}`}>
              <Icon size={15} /><span>{label}</span>
            </button>
          ))}
        </nav>
        <span className="mt-6 px-2 text-[10px] font-semibold uppercase tracking-[.1em] text-[var(--faint)]">Workspace</span>
        <nav className="mt-2 grid gap-1 text-[12px]">
          <button type="button" onClick={() => importInput.current?.click()} className="flex h-8 items-center gap-2 rounded-[7px] px-2 text-left text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"><FolderOpen size={15} /> Files</button>
        </nav>
        <div className="mt-auto rounded-[9px] border border-[var(--line)] bg-[var(--field)] p-3">
          <div className="flex items-center gap-2 text-[11px] font-medium"><span className={`size-1.5 rounded-full ${bridge === "available" ? "bg-[var(--success,#55c58b)]" : "bg-[var(--text-muted,var(--faint))]"}`} />{bridge === "available" ? "Agent bridge ready" : "Local workspace"}</div>
          <p className="mt-1.5 text-[10px] leading-relaxed text-[var(--muted)]">No account required. Files stay on this device.</p>
        </div>
      </aside>
      <div className="mx-auto flex min-h-[100dvh] min-w-0 max-w-[1400px] flex-1 flex-col px-4 py-5 sm:px-7 lg:px-8">
        <header className="flex items-center justify-between border-b border-[var(--line)] pb-5">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-[13px] bg-[var(--accent-deep)] text-white shadow-[inset_0_1px_0_var(--float-inset)]">
              <BracketsCurly size={19} weight="bold" />
            </span>
            <div>
              <strong className="block text-[15px] tracking-[-.03em]">IntentForm</strong>
              <span className="block font-mono text-[10px] text-[var(--faint)]">Local-first interface compiler</span>
            </div>
          </div>
          <div className="hidden items-center gap-2 text-[10px] text-[var(--muted)] sm:flex" aria-label="Workspace capabilities">
            <label className="relative hidden xl:block"><MagnifyingGlass size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2" /><input ref={searchInput} value={projectQuery} onChange={(event) => { setProjectQuery(event.target.value); selectSection("projects"); }} aria-label="Search projects" placeholder="Search projects" className="h-8 w-48 rounded-[7px] border border-[var(--line)] bg-[var(--field)] pl-8 pr-3 outline-none focus:border-[var(--select)]" /></label>
            <span className="inline-flex items-center gap-1.5"><Code size={13} /> React + SwiftUI + Expo</span>
            <span className="inline-flex items-center gap-1.5"><ShieldCheck size={13} /> Validated graph</span>
            <span className="inline-flex items-center gap-1.5">
              <span className={`size-1.5 rounded-full ${bridge === "available" ? "bg-emerald-500" : bridge === "checking" ? "animate-pulse bg-amber-500" : "bg-[var(--faint)]"}`} />
              {bridge === "available" ? "Agent bridge available" : bridge === "checking" ? "Checking local bridge" : "Browser workspace"}
            </span>
          </div>
        </header>

        {error ? (
          <div role="alert" className="mt-5 flex items-start gap-3 rounded-2xl border border-red-300/45 bg-red-50 px-4 py-3 text-sm text-red-950">
            <Warning size={17} weight="fill" className="mt-0.5 shrink-0 text-red-600" />
            <span className="min-w-0 flex-1 leading-relaxed">{error}</span>
            <button type="button" aria-label="Dismiss launcher error" onClick={() => setError(null)} className="rounded-lg p-1 text-red-800 hover:bg-red-100"><X size={14} /></button>
          </div>
        ) : null}

        {view === "new" ? (
          <motion.section initial={{ opacity: 0, x: 18 }} animate={{ opacity: 1, x: 0 }} transition={{ type: "spring", stiffness: 120, damping: 20 }} className="grid flex-1 items-start gap-10 py-10 lg:grid-cols-[minmax(0,.76fr)_minmax(520px,1.24fr)] lg:py-16">
            <div className="max-w-lg">
              <button type="button" onClick={() => { setView("projects"); setError(null); }} className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--muted)] hover:text-[var(--ink)]"><ArrowLeft size={14} /> Back to projects</button>
              <span className="mt-12 block font-mono text-[10px] uppercase tracking-[.16em] text-[var(--accent)]">New local project</span>
              <h1 className="mt-4 text-4xl font-semibold leading-[.98] tracking-[-.065em] md:text-5xl">Begin with product intent, not a sample file.</h1>
              <p className="mt-6 max-w-[52ch] text-sm leading-relaxed text-[var(--muted)]">These answers create a small, valid semantic canvas. No generated code, cloud account, or model call is required.</p>
            </div>
            <form onSubmit={createProject} className="rounded-[28px] border border-[var(--line)] bg-[var(--surface-strong)] p-5 shadow-[0_24px_60px_-45px_var(--shadow-strong)] sm:p-7">
              <fieldset>
                <legend className="text-xs font-semibold text-[var(--ink)]">What are you designing?</legend>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  {projectTypeOptions.map((option) => {
                    const Icon = option.icon;
                    const selected = projectType === option.id;
                    return (
                      <label key={option.id} className={`relative cursor-pointer rounded-2xl border p-3 transition-[border,background,transform] active:scale-[.99] ${selected ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--line)] bg-[var(--field)] hover:border-[var(--accent)]"}`}>
                        <input type="radio" name="project-type" value={option.id} checked={selected} onChange={() => setProjectType(option.id)} className="sr-only" />
                        <span className="flex items-center justify-between"><Icon size={16} className="text-[var(--accent)]" />{selected ? <Check size={13} weight="bold" className="text-[var(--accent)]" /> : null}</span>
                        <strong className="mt-5 block text-[12px]">{option.label}</strong>
                        <span className="mt-1 block text-[10px] leading-relaxed text-[var(--muted)]">{option.detail}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <label className="grid gap-2 text-xs font-semibold">Project name<input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="Northline Field Notes" className="rounded-xl border border-[var(--line)] bg-[var(--field)] px-3.5 py-3 text-sm font-normal outline-none focus:border-[var(--accent)]" /></label>
                <label className="grid gap-2 text-xs font-semibold">Primary audience<input required maxLength={240} value={audience} onChange={(event) => setAudience(event.target.value)} placeholder="Distributed research teams" className="rounded-xl border border-[var(--line)] bg-[var(--field)] px-3.5 py-3 text-sm font-normal outline-none focus:border-[var(--accent)]" /></label>
                <label className="grid gap-2 text-xs font-semibold sm:col-span-2">First outcome<textarea required minLength={3} maxLength={500} value={purpose} onChange={(event) => setPurpose(event.target.value)} placeholder="Review and organize field observations" className="min-h-24 resize-y rounded-xl border border-[var(--line)] bg-[var(--field)] px-3.5 py-3 text-sm font-normal leading-relaxed outline-none focus:border-[var(--accent)]" /></label>
              </div>
              <fieldset className="mt-5">
                <legend className="text-xs font-semibold">Compiler targets</legend>
                <div className="mt-2 flex flex-wrap gap-2">
                  <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--field)] px-3 text-xs"><input type="checkbox" checked={reactTarget} onChange={(event) => setReactTarget(event.target.checked)} className="accent-[var(--accent)]" /> React</label>
                  <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--field)] px-3 text-xs"><input type="checkbox" checked={swiftTarget} onChange={(event) => setSwiftTarget(event.target.checked)} className="accent-[var(--accent)]" /> SwiftUI</label>
                  <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--field)] px-3 text-xs"><input type="checkbox" checked={expoTarget} onChange={(event) => setExpoTarget(event.target.checked)} className="accent-[var(--accent)]" /> Expo Adaptive</label>
                  {projectType === "responsive-web" ? <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border border-[var(--accent)] bg-[var(--accent-soft)] px-3 text-xs"><input type="checkbox" checked={webTarget} onChange={(event) => setWebTarget(event.target.checked)} className="accent-[var(--accent)]" /> Responsive web</label> : null}
                </div>
              </fieldset>
              <div className="mt-5 grid gap-4 sm:grid-cols-3">
                <label className="grid gap-2 text-xs font-semibold">Start from
                  <select value={startFrom} onChange={(event) => setStartFrom(event.target.value as typeof startFrom)} className="h-10 rounded-lg border border-[var(--line)] bg-[var(--field)] px-3 text-[12px] font-normal outline-none focus:border-[var(--select)]">
                    <option value="empty">Empty</option><option value="patterns">Core patterns</option><option value="example">An example</option>
                  </select>
                </label>
                <label className="grid gap-2 text-xs font-semibold">Theme
                  <select value={projectTheme} onChange={(event) => setProjectTheme(event.target.value as typeof projectTheme)} className="h-10 rounded-lg border border-[var(--line)] bg-[var(--field)] px-3 text-[12px] font-normal outline-none focus:border-[var(--select)]">
                    <option value="both">Light and dark</option><option value="light">Light</option><option value="dark">Dark</option>
                  </select>
                </label>
                <label className="grid gap-2 text-xs font-semibold">Storage
                  <span className="flex h-10 items-center rounded-lg border border-[var(--line)] bg-[var(--field)] px-3 text-[11px] font-normal text-[var(--muted)]">Browser recovery · local-first</span>
                </label>
              </div>
              <section aria-label="Project summary" className="mt-5 rounded-xl border border-[var(--line)] bg-[var(--chip)] p-3">
                <strong className="text-[11px]">Project summary</strong>
                <p className="mt-1 text-[10px] leading-relaxed text-[var(--muted)]">{name.trim() || "Untitled project"} · {projectTypeLabel(projectType)} · {startFrom} · {projectTheme} theme · {[reactTarget && "React", swiftTarget && "SwiftUI", expoTarget && "Expo", projectType === "responsive-web" && webTarget && "Web"].filter(Boolean).join(", ") || "Design only"}</p>
              </section>
              <div className="mt-7 flex items-center justify-between gap-4 border-t border-[var(--line)] pt-5">
                <span className="text-[10px] leading-relaxed text-[var(--muted)]">Saved to browser recovery until you connect a local project.</span>
                <button type="submit" disabled={opening !== null} className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl bg-[var(--accent)] px-5 text-xs font-semibold text-white transition-transform active:scale-[.98] disabled:opacity-60">Create project <ArrowRight size={14} /></button>
              </div>
            </form>
          </motion.section>
        ) : (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 110, damping: 20 }} className="grid flex-1 gap-10 py-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(360px,.85fr)] lg:py-16">
            <section className="min-w-0">
              <span className="font-mono text-[10px] uppercase tracking-[.16em] text-[var(--accent)]">Project launcher</span>
              <h1 className="mt-4 max-w-[780px] text-4xl font-semibold leading-[.98] tracking-[-.065em] md:text-6xl">Open intent.<br />Build native interfaces.</h1>
              <p className="mt-6 max-w-[60ch] text-sm leading-relaxed text-[var(--muted)]">Start a blank semantic project, recover browser work, import a canonical graph, or open a local workspace shared with coding agents.</p>

              <div className="mt-9 grid gap-3 sm:grid-cols-[1.15fr_.85fr]">
                <button type="button" onClick={() => { setView("new"); setError(null); }} className="group flex min-h-28 items-end justify-between rounded-[24px] bg-[var(--accent-deep)] p-5 text-left text-white shadow-[0_24px_50px_-38px_rgba(18,59,49,.9)] transition-transform active:scale-[.99]">
                  <span><Plus size={18} /><strong className="mt-5 block text-lg tracking-[-.03em]">New project</strong><span className="mt-1 block text-[11px] text-emerald-50/65">Guided blank canvas</span></span><ArrowRight size={17} className="transition-transform group-hover:translate-x-1" />
                </button>
                <button type="button" onClick={() => importInput.current?.click()} disabled={opening !== null} className="flex min-h-28 items-end justify-between rounded-[24px] border border-[var(--line)] bg-[var(--surface-strong)] p-5 text-left transition-[border,transform] hover:border-[var(--accent)] active:scale-[.99] disabled:opacity-60">
                  <span><FileArrowUp size={18} className="text-[var(--accent)]" /><strong className="mt-5 block text-sm">Import graph</strong><span className="mt-1 block text-[10px] text-[var(--muted)]">Validated JSON · 512 KB max</span></span>
                </button>
                <input ref={importInput} type="file" accept="application/json,.json,.intentform" onChange={(event) => importProject(event.target.files?.[0])} className="sr-only" aria-label="Import IntentForm project" />
              </div>

              {showRecents ? <div className="mt-10 border-t border-[var(--line)] pt-5">
                <div className="flex items-center justify-between gap-4"><div><h2 className="text-sm font-semibold">Recent and recovery</h2><p className="mt-1 text-[10px] text-[var(--muted)]">One local browser project, never hidden behind an account.</p></div>{recovery?.status === "ready" ? <button type="button" onClick={discardRecovery} className="text-[10px] font-semibold text-[var(--muted)] hover:text-[var(--danger)]">Discard recovery</button> : null}</div>
                {recovery === null ? (
                  <div className="mt-4 animate-pulse rounded-[22px] border border-[var(--line)] p-5"><div className="h-3 w-32 rounded bg-[var(--chip)]" /><div className="mt-4 h-7 w-64 rounded bg-[var(--chip)]" /></div>
                ) : recovery.status === "ready" && recoveryMatches ? (
                  <button type="button" disabled={opening !== null} onClick={() => persistAndOpen(recovery.project.graph, { projectType: recovery.project.projectType, source: "recovery", ...(recovery.project.localFingerprint ? { localFingerprint: recovery.project.localFingerprint } : {}) }, "recovery")} className="group mt-4 grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 rounded-[22px] border border-[var(--line)] bg-[var(--surface-strong)] p-4 text-left transition-[border,transform] hover:border-[var(--accent)] active:scale-[.995] disabled:opacity-60">
                    <span className="grid size-11 place-items-center rounded-[14px] bg-[var(--accent-soft)] text-[var(--accent-dark)]"><HardDrives size={18} /></span>
                    <span className="min-w-0"><strong className="block truncate text-sm">{recovery.project.graph.product.name}</strong><span className="mt-1 block truncate text-[10px] text-[var(--muted)]">{projectTypeLabel(recovery.project.projectType)} · saved {new Date(recovery.project.savedAt).toLocaleString()}</span></span>
                    <ArrowRight size={15} className="text-[var(--muted)] transition-transform group-hover:translate-x-1" />
                  </button>
                ) : recovery.status === "invalid" && projectQuery.trim().length === 0 ? (
                  <div className="mt-4 flex items-start gap-3 rounded-[22px] border border-amber-400/35 bg-amber-50 p-4 text-amber-950"><Warning size={17} weight="fill" className="mt-0.5 shrink-0 text-amber-600" /><span className="min-w-0 flex-1 text-xs leading-relaxed"><strong className="block">Recovery needs attention</strong><span className="mt-1 block">{recovery.message}</span></span><button type="button" onClick={discardRecovery} className="rounded-lg border border-amber-300 px-2.5 py-1.5 text-[10px] font-semibold">Discard</button></div>
                ) : projectQuery.trim().length > 0 ? (
                  <div role="status" className="mt-4 rounded-[22px] border border-dashed border-[var(--line)] px-5 py-7"><strong className="text-xs">No recent project matches “{projectQuery.trim()}”</strong><p className="mt-1 text-[10px] text-[var(--muted)]">Try a project name, type, or source.</p></div>
                ) : (
                  <div className="mt-4 rounded-[22px] border border-dashed border-[var(--line)] px-5 py-7"><strong className="text-xs">No browser project yet</strong><p className="mt-1 text-[10px] text-[var(--muted)]">Create, import, or copy an example. IntentForm will recover it here.</p></div>
                )}
              </div> : null}
            </section>

            {showExamples ? <aside className="min-w-0 lg:border-l lg:border-[var(--line)] lg:pl-8">
              <div className="flex items-end justify-between gap-4"><div><span className="font-mono text-[10px] uppercase tracking-[.14em] text-[var(--faint)]">Examples</span><h2 className="mt-2 text-xl font-semibold tracking-[-.04em]">Open a working copy</h2></div><span className="text-[10px] text-[var(--muted)]">Sources stay unchanged</span></div>
              <div className="mt-5 divide-y divide-[var(--line)] border-y border-[var(--line)]">
                {visibleExamples.map((example, index) => (
                  <button key={example.id} type="button" disabled={opening !== null} onClick={() => persistAndOpen(structuredClone(example.graph), { projectType: example.projectType, source: "example" }, example.id)} className="group grid w-full grid-cols-[32px_minmax(0,1fr)_auto] gap-3 py-5 text-left transition-transform active:scale-[.995] disabled:opacity-60">
                    <span className="font-mono text-[10px] text-[var(--faint)]">0{index + 1}</span><span><strong className="block text-sm">{example.label}</strong><span className="mt-1.5 block text-[10px] leading-relaxed text-[var(--muted)]">{example.summary}</span><span className="mt-3 inline-flex rounded-md bg-[var(--chip)] px-2 py-1 font-mono text-[9px] text-[var(--faint)]">{example.graph.product.name}</span></span><ArrowRight size={14} className="mt-1 text-[var(--faint)] transition-transform group-hover:translate-x-1" />
                  </button>
                ))}
                {visibleExamples.length === 0 ? <div role="status" className="py-8 text-center"><strong className="text-xs">No examples match “{projectQuery.trim()}”</strong><p className="mt-1 text-[10px] text-[var(--muted)]">Clear the search to see every verified starter.</p></div> : null}
              </div>

              <div className="mt-8 rounded-[22px] bg-[var(--inset)] p-5">
                <div className="flex items-center gap-2"><FolderOpen size={15} className="text-[var(--accent)]" /><strong className="text-xs">Local agent workspace</strong></div>
                <p className="mt-2 text-[10px] leading-relaxed text-[var(--muted)]">Open the repository’s `.intentform/graph.json` when the same-origin local bridge is enabled. Studio and MCP then share conflict-safe revisions.</p>
                <button type="button" onClick={openLocalProject} disabled={bridge !== "available" || opening !== null} className="mt-4 inline-flex min-h-9 items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--field)] px-3 text-[10px] font-semibold text-[var(--accent-dark)] transition-transform active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-45"><HardDrives size={13} /> {bridge === "checking" ? "Checking bridge" : bridge === "available" ? "Open local project" : "Local bridge unavailable"}</button>
                {localMigration ? (
                  <div role="status" className="mt-4 rounded-2xl border border-amber-400/40 bg-amber-50 p-3.5 text-amber-950">
                    <div className="flex items-start gap-2.5">
                      <Warning size={15} weight="fill" className="mt-0.5 shrink-0 text-amber-600" />
                      <div>
                        <strong className="block text-[11px]">Schema update required</strong>
                        <p className="mt-1 text-[10px] leading-relaxed">Version {localMigration.fromVersion} can be updated to {localMigration.toVersion}. IntentForm will checkpoint the exact original file before the atomic rewrite.</p>
                        <p className="mt-1 font-mono text-[9px] text-amber-800">{localMigration.diagnostics.map((diagnostic) => diagnostic.code).join(" · ")}</p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" onClick={applyLocalMigration} disabled={opening !== null} className="rounded-lg bg-amber-900 px-3 py-2 text-[10px] font-semibold text-white disabled:opacity-60">Checkpoint and update</button>
                      <button type="button" onClick={() => setLocalMigration(null)} disabled={opening !== null} className="rounded-lg border border-amber-300 px-3 py-2 text-[10px] font-semibold disabled:opacity-60">Not now</button>
                    </div>
                  </div>
                ) : null}
              </div>
            </aside> : null}
          </motion.div>
        )}
      </div>
    </main>
  );
}
