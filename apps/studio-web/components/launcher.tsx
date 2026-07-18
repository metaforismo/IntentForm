"use client";

import {
  ArrowLeft,
  ArrowRight,
  Archive,
  BracketsCurly,
  Browser,
  BookOpen,
  Check,
  CirclesThreePlus,
  Cube,
  DeviceMobile,
  DotsThree,
  FileArrowUp,
  FlagCheckered,
  FolderOpen,
  Gear,
  List,
  Plus,
  SquaresFour,
  Sparkle,
  Stack,
  ClockCounterClockwise,
  House,
  MagnifyingGlass,
  PencilSimple,
  Robot,
  Tag,
  Trash,
  Warning,
  X,
} from "@phosphor-icons/react";
import { GRAPH_LIMITS, parseGraph, type SemanticInterfaceGraph } from "@intentform/semantic-schema";
import { previewGraphMigration } from "@intentform/semantic-schema/migrations";
import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  clearBrowserProject,
  type BrowserProjectMetadata,
  type ProjectType,
} from "../lib/browser-projects";
import {
  browserProjectCatalog,
  clearActiveBrowserProject,
  migrateLegacyBrowserProject,
  setActiveBrowserProject,
  subscribeCatalogChanges,
  type BrowserCatalogProject,
} from "../lib/browser-project-catalog";
import { createStarterGraph, projectExamples } from "../lib/project-starters";
import {
  filterAndSortProjects,
  filterProjectExamples,
  inferProjectType,
  projectPreviewNodes,
  type CatalogFilters,
  type CatalogSort,
  type LauncherSection,
} from "../lib/launcher-model";
import {
  applyLauncherPreferences,
  defaultLauncherPreferences,
  LAUNCHER_PREFERENCES_KEY,
  parseLauncherPreferences,
  type LauncherPreferences,
} from "../lib/launcher-preferences";
import { BrandMark } from "./brand-mark";
import { LauncherAgents, LauncherBuilds, LauncherHome, LauncherLearn, LauncherSettings, ProjectOrganizationControls } from "./launcher-sections";

const MAX_IMPORT_BYTES = GRAPH_LIMITS.maxSerializedBytes;

type LauncherView = "projects" | "new";
type CatalogView = "grid" | "list";
type BridgeStatus = "checking" | "available" | "unavailable";
type ProjectAction = { id: string; mode: "menu" | "rename" | "organize" | "delete"; value?: string; folder?: string; tags?: string };

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
  { id: "mobile-prototype", label: "Mobile prototype", detail: "A touch-safe native concept for Expo, SwiftUI, or Compose targets.", icon: DeviceMobile },
  { id: "multi-platform", label: "Multi-platform", detail: "One semantic product intent compiled across Web and native targets.", icon: Stack },
];

const launcherSectionLabels: Record<LauncherSection, string> = {
  home: "Home",
  recents: "Recents",
  projects: "Projects",
  files: "Files",
  agents: "Agents",
  builds: "Builds",
  archive: "Archive",
  examples: "Examples",
  learn: "Learn",
  settings: "Settings",
};

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
  if (projectType === "mobile-prototype") return "Mobile prototype";
  if (projectType === "multi-platform") return "Multi-platform";
  return projectType[0]!.toUpperCase() + projectType.slice(1);
}

function ProjectThumbnail({ graph }: { graph: SemanticInterfaceGraph }) {
  const mode = graph.tokens.modes[graph.tokens.activeMode] ?? graph.tokens.modes[graph.tokens.defaultMode];
  const colors = mode?.values.colors ?? {};
  const accent = colors["color.accent"] ?? "#3478e5";
  const ink = colors["color.ink"] ?? "#202020";
  const canvas = colors["color.canvas"] ?? "#eeeeec";
  const surface = colors["color.surface"] ?? "#ffffff";
  const screen = graph.screens[0];
  const nodes = projectPreviewNodes(graph);
  return (
    <span className="relative block aspect-[16/10] overflow-hidden rounded-t-[8px] border-b border-[var(--if-border-subtle)] p-[8%]" style={{ color: ink, background: canvas }} aria-hidden="true">
      <span className="flex h-full flex-col overflow-hidden rounded-[6px] p-[8%] shadow-sm" style={{ background: surface }}>
        <span className="h-1 w-8 rounded-full opacity-55" style={{ background: accent }} />
        <span className="mt-1 truncate text-[12px] font-semibold leading-none">{screen?.title ?? "Project"}</span>
        <span className="mt-3 grid min-h-0 flex-1 content-start gap-1.5 overflow-hidden">{nodes.map((node) => node.kind === "primary-action" || node.kind === "secondary-action" ? <span key={node.id} className="mt-1 w-fit max-w-full truncate rounded-[3px] px-2 py-1 text-[7px] font-semibold text-white" style={{ background: accent }}>{node.label}</span> : <span key={node.id} className="truncate text-[7px] leading-tight" style={{ opacity: node.emphasis === "strong" ? .92 : .58 }}>{node.label}</span>)}</span>
      </span>
    </span>
  );
}

