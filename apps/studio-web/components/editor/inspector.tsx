"use client";

import {
  ArrowDown,
  ArrowUp,
  Copy,
  Cursor,
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
    <div className="grid gap-1.5">
      <span className="text-[11px] font-medium text-[var(--muted)]">{label}</span>
      <div className="grid grid-flow-col rounded-lg bg-[var(--hover)] p-0.5">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`min-h-7 truncate rounded-md px-2 text-[11px] font-medium transition-colors ${value === option.value ? "bg-[var(--seg-active)] text-[var(--t-strong)] shadow-[0_1px_4px_-2px_var(--shadow-strong)]" : "text-[var(--muted)] hover:text-[var(--t-strong)]"}`}
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
  const shared = "rounded-lg border border-[var(--line)] bg-[var(--field)] px-2.5 text-[12px] text-[var(--t-strong)] outline-none transition-colors hover:border-[var(--line-strong)] focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_color-mix(in_oklab,var(--accent)_12%,transparent)] placeholder:text-[var(--faint)]";
  return (
    <label className="grid gap-1.5 text-[11px] font-medium text-[var(--muted)]">
      {label}
      {multiline ? (
        <textarea
          key={label + value}
          defaultValue={value}
          placeholder={placeholder}
          rows={2}
          onBlur={(event) => onCommit(event.target.value.trim())}
          className={`${shared} resize-none py-2 font-normal leading-relaxed`}
        />
      ) : (
        <input
          key={label + value}
          defaultValue={value}
          placeholder={placeholder}
          onBlur={(event) => onCommit(event.target.value.trim())}
          onKeyDown={(event) => { if (event.key === "Enter") (event.target as HTMLInputElement).blur(); }}
          className={`${shared} min-h-8 font-normal`}
        />
      )}
    </label>
  );
}

