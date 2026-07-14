"use client";

import {
  ArrowRight,
  ArrowsCounterClockwise,
  BracketsCurly,
  CaretDown,
  CheckCircle,
  CircleNotch,
  Code,
  Copy,
  DeviceMobile,
  DownloadSimple,
  FileText,
  GitDiff,
  Lightning,
  Selection,
  ShieldCheck,
  Sparkle,
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
import { NodePreview } from "./editor/node-preview";
import { isNodeVisible } from "./editor/support";
import { ManualEditor, type WorkflowStage } from "./manual-editor";

type Stage = "canvas" | WorkflowStage;
type OutputTarget = "react" | "swiftui";
type ScenarioId = "compact" | "regular";

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
    <div title={trace ? `${trace.requestFingerprint} · ${trace.attempts} attempt(s)${trace.usage ? ` · ${trace.usage.totalTokens} tokens` : ""}` : undefined} className="inline-flex min-h-8 items-center gap-2 rounded-lg border border-[var(--line)] bg-white/70 px-2.5 text-[10px] font-medium text-[var(--muted)] shadow-[inset_0_1px_0_rgba(255,255,255,.8)]">
      <span className={`status-breathe size-2 rounded-full ${mode === "live" ? "bg-[var(--accent)]" : "bg-amber-500"}`} />
      {mode === "live" ? "Live model" : "Deterministic replay"}
      <span className="hidden font-mono font-normal text-zinc-400 2xl:inline">{model}</span>
    </div>
  );
}

/* A single scaled-down frame that reuses the canvas node renderer, so every
   preview in the product draws from one source of truth. */
