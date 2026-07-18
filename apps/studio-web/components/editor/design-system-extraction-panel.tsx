"use client";

import { X } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import type { DesignSystemAnalysis, DesignSystemExtractionReview } from "./design-system-extraction";

interface DesignSystemExtractionPanelProps {
  analysis: DesignSystemAnalysis;
  screenTitle: string;
  onCommit(review: DesignSystemExtractionReview): boolean;
  onClose(): void;
}

export function DesignSystemExtractionPanel({ analysis, screenTitle, onCommit, onClose }: DesignSystemExtractionPanelProps) {
  const [reviewOpen, setReviewOpen] = useState(false);
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set());
  const [names, setNames] = useState<Record<string, string>>(() => Object.fromEntries(analysis.tokens.map((suggestion) => [suggestion.id, suggestion.key])));
  const [componentId, setComponentId] = useState<string | null>(() => analysis.components[0]?.id ?? null);
  const [componentName, setComponentName] = useState(() => analysis.components[0]?.name ?? "");
  const selection = useMemo<DesignSystemExtractionReview>(() => ({
    screenId: analysis.screenId,
    tokens: analysis.tokens.filter((suggestion) => !excluded.has(suggestion.id)).map((suggestion) => ({ suggestionId: suggestion.id, key: names[suggestion.id] ?? suggestion.key })),
    ...(componentId ? { component: { candidateId: componentId, name: componentName.trim() || analysis.components.find((candidate) => candidate.id === componentId)?.name || "Reusable pattern" } } : {}),
  }), [analysis, componentId, componentName, excluded, names]);

  return (
    <section data-testid="design-system-extraction" className="border-b border-[var(--line)] bg-[var(--canvas)] px-3 py-3">
      <div className="flex items-start justify-between gap-2">
        <div><strong className="text-[11px] font-semibold text-[var(--ink)]">Extract from {screenTitle}</strong><p className="mt-1 text-[10px] leading-relaxed text-[var(--faint)]">Deterministic analysis only. Nothing changes until you commit the reviewed transaction.</p></div>
        <button type="button" aria-label="Close design system extraction" onClick={onClose} className="grid size-6 shrink-0 place-items-center rounded hover:bg-[var(--hover)]"><X size={11} /></button>
      </div>
      {!reviewOpen ? <>
        <div className="mt-3">
          <strong className="text-[9px] uppercase tracking-[.1em] text-[var(--faint)]">Suggested tokens · {analysis.tokens.length}</strong>
          <div className="mt-1.5 grid gap-1.5">
            {analysis.tokens.map((suggestion) => <label key={suggestion.id} className="grid grid-cols-[18px_1fr] gap-1.5 rounded-md border border-[var(--line)] bg-[var(--field)] p-2 text-[9px]">
              <input type="checkbox" aria-label={`Include ${suggestion.key}`} checked={!excluded.has(suggestion.id)} onChange={(event) => setExcluded((current) => { const next = new Set(current); if (event.target.checked) next.delete(suggestion.id); else next.add(suggestion.id); return next; })} />
              <span className="min-w-0"><input aria-label={`Token name for ${suggestion.id}`} value={names[suggestion.id] ?? suggestion.key} onChange={(event) => setNames((current) => ({ ...current, [suggestion.id]: event.target.value }))} className="min-h-7 w-full rounded border border-[var(--line)] bg-[var(--canvas)] px-1.5 font-mono text-[9px] outline-none focus:border-[var(--accent)]" /><span className="mt-1 block text-[var(--muted)]">{String(suggestion.value)} · {suggestion.occurrences} uses · {suggestion.nodeIds.join(", ")}</span>{suggestion.nearValues.length ? <span className="mt-0.5 block text-[var(--warn)]">Near duplicate: {suggestion.nearValues.join(", ")} (not merged automatically)</span> : null}</span>
            </label>)}
            {analysis.tokens.length === 0 ? <p className="rounded-md border border-dashed border-[var(--line)] p-2 text-[10px] text-[var(--faint)]">No repeated literal values; existing token bindings remain untouched.</p> : null}
          </div>
        </div>
        <div className="mt-3">
          <strong className="text-[9px] uppercase tracking-[.1em] text-[var(--faint)]">Suggested component · {analysis.components.length}</strong>
          <div className="mt-1.5 grid gap-1.5">
            <label className="flex items-center gap-2 rounded-md border border-[var(--line)] p-2 text-[9px] text-[var(--muted)]"><input type="radio" name="component-candidate" checked={componentId === null} onChange={() => setComponentId(null)} /> No component extraction</label>
            {analysis.components.map((candidate) => <label key={candidate.id} className="grid grid-cols-[18px_1fr] gap-1.5 rounded-md border border-[var(--line)] bg-[var(--field)] p-2 text-[9px]"><input type="radio" name="component-candidate" checked={componentId === candidate.id} onChange={() => { setComponentId(candidate.id); setComponentName(candidate.name); }} /><span><input aria-label={`Component name for ${candidate.id}`} disabled={componentId !== candidate.id} value={componentId === candidate.id ? componentName : candidate.name} onChange={(event) => setComponentName(event.target.value)} className="min-h-7 w-full rounded border border-[var(--line)] bg-[var(--canvas)] px-1.5 text-[9px] outline-none disabled:opacity-50" /><span className="mt-1 block text-[var(--muted)]">{candidate.occurrences} matching structures · {candidate.nodeCount} nodes each · source {candidate.sourceNodeId}</span></span></label>)}
          </div>
        </div>
        <button type="button" disabled={selection.tokens.length === 0 && !selection.component} onClick={() => setReviewOpen(true)} className="mt-3 min-h-8 w-full rounded-md bg-[var(--accent-soft)] px-2 text-[10px] font-semibold text-[var(--accent-text)] disabled:cursor-not-allowed disabled:opacity-40">Preview semantic transaction</button>
      </> : <div data-testid="design-system-extraction-review" className="mt-3">
        <div role="status" className="rounded-md bg-[var(--accent-soft)] p-2 text-[10px] font-semibold text-[var(--accent-text)]">Preview transaction · canonical graph unchanged</div>
        <div className="mt-2 max-h-56 overflow-y-auto rounded-md border border-[var(--line)] bg-[var(--field)] p-2 font-mono text-[8.5px] leading-relaxed text-[var(--muted)]">
          {selection.tokens.map((selected) => { const suggestion = analysis.tokens.find((candidate) => candidate.id === selected.suggestionId)!; return <div key={selected.suggestionId} className="mb-2"><p>+ tokens.{suggestion.group}.{selected.key} = {String(suggestion.value)}</p>{suggestion.nodeIds.map((nodeId) => <p key={nodeId}>~ screens.{analysis.screenId}.{nodeId} → {selected.key}</p>)}</div>; })}
          {selection.component ? <p>+ components.{selection.component.name} from {analysis.components.find((candidate) => candidate.id === selection.component?.candidateId)?.sourceNodeId}</p> : null}
        </div>
        <p className="mt-2 text-[9.5px] leading-relaxed text-[var(--faint)]">One atomic graph revision. Use Undo to revert the complete extraction.</p>
        <div className="mt-3 grid grid-cols-2 gap-1.5"><button type="button" onClick={() => setReviewOpen(false)} className="min-h-8 rounded-md border border-[var(--line)] text-[10px] font-semibold text-[var(--muted)]">Back</button><button type="button" onClick={() => { if (onCommit(selection)) onClose(); }} className="min-h-8 rounded-md bg-[var(--accent)] text-[10px] font-semibold text-white">Commit extraction</button></div>
      </div>}
    </section>
  );
}
