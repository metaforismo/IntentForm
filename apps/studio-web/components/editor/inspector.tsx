"use client";

import {
  ArrowDown,
  ArrowUp,
  Copy,
  Cursor,
  Selection,
  Stack,
  Trash,
  X,
} from "@phosphor-icons/react";
import type { SemanticInterfaceGraph, SemanticNode } from "@intentform/semantic-schema";
import { IconButton } from "../ui/controls";
import { nodeNames, type DeviceProfile, type VisualState } from "./support";

export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange(value: T): void;
}) {
  return (
    <div className="grid gap-2">
      <span className="text-[10px] font-medium text-[var(--muted)]">{label}</span>
      <div className="grid grid-flow-col rounded-lg border border-[var(--line)] bg-[var(--hover)] p-0.5">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`min-h-7 rounded-md px-2 text-[10px] font-medium transition-colors ${value === option.value ? "bg-[var(--seg-active)] text-[var(--t-strong)] shadow-[0_3px_9px_-7px_var(--shadow-strong),inset_0_0_0_1px_var(--float-inset)]" : "text-[var(--muted)] hover:bg-[var(--seg-hover)] hover:text-[var(--t-strong)]"}`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function TextField({
  label,
  value,
  placeholder,
  multiline,
  onCommit,
}: {
  label: string;
  value: string;
  placeholder?: string;
  multiline?: boolean;
  onCommit(next: string): void;
}) {
  const shared = "rounded-lg border border-[var(--line)] bg-[var(--field)] px-2.5 text-[11px] text-[var(--t-strong)] outline-none focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_color-mix(in_oklab,var(--accent)_14%,transparent)]";
  return (
    <label className="grid gap-2 text-[10px] text-[var(--muted)]">
      {label}
      {multiline ? (
        <textarea
          key={label + value}
          defaultValue={value}
          placeholder={placeholder}
          rows={2}
          onBlur={(event) => onCommit(event.target.value.trim())}
          className={`${shared} resize-none py-2 leading-relaxed`}
        />
      ) : (
        <input
          key={label + value}
          defaultValue={value}
          placeholder={placeholder}
          onBlur={(event) => onCommit(event.target.value.trim())}
          onKeyDown={(event) => { if (event.key === "Enter") (event.target as HTMLInputElement).blur(); }}
          className={`${shared} min-h-8`}
        />
      )}
    </label>
  );
}

interface InspectorProps {
  graph: SemanticInterfaceGraph;
  screen: SemanticInterfaceGraph["screens"][number];
  selectedNode: SemanticNode | null;
  profile: DeviceProfile;
  visible: boolean;
  desktopVisible: boolean;
  updateNode(mutate: (node: SemanticNode) => void, notice: string): void;
  onDuplicate(): void;
  onReorder(direction: -1 | 1): void;
  onDelete(): void;
  onScreenTitle(title: string): void;
  onScreenPurpose(purpose: string): void;
  onClose(): void;
}

export function Inspector({
  graph,
  screen,
  selectedNode,
  profile,
  visible,
  desktopVisible,
  updateNode,
  onDuplicate,
  onReorder,
  onDelete,
  onScreenTitle,
  onScreenPurpose,
  onClose,
}: InspectorProps) {
  const contract = graph.contracts.find((item) => item.screenId === screen.id);
  const contractStates = (contract?.visualStates ?? []) as VisualState[];
  const boundStates = new Set(selectedNode?.states.map((state) => state.name) ?? []);
  const isAction = selectedNode?.kind === "primary-action" || selectedNode?.kind === "secondary-action";

  return (
    <aside
      id="editor-inspector-panel"
      aria-label="Design inspector"
      className={`${visible ? "block" : "hidden"} ${desktopVisible ? "xl:block" : "xl:hidden"} absolute inset-y-0 right-0 z-[3] w-[304px] min-h-0 overflow-auto border-l border-[var(--line)] bg-[var(--chrome)] text-[var(--t-strong)] shadow-[-24px_0_52px_-32px_var(--shadow-strong)] xl:relative xl:z-[1] xl:w-auto xl:shadow-none`}
    >
      <div className="sticky top-0 z-[1] flex h-11 items-center justify-between border-b border-[var(--line)] bg-[var(--chrome)] px-3">
        <div className="flex items-center gap-2"><span className="text-[11px] font-semibold text-[var(--t-strong)]">Design</span><span className="rounded-md bg-[var(--accent-soft)] px-1.5 py-0.5 font-mono text-[8px] text-[var(--accent-text)]">semantic</span></div>
        <IconButton ariaLabel="Close design inspector" onClick={onClose}><X size={13} /></IconButton>
      </div>

      <section className="grid gap-3 border-b border-[var(--line)] p-4">
        <TextField label="Screen name" value={screen.title} onCommit={(next) => { if (next && next !== screen.title) onScreenTitle(next); }} />
        <TextField label="Screen purpose" value={screen.purpose} multiline onCommit={(next) => { if (next.length >= 3 && next !== screen.purpose) onScreenPurpose(next); }} />
        <span className="font-mono text-[9px] text-[var(--faint)]">{screen.route}</span>
      </section>

      {selectedNode ? (
        <div data-testid="semantic-inspector" className="divide-y divide-[var(--line)]">
          <section className="p-4">
            <div className="flex items-center justify-between">
              <div className="min-w-0"><span className="block text-[11px] font-semibold">{nodeNames[selectedNode.kind]}</span><span className="mt-1 block truncate font-mono text-[9px] text-[var(--faint)]">{selectedNode.id}</span></div>
              <div className="flex gap-1">
                <button type="button" aria-label="Duplicate layer" onClick={onDuplicate} className="grid size-7 place-items-center rounded-md text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--t-strong)]"><Copy size={12} /></button>
                <button type="button" aria-label="Move layer up" onClick={() => onReorder(-1)} className="grid size-7 place-items-center rounded-md text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--t-strong)]"><ArrowUp size={12} /></button>
                <button type="button" aria-label="Move layer down" onClick={() => onReorder(1)} className="grid size-7 place-items-center rounded-md text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--t-strong)]"><ArrowDown size={12} /></button>
                <IconButton ariaLabel="Delete layer" onClick={onDelete} disabled={screen.nodes.length <= 1} danger><Trash size={12} /></IconButton>
              </div>
            </div>
          </section>

          <section className="grid gap-3.5 p-4">
            <h3 className="text-[11px] font-semibold">Content</h3>
            <TextField
              label="Label"
              value={selectedNode.intent.label ?? ""}
              onCommit={(next) => {
                if (next && next !== selectedNode.intent.label) {
                  updateNode((node) => { node.intent.label = next; node.accessibility.label = next; }, "Updated visible and accessible label.");
                }
              }}
            />
            <TextField
              label="Purpose"
              value={selectedNode.intent.purpose}
              multiline
              onCommit={(next) => {
                if (next.length >= 3 && next !== selectedNode.intent.purpose) {
                  updateNode((node) => { node.intent.purpose = next; }, "Refined the node's intent purpose.");
                }
              }}
            />
            <TextField
              label="Accessibility hint"
              value={selectedNode.accessibility.hint ?? ""}
              placeholder="Optional guidance for assistive tech"
              onCommit={(next) => {
                if (next !== (selectedNode.accessibility.hint ?? "")) {
                  updateNode((node) => {
                    if (next) node.accessibility.hint = next;
                    else delete node.accessibility.hint;
                  }, next ? "Added an accessibility hint." : "Removed the accessibility hint.");
                }
              }}
            />
            <SegmentedControl
              label="Importance"
              value={selectedNode.intent.importance}
              options={[{ value: "primary", label: "Primary" }, { value: "secondary", label: "Secondary" }, { value: "supporting", label: "Support" }]}
              onChange={(value) => updateNode((node) => { node.intent.importance = value; }, `Marked the node as ${value}.`)}
            />
          </section>

          <section className="grid gap-3.5 p-4">
            <div className="flex items-center justify-between"><h3 className="text-[11px] font-semibold">Semantic layout</h3><Stack size={13} className="text-[var(--faint)]" /></div>
            <SegmentedControl label="Axis" value={selectedNode.layout.axis} options={[{ value: "vertical", label: "Vertical" }, { value: "horizontal", label: "Horizontal" }, { value: "overlay", label: "Overlay" }]} onChange={(value) => updateNode((node) => { node.layout.axis = value; }, `Changed layout axis to ${value}.`)} />
            <SegmentedControl label="Width" value={selectedNode.layout.width} options={[{ value: "hug", label: "Hug" }, { value: "fill", label: "Fill" }, { value: "fixed", label: "Fixed" }]} onChange={(value) => updateNode((node) => { node.layout.width = value; }, `Changed semantic width to ${value}.`)} />
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-2 text-[10px] text-[var(--muted)]">Gap token<select value={selectedNode.layout.gapToken} onChange={(event) => updateNode((node) => { node.layout.gapToken = event.target.value; }, `Bound gap to ${event.target.value}.`)} className="select-control text-[10px]">{Object.keys(graph.tokens.spacing).map((token) => <option key={token}>{token}</option>)}</select></label>
              <label className="grid gap-2 text-[10px] text-[var(--muted)]">Padding token<select value={selectedNode.layout.paddingToken} onChange={(event) => updateNode((node) => { node.layout.paddingToken = event.target.value; }, `Bound padding to ${event.target.value}.`)} className="select-control text-[10px]">{Object.keys(graph.tokens.spacing).map((token) => <option key={token}>{token}</option>)}</select></label>
            </div>
            {selectedNode.kind === "primary-action" && selectedNode.layout.placement ? (
              <SegmentedControl
                label={`${profile.breakpoint === "compact" ? "Compact" : "Regular"} placement`}
                value={selectedNode.layout.placement[profile.breakpoint]}
                options={[{ value: "inline", label: "Inline" }, { value: "persistent-bottom", label: "Bottom safe area" }]}
                onChange={(value) => updateNode(
                  (node) => { if (node.layout.placement) node.layout.placement[profile.breakpoint] = value; },
                  value === "persistent-bottom" ? `Anchored action to the ${profile.breakpoint} bottom safe area.` : `Returned action to the ${profile.breakpoint} semantic stack.`,
                )}
              />
            ) : null}
          </section>

          {contractStates.length > 0 ? (
            <section className="grid gap-3 p-4">
              <h3 className="text-[11px] font-semibold">State visibility</h3>
              <div className="flex flex-wrap gap-1.5">
                {contractStates.map((state) => {
                  const bound = boundStates.has(state);
                  return (
                    <button
                      key={state}
                      type="button"
                      aria-pressed={bound}
                      onClick={() => updateNode((node) => {
                        node.states = bound
                          ? node.states.filter((binding) => binding.name !== state)
                          : [...node.states, { name: state }];
                      }, bound ? `Unbound the layer from the ${state} state.` : `Bound the layer to the ${state} state.`)}
                      className={`min-h-7 rounded-full border px-2.5 text-[10px] font-medium capitalize ${bound ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-dark)]" : "border-[var(--line)] bg-[var(--field)] text-[var(--muted)] hover:border-[var(--line-strong)]"}`}
                    >
                      {state}
                    </button>
                  );
                })}
              </div>
              <p className="text-[9.5px] leading-relaxed text-[var(--faint)]">
                {boundStates.size === 0 ? "No bindings: the layer is visible in every state." : "The layer only renders in the selected states."}
              </p>
            </section>
          ) : null}

          {isAction && contract && contract.events.length > 0 ? (
            <section className="grid gap-3 p-4">
              <h3 className="text-[11px] font-semibold">Interaction</h3>
              <label className="grid gap-2 text-[10px] text-[var(--muted)]">
                Emits event
                <select
                  value={selectedNode.interactions[0]?.event ?? ""}
                  onChange={(event) => updateNode((node) => {
                    node.interactions = event.target.value ? [{ event: event.target.value, requires: [] }] : [];
                  }, event.target.value ? `Bound the action to ${event.target.value}.` : "Detached the action from its event.")}
                  className="select-control font-mono text-[10px]"
                >
                  <option value="">No event</option>
                  {contract.events.map((event) => <option key={event.name} value={event.name}>{event.name}</option>)}
                </select>
              </label>
              <p className="text-[9.5px] leading-relaxed text-[var(--faint)]">Events are typed in the screen contract and drive flow navigation in preview mode.</p>
            </section>
          ) : null}

          <section className="grid gap-3.5 p-4">
            <h3 className="text-[11px] font-semibold">Style intent</h3>
            <SegmentedControl label="Emphasis" value={selectedNode.style.emphasis} options={[{ value: "quiet", label: "Quiet" }, { value: "normal", label: "Normal" }, { value: "strong", label: "Strong" }]} onChange={(value) => updateNode((node) => { node.style.emphasis = value; }, `Changed semantic emphasis to ${value}.`)} />
            <div className="rounded-lg border border-[var(--line)] bg-[var(--hover)] p-3">
              <div className="flex items-center gap-2 text-[10px] font-medium text-[var(--accent-text)]"><Selection size={12} className="text-[var(--accent)]" /> Compiles responsively</div>
              <p className="mt-2 text-[9.5px] leading-relaxed text-[var(--muted)]">Edits change graph properties, never viewport coordinates. React and SwiftUI lower the same relation differently.</p>
            </div>
          </section>
        </div>
      ) : (
        <div className="grid min-h-56 place-items-center p-6 text-center"><div><span className="mx-auto grid size-10 place-items-center rounded-xl border border-[var(--line)] bg-[var(--field)] text-[var(--muted)]"><Cursor size={18} /></span><p className="mt-3 text-[11px] text-[var(--muted)]">Select a layer to edit its semantic properties.</p></div></div>
      )}
    </aside>
  );
}
