"use client";

import {
  ArrowRight,
  BracketsCurly,
  CheckCircle,
  CircleNotch,
  Code,
  DeviceMobile,
  FileText,
  GitDiff,
  Play,
  ShieldCheck,
  Sparkle,
  Selection,
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
  type SemanticInterfaceGraph,
  type SemanticNode,
} from "@intentform/semantic-schema";
import { verifyGraph, type VerificationFinding } from "@intentform/verifier";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState, useTransition } from "react";
import { ManualEditor } from "./manual-editor";

type Stage = "canvas" | "brief" | "graph" | "outputs" | "verify" | "report";
type OutputTarget = "react" | "swiftui";

const stages: Array<{ id: Stage; label: string; icon: typeof Sparkle }> = [
  { id: "canvas", label: "Design canvas", icon: Selection },
  { id: "brief", label: "Brief", icon: Sparkle },
  { id: "graph", label: "Semantic graph", icon: TreeStructure },
  { id: "outputs", label: "Native outputs", icon: Code },
  { id: "verify", label: "Verification", icon: ShieldCheck },
  { id: "report", label: "Proof report", icon: FileText },
];

const compactScenario = {
  target: "swiftui" as const,
  viewport: { width: 375, height: 667 },
  buildPassed: true,
};

function getSessionId(): string {
  const key = "intentform-session";
  const current = window.sessionStorage.getItem(key);
  if (current) return current;
  const next = crypto.randomUUID();
  window.sessionStorage.setItem(key, next);
  return next;
}

function ModeBadge({ mode, model }: { mode: "live" | "replay"; model: string }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-white/80 px-3 py-1.5 text-xs font-semibold text-[var(--muted)] shadow-[inset_0_1px_0_rgba(255,255,255,.7)]">
      <span className={`status-breathe size-2 rounded-full ${mode === "live" ? "bg-[var(--accent)]" : "bg-amber-500"}`} />
      {mode === "live" ? "Live model" : "Deterministic replay"}
      <span className="font-mono font-normal text-zinc-400">{model}</span>
    </div>
  );
}

function PhoneNode({ node }: { node: SemanticNode }) {
  switch (node.kind) {
    case "balance-summary":
      return (
        <div className="grid gap-1 rounded-[24px] bg-[#173c32] p-5 text-white shadow-[0_18px_32px_-22px_rgba(23,60,50,.65)]">
          <span className="text-[10px] text-emerald-100/70">Available balance</span>
          <strong className="font-mono text-[27px] tracking-[-0.05em]">€8,420.16</strong>
          <span className="text-[9px] text-emerald-100/60">Updated just now</span>
        </div>
      );
    case "transaction-list":
      return (
        <div className="grid gap-2">
          <span className="text-[11px] font-semibold">Recent activity</span>
          {["Riva Studio", "Northline Market"].map((name, index) => (
            <div key={name} className="flex items-center justify-between border-t border-[#dde2dd] py-2.5 text-[10px]">
              <span>{name}</span><strong className="font-mono">−€{index === 0 ? "84.20" : "32.70"}</strong>
            </div>
          ))}
        </div>
      );
    case "money-input":
      return (
        <label className="grid gap-1.5 text-[10px] font-medium">
          Amount
          <span className="rounded-2xl border border-[#cfd8d1] bg-white px-4 py-3 font-mono text-[22px] font-semibold tracking-[-0.04em]">€120.00</span>
        </label>
      );
    case "recipient-identity":
      return (
        <div className="flex items-center gap-2.5 border-y border-[#dde2dd] py-3">
          <span className="grid size-9 place-items-center rounded-full bg-[#deebe5] text-[9px] font-bold text-[#2f6654]">MR</span>
          <span className="grid"><strong className="text-[10px]">Mara Rinaldi</strong><small className="text-[8px] text-zinc-500">mara@northline.test</small></span>
        </div>
      );
    case "status-message":
      return <div className="hidden border-l-2 border-[#a24c39] bg-[#f5e5df] p-2 text-[9px] text-[#713628]">{node.intent.label}</div>;
    case "receipt-summary":
      return (
        <div className="grid justify-items-center gap-1 rounded-[24px] bg-[#e3efe8] p-6 text-center">
          <CheckCircle size={28} weight="fill" className="text-[var(--accent)]" />
          <span className="text-[10px]">Payment request sent</span>
          <strong className="font-mono text-[25px]">€120.00</strong>
          <small className="text-[8px] text-zinc-500">Reference IF-2048</small>
        </div>
      );
    case "primary-action":
      return (
        <button
          type="button"
          className={`w-full rounded-2xl bg-[var(--accent)] px-4 py-3 text-[10px] font-bold text-white shadow-[0_12px_22px_-16px_rgba(57,116,97,.8)] active:translate-y-px ${node.layout.placement?.compact === "persistent-bottom" ? "mt-auto" : ""}`}
        >
          {node.intent.label}
        </button>
      );
    default:
      return null;
  }
}

