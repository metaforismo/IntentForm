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

function SectionHeading({ label }: { label: string }) {
  return <span className="text-[11px] font-semibold tracking-[.01em] text-[var(--muted)]">{label}</span>;
}

export function GraphStage({ graph, selectedScreen, setSelectedScreen, onInspectOutputs }: GraphStageProps) {
  const screen = graph.screens.find((item) => item.id === selectedScreen);
  const contract = graph.contracts.find((item) => item.screenId === selectedScreen);

  return (
    <div className="mx-auto grid max-w-[1280px] gap-5 xl:grid-cols-[230px_minmax(320px,.85fr)_minmax(340px,1fr)]">
      <div className="border-b border-[var(--line)] pb-5 xl:border-r xl:border-b-0 xl:pr-5">
        <span className="font-mono text-[11px] text-[var(--accent)]">SCREENS</span>
        <div className="mt-2.5 grid gap-0.5">
          {graph.screens.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-current={selectedScreen === item.id ? "true" : undefined}
              onClick={() => setSelectedScreen(item.id)}
              className={`flex h-9 items-center justify-between gap-2 rounded-lg px-2.5 text-left transition-colors ${selectedScreen === item.id ? "bg-[var(--accent-soft)] text-[var(--accent-text)]" : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"}`}
            >
              <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{item.title}</span>
              <span className="shrink-0 font-mono text-[10px] opacity-70">{item.route}</span>
            </button>
          ))}
        </div>

        <div className="mt-5 rounded-[6px] border border-[var(--line)] bg-[var(--surface-strong)] p-3">
          <span className="font-mono text-[11px] text-[var(--accent)]">FLOWS</span>
          <div className="mt-2.5 grid gap-2">
            {graph.flows.flatMap((flow) => flow.steps).map((step) => (
              <div key={`${step.from}-${step.event}`} className="grid min-w-0 gap-1">
                <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-[var(--muted)]">
                  <span className="truncate">{step.from}</span>
                  <ArrowRight size={10} className="shrink-0 opacity-60" />
                  <span className="truncate">{step.to}</span>
                </span>
                <span className="w-fit max-w-full truncate rounded-md bg-[var(--chip)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--faint)]">{step.event}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <PhonePreview graph={graph} selectedScreen={selectedScreen} />

      <div className="min-w-0">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[11px] text-[var(--accent)]">SEMANTIC OUTLINE</span>
          <span className="rounded-full bg-[var(--accent-soft)] px-2.5 py-1 font-mono text-[10px] text-[var(--accent-text)]">valid · v{graph.schemaVersion}</span>
        </div>

        <div className="mt-3 rounded-[6px] border border-[var(--line)] bg-[var(--surface-strong)]">
          <div className="divide-y divide-[var(--line)] px-1">
            {screen?.nodes.map((node, index) => {
              const primary = node.intent.importance === "primary";
              return (
                <motion.div layout key={node.id} className="grid grid-cols-[22px_minmax(0,1fr)] items-center gap-3 px-2.5 py-2.5 sm:grid-cols-[22px_minmax(0,1fr)_auto_auto]">
                  <span className="font-mono text-[10px] text-[var(--faint)]">{String(index + 1).padStart(2, "0")}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] text-[var(--ink)]">{node.intent.label}</span>
                    <span className="block truncate font-mono text-[10px] text-[var(--faint)]">{node.id}</span>
                  </span>
                  <span className="hidden rounded-md bg-[var(--chip)] px-2 py-0.5 text-[11px] text-[var(--muted)] sm:inline">{node.kind.replace(/-/g, " ")}</span>
                  <span className="hidden items-center gap-1.5 sm:flex">
                    <span className={`size-1.5 shrink-0 rounded-full ${primary ? "bg-[var(--accent)]" : "bg-[var(--faint)]"}`} />
                    <span className={`text-[11px] ${primary ? "text-[var(--accent)]" : "text-[var(--faint)]"}`}>{node.intent.importance}</span>
                  </span>
                </motion.div>
              );
            })}
          </div>

          {contract ? (
            <div className="grid gap-3 border-t border-[var(--line)] px-3 py-3.5">
              <div>
                <SectionHeading label="Data" />
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {contract.data.map((field) => (
                    <span key={field.name} className="rounded-md bg-[var(--chip)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--muted)]">{field.name}: {field.type}</span>
                  ))}
                </div>
              </div>
              <div>
                <SectionHeading label="Events" />
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {contract.events.map((event) => (
                    <span key={event.name} className="rounded-md bg-[var(--chip)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--muted)]">{event.name}</span>
                  ))}
                </div>
              </div>
              <div>
                <SectionHeading label="Visual states" />
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {contract.visualStates.map((state) => (
                    <span key={state} className="rounded-md bg-[var(--accent-soft)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--accent-dark)]">{state}</span>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <button type="button" onClick={onInspectOutputs} className="mt-4 inline-flex items-center gap-2 text-[12px] font-semibold text-[var(--accent-dark)]">Inspect generated code <ArrowRight size={14} /></button>
      </div>
    </div>
  );
}