function PhonePreview({ graph, selectedScreen }: { graph: SemanticInterfaceGraph; selectedScreen: string }) {
  const screen = graph.screens.find((item) => item.id === selectedScreen) ?? graph.screens[0];
  if (!screen) return null;
  const scale = 0.68;
  const width = 375;
  const height = 700;
  const nodes = screen.nodes.filter((node) => isNodeVisible(node, "idle"));
  return (
    <div className="relative grid min-h-[520px] place-items-center rounded-[32px] border border-[var(--line)] bg-[#e9ede8] p-6">
      <div style={{ width: width * scale, height: height * scale }}>
        <div
          className="phone-shell flex flex-col overflow-hidden rounded-[40px] bg-[#fcfdfb] px-7 pb-7 pt-5"
          style={{ width, height, transform: `scale(${scale})`, transformOrigin: "top left" }}
        >
          <div className="mb-4 flex items-center justify-between text-[12px] font-semibold text-[#2a2f2c]">
            <span className="pl-1 font-mono tracking-[-.02em]">9:41</span>
            <span className="flex items-center gap-1 pr-1" aria-hidden="true">
              <span className="h-2 w-3.5 rounded-[2px] border border-[#2a2f2c]/70" />
              <span className="h-2 w-2 rounded-full border border-[#2a2f2c]/70" />
            </span>
          </div>
          <span className="text-[11px] font-bold uppercase tracking-[.16em] text-[var(--accent)]">{graph.product.name}</span>
          <h3 className="mb-6 mt-1.5 text-[27px] font-semibold leading-[1.05] tracking-[-.045em]">{screen.title}</h3>
          <div className="flex min-h-0 flex-1 flex-col" style={{ gap: 18 }}>
            {nodes.map((node) => (
              <div key={node.id} className={node.kind === "primary-action" && node.layout.placement?.compact === "persistent-bottom" ? "mt-auto" : ""}>
                <NodePreview node={node} graph={graph} />
              </div>
            ))}
          </div>
          <div className="mx-auto mt-5 h-[5px] w-28 shrink-0 rounded-full bg-[#1d211f]" />
        </div>
      </div>
      <div className="absolute bottom-4 left-4 flex items-center gap-2 rounded-full border border-white/70 bg-white/75 px-3 py-1.5 text-[10px] font-medium text-zinc-600 backdrop-blur-xl">
        <DeviceMobile size={13} /> 375 × 667 · Compact
      </div>
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
  const [isPending, startTransition] = useTransition();
  const lastCommit = useRef({ at: 0, notice: "" });

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
                className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-[var(--accent-deep)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,.18)] transition-transform active:scale-[.96]"
              >
                <BracketsCurly size={16} weight="bold" />
              </button>
              {menuOpen ? (
                <>
                  <button type="button" aria-label="Close project menu" onClick={() => setMenuOpen(false)} className="fixed inset-0 z-[5] cursor-default" tabIndex={-1} />
                  <div className="menu-pop absolute left-0 top-10 z-[6] w-64 rounded-xl border border-[var(--line-strong)] bg-white p-1.5 shadow-[0_24px_60px_-24px_rgba(18,27,22,.4)]">
                    <div className="border-b border-[var(--line)] px-2.5 pb-2 pt-1.5">
                      <strong className="block text-[11px]">{graph.product.name}</strong>
                      <span className="mt-0.5 block font-mono text-[9px] text-[var(--faint)]">payment-flow.intentform · v{graph.schemaVersion}</span>
                    </div>
                    <button type="button" onClick={exportGraph} className="mt-1 flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[11px] text-[#2f3531] hover:bg-[#eef2ef]">
                      <DownloadSimple size={13} /> Export graph as JSON
                    </button>
                    <button type="button" onClick={resetProject} className="flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[11px] text-[#2f3531] hover:bg-[#eef2ef]">
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

          <nav aria-label="Workflow" className="mx-auto flex min-w-0 items-center rounded-[10px] border border-[var(--line)] bg-[#f1f3f0] p-0.5">
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
                  className={`group relative flex min-h-8 items-center justify-center gap-1.5 rounded-lg px-2 text-[10px] font-medium transition-[background,color,box-shadow,transform] duration-200 active:scale-[.97] lg:px-2.5 ${active ? "bg-white text-[var(--ink)] shadow-[0_5px_14px_-10px_rgba(20,32,26,.55),inset_0_0_0_1px_rgba(255,255,255,.8)]" : "text-[var(--muted)] hover:bg-white/60 hover:text-[var(--ink)]"}`}
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
            <div className="relative">
              <button type="button" aria-label="Show workspace status" aria-expanded={noticeOpen} onClick={() => setNoticeOpen((open) => !open)} className="grid size-8 place-items-center rounded-lg text-[var(--muted)] hover:bg-[#eef1ee] hover:text-[var(--ink)]">
                {noticeIsError ? <Warning size={14} weight="fill" className="text-[var(--danger)]" /> : <CheckCircle size={14} weight="fill" className="text-[var(--accent)]" />}
              </button>
              {noticeOpen ? (
                <div className="menu-pop absolute right-0 top-10 z-[6] w-80 overflow-hidden rounded-xl border border-[var(--line)] bg-white shadow-[0_18px_50px_-24px_rgba(21,36,29,.38)]">
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
          {isPending ? <div className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-[#dce6e1]"><motion.span className="block h-full w-1/3 bg-[var(--accent)]" initial={{ x: "-100%" }} animate={{ x: "300%" }} transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }} /></div> : null}
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
                <div className="mx-auto grid max-w-[1200px] gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(380px,.95fr)]">
                  <div className="pt-3 md:pt-10">
                    <span className="font-mono text-[11px] text-[var(--accent)]">01 / PRODUCT BRIEF</span>
                    <h2 className="mt-4 max-w-[620px] text-3xl font-semibold leading-[1.03] tracking-[-.055em] md:text-5xl">Describe the product. Keep the intent.</h2>
                    <p className="mt-5 max-w-[58ch] text-sm leading-relaxed text-[var(--muted)]">GPT‑5.6 turns a brief into a validated graph or proposes a narrow typed patch. React and SwiftUI are always compiled later by deterministic backends.</p>
                    <div className="mt-8 inline-flex rounded-xl border border-[var(--line)] bg-[#eef1ee] p-1" aria-label="Intent operation">
                      {(["create", "edit"] as const).map((operation) => (
                        <button key={operation} type="button" onClick={() => setBriefOperation(operation)} className={`min-h-8 rounded-lg px-3 text-[10px] font-semibold capitalize ${briefOperation === operation ? "bg-white text-[var(--ink)] shadow-sm" : "text-[var(--muted)]"}`}>{operation === "create" ? "New graph" : "Semantic edit"}</button>
                      ))}
                    </div>
                    <label className="mt-10 grid gap-2 text-xs font-semibold">
                      {briefOperation === "create" ? "Product brief" : "Edit instruction"}
                      <textarea
                        value={briefOperation === "create" ? brief : editInstruction}
                        onChange={(event) => briefOperation === "create" ? setBrief(event.target.value) : setEditInstruction(event.target.value)}
                        rows={8}
                        className="resize-none rounded-[24px] border border-[var(--line)] bg-white p-5 text-sm font-normal leading-relaxed outline-none transition-shadow focus:border-[var(--accent)] focus:shadow-[0_0_0_4px_rgba(57,116,97,.1)]"
                      />
                      <span className="flex items-center justify-between font-normal text-[var(--muted)]">
                        <span>{briefOperation === "create" ? "Describe audience, hierarchy, behavior and recovery." : "Describe one intent change. Only affected stable nodes will be patched."}</span>
                        <span className="font-mono text-[10px] text-[var(--faint)]">{(briefOperation === "create" ? brief : editInstruction).length} chars</span>
                      </span>
                    </label>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <button type="button" onClick={() => compileBrief(briefOperation)} className="inline-flex min-h-12 items-center gap-3 rounded-2xl bg-[var(--accent-deep)] px-5 text-sm font-semibold text-white transition-transform active:translate-y-px">
                        {briefOperation === "create" ? "Build semantic graph" : "Apply typed edit"} <ArrowRight size={16} />
                      </button>
                      <button type="button" onClick={() => setBrief(demoBrief)} className="inline-flex min-h-9 items-center rounded-xl border border-[var(--line)] bg-white px-3 text-xs font-medium text-[var(--muted)] hover:text-[var(--ink)]">
                        Use the verified sample brief
                      </button>
                    </div>
                  </div>
                  <PhonePreview graph={graph} selectedScreen={selectedScreen} />
                </div>
              ) : null}

              {stage === "graph" ? (
                <div className="mx-auto grid max-w-[1360px] gap-5 xl:grid-cols-[250px_minmax(340px,.8fr)_minmax(320px,1fr)]">
                  <div className="border-b border-[var(--line)] pb-5 xl:border-r xl:border-b-0 xl:pr-5">
                    <span className="font-mono text-[10px] text-[var(--accent)]">SCREENS</span>
                    <div className="mt-3 grid gap-2">
                      {graph.screens.map((screen) => (
                        <button key={screen.id} type="button" onClick={() => setSelectedScreen(screen.id)} className={`flex items-center justify-between rounded-xl px-3 py-3 text-left text-xs transition-colors ${selectedScreen === screen.id ? "bg-[#e2ece6] text-[#214d3f]" : "hover:bg-[#f0f2ef]"}`}>
                          <span><strong className="block">{screen.title}</strong><small className="font-mono text-[9px] opacity-60">{screen.route}</small></span>
                          <ArrowRight size={13} />
                        </button>
                      ))}
                    </div>
                    <div className="mt-6 rounded-xl border border-[var(--line)] bg-white p-3">
                      <span className="font-mono text-[9px] text-[var(--accent)]">FLOWS</span>
                      {graph.flows.flatMap((flow) => flow.steps).map((step) => (
                        <div key={`${step.from}-${step.event}`} className="mt-2.5 grid gap-0.5 text-[10px]">
                          <span className="font-mono text-[9px] text-[var(--faint)]">{step.event}</span>
                          <span className="flex items-center gap-1.5 text-[var(--muted)]">{step.from} <ArrowRight size={9} /> {step.to}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <PhonePreview graph={graph} selectedScreen={selectedScreen} />
                  <div className="min-w-0">
                    <div className="flex items-center justify-between"><span className="font-mono text-[10px] text-[var(--accent)]">SEMANTIC OUTLINE</span><span className="rounded-full bg-[#e6eae6] px-2 py-1 font-mono text-[9px]">valid · v{graph.schemaVersion}</span></div>
                    <div className="mt-3 divide-y divide-[var(--line)] border-y border-[var(--line)]">
                      {graph.screens.find((screen) => screen.id === selectedScreen)?.nodes.map((node, index) => (
                        <motion.div layout key={node.id} className="grid grid-cols-[24px_1fr_auto] gap-3 py-3.5">
                          <span className="font-mono text-[9px] text-zinc-400">{String(index + 1).padStart(2, "0")}</span>
                          <span className="min-w-0"><strong className="block truncate text-xs">{node.intent.label}</strong><small className="font-mono text-[9px] text-[var(--muted)]">{node.kind} · {node.id}</small></span>
                          <span className="self-center rounded-full border border-[var(--line)] px-2 py-1 text-[8px] font-semibold uppercase tracking-wider text-[var(--muted)]">{node.intent.importance}</span>
                        </motion.div>
                      ))}
                    </div>
                    {(() => {
                      const contract = graph.contracts.find((item) => item.screenId === selectedScreen);
                      if (!contract) return null;
                      return (
                        <div className="mt-5 rounded-2xl border border-[var(--line)] bg-white p-4">
                          <span className="font-mono text-[9px] text-[var(--accent)]">SCREEN CONTRACT</span>
                          <div className="mt-3 grid gap-3 text-[10px]">
                            <div><span className="text-[var(--faint)]">Data</span><div className="mt-1 flex flex-wrap gap-1.5">{contract.data.map((field) => <span key={field.name} className="rounded-md bg-[#eef1ee] px-1.5 py-0.5 font-mono text-[9px]">{field.name}: {field.type}</span>)}</div></div>
                            <div><span className="text-[var(--faint)]">Events</span><div className="mt-1 flex flex-wrap gap-1.5">{contract.events.map((event) => <span key={event.name} className="rounded-md bg-[#eef1ee] px-1.5 py-0.5 font-mono text-[9px]">{event.name}</span>)}</div></div>
                            <div><span className="text-[var(--faint)]">Visual states</span><div className="mt-1 flex flex-wrap gap-1.5">{contract.visualStates.map((state) => <span key={state} className="rounded-md bg-[var(--accent-soft)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--accent-dark)]">{state}</span>)}</div></div>
                          </div>
                        </div>
                      );
                    })()}
                    <button type="button" onClick={() => setStage("outputs")} className="mt-5 inline-flex items-center gap-2 text-xs font-semibold text-[var(--accent-dark)]">Inspect generated code <ArrowRight size={14} /></button>
                  </div>
                </div>
              ) : null}

              {stage === "outputs" ? (
                <div className="mx-auto grid max-w-[1400px] gap-5 xl:grid-cols-[minmax(330px,.72fr)_minmax(0,1.28fr)]">
                  <div>
                    {outputTarget === "react" ? (
                      <div className="overflow-hidden rounded-[32px] border border-[var(--line)] bg-[#e9ede8] p-4">
                        <div className="mb-3 flex items-center justify-between px-1 text-[10px] text-[var(--muted)]">
                          <span className="font-semibold text-[var(--accent-dark)]">Runnable golden artifact</span>
                          <span className="font-mono">{previewVariant} · {reactOutput.fingerprint}</span>
                        </div>
                        <iframe
                          key={`${previewVariant}-${selectedScreen}`}
                          src={`/react-preview/index.html?variant=${previewVariant}&screen=${selectedScreen}`}
                          title={`Generated React preview: ${selectedScreen}`}
                          sandbox="allow-scripts allow-same-origin"
                          className="h-[570px] w-full rounded-[22px] border border-[var(--line)] bg-white"
                        />
                      </div>
                    ) : <PhonePreview graph={graph} selectedScreen={selectedScreen} />}
                  </div>
                  <div className="min-w-0 overflow-hidden rounded-[24px] border border-[#303a35] bg-[#1c211f] text-[#dce5df] shadow-[0_24px_50px_-34px_rgba(18,28,23,.8)]">
                    <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                      <div className="flex gap-1 rounded-lg bg-white/5 p-1">
                        {(["react", "swiftui"] as const).map((target) => <button key={target} type="button" onClick={() => { setOutputTarget(target); setOutputFilePath(null); }} className={`rounded-md px-3 py-1.5 text-[10px] font-semibold capitalize ${outputTarget === target ? "bg-white/12 text-white" : "text-white/45 hover:text-white/70"}`}>{target}</button>)}
                      </div>
                      <div className="flex items-center gap-3">
                        <button type="button" onClick={copyGeneratedFile} className="inline-flex items-center gap-1.5 rounded-md bg-white/8 px-2.5 py-1.5 text-[10px] font-medium text-white/70 hover:bg-white/12 hover:text-white">
                          {copied ? <CheckCircle size={12} weight="fill" className="text-emerald-300" /> : <Copy size={12} />}
                          {copied ? "Copied" : "Copy file"}
                        </button>
                        <span className="hidden font-mono text-[9px] text-white/40 md:inline">sha {output.fingerprint}</span>
                      </div>
                    </div>
                    <div className="grid md:grid-cols-[190px_minmax(0,1fr)]">
                      <div className="hidden max-h-[590px] overflow-auto border-r border-white/10 p-2 md:block">
                        {output.files.map((file) => (
                          <button
                            key={file.path}
                            type="button"
                            onClick={() => setOutputFilePath(file.path)}
                            className={`block w-full truncate rounded-md px-2 py-1.5 text-left font-mono text-[9px] ${selectedCode?.path === file.path ? "bg-white/10 text-white" : "text-white/45 hover:bg-white/5 hover:text-white/75"}`}
                          >
                            {file.path}
                          </button>
                        ))}
                      </div>
                      <div className="min-w-0">
                        <div className="border-b border-white/10 px-4 py-2 font-mono text-[9px] text-[#8ea69b]">{selectedCode?.path}</div>
                        <pre className="code-scroll max-h-[550px] overflow-auto p-5 text-[10.5px] leading-[1.7]"><code>{selectedCode?.content}</code></pre>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              {stage === "verify" ? (
                <div className="mx-auto grid max-w-[1200px] gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
                  <div>
                    <div className="flex items-end justify-between border-b border-[var(--line)] pb-5">
                      <div><span className="font-mono text-[10px] text-[var(--accent)]">NATIVE VERIFICATION</span><h2 className="mt-2 text-3xl font-semibold tracking-[-.05em]">Evidence before claims.</h2></div>
                      <span className={`rounded-full px-3 py-1.5 text-[10px] font-semibold ${verification.passed ? "bg-[var(--accent-soft)] text-[var(--accent-dark)]" : "bg-[var(--danger-soft)] text-[var(--danger)]"}`}>{verification.passed ? "Passed" : `${verification.findings.length} findings`}</span>
                    </div>
                    <div className="mt-2 divide-y divide-[var(--line)]">
                      {verification.findings.length === 0 ? (
                        <div className="flex items-center gap-4 py-10"><CheckCircle size={34} weight="fill" className="text-[var(--accent)]" /><div><strong className="text-sm">All {scenario.label.toLowerCase()} assertions passed</strong><p className="mt-1 text-xs text-[var(--muted)]">The primary action remains reachable and both compiler outputs are structurally valid.</p></div></div>
                      ) : verification.findings.map((finding) => (
                        <div key={finding.id} className="grid gap-4 py-5 md:grid-cols-[30px_1fr_auto]">
                          <Warning size={22} weight="fill" className={finding.severity === "error" ? "text-[var(--danger)]" : "text-amber-600"} />
                          <div><strong className="text-sm">{finding.violatedIntent}</strong><p className="mt-1 font-mono text-[9px] text-[var(--muted)]">{finding.id} · layer: {finding.responsibleLayer}</p><div className="mt-3 flex flex-wrap gap-2">{finding.evidence.map((evidence) => <span key={evidence.label} className="rounded-lg bg-[#ecefec] px-2 py-1 font-mono text-[9px]">{evidence.label}: {String(evidence.value)}</span>)}</div></div>
                          {finding.severity === "error" ? <button type="button" onClick={() => repairFinding(finding)} disabled={isPending} className="self-start rounded-xl bg-[var(--accent-deep)] px-4 py-2.5 text-[10px] font-semibold text-white active:translate-y-px disabled:opacity-60">Plan repair</button> : null}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-[24px] border border-[var(--line)] bg-[#edf1ed] p-5">
                    <span className="font-mono text-[9px] text-[var(--accent)]">SCENARIO</span>
                    <div className="mt-3 grid grid-flow-col rounded-lg border border-[#dce0dd] bg-white p-0.5">
                      {(Object.entries(scenarios) as Array<[ScenarioId, typeof scenario]>).map(([id, item]) => (
                        <button key={id} type="button" aria-pressed={scenarioId === id} onClick={() => setScenarioId(id)} className={`min-h-8 rounded-md px-2 text-[10px] font-medium ${scenarioId === id ? "bg-[var(--accent-soft)] text-[var(--accent-dark)]" : "text-[#78817c] hover:text-[#343a36]"}`}>
                          {item.label}
                        </button>
                      ))}
                    </div>
                    <dl className="mt-6 grid grid-cols-2 gap-y-5 text-xs"><div><dt className="text-[var(--muted)]">Viewport</dt><dd className="mt-1 font-mono">{scenario.viewport.width} × {scenario.viewport.height}</dd></div><div><dt className="text-[var(--muted)]">Target</dt><dd className="mt-1 font-mono">SwiftUI</dd></div><div><dt className="text-[var(--muted)]">Build</dt><dd className="mt-1 text-[var(--accent)]">Passed</dd></div><div><dt className="text-[var(--muted)]">Rule set</dt><dd className="mt-1 font-mono">intentform/0.1</dd></div></dl>
                    <p className="mt-7 border-t border-[var(--line)] pt-5 text-xs leading-relaxed text-[var(--muted)]">Verification is scenario-dependent and independent from generation. A repair is only accepted after the same rule passes again.</p>
                  </div>
                </div>
              ) : null}

              {stage === "report" ? (
                <div className="mx-auto grid max-w-[1200px] gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(330px,.8fr)]">
                  <div>
                    <span className="font-mono text-[10px] text-[var(--accent)]">PROOF REPORT</span>
                    <h2 className="mt-3 max-w-[700px] text-3xl font-semibold tracking-[-.05em] md:text-4xl">The intent survived two compilers and one repair.</h2>
                    <div className="mt-8 border-y border-[var(--line)]">
                      {[{ label: "Graph validated", detail: `${graph.screens.length} screens · ${graph.screens.flatMap((screen) => screen.nodes).length} semantic nodes`, icon: TreeStructure }, { label: "React compiled", detail: `Fingerprint ${reactOutput.fingerprint}`, icon: Code }, { label: "SwiftUI compiled", detail: `Fingerprint ${swiftOutput.fingerprint}`, icon: DeviceMobile }, { label: `${scenario.label} verified`, detail: verification.passed ? "No blocking findings remain" : `${verification.findings.length} findings remain`, icon: ShieldCheck }].map((item, index) => {
                        const Icon = item.icon; return <div key={item.label} className="grid grid-cols-[26px_1fr_auto] items-center gap-4 border-b border-[var(--line)] py-4 last:border-0"><Icon size={18} className="text-[var(--accent)]" /><span><strong className="block text-sm">{item.label}</strong><small className="font-mono text-[9px] text-[var(--muted)]">{item.detail}</small></span><CheckCircle size={18} weight="fill" className={index === 3 && !verification.passed ? "text-zinc-300" : "text-[var(--accent)]"} /></div>;
                      })}
                    </div>
                    <button type="button" onClick={exportGraph} className="mt-6 inline-flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white px-4 py-2.5 text-xs font-semibold text-[var(--accent-dark)] hover:border-[var(--accent)]">
                      <DownloadSimple size={14} /> Export canonical graph
                    </button>
                  </div>
                  <div className="rounded-[24px] bg-[var(--accent-deep)] p-6 text-white shadow-[0_24px_50px_-34px_rgba(18,59,49,.85)]">
                    <div className="flex items-center justify-between"><span className="font-mono text-[9px] text-emerald-100/60">SEMANTIC DIFF</span><GitDiff size={18} /></div>
                    {changes.length > 0 ? <div className="mt-5 grid max-h-[420px] gap-4 overflow-auto">{changes.map((change) => <div key={change.path} className="border-t border-white/12 pt-4"><strong className="font-mono text-[10px] text-emerald-100">{change.path}</strong><div className="mt-2 grid gap-1 font-mono text-[9px]"><span className="text-red-200/70">− {JSON.stringify(change.before)}</span><span className="text-emerald-200">+ {JSON.stringify(change.after)}</span></div></div>)}</div> : <div className="mt-10 text-center"><GitDiff size={28} className="mx-auto text-emerald-100/40" /><p className="mt-3 text-xs text-emerald-50/70">Run the controlled repair to produce an evidence-backed semantic diff.</p><button type="button" onClick={() => setStage("verify")} className="mt-4 rounded-xl bg-white px-4 py-2 text-[10px] font-semibold text-[var(--accent-deep)]">Open verification</button></div>}
                    <p className="mt-8 border-t border-white/12 pt-5 text-xs leading-relaxed text-emerald-50/65">IntentForm does not translate pixels. It preserves product intent.</p>
                  </div>
                </div>
              ) : null}
            </motion.div>
          </AnimatePresence>
        </section>
      </div>
    </main>
  );
}
