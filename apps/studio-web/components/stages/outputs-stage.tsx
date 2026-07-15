"use client";

import { CheckCircle, Copy } from "@phosphor-icons/react";
import { resolveTokenMode, type SemanticInterfaceGraph } from "@intentform/semantic-schema";
import { useCallback, useEffect, useRef, useState } from "react";
import type { OutputTarget } from "../studio";
import type { StudioGeneratedFileSet } from "../target-compilation";
import {
  PREVIEW_READY,
  PREVIEW_REQUEST,
  PREVIEW_STATUS,
  type ActivePreviewRequest,
  type ActivePreviewStatus,
} from "../runtime-preview-protocol";
import { PhonePreview } from "./phone-preview";
import { LocalPreviewPanel } from "../local-preview-panel";
import { AgentActivityPanel } from "../agent-activity-panel";
import { HistoryPanel } from "../history-panel";
import type { LocalPreviewsController } from "../use-local-previews";

type FileRow =
  | { kind: "header"; key: string; label: string }
  | { kind: "file"; key: string; file: StudioGeneratedFileSet["files"][number]; label: string };

function buildFileRows(files: StudioGeneratedFileSet["files"], target: OutputTarget): FileRow[] {
  const prefix = target === "react" ? "src/generated/" : target === "swiftui" ? "Generated/" : target === "expo" ? "" : "src/";
  let lastDirectory: string | null = null;
  const rows: FileRow[] = [];
  for (const file of files) {
    const stripped = file.path.startsWith(prefix) ? file.path.slice(prefix.length) : file.path;
    const slashIndex = stripped.lastIndexOf("/");
    const directory = slashIndex === -1 ? null : stripped.slice(0, slashIndex + 1);
    const name = slashIndex === -1 ? stripped : stripped.slice(slashIndex + 1);
    if (directory !== lastDirectory) {
      if (directory) rows.push({ kind: "header", key: `dir:${file.path}`, label: directory });
      lastDirectory = directory;
    }
    rows.push({ kind: "file", key: file.path, file, label: name });
  }
  return rows;
}

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
  onLocalProjectChanged,
}: OutputsStageProps) {
  const previewFrame = useRef<HTMLIFrameElement>(null);
  const [previewStatus, setPreviewStatus] = useState<"loading" | "ready" | "error">("loading");
  const [previewError, setPreviewError] = useState<string | null>(null);
  const webScreen = graph.screens.find((screen) => screen.id === selectedScreen) ?? graph.screens[0];
  const webTokens = resolveTokenMode(graph.tokens);

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
      const messageType = (event.data as { type?: unknown }).type;
      if (messageType === PREVIEW_READY) {
        sendPreview();
        return;
      }
      const message = event.data as Partial<ActivePreviewStatus>;
      if (message.type !== PREVIEW_STATUS || message.fingerprint !== reactOutput.fingerprint) return;
      if (message.status === "ready") {
        setPreviewStatus("ready");
        setPreviewError(null);
      } else if (message.status === "error") {
        setPreviewStatus("error");
        setPreviewError(typeof message.message === "string" ? message.message : "The active preview could not be rendered.");
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [reactOutput, sendPreview]);

  return (
    <div className="mx-auto grid max-w-[1400px] gap-5 xl:grid-cols-[minmax(330px,.72fr)_minmax(0,1.28fr)]">
      <div>
        {outputTarget === "react" && reactOutput ? (
          <div className="overflow-hidden rounded-[32px] border border-[var(--line)] bg-[var(--inset)] p-4">
            <div className="mb-3 flex items-center justify-between px-1 text-[10px] text-[var(--muted)]">
              <span className="font-semibold text-[var(--accent-dark)]">Active compiled preview</span>
              <span className="flex items-center gap-2 font-mono" aria-live="polite">
                <span className={`size-1.5 rounded-full ${previewStatus === "ready" ? "bg-emerald-500" : previewStatus === "error" ? "bg-red-500" : "animate-pulse bg-amber-500"}`} />
                {previewStatus === "ready" ? "Current" : previewStatus === "error" ? "Failed" : "Syncing"} · {reactOutput.fingerprint}
              </span>
            </div>
            <iframe
              ref={previewFrame}
              src="/runtime-preview"
              onLoad={sendPreview}
              title={`Generated React preview: ${selectedScreen}`}
              sandbox="allow-scripts"
              className="h-[570px] w-full rounded-[22px] border border-[var(--line)] bg-white"
            />
            {previewError ? <p role="alert" className="mt-3 px-1 text-[11px] text-[var(--danger)]">{previewError}</p> : null}
          </div>
        ) : (outputTarget === "swiftui" || outputTarget === "expo") && output ? (
          <div>
            {outputTarget === "expo" ? (
              <div className="mb-3 rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] px-4 py-3 text-[11px] leading-relaxed text-[var(--muted)]">
                <strong className="block text-[var(--accent-dark)]">Expo Adaptive semantic preview</strong>
                Native iOS and Android builds use the generated Expo Router project. The live device build boundary is reported separately from this instant canvas projection.
              </div>
            ) : null}
          <PhonePreview graph={graph} selectedScreen={selectedScreen} />
          </div>
        ) : outputTarget === "web" && output && graph.web && webScreen ? (
          <div data-testid="responsive-web-preview" className="overflow-hidden rounded-[24px] border border-[var(--line)] bg-white shadow-[0_24px_60px_-42px_var(--shadow-strong)]">
            <div className="flex h-10 items-center gap-2 border-b border-zinc-200 bg-zinc-100 px-4" aria-label="Browser preview chrome">
              <span className="size-2 rounded-full bg-red-400" /><span className="size-2 rounded-full bg-amber-400" /><span className="size-2 rounded-full bg-emerald-400" />
              <span className="ml-3 truncate rounded-md bg-white px-3 py-1 font-mono text-[9px] text-zinc-500">{webScreen.route}</span>
            </div>
            <div className="max-h-[650px] overflow-auto p-[clamp(24px,5vw,64px)] text-zinc-900" style={{ background: webTokens.colors["color.canvas"] ?? "#f3f5f1" }}>
              <span className="text-[10px] font-bold uppercase tracking-[.16em]" style={{ color: webTokens.colors["color.accent"] ?? "#397461" }}>{graph.product.name}</span>
              <h2 className="mt-3 max-w-[12ch] text-[clamp(38px,7vw,82px)] font-semibold leading-[.92] tracking-[-.065em]">{webScreen.title}</h2>
              <p className="mt-5 max-w-[60ch] text-sm leading-relaxed text-zinc-600">{webScreen.purpose}</p>
              <div className="mt-12 grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-4">
                {webScreen.nodes.map((node) => <div key={node.id} className="rounded-2xl border border-zinc-200 bg-white p-5"><span className="font-mono text-[9px] text-zinc-400">{node.kind}</span><strong className="mt-2 block text-sm">{node.intent.label ?? node.intent.purpose}</strong></div>)}
              </div>
            </div>
          </div>
        ) : (
          <div role="alert" className="rounded-[24px] border border-amber-500/30 bg-amber-500/8 p-6 text-sm leading-relaxed text-[var(--ink)]">
            <strong className="block text-[var(--accent-dark)]">Target unavailable</strong>
            <span className="mt-2 block text-[var(--muted)]">{outputMessage}</span>
          </div>
        )}
        <LocalPreviewPanel previews={localPreviews} />
        <AgentActivityPanel enabled={localPreviews.enabled} />
        <HistoryPanel enabled={localPreviews.enabled} onProjectChanged={onLocalProjectChanged} />
      </div>
      <div className="min-w-0 overflow-hidden rounded-[24px] border border-[#303a35] bg-[#1c211f] text-[#dce5df] shadow-[0_24px_50px_-34px_rgba(18,28,23,.8)]">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div className="flex gap-1 rounded-lg bg-white/5 p-1" role="group" aria-label="Output target">
            {(["react", "swiftui", "expo", "web"] as const).map((target) => <button key={target} type="button" aria-pressed={outputTarget === target} onClick={() => { setOutputTarget(target); setOutputFilePath(null); }} className={`rounded-md px-3 py-1.5 text-[10px] font-semibold capitalize ${outputTarget === target ? "bg-white/12 text-white" : "text-white/45 hover:text-white/70"}`}>{target}</button>)}
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={copyGeneratedFile} disabled={!selectedCode} className="inline-flex items-center gap-1.5 rounded-md bg-white/8 px-2.5 py-1.5 text-[10px] font-medium text-white/70 hover:bg-white/12 hover:text-white disabled:cursor-not-allowed disabled:opacity-40">
              {copied ? <CheckCircle size={12} weight="fill" className="text-emerald-300" /> : <Copy size={12} />}
              {copied ? "Copied" : "Copy file"}
            </button>
            <span className="hidden font-mono text-[9px] text-white/40 md:inline">{output ? `sha ${output.fingerprint}` : "not generated"}</span>
          </div>
        </div>
        {output && output.diagnostics.length > 0 ? (
          <div className="border-b border-amber-300/20 bg-amber-300/8 px-4 py-3" role="status" aria-live="polite">
            <strong className="text-[10px] font-semibold text-amber-100">{output.diagnostics.length} compiler fallback{output.diagnostics.length === 1 ? "" : "s"}</strong>
            <div className="mt-1 grid gap-1">
              {output.diagnostics.map((diagnostic) => (
                <span key={`${diagnostic.path}:${diagnostic.message}`} className="font-mono text-[9px] leading-relaxed text-amber-100/65">
                  {diagnostic.path}: {diagnostic.message}
                </span>
              ))}
            </div>
          </div>
        ) : null}
        <div className="grid md:grid-cols-[210px_minmax(0,1fr)]">
          <div className="hidden max-h-[590px] overflow-auto border-r border-white/10 p-2 md:block">
            {buildFileRows(output?.files ?? [], outputTarget).map((row) =>
              row.kind === "header" ? (
                <div key={row.key} className="truncate px-2 pt-2 pb-1 text-[9px] uppercase tracking-[.12em] text-white/30">
                  {row.label}
                </div>
              ) : (
                <button
                  key={row.key}
                  type="button"
                  onClick={() => setOutputFilePath(row.file.path)}
                  className={`block min-h-7 w-full truncate rounded-md px-2 py-1.5 text-left font-mono text-[11px] ${selectedCode?.path === row.file.path ? "bg-white/10 text-white" : "text-white/45 hover:bg-white/5 hover:text-white/75"}`}
                >
                  {row.label}
                </button>
              ),
            )}
          </div>
          <div className="min-w-0">
            {output ? (
              <>
                <div className="border-b border-white/10 px-4 py-2 font-mono text-[9px] text-[#8ea69b]">{selectedCode?.path}</div>
                <pre className="code-scroll max-h-[550px] overflow-auto p-5 text-[10.5px] leading-[1.7]"><code>{selectedCode?.content}</code></pre>
              </>
            ) : (
              <div role="alert" className="p-6 text-xs leading-relaxed text-amber-100/80">{outputMessage}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
