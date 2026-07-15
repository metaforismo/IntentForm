"use client";

import {
  ArrowSquareOut,
  CaretDown,
  CaretRight,
  CheckCircle,
  Copy,
  MagnifyingGlass,
  Play,
  Warning,
} from "@phosphor-icons/react";
import { resolveTokenMode, type SemanticInterfaceGraph } from "@intentform/semantic-schema";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { OutputTarget } from "../studio";
import type { StudioGeneratedFileSet } from "../target-compilation";
import {
  PREVIEW_READY,
  PREVIEW_REQUEST,
  PREVIEW_STATUS,
  type ActivePreviewRequest,
  type ActivePreviewStatus,
} from "../runtime-preview-protocol";
import type { LocalPreviewsController } from "../use-local-previews";
import { HistoryPanel } from "../history-panel";
import { PhonePreview } from "./phone-preview";
import { localPreviewTarget, matchingCodeLineNumbers, usableLocalPreview } from "./workspace-model";

type EvidenceTab = "build" | "accessibility" | "layout" | "screenshot" | "logs";

interface OutputsStageProps {
  outputTarget: OutputTarget;
  setOutputTarget: (target: OutputTarget) => void;
  setOutputFilePath: (path: string | null) => void;
  output: StudioGeneratedFileSet | null;
  outputMessage: string | null;
  reactOutput: StudioGeneratedFileSet | null;
  reactMessage: string | null;
  selectedCode: StudioGeneratedFileSet["files"][number] | undefined;
  copyGeneratedFile: () => void;
  copied: boolean;
  graph: SemanticInterfaceGraph;
  selectedScreen: string;
  localPreviews: LocalPreviewsController;
  scenarioLabel: string;
  onLocalProjectChanged: () => void;
}

