"use client";

import { ArrowRight } from "@phosphor-icons/react";
import type { SemanticInterfaceGraph } from "@intentform/semantic-schema";
import { motion } from "motion/react";
import { PhonePreview } from "./phone-preview";

interface GraphStageProps {
  graph: SemanticInterfaceGraph;
  selectedScreen: string;
  setSelectedScreen: (id: string) => void;
  onInspectOutputs: () => void;
}

export function GraphStage({ graph, selectedScreen, setSelectedScreen, onInspectOutputs }: GraphStageProps) {
  return (
    <div className="mx-auto grid max-w-[1360px] gap-5 xl:grid-cols-[250px_minmax(340px,.8fr)_minmax(320px,1fr)]">
      <div className="border-b border-[var(--line)] pb-5 xl:border-r xl:border-b-0 xl:pr-5">
        <span className="font-mono text-[10px] text-[var(--accent)]">SCREENS</span>
        <div className="mt-3 grid gap-2">
          {graph.screens.map((screen) => (
            <button key={screen.id} type="button" onClick={() => setSelectedScreen(screen.id)} className={`flex items-center justify-between rounded-xl px-3 py-3 text-left text-xs transition-colors ${selectedScreen === screen.id ? "bg-[var(--accent-soft)] text-[var(--accent-text)]" : "hover:bg-[var(--hover)]"}`}>
              <span><strong className="block">{screen.title}</strong><small className="font-mono text-[9px] opacity-60">{screen.route}</small></span>
              <ArrowRight size={13} />
            </button>
          ))}
        </div>
        <div className="mt-6 rounded-xl border border-[var(--line)] bg-[var(--surface-strong)] p-3">
          <span className="font-mono text-[9px] text-[var(--accent)]">FLOWS</span>
          {graph.flows.flatMap((flow) => flow.steps).map((step) => (
            <div key={`${step.from}-${step.event}`} className="mt-2.5 grid gap-0.5 text-[10px]">
              <span className="font-mono text-[9px] text-[var(--faint)]">{step.event}</span>
              <span className="flex items-center gap-1.5 text-[var(--muted)]">{step.from} <ArrowRight size={9} /> {step.to}</span>
            </div>
          ))}
        </div>
      </div>
      <PhonePreview graph={graph} selectedScreen={selectedScreen} />
      <div className="min-w-0">
        <div className="flex items-center justify-between"><span className="font-mono text-[10px] text-[var(--accent)]">SEMANTIC OUTLINE</span><span className="rounded-full bg-[var(--accent-soft)] px-2 py-1 font-mono text-[9px]">valid · v{graph.schemaVersion}</span></div>
        <div className="mt-3 divide-y divide-[var(--line)] border-y border-[var(--line)]">
          {graph.screens.find((screen) => screen.id === selectedScreen)?.nodes.map((node, index) => (
            <motion.div layout key={node.id} className="grid grid-cols-[24px_1fr_auto] gap-3 py-3.5">
              <span className="font-mono text-[9px] text-[var(--faint)]">{String(index + 1).padStart(2, "0")}</span>
              <span className="min-w-0"><strong className="block truncate text-xs">{node.intent.label}</strong><small className="font-mono text-[9px] text-[var(--muted)]">{node.kind} · {node.id}</small></span>
              <span className="self-center rounded-full border border-[var(--line)] px-2 py-1 text-[8px] font-semibold uppercase tracking-wider text-[var(--muted)]">{node.intent.importance}</span>
            </motion.div>
          ))}
        </div>
        {(() => {
          const contract = graph.contracts.find((item) => item.screenId === selectedScreen);
          if (!contract) return null;
          return (
            <div className="mt-5 rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] p-4">
              <span className="font-mono text-[9px] text-[var(--accent)]">SCREEN CONTRACT</span>
              <div className="mt-3 grid gap-3 text-[10px]">
                <div><span className="text-[var(--faint)]">Data</span><div className="mt-1 flex flex-wrap gap-1.5">{contract.data.map((field) => <span key={field.name} className="rounded-md bg-[var(--hover)] px-1.5 py-0.5 font-mono text-[9px]">{field.name}: {field.type}</span>)}</div></div>
                <div><span className="text-[var(--faint)]">Events</span><div className="mt-1 flex flex-wrap gap-1.5">{contract.events.map((event) => <span key={event.name} className="rounded-md bg-[var(--hover)] px-1.5 py-0.5 font-mono text-[9px]">{event.name}</span>)}</div></div>
                <div><span className="text-[var(--faint)]">Visual states</span><div className="mt-1 flex flex-wrap gap-1.5">{contract.visualStates.map((state) => <span key={state} className="rounded-md bg-[var(--accent-soft)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--accent-dark)]">{state}</span>)}</div></div>
              </div>
            </div>
          );
        })()}
        <button type="button" onClick={onInspectOutputs} className="mt-5 inline-flex items-center gap-2 text-xs font-semibold text-[var(--accent-dark)]">Inspect generated code <ArrowRight size={14} /></button>
      </div>
    </div>
  );
}
