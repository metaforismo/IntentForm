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
  Selection,
  ShieldCheck,
  Sparkle,
  Sun,
  TreeStructure,
  Warning,
} from "@phosphor-icons/react";
import { demoBrief, demoGraph } from "@intentform/proof-report/demo";
import { applyRepair, type RepairProposal } from "@intentform/repair-planner";
import {
  parseGraph,
  semanticDiff,
  stableSerialize,
  type SemanticInterfaceGraph,
} from "@intentform/semantic-schema";
import { verifyGraph, type VerificationFinding } from "@intentform/verifier";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  clearBrowserProject,
  loadBrowserProject,
  saveBrowserProject,
  type ProjectSource,
  type ProjectType,
} from "../lib/browser-projects";
import { ManualEditor, type WorkflowStage } from "./manual-editor";
import { reconcileGraphSelection } from "./editor/direct-manipulation";
import { deviceProfiles, type DeviceId } from "./editor/support";
import { compileStudioTarget } from "./target-compilation";
import { BriefStage } from "./stages/brief-stage";
import { GraphStage } from "./stages/graph-stage";
import { OutputsStage } from "./stages/outputs-stage";
import { ReportStage } from "./stages/report-stage";
import { VerifyStage } from "./stages/verify-stage";

type Stage = "canvas" | WorkflowStage;
export type OutputTarget = "react" | "swiftui";
export type ScenarioId = DeviceId;

const stages: Array<{ id: Stage; label: string; shortLabel: string; icon: typeof Sparkle }> = [
  { id: "canvas", label: "Design canvas", shortLabel: "Design", icon: Selection },
  { id: "brief", label: "Brief", shortLabel: "Brief", icon: Sparkle },
  { id: "graph", label: "Semantic graph", shortLabel: "Graph", icon: TreeStructure },
  { id: "outputs", label: "Native outputs", shortLabel: "Code", icon: Code },
  { id: "verify", label: "Verification", shortLabel: "Verify", icon: ShieldCheck },
  { id: "report", label: "Proof report", shortLabel: "Report", icon: FileText },
];

