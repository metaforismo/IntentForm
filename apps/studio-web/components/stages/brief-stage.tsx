"use client";

import { ArrowRight } from "@phosphor-icons/react";
import { demoBrief } from "@intentform/proof-report/demo";
import type { SemanticInterfaceGraph } from "@intentform/semantic-schema";
import { PhonePreview } from "./phone-preview";

interface BriefStageProps {
  brief: string;
  setBrief: (value: string) => void;
  editInstruction: string;
  setEditInstruction: (value: string) => void;
  briefOperation: "create" | "edit";
  setBriefOperation: (value: "create" | "edit") => void;
  compileBrief: (operation: "create" | "edit") => void;
  isPending: boolean;
  graph: SemanticInterfaceGraph;
  selectedScreen: string;
}

export function BriefStage({
  brief,
  setBrief,
  editInstruction,
  setEditInstruction,
  briefOperation,
  setBriefOperation,
  compileBrief,
  isPending,
  graph,
  selectedScreen,
}: BriefStageProps) {
  return (
    <div className="if-editor-surface mx-auto grid h-full max-w-[1200px] grid-rows-[42px_minmax(0,1fr)] overflow-hidden">
      <header className="flex items-center justify-between border-b border-[var(--line)] px-3">
        <div className="flex items-baseline gap-2.5">
          <h2 className="text-[12px] font-semibold tracking-[-.01em]">Product brief</h2>
          <span className="text-[10.5px] text-[var(--muted)]">GPT-5.6 interprets intent; deterministic compilers generate all output.</span>
        </div>
        <div className="inline-flex rounded-[5px] bg-[var(--hover)] p-0.5" role="group" aria-label="Intent operation">
          {(["create", "edit"] as const).map((operation) => (
            <button key={operation} type="button" aria-pressed={briefOperation === operation} disabled={isPending} onClick={() => setBriefOperation(operation)} className={`h-6 rounded-[4px] px-2.5 text-[10.5px] font-semibold transition-colors disabled:opacity-50 ${briefOperation === operation ? "bg-[var(--seg-active)] text-[var(--ink)] shadow-[0_1px_4px_-2px_var(--shadow-strong)]" : "text-[var(--muted)] hover:text-[var(--ink)]"}`}>{operation === "create" ? "New graph" : "Semantic edit"}</button>
          ))}
        </div>
      </header>
      <div className="grid min-h-0 gap-5 overflow-auto p-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(340px,.95fr)]">
        <div className="min-w-0">
          <label className="grid gap-1.5 text-[11px] font-semibold text-[var(--muted)]">
            {briefOperation === "create" ? "Product brief" : "Edit instruction"}
            <textarea
              value={briefOperation === "create" ? brief : editInstruction}
              disabled={isPending}
              onChange={(event) => briefOperation === "create" ? setBrief(event.target.value) : setEditInstruction(event.target.value)}
              rows={9}
              placeholder={briefOperation === "create" ? "Describe the product: audience, screens, hierarchy, primary actions, and recovery paths…" : "Describe one intent change, e.g. \"Move the CTA above the fold on the pricing screen.\""}
              className="resize-none rounded-[6px] border border-[var(--line)] bg-[var(--field)] p-3 text-[12px] font-normal leading-relaxed text-[var(--ink)] outline-none transition-shadow placeholder:text-[var(--faint)] focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_color-mix(in_oklab,var(--accent)_12%,transparent)] disabled:cursor-wait disabled:opacity-60"
            />
            <span className="flex items-center justify-between font-normal text-[var(--muted)]">
              <span className="text-[10.5px]">{briefOperation === "create" ? "Audience, hierarchy, behavior, and recovery paths." : "One intent change; only affected stable nodes are patched."}</span>
              <span className="font-mono text-[10px] text-[var(--faint)]">{(briefOperation === "create" ? brief : editInstruction).length} chars</span>
            </span>
          </label>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => compileBrief(briefOperation)} disabled={isPending} className="inline-flex h-8 items-center gap-2 rounded-[6px] bg-[var(--accent-deep)] px-3 text-[11px] font-semibold text-white transition-transform active:translate-y-px disabled:cursor-wait disabled:opacity-60">
              {briefOperation === "create" ? "Build semantic graph" : "Apply typed edit"} <ArrowRight size={13} />
            </button>
            <button type="button" onClick={() => setBrief(demoBrief)} disabled={isPending} className="inline-flex h-8 items-center rounded-[6px] border border-[var(--line)] bg-[var(--chip)] px-3 text-[11px] font-medium text-[var(--muted)] hover:text-[var(--ink)] disabled:opacity-50">
              Use the verified sample brief
            </button>
          </div>
        </div>
        <div className="min-w-0 self-start">
          <PhonePreview graph={graph} selectedScreen={selectedScreen} />
        </div>
      </div>
    </div>
  );
}
