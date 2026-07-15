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
import { applyRepair, type RepairProposal } from "@intentform/repair-planner";
import {
  flattenSemanticNodes,
  parseGraph,
  semanticDiff,
  stableSerialize,
  type SemanticInterfaceGraph,
} from "@intentform/semantic-schema";
import type { VerificationFinding } from "@intentform/verifier";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  clearBrowserProject,
  loadBrowserProject,
  saveBrowserProject,
  type ProjectSource,
  type ProjectType,
} from "../lib/browser-projects";
import { hasUnsavedLocalChanges, serializedGraphFingerprint } from "../lib/project-save-state";
import { ManualEditor, type WorkflowStage } from "./manual-editor";
import { reconcileGraphSelection } from "./editor/direct-manipulation";
import { editorProfiles, type DeviceId } from "./editor/support";
import { compileStudioTarget } from "./target-compilation";
import { BriefStage } from "./stages/brief-stage";
import { GraphStage } from "./stages/graph-stage";
import { OutputsStage } from "./stages/outputs-stage";
import { ReportStage } from "./stages/report-stage";
import { VerifyStage } from "./stages/verify-stage";
import { useLocalPreviews, type LocalPreviewTarget } from "./use-local-previews";
import { useBackgroundVerification } from "./use-background-verification";
import { DesktopControl } from "./desktop-control";
import { EcosystemControl } from "./ecosystem-control";
import { AgentActivityPanel, type AgentReviewChange } from "./agent-activity-panel";

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
  const [draftReady, setDraftReady] = useState(false);
  const [theme, setThemeState] = useState<"light" | "dark">("light");
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [requestFailure, setRequestFailure] = useState<RequestFailure | null>(null);
  const [localProjectFingerprint, setLocalProjectFingerprint] = useState<string | null>(null);
  const [projectType, setProjectType] = useState<ProjectType>("application");
  const [projectSource, setProjectSource] = useState<ProjectSource>("example");
  const [openTabs, setOpenTabs] = useState(["design", "output"] as const as readonly ("design" | "output")[]);
  const [activeTab, setActiveTab] = useState<"design" | "output">("design");
  const [lastClosedTab, setLastClosedTab] = useState<"design" | "output" | null>(null);
  const lastCommit = useRef({ at: 0, notice: "" });
  const graphRef = useRef(graph);
  graphRef.current = graph;
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
  const agentTrigger = useRef<HTMLButtonElement>(null);
  const agentCloseButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (document.documentElement.dataset.theme === "dark") setThemeState("dark");
  }, []);

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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === "w") {
        event.preventDefault();
        setOpenTabs((tabs) => {
          if (tabs.length <= 1) return tabs;
          const next = tabs.filter((tab) => tab !== activeTab);
          setLastClosedTab(activeTab);
          setActiveTab(next.at(-1) ?? "design");
          return next;
        });
      } else if (event.shiftKey && event.key.toLowerCase() === "t" && lastClosedTab) {
        event.preventDefault();
        setOpenTabs((tabs) => tabs.includes(lastClosedTab) ? tabs : [...tabs, lastClosedTab]);
        setActiveTab(lastClosedTab);
        setLastClosedTab(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeTab, lastClosedTab]);

  const closeTab = (tab: "design" | "output") => {
    setOpenTabs((tabs) => {
      if (tabs.length <= 1) return tabs;
      const next = tabs.filter((item) => item !== tab);
      setLastClosedTab(tab);
      if (activeTab === tab) setActiveTab(next.at(-1) ?? "design");
      return next;
    });
  };

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

  useEffect(() => {
    let cancelled = false;
    const restoreGraph = (
      restored: SemanticInterfaceGraph,
      metadata: { projectType: ProjectType; source: ProjectSource; localFingerprint?: string | undefined },
      notice: string,
    ) => {
      if (cancelled) return;
      const nextScreen = restored.screens.find((screen) => screen.id === selectedScreen) ?? restored.screens[0];
      setGraph(restored);
      setBaseline(restored);
      setProjectType(metadata.projectType);
      if (metadata.projectType === "responsive-web" && restored.platforms.some((platform) => platform.target === "web" && platform.enabled)) {
        setOutputTarget("web");
        setScenarioId(restored.web
          ? `web:${restored.web.defaultFrame}`
          : `device:${restored.devices.defaultProfile}`);
      }
      setProjectSource(metadata.source);
      setLocalProjectFingerprint(metadata.localFingerprint ?? null);
      setSelectedScreen(nextScreen?.id ?? "");
      setSelectedNodeId(nextScreen?.nodes[0]?.id ?? null);
      setNotice(notice);
      setDraftReady(true);
    };
    void (async () => {
      try {
        const recovered = loadBrowserProject(window.localStorage);
        if (recovered.status === "ready") {
          const restored = recovered.project.graph;
          restoreGraph(restored, recovered.project, `Restored ${restored.product.name} from browser recovery.`);
          return;
        }
        if (recovered.status === "invalid") {
          setNotice("Browser recovery needs attention. Return to the project launcher to inspect or discard it.");
          window.location.replace("/");
          return;
        }
        if (window.intentformDesktop) {
          const response = await fetch("/api/project", { cache: "no-store" });
          const result = (await response.json()) as { error?: string; graph?: unknown; fingerprint?: string };
          if (!response.ok || !result.graph || typeof result.fingerprint !== "string") {
            throw new Error(result.error ?? "The granted desktop project could not be opened.");
          }
          const restored = parseGraph(result.graph);
          restoreGraph(restored, {
            projectType: restored.web ? "responsive-web" : "application",
            source: "local",
            localFingerprint: result.fingerprint,
          }, `Opened ${restored.product.name} from the granted desktop project.`);
          return;
        }
        window.location.replace("/");
      } catch {
        window.location.replace("/");
      }
    })();
    return () => { cancelled = true; };
    // Restoring the draft is a mount-only concern.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!draftReady) return;
    const timeout = window.setTimeout(() => {
      const saved = saveBrowserProject(window.localStorage, graph, {
        projectType,
        source: projectSource,
        ...(localProjectFingerprint ? { localFingerprint: localProjectFingerprint } : {}),
      });
      if (!saved.ok) setNoticeText(saved.message);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [draftReady, graph, localProjectFingerprint, projectSource, projectType]);

  useEffect(() => {
    if (/failed|could not|invalid|quota|unavailable|rejected|ignored|unsupported/i.test(notice)) setNoticeOpen(true);
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
  const graphSnapshot = useMemo(() => stableSerialize(graph), [graph]);
  const currentGraphFingerprint = useMemo(() => serializedGraphFingerprint(graphSnapshot), [graphSnapshot]);
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
  const verificationScenario = useMemo(
    () => ({ target: verificationTarget, viewport: scenario.viewport, buildStatus }),
    [buildStatus, scenario.viewport, verificationTarget],
  );
  const verification = useBackgroundVerification(graph, verificationScenario);
  const changes = useMemo(() => stage === "report" ? semanticDiff(baseline, graph) : [], [baseline, graph, stage]);
  const output = outputTarget === "react" ? reactOutput : outputTarget === "swiftui" ? swiftOutput : outputTarget === "expo" ? expoOutput : webOutput;
  const outputMessage = outputTarget === "react" ? reactCompilation.message : outputTarget === "swiftui" ? swiftCompilation.message : outputTarget === "expo" ? expoCompilation.message : webCompilation.message;
  const graphSnapshotRef = useRef(graphSnapshot);
  graphSnapshotRef.current = graphSnapshot;
  const isPending = pendingAction !== null;
  const selectedCode = output?.files.find((file) => file.path === outputFilePath)
    ?? output?.files.find((file) => file.path.includes(`screens/${selectedScreen}`))
    ?? output?.files[Math.max(0, graph.screens.findIndex((screen) => screen.id === selectedScreen))]
    ?? output?.files[0];

  useEffect(() => {
    if (!localChangesAreUnsaved) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [localChangesAreUnsaved]);

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

  const failRequest = (message: string, retryLabel: string, retry: () => void) => {
    setNotice(message);
    retryRequest.current = retry;
    setRequestFailure({ message, retryLabel });
  };

  useEffect(() => () => activeRequest.current?.controller.abort(), []);
  /* Rapid identical edits (dragging a color token) coalesce into one undo
     step instead of flooding the history. */
  const commitGraph = (nextGraph: SemanticInterfaceGraph, nextNotice: string) => {
    const validated = parseGraph(nextGraph);
    const now = Date.now();
    const coalesce = lastCommit.current.notice === nextNotice && now - lastCommit.current.at < 900;
    if (!coalesce) {
      setHistory((items) => [...items.slice(-39), graph]);
      setFuture([]);
      setNotice(nextNotice);
    } else {
      setNoticeText(nextNotice);
    }
    lastCommit.current = { at: now, notice: nextNotice };
    setGraph(validated);
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
    lastCommit.current = { at: 0, notice: "" };
    setNotice("Undid the last semantic edit.");
  };

  const redo = () => {
    const next = future[0];
    if (!next) return;
    setFuture((items) => items.slice(1));
    setHistory((items) => [...items.slice(-39), graph]);
    setGraph(next);
    reconcileSelection(next);
    lastCommit.current = { at: 0, notice: "" };
    setNotice("Restored the semantic edit.");
  };

  const resetProject = () => {
    clearBrowserProject(window.localStorage);
    setGraph(demoGraph);
    setBaseline(demoGraph);
    setProjectType("application");
    setProjectSource("example");
    setLocalProjectFingerprint(null);
    setHistory([]);
    setFuture([]);
    setSelectedScreen("payment-request");
    setSelectedNodeId("payment-request.amount");
    lastCommit.current = { at: 0, notice: "" };
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
        lastCommit.current = { at: 0, notice: "" };
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
      setTimeout(() => setCopied(false), 1600);
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

  const repairFinding = (finding: VerificationFinding) => {
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
        const repaired = applyRepair(graphToRepair, result.proposal);
        commitGraph(repaired, result.proposal.summary);
        setMode(result.mode);
        setModel(result.model);
        setLastTrace(result.trace ?? null);
        setStage("report");
      } catch (error) {
        if (!isCurrentRequest(active.id) || active.controller.signal.aborted) return;
        failRequest(
          error instanceof Error ? error.message : "Repair failed.",
          "Retry repair",
          () => repairFinding(finding),
        );
      } finally {
        finishRequest(active.id);
      }
    })();
  };

  const inspectVerificationFinding = (finding: VerificationFinding) => {
    const screen = graph.screens.find((candidate) => candidate.id === finding.screenId) ?? graph.screens[0];
    if (!screen) return;
    const nodes = flattenSemanticNodes(screen.nodes);
    const node = nodes.find((candidate) => candidate.kind === "primary-action") ?? nodes[0];
    setSelectedScreen(screen.id);
    setSelectedNodeId(finding.responsibleLayer === "graph" ? node?.id ?? null : null);
    setStage("canvas");
    setNotice(`Showing ${finding.id} on ${screen.title}. Return to Verify to keep the evidence context.`);
  };

  const previewAgentChanges = (reviewChanges: AgentReviewChange[]) => {
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

  const errorCount = verification.findings.filter((finding) => finding.severity === "error" && finding.status !== "suppressed").length;
  const noticeIsError = /failed|could not|invalid|quota|unavailable|rejected/i.test(notice);

  return (
    <main className="studio-grain h-[100dvh] overflow-hidden text-[var(--ink)]">
      <a className="skip-link" href="#studio-workspace">Skip to workspace</a>
      <div className="grid h-full min-h-0 grid-rows-[36px_40px_minmax(0,1fr)] bg-[var(--if-panel)]">
        <div className="relative z-[6] flex min-w-0 items-end border-b border-[var(--line)] bg-[var(--app-bg,var(--canvas))] px-2 pt-1">
          <div role="tablist" aria-label="Open project documents" className="flex min-w-0 items-end gap-px overflow-x-auto [scrollbar-width:none]">
          {openTabs.map((tab) => {
            const active = tab === activeTab;
            const label = tab === "design" ? `${graph.product.name}.intentform` : "Generated output";
            return (
              <div
                key={tab}
                role="tab"
                tabIndex={active ? 0 : -1}
                aria-selected={active}
                onClick={(event) => {
                  if ((event.target as HTMLElement).closest("[data-close-tab]")) { closeTab(tab); return; }
                  setActiveTab(tab); setStage(tab === "output" ? "outputs" : "canvas");
                }}
                onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setActiveTab(tab); setStage(tab === "output" ? "outputs" : "canvas"); } }}
                onAuxClick={(event) => { if (event.button === 1) closeTab(tab); }}
                className={`group flex h-9 min-w-0 max-w-56 items-center gap-2 rounded-t-[7px] border border-b-0 px-3 text-[11px] ${active ? "border-[var(--line)] bg-[var(--surface)] text-[var(--ink)]" : "border-transparent text-[var(--t-strong)] hover:bg-[var(--hover)]"}`}
              >
                <BracketsCurly size={13} className="shrink-0 text-[var(--accent)]" />
                <span className="truncate">{label}</span>
                {tab === "design" && localChangesAreUnsaved ? <span className="size-1.5 shrink-0 rounded-full bg-[var(--warning,#e4ad5a)]" aria-label="Unsaved local changes" /> : null}
                {tab === "design" && activity.length > 0 ? <span className="size-1.5 shrink-0 rounded-full bg-[var(--success,#55c58b)]" aria-label="Agent activity" /> : null}
                <span data-close-tab aria-hidden="true" className="grid size-5 shrink-0 place-items-center rounded opacity-0 hover:bg-[var(--control-hover,var(--hover))] group-hover:opacity-100 group-focus-visible:opacity-100"><X size={11} /></span>
              </div>
            );
          })}
          </div>
          <button type="button" aria-label="Open another document" onClick={() => { const tab = openTabs.includes("output") ? "design" : "output"; setOpenTabs((tabs) => tabs.includes(tab) ? tabs : [...tabs, tab]); setActiveTab(tab); }} className="mb-1 grid size-7 shrink-0 place-items-center rounded-[7px] text-[var(--muted)] hover:bg-[var(--hover)]"><Plus size={13} /></button>
        </div>
        <header className="studio-topbar relative z-[5] grid h-10 grid-cols-[auto_minmax(0,1fr)_auto] items-center overflow-visible border-b border-[var(--if-border-subtle)] px-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="relative">
              <button
                ref={projectMenuTrigger}
                type="button"
                aria-label="IntentForm project menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((open) => !open)}
                className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-[var(--accent-deep)] text-white shadow-[inset_0_1px_0_var(--float-inset)] transition-transform active:scale-[.96]"
              >
                <BracketsCurly size={16} weight="bold" />
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
              <div className="flex items-center gap-1 text-[13px] font-semibold tracking-[-.01em]">
                <span className="truncate">{graph.product.name}</span><CaretDown size={10} className="text-[var(--muted)]" />
              </div>
              <span className="block truncate font-mono text-[10px] text-[var(--muted)]">{graph.product.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.intentform</span>
            </div>
            <div className="flex items-center gap-1 text-[9px] font-semibold text-[var(--muted)] sm:hidden" aria-label={mode === "live" ? `Live model: ${model}` : `Deterministic replay: ${model}`}>
              <span className={`size-1.5 rounded-full ${mode === "live" ? "bg-[var(--accent)]" : "bg-amber-500"}`} aria-hidden="true" />
              {mode === "live" ? "Live" : "Replay"}
            </div>
          </div>

          <nav aria-label="Workspace" className="mx-auto flex max-w-[260px] min-w-0 items-center overflow-x-auto rounded-md border border-[var(--if-border)] bg-[var(--if-panel-alt)] p-0.5 [scrollbar-width:none]">
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
                  onClick={() => setStage(item.id)}
                  className={`group relative flex h-7 min-w-[72px] items-center justify-center gap-1.5 rounded-[4px] px-2 text-[11px] font-medium ${active ? "bg-[var(--if-raised)] text-[var(--if-text)]" : "text-[var(--if-text-secondary)] hover:bg-[var(--if-hover)] hover:text-[var(--if-text)]"}`}
                >
                  <Icon size={14} weight={active ? "fill" : "regular"} />
                  <span>{item.shortLabel}</span>
                  {item.id === "verify" && errorCount > 0 ? (
                    <span className="absolute -right-0.5 -top-0.5 grid size-3.5 place-items-center rounded-full bg-[var(--danger)] font-mono text-[10px] font-bold text-white">{errorCount}</span>
                  ) : null}
                </button>
              );
            })}
          </nav>

          <div className="flex items-center justify-end gap-1">
            <button
              ref={agentTrigger}
              type="button"
              aria-label="Toggle color theme"
              aria-pressed={theme === "dark"}
              onClick={toggleTheme}
              className="hidden size-8 place-items-center rounded-lg text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] sm:grid"
            >
              {theme === "dark" ? <Sun size={14} weight="fill" /> : <Moon size={14} />}
            </button>
            <div className="relative" onPointerDown={(event) => event.stopPropagation()}>
              <button ref={noticeTrigger} type="button" aria-label="Show workspace status" aria-expanded={noticeOpen} onClick={() => setNoticeOpen((open) => !open)} className="grid size-8 place-items-center rounded-lg text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]">
                {noticeIsError ? <Warning size={14} weight="fill" className="text-[var(--danger)]" /> : <CheckCircle size={14} weight="fill" className="text-[var(--accent)]" />}
              </button>
              {noticeOpen ? (
                <div ref={noticeContent} role="region" aria-label="Workspace status" className="menu-pop absolute right-0 top-10 z-[6] w-[min(320px,calc(100vw-24px))] overflow-hidden">
                  <div role="status" aria-live="polite" className="border-b border-[var(--line)] p-3 text-[12px] leading-relaxed text-[var(--ink)]">{notice}</div>
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
              className="hidden h-8 items-center gap-1.5 rounded-md border border-[var(--if-border)] bg-[var(--if-raised)] px-3 text-[11px] font-medium hover:bg-[var(--if-hover)] sm:inline-flex"
            >
              <Code size={13} /> Build
            </button>
            <button
              type="button"
              aria-expanded={agentDrawerOpen}
              onClick={() => setAgentDrawerOpen(true)}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--if-blue-action)] px-3 text-[11px] font-semibold text-white hover:bg-[var(--if-blue-action-hover)] disabled:cursor-wait disabled:opacity-70"
            >
              <Lightning size={14} weight="fill" />
              <span className="hidden sm:inline">Ask agent</span>
            </button>
          </div>
          {isPending ? <div className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-[var(--line)]"><motion.span className="block h-full w-1/3 bg-[var(--accent)]" initial={{ x: "-100%" }} animate={{ x: "300%" }} transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }} /></div> : null}
        </header>

        <section id="studio-workspace" tabIndex={-1} className="relative min-h-0 min-w-0 overflow-hidden" aria-busy={isPending} aria-label={`${stages.find((item) => item.id === stage)?.label ?? stage} workspace`}>
          {pendingAction ? (
            <span className="sr-only" role="status" aria-live="polite">Request in progress: {pendingAction}.</span>
          ) : null}
          {requestFailure ? (
            <div className="pointer-events-none absolute inset-x-0 top-3 z-[8] flex justify-center px-3">
              <div role="alert" className="pointer-events-auto flex max-w-2xl items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-950 shadow-lg">
                <Warning size={16} weight="fill" className="shrink-0 text-red-600" />
                <span className="min-w-0 flex-1 leading-relaxed">{requestFailure.message}</span>
                <button type="button" onClick={() => retryRequest.current?.()} disabled={isPending} className="shrink-0 rounded-lg bg-red-900 px-3 py-2 font-semibold text-white disabled:opacity-50">
                  {requestFailure.retryLabel}
                </button>
                <button type="button" aria-label="Dismiss request error" onClick={() => setRequestFailure(null)} className="shrink-0 rounded-lg px-2 py-2 font-semibold text-red-800 hover:bg-red-100">
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
                  repairFinding={repairFinding}
                  inspectFinding={inspectVerificationFinding}
                  sourceFingerprint={currentGraphFingerprint}
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
      {agentDrawerOpen ? (
        <div className="fixed inset-0 z-40 flex justify-end">
          <button type="button" aria-label="Close agent drawer" onClick={closeAgentDrawer} className="absolute inset-0 bg-[var(--backdrop)]/45" />
          <aside role="dialog" aria-modal="true" aria-labelledby="agent-drawer-title" className="relative flex h-full w-[min(380px,94vw)] flex-col border-l border-[var(--line)] bg-[var(--panel)] shadow-[-24px_0_60px_-36px_var(--shadow-strong)]">
            <header className="flex h-11 shrink-0 items-center justify-between border-b border-[var(--line)] px-3"><div><h2 id="agent-drawer-title" className="text-[12px] font-semibold">Agent review</h2><p className="font-mono text-[8px] text-[var(--faint)]">live transaction stream</p></div><button ref={agentCloseButton} type="button" aria-label="Close agent review" onClick={closeAgentDrawer} className="grid size-7 place-items-center rounded hover:bg-[var(--hover)]"><X size={13} /></button></header>
            <AgentActivityPanel
              enabled={localProjectFingerprint !== null}
              projectName={graph.product.name}
              screenLabel={graph.screens.find((screen) => screen.id === selectedScreen)?.title ?? selectedScreen}
              selectionLabel={selectedNodeId}
              onPreviewChanges={previewAgentChanges}
              onProjectChanged={openLocalProject}
            />
          </aside>
        </div>
      ) : null}
      {resetConfirmOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/35 p-4 backdrop-blur-[2px]" onPointerDown={(event) => { if (event.target === event.currentTarget) cancelProjectReset(); }}>
          <section ref={resetDialog} role="alertdialog" aria-modal="true" aria-labelledby="reset-project-title" aria-describedby="reset-project-description" className="menu-pop w-full max-w-md p-5 shadow-2xl">
            <span className="grid size-10 place-items-center rounded-xl bg-red-100 text-red-700"><ArrowsCounterClockwise size={18} weight="bold" /></span>
            <h2 id="reset-project-title" className="mt-4 text-lg font-semibold tracking-[-.03em]">Reset this workspace?</h2>
            <p id="reset-project-description" className="mt-2 text-[12px] leading-relaxed text-[var(--muted)]">This replaces the current semantic graph with the verified sample and removes its browser recovery. Export first if you need to keep this version.</p>
            {localChangesAreUnsaved ? <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-950">This local project also has changes that have not been saved to disk.</p> : null}
            <div className="mt-5 flex justify-end gap-2">
              <button ref={resetCancelButton} type="button" onClick={cancelProjectReset} className="min-h-10 rounded-xl border border-[var(--line)] px-4 text-[12px] font-semibold hover:bg-[var(--hover)]">Cancel</button>
              <button type="button" onClick={confirmProjectReset} className="min-h-10 rounded-xl bg-red-700 px-4 text-[12px] font-semibold text-white hover:bg-red-800">Reset workspace</button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
