"use client";

import {
  ArrowLeft,
  ArrowsCounterClockwise,
  BracketsCurly,
  CaretDown,
  CheckCircle,
  CircleNotch,
  Code,
  DownloadSimple,
  FileText,
  FloppyDisk,
  FolderOpen,
  Lightning,
  Moon,
  Plus,
  Selection,
  ShieldCheck,
  Sparkle,
  Sun,
  TreeStructure,
  Warning,
  X,
} from "@phosphor-icons/react";
import { demoBrief, demoGraph } from "@intentform/proof-report/demo";
import type { DomImportProjection } from "@intentform/compiler-web/dom-import";
import type { RepairProposal } from "@intentform/repair-planner";
import type { BuildEvidenceState } from "@intentform/preview-daemon";
import {
  flattenSemanticNodes,
  parseGraph,
  semanticDiff,
  stableSerialize,
  type SemanticInterfaceGraph,
} from "@intentform/semantic-schema";
import type { VerificationFinding } from "@intentform/verifier";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  activeBrowserProjectId,
  browserProjectCatalog,
  defaultWorkspaceState,
  migrateLegacyBrowserProject,
  normalizeWorkspaceState,
  setActiveBrowserProject,
  type BrowserCatalogProject,
  type BrowserDocumentTab,
  type BrowserWorkspaceState,
  type ProjectSource,
  type ProjectType,
} from "../lib/browser-project-catalog";
import { hasUnsavedLocalChanges, serializedGraphFingerprint } from "../lib/project-save-state";
import { stashBootNotice } from "../lib/boot-notice";
import {
  JUDGE_SESSION_KEY,
  advanceJudgeSession,
  createJudgeSession,
  judgeDeepLink,
  judgeStep,
  judgeSteps,
  parseJudgeDeepLink,
  parseJudgeSession,
  selectJudgeStep,
  type JudgeSession,
  type JudgeStepId,
} from "../lib/judge-mode";
import { ManualEditor, type WorkflowStage } from "./manual-editor";
import { shouldCoalesceCommit, type CommitStamp } from "./editor/commit-coalescing";
import { reconcileGraphSelection } from "./editor/direct-manipulation";
import { editorProfiles, type DeviceId, type VisualState } from "./editor/support";
import { compileStudioTarget } from "./target-compilation";
import { BriefStage } from "./stages/brief-stage";
import { GraphStage } from "./stages/graph-stage";
import { OutputsStage } from "./stages/outputs-stage";
import { ReportStage } from "./stages/report-stage";
import { VerifyStage } from "./stages/verify-stage";
import {
  createRepairPreview,
  verificationNavigationTarget,
  type RepairPreview,
} from "./stages/workspace-model";
import { useLocalPreviews, type LocalPreviewTarget } from "./use-local-previews";
import { useBackgroundVerification } from "./use-background-verification";
import { DesktopControl } from "./desktop-control";
import { EcosystemControl } from "./ecosystem-control";
import { AgentActivityPanel, type AgentReviewChange } from "./agent-activity-panel";
import { BrandMark } from "./brand-mark";
import { adaptiveAutosaveDelay } from "./reliability-model";
import { JudgeModePanel } from "./judge-mode";

type Stage = "canvas" | WorkflowStage;
export type OutputTarget = "react" | "swiftui" | "expo" | "web";
export type ScenarioId = DeviceId;

const stages: Array<{ id: Stage; label: string; shortLabel: string; icon: typeof Sparkle }> = [
  { id: "canvas", label: "Design canvas", shortLabel: "Design", icon: Selection },
  { id: "brief", label: "Brief", shortLabel: "Brief", icon: Sparkle },
  { id: "graph", label: "Semantic graph", shortLabel: "Graph", icon: TreeStructure },
  { id: "outputs", label: "Native outputs", shortLabel: "Code", icon: Code },
  { id: "verify", label: "Verification", shortLabel: "Verify", icon: ShieldCheck },
  { id: "report", label: "Proof report", shortLabel: "Report", icon: FileText },
];
const primaryStages = stages.filter((item) => item.id === "canvas" || item.id === "outputs" || item.id === "verify");

function getSessionId(): string {
  const key = "intentform-session";
  const current = window.sessionStorage.getItem(key);
  if (current) return current;
  const next = crypto.randomUUID();
  window.sessionStorage.setItem(key, next);
  return next;
}

interface TraceSummary {
  requestId: string;
  requestFingerprint: string;
  attempts: number;
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
}

function ModeBadge({ mode, model, trace }: { mode: "live" | "replay"; model: string; trace: TraceSummary | null }) {
  return (
    <div title={trace ? `${trace.requestFingerprint} · ${trace.attempts} attempt(s)${trace.usage ? ` · ${trace.usage.totalTokens} tokens` : ""}` : undefined} className="inline-flex min-h-8 items-center gap-2 rounded-md border border-[var(--if-border)] bg-[var(--if-panel-alt)] px-2.5 text-[11px] font-medium text-[var(--if-text-secondary)]">
      <span className={`size-2 rounded-full ${mode === "live" ? "bg-[var(--if-green)]" : "bg-[var(--if-amber)]"}`} />
      {mode === "live" ? "Live model" : "Deterministic replay"}
      <span className="hidden font-mono font-normal text-[var(--faint)] 2xl:inline">{model}</span>
    </div>
  );
}

interface ActivityEntry {
  at: string;
  text: string;
}

type PendingAction = "project-open" | "project-save" | "interpret" | "repair";

interface RequestFailure {
  message: string;
  retryLabel: string;
}

class LocalProjectConflictError extends Error {}

function deferredCompilation(target: OutputTarget) {
  return {
    target,
    status: "disabled" as const,
    output: null,
    message: `Open ${target} output to generate this target.`,
  };
}

