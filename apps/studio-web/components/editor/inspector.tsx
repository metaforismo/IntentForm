"use client";

import {
  ArrowDown,
  ArrowUp,
  Copy,
  Cursor,
  Stack,
  Trash,
  X,
} from "@phosphor-icons/react";
import {
  isContainerNode,
  type ContainerNodeKind,
  type SemanticInterfaceGraph,
  type SemanticNode,
} from "@intentform/semantic-schema";
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
      <div role="group" aria-label={label} className="grid grid-flow-col rounded-lg bg-[var(--hover)] p-0.5">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
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

function NumberField({
  label,
  value,
  min = 0,
  max = 10_000,
  step = 1,
  onCommit,
}: {
  label: string;
  value: number | undefined;
  min?: number;
  max?: number;
  step?: number;
  onCommit(next: number | undefined): void;
}) {
  return (
    <label className="grid gap-1.5 text-[11px] font-medium text-[var(--muted)]">
      {label}
      <input
        key={`${label}-${value ?? "auto"}`}
        type="number"
        min={min}
        max={max}
        step={step}
        defaultValue={value}
        placeholder="Auto"
        onBlur={(event) => {
          const source = event.target.value.trim();
          if (!source) {
            if (value !== undefined) onCommit(undefined);
            return;
          }
          const next = Number(source);
          if (Number.isFinite(next) && next >= min && next <= max && next !== value) onCommit(next);
        }}
        onKeyDown={(event) => { if (event.key === "Enter") (event.target as HTMLInputElement).blur(); }}
        className="min-h-8 rounded-lg border border-[var(--line)] bg-[var(--field)] px-2.5 font-mono text-[11px] font-normal text-[var(--t-strong)] outline-none transition-colors hover:border-[var(--line-strong)] focus:border-[var(--accent)]"
      />
    </label>
  );
}

const adaptiveModes = [
  "stack", "grid", "overlay", "scroll", "safe-area", "wrap", "split", "freeform", "page-flow",
] as const satisfies readonly Exclude<ContainerNodeKind, "adaptive">[];

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
  selectionCount: number;
  profile: DeviceProfile;
  visualState: VisualState;
  visible: boolean;
  desktopVisible: boolean;
  updateNode(mutate: (node: SemanticNode) => void, notice: string): void;
  onUpdateFixture(fieldName: string, value: string | number | boolean): void;
  onSetActionEvent(nodeId: string, eventName: string | null): void;
  onSetFlowTarget(fromScreenId: string, eventName: string, targetScreenId: string | null): void;
  onDuplicate(): void;
  onReorder(direction: -1 | 1): void;
  onDelete(): void;
  onGroup(): void;
  canDelete: boolean;
  onScreenTitle(title: string): void;
  onScreenPurpose(purpose: string): void;
  onClose(): void;
}

