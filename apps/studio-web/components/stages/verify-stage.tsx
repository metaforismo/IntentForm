"use client";

import {
  ArrowSquareOut,
  CheckCircle,
  Funnel,
  MagnifyingGlass,
  Warning,
  XCircle,
  ArrowsClockwise,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import {
  ACCESSIBILITY_PROFILES,
  ACCESSIBILITY_RULESET,
  type VerificationFinding,
  type VerificationResult,
} from "@intentform/verifier";
import type { SemanticInterfaceGraph } from "@intentform/semantic-schema";
import type { BuildEvidenceState } from "@intentform/preview-daemon";
import type { ScenarioId } from "../studio";
import {
  countVerificationFindings,
  filterVerificationFindings,
  type VerificationCategory,
  type VerificationSeverity,
  type RepairPreview,
  verificationNavigationTarget,
} from "./workspace-model";

interface VerifyStageProps {
  graph: SemanticInterfaceGraph;
  verification: VerificationResult;
  scenario: { label: string; viewport: { width: number; height: number } };
  scenarioId: ScenarioId;
  setScenarioId: (id: ScenarioId) => void;
  scenarios: Record<string, { label: string; viewport: { width: number; height: number } }>;
  repairPreview: RepairPreview | null;
  previewRepair: (finding: VerificationFinding) => void;
  applyRepair: () => void;
  dismissRepair: () => void;
  rerunVerification: () => void;
  inspectFinding: (finding: VerificationFinding) => void;
  sourceFingerprint: string;
  buildEvidenceState: BuildEvidenceState;
  verificationRunId: number;
  isPending: boolean;
}

function SeverityIcon({ severity }: { severity: VerificationSeverity }) {
  if (severity === "error") return <XCircle size={15} weight="fill" className="shrink-0 text-[var(--danger)]" />;
  if (severity === "warning") return <Warning size={15} weight="fill" className="shrink-0 text-[var(--warn)]" />;
  return <CheckCircle size={15} weight="fill" className="shrink-0 text-[var(--accent)]" />;
}

export function VerifyStage({
  graph,
  verification,
  scenario,
  scenarioId,
  setScenarioId,
  scenarios,
  repairPreview,
  previewRepair,
  applyRepair,
  dismissRepair,
  rerunVerification,
  inspectFinding,
  sourceFingerprint,
  buildEvidenceState,
  verificationRunId,
  isPending,
}: VerifyStageProps) {
  const [query, setQuery] = useState("");
  const [severities, setSeverities] = useState<Set<VerificationSeverity>>(() => new Set(["error", "warning", "info"]));
  const [showSuppressed, setShowSuppressed] = useState(false);
  const [profileId, setProfileId] = useState("all");
  const [category, setCategory] = useState<"all" | VerificationCategory>("all");
  const [selectedId, setSelectedId] = useState<string | null>(verification.findings[0]?.id ?? null);
  const counts = useMemo(() => countVerificationFindings(verification.findings), [verification.findings]);
  const visible = useMemo(() => filterVerificationFindings(verification.findings, {
    profileId,
    query,
    severities,
    showSuppressed,
    category,
  }), [category, profileId, query, severities, showSuppressed, verification.findings]);
  const selected = verification.findings.find((finding) => finding.id === selectedId) ?? visible[0];
  const selectedNavigationTarget = selected
    ? verificationNavigationTarget(graph, selected, new Set(Object.keys(scenarios)), sourceFingerprint)
    : null;

  useEffect(() => {
    if (selectedId && verification.findings.some((finding) => finding.id === selectedId)) return;
    setSelectedId(verification.findings[0]?.id ?? null);
  }, [selectedId, verification.findings]);

  const toggleSeverity = (severity: VerificationSeverity) => setSeverities((current) => {
    const next = new Set(current);
    if (next.has(severity)) next.delete(severity); else next.add(severity);
    return next;
  });

  const statusLabel = verification.passed
    ? "Passed"
    : verification.scenario.buildStatus === "not-run" && counts.error === 0
      ? "Build evidence pending"
      : `${counts.error} errors · ${counts.warning} warnings`;

  return (
    <div data-testid="verify-workspace" className="if-editor-surface mx-auto grid h-full min-h-[680px] max-w-[1500px] grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
      <header className="border-b border-[var(--line)] px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0"><h2 className="text-sm font-semibold text-[var(--ink)]">Verification · {graph.product.name}</h2><p className="mt-0.5 truncate text-[10px] text-[var(--muted)]">{verification.scenario.target} · {scenario.label} · {sourceFingerprint}</p></div>
          <div className="flex items-center gap-1.5"><button type="button" onClick={rerunVerification} disabled={isPending} className="inline-flex h-7 items-center gap-1 rounded border border-[var(--line)] px-2 text-[9px] font-semibold text-[var(--muted)] hover:text-[var(--ink)] disabled:opacity-40"><ArrowsClockwise size={11} /> Re-run</button><span className={`rounded px-2 py-1 text-[10px] font-semibold ${verification.passed ? "bg-[var(--success-soft)] text-[var(--success)]" : counts.error ? "bg-[var(--danger-soft)] text-[var(--danger)]" : "bg-[var(--warn-soft)] text-[var(--warn)]"}`}>{statusLabel}</span></div>
        </div>
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5" aria-label="Verification filters">
          <Funnel size={12} className="shrink-0 text-[var(--faint)]" />
          {(["error", "warning", "info"] as const).map((severity) => <button key={severity} type="button" aria-pressed={severities.has(severity)} data-state={severities.has(severity) ? "active" : "idle"} onClick={() => toggleSeverity(severity)} className="if-editor-filter h-7 shrink-0 px-2 text-[9px] font-semibold capitalize">{severity}s · {counts[severity]}</button>)}
          <button type="button" aria-pressed={showSuppressed} data-state={showSuppressed ? "active" : "idle"} onClick={() => setShowSuppressed((value) => !value)} className="if-editor-filter h-7 shrink-0 px-2 text-[9px] font-semibold">Suppressed · {counts.suppressed}</button>
          <select aria-label="Verification device" value={scenarioId} onChange={(event) => setScenarioId(event.target.value as ScenarioId)} className="select-control h-7 min-h-0 max-w-full text-[9px] sm:max-w-48">{Object.entries(scenarios).map(([id, item]) => <option key={id} value={id}>{item.label}</option>)}</select>
          <select aria-label="Accessibility profile filter" value={profileId} onChange={(event) => setProfileId(event.target.value)} className="select-control h-7 min-h-0 max-w-full text-[9px] sm:max-w-48"><option value="all">All accessibility profiles</option>{ACCESSIBILITY_PROFILES.map((profile) => <option key={profile.id} value={profile.id}>{profile.id} · {profile.locale} · {Math.round(profile.textScale * 100)}%</option>)}</select>
          <select aria-label="Verification category filter" value={category} onChange={(event) => setCategory(event.target.value as "all" | VerificationCategory)} className="select-control h-7 min-h-0 max-w-full text-[9px] sm:max-w-48"><option value="all">All categories</option><option value="design-quality">Design quality</option><option value="accessibility">Accessibility</option><option value="build">Build evidence</option><option value="semantic">Semantic intent</option></select>
        </div>
      </header>

      <main className="grid min-h-0 grid-cols-[320px_minmax(0,1fr)]">
        <aside className="min-h-0 border-r border-[var(--line)]" aria-label="Verification issues">
          <label className="m-2 flex h-8 items-center gap-2 rounded border border-[var(--line)] bg-[var(--field)] px-2 text-[var(--faint)]"><MagnifyingGlass size={12} /><input aria-label="Search verification issues" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search issues" className="min-w-0 flex-1 bg-transparent text-[10px] text-[var(--ink)] outline-none" /></label>
          <div className="h-[calc(100%-48px)] overflow-auto border-t border-[var(--line)]">
            {visible.map((finding) => {
              const active = selected?.id === finding.id;
              return <button key={finding.id} type="button" aria-pressed={active} onClick={() => setSelectedId(finding.id)} className={`grid w-full grid-cols-[18px_minmax(0,1fr)] gap-2 border-b border-[var(--line)] px-3 py-3 text-left ${active ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--hover)]"}`}><SeverityIcon severity={finding.severity} /><span className="min-w-0"><strong className="line-clamp-2 text-[11px] font-medium leading-snug text-[var(--ink)]">{finding.violatedIntent}</strong><span className="mt-1 flex items-center gap-1 truncate font-mono text-[8px] text-[var(--faint)]"><span>{finding.designQualityCategory ?? finding.category ?? "semantic"}</span><span>·</span><span>{finding.target}</span><span>·</span><span>{scenario.label}</span><span>·</span><span>{finding.responsibleLayer}</span></span></span></button>;
            })}
            {visible.length === 0 ? <div className="p-6 text-center text-[10px] leading-relaxed text-[var(--muted)]">{verification.findings.length === 0 ? "No issues. Current rules pass when build evidence is present." : "No issues match these filters."}</div> : null}
          </div>
        </aside>

        <section className="min-h-0 overflow-auto bg-[var(--canvas)] p-5" aria-label="Selected verification evidence">
          {selected ? (
            <div className="mx-auto max-w-4xl">
              <div className="flex items-start justify-between gap-4 border-b border-[var(--line)] pb-4"><div><div className="flex items-center gap-2"><SeverityIcon severity={selected.severity} /><span className="font-mono text-[9px] uppercase text-[var(--faint)]">{selected.severity} · {selected.status}</span></div><h3 className="mt-2 max-w-3xl text-xl font-semibold leading-tight tracking-[-.025em] text-[var(--ink)]">{selected.violatedIntent}</h3></div><button type="button" onClick={() => inspectFinding(selected)} disabled={!selectedNavigationTarget} title={selectedNavigationTarget ? "Open the exact evidence target" : "This finding has no current canvas target"} className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded border border-[var(--line)] bg-[var(--panel)] px-3 text-[10px] font-semibold text-[var(--muted)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-40"><ArrowSquareOut size={11} /> Show on canvas</button></div>

              <dl className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded border border-[var(--line)] bg-[var(--line)] text-[10px] md:grid-cols-4">
                <div className="bg-[var(--panel)] p-3"><dt className="text-[var(--faint)]">Target / device</dt><dd className="mt-1 font-mono text-[var(--ink)]">{selected.target} · {selected.deviceProfile ?? scenarioId}<span className="mt-1 block text-[var(--faint)]">{scenario.viewport.width}×{scenario.viewport.height} · {selected.visualState ?? "idle"}</span></dd></div>
                <div className="bg-[var(--panel)] p-3"><dt className="text-[var(--faint)]">Responsible layer</dt><dd className="mt-1 font-mono text-[var(--ink)]">{selected.responsibleLayer}</dd></div>
                <div className="bg-[var(--panel)] p-3"><dt className="text-[var(--faint)]">Rule / category</dt><dd className="mt-1 font-mono text-[var(--ink)]">{selected.rule ? `${selected.rule.standard} ${selected.rule.version}` : "intentform/0.1"}<span className="mt-1 block text-[var(--faint)]">{selected.designQualityCategory ?? selected.category ?? "semantic"}</span></dd></div>
                <div className="bg-[var(--panel)] p-3"><dt className="text-[var(--faint)]">Evidence identity</dt><dd className="mt-1 font-mono text-[var(--ink)]">{selected.sourceFingerprint ?? sourceFingerprint}<span className="mt-1 block text-[var(--faint)]">run {verificationRunId} · build {buildEvidenceState}</span></dd></div>
              </dl>

              <section className="mt-5 border border-[var(--line)] bg-[var(--panel)]" aria-labelledby="exact-evidence-heading"><h4 id="exact-evidence-heading" className="border-b border-[var(--line)] px-3 py-2 text-[10px] font-semibold text-[var(--muted)]">Exact evidence</h4><dl className="divide-y divide-[var(--line)]">{selected.evidence.map((evidence) => <div key={`${evidence.kind}:${evidence.label}`} className="grid grid-cols-[minmax(160px,.4fr)_minmax(0,1fr)] gap-3 px-3 py-2.5"><dt className="text-[10px] text-[var(--muted)]">{evidence.label}<span className="ml-2 font-mono text-[8px] text-[var(--faint)]">{evidence.kind}</span></dt><dd className="break-all text-right font-mono text-[10px] text-[var(--ink)]">{String(evidence.value)}</dd></div>)}</dl></section>

              {selected.nodeIds?.length || selected.propertyPaths?.length ? <section className="mt-5 border border-[var(--line)] bg-[var(--panel)]" aria-labelledby="affected-layers-heading"><h4 id="affected-layers-heading" className="border-b border-[var(--line)] px-3 py-2 text-[10px] font-semibold text-[var(--muted)]">Affected layers and properties</h4><dl className="divide-y divide-[var(--line)]"><div className="grid grid-cols-[140px_minmax(0,1fr)] gap-3 px-3 py-2.5"><dt className="text-[10px] text-[var(--muted)]">Node IDs</dt><dd className="break-all text-right font-mono text-[10px] text-[var(--ink)]">{selected.nodeIds?.join(", ") ?? selected.nodeId}</dd></div><div className="grid grid-cols-[140px_minmax(0,1fr)] gap-3 px-3 py-2.5"><dt className="text-[10px] text-[var(--muted)]">Property paths</dt><dd className="break-all text-right font-mono text-[10px] text-[var(--ink)]">{selected.propertyPaths?.join(", ") ?? selected.propertyPath}</dd></div></dl></section> : null}

              {selected.category === "design-quality" ? <p className="mt-4 rounded border border-[var(--line)] bg-[var(--panel)] p-3 text-[10px] text-[var(--muted)]"><strong className="text-[var(--ink)]">Deterministic rule.</strong> This finding is based on measurable authored values. Subjective critique is never labeled as verified.</p> : null}

              {selected.suppressionReason ? <p className="mt-4 rounded border border-[var(--warn)]/30 bg-[var(--warn-soft)] p-3 text-[10px] text-[var(--warn)]">Suppression: {selected.suppressionReason}</p> : null}
              <section className="mt-5 rounded border border-[var(--line)] bg-[var(--panel)] p-4">
                <div className="flex items-center justify-between gap-4"><div><h4 className="text-[11px] font-semibold text-[var(--ink)]">Safe repair workflow</h4><p className="mt-1 text-[10px] leading-relaxed text-[var(--muted)]">{selected.suggestedRepair?.description ?? "Plan the smallest semantic change, validate it against graph invariants, and retain an evidence-backed diff."}</p></div><button type="button" onClick={() => previewRepair(selected)} disabled={isPending || selected.status === "suppressed"} className="min-h-9 shrink-0 rounded bg-[var(--accent-deep)] px-4 text-[10px] font-semibold text-white disabled:opacity-40">Preview repair</button></div>
                {repairPreview?.findingId === selected.id ? (
                  <div className="mt-4 border-t border-[var(--line)] pt-4" aria-label="Repair preview">
                    <div className="flex items-start justify-between gap-3"><div><strong className="text-[10px] text-[var(--ink)]">{repairPreview.proposal.summary}</strong><p className="mt-1 font-mono text-[8px] text-[var(--faint)]">Source {repairPreview.sourceFingerprint} · {repairPreview.proposal.patch.operations.length} operation(s) · {repairPreview.changes.length} semantic change(s)</p></div><div className="flex gap-1.5"><button type="button" onClick={dismissRepair} className="h-8 rounded border border-[var(--line)] px-3 text-[9px] font-semibold text-[var(--muted)]">Dismiss</button><button type="button" onClick={applyRepair} disabled={repairPreview.sourceFingerprint !== sourceFingerprint} className="h-8 rounded bg-[var(--accent-deep)] px-3 text-[9px] font-semibold text-white disabled:opacity-40">Apply repair</button></div></div>
                    <div className="mt-3 grid gap-px border border-[var(--line)] bg-[var(--line)] text-[9px] md:grid-cols-2"><div className="bg-[var(--panel)] p-2.5"><strong className="text-[var(--muted)]">Validated operations</strong><ul className="mt-1.5 space-y-1 font-mono text-[var(--ink)]">{repairPreview.proposal.patch.operations.map((operation, index) => <li key={`${operation.op}-${index}`} className="break-all">{index + 1}. {JSON.stringify(operation)}</li>)}</ul></div><div className="bg-[var(--panel)] p-2.5"><strong className="text-[var(--muted)]">Expected result</strong><p className="mt-1.5 text-[var(--ink)]">Graph invariants accepted. Re-run {selected.rule?.id ?? selected.id} after apply to confirm the finding is resolved.</p></div></div>
                    <dl className="mt-3 max-h-44 divide-y divide-[var(--line)] overflow-auto border border-[var(--line)]">{repairPreview.changes.map((change) => <div key={change.path} className="grid grid-cols-[minmax(120px,.4fr)_minmax(0,1fr)] gap-3 px-2.5 py-2 text-[9px]"><dt className="break-all font-mono text-[var(--muted)]">{change.path}</dt><dd className="min-w-0 text-right font-mono text-[var(--ink)]"><span className="block truncate text-[var(--danger)]">− {JSON.stringify(change.before)}</span><span className="block truncate text-[var(--success)]">+ {JSON.stringify(change.after)}</span></dd></div>)}</dl>
                  </div>
                ) : null}
              </section>
            </div>
          ) : (
            <div className="mx-auto grid h-full max-w-xl place-items-center text-center"><div><CheckCircle size={42} weight="fill" className="mx-auto text-[var(--success)]" /><h3 className="mt-3 text-lg font-semibold text-[var(--ink)]">No open verification issues</h3><p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">{verification.scenario.buildStatus === "passed" ? `The current ${verification.scenario.target} build and ${ACCESSIBILITY_RULESET.standard} rules pass for ${scenario.label}.` : "Semantic rules pass, but truthful completion still requires current build evidence."}</p></div></div>
          )}
        </section>
      </main>
    </div>
  );
}