export function OutputsStage({
  outputTarget,
  setOutputTarget,
  setOutputFilePath,
  output,
  outputMessage,
  reactOutput,
  reactMessage,
  selectedCode,
  copyGeneratedFile,
  copied,
  graph,
  selectedScreen,
  localPreviews,
  scenarioLabel,
  onLocalProjectChanged,
}: OutputsStageProps) {
  const previewFrame = useRef<HTMLIFrameElement>(null);
  const fileTree = useRef<HTMLDivElement>(null);
  const [previewStatus, setPreviewStatus] = useState<"loading" | "ready" | "error">("loading");
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewWidth, setPreviewWidth] = useState(100);
  const [codeQuery, setCodeQuery] = useState("");
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [evidenceTab, setEvidenceTab] = useState<EvidenceTab>("build");
  const [projectDrawerOpen, setProjectDrawerOpen] = useState(false);
  const webScreen = graph.screens.find((screen) => screen.id === selectedScreen) ?? graph.screens[0];
  const webTokens = resolveTokenMode(graph.tokens);
  const previewTarget = localPreviewTarget(outputTarget);
  const previewEvidence = usableLocalPreview(localPreviews.byTarget[previewTarget]);
  const outputFreshness = previewEvidence?.freshness ?? "not-run";
  const files = output?.files ?? [];
  const selectedLines = selectedCode?.content.split("\n") ?? [];
  const matchingLines = useMemo(() => matchingCodeLineNumbers(selectedLines, codeQuery), [codeQuery, selectedLines]);

  const sendPreview = useCallback(() => {
    if (!reactOutput) return;
    const message: ActivePreviewRequest = {
      type: PREVIEW_REQUEST,
      fingerprint: reactOutput.fingerprint,
      graph,
      selectedScreen,
    };
    previewFrame.current?.contentWindow?.postMessage(message, "*");
  }, [graph, reactOutput, selectedScreen]);

  useEffect(() => {
    if (!reactOutput) {
      setPreviewStatus("error");
      setPreviewError(reactMessage ?? "The React target is unavailable for this graph.");
      return;
    }
    setPreviewStatus("loading");
    setPreviewError(null);
    sendPreview();
  }, [reactMessage, reactOutput, sendPreview]);

  useEffect(() => {
    if (!reactOutput) return;
    const receive = (event: MessageEvent<unknown>) => {
      if (event.source !== previewFrame.current?.contentWindow || !event.data || typeof event.data !== "object") return;
      const type = (event.data as { type?: unknown }).type;
      if (type === PREVIEW_READY) { sendPreview(); return; }
      const message = event.data as Partial<ActivePreviewStatus>;
      if (message.type !== PREVIEW_STATUS || message.fingerprint !== reactOutput.fingerprint) return;
      setPreviewStatus(message.status === "ready" ? "ready" : "error");
      setPreviewError(message.status === "error" ? message.message ?? "The preview could not be rendered." : null);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [reactOutput, sendPreview]);

  const focusFile = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const buttons = [...(fileTree.current?.querySelectorAll<HTMLButtonElement>('[role="treeitem"]') ?? [])];
    buttons[index + (event.key === "ArrowDown" ? 1 : -1)]?.focus();
  };

  const openGeneratedFile = () => {
    if (!selectedCode) return;
    const url = URL.createObjectURL(new Blob([selectedCode.content], { type: "text/plain" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = selectedCode.path.split("/").at(-1) ?? "generated.txt";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const renderPreview = () => {
    if (!output) return <div role="alert" className="grid h-full place-items-center p-8 text-center text-xs text-[var(--warn)]">{outputMessage}</div>;
    if (outputTarget === "react") return (
      <div className="relative h-full bg-[var(--canvas)] p-3">
        <iframe ref={previewFrame} src="/runtime-preview" onLoad={sendPreview} title={`Generated React preview: ${selectedScreen}`} sandbox="allow-scripts" className="h-full w-full border border-[var(--line)] bg-white" />
        {previewError ? <div role="alert" className="absolute inset-3 grid place-items-center bg-[var(--backdrop)] p-6 text-center"><div className="rounded-lg border border-[var(--danger)]/30 bg-[var(--panel)] p-4 text-xs text-[var(--danger)]"><p>{previewError}</p><button type="button" onClick={sendPreview} className="mt-3 rounded-md bg-[var(--danger)] px-3 py-2 font-semibold text-white">Retry</button></div></div> : null}
      </div>
    );
    if ((outputTarget === "swiftui" || outputTarget === "expo")) return <div className="h-full overflow-auto bg-[var(--canvas)] p-4"><PhonePreview graph={graph} selectedScreen={selectedScreen} /></div>;
    if (outputTarget === "web" && graph.web && webScreen) return (
      <div className="flex h-full justify-center overflow-auto bg-[var(--canvas)] p-3">
        <div data-testid="responsive-web-preview" className="h-full overflow-auto border border-[var(--line)] bg-white text-zinc-900" style={{ width: `${previewWidth}%`, background: webTokens.colors["color.canvas"] ?? "#f3f5f1" }}>
          <div className="p-[clamp(24px,5vw,64px)]"><h2 className="text-3xl font-semibold">{webScreen.title}</h2><p className="mt-3 text-sm text-zinc-600">{webScreen.purpose}</p><div className="mt-8 grid gap-3">{webScreen.nodes.map((node) => <div key={node.id} className="border border-zinc-200 p-4"><strong className="text-sm">{node.intent.label ?? node.intent.purpose}</strong></div>)}</div></div>
        </div>
      </div>
    );
    return <div className="grid h-full place-items-center p-8 text-xs text-[var(--muted)]">Preview unavailable for this target.</div>;
  };

  const evidenceContent = () => {
    if (evidenceTab === "build") return <div className="grid gap-1"><strong>{previewEvidence ? `${previewEvidence.phase} · ${previewEvidence.evidence}` : "Not run"}</strong><span>Freshness: {outputFreshness}. Build status: {previewEvidence?.buildStatus ?? "not-run"}.</span></div>;
    if (evidenceTab === "accessibility") return <div>Open Verify for the current target, device, visual state, and WCAG profile matrix.</div>;
    if (evidenceTab === "layout") return <div className="font-mono">graph {previewEvidence?.expectedBinding.graphDigest ?? "not-bound"} · compiler {previewEvidence?.expectedBinding.compilerFingerprint ?? output?.fingerprint ?? "not-generated"}</div>;
    if (evidenceTab === "screenshot") return <div>{previewEvidence?.manifest?.artifacts.length ? previewEvidence.manifest.artifacts.map((artifact) => <p key={artifact.path}>{artifact.kind} · {artifact.path.split("/").at(-1)}</p>) : "No screenshot evidence captured."}</div>;
    return <div className="max-h-36 overflow-auto font-mono">{previewEvidence?.manifest?.logs.length ? previewEvidence.manifest.logs.map((log) => <p key={`${log.at}:${log.text}`}>{log.stream} · {log.text}</p>) : "No build logs yet."}</div>;
  };

  return (
    <div className="relative mx-auto grid h-full min-h-[680px] max-w-[1600px] grid-rows-[42px_minmax(0,1fr)_auto] overflow-hidden border border-[var(--line)] bg-[var(--panel)]">
      <header className="col-span-full flex min-w-0 items-center justify-between gap-3 border-b border-[var(--line)] px-2">
        <div className="flex items-center gap-1" role="group" aria-label="Output target">
          {(["web", "react", "expo", "swiftui"] as const).map((target) => <button key={target} type="button" aria-pressed={outputTarget === target} onClick={() => { setOutputTarget(target); setOutputFilePath(null); }} className={`h-7 rounded px-2.5 text-[10px] font-semibold capitalize ${outputTarget === target ? "bg-[var(--accent-soft)] text-[var(--accent-text)]" : "text-[var(--muted)] hover:bg-[var(--hover)]"}`}>{target}</button>)}
        </div>
        <div className="flex min-w-0 items-center gap-2 text-[9px] text-[var(--muted)]">
          <span className="hidden truncate md:inline">{scenarioLabel}</span>
          <span className="hidden font-mono lg:inline" aria-live="polite">{outputTarget === "react" && reactOutput ? `${previewStatus === "ready" ? "Current" : previewStatus === "error" ? "Failed" : "Syncing"} · ${reactOutput.fingerprint}` : output ? `Generated · ${output.fingerprint}` : "Not generated"}</span>
          <span className={`rounded px-1.5 py-1 font-semibold ${outputFreshness === "fresh" ? "bg-[var(--success-soft)] text-[var(--success)]" : "bg-[var(--warn-soft)] text-[var(--warn)]"}`}>{outputFreshness}</span>
          <span className="hidden font-mono lg:inline">{output?.fingerprint ?? "not-generated"}</span>
          <button type="button" disabled={!localPreviews.enabled || localPreviews.pendingTarget === previewTarget} onClick={() => void localPreviews.mutate("start", previewTarget)} className="inline-flex h-7 items-center gap-1 rounded bg-[var(--accent-deep)] px-2.5 font-semibold text-white disabled:opacity-40"><Play size={11} /> Build</button>
          <button type="button" disabled={!selectedCode} onClick={copyGeneratedFile} className="inline-flex h-7 items-center gap-1 rounded border border-[var(--line)] px-2 font-semibold disabled:opacity-40">{copied ? <CheckCircle size={11} /> : <Copy size={11} />}{copied ? "Copied" : "Copy file"}</button>
          <button type="button" disabled={!selectedCode} onClick={openGeneratedFile} className="inline-flex h-7 items-center gap-1 rounded border border-[var(--line)] px-2 font-semibold disabled:opacity-40"><ArrowSquareOut size={11} /> Open output</button>
          <button type="button" aria-expanded={projectDrawerOpen} onClick={() => setProjectDrawerOpen((open) => !open)} className="h-7 rounded border border-[var(--line)] px-2 font-semibold">History</button>
        </div>
      </header>

      <main className="grid min-h-0 grid-cols-1 xl:grid-cols-[minmax(320px,42fr)_180px_minmax(360px,58fr)]">
        <section className="relative min-h-[360px] border-b border-[var(--line)] xl:min-h-0 xl:border-b-0 xl:border-r" aria-label="Compiled preview">
          {outputFreshness === "stale" ? <div role="status" className="absolute inset-x-3 top-3 z-[2] flex items-center gap-2 rounded border border-[var(--warn)]/30 bg-[var(--panel)] px-3 py-2 text-[10px] text-[var(--warn)]"><Warning size={12} /> Preview evidence does not match the current graph fingerprint.</div> : null}
          {outputTarget === "web" ? <label className="absolute bottom-3 left-3 right-3 z-[2] flex items-center gap-2 rounded bg-[var(--panel)]/90 px-2 py-1 text-[9px] text-[var(--muted)]">Preview width<input type="range" min={45} max={100} value={previewWidth} onChange={(event) => setPreviewWidth(Number(event.target.value))} className="flex-1 accent-[var(--accent)]" /><span>{previewWidth}%</span></label> : null}
          {renderPreview()}
        </section>

        <nav ref={fileTree} role="tree" aria-label="Generated files" className="max-h-[360px] overflow-auto border-b border-[var(--line)] p-1 xl:max-h-none xl:border-b-0 xl:border-r">
          <div className="px-2 py-2 text-[9px] font-semibold uppercase tracking-[.1em] text-[var(--faint)]">Generated · read only</div>
          {files.map((file, index) => {
            const active = selectedCode?.path === file.path;
            return <button key={file.path} type="button" role="treeitem" aria-selected={active} tabIndex={active || (!selectedCode && index === 0) ? 0 : -1} onKeyDown={(event) => focusFile(event, index)} onClick={() => setOutputFilePath(file.path)} className={`flex min-h-8 w-full items-center gap-1 truncate rounded px-2 text-left font-mono text-[10px] ${active ? "bg-[var(--accent-soft)] text-[var(--accent-text)]" : "text-[var(--muted)] hover:bg-[var(--hover)]"}`}><CaretRight size={10} className="shrink-0 opacity-50" /><span className="truncate">{file.path}</span></button>;
          })}
        </nav>

        <section className="min-h-0 overflow-hidden bg-[#1d1f21] text-[#d8dee9]" aria-label="Generated source">
          <div className="flex h-9 items-center justify-between gap-2 border-b border-white/10 px-3">
            <span className="truncate font-mono text-[9px] text-white/45">{selectedCode?.path ?? "No file selected"} · source {selectedScreen}</span>
            <label className="flex h-6 items-center gap-1 rounded border border-white/10 px-1.5 text-white/45"><MagnifyingGlass size={10} /><input aria-label="Search generated code" value={codeQuery} onChange={(event) => setCodeQuery(event.target.value)} placeholder="Search" className="w-24 bg-transparent font-mono text-[9px] text-white outline-none" />{codeQuery ? <span className="font-mono text-[8px]">{matchingLines.size}</span> : null}</label>
          </div>
          <div className="code-scroll h-[calc(100%_-_36px)] overflow-auto py-3 font-mono text-[10px] leading-5">
            {selectedCode ? selectedLines.map((line, index) => <div key={index} className={`grid min-w-max grid-cols-[48px_1fr] pr-5 ${matchingLines.has(index) ? "bg-amber-300/10" : ""}`}><span className="select-none border-r border-white/8 pr-3 text-right text-white/25">{index + 1}</span><code className="whitespace-pre pl-4">{line || " "}</code></div>) : <p className="px-5 text-amber-100/70">{outputMessage}</p>}
          </div>
        </section>
      </main>

      <section className="col-span-full border-t border-[var(--line)] bg-[var(--panel)]" aria-label="Output evidence">
        <button type="button" aria-expanded={evidenceOpen} onClick={() => setEvidenceOpen((open) => !open)} className="flex h-9 w-full items-center justify-between px-3 text-[10px] font-semibold text-[var(--muted)] hover:bg-[var(--hover)]"><span>Evidence and diagnostics · {output?.diagnostics.length ?? 0} compiler findings</span>{evidenceOpen ? <CaretDown size={12} /> : <CaretRight size={12} />}</button>
        {evidenceOpen ? <div className="grid min-h-[180px] grid-cols-[140px_minmax(0,1fr)] border-t border-[var(--line)]"><div role="tablist" aria-label="Evidence category" className="border-r border-[var(--line)] p-1">{(["build", "accessibility", "layout", "screenshot", "logs"] as const).map((tab) => <button key={tab} type="button" role="tab" aria-selected={evidenceTab === tab} onClick={() => setEvidenceTab(tab)} className={`block min-h-8 w-full rounded px-2 text-left text-[10px] capitalize ${evidenceTab === tab ? "bg-[var(--accent-soft)] text-[var(--accent-text)]" : "text-[var(--muted)] hover:bg-[var(--hover)]"}`}>{tab}</button>)}</div><div role="tabpanel" className="p-4 text-[10px] leading-relaxed text-[var(--muted)]">{evidenceContent()}{output?.diagnostics.length ? <div className="mt-3 border-t border-[var(--line)] pt-3">{output.diagnostics.map((diagnostic) => <p key={`${diagnostic.path}:${diagnostic.message}`}><strong>{diagnostic.path}</strong> · {diagnostic.message}</p>)}</div> : null}</div></div> : null}
      </section>
      {projectDrawerOpen ? <><button type="button" aria-label="Close project history" onClick={() => setProjectDrawerOpen(false)} className="absolute inset-0 z-[4] bg-[var(--backdrop)]/40" /><aside className="absolute inset-y-0 right-0 z-[5] w-[min(390px,92vw)] overflow-auto border-l border-[var(--line)] bg-[var(--panel)] p-3 shadow-[-20px_0_50px_-32px_var(--shadow-strong)]" aria-label="Project history drawer"><div className="mb-2 flex items-center justify-between"><strong className="text-[11px] text-[var(--ink)]">Project history</strong><button type="button" aria-label="Close history drawer" onClick={() => setProjectDrawerOpen(false)} className="rounded px-2 py-1 text-[10px] text-[var(--muted)] hover:bg-[var(--hover)]">Close</button></div><HistoryPanel enabled={localPreviews.enabled} onProjectChanged={onLocalProjectChanged} /></aside></> : null}
    </div>
  );
}
