"use client";

import { CheckCircle, Warning, XCircle } from "@phosphor-icons/react";
import type { VerificationFinding, VerificationResult } from "@intentform/verifier";
import type { SemanticInterfaceGraph } from "@intentform/semantic-schema";
import type { ScenarioId } from "../studio";

interface VerifyStageProps {
  graph: SemanticInterfaceGraph;
  verification: VerificationResult;
  scenario: { label: string; viewport: { width: number; height: number } };
  scenarioId: ScenarioId;
  setScenarioId: (id: ScenarioId) => void;
  scenarios: Record<ScenarioId, { label: string; viewport: { width: number; height: number } }>;
  repairFinding: (finding: VerificationFinding) => void;
  isPending: boolean;
}

type RuleStatus = "passed" | "warning" | "failed";

interface EvaluatedRule {
  id: string;
  name: string;
  target: string;
  status: RuleStatus;
}

function findingEndsWith(findings: VerificationFinding[], suffix: string) {
  return findings.some((finding) => finding.id.endsWith(suffix));
}

function evaluateRules(graph: SemanticInterfaceGraph, findings: VerificationFinding[]): EvaluatedRule[] {
  const rules: EvaluatedRule[] = [];

  for (const screen of graph.screens) {
    const reachabilityFailed = findingEndsWith(findings, `${screen.id}.primary.compact-reachability`)
      || findingEndsWith(findings, `${screen.id}.primary.missing`);
    rules.push({
      id: `${screen.id}.primary-reachable`,
      name: "Primary action reachable (compact)",
      target: screen.title,
      status: reachabilityFailed ? "failed" : "passed",
    });

    const failureStateMissing = findingEndsWith(findings, `${screen.id}.failure-state.missing`);
    rules.push({
      id: `${screen.id}.failure-recovery`,
      name: "Failure states have recovery UI",
      target: screen.title,
      status: failureStateMissing ? "warning" : "passed",
    });
  }

  rules.push({
    id: "tokens.primary-contrast",
    name: "Primary action contrast ≥ 3:1",
    target: "Design tokens",
    status: findingEndsWith(findings, "tokens.contrast.primary-action") ? "failed" : "passed",
  });
  rules.push({
    id: "tokens.body-contrast",
    name: "Body text contrast ≥ 4.5:1",
    target: "Design tokens",
    status: findingEndsWith(findings, "tokens.contrast.body-text") ? "failed" : "passed",
  });

  return rules;
}

function RuleStatusIcon({ status }: { status: RuleStatus }) {
  if (status === "passed") return <CheckCircle size={16} weight="fill" className="shrink-0 text-[var(--accent)]" />;
  if (status === "warning") return <Warning size={16} weight="fill" className="shrink-0 text-[var(--warn)]" />;
  return <XCircle size={16} weight="fill" className="shrink-0 text-[var(--danger)]" />;
}