export function Inspector({
  graph,
  screen,
  selectedNode,
  selectionCount,
  profile,
  visualState,
  visible,
  desktopVisible,
  updateNode,
  onUpdateFixture,
  onSetActionEvent,
  onSetFlowTarget,
  onDuplicate,
  onReorder,
  onDelete,
  onGroup,
  canDelete,
  onScreenTitle,
  onScreenPurpose,
  onClose,
}: InspectorProps) {
  const contract = graph.contracts.find((item) => item.screenId === screen.id);
  const contractStates = (contract?.visualStates ?? []) as VisualState[];
  const boundStates = new Set(selectedNode?.states.map((state) => state.name) ?? []);
  const isAction = selectedNode?.kind === "primary-action" || selectedNode?.kind === "secondary-action";
  const exactFixture = graph.fixtures.find((item) => item.screenId === screen.id && item.state === visualState);
  const fixture = exactFixture ?? graph.fixtures.find((item) => item.screenId === screen.id && item.state === "idle");

  return (
    <aside
      id="editor-inspector-panel"
      role={visible ? "dialog" : undefined}
      aria-modal={visible ? "true" : undefined}
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

      {contract && contract.data.length > 0 ? (
        <div className="border-b border-[var(--line)]" data-testid="fixture-editor">
          <Section title="Preview data">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] text-[var(--muted)]"><span className="font-medium capitalize text-[var(--t-strong)]">{visualState}</span> fixture</span>
              <span className={`rounded px-1.5 py-0.5 font-mono text-[9px] ${exactFixture ? "bg-[var(--accent-soft)] text-[var(--accent-text)]" : "bg-[var(--warn-soft)] text-[var(--warn)]"}`}>{exactFixture ? "saved" : "inherits idle"}</span>
            </div>
            <div className="grid gap-2.5">
              {contract.data.map((field) => {
                const value = fixture?.data[field.name];
                if (field.type === "boolean") {
                  return (
                    <label key={field.name} className="flex min-h-8 items-center justify-between rounded-lg border border-[var(--line)] bg-[var(--field)] px-2.5 text-[11px] font-medium text-[var(--muted)]">
                      {field.name}
                      <input aria-label={`Fixture ${field.name}`} type="checkbox" checked={value === true} onChange={(event) => onUpdateFixture(field.name, event.target.checked)} className="size-4 accent-[var(--accent)]" />
                    </label>
                  );
                }
                if (field.type === "status") {
                  return (
                    <label key={field.name} className="grid gap-1.5 text-[11px] font-medium text-[var(--muted)]">
                      {field.name}
                      <input aria-label={`Fixture ${field.name}`} value={visualState} readOnly className="min-h-8 rounded-lg border border-[var(--line)] bg-[var(--hover)] px-2.5 font-mono text-[11px] font-normal text-[var(--faint)] outline-none" />
                    </label>
                  );
                }
                return (
                  <label key={field.name} className="grid gap-1.5 text-[11px] font-medium text-[var(--muted)]">
                    {field.name}
                    <input
                      key={`${screen.id}-${visualState}-${field.name}-${String(value ?? "")}`}
                      aria-label={`Fixture ${field.name}`}
                      type={field.type === "number" ? "number" : "text"}
                      inputMode={field.type === "number" || field.type === "money" ? "decimal" : undefined}
                      defaultValue={typeof value === "string" || typeof value === "number" ? value : ""}
                      onBlur={(event) => {
                        const next = field.type === "number" ? Number(event.target.value) : event.target.value;
                        if (Number.isNaN(next) || next === value) return;
                        onUpdateFixture(field.name, next);
                      }}
                      onKeyDown={(event) => { if (event.key === "Enter") (event.target as HTMLInputElement).blur(); }}
                      className="min-h-8 rounded-lg border border-[var(--line)] bg-[var(--field)] px-2.5 font-mono text-[11px] font-normal text-[var(--t-strong)] outline-none transition-colors hover:border-[var(--line-strong)] focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_color-mix(in_oklab,var(--accent)_12%,transparent)]"
                    />
                  </label>
                );
              })}
            </div>
            <p className="text-[11px] leading-relaxed text-[var(--faint)]">Fixture values are design-time data. They update this state preview and compiler samples without becoming business logic.</p>
          </Section>
        </div>
      ) : null}

      {selectionCount > 1 ? (
        <div data-testid="multi-selection-inspector" className="border-b border-[var(--line)] px-3.5 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <span className="block text-[12px] font-semibold text-[var(--ink)]">{selectionCount} layers selected</span>
              <span className="mt-0.5 block text-[10px] text-[var(--faint)]">Drag as a block, or group into one semantic stack.</span>
            </div>
            <div className="flex shrink-0 gap-0.5">
              <IconButton ariaLabel="Group selected layers" onClick={onGroup}><Stack size={13} /></IconButton>
              <IconButton ariaLabel="Duplicate selected layers" onClick={onDuplicate}><Copy size={13} /></IconButton>
              <IconButton ariaLabel="Delete selected layers" onClick={onDelete} danger><Trash size={13} /></IconButton>
            </div>
          </div>
        </div>
      ) : selectedNode ? (
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
              <IconButton ariaLabel="Delete layer" onClick={onDelete} disabled={!canDelete} danger><Trash size={13} /></IconButton>
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
            <SegmentedControl label="Height" value={selectedNode.layout.height} options={[{ value: "hug", label: "Hug" }, { value: "fill", label: "Fill" }, { value: "fixed", label: "Fixed" }]} onChange={(value) => updateNode((node) => { node.layout.height = value; }, `Changed semantic height to ${value}.`)} />
            {selectedNode.layout.width === "fixed" || selectedNode.layout.height === "fixed" ? (
              <div className="grid grid-cols-2 gap-2">
                {selectedNode.layout.width === "fixed" ? <NumberField label="Fixed width" value={selectedNode.layout.fixedWidth} min={1} onCommit={(value) => updateNode((node) => { if (value === undefined) delete node.layout.fixedWidth; else node.layout.fixedWidth = value; }, "Updated the fixed width constraint.")} /> : <span />}
                {selectedNode.layout.height === "fixed" ? <NumberField label="Fixed height" value={selectedNode.layout.fixedHeight} min={1} onCommit={(value) => updateNode((node) => { if (value === undefined) delete node.layout.fixedHeight; else node.layout.fixedHeight = value; }, "Updated the fixed height constraint.")} /> : null}
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-2">
              <NumberField label="Min width" value={selectedNode.layout.minWidth} onCommit={(value) => updateNode((node) => { if (value === undefined) delete node.layout.minWidth; else node.layout.minWidth = value; }, "Updated the minimum width.")} />
              <NumberField label="Max width" value={selectedNode.layout.maxWidth} onCommit={(value) => updateNode((node) => { if (value === undefined) delete node.layout.maxWidth; else node.layout.maxWidth = value; }, "Updated the maximum width.")} />
              <NumberField label="Min height" value={selectedNode.layout.minHeight} onCommit={(value) => updateNode((node) => { if (value === undefined) delete node.layout.minHeight; else node.layout.minHeight = value; }, "Updated the minimum height.")} />
              <NumberField label="Max height" value={selectedNode.layout.maxHeight} onCommit={(value) => updateNode((node) => { if (value === undefined) delete node.layout.maxHeight; else node.layout.maxHeight = value; }, "Updated the maximum height.")} />
            </div>
            {selectedNode.layout.position ? (
              <div className="grid grid-cols-3 gap-2" data-testid="freeform-position-controls">
                {(["x", "y", "z"] as const).map((field) => (
                  <NumberField
                    key={field}
                    label={`Position ${field.toUpperCase()}`}
                    value={selectedNode.layout.position?.[field]}
                    min={0}
                    max={2_048}
                    onCommit={(value) => {
                      if (value === undefined) return;
                      updateNode((node) => {
                        if (node.layout.position) node.layout.position[field] = value;
                      }, `Set freeform ${field.toUpperCase()} to ${value}.`);
                    }}
                  />
                ))}
              </div>
            ) : null}
            <SegmentedControl label="Align" value={selectedNode.layout.align} options={[{ value: "start", label: "Start" }, { value: "center", label: "Center" }, { value: "end", label: "End" }, { value: "stretch", label: "Stretch" }]} onChange={(value) => updateNode((node) => { node.layout.align = value; }, `Changed cross-axis alignment to ${value}.`)} />
            <SegmentedControl label="Justify" value={selectedNode.layout.justify} options={[{ value: "start", label: "Start" }, { value: "center", label: "Center" }, { value: "end", label: "End" }, { value: "space-between", label: "Between" }]} onChange={(value) => updateNode((node) => { node.layout.justify = value; }, `Changed main-axis justification to ${value}.`)} />
            <SegmentedControl label="Overflow" value={selectedNode.layout.overflow} options={[{ value: "visible", label: "Visible" }, { value: "clip", label: "Clip" }, { value: "scroll", label: "Scroll" }]} onChange={(value) => updateNode((node) => { node.layout.overflow = value; }, `Changed overflow behavior to ${value}.`)} />
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1.5 text-[11px] font-medium text-[var(--muted)]">Gap token<select value={selectedNode.layout.gapToken} onChange={(event) => updateNode((node) => { node.layout.gapToken = event.target.value; }, `Bound gap to ${event.target.value}.`)} className="select-control font-mono text-[11px] font-normal">{Object.keys(graph.tokens.spacing).map((token) => <option key={token}>{token}</option>)}</select></label>
              <label className="grid gap-1.5 text-[11px] font-medium text-[var(--muted)]">Padding token<select value={selectedNode.layout.paddingToken} onChange={(event) => updateNode((node) => { node.layout.paddingToken = event.target.value; }, `Bound padding to ${event.target.value}.`)} className="select-control font-mono text-[11px] font-normal">{Object.keys(graph.tokens.spacing).map((token) => <option key={token}>{token}</option>)}</select></label>
            </div>
            {isContainerNode(selectedNode) ? (
              <div className="grid grid-cols-2 gap-2">
                <NumberField label="Columns" value={selectedNode.layout.columns} min={1} max={12} onCommit={(value) => { if (value !== undefined) updateNode((node) => { node.layout.columns = Math.round(value); }, `Set the container to ${Math.round(value)} columns.`); }} />
                <NumberField label="Split ratio" value={selectedNode.layout.splitRatio} min={0.1} max={0.9} step={0.05} onCommit={(value) => { if (value !== undefined) updateNode((node) => { node.layout.splitRatio = value; }, `Set the split ratio to ${value}.`); }} />
              </div>
            ) : null}
            {selectedNode.kind === "adaptive" && selectedNode.layout.adaptive ? (
              <div className="grid grid-cols-2 gap-2">
                {(["compact", "regular"] as const).map((deviceClass) => (
                  <label key={deviceClass} className="grid gap-1.5 text-[11px] font-medium capitalize text-[var(--muted)]">
                    {deviceClass} mode
                    <select value={selectedNode.layout.adaptive![deviceClass]} onChange={(event) => updateNode((node) => { if (node.layout.adaptive) node.layout.adaptive[deviceClass] = event.target.value as typeof adaptiveModes[number]; }, `Changed the ${deviceClass} adaptive mode.`)} className="select-control text-[11px] font-normal">
                      {adaptiveModes.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
                    </select>
                  </label>
                ))}
              </div>
            ) : null}
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