function CatalogProjectCard({
  project,
  catalogView,
  opening,
  action,
  onAction,
  onOpen,
  onRename,
  onDuplicate,
  onOrganize,
  onExport,
  onArchive,
  onDelete,
  bridge,
  onRelink,
}: {
  project: BrowserCatalogProject;
  catalogView: CatalogView;
  opening: string | null;
  action: ProjectAction | null;
  onAction(action: ProjectAction | null): void;
  onOpen(): void;
  onRename(name: string): void;
  onDuplicate(): void;
  onOrganize(folder: string, tags: string): void;
  onExport(): void;
  onArchive(): void;
  onDelete(): void;
  bridge: BridgeStatus;
  onRelink(): void;
}) {
  const activeAction = action?.id === project.id ? action : null;
  return (
    <article style={{ contentVisibility: "auto", containIntrinsicSize: catalogView === "grid" ? "260px" : "112px" }} className={`group relative overflow-hidden rounded-lg border border-[var(--if-border)] bg-[var(--if-panel)] ${project.archivedAt ? "opacity-65" : ""}`}>
      <button type="button" aria-label={project.missingLocalPath ? `${project.name}, open cached copy` : project.name} disabled={opening !== null || Boolean(project.archivedAt)} onClick={onOpen} className={`w-full text-left disabled:cursor-not-allowed ${catalogView === "list" ? "grid grid-cols-[112px_minmax(0,1fr)]" : "block"}`}>
        <ProjectThumbnail graph={project.graph} />
        <span className="flex min-w-0 items-start gap-3 p-3">
          <span className="min-w-0 flex-1">
            <strong className="block truncate text-[13px] font-medium">{project.name}</strong>
            <span className="mt-1 block truncate text-[11px] text-[var(--if-text-secondary)]">
              {new Date(project.lastOpenedAt).toLocaleString()} · {projectTypeLabel(project.projectType)}
            </span>
            <span className="mt-2 flex flex-wrap items-center gap-2 font-mono text-[10px] text-[var(--if-text-tertiary)]">
              <span>{project.thumbnail.screenCount} {project.thumbnail.screenCount === 1 ? "screen" : "screens"}</span>
              <span>r{project.revision}</span>
              {project.folder ? <span>{project.folder}</span> : null}
              {project.tags.slice(0, 2).map((tagName) => <span key={tagName}>#{tagName}</span>)}
              {project.source === "local" ? <span className={project.missingLocalPath ? "text-[var(--if-red)]" : ""}>{project.missingLocalPath ? "Missing path" : "Desktop linked"}</span> : null}
              {project.archivedAt ? <span>Archived</span> : null}
            </span>
          </span>
        </span>
      </button>
      <button
        type="button"
        aria-label={`Project actions for ${project.name}`}
        aria-expanded={activeAction?.mode === "menu"}
        onClick={() => onAction(activeAction?.mode === "menu" ? null : { id: project.id, mode: "menu" })}
        className="absolute right-2 top-2 grid size-7 place-items-center rounded-md bg-[var(--if-panel)]/90 text-[var(--if-text-secondary)] opacity-0 shadow-[var(--if-shadow-menu)] hover:bg-[var(--if-raised)] group-hover:opacity-100 focus-visible:opacity-100"
      >
        <DotsThree size={16} weight="bold" />
      </button>
      {activeAction?.mode === "menu" ? (
        <div role="menu" aria-label={`Actions for ${project.name}`} className="absolute right-2 top-10 z-[2] w-40 rounded-lg border border-[var(--if-border)] bg-[var(--if-raised)] p-1 shadow-[var(--if-shadow-menu)]">
          <button type="button" role="menuitem" onClick={onOpen} className="flex h-7 w-full items-center gap-2 rounded px-2 text-left text-[11px] hover:bg-[var(--if-hover)]"><FolderOpen size={12} /> {project.missingLocalPath ? "Open cached copy" : "Open"}</button>
          {project.source === "local" && project.missingLocalPath ? <button type="button" role="menuitem" disabled={bridge !== "available"} onClick={onRelink} className="flex h-7 w-full items-center gap-2 rounded px-2 text-left text-[11px] hover:bg-[var(--if-hover)] disabled:cursor-not-allowed disabled:opacity-45"><CirclesThreePlus size={12} /> {bridge === "available" ? "Relink local project" : "Desktop bridge required"}</button> : null}
          <button type="button" role="menuitem" onClick={() => onAction({ id: project.id, mode: "rename", value: project.name })} className="flex h-7 w-full items-center gap-2 rounded px-2 text-left text-[11px] hover:bg-[var(--if-hover)]"><PencilSimple size={12} /> Rename</button>
          <button type="button" role="menuitem" onClick={onDuplicate} className="flex h-7 w-full items-center gap-2 rounded px-2 text-left text-[11px] hover:bg-[var(--if-hover)]"><CirclesThreePlus size={12} /> Duplicate</button>
          <button type="button" role="menuitem" onClick={() => onAction({ id: project.id, mode: "organize", folder: project.folder ?? "", tags: project.tags.join(", ") })} className="flex h-7 w-full items-center gap-2 rounded px-2 text-left text-[11px] hover:bg-[var(--if-hover)]"><Tag size={12} /> Organize</button>
          <button type="button" role="menuitem" onClick={onExport} className="flex h-7 w-full items-center gap-2 rounded px-2 text-left text-[11px] hover:bg-[var(--if-hover)]"><FileArrowUp size={12} /> Export</button>
          <button type="button" role="menuitem" onClick={onArchive} className="flex h-7 w-full items-center gap-2 rounded px-2 text-left text-[11px] hover:bg-[var(--if-hover)]"><Archive size={12} /> {project.archivedAt ? "Restore" : "Archive"}</button>
          <button type="button" role="menuitem" onClick={() => onAction({ id: project.id, mode: "delete" })} className="flex h-7 w-full items-center gap-2 rounded px-2 text-left text-[11px] text-[var(--if-red)] hover:bg-[var(--if-red-soft)]"><Trash size={12} /> Delete</button>
        </div>
      ) : null}
      {activeAction?.mode === "rename" ? (
        <form className="absolute inset-x-2 bottom-2 z-[2] flex gap-1 rounded-lg border border-[var(--if-border)] bg-[var(--if-raised)] p-1.5 shadow-[var(--if-shadow-menu)]" onSubmit={(event) => { event.preventDefault(); onRename(activeAction.value ?? project.name); }}>
          <input autoFocus aria-label={`Rename ${project.name}`} value={activeAction.value ?? ""} onChange={(event) => onAction({ ...activeAction, value: event.target.value })} className="h-7 min-w-0 flex-1 rounded border border-[var(--if-border)] bg-[var(--if-input)] px-2 text-[11px] outline-none focus:border-[var(--if-blue)]" />
          <button type="submit" className="h-7 rounded bg-[var(--if-blue)] px-2 text-[10.5px] font-medium text-white">Save</button>
          <button type="button" onClick={() => onAction(null)} className="h-7 rounded px-2 text-[10.5px] hover:bg-[var(--if-hover)]">Cancel</button>
        </form>
      ) : null}
      {activeAction?.mode === "organize" ? (
        <form className="absolute inset-x-2 bottom-2 z-[2] grid gap-1.5 rounded-lg border border-[var(--if-border)] bg-[var(--if-raised)] p-2 shadow-[var(--if-shadow-menu)]" onSubmit={(event) => { event.preventDefault(); onOrganize(activeAction.folder ?? "", activeAction.tags ?? ""); }}>
          <input autoFocus aria-label={`Folder for ${project.name}`} value={activeAction.folder ?? ""} onChange={(event) => onAction({ ...activeAction, folder: event.target.value })} placeholder="Folder (optional)" className="h-7 rounded border border-[var(--if-border)] bg-[var(--if-input)] px-2 text-[11px] outline-none focus:border-[var(--if-blue)]" />
          <input aria-label={`Tags for ${project.name}`} value={activeAction.tags ?? ""} onChange={(event) => onAction({ ...activeAction, tags: event.target.value })} placeholder="Tags, comma separated" className="h-7 rounded border border-[var(--if-border)] bg-[var(--if-input)] px-2 text-[11px] outline-none focus:border-[var(--if-blue)]" />
          <div className="flex justify-end gap-1"><button type="button" onClick={() => onAction(null)} className="h-7 rounded px-2 text-[10.5px] hover:bg-[var(--if-hover)]">Cancel</button><button type="submit" className="h-7 rounded bg-[var(--if-blue)] px-2 text-[10.5px] font-medium text-white">Save</button></div>
        </form>
      ) : null}
      {activeAction?.mode === "delete" ? (
        <div role="alertdialog" aria-label={`Delete ${project.name}`} className="absolute inset-x-2 bottom-2 z-[2] rounded-lg border border-[var(--if-red)] bg-[var(--if-raised)] p-2 shadow-[var(--if-shadow-menu)]">
          <p className="text-[11px]">Delete this catalog copy and its browser recovery history? {project.source === "local" ? "The linked local file will not be deleted." : "This cannot be undone."}</p>
          <div className="mt-2 flex justify-end gap-1"><button type="button" onClick={() => onAction(null)} className="h-7 rounded px-2 text-[10.5px] hover:bg-[var(--if-hover)]">Cancel</button><button type="button" onClick={onDelete} className="h-7 rounded bg-[var(--if-red)] px-2 text-[10.5px] font-medium text-white">Delete</button></div>
        </div>
      ) : null}
    </article>
  );
}

export function Launcher() {
  const router = useRouter();
  const importInput = useRef<HTMLInputElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const catalogRefreshSequence = useRef(0);
  const [view, setView] = useState<LauncherView>("projects");
  const [preferences, setPreferences] = useState<LauncherPreferences>(defaultLauncherPreferences);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const catalogView = preferences.catalogView;
  const [section, setSection] = useState<LauncherSection>("home");
  const [projectQuery, setProjectQuery] = useState("");
  const [filters, setFilters] = useState<CatalogFilters>({ type: "all", platform: "all", missingOnly: false });
  const [projects, setProjects] = useState<BrowserCatalogProject[] | null>(null);
  const [legacyWarning, setLegacyWarning] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [projectAction, setProjectAction] = useState<ProjectAction | null>(null);
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
  const [storageEstimate, setStorageEstimate] = useState<{ usage: number; quota: number } | null>(null);

  useEffect(() => {
    setPreferences(parseLauncherPreferences(window.localStorage.getItem(LAUNCHER_PREFERENCES_KEY)));
    setPreferencesReady(true);
  }, []);

  useEffect(() => {
    if (!preferencesReady) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => applyLauncherPreferences(preferences, media.matches);
    apply();
    window.localStorage.setItem(LAUNCHER_PREFERENCES_KEY, JSON.stringify(preferences));
    if (preferences.appearance !== "system") return;
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [preferences, preferencesReady]);

  useEffect(() => {
    if (!navigator.storage?.estimate) return;
    void navigator.storage.estimate().then((estimate) => setStorageEstimate({ usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 })).catch(() => setStorageEstimate(null));
  }, [projects]);

  const refreshCatalog = async () => {
    const sequence = ++catalogRefreshSequence.current;
    try {
      const catalog = browserProjectCatalog();
      const entries = await catalog.list(true);
      if (sequence === catalogRefreshSequence.current) setProjects(entries);
    } catch {
      if (sequence === catalogRefreshSequence.current) {
        setProjects([]);
        setError("The durable browser project catalog is unavailable in this context.");
      }
    }
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const migration = await migrateLegacyBrowserProject(window.localStorage);
      if (cancelled) return;
      if (migration.warning) setLegacyWarning(migration.warning);
      try {
        const entries = await browserProjectCatalog().list(true);
        if (!cancelled) setProjects(entries);
      } catch {
        if (!cancelled) {
          setProjects([]);
          setError("The durable browser project catalog is unavailable in this context.");
        }
      }
    })();
    const controller = new AbortController();
    void fetch("/api/project?capability=1", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const result = await response.json() as { available?: unknown };
        setBridge(result.available === true ? "available" : "unavailable");
      })
      .catch(() => {
        if (!controller.signal.aborted) setBridge("unavailable");
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    const refresh = () => void refreshCatalog();
    const unsubscribe = subscribeCatalogChanges(refresh);
    const refreshWhenVisible = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);

  useEffect(() => {
    if (bridge !== "unavailable" || !projects?.some((project) => project.source === "local" && !project.missingLocalPath)) return;
    let cancelled = false;
    void (async () => {
      const catalog = browserProjectCatalog();
      await Promise.all(projects
        .filter((project) => project.source === "local" && !project.missingLocalPath)
        .map((project) => catalog.markMissing(project.id, true)));
      if (!cancelled) await refreshCatalog();
    })();
    return () => { cancelled = true; };
  }, [bridge, projects]);

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
    void (async () => {
      try {
        const created = await browserProjectCatalog().create(graph, metadata);
        if (!created.ok) throw new Error(created.message);
        setActiveBrowserProject(window.localStorage, created.project.id);
        router.push("/studio");
      } catch (cause) {
        setOpening(null);
        setError(validationMessage(cause));
      }
    })();
  };

  const openCatalogProject = (project: BrowserCatalogProject) => {
    setOpening(project.id);
    setError(null);
    void (async () => {
      const touched = await browserProjectCatalog().touch(project.id);
      if (!touched.ok) {
        setOpening(null);
        setError(touched.message);
        return;
      }
      setActiveBrowserProject(window.localStorage, project.id);
      router.push("/studio");
    })();
  };

  const renameCatalogProject = (project: BrowserCatalogProject, name: string) => {
    setOpening(project.id);
    void (async () => {
      const renamed = await browserProjectCatalog().rename(project.id, name);
      setOpening(null);
      if (!renamed.ok) {
        setError(renamed.message);
        return;
      }
      setProjectAction(null);
      await refreshCatalog();
    })();
  };

  const duplicateCatalogProject = (project: BrowserCatalogProject) => {
    setOpening(project.id);
    setError(null);
    void (async () => {
      const graph = structuredClone(project.graph);
      graph.product.name = `${project.name} Copy`;
      const created = await browserProjectCatalog().create(graph, { projectType: project.projectType, source: "created" });
      setOpening(null);
      setProjectAction(null);
      if (!created.ok) {
        setError(created.message);
        return;
      }
      await refreshCatalog();
    })();
  };

  const organizeCatalogProject = (project: BrowserCatalogProject, folder: string, tags: string) => {
    setOpening(project.id);
    setError(null);
    void (async () => {
      const organized = await browserProjectCatalog().organize(project.id, folder, tags.split(","));
      setOpening(null);
      if (!organized.ok) {
        setError(organized.message);
        return;
      }
      setProjectAction(null);
      await refreshCatalog();
    })();
  };

  const exportCatalogProject = (project: BrowserCatalogProject) => {
    const payload = JSON.stringify({ format: "intentform-project", projectType: project.projectType, graph: project.graph }, null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project"}.intentform`;
    link.click();
    URL.revokeObjectURL(url);
    setProjectAction(null);
  };

  const archiveCatalogProject = (project: BrowserCatalogProject) => {
    setOpening(project.id);
    void (async () => {
      const archived = await browserProjectCatalog().archive(project.id, !project.archivedAt);
      setOpening(null);
      if (!archived.ok) {
        setError(archived.message);
        return;
      }
      setProjectAction(null);
      await refreshCatalog();
    })();
  };

  const deleteCatalogProject = (project: BrowserCatalogProject) => {
    setOpening(project.id);
    void (async () => {
      try {
        await browserProjectCatalog().delete(project.id);
        clearActiveBrowserProject(window.localStorage, project.id);
        setProjectAction(null);
        setOpening(null);
        await refreshCatalog();
      } catch {
        setOpening(null);
        setError("The project could not be deleted from this browser.");
      }
    })();
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
          projectType: inferProjectType(graph),
          source: "local",
          localFingerprint: result.fingerprint,
        }, "local");
      } catch (cause) {
        setOpening(null);
        setError(validationMessage(cause));
      }
    })();
  };

  const relinkLocalProject = (project: BrowserCatalogProject) => {
    setOpening(project.id);
    setError(null);
    setProjectAction(null);
    void (async () => {
      try {
        const response = await fetch("/api/project", { cache: "no-store" });
        const result = await response.json() as { error?: string; graph?: unknown; fingerprint?: string; migration?: LocalMigrationState };
        if (response.status === 409 && result.migration) throw new Error("The local project must be migrated before this cached copy can be relinked.");
        if (!response.ok || !result.graph || typeof result.fingerprint !== "string") {
          throw new Error(result.error ?? "The local project could not be relinked.");
        }
        const graph = parseGraph(result.graph);
        const saved = await browserProjectCatalog().save(project.id, graph, project.workspace, project.revision, {
          projectType: project.projectType,
          source: "local",
          localFingerprint: result.fingerprint,
          missingLocalPath: false,
        });
        if (!saved.ok) throw new Error(saved.message);
        setActiveBrowserProject(window.localStorage, saved.project.id);
        router.push("/studio");
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
          projectType: inferProjectType(graph),
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
        if (file.size > MAX_IMPORT_BYTES) throw new Error(`The project file is larger than the ${(MAX_IMPORT_BYTES / 1_000_000).toFixed(0)} MB graph limit.`);
        const decoded = JSON.parse(await file.text()) as unknown;
        const bundle = decoded && typeof decoded === "object" && "graph" in decoded
          ? decoded as { graph: unknown; projectType?: unknown }
          : { graph: decoded, projectType: undefined };
        const graph = previewGraphMigration(bundle.graph).graph;
        persistAndOpen(graph, { projectType: inferProjectType(graph, bundle.projectType), source: "imported" }, "import");
      } catch (cause) {
        setOpening(null);
        setError(`Import failed: ${validationMessage(cause)}`);
      } finally {
        if (importInput.current) importInput.current.value = "";
      }
    })();
  };

  const visibleExamples = filterProjectExamples(projectExamples, projectQuery);
  const sortedProjects = useMemo(() => filterAndSortProjects(projects ?? [], projectQuery, filters, preferences.sort), [filters, preferences.sort, projectQuery, projects]);
  const visibleProjects = sortedProjects.filter((project) => section === "archive" ? Boolean(project.archivedAt) : showArchived || !project.archivedAt);
  const activeProjects = (projects ?? []).filter((project) => !project.archivedAt);
  const recentProjects = section === "recents" || section === "home"
    ? visibleProjects.filter((project) => !project.archivedAt).slice(0, section === "home" ? 6 : 12)
    : visibleProjects;
  const showRecents = ["home", "recents", "projects", "files", "archive"].includes(section);
  const showExamples = section === "examples" || section === "home" || (section === "projects" && Boolean(projectQuery.trim()));
  const displayedExamples = section === "home" ? visibleExamples.slice(0, 3) : visibleExamples;

  const selectSection = (next: LauncherSection) => {
    setView("projects");
    setSection(next);
    setError(null);
  };

  return (
    <main className="studio-grain flex min-h-[100dvh] text-[var(--if-text)]">
      <input ref={importInput} type="file" accept="application/json,.json,.intentform" onChange={(event) => importProject(event.target.files?.[0])} className="sr-only" aria-label="Import IntentForm project" />
      <aside className="hidden w-[232px] shrink-0 flex-col border-r border-[var(--if-border-subtle)] bg-[var(--if-panel)] p-3 lg:flex" aria-label="Project launcher navigation">
        <div className="flex h-10 items-center gap-2 px-2"><BrandMark /><strong className="text-[13px] font-medium">IntentForm</strong></div>
        <nav className="mt-5 grid gap-0.5 text-[11.5px]" aria-label="Projects">
          {([
            { id: "home", label: "Home", icon: House },
            { id: "recents", label: "Recents", icon: ClockCounterClockwise },
            { id: "projects", label: "Projects", icon: SquaresFour },
            { id: "examples", label: "Examples", icon: Sparkle },
          ] satisfies Array<{ id: LauncherSection; label: string; icon: typeof House }>).map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" aria-current={section === id ? "page" : undefined} onClick={() => selectSection(id)} className={`flex h-8 items-center gap-2 rounded-md px-2 text-left ${section === id ? "bg-[var(--if-pressed)] text-[var(--if-text)]" : "text-[var(--if-text-secondary)] hover:bg-[var(--if-hover)] hover:text-[var(--if-text)]"}`}><Icon size={15} /><span>{label}</span></button>
          ))}
        </nav>
        <div className="my-4 border-t border-[var(--if-border-subtle)]" />
        <p className="px-2 pb-1 text-[9px] font-semibold uppercase tracking-[.08em] text-[var(--if-text-tertiary)]">Workspace</p>
        <nav className="grid gap-0.5 text-[11.5px]" aria-label="Workspace">
          {([
            { id: "files", label: "Files", icon: FolderOpen },
            { id: "agents", label: "Agents", icon: Robot },
            { id: "builds", label: "Builds", icon: Check },
            { id: "archive", label: "Archive", icon: Archive },
          ] satisfies Array<{ id: LauncherSection; label: string; icon: typeof House }>).map(({ id, label, icon: Icon }) => <button key={id} type="button" aria-current={section === id ? "page" : undefined} onClick={() => selectSection(id)} className={`flex h-8 items-center gap-2 rounded-md px-2 text-left ${section === id ? "bg-[var(--if-pressed)] text-[var(--if-text)]" : "text-[var(--if-text-secondary)] hover:bg-[var(--if-hover)] hover:text-[var(--if-text)]"}`}><Icon size={15} /><span>{label}</span></button>)}
        </nav>
        <div className="my-4 border-t border-[var(--if-border-subtle)]" />
        <nav className="grid gap-0.5 text-[11.5px]" aria-label="Help and preferences">
          <button type="button" aria-current={section === "learn" ? "page" : undefined} onClick={() => selectSection("learn")} className={`flex h-8 items-center gap-2 rounded-md px-2 text-left ${section === "learn" ? "bg-[var(--if-pressed)] text-[var(--if-text)]" : "text-[var(--if-text-secondary)] hover:bg-[var(--if-hover)] hover:text-[var(--if-text)]"}`}><BookOpen size={15} /> Learn</button>
          <button type="button" aria-current={section === "settings" ? "page" : undefined} onClick={() => selectSection("settings")} className={`flex h-8 items-center gap-2 rounded-md px-2 text-left ${section === "settings" ? "bg-[var(--if-pressed)] text-[var(--if-text)]" : "text-[var(--if-text-secondary)] hover:bg-[var(--if-hover)] hover:text-[var(--if-text)]"}`}><Gear size={15} /> Settings</button>
        </nav>
        <div className="mt-auto border-t border-[var(--if-border-subtle)] px-2 pt-3">
          <div className="flex items-center gap-2 text-[11px] font-normal"><span className={`size-1.5 rounded-full ${bridge === "available" ? "bg-[var(--if-green)]" : "bg-[var(--if-text-tertiary)]"}`} />{bridge === "available" ? "Agent bridge ready" : "Browser workspace"}</div>
          <p className="mt-1 text-[10px] leading-relaxed text-[var(--if-text-tertiary)]">Local-first · no account required</p>
        </div>
      </aside>

      <section className="min-w-0 flex-1 bg-[var(--if-app)]">
        <header className="flex min-h-12 flex-wrap items-center justify-between gap-3 border-b border-[var(--if-border-subtle)] bg-[var(--if-panel)] px-4 py-1.5 sm:px-6 lg:px-8">
          <h1 className="text-[20px] font-[550] leading-[26px] tracking-[-.02em]">{launcherSectionLabels[section]}</h1>
          <label className="order-3 flex w-full items-center gap-2 border-t border-[var(--if-border-subtle)] pt-2 text-[10px] text-[var(--if-text-secondary)] lg:hidden">Section<select aria-label="Launcher section" value={section} onChange={(event) => selectSection(event.target.value as LauncherSection)} className="select-control h-8 flex-1">{Object.entries(launcherSectionLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
          <div className="flex min-w-0 items-center gap-2">
            <div className="hidden rounded-md border border-[var(--if-border)] bg-[var(--if-input)] p-0.5 sm:flex" aria-label="Project view">
              <button type="button" aria-label="Grid view" aria-pressed={catalogView === "grid"} onClick={() => setPreferences((current) => ({ ...current, catalogView: "grid" }))} className={`grid size-7 place-items-center rounded-[4px] ${catalogView === "grid" ? "bg-[var(--if-pressed)] text-[var(--if-text)]" : "text-[var(--if-text-secondary)] hover:bg-[var(--if-hover)]"}`}><SquaresFour size={14} /></button>
              <button type="button" aria-label="List view" aria-pressed={catalogView === "list"} onClick={() => setPreferences((current) => ({ ...current, catalogView: "list" }))} className={`grid size-7 place-items-center rounded-[4px] ${catalogView === "list" ? "bg-[var(--if-pressed)] text-[var(--if-text)]" : "text-[var(--if-text-secondary)] hover:bg-[var(--if-hover)]"}`}><List size={14} /></button>
            </div>
            <label className="relative"><MagnifyingGlass size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--if-text-tertiary)]" /><input ref={searchInput} value={projectQuery} onChange={(event) => { setProjectQuery(event.target.value); if (event.target.value.trim()) setSection("projects"); }} aria-label="Search projects" placeholder="Search" className="h-8 w-32 rounded-md border border-[var(--if-border)] bg-[var(--if-input)] pl-8 pr-2 text-[11px] outline-none focus:border-[var(--if-blue)] sm:w-56" /></label>
            <a href="/studio?judge=1&path=overview&step=design" className="hidden h-8 items-center gap-1.5 rounded-md border border-[var(--if-border)] px-3 text-[11px] font-medium text-[var(--if-text-secondary)] hover:bg-[var(--if-hover)] hover:text-[var(--if-text)] md:inline-flex"><FlagCheckered size={13} /> Judge Mode</a>
            <button type="button" onClick={openLocalProject} disabled={bridge !== "available" || opening !== null} className="hidden h-8 items-center gap-1.5 rounded-md border border-[var(--if-border)] bg-[var(--if-raised)] px-3 text-[11px] font-medium hover:bg-[var(--if-hover)] disabled:opacity-45 sm:inline-flex"><FolderOpen size={13} /> Open project</button>
            <button type="button" onClick={() => { setView("new"); setError(null); }} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--if-blue)] px-3 text-[11px] font-medium text-white hover:bg-[var(--if-blue-hover)]"><Plus size={13} /> New project</button>
          </div>
        </header>

        <div className="mx-auto max-w-[1440px] p-4 sm:p-6 lg:p-8">
          {error ? <div role="alert" className="mb-5 flex items-start gap-3 rounded-lg border border-[var(--if-red)] bg-[var(--if-red-soft)] px-3 py-2.5 text-[12px]"><Warning size={15} weight="fill" className="mt-0.5 shrink-0 text-[var(--if-red)]" /><span className="min-w-0 flex-1">{error}</span><button type="button" aria-label="Dismiss launcher error" onClick={() => setError(null)} className="rounded p-1 hover:bg-[var(--if-hover)]"><X size={13} /></button></div> : null}
          {legacyWarning ? <div role="alert" className="mb-5 rounded-lg border border-[var(--if-amber)] bg-[var(--if-amber-soft)] p-4 text-[12px]"><strong>Recovery needs attention</strong><p className="mt-1 text-[var(--if-text-secondary)]">{legacyWarning}</p><button type="button" onClick={() => { clearBrowserProject(window.localStorage); setLegacyWarning(null); }} className="mt-3 rounded-md border border-[var(--if-border)] px-3 py-1.5 font-medium">Discard</button></div> : null}
          {localMigration ? <div role="status" className="mb-5 flex flex-wrap items-center gap-3 rounded-lg border border-[var(--if-amber)] bg-[var(--if-amber-soft)] px-3 py-2.5 text-[11px]"><Warning size={15} weight="fill" className="text-[var(--if-amber)]" /><span className="min-w-0 flex-1">Schema {localMigration.fromVersion} needs an atomic update to {localMigration.toVersion}.</span><button type="button" onClick={applyLocalMigration} disabled={opening !== null} className="rounded-md bg-[var(--if-amber)] px-3 py-1.5 font-semibold text-white">Checkpoint and update</button><button type="button" onClick={() => setLocalMigration(null)} className="rounded-md px-2 py-1.5 hover:bg-[var(--if-hover)]">Not now</button></div> : null}

          {section === "home" ? <LauncherHome projects={activeProjects} bridge={bridge} storageEstimate={storageEstimate} onOpen={openCatalogProject} onOpenLocal={openLocalProject} onImport={() => importInput.current?.click()} onAgents={() => selectSection("agents")} onSettings={() => selectSection("settings")} /> : null}

          {section === "agents" ? <LauncherAgents bridge={bridge} /> : null}

          {section === "builds" ? <LauncherBuilds projects={activeProjects} onOpen={openCatalogProject} /> : null}

          {section === "learn" ? <LauncherLearn /> : null}

          {section === "settings" ? <LauncherSettings preferences={preferences} projects={projects ?? []} storageEstimate={storageEstimate} onChange={setPreferences} /> : null}

          {["projects", "files", "archive"].includes(section) ? <ProjectOrganizationControls sort={preferences.sort} filters={filters} projectTypes={projectTypeOptions} onSort={(sort) => setPreferences((current) => ({ ...current, sort }))} onFilters={setFilters} /> : null}

          {showRecents ? <section aria-labelledby="recent-projects-title">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div><h2 id="recent-projects-title" className="text-[13px] font-medium">{section === "home" ? "Continue working" : section === "projects" ? "Project catalog" : section === "files" ? "Local files and catalog copies" : section === "archive" ? "Archived projects" : "Recents"}</h2><p className="mt-0.5 text-[11px] text-[var(--if-text-secondary)]">{projects?.length ?? 0} durable {projects?.length === 1 ? "project" : "projects"} on this device</p></div>
              {section === "projects" && (projects ?? []).some((project) => project.archivedAt) ? <button type="button" aria-pressed={showArchived} onClick={() => setShowArchived((shown) => !shown)} className="h-7 rounded-md px-2 text-[10.5px] text-[var(--if-text-secondary)] hover:bg-[var(--if-hover)]">{showArchived ? "Hide archived" : "Show archived"}</button> : null}
            </div>
            {projects === null ? <div className="aspect-[16/10] max-w-80 animate-pulse rounded-lg bg-[var(--if-panel-alt)]" /> : recentProjects.length > 0 ? (
              <div className={catalogView === "grid" ? "grid grid-cols-[repeat(auto-fill,minmax(260px,320px))] gap-5" : "grid gap-2"}>
                {recentProjects.map((project) => <CatalogProjectCard
                  key={project.id}
                  project={project}
                  catalogView={catalogView}
                  opening={opening}
                  action={projectAction}
                  onAction={setProjectAction}
                  onOpen={() => openCatalogProject(project)}
                  onRename={(nextName) => renameCatalogProject(project, nextName)}
                  onDuplicate={() => duplicateCatalogProject(project)}
                  onOrganize={(folder, tags) => organizeCatalogProject(project, folder, tags)}
                  onExport={() => exportCatalogProject(project)}
                  onArchive={() => archiveCatalogProject(project)}
                  onDelete={() => deleteCatalogProject(project)}
                  bridge={bridge}
                  onRelink={() => relinkLocalProject(project)}
                />)}
              </div>
            ) : <div className="max-w-[560px] rounded-lg border border-dashed border-[var(--if-border)] px-5 py-6"><strong className="text-[13px] font-medium">{projectQuery.trim() ? `No project matches “${projectQuery.trim()}”` : showArchived ? "No archived projects" : "No recent projects"}</strong><p className="mt-1 text-[11px] text-[var(--if-text-secondary)]">Create a project, open a local file, or start from a working example.</p><div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => setView("new")} className="h-8 rounded-md bg-[var(--if-blue)] px-3 text-[11px] font-medium text-white">New project</button><button type="button" onClick={() => importInput.current?.click()} className="h-8 rounded-md border border-[var(--if-border)] px-3 text-[11px] font-medium">Open project</button><button type="button" onClick={() => selectSection("examples")} className="h-8 rounded-md px-3 text-[11px] font-medium text-[var(--if-blue-text)] hover:bg-[var(--if-hover)]">Explore examples</button></div></div>}
          </section> : null}

          {showExamples ? <section aria-labelledby="example-projects-title" className={showRecents ? "mt-10 border-t border-[var(--if-border-subtle)] pt-7" : ""}>
            <div className="mb-4"><h2 id="example-projects-title" className="text-[13px] font-medium">{section === "home" ? "Featured examples" : "Working examples"}</h2><p className="mt-0.5 text-[11px] text-[var(--if-text-secondary)]">Open as a copy; source examples never change.</p></div>
            {displayedExamples.length > 0 ? <div className={catalogView === "grid" ? "grid grid-cols-[repeat(auto-fill,minmax(260px,320px))] gap-5" : "grid gap-2"}>
              {displayedExamples.map((example) => <button key={example.id} type="button" style={{ contentVisibility: "auto", containIntrinsicSize: catalogView === "grid" ? "260px" : "112px" }} disabled={opening !== null} onClick={() => persistAndOpen(structuredClone(example.graph), { projectType: example.projectType, source: "example" }, example.id)} className={`group overflow-hidden rounded-lg border border-[var(--if-border)] bg-[var(--if-panel)] text-left hover:border-[var(--if-blue)] disabled:opacity-60 ${catalogView === "list" ? "grid grid-cols-[112px_minmax(0,1fr)]" : ""}`}><ProjectThumbnail graph={example.graph} /><span className="flex items-start gap-3 p-3"><span className="min-w-0 flex-1"><strong className="block truncate text-[13px] font-medium">{example.graph.product.name}</strong><span className="mt-1 block line-clamp-2 text-[11px] leading-4 text-[var(--if-text-secondary)]">{example.summary}</span><span className="mt-2 block font-mono text-[10px] text-[var(--if-text-tertiary)]">Example · {projectTypeLabel(example.projectType)}</span></span><ArrowRight size={14} className="mt-0.5 shrink-0 text-[var(--if-text-tertiary)] transition-transform group-hover:translate-x-0.5" /></span></button>)}
            </div> : <div role="status" className="rounded-lg border border-dashed border-[var(--if-border)] px-5 py-8 text-[12px]">No examples match “{projectQuery.trim()}”.</div>}
          </section> : null}
        </div>
      </section>

      {view === "new" ? <div className="fixed inset-0 z-20 grid place-items-center bg-[var(--backdrop)] p-4" onPointerDown={(event) => { if (event.target === event.currentTarget) setView("projects"); }}>
        <motion.form initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16, ease: [.2, .8, .2, 1] }} onSubmit={createProject} role="dialog" aria-modal="true" aria-labelledby="new-project-title" className="max-h-[calc(100dvh-32px)] w-full max-w-[640px] overflow-auto rounded-[10px] border border-[var(--if-border-strong)] bg-[var(--if-raised)] shadow-[var(--if-shadow-dialog)]">
          <header className="flex items-start justify-between border-b border-[var(--if-border-subtle)] p-5"><div><h2 id="new-project-title" className="text-[15px] font-[550] leading-[21px]">New project</h2><p className="mt-1 text-[11px] text-[var(--if-text-secondary)]">Create a valid local-first semantic project.</p></div><button type="button" aria-label="Close new project" onClick={() => setView("projects")} className="grid size-7 place-items-center rounded-md text-[var(--if-text-secondary)] hover:bg-[var(--if-hover)]"><X size={14} /></button></header>
          <div className="space-y-5 p-5">
            <fieldset><legend className="text-[11px] font-medium">Project type</legend><div className="mt-2 grid gap-1 rounded-lg border border-[var(--if-border)] p-1">{projectTypeOptions.map((option) => { const Icon = option.icon; const selected = projectType === option.id; return <label key={option.id} className={`flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 ${selected ? "bg-[var(--if-blue-soft)]" : "hover:bg-[var(--if-hover)]"}`}><input type="radio" name="project-type" value={option.id} checked={selected} onChange={() => setProjectType(option.id)} className="sr-only" /><Icon size={15} className={selected ? "text-[var(--if-blue)]" : "text-[var(--if-text-secondary)]"} /><span className="min-w-0 flex-1"><strong className="block text-[12px] font-medium">{option.label}</strong><span className="block truncate text-[10px] text-[var(--if-text-secondary)]">{option.detail}</span></span>{selected ? <Check size={13} weight="bold" className="text-[var(--if-blue)]" /> : null}</label>; })}</div></fieldset>
            <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1.5 text-[11px] font-medium">Project name<input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="Northline Field Notes" className="h-9 rounded-md border border-[var(--if-border)] bg-[var(--if-input)] px-3 text-[12px] font-normal outline-none focus:border-[var(--if-blue)]" /></label><label className="grid gap-1.5 text-[11px] font-medium">Primary audience<input required maxLength={240} value={audience} onChange={(event) => setAudience(event.target.value)} placeholder="Distributed research teams" className="h-9 rounded-md border border-[var(--if-border)] bg-[var(--if-input)] px-3 text-[12px] font-normal outline-none focus:border-[var(--if-blue)]" /></label><label className="grid gap-1.5 text-[11px] font-medium sm:col-span-2">First outcome<textarea required minLength={3} maxLength={500} value={purpose} onChange={(event) => setPurpose(event.target.value)} placeholder="Review and organize field observations" className="min-h-20 resize-y rounded-md border border-[var(--if-border)] bg-[var(--if-input)] px-3 py-2 text-[12px] font-normal outline-none focus:border-[var(--if-blue)]" /></label></div>
            <fieldset><legend className="text-[11px] font-medium">Targets</legend><div className="mt-2 grid gap-1 sm:grid-cols-2">{[["React", reactTarget, setReactTarget], ["SwiftUI", swiftTarget, setSwiftTarget], ["Expo Adaptive", expoTarget, setExpoTarget]] .map(([label, checked, setter]) => <label key={String(label)} className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-[11px] hover:bg-[var(--if-hover)]"><input type="checkbox" checked={Boolean(checked)} onChange={(event) => (setter as (value: boolean) => void)(event.target.checked)} className="accent-[var(--if-blue)]" />{String(label)}</label>)}{projectType === "responsive-web" ? <label className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-[11px] hover:bg-[var(--if-hover)]"><input type="checkbox" checked={webTarget} onChange={(event) => setWebTarget(event.target.checked)} className="accent-[var(--if-blue)]" />Responsive web</label> : null}</div></fieldset>
            <div className="grid gap-3 sm:grid-cols-3"><label className="grid gap-1.5 text-[11px] font-medium">Starter<select value={startFrom} onChange={(event) => setStartFrom(event.target.value as typeof startFrom)} className="select-control h-9"><option value="empty">Empty</option><option value="patterns">Core patterns</option><option value="example">Example</option></select></label><label className="grid gap-1.5 text-[11px] font-medium">Theme<select value={projectTheme} onChange={(event) => setProjectTheme(event.target.value as typeof projectTheme)} className="select-control h-9"><option value="both">Light and dark</option><option value="light">Light</option><option value="dark">Dark</option></select></label><label className="grid gap-1.5 text-[11px] font-medium">Location<span className="flex h-9 items-center rounded-md border border-[var(--if-border)] bg-[var(--if-panel-alt)] px-3 text-[10px] font-normal text-[var(--if-text-secondary)]">Durable browser catalog</span></label></div>
          </div>
          <footer className="flex items-center justify-between gap-4 border-t border-[var(--if-border-subtle)] px-5 py-4"><span className="min-w-0 truncate text-[10px] text-[var(--if-text-secondary)]">{name.trim() || "Untitled project"} · {projectTypeLabel(projectType)} · {projectTheme}</span><div className="flex gap-2"><button type="button" onClick={() => setView("projects")} className="h-8 rounded-md px-3 text-[11px] font-medium hover:bg-[var(--if-hover)]">Cancel</button><button type="submit" disabled={opening !== null} className="h-8 rounded-md bg-[var(--if-blue)] px-4 text-[11px] font-semibold text-white hover:bg-[var(--if-blue-hover)] disabled:opacity-60">Create project</button></div></footer>
        </motion.form>
      </div> : null}
    </main>
  );
}