function Section({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-3 px-3.5 pb-4 pt-3">
      {title ? <h3 className="text-[11px] font-semibold tracking-[.01em] text-[var(--muted)]">{title}</h3> : null}
      {children}
    </section>
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
  onSetActionEvent(nodeId: string, eventName: string | null): void;
  onSetFlowTarget(fromScreenId: string, eventName: string, targetScreenId: string | null): void;
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
  onSetActionEvent,
  onSetFlowTarget,
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
      className={`${visible ? "block" : "hidden"} ${desktopVisible ? "xl:block" : "xl:hidden"} absolute inset-y-0 right-0 z-[3] w-[304px] min-h-0 overflow-y-auto overflow-x-hidden border-l border-[var(--line)] bg-[var(--chrome)] text-[var(--t-strong)] shadow-[-24px_0_52px_-32px_var(--shadow-strong)] xl:relative xl:z-[1] xl:w-auto xl:shadow-none`}
    >
      <div className="sticky top-0 z-[1] flex h-10 items-center justify-between border-b border-[var(--line)] bg-[var(--chrome)] pl-3.5 pr-2">
        <div className="flex items-baseline gap-2">
          <span className="text-[12px] font-semibold text-[var(--ink)]">Design</span>
          <span className="rounded bg-[var(--accent-soft)] px-1.5 py-px font-mono text-[9px] text-[var(--accent-text)]">semantic</span>
        </div>
        <IconButton ariaLabel="Close design inspector" onClick={onClose}><X size={13} /></IconButton>
      </div>

      <div className="border-b border-[var(--line)]">
        <Section>
          <TextField label="Screen name" value={screen.title} onCommit={(next) => { if (next && next !== screen.title) onScreenTitle(next); }} />
          <TextField label="Screen purpose" value={screen.purpose} multiline onCommit={(next) => { if (next.length >= 3 && next !== screen.purpose) onScreenPurpose(next); }} />
          <span className="font-mono text-[10px] text-[var(--faint)]">{screen.route}</span>
        </Section>
      </div>

      {selectedNode ? (
        <div data-testid="semantic-inspector" className="divide-y divide-[var(--line)]">
          <div className="flex items-center justify-between py-2 pl-3.5 pr-2">
            <div className="min-w-0">
              <span className="block text-[12px] font-semibold text-[var(--ink)]">{nodeNames[selectedNode.kind]}</span>
              <span className="mt-0.5 block truncate font-mono text-[10px] text-[var(--faint)]">{selectedNode.id}</span>
            </div>
            <div className="flex shrink-0 gap-0.5">
              <IconButton ariaLabel="Duplicate layer" onClick={onDuplicate}><Copy size={13} /></IconButton>
              <IconButton ariaLabel="Move layer up" onClick={() => onReorder(-1)}><ArrowUp size={13} /></IconButton>
              <IconButton ariaLabel="Move layer down" onClick={() => onReorder(1)}><ArrowDown size={13} /></IconButton>
              <IconButton ariaLabel="Delete layer" onClick={onDelete} disabled={screen.nodes.length <= 1} danger><Trash size={13} /></IconButton>
            </div>
          </div>

          <Section title="Content">
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
          </Section>

          <Section title="Layout">
            <SegmentedControl label="Axis" value={selectedNode.layout.axis} options={[{ value: "vertical", label: "Vertical" }, { value: "horizontal", label: "Horizontal" }, { value: "overlay", label: "Overlay" }]} onChange={(value) => updateNode((node) => { node.layout.axis = value; }, `Changed layout axis to ${value}.`)} />
            <SegmentedControl label="Width" value={selectedNode.layout.width} options={[{ value: "hug", label: "Hug" }, { value: "fill", label: "Fill" }, { value: "fixed", label: "Fixed" }]} onChange={(value) => updateNode((node) => { node.layout.width = value; }, `Changed semantic width to ${value}.`)} />
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1.5 text-[11px] font-medium text-[var(--muted)]">Gap token<select value={selectedNode.layout.gapToken} onChange={(event) => updateNode((node) => { node.layout.gapToken = event.target.value; }, `Bound gap to ${event.target.value}.`)} className="select-control font-mono text-[11px] font-normal">{Object.keys(graph.tokens.spacing).map((token) => <option key={token}>{token}</option>)}</select></label>
              <label className="grid gap-1.5 text-[11px] font-medium text-[var(--muted)]">Padding token<select value={selectedNode.layout.paddingToken} onChange={(event) => updateNode((node) => { node.layout.paddingToken = event.target.value; }, `Bound padding to ${event.target.value}.`)} className="select-control font-mono text-[11px] font-normal">{Object.keys(graph.tokens.spacing).map((token) => <option key={token}>{token}</option>)}</select></label>
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
          </Section>

          {contractStates.length > 0 ? (
            <Section title="State visibility">
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
                      className={`min-h-7 rounded-full border px-2.5 text-[11px] font-medium capitalize transition-colors ${bound ? "border-transparent bg-[var(--accent-soft)] text-[var(--accent-text)]" : "border-[var(--line)] bg-[var(--field)] text-[var(--muted)] hover:border-[var(--line-strong)]"}`}
                    >
                      {state}
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] leading-relaxed text-[var(--faint)]">
                {boundStates.size === 0 ? "No bindings: the layer is visible in every state." : "The layer only renders in the selected states."}
              </p>
            </Section>
          ) : null}

          {isAction && contract && contract.events.length > 0 ? (
            <Section title="Interaction">
              <label className="grid gap-1.5 text-[11px] font-medium text-[var(--muted)]">
                Emits event
                <select
                  value={selectedNode.interactions[0]?.event ?? ""}
                  onChange={(event) => onSetActionEvent(selectedNode.id, event.target.value || null)}
                  className="select-control font-mono text-[11px] font-normal"
                >
                  <option value="">No event</option>
                  {contract.events.map((event) => <option key={event.name} value={event.name}>{event.name}</option>)}
                </select>
              </label>
              {selectedNode.interactions[0] ? (
                <label className="grid gap-1.5 text-[11px] font-medium text-[var(--muted)]">
                  Navigates to
                  <select
                    value={graph.flows.flatMap((flow) => flow.steps).find((step) => step.from === screen.id && step.event === selectedNode.interactions[0]?.event)?.to ?? ""}
                    onChange={(event) => onSetFlowTarget(screen.id, selectedNode.interactions[0]!.event, event.target.value || null)}
                    className="select-control text-[11px] font-normal"
                  >
                    <option value="">No navigation</option>
                    {graph.screens.filter((item) => item.id !== screen.id).map((item) => (
                      <option key={item.id} value={item.id}>{item.title}</option>
                    ))}
                  </select>
                </label>
              ) : null}
              <p className="text-[11px] leading-relaxed text-[var(--faint)]">Events are typed in the screen contract. Navigation becomes a flow edge on the board and drives preview mode.</p>
            </Section>
          ) : null}

          <Section title="Style">
            <SegmentedControl label="Emphasis" value={selectedNode.style.emphasis} options={[{ value: "quiet", label: "Quiet" }, { value: "normal", label: "Normal" }, { value: "strong", label: "Strong" }]} onChange={(value) => updateNode((node) => { node.style.emphasis = value; }, `Changed semantic emphasis to ${value}.`)} />
            <p className="rounded-lg bg-[var(--accent-soft)] p-3 text-[11px] leading-relaxed text-[var(--accent-text)]">
              Edits change graph properties, never viewport coordinates. React and SwiftUI lower the same relation differently.
            </p>
          </Section>
        </div>
      ) : (
        <div className="grid min-h-56 place-items-center p-6 text-center">
          <div>
            <span className="mx-auto grid size-10 place-items-center rounded-xl border border-[var(--line)] bg-[var(--field)] text-[var(--muted)]"><Cursor size={18} /></span>
            <p className="mt-3 text-[12px] text-[var(--muted)]">Select a layer to edit its semantic properties.</p>
          </div>
        </div>
      )}
    </aside>
  );
}
