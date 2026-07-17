"use client";

import {
  ArrowRight,
  ArrowSquareOut,
  Check,
  CircleNotch,
  FlagCheckered,
  ShieldCheck,
  Warning,
  X,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import {
  judgeSteps,
  totalJudgeDurationSeconds,
  type JudgeSession,
  type JudgeStepId,
} from "../lib/judge-mode";

interface ReadinessResponse {
  checkedAt: string;
  repository: { reachable: boolean; status: number | null; detail: string };
  publicDemo: { reachable: boolean; status: number | null; detail: string; url: string | null };
  artifacts: {
    readme: boolean;
    license: boolean;
    demoVideo: { configured: boolean; url: string | null };
    devpost: { configured: boolean; url: string | null };
  };
}

interface JudgeModePanelProps {
  session: JudgeSession;
  onSelectStep: (step: JudgeStepId) => void;
  onAdvance: () => void;
  onReset: () => void;
  onExit: () => void;
}

function ReadinessRow({ label, ready, detail }: { label: string; ready: boolean; detail: string }) {
  return (
    <li className="grid grid-cols-[16px_minmax(0,1fr)] gap-2 py-1.5 text-[10.5px] leading-[15px]">
      {ready
        ? <Check size={13} weight="bold" className="mt-px text-[var(--success)]" aria-label="Ready" />
        : <Warning size={13} weight="fill" className="mt-px text-[var(--warn)]" aria-label="Needs attention" />}
      <span><strong className="font-medium text-[var(--ink)]">{label}</strong><span className="block text-[var(--faint)]">{detail}</span></span>
    </li>
  );
}

export function JudgeModePanel({ session, onSelectStep, onAdvance, onReset, onExit }: JudgeModePanelProps) {
  const [readiness, setReadiness] = useState<ReadinessResponse | null>(null);
  const [readinessOpen, setReadinessOpen] = useState(false);
  const [readinessError, setReadinessError] = useState(false);
  const activeIndex = judgeSteps.findIndex((step) => step.id === session.activeStep);
  const active = judgeSteps[activeIndex] ?? judgeSteps[0]!;
  const finished = session.completed.length === judgeSteps.length;

  const refreshReadiness = async () => {
    setReadinessError(false);
    try {
      const response = await fetch("/api/readiness", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setReadiness(await response.json() as ReadinessResponse);
    } catch {
      setReadinessError(true);
    }
  };

  useEffect(() => {
    if (!readinessOpen || readiness || readinessError) return;
    void refreshReadiness();
  }, [readiness, readinessError, readinessOpen]);

  return (
    <aside data-testid="judge-mode-panel" aria-label="Judge Mode walkthrough" className="fixed bottom-3 right-3 z-30 flex max-h-[calc(100dvh-24px)] w-[min(344px,calc(100vw-24px))] flex-col overflow-hidden rounded-[9px] border border-[var(--if-border-strong)] bg-[var(--if-panel)] shadow-[var(--if-shadow-dialog)]">
      <header className="flex items-start gap-2.5 border-b border-[var(--if-border-subtle)] px-3 py-2.5">
        <span className="grid size-7 shrink-0 place-items-center rounded-[6px] bg-[var(--if-blue-soft)] text-[var(--if-blue)]"><FlagCheckered size={14} weight="fill" /></span>
        <div className="min-w-0 flex-1"><h2 className="text-[12px] font-semibold leading-4">Judge Mode</h2><p className="mt-0.5 text-[9.5px] leading-[13px] text-[var(--faint)]">Deterministic replay · no account or API key · {Math.ceil(totalJudgeDurationSeconds() / 60)} min</p></div>
        <button type="button" onClick={onExit} aria-label="Exit Judge Mode" className="grid size-7 shrink-0 place-items-center rounded-[5px] text-[var(--muted)] hover:bg-[var(--hover)]"><X size={13} /></button>
      </header>

      <div className="min-h-0 overflow-auto">
        <ol className="grid grid-cols-4 border-b border-[var(--if-border-subtle)]" aria-label="Walkthrough steps">
          {judgeSteps.map((step, index) => {
            const selected = step.id === session.activeStep;
            const complete = session.completed.includes(step.id);
            return (
              <li key={step.id}>
                <button type="button" aria-current={selected ? "step" : undefined} aria-label={`${index + 1}. ${step.title}${complete ? ", complete" : ""}`} onClick={() => onSelectStep(step.id)} className={`relative grid h-10 w-full place-items-center border-r border-[var(--if-border-subtle)] text-[10px] last:border-r-0 ${selected ? "bg-[var(--if-blue-soft)] text-[var(--if-blue-text)]" : "text-[var(--faint)] hover:bg-[var(--hover)]"}`}>
                  {complete ? <Check size={13} weight="bold" /> : index + 1}
                  {selected ? <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-[var(--if-blue)]" /> : null}
                </button>
              </li>
            );
          })}
        </ol>

        <section className="p-3" aria-labelledby="judge-step-title">
          <div className="flex items-center justify-between gap-3"><span className="font-mono text-[8.5px] uppercase tracking-[.12em] text-[var(--if-blue-text)]">Step {activeIndex + 1} of {judgeSteps.length} · {active.durationSeconds}s</span><span className="text-[9px] text-[var(--faint)]">{session.completed.length}/{judgeSteps.length} complete</span></div>
          <h3 id="judge-step-title" className="mt-2 text-[13px] font-semibold">{active.title}</h3>
          <p className="mt-1 text-[10.5px] leading-[16px] text-[var(--muted)]">{active.summary}</p>
          <div className="mt-2.5 rounded-[6px] border border-[var(--if-border-subtle)] bg-[var(--if-panel-alt)] px-2.5 py-2 text-[9.5px] leading-[14px] text-[var(--faint)]"><strong className="text-[var(--muted)]">What this proves</strong><span className="mt-0.5 block">{active.proof}</span></div>
        </section>

        <section className="border-t border-[var(--if-border-subtle)]">
          <button type="button" aria-expanded={readinessOpen} onClick={() => setReadinessOpen((open) => !open)} className="flex h-9 w-full items-center gap-2 px-3 text-left text-[10.5px] font-medium hover:bg-[var(--hover)]"><ShieldCheck size={13} className="text-[var(--if-blue)]" /><span className="min-w-0 flex-1">Submission readiness</span>{readiness ? <span className="font-mono text-[8.5px] text-[var(--faint)]">checked</span> : null}<ArrowRight size={11} className={readinessOpen ? "rotate-90" : ""} /></button>
          {readinessOpen ? (
            <div className="border-t border-[var(--if-border-subtle)] px-3 py-2">
              {!readiness && !readinessError ? <div role="status" className="flex items-center gap-2 py-2 text-[10px] text-[var(--faint)]"><CircleNotch size={13} className="animate-spin" /> Checking public evidence…</div> : null}
              {readinessError ? <div role="alert" className="flex items-start gap-2 py-2 text-[10px] text-[var(--warn)]"><Warning size={13} weight="fill" /><span className="flex-1">Readiness check unavailable. No claim has been inferred.</span><button type="button" onClick={() => void refreshReadiness()} className="underline">Retry</button></div> : null}
              {readiness ? <ul>
                <ReadinessRow label="Public repository" ready={readiness.repository.reachable} detail={readiness.repository.detail} />
                <ReadinessRow label="Public demo" ready={readiness.publicDemo.reachable} detail={readiness.publicDemo.detail} />
                <ReadinessRow label="README" ready={readiness.artifacts.readme} detail="Tracked project overview is present." />
                <ReadinessRow label="License" ready={readiness.artifacts.license} detail="Apache-2.0 is declared and tracked." />
                <ReadinessRow label="Demo video" ready={readiness.artifacts.demoVideo.configured} detail={readiness.artifacts.demoVideo.configured ? "Public URL configured." : "Placeholder only; add after recording."} />
                <ReadinessRow label="Devpost session" ready={readiness.artifacts.devpost.configured} detail={readiness.artifacts.devpost.configured ? "Public URL configured." : "Placeholder only; no external write performed."} />
              </ul> : null}
              <p className="mt-1 border-t border-[var(--if-border-subtle)] pt-2 text-[8.5px] leading-[13px] text-[var(--faint)]">Checks report observed reachability and configuration only. They never submit, edit, or authenticate to Devpost.</p>
            </div>
          ) : null}
        </section>
      </div>

      <footer className="flex items-center gap-2 border-t border-[var(--if-border-subtle)] p-2.5">
        <button type="button" onClick={onReset} className="h-7 rounded-[5px] px-2.5 text-[10px] font-medium text-[var(--muted)] hover:bg-[var(--hover)]">Reset</button>
        <a href="https://github.com/metaforismo/IntentForm" target="_blank" rel="noreferrer" className="grid size-7 place-items-center rounded-[5px] text-[var(--muted)] hover:bg-[var(--hover)]" aria-label="Open public repository"><ArrowSquareOut size={12} /></a>
        <button type="button" onClick={onAdvance} className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-[5px] bg-[var(--if-blue-action)] px-2.5 text-[10px] font-medium text-white hover:bg-[var(--if-blue-action-hover)]">{finished ? "Start again" : activeIndex === judgeSteps.length - 1 ? "Complete" : "Next"}<ArrowRight size={11} /></button>
      </footer>
      <span className="sr-only">Judge deep links preserve the active walkthrough step.</span>
    </aside>
  );
}