const scenarios = Object.fromEntries(deviceProfiles.map((profile) => [
  profile.id,
  { label: profile.label, viewport: { width: profile.width, height: profile.height } },
])) as Record<ScenarioId, { label: string; viewport: { width: number; height: number } }>;

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
    <div title={trace ? `${trace.requestFingerprint} · ${trace.attempts} attempt(s)${trace.usage ? ` · ${trace.usage.totalTokens} tokens` : ""}` : undefined} className="inline-flex min-h-8 items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--chip)] px-2.5 text-[11px] font-medium text-[var(--muted)] shadow-[inset_0_1px_0_var(--float-inset)]">
      <span className={`status-breathe size-2 rounded-full ${mode === "live" ? "bg-[var(--accent)]" : "bg-amber-500"}`} />
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
  const [scenarioId, setScenarioId] = useState<ScenarioId>("compact-phone");
  const [mode, setMode] = useState<"live" | "replay">("replay");
  const [model, setModel] = useState("deterministic-sample");
  const [lastTrace, setLastTrace] = useState<TraceSummary | null>(null);
  const [notice, setNoticeText] = useState("Ready to compile the sample brief.");
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const [theme, setThemeState] = useState<"light" | "dark">("light");
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [requestFailure, setRequestFailure] = useState<RequestFailure | null>(null);
  const [localProjectFingerprint, setLocalProjectFingerprint] = useState<string | null>(null);
  const [projectType, setProjectType] = useState<ProjectType>("application");
  const [projectSource, setProjectSource] = useState<ProjectSource>("example");
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

  useEffect(() => {
    if (document.documentElement.dataset.theme === "dark") setThemeState("dark");
  }, []);

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
    try {
      const recovered = loadBrowserProject(window.localStorage);
      if (recovered.status === "ready") {
        const restored = recovered.project.graph;
        const nextScreen = restored.screens.find((screen) => screen.id === selectedScreen) ?? restored.screens[0];
        setGraph(restored);
        setBaseline(restored);
        setProjectType(recovered.project.projectType);
        setProjectSource(recovered.project.source);
        setLocalProjectFingerprint(recovered.project.localFingerprint ?? null);
        setSelectedScreen(nextScreen?.id ?? "");
        setSelectedNodeId(nextScreen?.nodes[0]?.id ?? null);
        setNotice(`Restored ${restored.product.name} from browser recovery.`);
      } else if (recovered.status === "invalid") {
        setNotice("Browser recovery needs attention. Return to the project launcher to inspect or discard it.");
        window.location.replace("/");
        return;
      } else {
        setNotice("Opened the verified example because no browser project was selected.");
      }
      setDraftReady(true);
    } catch {
      setNotice("Browser recovery is unavailable, so this session is temporary.");
      setDraftReady(true);
    }
    // Restoring the draft is a mount-only concern.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!draftReady) return;
    const saved = saveBrowserProject(window.localStorage, graph, {
      projectType,
      source: projectSource,
      ...(localProjectFingerprint ? { localFingerprint: localProjectFingerprint } : {}),
    });
    if (!saved.ok) setNoticeText(saved.message);
  }, [draftReady, graph, localProjectFingerprint, projectSource, projectType]);

  useEffect(() => {
    if (/failed|could not|invalid|quota|unavailable|rejected/i.test(notice)) setNoticeOpen(true);
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
    if (!noticeOpen) return;
    const close = () => setNoticeOpen(false);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setNoticeOpen(false);
      noticeTrigger.current?.focus();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [noticeOpen]);

  const reactCompilation = useMemo(() => compileStudioTarget(graph, "react"), [graph]);
  const swiftCompilation = useMemo(() => compileStudioTarget(graph, "swiftui"), [graph]);
  const reactOutput = reactCompilation.output;
  const swiftOutput = swiftCompilation.output;
  const scenario = scenarios[scenarioId];
  const verificationTarget = swiftOutput ? "swiftui" : reactOutput ? "react" : outputTarget;
  const verification = useMemo(
    () => verifyGraph(graph, { target: verificationTarget, viewport: scenario.viewport, buildStatus: "not-run" }),
    [graph, scenario, verificationTarget],
  );
  const changes = useMemo(() => semanticDiff(baseline, graph), [baseline, graph]);
  const output = outputTarget === "react" ? reactOutput : swiftOutput;
  const outputMessage = outputTarget === "react" ? reactCompilation.message : swiftCompilation.message;
  const graphSnapshot = useMemo(() => stableSerialize(graph), [graph]);
  const graphSnapshotRef = useRef(graphSnapshot);
  graphSnapshotRef.current = graphSnapshot;
  const isPending = pendingAction !== null;
  const selectedCode = output?.files.find((file) => file.path === outputFilePath)
    ?? output?.files.find((file) => file.path.includes(`screens/${selectedScreen}`))
    ?? output?.files[Math.max(0, graph.screens.findIndex((screen) => screen.id === selectedScreen))]
    ?? output?.files[0];

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

  const errorCount = verification.findings.filter((finding) => finding.severity === "error").length;
  const noticeIsError = /failed|could not|invalid|quota|unavailable|rejected/i.test(notice);

  return (
    <main className="studio-grain min-h-[100dvh] overflow-hidden text-[var(--ink)]">
      <div className="grid min-h-[100dvh] grid-rows-[56px_minmax(0,1fr)] bg-[var(--surface)]">
        <header className="studio-topbar relative z-[5] grid grid-cols-[auto_minmax(0,1fr)_auto] items-center border-b border-[var(--line)] bg-[rgba(250,251,248,.92)] px-3 backdrop-blur-xl">
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
                    <button type="button" role="menuitem" onClick={resetProject} className="flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[12px] text-[var(--t-strong)] hover:bg-[var(--hover)]">
                      <ArrowsCounterClockwise size={13} /> Reset to verified sample
                    </button>
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

          <nav aria-label="Workflow" className="mx-auto flex min-w-0 items-center rounded-[10px] border border-[var(--line)] bg-[var(--chip)] p-0.5">
            {stages.map((item) => {
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
                  className={`group relative flex min-h-8 items-center justify-center gap-1.5 rounded-lg px-2 text-[12px] font-medium transition-[background,color,box-shadow,transform] duration-200 active:scale-[.97] lg:px-2.5 ${active ? "bg-[var(--seg-active)] text-[var(--ink)] shadow-[0_5px_14px_-10px_var(--shadow-strong),inset_0_0_0_1px_var(--float-inset)]" : "text-[var(--muted)] hover:bg-[var(--seg-hover)] hover:text-[var(--ink)]"}`}
                >
                  <Icon size={14} weight={active ? "fill" : "regular"} />
                  <span className="hidden xl:inline">{item.shortLabel}</span>
                  {item.id === "verify" && errorCount > 0 ? (
                    <span className="absolute -right-0.5 -top-0.5 grid size-3.5 place-items-center rounded-full bg-[var(--danger)] font-mono text-[10px] font-bold text-white">{errorCount}</span>
                  ) : null}
                </button>
              );
            })}
          </nav>

          <div className="flex items-center justify-end gap-2">
            <button
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
                <div role="region" aria-label="Workspace status" className="menu-pop absolute right-0 top-10 z-[6] w-[min(320px,calc(100vw-24px))] overflow-hidden">
                  <div role="status" aria-live="polite" className="border-b border-[var(--line)] p-3 text-[12px] leading-relaxed text-[var(--ink)]">{notice}</div>
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
            <div className="hidden lg:block"><ModeBadge mode={mode} model={model} trace={lastTrace} /></div>
            <button
              type="button"
              onClick={() => compileBrief("create")}
              disabled={isPending}
              className="inline-flex min-h-8 items-center gap-2 rounded-lg bg-[var(--accent)] px-3 text-[12px] font-semibold text-white shadow-[0_8px_18px_-14px_rgba(36,84,68,.9)] transition-[transform,background] hover:bg-[var(--accent-dark)] active:scale-[.97] disabled:cursor-wait disabled:opacity-70"
            >
              {isPending ? <CircleNotch className="animate-spin" size={14} /> : <Lightning size={14} weight="fill" />}
              <span className="hidden sm:inline">{stage === "canvas" ? "Recompile" : "Compile intent"}</span>
            </button>
          </div>
          {isPending ? <div className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-[var(--line)]"><motion.span className="block h-full w-1/3 bg-[var(--accent)]" initial={{ x: "-100%" }} animate={{ x: "300%" }} transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }} /></div> : null}
        </header>

        <section className="relative min-h-0 min-w-0 overflow-hidden" aria-busy={isPending}>
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
              className={stage === "canvas" ? "h-full" : "h-full overflow-auto p-5 md:p-8"}
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
                  onSelectScreen={setSelectedScreen}
                  onDeviceId={setScenarioId}
                  onSelectNode={setSelectedNodeId}
                  onCommit={commitGraph}
                  onNotice={setNotice}
                  onUndo={undo}
                  onRedo={redo}
                  onOpenStage={setStage}
                  onResetProject={resetProject}
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
                  isPending={isPending}
                />
              ) : null}

              {stage === "report" ? (
                <ReportStage
                  graph={graph}
                  reactOutput={reactOutput}
                  swiftOutput={swiftOutput}
                  reactMessage={reactCompilation.message}
                  swiftMessage={swiftCompilation.message}
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
    </main>
  );
}
