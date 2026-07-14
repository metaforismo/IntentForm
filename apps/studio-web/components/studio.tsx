"use client";

import {
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
import { compileReact } from "@intentform/compiler-react";
import { compileSwiftUI } from "@intentform/compiler-swiftui";
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
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ManualEditor, type WorkflowStage } from "./manual-editor";
import { BriefStage } from "./stages/brief-stage";
import { GraphStage } from "./stages/graph-stage";
import { OutputsStage } from "./stages/outputs-stage";
import { ReportStage } from "./stages/report-stage";
import { VerifyStage } from "./stages/verify-stage";

type Stage = "canvas" | WorkflowStage;
export type OutputTarget = "react" | "swiftui";
export type ScenarioId = "compact" | "regular";

const stages: Array<{ id: Stage; label: string; shortLabel: string; icon: typeof Sparkle }> = [
  { id: "canvas", label: "Design canvas", shortLabel: "Design", icon: Selection },
  { id: "brief", label: "Brief", shortLabel: "Brief", icon: Sparkle },
  { id: "graph", label: "Semantic graph", shortLabel: "Graph", icon: TreeStructure },
  { id: "outputs", label: "Native outputs", shortLabel: "Code", icon: Code },
  { id: "verify", label: "Verification", shortLabel: "Verify", icon: ShieldCheck },
  { id: "report", label: "Proof report", shortLabel: "Report", icon: FileText },
];

const scenarios: Record<ScenarioId, { label: string; viewport: { width: number; height: number } }> = {
  compact: { label: "Compact iPhone", viewport: { width: 375, height: 667 } },
  regular: { label: "Regular iPhone", viewport: { width: 402, height: 874 } },
};

