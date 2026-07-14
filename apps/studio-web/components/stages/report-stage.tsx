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
import type { compileReact } from "@intentform/compiler-react";
import type { SemanticChange, SemanticInterfaceGraph } from "@intentform/semantic-schema";
import type { VerificationResult } from "@intentform/verifier";

type GeneratedFileSet = ReturnType<typeof compileReact>;

interface ReportStageProps {
  graph: SemanticInterfaceGraph;
  reactOutput: GeneratedFileSet;
  swiftOutput: GeneratedFileSet;
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
  scenario,
  verification,
  changes,
  exportGraph,
  onOpenVerify,
}: ReportStageProps) {
  return (
    <div className="mx-auto grid max-w-[1200px] gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(330px,.8fr)]">
      <div>
        <span className="font-mono text-[10px] text-[var(--accent)]">PROOF REPORT</span>
        <h2 className="mt-3 max-w-[700px] text-3xl font-semibold tracking-[-.05em] md:text-4xl">The intent survived two compilers and one repair.</h2>
        <div className="mt-8 border-y border-[var(--line)]">
          {[{ label: "Graph validated", detail: `${graph.screens.length} screens · ${graph.screens.flatMap((screen) => screen.nodes).length} semantic nodes`, icon: TreeStructure }, { label: "React compiled", detail: `Fingerprint ${reactOutput.fingerprint}`, icon: Code }, { label: "SwiftUI compiled", detail: `Fingerprint ${swiftOutput.fingerprint}`, icon: DeviceMobile }, { label: `${scenario.label} verified`, detail: verification.passed ? "No blocking findings remain" : `${verification.findings.length} findings remain`, icon: ShieldCheck }].map((item, index) => {
            const Icon = item.icon; return <div key={item.label} className="grid grid-cols-[26px_1fr_auto] items-center gap-4 border-b border-[var(--line)] py-4 last:border-0"><Icon size={18} className="text-[var(--accent)]" /><span><strong className="block text-sm">{item.label}</strong><small className="font-mono text-[9px] text-[var(--muted)]">{item.detail}</small></span><CheckCircle size={18} weight="fill" className={index === 3 && !verification.passed ? "text-[var(--faint)]" : "text-[var(--accent)]"} /></div>;
          })}
        </div>
        <button type="button" onClick={exportGraph} className="mt-6 inline-flex items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--field)] px-4 py-2.5 text-xs font-semibold text-[var(--accent-dark)] hover:border-[var(--accent)]">
          <DownloadSimple size={14} /> Export canonical graph
        </button>
      </div>
      <div className="rounded-[24px] bg-[var(--accent-deep)] p-6 text-white shadow-[0_24px_50px_-34px_rgba(18,59,49,.85)]">
        <div className="flex items-center justify-between"><span className="font-mono text-[9px] text-emerald-100/60">SEMANTIC DIFF</span><GitDiff size={18} /></div>
        {changes.length > 0 ? <div className="mt-5 grid max-h-[420px] gap-4 overflow-auto">{changes.map((change) => <div key={change.path} className="border-t border-white/12 pt-4"><strong className="font-mono text-[10px] text-emerald-100">{change.path}</strong><div className="mt-2 grid gap-1 font-mono text-[9px]"><span className="text-red-200/70">− {JSON.stringify(change.before)}</span><span className="text-emerald-200">+ {JSON.stringify(change.after)}</span></div></div>)}</div> : <div className="mt-10 text-center"><GitDiff size={28} className="mx-auto text-emerald-100/40" /><p className="mt-3 text-xs text-emerald-50/70">Run the controlled repair to produce an evidence-backed semantic diff.</p><button type="button" onClick={onOpenVerify} className="mt-4 rounded-xl bg-white px-4 py-2 text-[10px] font-semibold text-[var(--accent-deep)]">Open verification</button></div>}
        <p className="mt-8 border-t border-white/12 pt-5 text-xs leading-relaxed text-emerald-50/65">IntentForm does not translate pixels. It preserves product intent.</p>
      </div>
    </div>
  );
}
