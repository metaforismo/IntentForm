"use client";

import { CheckCircle, Warning, XCircle } from "@phosphor-icons/react";
import { useState } from "react";
import {
  ACCESSIBILITY_PROFILES,
  ACCESSIBILITY_RULESET,
  type AccessibilityProfile,
  type VerificationFinding,
  type VerificationResult,
} from "@intentform/verifier";
import type { SemanticInterfaceGraph } from "@intentform/semantic-schema";
import type { ScenarioId } from "../studio";

interface VerifyStageProps {
  graph: SemanticInterfaceGraph;
  verification: VerificationResult;
  scenario: { label: string; viewport: { width: number; height: number } };
  scenarioId: ScenarioId;
  setScenarioId: (id: ScenarioId) => void;
  scenarios: Record<string, { label: string; viewport: { width: number; height: number } }>;
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

function evaluateRules(graph: SemanticInterfaceGraph, verification: VerificationResult): EvaluatedRule[] {
  const { findings } = verification;
  const findingIds = new Set(findings.map((finding) => finding.id));
  const hasFinding = (id: string) => findingIds.has(id) || findingIds.has(`${verification.scenario.target}.${id}`);
  const rules: EvaluatedRule[] = [{
    id: "build.evidence",
    name: `Current ${verification.scenario.target} output has build evidence`,
    target: verification.scenario.buildStatus === "not-run" ? "Not run" : verification.scenario.buildStatus,
    status: verification.scenario.buildStatus === "passed"
      ? "passed"
      : verification.scenario.buildStatus === "failed" ? "failed" : "warning",
  }];

  for (const screen of graph.screens) {
    const reachabilityFailed = hasFinding(`${screen.id}.primary.compact-reachability`)
      || hasFinding(`${screen.id}.primary.missing`);
    rules.push({
      id: `${screen.id}.primary-reachable`,
      name: "Primary action reachable (compact)",
      target: screen.title,
      status: reachabilityFailed ? "failed" : "passed",
    });

    const failureStateMissing = hasFinding(`${screen.id}.failure-state.missing`);
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
    status: hasFinding("tokens.contrast.primary-action") ? "failed" : "passed",
  });
  const accessibilityFindings = findings.filter((finding) => finding.rule?.standard === ACCESSIBILITY_RULESET.standard);
  rules.push({
    id: "accessibility.profile-matrix",
    name: `${ACCESSIBILITY_RULESET.standard} profile matrix`,
    target: `${ACCESSIBILITY_PROFILES.length} profiles · rules ${ACCESSIBILITY_RULESET.version}`,
    status: accessibilityFindings.some((finding) => finding.severity === "error" && finding.status !== "suppressed")
      ? "failed"
      : accessibilityFindings.length > 0 ? "warning" : "passed",
  });
  rules.push({
    id: "tokens.body-contrast",
    name: "Body text contrast ≥ 4.5:1",
    target: "Design tokens",
    status: hasFinding("tokens.contrast.body-text") ? "failed" : "passed",
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
  const [accessibilityProfileId, setAccessibilityProfileId] = useState<AccessibilityProfile["id"]>("baseline");
  const [showAllRules, setShowAllRules] = useState(false);
  const accessibilityProfile = ACCESSIBILITY_PROFILES.find((profile) => profile.id === accessibilityProfileId)!;
  const rules = evaluateRules(graph, verification);
  const summaryRuleIds = new Set([
    "build.evidence",
    "tokens.primary-contrast",
    "tokens.body-contrast",
    "accessibility.profile-matrix",
  ]);
  const priorityRules = rules.filter((rule) => rule.status !== "passed" || summaryRuleIds.has(rule.id));
  const priorityRuleIds = new Set(priorityRules.map((rule) => rule.id));
  const visibleRules = showAllRules
    ? rules
    : [...priorityRules, ...rules.filter((rule) => !priorityRuleIds.has(rule.id))].slice(0, Math.max(12, priorityRules.length));
  const hiddenRuleCount = rules.length - visibleRules.length;
  const hasFindings = verification.findings.length > 0;
  const hasErrorFindings = verification.findings.some((finding) => finding.severity === "error" && finding.status !== "suppressed");
  const evidencePending = verification.scenario.buildStatus === "not-run";
  const verdictLabel = verification.passed
    ? "Passed"
    : evidencePending && !hasErrorFindings ? "Build evidence pending" : `${verification.findings.length} findings`;
  const verdictTone = verification.passed
    ? "bg-[var(--accent-soft)] text-[var(--accent-dark)]"
    : evidencePending && !hasErrorFindings
      ? "bg-[var(--warn-soft)] text-[var(--warn)]"
      : "bg-[var(--danger-soft)] text-[var(--danger)]";

  return (
    <div className="mx-auto grid max-w-[1200px] gap-6 2xl:grid-cols-[minmax(0,1fr)_360px]">
      <div>
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--line)] pb-5">
          <div><span className="font-mono text-[10px] text-[var(--accent)]">BUILD VERIFICATION</span><h2 className="mt-2 text-3xl font-semibold tracking-[-.05em]">Evidence before claims.</h2></div>
          <span className={`rounded-full px-3 py-1.5 text-[10px] font-semibold ${verdictTone}`}>{verdictLabel}</span>
        </div>

        <div className="mt-6">
          <span className="font-mono text-[10px] text-[var(--accent)]">RULES EVALUATED</span>
          <div className="mt-2 divide-y divide-[var(--line)] rounded-2xl border border-[var(--line)] bg-[var(--surface)]">
            {visibleRules.map((rule) => (
              <div key={rule.id} className="flex items-center gap-3 px-4 py-2.5">
                <RuleStatusIcon status={rule.status} />
                <span className="flex-1 text-xs font-medium text-[var(--t-strong)]">{rule.name}</span>
                <span className="text-[11px] text-[var(--muted)]">{rule.target}</span>
              </div>
            ))}
            {hiddenRuleCount > 0 ? (
              <button type="button" onClick={() => setShowAllRules(true)} className="min-h-11 w-full px-4 py-2.5 text-left text-[11px] font-semibold text-[var(--accent-dark)] hover:bg-[var(--hover)]">
                Show {hiddenRuleCount} more passing rules
              </button>
            ) : showAllRules && rules.length > 12 ? (
              <button type="button" onClick={() => setShowAllRules(false)} className="min-h-11 w-full px-4 py-2.5 text-left text-[11px] font-semibold text-[var(--accent-dark)] hover:bg-[var(--hover)]">
                Collapse passing rules
              </button>
            ) : null}
          </div>
        </div>

        <section className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4" aria-labelledby="accessibility-matrix-heading">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <span className="font-mono text-[9px] text-[var(--accent)]">ACCESSIBILITY MATRIX</span>
              <h3 id="accessibility-matrix-heading" className="mt-1 text-sm font-semibold text-[var(--t-strong)]">{ACCESSIBILITY_RULESET.standard} · rules {ACCESSIBILITY_RULESET.version}</h3>
            </div>
            <span className="font-mono text-[9px] text-[var(--muted)]">No authored copy in evidence</span>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2" role="group" aria-label="Accessibility audit profile">
            {ACCESSIBILITY_PROFILES.map((profile) => {
              const selected = profile.id === accessibilityProfileId;
              const count = verification.findings.filter((finding) => finding.rule?.profileId === profile.id && finding.status !== "suppressed").length;
              return (
                <button
                  key={profile.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setAccessibilityProfileId(profile.id)}
                  className={`min-h-11 rounded-xl border px-3 py-2 text-left ${selected ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--line)] bg-[var(--field)] hover:border-[var(--faint)]"}`}
                >
                  <span className="flex items-center justify-between gap-3 text-[11px] font-semibold capitalize text-[var(--t-strong)]"><span>{profile.id.replace("-", " ")}</span><span className="font-mono text-[9px] text-[var(--muted)]">{count === 0 ? "pass" : `${count} finding${count === 1 ? "" : "s"}`}</span></span>
                  <span className="mt-1 block font-mono text-[9px] text-[var(--muted)]">{profile.locale} · {profile.direction.toUpperCase()} · {Math.round(profile.textScale * 100)}%</span>
                </button>
              );
            })}
          </div>
          <div className="mt-3 rounded-xl bg-[var(--chip)] p-3 text-[11px] leading-relaxed text-[var(--muted)]" lang={accessibilityProfile.locale} dir={accessibilityProfile.direction}>
            Active inspection: <strong className="text-[var(--t-strong)]">{accessibilityProfile.locale}</strong>, {accessibilityProfile.direction.toUpperCase()} reading direction, {Math.round(accessibilityProfile.textExpansion * 100)}% text expansion, {Math.round(accessibilityProfile.textScale * 100)}% text scale, {accessibilityProfile.contrast} contrast{accessibilityProfile.reducedMotion ? ", reduced motion" : ""}.
          </div>
        </section>

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
                    <p className="mt-1 font-mono text-[10px] text-[var(--muted)]">{finding.id} · layer: {finding.responsibleLayer}{finding.rule ? ` · ${finding.rule.standard} ${finding.rule.version}` : ""}</p>
                    {finding.status === "suppressed" ? <p className="mt-2 rounded-lg bg-[var(--warn-soft)] px-3 py-2 text-[11px] text-[var(--warn)]">Explicit suppression: {finding.suppressionReason}</p> : null}
                    <dl className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-4 gap-y-1.5 rounded-xl border border-[var(--line)] bg-[var(--chip)] p-3">
                      {finding.evidence.flatMap((evidence) => [
                        <dt key={`${evidence.label}-label`} className="text-[11px] text-[var(--muted)]">{evidence.label}</dt>,
                        <dd key={`${evidence.label}-value`} className="break-all text-right font-mono text-[11px] text-[var(--t-strong)]">{String(evidence.value)}</dd>,
                      ])}
                    </dl>
                  </div>
                  {finding.severity === "error" && !finding.rule ? <button type="button" onClick={() => repairFinding(finding)} disabled={isPending} className="min-h-11 self-start rounded-xl bg-[var(--accent-deep)] px-4 py-2.5 text-[10px] font-semibold text-white active:translate-y-px disabled:opacity-60">Plan repair</button> : null}
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
        <div className="mt-3 grid grid-cols-3 rounded-lg border border-[var(--line)] bg-[var(--field)] p-0.5" role="group" aria-label="Verification scenario">
          {(Object.entries(scenarios) as Array<[ScenarioId, typeof scenario]>).map(([id, item]) => (
            <button key={id} type="button" aria-pressed={scenarioId === id} onClick={() => setScenarioId(id)} className={`min-h-8 min-w-0 break-words rounded-md px-1.5 text-[10px] font-medium leading-tight ${scenarioId === id ? "bg-[var(--accent-soft)] text-[var(--accent-dark)]" : "text-[var(--muted)] hover:text-[var(--t-strong)]"}`}>
              {item.label}
            </button>
          ))}
        </div>
        <dl className="mt-6 grid grid-cols-2 gap-y-5">
          <div><dt className="text-[11px] text-[var(--muted)]">Viewport</dt><dd className="mt-1 font-mono text-[12px] text-[var(--t-strong)]">{scenario.viewport.width} × {scenario.viewport.height}</dd></div>
          <div><dt className="text-[11px] text-[var(--muted)]">Target</dt><dd className="mt-1 font-mono text-[12px] capitalize text-[var(--t-strong)]">{verification.scenario.target}</dd></div>
          <div>
            <dt className="text-[11px] text-[var(--muted)]">Build</dt>
            <dd className={`mt-1 text-[12px] ${verification.scenario.buildStatus === "passed" ? "text-[var(--accent)]" : verification.scenario.buildStatus === "failed" ? "text-[var(--danger)]" : "text-[var(--warn)]"}`}>
              {verification.scenario.buildStatus === "not-run" ? "Not run for this graph" : verification.scenario.buildStatus === "passed" ? "Passed" : "Failed"}
            </dd>
          </div>
          <div><dt className="text-[11px] text-[var(--muted)]">Rule set</dt><dd className="mt-1 font-mono text-[12px] text-[var(--t-strong)]">intentform/0.1 · a11y/{ACCESSIBILITY_RULESET.version}</dd></div>
        </dl>
        <p className="mt-7 border-t border-[var(--line)] pt-5 text-xs leading-relaxed text-[var(--muted)]">Generation is not a build. Verification passes only after current build evidence exists and the same scenario rules run without blocking findings.</p>
      </div>
    </div>
  );
}