const DRAFT_KEY = "intentform-project-draft-v1";

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
    <div title={trace ? `${trace.requestFingerprint} · ${trace.attempts} attempt(s)${trace.usage ? ` · ${trace.usage.totalTokens} tokens` : ""}` : undefined} className="inline-flex min-h-8 items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--chip)] px-2.5 text-[10px] font-medium text-[var(--muted)] shadow-[inset_0_1px_0_var(--float-inset)]">
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
  const [scenarioId, setScenarioId] = useState<ScenarioId>("compact");
  const [mode, setMode] = useState<"live" | "replay">("replay");
  const [model, setModel] = useState("deterministic-sample");
  const [lastTrace, setLastTrace] = useState<TraceSummary | null>(null);
  const [notice, setNoticeText] = useState("Ready to compile the sample brief.");
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const [theme, setThemeState] = useState<"light" | "dark">("light");
  const [isPending, startTransition] = useTransition();
  const lastCommit = useRef({ at: 0, notice: "" });

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
      const saved = window.localStorage.getItem(DRAFT_KEY);
      if (saved) {
        const restored = parseGraph(JSON.parse(saved));
        const nextScreen = restored.screens.find((screen) => screen.id === selectedScreen) ?? restored.screens[0];
        setGraph(restored);
        setBaseline(restored);
        setSelectedScreen(nextScreen?.id ?? "");
        setSelectedNodeId(nextScreen?.nodes[0]?.id ?? null);
        setNotice("Restored the local semantic draft.");
      }
    } catch {
      window.localStorage.removeItem(DRAFT_KEY);
      setNotice("The local draft was invalid, so IntentForm reopened the verified sample.");
    } finally {
      setDraftReady(true);
    }
    // Restoring the draft is a mount-only concern.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!draftReady) return;
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(graph));
    } catch {
      setNoticeText("The semantic graph is valid, but this browser could not save the local draft.");
    }
  }, [draftReady, graph]);

  useEffect(() => {
    if (/failed|could not|invalid|quota|unavailable|rejected/i.test(notice)) setNoticeOpen(true);
  }, [notice]);

  useEffect(() => {
    if (!noticeOpen) return;
    const close = () => setNoticeOpen(false);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [noticeOpen]);

  const reactOutput = useMemo(() => compileReact(graph), [graph]);
  const swiftOutput = useMemo(() => compileSwiftUI(graph), [graph]);
  const scenario = scenarios[scenarioId];
  const verification = useMemo(
    () => verifyGraph(graph, { target: "swiftui", viewport: scenario.viewport, buildPassed: true }),
    [graph, scenario],
  );
  const changes = useMemo(() => semanticDiff(baseline, graph), [baseline, graph]);
  const output = outputTarget === "react" ? reactOutput : swiftOutput;
  const selectedCode = output.files.find((file) => file.path === outputFilePath)
    ?? output.files.find((file) => file.path.includes(`screens/${selectedScreen}`))
    ?? output.files[Math.max(0, graph.screens.findIndex((screen) => screen.id === selectedScreen))]
    ?? output.files[0];
  const previewVariant = graph.screens
    .find((screen) => screen.id === "payment-request")
    ?.nodes.find((node) => node.kind === "primary-action")
    ?.layout.placement?.compact === "persistent-bottom" ? "after" : "before";

  /* Rapid identical edits (dragging a color token) coalesce into one undo
     step instead of flooding the history. */
  const commitGraph = (nextGraph: SemanticInterfaceGraph, nextNotice: string) => {
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
    setGraph(nextGraph);
  };

  const reconcileSelection = (nextGraph: SemanticInterfaceGraph) => {
    const nextScreen = nextGraph.screens.find((screen) => screen.id === selectedScreen) ?? nextGraph.screens[0];
    if (!nextScreen) {
      setSelectedScreen("");
      setSelectedNodeId(null);
      return;
    }
    setSelectedScreen(nextScreen.id);
    if (!selectedNodeId || !nextScreen.nodes.some((node) => node.id === selectedNodeId)) {
      setSelectedNodeId(nextScreen.nodes[0]?.id ?? null);
    }
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
    window.localStorage.removeItem(DRAFT_KEY);
    setGraph(demoGraph);
    setBaseline(demoGraph);
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
    startTransition(async () => {
      try {
        const response = await fetch("/api/project");
        if (!response.ok) throw new Error("No local .intentform project is available in this deployment.");
        const result = (await response.json()) as { graph: unknown; seeded: boolean };
        const nextGraph = parseGraph(result.graph);
        setGraph(nextGraph);
        setBaseline(nextGraph);
        setHistory([]);
        setFuture([]);
        const nextScreen = nextGraph.screens.find((screen) => screen.id === selectedScreen) ?? nextGraph.screens[0];
        setSelectedScreen(nextScreen?.id ?? "");
        setSelectedNodeId(nextScreen?.nodes[0]?.id ?? null);
        lastCommit.current = { at: 0, notice: "" };
        setNotice(result.seeded
          ? "Initialized .intentform/graph.json from the verified sample and opened it."
          : "Opened the local .intentform project. Agent edits are now on the board.");
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "The local project could not be opened.");
      }
    });
  };

  const saveLocalProject = () => {
    setMenuOpen(false);
    startTransition(async () => {
      try {
        const response = await fetch("/api/project", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ graph, reason: "studio save" }),
        });
        if (!response.ok) throw new Error("The graph could not be saved to the local project.");
        setNotice("Saved the graph to .intentform/graph.json for the MCP server and coding agents.");
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "The local project could not be saved.");
      }
    });
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
    startTransition(async () => {
      try {
        const instruction = operation === "edit" ? editInstruction : brief;
        setNotice(operation === "edit" ? "Planning the smallest typed semantic edit…" : "Interpreting product intent and validating the graph…");
        const response = await fetch("/api/interpret", {
          method: "POST",
          headers: { "content-type": "application/json", "x-intentform-session": getSessionId() },
          body: JSON.stringify({ brief: instruction, operation, ...(operation === "edit" ? { graph, screenId: selectedScreen } : {}) }),
        });
        const payload = (await response.json()) as { error?: string; graph?: unknown; mode?: "live" | "replay"; model?: string; note?: string; trace?: TraceSummary };
        if (!response.ok || !payload.graph || !payload.mode || !payload.model || !payload.note) {
          throw new Error(payload.error ?? (operation === "edit" ? "The semantic edit could not be interpreted." : "The brief could not be interpreted."));
        }
        const result = payload as { graph: unknown; mode: "live" | "replay"; model: string; note: string; trace?: TraceSummary };
        const nextGraph = parseGraph(result.graph);
        if (operation === "edit") commitGraph(nextGraph, result.note);
        else {
          setGraph(nextGraph);
          setBaseline(nextGraph);
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
        setNotice(error instanceof Error ? error.message : "Interpretation failed.");
      }
    });
  };

  const repairFinding = (finding: VerificationFinding) => {
    startTransition(async () => {
      try {
        setNotice("Planning the smallest evidence-backed repair…");
        const response = await fetch("/api/repair", {
          method: "POST",
          headers: { "content-type": "application/json", "x-intentform-session": getSessionId() },
          body: JSON.stringify({ graph, finding, evidence: { build: { passed: true, diagnostics: [] } } }),
        });
        const payload = (await response.json()) as { error?: string; proposal?: RepairProposal; mode?: "live" | "replay"; model?: string; trace?: TraceSummary };
        if (!response.ok || !payload.proposal || !payload.mode || !payload.model) throw new Error(payload.error ?? "A safe repair could not be planned.");
        const result = payload as { proposal: RepairProposal; mode: "live" | "replay"; model: string; trace?: TraceSummary };
        const repaired = applyRepair(graph, result.proposal);
        setGraph(repaired);
        setMode(result.mode);
        setModel(result.model);
        setLastTrace(result.trace ?? null);
        setNotice(result.proposal.summary);
        setStage("report");
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Repair failed.");
      }
    });
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
                  <div className="menu-pop absolute left-0 top-10 z-[6] w-64 p-1.5">
                    <div className="border-b border-[var(--line)] px-2.5 pb-2 pt-1.5">
                      <strong className="block text-[11px]">{graph.product.name}</strong>
                      <span className="mt-0.5 block font-mono text-[9px] text-[var(--faint)]">payment-flow.intentform · v{graph.schemaVersion}</span>
                    </div>
                    <button type="button" onClick={openLocalProject} className="mt-1 flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[11px] text-[var(--t-strong)] hover:bg-[var(--hover)]">
                      <FolderOpen size={13} /> Open local project
                    </button>
                    <button type="button" onClick={saveLocalProject} className="flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[11px] text-[var(--t-strong)] hover:bg-[var(--hover)]">
                      <FloppyDisk size={13} /> Save to local project
                    </button>
                    <div className="my-1 border-t border-[var(--line)]" />
                    <button type="button" onClick={exportGraph} className="flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[11px] text-[var(--t-strong)] hover:bg-[var(--hover)]">
                      <DownloadSimple size={13} /> Export graph as JSON
                    </button>
                    <button type="button" onClick={resetProject} className="flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[11px] text-[var(--t-strong)] hover:bg-[var(--hover)]">
                      <ArrowsCounterClockwise size={13} /> Reset to verified sample
                    </button>
                  </div>
                </>
              ) : null}
            </div>
            <div className="hidden min-w-0 sm:block">
              <div className="flex items-center gap-1 text-[11px] font-semibold tracking-[-.01em]">
                <span className="truncate">{graph.product.name}</span><CaretDown size={10} className="text-[var(--muted)]" />
              </div>
              <span className="block truncate font-mono text-[9px] text-[var(--muted)]">payment-flow.intentform</span>
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
                  className={`group relative flex min-h-8 items-center justify-center gap-1.5 rounded-lg px-2 text-[10px] font-medium transition-[background,color,box-shadow,transform] duration-200 active:scale-[.97] lg:px-2.5 ${active ? "bg-[var(--seg-active)] text-[var(--ink)] shadow-[0_5px_14px_-10px_var(--shadow-strong),inset_0_0_0_1px_var(--float-inset)]" : "text-[var(--muted)] hover:bg-[var(--seg-hover)] hover:text-[var(--ink)]"}`}
                >
                  <Icon size={14} weight={active ? "fill" : "regular"} />
                  <span className="hidden xl:inline">{item.shortLabel}</span>
                  {item.id === "verify" && errorCount > 0 ? (
                    <span className="absolute -right-0.5 -top-0.5 grid size-3.5 place-items-center rounded-full bg-[var(--danger)] font-mono text-[8px] font-bold text-white">{errorCount}</span>
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
              className="grid size-8 place-items-center rounded-lg text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
            >
              {theme === "dark" ? <Sun size={14} weight="fill" /> : <Moon size={14} />}
            </button>
            <div className="relative" onPointerDown={(event) => event.stopPropagation()}>
              <button type="button" aria-label="Show workspace status" aria-expanded={noticeOpen} onClick={() => setNoticeOpen((open) => !open)} className="grid size-8 place-items-center rounded-lg text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]">
                {noticeIsError ? <Warning size={14} weight="fill" className="text-[var(--danger)]" /> : <CheckCircle size={14} weight="fill" className="text-[var(--accent)]" />}
              </button>
              {noticeOpen ? (
                <div className="menu-pop absolute right-0 top-10 z-[6] w-80 overflow-hidden">
                  <div role="status" aria-live="polite" className="border-b border-[var(--line)] p-3 text-[11px] leading-relaxed text-[var(--ink)]">{notice}</div>
                  {activity.length > 1 ? (
                    <div className="max-h-56 overflow-auto p-1.5">
                      <span className="block px-1.5 pb-1 pt-0.5 text-[8.5px] font-semibold uppercase tracking-[.12em] text-[var(--faint)]">Recent activity</span>
                      {activity.slice(1).map((entry, index) => (
                        <div key={`${entry.at}-${index}`} className="grid grid-cols-[auto_1fr] gap-2 rounded-md px-1.5 py-1.5 text-[10px] leading-relaxed text-[var(--muted)]">
                          <span className="font-mono text-[8.5px] text-[var(--faint)]">{entry.at}</span>
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
              className="inline-flex min-h-8 items-center gap-2 rounded-lg bg-[var(--accent)] px-3 text-[10.5px] font-semibold text-white shadow-[0_8px_18px_-14px_rgba(36,84,68,.9)] transition-[transform,background] hover:bg-[var(--accent-dark)] active:scale-[.97] disabled:cursor-wait disabled:opacity-70"
            >
              {isPending ? <CircleNotch className="animate-spin" size={14} /> : <Lightning size={14} weight="fill" />}
              <span className="hidden sm:inline">{stage === "canvas" ? "Recompile" : "Compile intent"}</span>
            </button>
          </div>
          {isPending ? <div className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-[var(--line)]"><motion.span className="block h-full w-1/3 bg-[var(--accent)]" initial={{ x: "-100%" }} animate={{ x: "300%" }} transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }} /></div> : null}
        </header>

        <section className="min-h-0 min-w-0 overflow-hidden">
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
                  onSelectScreen={setSelectedScreen}
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
                  reactOutput={reactOutput}
                  selectedCode={selectedCode}
                  copyGeneratedFile={copyGeneratedFile}
                  copied={copied}
                  previewVariant={previewVariant}
                  graph={graph}
                  selectedScreen={selectedScreen}
                />
              ) : null}

              {stage === "verify" ? (
                <VerifyStage
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