function PhonePreview({ graph, selectedScreen }: { graph: SemanticInterfaceGraph; selectedScreen: string }) {
  const screen = graph.screens.find((item) => item.id === selectedScreen) ?? graph.screens[0];
  if (!screen) return null;
  return (
    <div className="phone-grid relative grid min-h-[520px] place-items-center rounded-[32px] border border-[var(--line)] bg-[#e9ede8] p-6">
      <motion.div
        layout
        className="phone-shell flex h-[468px] w-[226px] flex-col overflow-hidden rounded-[34px] border-[7px] border-[#202522] bg-[#fbfcf9] p-4"
      >
        <div className="mx-auto mb-4 h-3.5 w-16 rounded-full bg-[#202522]" />
        <span className="text-[8px] font-bold uppercase tracking-[.15em] text-[var(--accent)]">Verdant Pay</span>
        <h3 className="mb-4 mt-1 text-[19px] font-semibold tracking-[-.05em]">{screen.title}</h3>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
          {screen.nodes.map((node) => <PhoneNode key={node.id} node={node} />)}
        </div>
        <div className="mx-auto mt-3 h-1 w-20 rounded-full bg-[#202522]" />
      </motion.div>
      <div className="absolute bottom-4 left-4 flex items-center gap-2 rounded-full border border-white/70 bg-white/75 px-3 py-1.5 text-[10px] font-medium text-zinc-600 backdrop-blur-xl">
        <DeviceMobile size={13} /> 375 × 667 · Compact
      </div>
    </div>
  );
}