export function VerifyStage({
  graph,
  verification,
  scenario,
  scenarioId,
  setScenarioId,
  scenarios,
  repairFinding,
  isPending,
}: VerifyStageProps) {
  const rules = evaluateRules(graph, verification.findings);
  const hasFindings = verification.findings.length > 0;
  const hasErrorFindings = verification.findings.some((finding) => finding.severity === "error");

  return (
    <div className="mx-auto grid max-w-[1200px] gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div>
        <div className="flex items-end justify-between border-b border-[var(--line)] pb-5">
          <div><span className="font-mono text-[10px] text-[var(--accent)]">NATIVE VERIFICATION</span><h2 className="mt-2 text-3xl font-semibold tracking-[-.05em]">Evidence before claims.</h2></div>
          <span className={`rounded-full px-3 py-1.5 text-[10px] font-semibold ${verification.passed ? "bg-[var(--accent-soft)] text-[var(--accent-dark)]" : "bg-[var(--danger-soft)] text-[var(--danger)]"}`}>{verification.passed ? "Passed" : `${verification.findings.length} findings`}</span>
        </div>

        <div className="mt-6">
          <span className="font-mono text-[10px] text-[var(--accent)]">RULES EVALUATED</span>
          <div className="mt-2 divide-y divide-[var(--line)] rounded-2xl border border-[var(--line)] bg-[var(--surface)]">
            {rules.map((rule) => (
              <div key={rule.id} className="flex items-center gap-3 px-4 py-2.5">
                <RuleStatusIcon status={rule.status} />
                <span className="flex-1 text-xs font-medium text-[var(--t-strong)]">{rule.name}</span>
                <span className="text-[11px] text-[var(--muted)]">{rule.target}</span>
              </div>
            ))}
          </div>
        </div>

        {hasFindings ? (
          <div className="mt-8">
            <span className={`font-mono text-[10px] ${hasErrorFindings ? "text-[var(--danger)]" : "text-[var(--warn)]"}`}>FINDINGS · {verification.findings.length}</span>
            <div className="mt-2 divide-y divide-[var(--line)]">
              {verification.findings.map((finding) => (
                <div key={finding.id} className="grid gap-4 py-5 md:grid-cols-[22px_1fr_auto]">
                  {finding.severity === "error" ? (
                    <XCircle size={18} weight="fill" className="mt-0.5 text-[var(--danger)]" />
                  ) : (
                    <Warning size={18} weight="fill" className="mt-0.5 text-[var(--warn)]" />
                  )}
                  <div>
                    <strong className="text-[13px] font-medium text-[var(--t-strong)]">{finding.violatedIntent}</strong>
                    <p className="mt-1 font-mono text-[10px] text-[var(--muted)]">{finding.id} · layer: {finding.responsibleLayer}</p>
                    <dl className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-4 gap-y-1.5 rounded-xl border border-[var(--line)] bg-[var(--chip)] p-3">
                      {finding.evidence.flatMap((evidence) => [
                        <dt key={`${evidence.label}-label`} className="text-[11px] text-[var(--muted)]">{evidence.label}</dt>,
                        <dd key={`${evidence.label}-value`} className="text-right font-mono text-[11px] text-[var(--t-strong)]">{String(evidence.value)}</dd>,
                      ])}
                    </dl>
                  </div>
                  {finding.severity === "error" ? <button type="button" onClick={() => repairFinding(finding)} disabled={isPending} className="self-start rounded-xl bg-[var(--accent-deep)] px-4 py-2.5 text-[10px] font-semibold text-white active:translate-y-px disabled:opacity-60">Plan repair</button> : null}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="mt-8 flex items-center gap-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-6 py-8">
            <CheckCircle size={34} weight="fill" className="shrink-0 text-[var(--accent)]" />
            <div>
              <strong className="text-sm text-[var(--t-strong)]">All {rules.length} rules passed</strong>
              <p className="mt-1 text-xs text-[var(--muted)]">Every reachability, recovery and token contrast check ran clean for the {scenario.label.toLowerCase()} scenario.</p>
            </div>
          </div>
        )}
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
        <dl className="mt-6 grid grid-cols-2 gap-y-5">
          <div><dt className="text-[11px] text-[var(--muted)]">Viewport</dt><dd className="mt-1 font-mono text-[12px] text-[var(--t-strong)]">{scenario.viewport.width} × {scenario.viewport.height}</dd></div>
          <div><dt className="text-[11px] text-[var(--muted)]">Target</dt><dd className="mt-1 font-mono text-[12px] text-[var(--t-strong)]">SwiftUI</dd></div>
          <div><dt className="text-[11px] text-[var(--muted)]">Build</dt><dd className="mt-1 text-[12px] text-[var(--accent)]">Passed</dd></div>
          <div><dt className="text-[11px] text-[var(--muted)]">Rule set</dt><dd className="mt-1 font-mono text-[12px] text-[var(--t-strong)]">intentform/0.1</dd></div>
        </dl>
        <p className="mt-7 border-t border-[var(--line)] pt-5 text-xs leading-relaxed text-[var(--muted)]">Verification is scenario-dependent and independent from generation. A repair is only accepted after the same rule passes again.</p>
      </div>
    </div>
  );
}