export function Studio() {
  const [stage, setStage] = useState<Stage>("canvas");
  const [brief, setBrief] = useState(demoBrief);
  const [editInstruction, setEditInstruction] = useState("Keep the primary action reachable on compact devices and inline when space allows.");
  const [briefOperation, setBriefOperation] = useState<"create" | "edit">("create");
  const [graph, setGraph] = useState<SemanticInterfaceGraph>(demoGraph);
  const [baseline, setBaseline] = useState<SemanticInterfaceGraph>(demoGraph);
  const [selectedScreen, setSelectedScreen] = useState("payment-request");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>("payment-request.amount");
  const [history, setHistory] = useState<SemanticInterfaceGraph[]>([]);
  const [future, setFuture] = useState<SemanticInterfaceGraph[]>([]);
  const [outputTarget, setOutputTarget] = useState<OutputTarget>("react");
  const [outputFilePath, setOutputFilePath] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [scenarioId, setScenarioId] = useState<ScenarioId>(`device:${demoGraph.devices.defaultProfile}`);
  const [mode, setMode] = useState<"live" | "replay">("replay");
  const [model, setModel] = useState("deterministic-sample");
  const [lastTrace, setLastTrace] = useState<TraceSummary | null>(null);
  const [notice, setNoticeText] = useState("Ready to compile the sample brief.");
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [agentDrawerOpen, setAgentDrawerOpen] = useState(false);
  const [agentPreview, setAgentPreview] = useState<{ transactionId: string; nodeIds: string[]; changes: number } | null>(null);
  const [agentReviewTarget, setAgentReviewTarget] = useState<{ key: number; threadId: string } | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [theme, setThemeState] = useState<"light" | "dark">("light");
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [repairPreview, setRepairPreview] = useState<RepairPreview | null>(null);
  const [verificationRunId, setVerificationRunId] = useState(1);
  const [verificationFocus, setVerificationFocus] = useState<{ key: number; screenId: string; nodeId: string | null; visualState: VisualState } | null>(null);
  const [verificationReturnFindingId, setVerificationReturnFindingId] = useState<string | null>(null);
  const [requestFailure, setRequestFailure] = useState<RequestFailure | null>(null);
  const [localProjectFingerprint, setLocalProjectFingerprint] = useState<string | null>(null);
  const [projectType, setProjectType] = useState<ProjectType>("application");
  const [projectSource, setProjectSource] = useState<ProjectSource>("example");
  const [catalogProject, setCatalogProject] = useState<BrowserCatalogProject | null>(null);
  const [catalogSavedGraph, setCatalogSavedGraph] = useState<SemanticInterfaceGraph | null>(null);
  const [catalogSavedSnapshot, setCatalogSavedSnapshot] = useState<string | null>(null);
  const [catalogSaveState, setCatalogSaveState] = useState<"saved" | "dirty" | "saving" | "error">("saved");
  const [workspace, setWorkspace] = useState<BrowserWorkspaceState>(() => defaultWorkspaceState(demoGraph));
  const [judgeSession, setJudgeSession] = useState<JudgeSession | null>(null);
  const [catalogConflict, setCatalogConflict] = useState<BrowserCatalogProject | null>(null);
  const [pendingTabClose, setPendingTabClose] = useState<BrowserDocumentTab | null>(null);
  const lastCommit = useRef<CommitStamp>({ at: 0, notice: "", anchor: "" });
  const copyResetTimer = useRef<number | null>(null);
  const graphRef = useRef(graph);
  graphRef.current = graph;
  const graphSnapshot = useMemo(() => stableSerialize(graph), [graph]);
  const currentGraphFingerprint = useMemo(() => serializedGraphFingerprint(graphSnapshot), [graphSnapshot]);
  const graphSnapshotRef = useRef(graphSnapshot);
  graphSnapshotRef.current = graphSnapshot;
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const catalogProjectRef = useRef<BrowserCatalogProject | null>(null);
  catalogProjectRef.current = catalogProject;
  const catalogSaveChain = useRef<Promise<void>>(Promise.resolve());
  const requestSequence = useRef(0);
  const activeRequest = useRef<{ id: number; controller: AbortController } | null>(null);
  const retryRequest = useRef<(() => void) | null>(null);
  const projectMenuTrigger = useRef<HTMLButtonElement>(null);
  const projectMenuContent = useRef<HTMLDivElement>(null);
  const projectMenuWasOpen = useRef(false);
  const noticeTrigger = useRef<HTMLButtonElement>(null);
  const noticeContent = useRef<HTMLDivElement>(null);
  const resetCancelButton = useRef<HTMLButtonElement>(null);
  const resetDialog = useRef<HTMLElement>(null);
  const resetReturnFocus = useRef<HTMLElement | null>(null);
  const resetShouldRestoreFocus = useRef(false);
  const dirtyCloseCancelButton = useRef<HTMLButtonElement>(null);
  const dirtyCloseReturnFocus = useRef<HTMLElement | null>(null);
  const dirtyCloseShouldRestoreFocus = useRef(false);
  const themeTrigger = useRef<HTMLButtonElement>(null);
  const agentTrigger = useRef<HTMLButtonElement>(null);
  const agentCloseButton = useRef<HTMLButtonElement>(null);
  const judgeMode = judgeSession !== null;

  useEffect(() => {
    if (document.documentElement.dataset.theme === "dark") setThemeState("dark");
    return () => {
      if (copyResetTimer.current !== null) window.clearTimeout(copyResetTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!judgeSession) return;
    try {
      window.sessionStorage.setItem(JUDGE_SESSION_KEY, JSON.stringify(judgeSession));
    } catch {
      // A private browsing quota must not block the deterministic walkthrough.
    }
  }, [judgeSession]);

  useEffect(() => {
    if (!agentDrawerOpen) return;
    agentCloseButton.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setAgentDrawerOpen(false);
      queueMicrotask(() => agentTrigger.current?.focus());
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [agentDrawerOpen]);

  const closeAgentDrawer = () => {
    setAgentDrawerOpen(false);
    queueMicrotask(() => agentTrigger.current?.focus());
  };

  const cancelDirtyClose = () => {
    dirtyCloseShouldRestoreFocus.current = true;
    setPendingTabClose(null);
  };

  useLayoutEffect(() => {
    if (pendingTabClose || !dirtyCloseShouldRestoreFocus.current) return;
    dirtyCloseShouldRestoreFocus.current = false;
    const returnFocus = dirtyCloseReturnFocus.current;
    if (returnFocus?.isConnected) returnFocus.focus();
  }, [pendingTabClose]);

  useEffect(() => {
    if (!pendingTabClose) return;
    requestAnimationFrame(() => dirtyCloseCancelButton.current?.focus());
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      cancelDirtyClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [pendingTabClose]);

  const activateDocument = (tab: BrowserDocumentTab) => {
    setWorkspace((current) => ({ ...current, activeTabId: tab.id }));
    if (tab.kind === "screen") {
      const screen = graphRef.current.screens.find((candidate) => candidate.id === tab.screenId);
      if (screen) {
        setSelectedScreen(screen.id);
        setSelectedNodeId(screen.nodes[0]?.id ?? null);
      }
      setStage("canvas");
      return;
    }
    setOutputTarget(tab.target);
    setStage("outputs");
  };

  const closeDocument = (tab: BrowserDocumentTab, allowDirty = false) => {
    if (!allowDirty && tab.kind === "screen" && catalogSaveState !== "saved") {
      const activeIndex = workspaceRef.current.openTabs.findIndex((candidate) => candidate.id === workspaceRef.current.activeTabId);
      dirtyCloseReturnFocus.current = document.getElementById(`document-tab-${activeIndex}`);
      setPendingTabClose(tab);
      return;
    }
    setWorkspace((current) => {
      if (current.openTabs.length <= 1) return current;
      const index = current.openTabs.findIndex((candidate) => candidate.id === tab.id);
      const openTabs = current.openTabs.filter((candidate) => candidate.id !== tab.id);
      const fallback = openTabs[Math.max(0, Math.min(index, openTabs.length - 1))] ?? openTabs[0]!;
      if (current.activeTabId === tab.id) queueMicrotask(() => activateDocument(fallback));
      return {
        openTabs,
        activeTabId: current.activeTabId === tab.id ? fallback.id : current.activeTabId,
        recentlyClosed: [tab, ...current.recentlyClosed.filter((candidate) => candidate.id !== tab.id)].slice(0, 12),
      };
    });
  };

  const reopenLastDocument = () => {
    setWorkspace((current) => {
      const tab = current.recentlyClosed[0];
      if (!tab) return current;
      queueMicrotask(() => activateDocument(tab));
      return {
        openTabs: [...current.openTabs, tab],
        activeTabId: tab.id,
        recentlyClosed: current.recentlyClosed.slice(1),
      };
    });
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === "w") {
        event.preventDefault();
        const active = workspaceRef.current.openTabs.find((tab) => tab.id === workspaceRef.current.activeTabId);
        if (active) closeDocument(active);
      } else if (event.shiftKey && event.key.toLowerCase() === "t") {
        event.preventDefault();
        reopenLastDocument();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [catalogSaveState]);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setThemeState(next);
    document.documentElement.dataset.theme = next;
    try {
      window.localStorage.setItem("intentform-theme", next);
    } catch {
      // Theme preference persistence is best-effort.
    }
  };

  const setNotice = (text: string) => {
    setNoticeText(text);
    setActivity((entries) => [
      { at: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }), text },
      ...entries,
    ].slice(0, 24));
  };

  const flushCatalogSave = (): Promise<boolean> => {
    const next = catalogSaveChain.current.then(async () => {
      const current = catalogProjectRef.current;
      if (!current) return false;
      const graphSnapshot = structuredClone(graphRef.current);
      const serializedSnapshot = graphSnapshotRef.current;
      const workspaceSnapshot = structuredClone(workspaceRef.current);
      setCatalogSaveState("saving");
      const saved = await browserProjectCatalog().save(
        current.id,
        graphSnapshot,
        workspaceSnapshot,
        current.revision,
        {
          projectType,
          source: projectSource,
          ...(localProjectFingerprint ? { localFingerprint: localProjectFingerprint } : {}),
        },
      );
      if (!saved.ok) {
        setCatalogSaveState("error");
        setNotice(saved.message);
        if (saved.code === "conflict") {
          const latest = await browserProjectCatalog().get(current.id);
          if (latest && catalogProjectRef.current?.id === current.id) setCatalogConflict(latest);
        }
        return false;
      }
      catalogProjectRef.current = saved.project;
      setCatalogProject(saved.project);
      setCatalogSavedGraph(graphSnapshot);
      setCatalogSavedSnapshot(serializedSnapshot);
      const graphStillCurrent = graphSnapshotRef.current === serializedSnapshot;
      const workspaceStillCurrent = JSON.stringify(workspaceRef.current) === JSON.stringify(workspaceSnapshot);
      setCatalogSaveState(graphStillCurrent && workspaceStillCurrent ? "saved" : "dirty");
      return true;
    });
    catalogSaveChain.current = next.then(() => undefined).catch(() => {
      setCatalogSaveState("error");
      setNoticeText("The durable project save was interrupted. The previous revision remains intact.");
    });
    return next;
  };

  /* A revision conflict from another window is recoverable in place: adopt
     the other window's revision, or keep this window's edits as a new
     project. Both paths leave the catalog head untouched until chosen. */
  const resolveCatalogConflict = async (resolution: "reload" | "copy" | "restore") => {
    const conflict = catalogConflict;
    if (!conflict) return;
    setCatalogConflict(null);
    if (resolution === "restore") {
      const restored = await browserProjectCatalog().archive(conflict.id, false);
      if (!restored.ok) {
        setNotice(restored.message);
        setCatalogConflict(conflict);
        return;
      }
      catalogProjectRef.current = restored.project;
      setCatalogProject(restored.project);
      setCatalogSaveState("dirty");
      setNotice(`Restored ${restored.project.name} from the archive. Your edits in this window will save to it.`);
      void flushCatalogSave();
      return;
    }
    if (resolution === "reload") {
      const restored = conflict.graph;
      const restoredWorkspace = normalizeWorkspaceState(restored, conflict.workspace);
      const activeDocument = restoredWorkspace.openTabs.find((tab) => tab.id === restoredWorkspace.activeTabId);
      const activeScreenId = activeDocument?.kind === "screen" ? activeDocument.screenId : restored.screens[0]?.id;
      const nextScreen = restored.screens.find((screen) => screen.id === activeScreenId) ?? restored.screens[0];
      setGraph(restored);
      setBaseline(restored);
      catalogProjectRef.current = conflict;
      setCatalogProject(conflict);
      setCatalogSavedGraph(restored);
      setCatalogSavedSnapshot(stableSerialize(restored));
      setCatalogSaveState("saved");
      setWorkspace(restoredWorkspace);
      setHistory([]);
      setFuture([]);
      lastCommit.current = { at: 0, notice: "", anchor: "" };
      setSelectedScreen(nextScreen?.id ?? "");
      setSelectedNodeId(nextScreen?.nodes[0]?.id ?? null);
      setNotice(`Reloaded ${conflict.name} at revision r${conflict.revision} from the other window.`);
      return;
    }
    const created = await browserProjectCatalog().create(structuredClone(graphRef.current), { projectType, source: "created" });
    if (!created.ok) {
      setNotice(created.message);
      setCatalogConflict(conflict);
      return;
    }
    setActiveBrowserProject(window.localStorage, created.project.id);
    catalogProjectRef.current = created.project;
    setCatalogProject(created.project);
    setCatalogSavedGraph(created.project.graph);
    setCatalogSavedSnapshot(stableSerialize(created.project.graph));
    setCatalogSaveState("saved");
    setNotice(`Saved this window's edits as a separate project. ${conflict.name} keeps the other window's revision.`);
  };

  useEffect(() => {
    let cancelled = false;
    const restoreProject = (project: BrowserCatalogProject, notice: string) => {
      if (cancelled) return;
      const restored = project.graph;
      const legacyScreen = project.source === "recovery" && project.revision === 1
        ? restored.screens.find((screen) => screen.id === selectedScreen)
        : undefined;
      const restoredWorkspace = legacyScreen
        ? {
            openTabs: [{ id: `screen:${legacyScreen.id}`, kind: "screen" as const, screenId: legacyScreen.id, title: legacyScreen.title }],
            activeTabId: `screen:${legacyScreen.id}`,
            recentlyClosed: [],
          }
        : normalizeWorkspaceState(restored, project.workspace);
      const activeDocument = restoredWorkspace.openTabs.find((tab) => tab.id === restoredWorkspace.activeTabId);
      const activeScreenId = activeDocument?.kind === "screen" ? activeDocument.screenId : restored.screens[0]?.id;
      const nextScreen = restored.screens.find((screen) => screen.id === activeScreenId) ?? restored.screens[0];
      setGraph(restored);
      setBaseline(restored);
      setCatalogProject(project);
      catalogProjectRef.current = project;
      setCatalogSavedGraph(restored);
      setCatalogSavedSnapshot(stableSerialize(restored));
      setCatalogSaveState("saved");
      setWorkspace(restoredWorkspace);
      setProjectType(project.projectType);
      if (project.projectType === "responsive-web" && restored.platforms.some((platform) => platform.target === "web" && platform.enabled)) {
        setOutputTarget("web");
        setScenarioId(restored.web
          ? `web:${restored.web.defaultFrame}`
          : `device:${restored.devices.defaultProfile}`);
      }
      if (activeDocument?.kind === "output") {
        setOutputTarget(activeDocument.target);
        setStage("outputs");
      }
      setProjectSource(project.source);
      setLocalProjectFingerprint(project.localFingerprint ?? null);
      setSelectedScreen(nextScreen?.id ?? "");
      setSelectedNodeId(nextScreen?.nodes[0]?.id ?? null);
      setNotice(notice);
      setDraftReady(true);
    };
    void (async () => {
      try {
        const judgeLink = parseJudgeDeepLink(window.location.search);
        if (judgeLink.enabled) {
          let restoredSession = createJudgeSession(judgeLink.step);
          try {
            restoredSession = parseJudgeSession(window.sessionStorage.getItem(JUDGE_SESSION_KEY), judgeLink.step);
          } catch {
            // Session storage is optional; the deep link remains authoritative.
          }
          const sample = structuredClone(demoGraph);
          const walkthroughStep = judgeStep(restoredSession.activeStep);
          setJudgeSession(restoredSession);
          setStage(walkthroughStep.stage);
          setGraph(sample);
          setBaseline(sample);
          setCatalogProject(null);
          catalogProjectRef.current = null;
          setCatalogSavedGraph(null);
          setCatalogSavedSnapshot(null);
          setWorkspace(defaultWorkspaceState(sample));
          setProjectType("application");
          setProjectSource("example");
          setLocalProjectFingerprint(null);
          setSelectedScreen("payment-request");
          setSelectedNodeId("payment-request.amount");
          setMode("replay");
          setModel("deterministic-sample");
          setNotice("Judge Mode opened an isolated verified sample. Catalog projects will not be changed.");
          setDraftReady(true);
          return;
        }
        const migration = await migrateLegacyBrowserProject(window.localStorage);
        if (migration.warning) throw new Error(migration.warning);
        const requestedId = new URLSearchParams(window.location.search).get("project");
        const id = requestedId ?? activeBrowserProjectId(window.localStorage) ?? migration.migratedProjectId;
        if (id) {
          const project = await browserProjectCatalog().get(id);
          if (project && !project.archivedAt) {
            setActiveBrowserProject(window.localStorage, project.id);
            restoreProject(project, `Opened ${project.name} from the durable browser catalog.`);
            return;
          }
          if (!window.intentformDesktop) {
            if (cancelled) return;
            stashBootNotice(window.sessionStorage, "The requested project could not be found in this browser's catalog. It may have been deleted or archived in another window.");
            window.location.replace("/");
            return;
          }
        }
        if (window.intentformDesktop) {
          const response = await fetch("/api/project", { cache: "no-store" });
          const result = (await response.json()) as { error?: string; graph?: unknown; fingerprint?: string };
          if (!response.ok || !result.graph || typeof result.fingerprint !== "string") {
            throw new Error(result.error ?? "The granted desktop project could not be opened.");
          }
          const restored = parseGraph(result.graph);
          const created = await browserProjectCatalog().create(restored, {
            projectType: restored.web ? "responsive-web" : "application",
            source: "local",
            localFingerprint: result.fingerprint,
          });
          if (!created.ok) throw new Error(created.message);
          setActiveBrowserProject(window.localStorage, created.project.id);
          restoreProject(created.project, `Opened ${restored.product.name} from the granted desktop project.`);
          return;
        }
        window.location.replace("/");
      } catch (cause) {
        if (cancelled) return;
        stashBootNotice(window.sessionStorage, cause instanceof Error ? cause.message : "The selected project could not be opened.");
        window.location.replace("/");
      }
    })();
    return () => { cancelled = true; };
    // Restoring the draft is a mount-only concern.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!draftReady || !catalogProject || !catalogSavedGraph) return;
    const graphChanged = graphSnapshot !== catalogSavedSnapshot;
    const workspaceChanged = JSON.stringify(workspace) !== JSON.stringify(catalogProject.workspace);
    if (!graphChanged && !workspaceChanged) {
      setCatalogSaveState("saved");
      return;
    }
    setCatalogSaveState("dirty");
    const timeout = window.setTimeout(() => void flushCatalogSave(), adaptiveAutosaveDelay(graphSnapshot.length));
    return () => window.clearTimeout(timeout);
  }, [catalogProject, catalogSavedGraph, catalogSavedSnapshot, draftReady, graphSnapshot, workspace]);

  useEffect(() => {
    if (!draftReady || !catalogProject) return;
    const flushOnInterruption = () => {
      if (graphSnapshotRef.current !== catalogSavedSnapshot || JSON.stringify(workspaceRef.current) !== JSON.stringify(catalogProjectRef.current?.workspace)) {
        void flushCatalogSave();
      }
    };
    const flushWhenHidden = () => { if (document.visibilityState === "hidden") flushOnInterruption(); };
    window.addEventListener("pagehide", flushOnInterruption);
    document.addEventListener("visibilitychange", flushWhenHidden);
    return () => {
      window.removeEventListener("pagehide", flushOnInterruption);
      document.removeEventListener("visibilitychange", flushWhenHidden);
    };
  }, [catalogProject, catalogSavedSnapshot, draftReady]);

  useEffect(() => {
    if (/failed|could not|invalid|quota|unavailable|rejected|ignored|unsupported|(changed|archived) in another window/i.test(notice)) setNoticeOpen(true);
  }, [notice]);

  useEffect(() => {
    const wasOpen = projectMenuWasOpen.current;
    projectMenuWasOpen.current = menuOpen;
    if (!menuOpen) {
      if (wasOpen) projectMenuTrigger.current?.focus();
      return;
    }
    requestAnimationFrame(() => projectMenuContent.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setMenuOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [menuOpen]);

  useEffect(() => {
    if (!resetConfirmOpen) return;
    requestAnimationFrame(() => resetCancelButton.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        resetShouldRestoreFocus.current = true;
        setResetConfirmOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const controls = [...(resetDialog.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? [])];
      const first = controls[0];
      const last = controls.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [resetConfirmOpen]);

  useEffect(() => {
    if (resetConfirmOpen || !resetShouldRestoreFocus.current) return;
    resetShouldRestoreFocus.current = false;
    resetReturnFocus.current?.focus();
  }, [resetConfirmOpen]);

  useEffect(() => {
    if (!noticeOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (target && (noticeContent.current?.contains(target) || noticeTrigger.current?.contains(target))) return;
      if (event.target instanceof Element && event.target.closest('[aria-modal="true"]')) return;
      setNoticeOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (event.defaultPrevented || document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault();
      setNoticeOpen(false);
      noticeTrigger.current?.focus();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [noticeOpen]);

  const needsReactCompilation = stage === "report" || (stage === "outputs" && outputTarget === "react");
  const needsSwiftCompilation = stage === "report" || (stage === "outputs" && outputTarget === "swiftui");
  const needsExpoCompilation = stage === "report" || (stage === "outputs" && outputTarget === "expo");
  const needsWebCompilation = stage === "outputs" && outputTarget === "web";
  const reactCompilation = useMemo(
    () => needsReactCompilation ? compileStudioTarget(graph, "react") : deferredCompilation("react"),
    [graph, needsReactCompilation],
  );
  const swiftCompilation = useMemo(
    () => needsSwiftCompilation ? compileStudioTarget(graph, "swiftui") : deferredCompilation("swiftui"),
    [graph, needsSwiftCompilation],
  );
  const expoCompilation = useMemo(
    () => needsExpoCompilation ? compileStudioTarget(graph, "expo") : deferredCompilation("expo"),
    [graph, needsExpoCompilation],
  );
  const webCompilation = useMemo(
    () => needsWebCompilation ? compileStudioTarget(graph, "web") : deferredCompilation("web"),
    [graph, needsWebCompilation],
  );
  const reactOutput = reactCompilation.output;
  const swiftOutput = swiftCompilation.output;
  const expoOutput = expoCompilation.output;
  const webOutput = webCompilation.output;
  const previewProfiles = useMemo(() => editorProfiles(graph), [graph]);
  const scenarios = useMemo(() => Object.fromEntries(previewProfiles.map((profile) => [
    profile.id,
    { label: profile.label, viewport: { width: profile.width, height: profile.height } },
  ])) as Record<string, { label: string; viewport: { width: number; height: number } }>, [previewProfiles]);
  const scenario = scenarios[scenarioId] ?? scenarios[previewProfiles[0]!.id]!;
  const localChangesAreUnsaved = useMemo(
    () => hasUnsavedLocalChanges(graph, localProjectFingerprint),
    [graph, localProjectFingerprint],
  );
  const localPreviews = useLocalPreviews({
    enabled: localProjectFingerprint !== null,
    currentGraphFingerprint,
    profileId: scenarioId,
  });
  const enabledVerificationTargets = graph.platforms
    .filter((platform) => platform.enabled && ["react", "swiftui", "expo", "web"].includes(platform.target))
    .map((platform) => platform.target as OutputTarget);
  const verificationTarget = enabledVerificationTargets.includes(outputTarget)
    ? outputTarget
    : enabledVerificationTargets[0] ?? outputTarget;
  const previewEvidenceTarget: LocalPreviewTarget = verificationTarget === "swiftui"
    ? "swiftui"
    : verificationTarget === "expo"
      ? scenarioId.includes("android") ? "expo-android" : "expo-ios"
      : "browser";
  const previewEvidence = localPreviews.byTarget[previewEvidenceTarget];
  const buildStatus = localPreviews.graphIsSaved
    && previewEvidence
    && !("unavailable" in previewEvidence)
    ? previewEvidence.buildStatus
    : "not-run";
  const buildEvidenceState: BuildEvidenceState = !localProjectFingerprint
    ? "not-generated"
    : !localPreviews.graphIsSaved
      ? "stale"
      : previewEvidence && "unavailable" in previewEvidence
        ? "unavailable"
        : previewEvidence?.buildState ?? "not-run";
  const verificationScenario = useMemo(
    () => ({
      target: verificationTarget,
      viewport: scenario.viewport,
      buildStatus,
      deviceProfile: scenarioId,
      visualState: "idle",
      sourceFingerprint: currentGraphFingerprint,
    }),
    [buildStatus, currentGraphFingerprint, scenario.viewport, scenarioId, verificationRunId, verificationTarget],
  );
  const verification = useBackgroundVerification(graph, verificationScenario);
  const changes = useMemo(() => stage === "report" ? semanticDiff(baseline, graph) : [], [baseline, graph, stage]);
  const output = outputTarget === "react" ? reactOutput : outputTarget === "swiftui" ? swiftOutput : outputTarget === "expo" ? expoOutput : webOutput;
  const outputMessage = outputTarget === "react" ? reactCompilation.message : outputTarget === "swiftui" ? swiftCompilation.message : outputTarget === "expo" ? expoCompilation.message : webCompilation.message;
  const isPending = pendingAction !== null;
  const selectedCode = output?.files.find((file) => file.path === outputFilePath)
    ?? output?.files.find((file) => file.path.includes(`screens/${selectedScreen}`))
    ?? output?.files[Math.max(0, graph.screens.findIndex((screen) => screen.id === selectedScreen))]
    ?? output?.files[0];

  useEffect(() => {
    if (!localChangesAreUnsaved && catalogSaveState === "saved") return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [catalogSaveState, localChangesAreUnsaved]);

  const beginRequest = (action: PendingAction) => {
    activeRequest.current?.controller.abort();
    const request = { id: ++requestSequence.current, controller: new AbortController() };
    activeRequest.current = request;
    retryRequest.current = null;
    setRequestFailure(null);
    setPendingAction(action);
    return request;
  };

  const isCurrentRequest = (id: number) => activeRequest.current?.id === id;
  const finishRequest = (id: number) => {
    if (!isCurrentRequest(id)) return;
    activeRequest.current = null;
    setPendingAction(null);
  };

  const cancelPendingRequest = () => {
    if (!activeRequest.current || !pendingAction || pendingAction === "project-save") return;
    activeRequest.current.controller.abort();
    activeRequest.current = null;
    retryRequest.current = null;
    setPendingAction(null);
    setRequestFailure(null);
    setNotice(`${pendingAction === "repair" ? "Repair planning" : pendingAction === "interpret" ? "Intent generation" : "Project opening"} cancelled. No project changes were applied.`);
  };

  const failRequest = (message: string, retryLabel: string, retry: () => void) => {
    setNotice(message);
    retryRequest.current = retry;
    setRequestFailure({ message, retryLabel });
  };

  useEffect(() => () => activeRequest.current?.controller.abort(), []);
  const commitGraph = (nextGraph: SemanticInterfaceGraph, nextNotice: string) => {
    const validated = parseGraph(nextGraph);
    const stamp = { at: Date.now(), notice: nextNotice, anchor: `${selectedScreen}:${selectedNodeId ?? ""}` };
    if (!shouldCoalesceCommit(lastCommit.current, stamp)) {
      setHistory((items) => [...items.slice(-39), graph]);
      setFuture([]);
      setNotice(nextNotice);
    } else {
      setNoticeText(nextNotice);
    }
    lastCommit.current = stamp;
    setGraph(validated);
  };

  const applyWebImport = (projection: DomImportProjection) => {
    const importedScreen = projection.graph.screens.find((screen) => screen.id === selectedScreen);
    commitGraph(
      projection.graph,
      `Applied reviewed HTML/CSS import: ${projection.importedNodes} nodes, ${projection.changes.length} semantic changes, ${projection.diagnostics.length} explicit diagnostics.`,
    );
    setSelectedNodeId(importedScreen?.nodes[0]?.id ?? null);
  };

  const reconcileSelection = (nextGraph: SemanticInterfaceGraph) => {
    const nextSelection = reconcileGraphSelection(nextGraph, selectedScreen, selectedNodeId);
    setSelectedScreen(nextSelection.screenId);
    setSelectedNodeId(nextSelection.nodeId);
  };

  const commitExternalAssetGraph = (nextGraph: SemanticInterfaceGraph, fingerprint: string, nextNotice: string) => {
    commitGraph(nextGraph, nextNotice);
    setLocalProjectFingerprint(fingerprint);
  };

  const undo = () => {
    const previous = history.at(-1);
    if (!previous) return;
    setHistory((items) => items.slice(0, -1));
    setFuture((items) => [graph, ...items].slice(0, 40));
    setGraph(previous);
    reconcileSelection(previous);
    lastCommit.current = { at: 0, notice: "", anchor: "" };
    setNotice("Undid the last semantic edit.");
  };

  const redo = () => {
    const next = future[0];
    if (!next) return;
    setFuture((items) => items.slice(1));
    setHistory((items) => [...items.slice(-39), graph]);
    setGraph(next);
    reconcileSelection(next);
    lastCommit.current = { at: 0, notice: "", anchor: "" };
    setNotice("Restored the semantic edit.");
  };

  const revertsToSavedRevision = !judgeMode && catalogSavedGraph !== null;

  const resetProject = () => {
    if (revertsToSavedRevision && catalogSavedGraph) {
      setGraph(catalogSavedGraph);
      reconcileSelection(catalogSavedGraph);
      setHistory([]);
      setFuture([]);
      lastCommit.current = { at: 0, notice: "", anchor: "" };
      setMenuOpen(false);
      setNotice("Reverted the workspace to the last saved revision.");
      return;
    }
    setGraph(demoGraph);
    setBaseline(demoGraph);
    setWorkspace(defaultWorkspaceState(demoGraph));
    setProjectType("application");
    setProjectSource("example");
    setLocalProjectFingerprint(null);
    setHistory([]);
    setFuture([]);
    setSelectedScreen("payment-request");
    setSelectedNodeId("payment-request.amount");
    lastCommit.current = { at: 0, notice: "", anchor: "" };
    setMenuOpen(false);
    setNotice("Reset the workspace to the verified sample project.");
  };

  const requestProjectReset = () => {
    resetReturnFocus.current = projectMenuTrigger.current;
    setMenuOpen(false);
    setResetConfirmOpen(true);
  };

  const cancelProjectReset = () => {
    resetShouldRestoreFocus.current = true;
    setResetConfirmOpen(false);
  };

  const confirmProjectReset = () => {
    setResetConfirmOpen(false);
    resetProject();
  };

  const openJudgeStep = (stepId: JudgeStepId) => {
    const step = judgeStep(stepId);
    setJudgeSession((current) => current ? selectJudgeStep(current, stepId) : createJudgeSession(stepId));
    setStage(step.stage);
    window.history.replaceState(null, "", judgeDeepLink(stepId));
    document.getElementById("studio-workspace")?.focus();
  };

  const advanceJudgeMode = () => {
    if (!judgeSession) return;
    if (judgeSession.completed.length === judgeSteps.length) {
      resetJudgeMode();
      return;
    }
    const next = advanceJudgeSession(judgeSession);
    setJudgeSession(next);
    setStage(judgeStep(next.activeStep).stage);
    window.history.replaceState(null, "", judgeDeepLink(next.activeStep));
  };

  const resetJudgeMode = () => {
    resetProject();
    const next = createJudgeSession();
    setJudgeSession(next);
    setStage("canvas");
    setMode("replay");
    setModel("deterministic-sample");
    window.history.replaceState(null, "", judgeDeepLink("design"));
    setNotice("Judge Mode reset to a clean isolated sample.");
  };

  const exitJudgeMode = () => {
    try {
      window.sessionStorage.removeItem(JUDGE_SESSION_KEY);
    } catch {
      // Session storage is best-effort.
    }
    window.location.assign("/");
  };

  const exportGraph = () => {
    const blob = new Blob([stableSerialize(graph)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${graph.product.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.intentform.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setMenuOpen(false);
    setNotice("Exported the semantic graph as canonical JSON.");
  };

  /* The `.intentform/` project on disk is shared with the MCP server, so
     Claude Code, Codex and the Studio edit the same validated graph. */
  const openLocalProject = () => {
    setMenuOpen(false);
    const active = beginRequest("project-open");
    void (async () => {
      try {
        const response = await fetch("/api/project", { signal: active.controller.signal, cache: "no-store" });
        const result = (await response.json()) as { error?: string; graph?: unknown; fingerprint?: string; seeded?: boolean };
        if (!response.ok || !result.graph || typeof result.fingerprint !== "string" || typeof result.seeded !== "boolean") {
          throw new Error(result.error ?? "No local .intentform project is available in this deployment.");
        }
        const nextGraph = parseGraph(result.graph);
        if (!isCurrentRequest(active.id)) return;
        setGraph(nextGraph);
        setBaseline(nextGraph);
        setHistory([]);
        setFuture([]);
        setLocalProjectFingerprint(result.fingerprint);
        setProjectType("application");
        setProjectSource("local");
        const nextScreen = nextGraph.screens.find((screen) => screen.id === selectedScreen) ?? nextGraph.screens[0];
        setSelectedScreen(nextScreen?.id ?? "");
        setSelectedNodeId(nextScreen?.nodes[0]?.id ?? null);
        lastCommit.current = { at: 0, notice: "", anchor: "" };
        setNotice(result.seeded
          ? "Initialized .intentform/graph.json from the verified sample and opened it."
          : "Opened the local .intentform project. Agent edits are now on the board.");
      } catch (error) {
        if (!isCurrentRequest(active.id) || active.controller.signal.aborted) return;
        failRequest(
          error instanceof Error ? error.message : "The local project could not be opened.",
          "Retry open",
          openLocalProject,
        );
      } finally {
        finishRequest(active.id);
      }
    })();
  };

  const saveLocalProject = () => {
    setMenuOpen(false);
    if (!localProjectFingerprint) {
      failRequest(
        "Open the local .intentform project before saving so IntentForm can detect intervening agent edits.",
        "Open local project",
        openLocalProject,
      );
      return;
    }
    const active = beginRequest("project-save");
    const graphToSave = graph;
    const expectedFingerprint = localProjectFingerprint;
    void (async () => {
      try {
        const response = await fetch("/api/project", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ graph: graphToSave, reason: "studio save", expectedFingerprint }),
          signal: active.controller.signal,
        });
        const result = (await response.json()) as { error?: string; fingerprint?: string; currentFingerprint?: string };
        if (response.status === 409) {
          throw new LocalProjectConflictError(result.error ?? "The local project changed after it was opened.");
        }
        if (!response.ok || typeof result.fingerprint !== "string") {
          throw new Error(result.error ?? "The graph could not be saved to the local project.");
        }
        if (!isCurrentRequest(active.id)) return;
        setLocalProjectFingerprint(result.fingerprint);
        setNotice(graphRef.current === graphToSave
          ? "Saved the graph atomically to .intentform/graph.json for the MCP server and coding agents."
          : "Saved the captured graph revision atomically; newer Studio edits remain unsaved.");
      } catch (error) {
        if (!isCurrentRequest(active.id) || active.controller.signal.aborted) return;
        if (error instanceof LocalProjectConflictError) {
          failRequest(error.message, "Open latest project", openLocalProject);
          return;
        }
        failRequest(
          error instanceof Error ? error.message : "The local project could not be saved.",
          "Retry save",
          saveLocalProject,
        );
      } finally {
        finishRequest(active.id);
      }
    })();
  };

  const copyGeneratedFile = async () => {
    if (!selectedCode) return;
    try {
      await navigator.clipboard.writeText(selectedCode.content);
      setCopied(true);
      if (copyResetTimer.current !== null) window.clearTimeout(copyResetTimer.current);
      copyResetTimer.current = window.setTimeout(() => {
        copyResetTimer.current = null;
        setCopied(false);
      }, 1600);
    } catch {
      setNotice("The browser blocked clipboard access, so nothing was copied.");
    }
  };

  const compileBrief = (operation: "create" | "edit" = briefOperation) => {
    const active = beginRequest("interpret");
    const baseSnapshot = stableSerialize(graph);
    const instruction = operation === "edit" ? editInstruction : brief;
    const graphToEdit = graph;
    const screenToEdit = selectedScreen;
    void (async () => {
      try {
        setNotice(operation === "edit" ? "Planning the smallest typed semantic edit…" : "Interpreting product intent and validating the graph…");
        const response = await fetch("/api/interpret", {
          method: "POST",
          headers: { "content-type": "application/json", "x-intentform-session": getSessionId() },
          body: JSON.stringify({ brief: instruction, operation, ...(operation === "edit" ? { graph: graphToEdit, screenId: screenToEdit } : {}) }),
          signal: active.controller.signal,
        });
        const payload = (await response.json()) as { error?: string; graph?: unknown; mode?: "live" | "replay"; model?: string; note?: string; trace?: TraceSummary };
        if (!response.ok || !payload.graph || !payload.mode || !payload.model || !payload.note) {
          throw new Error(payload.error ?? (operation === "edit" ? "The semantic edit could not be interpreted." : "The brief could not be interpreted."));
        }
        const result = payload as { graph: unknown; mode: "live" | "replay"; model: string; note: string; trace?: TraceSummary };
        const nextGraph = parseGraph(result.graph);
        if (!isCurrentRequest(active.id)) return;
        if (operation === "edit" && graphSnapshotRef.current !== baseSnapshot) {
          throw new Error("The graph changed while the edit was being planned. Review the current graph and retry the edit.");
        }
        if (operation === "edit") commitGraph(nextGraph, result.note);
        else {
          setGraph(nextGraph);
          setBaseline(nextGraph);
          setProjectType("application");
          setProjectSource("created");
          setLocalProjectFingerprint(null);
          setHistory([]);
          setFuture([]);
        }
        setMode(result.mode);
        setModel(result.model);
        setLastTrace(result.trace ?? null);
        setNotice(result.note);
        const nextScreen = nextGraph.screens.find((screen) => screen.id === "payment-request") ?? nextGraph.screens[0];
        setSelectedScreen(nextScreen?.id ?? "");
        setSelectedNodeId(nextScreen?.nodes[0]?.id ?? null);
        setStage("canvas");
      } catch (error) {
        if (!isCurrentRequest(active.id) || active.controller.signal.aborted) return;
        failRequest(
          error instanceof Error ? error.message : "Interpretation failed.",
          operation === "edit" ? "Retry edit" : "Retry compile",
          () => compileBrief(operation),
        );
      } finally {
        finishRequest(active.id);
      }
    })();
  };

  const previewFindingRepair = (finding: VerificationFinding) => {
    const active = beginRequest("repair");
    const baseSnapshot = stableSerialize(graph);
    const graphToRepair = graph;
    const scenarioToVerify = verification.scenario;
    void (async () => {
      try {
        setNotice("Planning the smallest evidence-backed repair…");
        const response = await fetch("/api/repair", {
          method: "POST",
          headers: { "content-type": "application/json", "x-intentform-session": getSessionId() },
          body: JSON.stringify({
            graph: graphToRepair,
            finding,
            scenario: { target: scenarioToVerify.target, viewport: scenarioToVerify.viewport },
          }),
          signal: active.controller.signal,
        });
        const payload = (await response.json()) as { error?: string; proposal?: RepairProposal; mode?: "live" | "replay"; model?: string; trace?: TraceSummary };
        if (!response.ok || !payload.proposal || !payload.mode || !payload.model) throw new Error(payload.error ?? "A safe repair could not be planned.");
        const result = payload as { proposal: RepairProposal; mode: "live" | "replay"; model: string; trace?: TraceSummary };
        if (!isCurrentRequest(active.id)) return;
        if (graphSnapshotRef.current !== baseSnapshot) {
          throw new Error("The graph changed while the repair was being planned. Re-run verification before retrying.");
        }
        const preview = createRepairPreview(graphToRepair, finding, result.proposal, currentGraphFingerprint);
        setRepairPreview(preview);
        setMode(result.mode);
        setModel(result.model);
        setLastTrace(result.trace ?? null);
        setNotice(`Repair preview ready · ${preview.changes.length} semantic change${preview.changes.length === 1 ? "" : "s"}. The graph is unchanged.`);
      } catch (error) {
        if (!isCurrentRequest(active.id) || active.controller.signal.aborted) return;
        failRequest(
          error instanceof Error ? error.message : "Repair failed.",
          "Retry repair",
          () => previewFindingRepair(finding),
        );
      } finally {
        finishRequest(active.id);
      }
    })();
  };

  const applyFindingRepair = () => {
    if (!repairPreview) return;
    if (repairPreview.sourceFingerprint !== currentGraphFingerprint) {
      setRepairPreview(null);
      setNotice("The graph changed after this repair was previewed. Re-run verification and create a new preview.");
      return;
    }
    commitGraph(repairPreview.repairedGraph, repairPreview.proposal.summary);
    setRepairPreview(null);
    setVerificationRunId((current) => current + 1);
    setStage("verify");
  };

  const rerunVerification = () => {
    setRepairPreview(null);
    setVerificationRunId((current) => current + 1);
    void localPreviews.refresh();
    setNotice(`Verification re-run requested for ${scenario.label} · ${currentGraphFingerprint}.`);
  };

  const inspectVerificationFinding = (finding: VerificationFinding) => {
    const target = verificationNavigationTarget(graph, finding, new Set(Object.keys(scenarios)), currentGraphFingerprint);
    if (!target) {
      setNotice(`The exact evidence target for ${finding.id} no longer exists. Re-run verification against the current graph.`);
      return;
    }
    setSelectedScreen(target.screenId);
    setSelectedNodeId(target.nodeId);
    if (target.deviceProfile) setScenarioId(target.deviceProfile as ScenarioId);
    setVerificationFocus({
      key: Date.now(),
      screenId: target.screenId,
      nodeId: target.nodeId,
      visualState: target.visualState as VisualState,
    });
    setVerificationReturnFindingId(finding.id);
    setStage("canvas");
    setNotice(`Showing the exact evidence target for ${finding.id}.`);
  };

  const previewAgentChanges = (reviewChanges: AgentReviewChange[], transactionId: string) => {
    const nodeIds = graph.screens.flatMap((screen) => flattenSemanticNodes(screen.nodes))
      .filter((node) => reviewChanges.some((change) => change.path === node.id || change.path.startsWith(`${node.id}.`)))
      .map((node) => node.id);
    setAgentPreview({ transactionId, nodeIds, changes: reviewChanges.length });
    for (const screen of graph.screens) {
      const nodes = flattenSemanticNodes(screen.nodes).sort((left, right) => right.id.length - left.id.length);
      const affected = nodes.find((node) => reviewChanges.some((change) => change.path === node.id || change.path.startsWith(`${node.id}.`)));
      if (!affected) continue;
      setSelectedScreen(screen.id);
      setSelectedNodeId(affected.id);
      setStage("canvas");
      setAgentDrawerOpen(false);
      setNotice(`Previewing ${reviewChanges.length} proposed agent changes. The canonical graph is unchanged until you commit.`);
      return;
    }
    setStage("graph");
    setAgentDrawerOpen(false);
    setNotice(`Previewing ${reviewChanges.length} proposed project-level agent changes. The canonical graph is unchanged until you commit.`);
  };

  const openAgentLinkedComment = (commentId: string, reviewChanges: AgentReviewChange[], transactionId: string) => {
    const thread = graph.reviewThreads.find((candidate) => candidate.id === commentId);
    if (!thread) {
      setNotice(`The linked review comment ${commentId} no longer exists in the current graph. No project changes were applied.`);
      return;
    }
    setAgentPreview({
      transactionId,
      changes: reviewChanges.length,
      nodeIds: thread.anchor.nodeId ? [thread.anchor.nodeId] : [],
    });
    setSelectedScreen(thread.anchor.screenId);
    setSelectedNodeId(thread.anchor.nodeId ?? null);
    setAgentReviewTarget({ key: Date.now(), threadId: thread.id });
    setStage("canvas");
    setAgentDrawerOpen(false);
    setNotice(`Opened review comment ${thread.id} with its linked agent transaction preview. The canonical graph is unchanged.`);
  };

  const inspectGeneratedNode = (nodeId: string) => {
    const screen = graph.screens.find((item) => flattenSemanticNodes(item.nodes).some((node) => node.id === nodeId));
    if (!screen) {
      setNotice(`The source link for ${nodeId} no longer exists in the current graph.`);
      return;
    }
    setSelectedScreen(screen.id);
    setSelectedNodeId(nodeId);
    setStage("canvas");
    setNotice(`Showing ${nodeId}, linked exactly from generated source.`);
  };

  const errorCount = verification.findings.filter((finding) => finding.severity === "error" && finding.status !== "suppressed").length;
  const noticeIsError = /failed|could not|invalid|quota|unavailable|rejected/i.test(notice);
  const focusDocumentAt = (index: number) => {
    const count = workspace.openTabs.length;
    if (count === 0) return;
    const normalized = ((index % count) + count) % count;
    const tab = workspace.openTabs[normalized]!;
    activateDocument(tab);
    requestAnimationFrame(() => document.getElementById(`document-tab-${normalized}`)?.focus());
  };
  const openAnotherDocument = () => {
    const openIds = new Set(workspace.openTabs.map((tab) => tab.id));
    const screen = graph.screens.find((candidate) => !openIds.has(`screen:${candidate.id}`));
    const target = graph.platforms
      .filter((platform) => platform.enabled)
      .map((platform) => platform.target)
      .find((candidate): candidate is OutputTarget => candidate !== "compose" && !openIds.has(`output:${candidate}`));
    const tab: BrowserDocumentTab | undefined = screen
      ? { id: `screen:${screen.id}`, kind: "screen", screenId: screen.id, title: screen.title }
      : target
        ? { id: `output:${target}`, kind: "output", target, title: `${target} output` }
        : workspace.recentlyClosed[0];
    if (!tab) return;
    setWorkspace((current) => ({
      openTabs: current.openTabs.some((candidate) => candidate.id === tab.id) ? current.openTabs : [...current.openTabs, tab],
      activeTabId: tab.id,
      recentlyClosed: current.recentlyClosed.filter((candidate) => candidate.id !== tab.id),
    }));
    activateDocument(tab);
  };

  if (!draftReady) {
    return (
      <main className="studio-grain grid h-[100dvh] place-items-center overflow-hidden text-[var(--ink)]">
        <div role="status" aria-live="polite" className="flex flex-col items-center gap-3.5">
          <BrandMark size={28} />
          <div aria-hidden="true" className="skeleton-block h-1 w-40 overflow-hidden rounded-full" />
          <p className="text-[11px] text-[var(--muted)]">Opening project…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="studio-grain h-[100dvh] overflow-hidden text-[var(--ink)]">
      <a className="skip-link" href="#studio-workspace">Skip to workspace</a>
      <div className="studio-root-grid grid h-full min-h-0 grid-rows-[34px_38px_minmax(0,1fr)] bg-[var(--if-panel)]">
        <div className="studio-document-tabs relative z-[6] flex min-w-0 items-end overflow-hidden border-b border-[var(--line)] bg-[var(--app-bg,var(--canvas))] px-2 pt-1">
          <div role="tablist" aria-label="Open project documents" className="flex min-w-0 items-end gap-px overflow-x-auto [scrollbar-width:none]">
          {workspace.openTabs.map((tab, tabIndex) => {
            const active = tab.id === workspace.activeTabId;
            const TabIcon = tab.kind === "screen" ? BracketsCurly : Code;
            return (
              <button
                key={tab.id}
                type="button"
                id={`document-tab-${tabIndex}`}
                role="tab"
                tabIndex={active ? 0 : -1}
                aria-selected={active}
                aria-label={tab.title}
                onClick={() => activateDocument(tab)}
                onAuxClick={(event) => { if (event.button === 1) closeDocument(tab); }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowLeft") { event.preventDefault(); focusDocumentAt(tabIndex - 1); }
                  else if (event.key === "ArrowRight") { event.preventDefault(); focusDocumentAt(tabIndex + 1); }
                  else if (event.key === "Home") { event.preventDefault(); focusDocumentAt(0); }
                  else if (event.key === "End") { event.preventDefault(); focusDocumentAt(workspace.openTabs.length - 1); }
                }}
                className={`group flex h-[33px] min-w-0 max-w-56 items-center rounded-t-[6px] border border-b-0 text-[10.5px] leading-[15px] ${active ? "border-[var(--line)] bg-[var(--surface)] font-medium text-[var(--ink)]" : "border-transparent font-normal text-[var(--faint)] hover:bg-[var(--hover)] hover:text-[var(--muted)]"}`}
              >
                <span className="flex h-full min-w-0 flex-1 items-center gap-1.5 px-2.5 text-left outline-none">
                  <TabIcon size={13} className="shrink-0 text-[var(--accent)]" />
                  <span className="truncate">{tab.title}</span>
                  {tab.kind === "screen" && (catalogSaveState !== "saved" || localChangesAreUnsaved) ? <span className="size-1.5 shrink-0 rounded-full bg-[var(--warning,#e4ad5a)]" aria-label={localChangesAreUnsaved ? "Unsaved local changes" : "Unsaved project changes"} /> : null}
                  {tab.kind === "screen" && agentDrawerOpen ? <span className="size-1.5 shrink-0 rounded-full bg-[var(--success,#55c58b)]" aria-label="Agent operation active" /> : null}
                </span>
              </button>
            );
          })}
          </div>
          <button type="button" aria-label="Close active document" onClick={() => {
            const active = workspace.openTabs.find((tab) => tab.id === workspace.activeTabId);
            if (active) closeDocument(active);
          }} disabled={workspace.openTabs.length <= 1} className="mb-0.5 grid size-7 shrink-0 place-items-center rounded-[5px] text-[var(--muted)] hover:bg-[var(--hover)] disabled:opacity-25"><X size={12} /></button>
          <button type="button" aria-label="Open another document" onClick={openAnotherDocument} className="mb-0.5 grid size-7 shrink-0 place-items-center rounded-[5px] text-[var(--muted)] hover:bg-[var(--hover)]"><Plus size={13} /></button>
        </div>
        <header className="studio-topbar relative z-[5] grid h-[38px] grid-cols-[auto_minmax(0,1fr)_auto] items-center overflow-visible border-b border-[var(--if-border-subtle)] px-2">
          <div className="flex min-w-0 items-center gap-2">
            <div className="relative">
              <button
                ref={projectMenuTrigger}
                type="button"
                aria-label="IntentForm project menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((open) => !open)}
                className="grid size-7 shrink-0 place-items-center rounded-[6px] transition-transform active:scale-[.96]"
              >
                <BrandMark size={28} />
              </button>
              {menuOpen ? (
                <>
                  <button type="button" aria-label="Close project menu" onClick={() => setMenuOpen(false)} className="fixed inset-0 z-[5] cursor-default" tabIndex={-1} />
                  <div ref={projectMenuContent} role="menu" aria-label="IntentForm project" className="menu-pop absolute left-0 top-10 z-[6] w-64 p-1.5">
                    <div className="border-b border-[var(--line)] px-2.5 pb-2 pt-1.5">
                      <strong className="block text-[12px]">{graph.product.name}</strong>
                      <span className="mt-0.5 block font-mono text-[10px] text-[var(--faint)]">{graph.product.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.intentform · v{graph.schemaVersion}</span>
                    </div>
                    <a href="/" role="menuitem" onClick={() => setMenuOpen(false)} className="mt-1 flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[12px] text-[var(--t-strong)] hover:bg-[var(--hover)]">
                      <ArrowLeft size={13} /> Back to project launcher
                    </a>
                    <button type="button" role="menuitem" onClick={openLocalProject} disabled={isPending} className="flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[12px] text-[var(--t-strong)] hover:bg-[var(--hover)] disabled:cursor-wait disabled:opacity-50">
                      <FolderOpen size={13} /> Open local project
                    </button>
                    <button type="button" role="menuitem" onClick={saveLocalProject} disabled={isPending} className="flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[12px] text-[var(--t-strong)] hover:bg-[var(--hover)] disabled:cursor-wait disabled:opacity-50">
                      <FloppyDisk size={13} /> Save to local project
                    </button>
                    <div className="my-1 border-t border-[var(--line)]" />
                    <button type="button" role="menuitem" onClick={exportGraph} className="flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[12px] text-[var(--t-strong)] hover:bg-[var(--hover)]">
                      <DownloadSimple size={13} /> Export graph as JSON
                    </button>
                    <div className="my-1 border-t border-[var(--line)]" />
                    <button type="button" role="menuitem" onClick={() => { setStage("brief"); setMenuOpen(false); }} className="flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[12px] text-[var(--t-strong)] hover:bg-[var(--hover)]"><Sparkle size={13} /> Product brief</button>
                    <button type="button" role="menuitem" onClick={() => { setStage("graph"); setMenuOpen(false); }} className="flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[12px] text-[var(--t-strong)] hover:bg-[var(--hover)]"><TreeStructure size={13} /> Semantic graph</button>
                    <button type="button" role="menuitem" onClick={() => { setStage("report"); setMenuOpen(false); }} className="flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[12px] text-[var(--t-strong)] hover:bg-[var(--hover)]"><FileText size={13} /> Proof report</button>
                  </div>
                </>
              ) : null}
            </div>
            <div className="hidden min-w-0 sm:block">
              <div className="flex items-center gap-1 text-[12.5px] font-medium leading-[17px] tracking-[-.01em]">
                <span className="truncate">{graph.product.name}</span><CaretDown size={10} className="text-[var(--muted)]" />
              </div>
              <span className="block truncate font-mono text-[9.5px] leading-[13px] text-[var(--faint)]">{graph.product.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.intentform</span>
            </div>
            <div className="flex items-center gap-1 text-[9px] font-semibold text-[var(--muted)] sm:hidden" aria-label={mode === "live" ? `Live model: ${model}` : `Deterministic replay: ${model}`}>
              <span className={`size-1.5 rounded-full ${mode === "live" ? "bg-[var(--success)]" : "bg-[var(--warn)]"}`} aria-hidden="true" />
              {mode === "live" ? "Live" : "Replay"}
            </div>
          </div>

          <nav aria-label="Workspace" className="mx-auto flex h-[26px] min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]">
            {primaryStages.map((item) => {
              const Icon = item.icon;
              const active = stage === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  title={item.label}
                  aria-label={item.label}
                  aria-current={active ? "page" : undefined}
                  data-state={active ? "active" : "idle"}
                  onClick={() => setStage(item.id)}
                  className="if-editor-segment group relative flex h-6 min-w-[62px] items-center justify-center gap-1 px-2 text-[10.5px] font-medium leading-[15px]"
                >
                  <Icon size={12} weight={active ? "fill" : "regular"} />
                  <span>{item.shortLabel}</span>
                  {item.id === "verify" && errorCount > 0 ? (
                    <span className="absolute -right-0.5 -top-0.5 grid size-3 place-items-center rounded-full bg-[var(--danger)] font-mono text-[8px] font-medium text-white">{errorCount}</span>
                  ) : null}
                </button>
              );
            })}
          </nav>

          <div className="flex items-center justify-end gap-1">
            {judgeMode ? <span className="hidden h-6 items-center rounded-[5px] border border-[var(--if-blue)]/35 bg-[var(--if-blue-soft)] px-2 font-mono text-[8.5px] font-semibold uppercase tracking-[.1em] text-[var(--if-blue-text)] md:inline-flex">Judge replay</span> : null}
            {pendingAction && pendingAction !== "project-save" ? <button type="button" onClick={cancelPendingRequest} className="h-7 rounded-[5px] border border-[var(--warn)]/35 px-2 text-[9.5px] font-medium text-[var(--warn)]">Cancel {pendingAction === "repair" ? "repair" : pendingAction === "interpret" ? "generation" : "open"}</button> : null}
            <button
              ref={themeTrigger}
              type="button"
              aria-label="Toggle color theme"
              aria-pressed={theme === "dark"}
              onClick={toggleTheme}
              className="hidden size-7 place-items-center rounded-[5px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] sm:grid"
            >
              {theme === "dark" ? <Sun size={14} weight="fill" /> : <Moon size={14} />}
            </button>
            <div className="relative" onPointerDown={(event) => event.stopPropagation()}>
              <button ref={noticeTrigger} type="button" aria-label="Show workspace status" aria-expanded={noticeOpen} onClick={() => setNoticeOpen((open) => !open)} className="grid size-7 place-items-center rounded-[5px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]">
                {noticeIsError ? <Warning size={14} weight="fill" className="text-[var(--danger)]" /> : <CheckCircle size={14} weight="fill" className="text-[var(--accent)]" />}
              </button>
              {noticeOpen ? (
                <div ref={noticeContent} role="region" aria-label="Workspace status" className="menu-pop absolute right-0 top-10 z-[6] w-[min(320px,calc(100vw-24px))] overflow-hidden">
                  <div role="status" aria-live="polite" className="border-b border-[var(--line)] p-3 text-[12px] leading-relaxed text-[var(--ink)]">{notice}</div>
                  {catalogConflict ? (
                    <div className="border-b border-[var(--line)] p-2.5" data-testid="catalog-conflict-actions">
                      <p className="text-[10.5px] leading-relaxed text-[var(--muted)]">{catalogConflict.archivedAt
                        ? "This project was archived in another window. Choose how to continue; nothing is overwritten until you decide."
                        : `Another window saved revision r${catalogConflict.revision}. Choose how to continue; nothing is overwritten until you decide.`}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {catalogConflict.archivedAt
                          ? <button type="button" onClick={() => void resolveCatalogConflict("restore")} className="inline-flex h-7 items-center rounded-[5px] bg-[var(--accent-deep)] px-2.5 text-[10.5px] font-semibold text-white hover:brightness-105">Restore project</button>
                          : <button type="button" onClick={() => void resolveCatalogConflict("reload")} className="inline-flex h-7 items-center rounded-[5px] bg-[var(--accent-deep)] px-2.5 text-[10.5px] font-semibold text-white hover:brightness-105">Reload latest revision</button>}
                        <button type="button" onClick={() => void resolveCatalogConflict("copy")} className="inline-flex h-7 items-center rounded-[5px] border border-[var(--line)] px-2.5 text-[10.5px] font-semibold text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]">Save my edits as a copy</button>
                      </div>
                    </div>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-1 border-b border-[var(--line)] p-2"><DesktopControl /><EcosystemControl /><ModeBadge mode={mode} model={model} trace={lastTrace} /></div>
                  {activity.length > 1 ? (
                    <div className="max-h-56 overflow-auto p-1.5">
                      <span className="block px-1.5 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-[.12em] text-[var(--faint)]">Recent activity</span>
                      {activity.slice(1).map((entry, index) => (
                        <div key={`${entry.at}-${index}`} className="grid grid-cols-[auto_1fr] gap-2 rounded-md px-1.5 py-1.5 text-[11px] leading-relaxed text-[var(--muted)]">
                          <span className="font-mono text-[10px] text-[var(--faint)]">{entry.at}</span>
                          <span>{entry.text}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setStage("outputs")}
              className="hidden h-7 items-center gap-1.5 rounded-[5px] border border-[var(--if-border)] bg-[var(--if-raised)] px-2.5 text-[10.5px] font-medium hover:bg-[var(--if-hover)] sm:inline-flex"
            >
              <Code size={13} /> Build
            </button>
            <button
              ref={agentTrigger}
              type="button"
              aria-expanded={agentDrawerOpen}
              onClick={() => setAgentDrawerOpen(true)}
              className="inline-flex h-7 items-center gap-1.5 rounded-[5px] bg-[var(--if-blue-action)] px-2.5 text-[10.5px] font-medium text-white hover:bg-[var(--if-blue-action-hover)] disabled:cursor-wait disabled:opacity-70"
            >
              <Lightning size={14} weight="fill" />
              <span className="hidden sm:inline">Ask agent</span>
            </button>
          </div>
          {isPending ? <div className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-[var(--line)]"><motion.span className="block h-full w-1/3 bg-[var(--accent)]" initial={{ x: "-100%" }} animate={{ x: "300%" }} transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }} /></div> : null}
        </header>

        <section id="studio-workspace" tabIndex={-1} className="relative min-h-0 min-w-0 overflow-hidden" aria-busy={isPending} aria-label={`${stages.find((item) => item.id === stage)?.label ?? stage} workspace`}>
          {stage === "canvas" && verificationReturnFindingId ? (
            <div className="absolute left-1/2 top-3 z-[9] flex -translate-x-1/2 items-center gap-2 rounded-[6px] border border-[var(--if-blue)]/40 bg-[var(--if-panel)] px-2.5 py-1.5 text-[10px] shadow-[var(--if-shadow-menu)]">
              <span className="max-w-[42vw] truncate text-[var(--if-text-secondary)]">Inspecting {verificationReturnFindingId}</span>
              <button type="button" onClick={() => { setStage("verify"); setVerificationReturnFindingId(null); }} className="h-6 rounded-[4px] bg-[var(--if-blue-action)] px-2 font-medium text-white">Return to Verify</button>
            </div>
          ) : null}
          {pendingAction ? (
            <span className="sr-only" role="status" aria-live="polite">Request in progress: {pendingAction}.</span>
          ) : null}
          {requestFailure ? (
            <div className="pointer-events-none absolute inset-x-0 top-3 z-[8] flex justify-center px-3">
              <div role="alert" className="pointer-events-auto flex max-w-2xl items-center gap-3 rounded-[8px] border border-[var(--danger)]/35 bg-[var(--danger-soft)] px-3 py-2 text-[11px] text-[var(--ink)] shadow-[var(--if-shadow-menu)]">
                <Warning size={15} weight="fill" className="shrink-0 text-[var(--danger)]" />
                <span className="min-w-0 flex-1 leading-relaxed">{requestFailure.message}</span>
                <button type="button" onClick={() => retryRequest.current?.()} disabled={isPending} className="h-7 shrink-0 rounded-[5px] bg-[var(--danger)] px-2.5 font-medium text-white disabled:opacity-50">
                  {requestFailure.retryLabel}
                </button>
                <button type="button" aria-label="Dismiss request error" onClick={() => setRequestFailure(null)} className="h-7 shrink-0 rounded-[5px] px-2 font-medium text-[var(--danger)] hover:bg-[var(--hover)]">
                  Dismiss
                </button>
              </div>
            </div>
          ) : null}
          <AnimatePresence mode="wait">
            <motion.div
              key={stage}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ type: "spring", stiffness: 120, damping: 20 }}
              className={stage === "canvas" ? "h-full" : stage === "outputs" || stage === "verify" ? "h-full overflow-hidden p-2 md:p-3" : "h-full overflow-auto p-5 md:p-8"}
            >
              {stage === "canvas" ? (
                <ManualEditor
                  key={catalogProject?.id ?? graph.product.name}
                  projectId={catalogProject?.id ?? graph.product.name}
                  graph={graph}
                  selectedScreen={selectedScreen}
                  selectedNodeId={selectedNodeId}
                  canUndo={history.length > 0}
                  canRedo={future.length > 0}
                  findings={verification.findings}
                  deviceId={scenarioId}
                  localProjectEnabled={localProjectFingerprint !== null}
                  localProjectFingerprint={localProjectFingerprint}
                  localProjectSaved={localProjectFingerprint !== null && !localChangesAreUnsaved}
                  verificationFocus={verificationFocus}
                  agentPreview={agentPreview}
                  agentReviewTarget={agentReviewTarget}
                  onClearAgentPreview={() => setAgentPreview(null)}
                  onSelectScreen={setSelectedScreen}
                  onDeviceId={setScenarioId}
                  onSelectNode={setSelectedNodeId}
                  onCommit={commitGraph}
                  onExternalAssetCommit={commitExternalAssetGraph}
                  onNotice={setNotice}
                  onUndo={undo}
                  onRedo={redo}
                  onOpenStage={setStage}
                  onResetProject={requestProjectReset}
                  resetProjectLabel={revertsToSavedRevision ? "Revert to saved revision" : "Reset to verified sample"}
                  onExportGraph={exportGraph}
                />
              ) : null}

              {stage === "brief" ? (
                <BriefStage
                  brief={brief}
                  setBrief={setBrief}
                  editInstruction={editInstruction}
                  setEditInstruction={setEditInstruction}
                  briefOperation={briefOperation}
                  setBriefOperation={setBriefOperation}
                  compileBrief={compileBrief}
                  isPending={isPending}
                  graph={graph}
                  selectedScreen={selectedScreen}
                />
              ) : null}

              {stage === "graph" ? (
                <GraphStage
                  graph={graph}
                  selectedScreen={selectedScreen}
                  setSelectedScreen={setSelectedScreen}
                  onInspectOutputs={() => setStage("outputs")}
                />
              ) : null}

              {stage === "outputs" ? (
                <OutputsStage
                  outputTarget={outputTarget}
                  setOutputTarget={setOutputTarget}
                  setOutputFilePath={setOutputFilePath}
                  output={output}
                  outputMessage={outputMessage}
                  reactOutput={reactOutput}
                  reactMessage={reactCompilation.message}
                  selectedCode={selectedCode}
                  copyGeneratedFile={copyGeneratedFile}
                  copied={copied}
                  graph={graph}
                  selectedScreen={selectedScreen}
                  localPreviews={localPreviews}
                  scenarioLabel={scenario.label}
                  onLocalProjectChanged={openLocalProject}
                  onApplyWebImport={applyWebImport}
                  onInspectNode={inspectGeneratedNode}
                />
              ) : null}

              {stage === "verify" ? (
                <VerifyStage
                  graph={graph}
                  verification={verification}
                  scenario={scenario}
                  scenarioId={scenarioId}
                  setScenarioId={setScenarioId}
                  scenarios={scenarios}
                  repairPreview={repairPreview}
                  previewRepair={previewFindingRepair}
                  applyRepair={applyFindingRepair}
                  dismissRepair={() => setRepairPreview(null)}
                  rerunVerification={rerunVerification}
                  inspectFinding={inspectVerificationFinding}
                  sourceFingerprint={currentGraphFingerprint}
                  buildEvidenceState={buildEvidenceState}
                  verificationRunId={verificationRunId}
                  isPending={isPending}
                />
              ) : null}

              {stage === "report" ? (
                <ReportStage
                  graph={graph}
                  reactOutput={reactOutput}
                  swiftOutput={swiftOutput}
                  expoOutput={expoOutput}
                  reactMessage={reactCompilation.message}
                  swiftMessage={swiftCompilation.message}
                  expoMessage={expoCompilation.message}
                  scenario={scenario}
                  verification={verification}
                  changes={changes}
                  exportGraph={exportGraph}
                  onOpenVerify={() => setStage("verify")}
                />
              ) : null}
            </motion.div>
          </AnimatePresence>
        </section>
      </div>
      {judgeSession ? (
        <JudgeModePanel
          session={judgeSession}
          onSelectStep={openJudgeStep}
          onAdvance={advanceJudgeMode}
          onReset={resetJudgeMode}
          onExit={exitJudgeMode}
        />
      ) : null}
      {agentDrawerOpen ? (
        <div className="fixed inset-0 z-40 flex justify-end">
          <button type="button" aria-label="Close agent drawer" onClick={closeAgentDrawer} className="absolute inset-0 bg-[var(--backdrop)]/45" />
          <aside role="dialog" aria-modal="true" aria-labelledby="agent-drawer-title" className="relative flex h-full w-[min(380px,94vw)] flex-col border-l border-[var(--line)] bg-[var(--panel)] shadow-[-24px_0_60px_-36px_var(--shadow-strong)]">
            <header className="flex h-11 shrink-0 items-center justify-between border-b border-[var(--line)] px-3"><div><h2 id="agent-drawer-title" className="text-[12px] font-semibold">Agent review</h2><p className="font-mono text-[8px] text-[var(--faint)]">live transaction stream</p></div><button ref={agentCloseButton} type="button" aria-label="Close agent review" onClick={closeAgentDrawer} className="grid size-7 place-items-center rounded hover:bg-[var(--hover)]"><X size={13} /></button></header>
            <AgentActivityPanel
              enabled={localProjectFingerprint !== null}
              projectId={catalogProject?.id ?? "unresolved"}
              projectName={graph.product.name}
              documentId={workspace.activeTabId}
              screenLabel={graph.screens.find((screen) => screen.id === selectedScreen)?.title ?? selectedScreen}
              selectionLabel={selectedNodeId}
              workspaceLabel={stage}
              targetLabel={stage === "outputs" ? outputTarget : null}
              fileLabel={stage === "outputs" ? selectedCode?.path ?? null : null}
              deviceLabel={scenarioId}
              visualState={verification.scenario.visualState ?? "idle"}
              currentFingerprint={currentGraphFingerprint}
              onPreviewChanges={previewAgentChanges}
              onOpenLinkedComment={openAgentLinkedComment}
              onProjectChanged={() => { setAgentPreview(null); openLocalProject(); }}
            />
          </aside>
        </div>
      ) : null}
      {pendingTabClose ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[var(--backdrop)] p-4">
          <section data-testid="dirty-tab-dialog" role="alertdialog" aria-modal="true" aria-labelledby="dirty-tab-title" aria-describedby="dirty-tab-description" className="menu-pop w-full max-w-md rounded-[8px] p-4 shadow-[var(--if-shadow-dialog)]">
            <span className="grid size-8 place-items-center rounded-[6px] bg-[var(--warn-soft)] text-[var(--warn)]"><Warning size={16} weight="fill" /></span>
            <h2 id="dirty-tab-title" className="mt-3 text-[15px] font-[550] leading-[21px]">Save changes before closing?</h2>
            <p id="dirty-tab-description" className="mt-2 text-[12px] leading-relaxed text-[var(--muted)]">{pendingTabClose.title} has project changes that are not yet committed to the durable catalog.</p>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button ref={dirtyCloseCancelButton} type="button" onClick={cancelDirtyClose} className="h-8 rounded-[6px] px-3 text-[11px] font-medium hover:bg-[var(--hover)]">Cancel</button>
              <button type="button" onClick={() => {
                if (catalogSavedGraph) {
                  setGraph(catalogSavedGraph);
                  reconcileSelection(catalogSavedGraph);
                }
                closeDocument(pendingTabClose, true);
                setPendingTabClose(null);
              }} className="h-8 rounded-[6px] border border-[var(--line)] px-3 text-[11px] font-medium hover:bg-[var(--hover)]">Discard changes</button>
              <button type="button" onClick={() => void (async () => {
                if (!await flushCatalogSave()) return;
                closeDocument(pendingTabClose, true);
                setPendingTabClose(null);
              })()} className="h-8 rounded-[6px] bg-[var(--accent)] px-3 text-[11px] font-medium text-white hover:brightness-95">Save and close</button>
            </div>
          </section>
        </div>
      ) : null}
      {resetConfirmOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[var(--backdrop)] p-4" onPointerDown={(event) => { if (event.target === event.currentTarget) cancelProjectReset(); }}>
          <section ref={resetDialog} data-testid="reset-project-dialog" role="alertdialog" aria-modal="true" aria-labelledby="reset-project-title" aria-describedby="reset-project-description" className="menu-pop w-full max-w-md rounded-[8px] p-4 shadow-[var(--if-shadow-dialog)]">
            <span className="grid size-8 place-items-center rounded-[6px] bg-[var(--danger-soft)] text-[var(--danger)]"><ArrowsCounterClockwise size={16} weight="bold" /></span>
            <h2 id="reset-project-title" className="mt-3 text-[15px] font-[550] leading-[21px] tracking-[-.02em]">Reset this workspace?</h2>
            <p id="reset-project-description" className="mt-2 text-[12px] leading-relaxed text-[var(--muted)]">{revertsToSavedRevision
              ? "This replaces the current semantic graph with the last saved revision of this project. Edits made since that save are discarded from this window."
              : "This replaces the current semantic graph with the verified sample. The previous committed revision remains available as last-known-good recovery."}</p>
            {localChangesAreUnsaved ? <p className="mt-3 rounded-[6px] bg-[var(--warn-soft)] px-3 py-2 text-[11px] font-medium text-[var(--warn)]">This local project also has changes that have not been saved to disk.</p> : null}
            <div className="mt-4 flex justify-end gap-2">
              <button ref={resetCancelButton} type="button" onClick={cancelProjectReset} className="h-8 rounded-[6px] border border-[var(--line)] px-3 text-[11px] font-medium hover:bg-[var(--hover)]">Cancel</button>
              <button type="button" onClick={confirmProjectReset} className="h-8 rounded-[6px] bg-[var(--danger)] px-3 text-[11px] font-medium text-white hover:brightness-95">Reset workspace</button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
