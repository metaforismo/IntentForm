"use client";

import { CheckCircle, Warning } from "@phosphor-icons/react";
import type { VerificationFinding, VerificationResult } from "@intentform/verifier";
import type { ScenarioId } from "../studio";

interface VerifyStageProps {
  verification: VerificationResult;
  scenario: { label: string; viewport: { width: number; height: number } };
  scenarioId: ScenarioId;
  setScenarioId: (id: ScenarioId) => void;
  scenarios: Record<ScenarioId, { label: string; viewport: { width: number; height: number } }>;
  repairFinding: (finding: VerificationFinding) => void;
  isPending: boolean;
}

export function VerifyStage({
  verification,
  scenario,
  scenarioId,
  setScenarioId,
  scenarios,
  repairFinding,
  isPending,
}: VerifyStageProps) {
  return (
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
              <div><strong className="text-sm">{finding.violatedIntent}</strong><p className="mt-1 font-mono text-[9px] text-[var(--muted)]">{finding.id} · layer: {finding.responsibleLayer}</p><div className="mt-3 flex flex-wrap gap-2">{finding.evidence.map((evidence) => <span key={evidence.label} className="rounded-lg bg-[var(--hover)] px-2 py-1 font-mono text-[9px]">{evidence.label}: {String(evidence.value)}</span>)}</div></div>
              {finding.severity === "error" ? <button type="button" onClick={() => repairFinding(finding)} disabled={isPending} className="self-start rounded-xl bg-[var(--accent-deep)] px-4 py-2.5 text-[10px] font-semibold text-white active:translate-y-px disabled:opacity-60">Plan repair</button> : null}
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-[24px] border border-[var(--line)] bg-[var(--inset)] p-5">
        <span className="font-mono text-[9px] text-[var(--accent)]">SCENARIO</span>
        <div className="mt-3 grid grid-flow-col rounded-lg border border-[var(--line)] bg-[var(--field)] p-0.5">
          {(Object.entries(scenarios) as Array<[ScenarioId, typeof scenario]>).map(([id, item]) => (
            <button key={id} type="button" aria-pressed={scenarioId === id} onClick={() => setScenarioId(id)} className={`min-h-8 rounded-md px-2 text-[10px] font-medium ${scenarioId === id ? "bg-[var(--accent-soft)] text-[var(--accent-dark)]" : "text-[var(--muted)] hover:text-[var(--t-strong)]"}`}>
              {item.label}
            </button>
          ))}
        </div>
        <dl className="mt-6 grid grid-cols-2 gap-y-5 text-xs"><div><dt className="text-[var(--muted)]">Viewport</dt><dd className="mt-1 font-mono">{scenario.viewport.width} × {scenario.viewport.height}</dd></div><div><dt className="text-[var(--muted)]">Target</dt><dd className="mt-1 font-mono">SwiftUI</dd></div><div><dt className="text-[var(--muted)]">Build</dt><dd className="mt-1 text-[var(--accent)]">Passed</dd></div><div><dt className="text-[var(--muted)]">Rule set</dt><dd className="mt-1 font-mono">intentform/0.1</dd></div></dl>
        <p className="mt-7 border-t border-[var(--line)] pt-5 text-xs leading-relaxed text-[var(--muted)]">Verification is scenario-dependent and independent from generation. A repair is only accepted after the same rule passes again.</p>
      </div>
    </div>
  );
}
