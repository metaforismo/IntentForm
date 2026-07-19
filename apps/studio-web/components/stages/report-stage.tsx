"use client";

import {
  CheckCircle,
  Code,
  DeviceMobile,
  DownloadSimple,
  GitDiff,
  ShieldCheck,
  TreeStructure,
} from "@phosphor-icons/react";
import { flattenGraphNodes, type SemanticChange, type SemanticInterfaceGraph } from "@intentform/semantic-schema";
import type { VerificationResult } from "@intentform/verifier";
import type { StudioGeneratedFileSet } from "../target-compilation";

interface ReportStageProps {
  graph: SemanticInterfaceGraph;
  reactOutput: StudioGeneratedFileSet | null;
  swiftOutput: StudioGeneratedFileSet | null;
  expoOutput: StudioGeneratedFileSet | null;
  reactMessage: string | null;
  swiftMessage: string | null;
  expoMessage: string | null;
  scenario: { label: string; viewport: { width: number; height: number } };
  verification: VerificationResult;
  changes: SemanticChange[];
  exportGraph: () => void;
  onOpenVerify: () => void;
}

export function ReportStage({
  graph,
  reactOutput,
  swiftOutput,
  expoOutput,
  reactMessage,
  swiftMessage,
  expoMessage,
  scenario,
  verification,
  changes,
  exportGraph,
  onOpenVerify,
}: ReportStageProps) {
  const blockingFindings = verification.findings.filter((finding) => finding.severity === "error");
  const buildPending = verification.scenario.buildStatus === "not-run";
  const steps = [
    {
      label: "Graph validated",
      detail: `${graph.screens.length} screens · ${flattenGraphNodes(graph).length} semantic nodes`,
      icon: TreeStructure,
      complete: true,
    },
    {
      label: reactOutput ? "React source generated" : "React source unavailable",
      detail: reactOutput
        ? reactOutput.diagnostics.length > 0
          ? `Deterministic source output with ${reactOutput.diagnostics.length} reported compiler fallback${reactOutput.diagnostics.length === 1 ? "" : "s"}`
          : "Deterministic source output, byte-stable across runs"
        : reactMessage,
      chip: reactOutput?.fingerprint ?? "NOT GENERATED",
      icon: Code,
      complete: Boolean(reactOutput),
    },
    {
      label: swiftOutput ? "SwiftUI source generated" : "SwiftUI source unavailable",
      detail: swiftOutput
        ? swiftOutput.diagnostics.length > 0
          ? `Deterministic source output with ${swiftOutput.diagnostics.length} reported compiler fallback${swiftOutput.diagnostics.length === 1 ? "" : "s"}`
          : "Deterministic source output, byte-stable across runs"
        : swiftMessage,
      chip: swiftOutput?.fingerprint ?? "NOT GENERATED",
      icon: DeviceMobile,
      complete: Boolean(swiftOutput),
    },
    {
      label: expoOutput ? "Expo source generated" : "Expo source unavailable",
      detail: expoOutput
        ? expoOutput.diagnostics.length > 0
          ? `Expo Router output with ${expoOutput.diagnostics.length} reported adapter fallback${expoOutput.diagnostics.length === 1 ? "" : "s"}`
          : "Deterministic Expo Router source for iOS and Android"
        : expoMessage,
      chip: expoOutput?.fingerprint ?? "NOT GENERATED",
      icon: DeviceMobile,
      complete: Boolean(expoOutput),
    },
    {
      label: verification.passed ? `${scenario.label} verified` : `${scenario.label} verification incomplete`,
      detail: verification.passed
        ? "Current build evidence exists and no blocking findings remain"
        : buildPending
          ? blockingFindings.length > 0
            ? `Build not run; ${blockingFindings.length} blocking findings remain`
            : "Build evidence has not run for the current graph"
          : `${verification.findings.length} findings remain`,
      chip: verification.passed
        ? "PASS"
        : buildPending && blockingFindings.length === 0 ? "NOT RUN" : `${verification.findings.length} OPEN`,
      icon: ShieldCheck,
      complete: verification.passed,
    },
  ];
  const availableOutputCount = Number(Boolean(reactOutput)) + Number(Boolean(swiftOutput)) + Number(Boolean(expoOutput));

  const statusHeading = availableOutputCount === 0
    ? "Graph valid. No target output is currently available."
    : verification.passed
    ? changes.length === 0
      ? "The current generated output is built and verified."
      : "The repaired output is built and verified."
    : changes.length === 0
      ? "Source generated. Build evidence is still pending."
      : "The repair changed the graph. Available output was regenerated; verification is still pending.";

  return (
    <div className="if-editor-surface mx-auto grid h-full max-w-[1200px] grid-rows-[42px_minmax(0,1fr)] overflow-hidden">
      <header className="flex min-w-0 items-center justify-between gap-3 border-b border-[var(--line)] px-3">
        <div className="flex min-w-0 items-baseline gap-2.5">
          <h2 className="shrink-0 text-[12px] font-semibold tracking-[-.01em]">Proof report</h2>
          <span className="truncate text-[10.5px] text-[var(--muted)]" role="status">{statusHeading}</span>
        </div>
        <button
          type="button"
          onClick={exportGraph}
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[5px] border border-[var(--line)] bg-[var(--field)] px-2.5 text-[10.5px] font-semibold text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
        >
          <DownloadSimple size={12} /> Export canonical graph
        </button>
      </header>
      <div className="grid min-h-0 gap-5 overflow-auto p-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(330px,.8fr)]">
        <div className="min-w-0">
          <h3 className="sr-only">{statusHeading}</h3>
          <div>
            {steps.map((item, index) => {
              const Icon = item.icon;
              const isLast = index === steps.length - 1;
              const isIncomplete = item.complete === false;
              return (
                <div key={item.label} className="relative grid grid-cols-[24px_1fr] gap-3 pb-5 last:pb-0">
                  {!isLast && (
                    <span className="absolute left-[11px] top-[24px] bottom-0 w-px bg-[var(--line)]" aria-hidden />
                  )}
                  <span className="relative z-10 grid h-[24px] w-[24px] place-items-center rounded-full border border-[var(--line)] bg-[var(--surface-strong)] text-[var(--accent)]">
                    <Icon size={12} weight="bold" />
                  </span>
                  <div className="flex min-w-0 items-start justify-between gap-3 pt-0.5">
                    <div className="min-w-0">
                      <strong className="block text-[11.5px] font-medium text-[var(--ink)]">{item.label}</strong>
                      <span className="mt-0.5 block text-[10.5px] text-[var(--muted)]">{item.detail}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {item.chip ? (
                        <span className="rounded-[4px] border border-[var(--line)] bg-[var(--chip)] px-1.5 py-0.5 font-mono text-[9.5px] text-[var(--muted)]">
                          {item.chip}
                        </span>
                      ) : null}
                      <CheckCircle
                        size={15}
                        weight="fill"
                        className={isIncomplete ? "text-[var(--faint)]" : "text-[var(--success)]"}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <section aria-label="Semantic diff" className="self-start rounded-[6px] border border-[var(--line)] bg-[var(--panel)]">
          <div className="flex h-8 items-center justify-between border-b border-[var(--line)] px-2.5">
            <span className="text-[10.5px] font-semibold text-[var(--muted)]">Semantic diff</span>
            <GitDiff size={13} className="text-[var(--muted)]" />
          </div>
          {changes.length > 0 ? (
            <div className="grid max-h-[420px] gap-3 overflow-auto p-2.5">
              {changes.map((change) => (
                <div key={change.path} className="min-w-0">
                  <strong className="block truncate font-mono text-[10.5px] text-[var(--ink)]">{change.path}</strong>
                  <div className="mt-1.5 grid gap-px overflow-hidden rounded-[4px] border border-[var(--line)]">
                    <div className="flex items-start gap-2 bg-[var(--danger-soft)] px-2 py-1">
                      <span className="font-mono text-[10px] text-[var(--danger)]">−</span>
                      <span className="min-w-0 break-all font-mono text-[10px] leading-relaxed text-[var(--danger)]">{JSON.stringify(change.before)}</span>
                    </div>
                    <div className="flex items-start gap-2 bg-[var(--success-soft,var(--accent-soft))] px-2 py-1">
                      <span className="font-mono text-[10px] text-[var(--success)]">+</span>
                      <span className="min-w-0 break-all font-mono text-[10px] leading-relaxed text-[var(--success)]">{JSON.stringify(change.after)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid place-items-center gap-2 px-4 py-6 text-center">
              <GitDiff size={18} className="text-[var(--faint)]" />
              <p className="text-[10.5px] text-[var(--muted)]">Run a controlled repair to produce an evidence-backed semantic diff.</p>
              <button type="button" onClick={onOpenVerify} className="mt-1 inline-flex h-7 items-center rounded-[5px] border border-[var(--line)] px-2.5 text-[10.5px] font-semibold text-[var(--accent-text)] hover:bg-[var(--hover)]">
                Open verification
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
