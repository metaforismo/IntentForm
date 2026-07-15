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
    <div className="mx-auto grid max-w-[1200px] gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(380px,.95fr)]">
      <div className="pt-3 md:pt-10">
        <span className="font-mono text-[11px] text-[var(--accent)]">01 / PRODUCT BRIEF</span>
        <h2 className="mt-4 max-w-[620px] text-3xl font-semibold leading-[1.03] tracking-[-.055em] md:text-5xl">Describe the product. Keep the intent.</h2>
        <p className="mt-5 max-w-[60ch] text-sm leading-relaxed text-[var(--muted)]">GPT‑5.6 turns a brief into a validated graph or proposes a narrow typed patch. Enabled React, SwiftUI and responsive-web outputs are always compiled later by deterministic backends.</p>
        <div className="mt-8 inline-flex rounded-lg bg-[var(--hover)] p-0.5" role="group" aria-label="Intent operation">
          {(["create", "edit"] as const).map((operation) => (
            <button key={operation} type="button" aria-pressed={briefOperation === operation} disabled={isPending} onClick={() => setBriefOperation(operation)} className={`min-h-8 rounded-md px-3 text-[11px] font-semibold capitalize transition-colors disabled:opacity-50 ${briefOperation === operation ? "bg-[var(--seg-active)] text-[var(--ink)] shadow-[0_1px_4px_-2px_var(--shadow-strong)]" : "text-[var(--muted)] hover:text-[var(--ink)]"}`}>{operation === "create" ? "New graph" : "Semantic edit"}</button>
          ))}
        </div>
        <label className="mt-10 grid gap-2 text-xs font-semibold">
          {briefOperation === "create" ? "Product brief" : "Edit instruction"}
          <textarea
            value={briefOperation === "create" ? brief : editInstruction}
            disabled={isPending}
            onChange={(event) => briefOperation === "create" ? setBrief(event.target.value) : setEditInstruction(event.target.value)}
            rows={8}
            placeholder={briefOperation === "create" ? "Describe the product: audience, screens, hierarchy, primary actions, and recovery paths…" : "Describe one intent change, e.g. \"Move the CTA above the fold on the pricing screen.\""}
            className="resize-none rounded-[24px] border border-[var(--line)] bg-[var(--field)] p-5 text-[14px] font-normal leading-relaxed text-[var(--ink)] outline-none transition-shadow placeholder:text-[var(--faint)] focus:border-[var(--accent)] focus:shadow-[0_0_0_4px_color-mix(in_oklab,var(--accent)_12%,transparent)] disabled:cursor-wait disabled:opacity-60"
          />
          <span className="flex items-center justify-between text-[11px] font-normal text-[var(--muted)]">
            <span>{briefOperation === "create" ? "Describe audience, hierarchy, behavior and recovery." : "Describe one intent change. Only affected stable nodes will be patched."}</span>
            <span className="font-mono text-[10px] text-[var(--faint)]">{(briefOperation === "create" ? brief : editInstruction).length} chars</span>
          </span>
        </label>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => compileBrief(briefOperation)} disabled={isPending} className="inline-flex min-h-12 items-center gap-3 rounded-2xl bg-[var(--accent-deep)] px-5 text-sm font-semibold text-white transition-transform active:translate-y-px disabled:cursor-wait disabled:opacity-60">
            {briefOperation === "create" ? "Build semantic graph" : "Apply typed edit"} <ArrowRight size={16} />
          </button>
          <button type="button" onClick={() => setBrief(demoBrief)} disabled={isPending} className="inline-flex min-h-9 items-center rounded-xl border border-[var(--line)] bg-[var(--chip)] px-3 text-xs font-medium text-[var(--muted)] hover:text-[var(--ink)] disabled:opacity-50">
            Use the verified sample brief
          </button>
        </div>
      </div>
      <div className="self-start md:pt-10">
        <PhonePreview graph={graph} selectedScreen={selectedScreen} />
      </div>
    </div>
  );
}