export function Studio() {
  const [stage, setStage] = useState<Stage>("canvas");
  const [brief, setBrief] = useState(demoBrief);
  const [graph, setGraph] = useState<SemanticInterfaceGraph>(demoGraph);
  const [baseline, setBaseline] = useState<SemanticInterfaceGraph>(demoGraph);
  const [selectedScreen, setSelectedScreen] = useState("payment-request");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>("payment-request.amount");
  const [history, setHistory] = useState<SemanticInterfaceGraph[]>([]);
  const [future, setFuture] = useState<SemanticInterfaceGraph[]>([]);
  const [outputTarget, setOutputTarget] = useState<OutputTarget>("react");
  const [mode, setMode] = useState<"live" | "replay">("replay");
  const [model, setModel] = useState("deterministic-sample");
  const [notice, setNotice] = useState("Ready to compile the sample brief.");
  const [isPending, startTransition] = useTransition();

  const reactOutput = useMemo(() => compileReact(graph), [graph]);
  const swiftOutput = useMemo(() => compileSwiftUI(graph), [graph]);
  const verification = useMemo(() => verifyGraph(graph, compactScenario), [graph]);
  const changes = useMemo(() => semanticDiff(baseline, graph), [baseline, graph]);
  const output = outputTarget === "react" ? reactOutput : swiftOutput;
  const selectedScreenIndex = Math.max(0, graph.screens.findIndex((screen) => screen.id === selectedScreen));
  const selectedCode = output.files[selectedScreenIndex] ?? output.files[0];
  const previewVariant = graph.screens
    .find((screen) => screen.id === "payment-request")
    ?.nodes.find((node) => node.kind === "primary-action")
    ?.layout.placement?.compact === "persistent-bottom" ? "after" : "before";

  const commitGraph = (nextGraph: SemanticInterfaceGraph, nextNotice: string) => {
    setHistory((items) => [...items.slice(-39), graph]);
    setFuture([]);
    setGraph(nextGraph);
    setNotice(nextNotice);
  };

  const undo = () => {
    const previous = history.at(-1);
    if (!previous) return;
    setHistory((items) => items.slice(0, -1));
    setFuture((items) => [graph, ...items].slice(0, 40));
    setGraph(previous);
    setNotice("Undid the last semantic edit.");
  };

  const redo = () => {
    const next = future[0];
    if (!next) return;
    setFuture((items) => items.slice(1));
    setHistory((items) => [...items.slice(-39), graph]);
    setGraph(next);
    setNotice("Restored the semantic edit.");
  };

  const compileBrief = () => {
    startTransition(async () => {
      try {
        setNotice("Interpreting product intent and validating the graph…");
        const response = await fetch("/api/interpret", {
          method: "POST",
          headers: { "content-type": "application/json", "x-intentform-session": getSessionId() },
          body: JSON.stringify({ brief }),
        });
        if (!response.ok) throw new Error("The brief could not be interpreted.");
        const result = (await response.json()) as { graph: unknown; mode: "live" | "replay"; model: string; note: string };
        const nextGraph = parseGraph(result.graph);
        setGraph(nextGraph);
        setBaseline(nextGraph);
        setMode(result.mode);
        setModel(result.model);
        setNotice(result.note);
        const nextScreen = nextGraph.screens.find((screen) => screen.id === "payment-request") ?? nextGraph.screens[0];
        setSelectedScreen(nextScreen?.id ?? "");
        setSelectedNodeId(nextScreen?.nodes[0]?.id ?? null);
        setHistory([]);
        setFuture([]);
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
          body: JSON.stringify({ graph, finding }),
        });
        if (!response.ok) throw new Error("A safe repair could not be planned.");
        const result = (await response.json()) as { proposal: RepairProposal; mode: "live" | "replay"; model: string };
        const repaired = applyRepair(graph, result.proposal);
        setGraph(repaired);
        setMode(result.mode);
        setModel(result.model);
        setNotice(result.proposal.summary);
        setStage("report");
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Repair failed.");
      }
    });
  };

  const errorFinding = verification.findings.find((finding) => finding.severity === "error");

  return (
    <main className="studio-grain min-h-[100dvh] p-2 text-[var(--ink)]">
      <div className="mx-auto grid min-h-[calc(100dvh-16px)] max-w-[1680px] overflow-hidden rounded-[18px] border border-white/70 bg-[var(--surface)] shadow-[0_32px_90px_-46px_rgba(21,36,29,.32)] md:grid-cols-[92px_1fr]">
        <aside className="flex flex-col border-b border-[var(--line)] bg-[#eef1ed] p-2 md:border-r md:border-b-0">
          <div className="flex items-center gap-3 px-1 py-2 md:flex-col md:gap-1">
            <div className="grid size-9 place-items-center rounded-xl bg-[#183b31] text-white shadow-[inset_0_1px_0_rgba(255,255,255,.16)]"><BracketsCurly size={19} weight="bold" /></div>
            <div className="md:text-center"><strong className="block tracking-[-.03em] md:text-[10px]">IntentForm</strong><span className="text-[10px] text-[var(--muted)] md:hidden">Build Week · 0.1</span></div>
          </div>

          <nav aria-label="Workflow" className="mt-3 grid grid-cols-6 gap-1 md:mt-7 md:grid-cols-1 md:gap-1.5">
            {stages.map((item) => {
              const Icon = item.icon;
              const active = stage === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  title={item.label}
                  onClick={() => setStage(item.id)}
                  className={`group flex min-h-11 items-center justify-center gap-3 rounded-xl px-2 text-left text-xs font-medium transition-[background,color,transform] duration-200 active:scale-[.98] md:min-h-[58px] md:flex-col md:gap-1 md:px-1 md:py-2 ${active ? "bg-white text-[var(--ink)] shadow-[0_10px_24px_-18px_rgba(21,36,29,.45)]" : "text-[var(--muted)] hover:bg-white/60 hover:text-[var(--ink)]"}`}
                >
                  <Icon size={17} weight={active ? "fill" : "regular"} />
                  <span className="hidden max-w-[72px] text-center text-[9px] leading-[1.15] md:block">{item.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="mt-auto hidden border-t border-[var(--line)] px-1 pt-3 md:block">
            <div className="flex items-center justify-center gap-1.5 text-[8px] font-semibold text-[var(--muted)]"><span className={`status-breathe size-1.5 rounded-full ${mode === "live" ? "bg-[var(--accent)]" : "bg-amber-500"}`} />{mode === "live" ? "Live" : "Replay"}</div>
          </div>
        </aside>

        <section className="min-w-0">
          <header className="flex min-h-[68px] flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-3 md:px-5">
            <div>
              <span className="font-mono text-[9px] text-[var(--muted)]">{graph.product.name} / payment-flow.intentform</span>
              <h1 className="mt-0.5 text-base font-semibold tracking-[-.035em]">{stages.find((item) => item.id === stage)?.label}</h1>
            </div>
            <div className="flex items-center gap-2">
              <div className="hidden xl:block"><ModeBadge mode={mode} model={model} /></div>
              <div role="status" aria-live="polite" className="hidden max-w-[360px] truncate rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-[9px] text-[var(--muted)] 2xl:block">{notice}</div>
              <button
                type="button"
                onClick={compileBrief}
                disabled={isPending}
                className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-[var(--accent)] px-3.5 text-[10px] font-semibold text-white transition-[transform,background] hover:bg-[var(--accent-dark)] active:scale-[.98] disabled:cursor-wait disabled:opacity-70"
              >
                {isPending ? <CircleNotch className="animate-spin" size={15} /> : <Play size={15} weight="fill" />}
                {stage === "canvas" ? "Recompile" : "Compile intent"}
              </button>
            </div>
          </header>

          <AnimatePresence mode="wait">
            <motion.div
              key={stage}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ type: "spring", stiffness: 120, damping: 20 }}
              className={stage === "canvas" ? "p-2" : "p-5 md:p-8"}
            >
              {stage === "canvas" ? (
                <ManualEditor
                  graph={graph}
                  selectedScreen={selectedScreen}
                  selectedNodeId={selectedNodeId}
                  canUndo={history.length > 0}
                  canRedo={future.length > 0}
                  onSelectScreen={setSelectedScreen}
                  onSelectNode={setSelectedNodeId}
                  onCommit={commitGraph}
                  onUndo={undo}
                  onRedo={redo}
                />
              ) : null}

              {stage === "brief" ? (
                <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(380px,.95fr)]">
                  <div className="pt-3 md:pt-10">
                    <span className="font-mono text-[11px] text-[var(--accent)]">01 / PRODUCT BRIEF</span>
                    <h2 className="mt-4 max-w-[620px] text-3xl font-semibold leading-[1.03] tracking-[-.055em] md:text-5xl">Describe the product. Keep the intent.</h2>
                    <p className="mt-5 max-w-[58ch] text-sm leading-relaxed text-[var(--muted)]">GPT‑5.6 turns the brief into a validated semantic graph. React and SwiftUI are compiled later by deterministic backends.</p>
                    <label className="mt-10 grid gap-2 text-xs font-semibold">
                      Product brief
                      <textarea
                        value={brief}
                        onChange={(event) => setBrief(event.target.value)}
                        rows={8}
                        className="resize-none rounded-[24px] border border-[var(--line)] bg-white p-5 text-sm font-normal leading-relaxed outline-none transition-shadow focus:border-[var(--accent)] focus:shadow-[0_0_0_4px_rgba(57,116,97,.1)]"
                      />
                      <span className="font-normal text-[var(--muted)]">Describe audience, hierarchy, behavior and recovery. Avoid implementation details.</span>
                    </label>
                    <button type="button" onClick={compileBrief} className="mt-5 inline-flex min-h-12 items-center gap-3 rounded-2xl bg-[#183b31] px-5 text-sm font-semibold text-white transition-transform active:translate-y-px">
                      Build semantic graph <ArrowRight size={16} />
                    </button>
                  </div>
                  <PhonePreview graph={graph} selectedScreen={selectedScreen} />
                </div>
              ) : null}

              {stage === "graph" ? (
                <div className="grid gap-5 xl:grid-cols-[250px_minmax(340px,.8fr)_minmax(320px,1fr)]">
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
                    <button type="button" onClick={() => setStage("outputs")} className="mt-5 inline-flex items-center gap-2 text-xs font-semibold text-[var(--accent-dark)]">Inspect generated code <ArrowRight size={14} /></button>
                  </div>
                </div>
              ) : null}

              {stage === "outputs" ? (
                <div className="grid gap-5 xl:grid-cols-[minmax(330px,.72fr)_minmax(0,1.28fr)]">
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
                        {(["react", "swiftui"] as const).map((target) => <button key={target} type="button" onClick={() => setOutputTarget(target)} className={`rounded-md px-3 py-1.5 text-[10px] font-semibold capitalize ${outputTarget === target ? "bg-white/12 text-white" : "text-white/45"}`}>{target}</button>)}
                      </div>
                      <span className="font-mono text-[9px] text-white/40">sha {output.fingerprint}</span>
                    </div>
                    <div className="border-b border-white/10 px-4 py-2 font-mono text-[9px] text-[#8ea69b]">{selectedCode?.path}</div>
                    <pre className="code-scroll max-h-[570px] overflow-auto p-5 text-[10px] leading-[1.7]"><code>{selectedCode?.content}</code></pre>
                  </div>
                </div>
              ) : null}

              {stage === "verify" ? (
                <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
                  <div>
                    <div className="flex items-end justify-between border-b border-[var(--line)] pb-5">
                      <div><span className="font-mono text-[10px] text-[var(--accent)]">NATIVE VERIFICATION</span><h2 className="mt-2 text-3xl font-semibold tracking-[-.05em]">Evidence before claims.</h2></div>
                      <span className={`rounded-full px-3 py-1.5 text-[10px] font-semibold ${verification.passed ? "bg-[var(--accent-soft)] text-[var(--accent-dark)]" : "bg-[var(--danger-soft)] text-[var(--danger)]"}`}>{verification.passed ? "Passed" : `${verification.findings.length} findings`}</span>
                    </div>
                    <div className="mt-2 divide-y divide-[var(--line)]">
                      {verification.findings.length === 0 ? (
                        <div className="flex items-center gap-4 py-10"><CheckCircle size={34} weight="fill" className="text-[var(--accent)]" /><div><strong className="text-sm">All compact-layout assertions passed</strong><p className="mt-1 text-xs text-[var(--muted)]">The primary action remains reachable and both compiler outputs are structurally valid.</p></div></div>
                      ) : verification.findings.map((finding) => (
                        <div key={finding.id} className="grid gap-4 py-5 md:grid-cols-[30px_1fr_auto]">
                          <Warning size={22} weight="fill" className={finding.severity === "error" ? "text-[var(--danger)]" : "text-amber-600"} />
                          <div><strong className="text-sm">{finding.violatedIntent}</strong><p className="mt-1 font-mono text-[9px] text-[var(--muted)]">{finding.id} · layer: {finding.responsibleLayer}</p><div className="mt-3 flex flex-wrap gap-2">{finding.evidence.map((evidence) => <span key={evidence.label} className="rounded-lg bg-[#ecefec] px-2 py-1 font-mono text-[9px]">{evidence.label}: {String(evidence.value)}</span>)}</div></div>
                          {finding.severity === "error" ? <button type="button" onClick={() => repairFinding(finding)} disabled={isPending} className="self-start rounded-xl bg-[#183b31] px-4 py-2.5 text-[10px] font-semibold text-white active:translate-y-px">Plan repair</button> : null}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-[24px] border border-[var(--line)] bg-[#edf1ed] p-5">
                    <span className="font-mono text-[9px] text-[var(--accent)]">SCENARIO</span>
                    <h3 className="mt-2 text-lg font-semibold tracking-[-.04em]">Compact iPhone</h3>
                    <dl className="mt-6 grid grid-cols-2 gap-y-5 text-xs"><div><dt className="text-[var(--muted)]">Viewport</dt><dd className="mt-1 font-mono">375 × 667</dd></div><div><dt className="text-[var(--muted)]">Target</dt><dd className="mt-1 font-mono">SwiftUI</dd></div><div><dt className="text-[var(--muted)]">Build</dt><dd className="mt-1 text-[var(--accent)]">Passed</dd></div><div><dt className="text-[var(--muted)]">Rule set</dt><dd className="mt-1 font-mono">intentform/0.1</dd></div></dl>
                    {errorFinding ? <p className="mt-7 border-t border-[var(--line)] pt-5 text-xs leading-relaxed text-[var(--muted)]">The controlled failure proves that verification is independent from generation. Repair must pass the same rule again.</p> : null}
                  </div>
                </div>
              ) : null}

              {stage === "report" ? (
                <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(330px,.8fr)]">
                  <div>
                    <span className="font-mono text-[10px] text-[var(--accent)]">PROOF REPORT</span>
                    <h2 className="mt-3 max-w-[700px] text-3xl font-semibold tracking-[-.05em] md:text-4xl">The intent survived two compilers and one repair.</h2>
                    <div className="mt-8 border-y border-[var(--line)]">
                      {[{ label: "Graph validated", detail: `${graph.screens.length} screens · ${graph.screens.flatMap((screen) => screen.nodes).length} semantic nodes`, icon: TreeStructure }, { label: "React compiled", detail: `Fingerprint ${reactOutput.fingerprint}`, icon: Code }, { label: "SwiftUI compiled", detail: `Fingerprint ${swiftOutput.fingerprint}`, icon: DeviceMobile }, { label: "Compact scenario verified", detail: verification.passed ? "No blocking findings remain" : `${verification.findings.length} findings remain`, icon: ShieldCheck }].map((item, index) => {
                        const Icon = item.icon; return <div key={item.label} className="grid grid-cols-[26px_1fr_auto] items-center gap-4 border-b border-[var(--line)] py-4 last:border-0"><Icon size={18} className="text-[var(--accent)]" /><span><strong className="block text-sm">{item.label}</strong><small className="font-mono text-[9px] text-[var(--muted)]">{item.detail}</small></span><CheckCircle size={18} weight="fill" className={index === 3 && !verification.passed ? "text-zinc-300" : "text-[var(--accent)]"} /></div>;
                      })}
                    </div>
                  </div>
                  <div className="rounded-[24px] bg-[#183b31] p-6 text-white shadow-[0_24px_50px_-34px_rgba(18,59,49,.85)]">
                    <div className="flex items-center justify-between"><span className="font-mono text-[9px] text-emerald-100/60">SEMANTIC DIFF</span><GitDiff size={18} /></div>
                    {changes.length > 0 ? <div className="mt-5 grid gap-4">{changes.map((change) => <div key={change.path} className="border-t border-white/12 pt-4"><strong className="font-mono text-[10px] text-emerald-100">{change.path}</strong><div className="mt-2 grid gap-1 font-mono text-[9px]"><span className="text-red-200/70">− {JSON.stringify(change.before)}</span><span className="text-emerald-200">+ {JSON.stringify(change.after)}</span></div></div>)}</div> : <div className="mt-10 text-center"><GitDiff size={28} className="mx-auto text-emerald-100/40" /><p className="mt-3 text-xs text-emerald-50/70">Run the controlled repair to produce an evidence-backed semantic diff.</p><button type="button" onClick={() => setStage("verify")} className="mt-4 rounded-xl bg-white px-4 py-2 text-[10px] font-semibold text-[#183b31]">Open verification</button></div>}
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
