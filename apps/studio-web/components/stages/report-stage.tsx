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
  reactMessage: string | null;
  swiftMessage: string | null;
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
  reactMessage,
  swiftMessage,
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
  const availableOutputCount = Number(Boolean(reactOutput)) + Number(Boolean(swiftOutput));

  return (
    <div className="mx-auto grid max-w-[1200px] gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(330px,.8fr)]">
      <div>
        <span className="font-mono text-[10px] text-[var(--accent)]">PROOF REPORT</span>
        <h2 className="mt-3 max-w-[700px] text-3xl font-semibold tracking-[-.05em] md:text-4xl">
          {availableOutputCount === 0
            ? "Graph valid. No target output is currently available."
            : verification.passed
            ? changes.length === 0
              ? "The current generated output is built and verified."
              : "The repaired output is built and verified."
            : changes.length === 0
              ? "Source generated. Build evidence is still pending."
              : "The repair changed the graph. Available output was regenerated; verification is still pending."}
        </h2>
        <div className="mt-8">
          {steps.map((item, index) => {
            const Icon = item.icon;
            const isLast = index === steps.length - 1;
            const isIncomplete = item.complete === false;
            return (
              <div key={item.label} className="relative grid grid-cols-[26px_1fr] gap-4 pb-7 last:pb-0">
                {!isLast && (
                  <span className="absolute left-[12px] top-[26px] bottom-0 w-[2px] bg-[var(--line)]" aria-hidden />
                )}
                <span className="relative z-10 grid h-[26px] w-[26px] place-items-center rounded-full border border-[var(--line)] bg-[var(--surface-strong)] text-[var(--accent)]">
                  <Icon size={14} weight="bold" />
                </span>
                <div className="flex min-w-0 items-start justify-between gap-3 pt-0.5">
                  <div className="min-w-0">
                    <strong className="block text-[13px] font-medium text-[var(--ink)]">{item.label}</strong>
                    <span className="mt-1 block text-[11px] text-[var(--muted)]">{item.detail}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {item.chip ? (
                      <span className="rounded-md border border-[var(--line)] bg-[var(--chip)] px-2 py-1 font-mono text-[10px] text-[var(--muted)]">
                        {item.chip}
                      </span>
                    ) : null}
                    <CheckCircle
                      size={18}
                      weight="fill"
                      className={isIncomplete ? "text-[var(--faint)]" : "text-[var(--accent)]"}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          onClick={exportGraph}
          className="mt-2 inline-flex items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--field)] px-4 py-2.5 text-xs font-semibold text-[var(--accent-dark)] hover:border-[var(--accent)] hover:bg-[var(--hover)]"
        >
          <DownloadSimple size={14} /> Export canonical graph
        </button>
      </div>
      <div className="rounded-[24px] bg-[var(--accent-deep)] p-6 text-white shadow-[0_24px_50px_-34px_rgba(18,59,49,.85)]">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] text-emerald-100/60">SEMANTIC DIFF</span>
          <GitDiff size={18} />
        </div>
        {changes.length > 0 ? (
          <div className="mt-5 grid max-h-[420px] gap-4 overflow-auto">
            {changes.map((change) => (
              <div key={change.path} className="border-t border-white/12 pt-4">
                <strong className="font-mono text-[11px] text-emerald-100">{change.path}</strong>
                <div className="mt-2 grid gap-1 overflow-hidden rounded-lg">
                  <div className="flex items-start gap-2 bg-red-500/10 px-2 py-1.5">
                    <span className="font-mono text-[10px] text-red-200/70">−</span>
                    <span className="font-mono text-[10px] leading-relaxed text-red-100/80">{JSON.stringify(change.before)}</span>
                  </div>
                  <div className="flex items-start gap-2 bg-emerald-500/10 px-2 py-1.5">
                    <span className="font-mono text-[10px] text-emerald-200">+</span>
                    <span className="font-mono text-[10px] leading-relaxed text-emerald-100">{JSON.stringify(change.after)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-10 text-center">
            <GitDiff size={28} className="mx-auto text-emerald-100/40" />
            <p className="mt-3 text-xs text-emerald-50/70">Run the controlled repair to produce an evidence-backed semantic diff.</p>
            <button type="button" onClick={onOpenVerify} className="mt-4 rounded-xl bg-white px-4 py-2 text-[10px] font-semibold text-[var(--accent-deep)]">
              Open verification
            </button>
          </div>
        )}
        <p className="mt-8 border-t border-white/12 pt-5 text-xs leading-relaxed text-emerald-50/65">
          IntentForm does not translate pixels. It preserves product intent.
        </p>
      </div>
    </div>
  );
}
