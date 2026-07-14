"use client";

import { Check } from "@phosphor-icons/react";
import type { SemanticInterfaceGraph, SemanticNode } from "@intentform/semantic-schema";
import { tokenColor, tokenRadius } from "./support";

/* Renders one semantic node at realistic mobile proportions. Color and radius
   come from the graph's own design tokens, so token edits repaint the canvas. */
export function NodePreview({ node, graph }: { node: SemanticNode; graph: SemanticInterfaceGraph }) {
  const accent = tokenColor(graph, "color.accent", "#397461");
  const ink = tokenColor(graph, "color.ink", "#181c1a");
  const surfaceRadius = tokenRadius(graph, "radius.surface", 28);
  const controlRadius = tokenRadius(graph, "radius.control", 18);
  const deep = `color-mix(in oklab, ${accent} 62%, ${ink})`;
  const soft = `color-mix(in oklab, ${accent} 14%, #ffffff)`;
  const hairline = `color-mix(in oklab, ${ink} 12%, #ffffff)`;

  switch (node.kind) {
    case "balance-summary":
      return (
        <div className="grid gap-1.5 p-6 text-white" style={{ background: deep, borderRadius: surfaceRadius, boxShadow: "0 24px 44px -30px rgba(20, 40, 33, .8)" }}>
          <span className="text-[13px] text-white/65">{node.intent.label ?? "Available balance"}</span>
          <strong className="font-mono text-[34px] leading-none tracking-[-0.05em]">€8,420.16</strong>
          <span className="text-[11px] text-white/50">Updated just now</span>
        </div>
      );
    case "transaction-list":
      return (
        <div className="grid gap-1">
          <span className="text-[15px] font-semibold tracking-[-.02em]">{node.intent.label}</span>
          {[["Riva Studio", "−€84.20"], ["Northline Market", "−€32.70"]].map(([name, amount]) => (
            <div key={name} className="flex items-center justify-between py-3 text-[13.5px]" style={{ borderTop: `1px solid ${hairline}` }}>
              <span>{name}</span><strong className="font-mono tracking-[-.02em]">{amount}</strong>
            </div>
          ))}
        </div>
      );
    case "money-input":
      return (
        <div className="grid gap-2 text-[13px] font-medium">
          {node.intent.label}
          <div className="border bg-white px-5 py-4 font-mono text-[27px] font-semibold tracking-[-.04em]" style={{ borderColor: hairline, borderRadius: controlRadius }}>€120.00</div>
        </div>
      );
    case "recipient-identity":
      return (
        <div className="flex items-center gap-3.5 py-3.5" style={{ borderTop: `1px solid ${hairline}`, borderBottom: `1px solid ${hairline}` }}>
          <span className="grid size-11 place-items-center rounded-full text-[12px] font-bold" style={{ background: soft, color: deep }}>MR</span>
          <span className="grid gap-0.5"><strong className="text-[14px] tracking-[-.01em]">Mara Rinaldi</strong><small className="text-[12px] text-zinc-500">mara@northline.test</small></span>
        </div>
      );
    case "status-message":
      return (
        <div className="border-l-[3px] border-[#a4432c] bg-[#f6e7e1] p-4 text-[13px] leading-relaxed text-[#6f3423]" style={{ borderRadius: 6 }}>
          {node.intent.label}
        </div>
      );
    case "receipt-summary":
      return (
        <div className="grid justify-items-center gap-1.5 p-7 text-center" style={{ background: soft, borderRadius: surfaceRadius }}>
          <span className="grid size-11 place-items-center rounded-full text-white" style={{ background: accent }}><Check size={22} weight="bold" /></span>
          <span className="mt-1 text-[13px]">{node.intent.label}</span>
          <strong className="font-mono text-[30px] leading-none tracking-[-.04em]">€120.00</strong>
          <small className="text-[11px] text-zinc-500">Reference IF-2048</small>
        </div>
      );
    case "secondary-action":
      return (
        <div className="px-5 py-4 text-center text-[15px] font-semibold" style={{ background: soft, color: deep, borderRadius: controlRadius }}>
          {node.intent.label}
        </div>
      );
    case "primary-action":
      return (
        <div
          className="px-5 py-4 text-center text-[15px] font-bold text-white"
          style={{ background: accent, borderRadius: controlRadius, boxShadow: `0 18px 30px -20px color-mix(in oklab, ${accent} 85%, black)` }}
        >
          {node.intent.label}
        </div>
      );
  }
}
