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
  findGraphNode,
  isContainerNode,
  resolveTokenMode,
  type ComponentOverride,
  type ContainerNodeKind,
  type SemanticInterfaceGraph,
  type SemanticNode,
} from "@intentform/semantic-schema";
import { IconButton } from "../ui/controls";
import {
  CompositionSafeField as TextField,
  NumericScrubField as NumberField,
  SearchablePicker,
} from "../ui/editor-controls";
import { nodeNames, type DeviceProfile, type VisualState } from "./support";

export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  disabled = false,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  disabled?: boolean;
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
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={`min-h-7 truncate rounded-md px-2 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${value === option.value ? "bg-[var(--seg-active)] text-[var(--t-strong)] shadow-[0_1px_4px_-2px_var(--shadow-strong)]" : "text-[var(--muted)] hover:text-[var(--t-strong)]"}`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
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
  componentContext: { rootId: string; targetId: string; definitionId: string } | null;
  selectionCount: number;
  profile: DeviceProfile;
  visualState: VisualState;
  visible: boolean;
  desktopVisible: boolean;
  updateNode(mutate: (node: SemanticNode) => void, notice: string): void;
  onSetComponentProperty(name: string, value: string | number | boolean): void;
  onSetComponentVariant(variant: string | null): void;
  onSetComponentState(state: string | null): void;
  onSetComponentOverride(override: ComponentOverride): void;
  onResetComponent(): void;
  onDetachComponent(): void;
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
  componentContext,
  selectionCount,
  profile,
  visualState,
  visible,
  desktopVisible,
  updateNode,
  onSetComponentProperty,
  onSetComponentVariant,
  onSetComponentState,
  onSetComponentOverride,
  onResetComponent,
  onDetachComponent,
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
  const componentRoot = componentContext ? findGraphNode(graph, componentContext.rootId) : undefined;
  const componentInstance = componentRoot?.componentInstance;
  const componentDefinition = componentContext
    ? graph.components.find((definition) => definition.id === componentContext.definitionId)
    : undefined;
  const componentNested = Boolean(componentContext && selectedNode?.id !== componentContext.rootId);
  const resolvedTokens = resolveTokenMode(graph.tokens);
  const bindableAssets = graph.assets.filter((asset) => asset.kind !== "font");
  const boundAsset = selectedNode?.asset
    ? graph.assets.find((asset) => asset.id === selectedNode.asset?.assetId)
    : undefined;
  const boundAssetFile = selectedNode?.asset?.variantId
    ? boundAsset?.variants.find((variant) => variant.id === selectedNode.asset?.variantId) ?? boundAsset
    : boundAsset;
  const updateWeb = (mutate: (web: NonNullable<SemanticNode["web"]>) => void, notice: string) => updateNode((node) => {
    const display = isContainerNode(node) ? node.kind === "grid" ? "grid" : "flex" : "block";
    node.web ??= {
      display,
      direction: node.layout.axis === "horizontal" ? "row" : "column",
      wrap: node.kind === "wrap" ? "wrap" : "nowrap",
      position: "static",
      overflowX: node.layout.overflow === "scroll" ? "auto" : node.layout.overflow === "clip" ? "clip" : "visible",
      overflowY: node.layout.overflow === "scroll" ? "auto" : node.layout.overflow === "clip" ? "clip" : "visible",
      containerType: "normal",
      gridMinColumnWidth: 240,
      gridMaxColumns: display === "grid" ? node.layout.columns : 4,
      breakpointOverrides: {},
    };
    mutate(node.web);
  }, notice);

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
                if (field.type === "number") return (
                  <NumberField
                    key={field.name}
                    label={field.name}
                    ariaLabel={`Fixture ${field.name}`}
                    value={typeof value === "number" ? value : undefined}
                    onCommit={(next) => { if (next !== undefined && next !== value) onUpdateFixture(field.name, next); }}
                  />
                );
                return (
                  <TextField
                    key={field.name}
                    label={field.name}
                    ariaLabel={`Fixture ${field.name}`}
                    value={typeof value === "string" ? value : typeof value === "number" ? String(value) : ""}
                    onCommit={(next) => { if (next !== value) onUpdateFixture(field.name, next); }}
                  />
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

          {componentDefinition && componentInstance && componentContext ? (
            <Section title="Component instance">
              <div className="rounded-xl border border-[var(--line)] bg-[var(--field)] p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <strong className="block truncate text-[12px] font-semibold text-[var(--ink)]">{componentDefinition.name}</strong>
                    <span className="mt-0.5 block font-mono text-[9px] text-[var(--faint)]">{componentDefinition.id} · v{componentDefinition.version}</span>
                  </div>
                  <span className="rounded bg-[var(--accent-soft)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--accent-text)]">attached</span>
                </div>
                {selectedNode.id !== componentContext.rootId ? (
                  <p className="mt-2 text-[10px] leading-relaxed text-[var(--muted)]">Editing nested target <span className="font-mono">{componentContext.targetId}</span>. Definition-owned structural fields stay locked until detach.</p>
                ) : null}
              </div>
              {componentDefinition.properties.map((property) => {
                const value = componentInstance.props[property.name] ?? property.default;
                if (property.type === "boolean") {
                  return (
                    <label key={property.name} className="flex min-h-8 items-center justify-between rounded-lg border border-[var(--line)] bg-[var(--field)] px-2.5 text-[11px] font-medium text-[var(--muted)]">
                      {property.name}
                      <input aria-label={`Component property ${property.name}`} type="checkbox" checked={value === true} onChange={(event) => onSetComponentProperty(property.name, event.target.checked)} className="size-4 accent-[var(--accent)]" />
                    </label>
                  );
                }
                if (property.type === "number") {
                  return <NumberField key={property.name} label={property.name} value={typeof value === "number" ? value : undefined} onCommit={(next) => { if (next !== undefined) onSetComponentProperty(property.name, next); }} />;
                }
                return <TextField key={property.name} label={property.name} value={typeof value === "string" ? value : ""} onCommit={(next) => { if (next && next !== value) onSetComponentProperty(property.name, next); }} />;
              })}
              {componentDefinition.variants.length > 0 ? (
                <label className="grid gap-1.5 text-[11px] font-medium text-[var(--muted)]">Variant
                  <select aria-label="Component variant" value={componentInstance.variant ?? ""} onChange={(event) => onSetComponentVariant(event.target.value || null)} className="select-control text-[11px] font-normal">
                    <option value="">Default · {componentDefinition.defaultVariant ?? "base"}</option>
                    {componentDefinition.variants.map((variant) => <option key={variant.id} value={variant.id}>{variant.label}</option>)}
                  </select>
                </label>
              ) : null}
              {componentDefinition.states.length > 0 ? (
                <label className="grid gap-1.5 text-[11px] font-medium text-[var(--muted)]">Component state
                  <select aria-label="Component state" value={componentInstance.state ?? ""} onChange={(event) => onSetComponentState(event.target.value || null)} className="select-control text-[11px] font-normal">
                    <option value="">Default · {componentDefinition.defaultState ?? "base"}</option>
                    {componentDefinition.states.map((state) => <option key={state.id} value={state.id}>{state.label}</option>)}
                  </select>
                </label>
              ) : null}
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={onResetComponent} className="min-h-8 rounded-lg border border-[var(--line)] bg-[var(--field)] px-2 text-[11px] font-medium text-[var(--muted)] hover:border-[var(--line-strong)] hover:text-[var(--ink)]">Reset</button>
                <button type="button" onClick={onDetachComponent} className="min-h-8 rounded-lg border border-[var(--warn)]/30 bg-[var(--warn-soft)] px-2 text-[11px] font-medium text-[var(--warn)] hover:border-[var(--warn)]">Detach</button>
              </div>
            </Section>
          ) : null}

          <Section title="Asset">
            <label className="grid gap-1.5 text-[11px] font-medium text-[var(--muted)]">Content asset
              <select
                aria-label="Content asset"
                disabled={Boolean(componentContext)}
                value={selectedNode.asset?.assetId ?? ""}
                onChange={(event) => updateNode((node) => {
                  if (!event.target.value) {
                    delete node.asset;
                    return;
                  }
                  node.asset = {
                    assetId: event.target.value,
                    fit: "contain",
                    focalPoint: { x: 0.5, y: 0.5 },
                    decorative: false,
                  };
                }, event.target.value ? `Bound asset ${event.target.value}.` : "Cleared the content asset.")}
                className="select-control text-[11px] font-normal disabled:cursor-not-allowed disabled:opacity-45"
              >
                <option value="">None</option>
                {bindableAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name} · {asset.kind}</option>)}
              </select>
            </label>
            {boundAsset && selectedNode.asset ? (
              <>
                {boundAssetFile && ["raster", "svg", "icon"].includes(boundAsset.kind) ? (
                  <div className="relative h-32 overflow-hidden rounded-lg border border-[var(--line)] bg-[repeating-conic-gradient(var(--canvas)_0_25%,var(--field)_0_50%)_50%/12px_12px]" data-testid="asset-crop-preview">
                    <img
                      src={`/api/project/assets/${boundAssetFile.digest}`}
                      alt=""
                      className="size-full"
                      style={{
                        objectFit: selectedNode.asset.fit,
                        objectPosition: `${Math.round(selectedNode.asset.focalPoint.x * 100)}% ${Math.round(selectedNode.asset.focalPoint.y * 100)}%`,
                      }}
                    />
                    {selectedNode.asset.fit === "cover" ? <span className="pointer-events-none absolute left-2 top-2 rounded bg-black/70 px-1.5 py-1 text-[8px] font-semibold uppercase tracking-[.08em] text-white">Crop preview</span> : null}
                  </div>
                ) : null}
                <div className="rounded-lg border border-[var(--line)] bg-[var(--field)] p-2.5 text-[10px] leading-relaxed text-[var(--muted)]">
                  <span className="block font-mono text-[9px] text-[var(--faint)]">{boundAsset.digest.slice(0, 16)}…</span>
                  <span className="mt-1 block">{boundAsset.license.name} · export {boundAsset.exportPolicy}</span>
                </div>
                {boundAsset.variants.length > 0 ? (
                  <label className="grid gap-1.5 text-[11px] font-medium text-[var(--muted)]">Variant
                    <select disabled={Boolean(componentContext)} value={selectedNode.asset.variantId ?? ""} onChange={(event) => updateNode((node) => {
                      if (!node.asset) return;
                      if (event.target.value) node.asset.variantId = event.target.value;
                      else delete node.asset.variantId;
                    }, "Changed the asset variant.")} className="select-control text-[11px] font-normal">
                      <option value="">Default</option>
                      {boundAsset.variants.map((variant) => <option key={variant.id} value={variant.id}>{variant.label}</option>)}
                    </select>
                  </label>
                ) : null}
                <SegmentedControl disabled={Boolean(componentContext)} label="Image sizing" value={selectedNode.asset.fit} options={[{ value: "contain", label: "Fit" }, { value: "cover", label: "Crop" }, { value: "fill", label: "Stretch" }, { value: "none", label: "Original" }]} onChange={(value) => updateNode((node) => { if (node.asset) node.asset.fit = value; }, `Changed asset fit to ${value}.`)} />
                {selectedNode.asset.fit === "cover" ? (
                  <div className="grid gap-2 rounded-lg border border-[var(--line)] bg-[var(--field)] p-2.5">
                    <label className="grid gap-1 text-[10px] font-medium text-[var(--muted)]">Horizontal focal point
                      <input type="range" min={0} max={1} step={0.01} value={selectedNode.asset.focalPoint.x} disabled={Boolean(componentContext)} onChange={(event) => updateNode((node) => { if (node.asset) node.asset.focalPoint.x = Number(event.target.value); }, "Adjusted asset crop focal point.")} className="w-full accent-[var(--accent)]" />
                    </label>
                    <label className="grid gap-1 text-[10px] font-medium text-[var(--muted)]">Vertical focal point
                      <input type="range" min={0} max={1} step={0.01} value={selectedNode.asset.focalPoint.y} disabled={Boolean(componentContext)} onChange={(event) => updateNode((node) => { if (node.asset) node.asset.focalPoint.y = Number(event.target.value); }, "Adjusted asset crop focal point.")} className="w-full accent-[var(--accent)]" />
                    </label>
                  </div>
                ) : null}
                <div className="grid grid-cols-2 gap-2">
                  <NumberField disabled={Boolean(componentContext)} label="Focal X" value={selectedNode.asset.focalPoint.x} min={0} max={1} step={0.05} onCommit={(value) => { if (value !== undefined) updateNode((node) => { if (node.asset) node.asset.focalPoint.x = value; }, "Changed asset focal X."); }} />
                  <NumberField disabled={Boolean(componentContext)} label="Focal Y" value={selectedNode.asset.focalPoint.y} min={0} max={1} step={0.05} onCommit={(value) => { if (value !== undefined) updateNode((node) => { if (node.asset) node.asset.focalPoint.y = value; }, "Changed asset focal Y."); }} />
                </div>
                <label className="flex min-h-8 items-center justify-between rounded-lg border border-[var(--line)] bg-[var(--field)] px-2.5 text-[11px] font-medium text-[var(--muted)]">Decorative
                  <input type="checkbox" checked={selectedNode.asset.decorative} disabled={Boolean(componentContext)} onChange={(event) => updateNode((node) => { if (node.asset) node.asset.decorative = event.target.checked; }, "Changed asset accessibility semantics.")} className="size-4 accent-[var(--accent)]" />
                </label>
              </>
            ) : bindableAssets.length === 0 ? <p className="text-[10px] leading-relaxed text-[var(--faint)]">Import a project-owned or licensed local asset before binding content.</p> : null}
          </Section>

          <Section title="Content">
            <TextField
              label="Label"
              value={selectedNode.intent.label ?? ""}
              onCommit={(next) => {
                if (next && next !== selectedNode.intent.label) {
                  if (componentContext) onSetComponentOverride({ op: "set-label", target: componentContext.targetId, value: next });
                  else updateNode((node) => { node.intent.label = next; node.accessibility.label = next; }, "Updated visible and accessible label.");
                }
              }}
            />
            <TextField
              label="Purpose"
              value={selectedNode.intent.purpose}
              multiline
              onCommit={(next) => {
                if (next.length >= 3 && next !== selectedNode.intent.purpose) {
                  if (componentContext) onSetComponentOverride({ op: "set-purpose", target: componentContext.targetId, value: next });
                  else updateNode((node) => { node.intent.purpose = next; }, "Refined the node's intent purpose.");
                }
              }}
            />
            {!componentContext ? <TextField
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
            /> : null}
            <SegmentedControl
              label="Importance"
              value={selectedNode.intent.importance}
              options={[{ value: "primary", label: "Primary" }, { value: "secondary", label: "Secondary" }, { value: "supporting", label: "Support" }]}
              onChange={(value) => componentContext
                ? onSetComponentOverride({ op: "set-importance", target: componentContext.targetId, value })
                : updateNode((node) => { node.intent.importance = value; }, `Marked the node as ${value}.`)}
            />
          </Section>

          <Section title="Layout">
            {componentContext ? <p className="rounded-lg bg-[var(--accent-soft)] p-2.5 text-[10px] leading-relaxed text-[var(--accent-text)]">Attached instances own outer sizing and position. Gap and padding become explicit instance overrides; structural layout stays with the definition.</p> : null}
            <SegmentedControl disabled={Boolean(componentContext)} label="Axis" value={selectedNode.layout.axis} options={[{ value: "vertical", label: "Vertical" }, { value: "horizontal", label: "Horizontal" }, { value: "overlay", label: "Overlay" }]} onChange={(value) => updateNode((node) => { node.layout.axis = value; }, `Changed layout axis to ${value}.`)} />
            <SegmentedControl disabled={componentNested} label="Width" value={selectedNode.layout.width} options={[{ value: "hug", label: "Hug" }, { value: "fill", label: "Fill" }, { value: "fixed", label: "Fixed" }]} onChange={(value) => updateNode((node) => { node.layout.width = value; }, `Changed semantic width to ${value}.`)} />
            <SegmentedControl disabled={componentNested} label="Height" value={selectedNode.layout.height} options={[{ value: "hug", label: "Hug" }, { value: "fill", label: "Fill" }, { value: "fixed", label: "Fixed" }]} onChange={(value) => updateNode((node) => { node.layout.height = value; }, `Changed semantic height to ${value}.`)} />
            {selectedNode.layout.width === "fixed" || selectedNode.layout.height === "fixed" ? (
              <div className="grid grid-cols-2 gap-2">
                {selectedNode.layout.width === "fixed" ? <NumberField disabled={componentNested} label="Fixed width" value={selectedNode.layout.fixedWidth} min={1} onCommit={(value) => updateNode((node) => { if (value === undefined) delete node.layout.fixedWidth; else node.layout.fixedWidth = value; }, "Updated the fixed width constraint.")} /> : <span />}
                {selectedNode.layout.height === "fixed" ? <NumberField disabled={componentNested} label="Fixed height" value={selectedNode.layout.fixedHeight} min={1} onCommit={(value) => updateNode((node) => { if (value === undefined) delete node.layout.fixedHeight; else node.layout.fixedHeight = value; }, "Updated the fixed height constraint.")} /> : null}
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-2">
              <NumberField disabled={componentNested} label="Min width" value={selectedNode.layout.minWidth} onCommit={(value) => updateNode((node) => { if (value === undefined) delete node.layout.minWidth; else node.layout.minWidth = value; }, "Updated the minimum width.")} />
              <NumberField disabled={componentNested} label="Max width" value={selectedNode.layout.maxWidth} onCommit={(value) => updateNode((node) => { if (value === undefined) delete node.layout.maxWidth; else node.layout.maxWidth = value; }, "Updated the maximum width.")} />
              <NumberField disabled={componentNested} label="Min height" value={selectedNode.layout.minHeight} onCommit={(value) => updateNode((node) => { if (value === undefined) delete node.layout.minHeight; else node.layout.minHeight = value; }, "Updated the minimum height.")} />
              <NumberField disabled={componentNested} label="Max height" value={selectedNode.layout.maxHeight} onCommit={(value) => updateNode((node) => { if (value === undefined) delete node.layout.maxHeight; else node.layout.maxHeight = value; }, "Updated the maximum height.")} />
            </div>
            {selectedNode.layout.position ? (
              <div className="grid grid-cols-3 gap-2" data-testid="freeform-position-controls">
                {(["x", "y", "z"] as const).map((field) => (
                  <NumberField
                    key={field}
                    label={`Position ${field.toUpperCase()}`}
                    value={selectedNode.layout.position?.[field]}
                    disabled={componentNested}
                    min={-2_048}
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
            <SegmentedControl disabled={Boolean(componentContext)} label="Align" value={selectedNode.layout.align} options={[{ value: "start", label: "Start" }, { value: "center", label: "Center" }, { value: "end", label: "End" }, { value: "stretch", label: "Stretch" }, { value: "baseline", label: "Baseline" }]} onChange={(value) => updateNode((node) => { node.layout.align = value; }, `Changed cross-axis alignment to ${value}.`)} />
            <SegmentedControl disabled={Boolean(componentContext)} label="Justify" value={selectedNode.layout.justify} options={[{ value: "start", label: "Start" }, { value: "center", label: "Center" }, { value: "end", label: "End" }, { value: "space-between", label: "Between" }]} onChange={(value) => updateNode((node) => { node.layout.justify = value; }, `Changed main-axis justification to ${value}.`)} />
            <SegmentedControl disabled={Boolean(componentContext)} label="Overflow" value={selectedNode.layout.overflow} options={[{ value: "visible", label: "Visible" }, { value: "clip", label: "Clip" }, { value: "scroll", label: "Scroll" }]} onChange={(value) => updateNode((node) => { node.layout.overflow = value; }, `Changed overflow behavior to ${value}.`)} />
            <SearchablePicker label="Gap token" token value={selectedNode.layout.gapToken} options={Object.entries(resolvedTokens.spacing).map(([token, resolved]) => ({ value: token, resolved }))} onChange={(value) => componentContext ? onSetComponentOverride({ op: "set-gap-token", target: componentContext.targetId, value }) : updateNode((node) => { node.layout.gapToken = value; }, `Bound gap to ${value}.`)} />
            {!componentContext ? <div className="grid grid-cols-3 gap-2">
              <NumberField label="Gap" value={selectedNode.layout.gap} min={0} max={512} onCommit={(value) => updateNode((node) => { if (value === undefined) delete node.layout.gap; else node.layout.gap = value; }, "Updated the direct gap override.")} />
              <NumberField label="Grow" value={selectedNode.layout.flexGrow} min={0} max={100} onCommit={(value) => updateNode((node) => { if (value === undefined) delete node.layout.flexGrow; else node.layout.flexGrow = value; }, "Updated flex grow.")} />
              <NumberField label="Shrink" value={selectedNode.layout.flexShrink} min={0} max={100} onCommit={(value) => updateNode((node) => { if (value === undefined) delete node.layout.flexShrink; else node.layout.flexShrink = value; }, "Updated flex shrink.")} />
              <NumberField label="Basis" value={selectedNode.layout.flexBasis} min={0} max={8_192} onCommit={(value) => updateNode((node) => { if (value === undefined) delete node.layout.flexBasis; else node.layout.flexBasis = value; }, "Updated flex basis.")} />
            </div> : null}
            <SearchablePicker label="Padding token" token value={selectedNode.layout.paddingToken} options={Object.entries(resolvedTokens.spacing).map(([token, resolved]) => ({ value: token, resolved }))} onChange={(value) => componentContext ? onSetComponentOverride({ op: "set-padding-token", target: componentContext.targetId, value }) : updateNode((node) => { node.layout.paddingToken = value; }, `Bound padding to ${value}.`)} />
            {!componentContext ? <div className="grid grid-cols-2 gap-2" data-testid="padding-side-controls">
              {(["top", "right", "bottom", "left"] as const).map((side) => <SearchablePicker key={side} label={`Padding ${side}`} token value={selectedNode.layout.paddingTokens?.[side] ?? selectedNode.layout.paddingToken} options={Object.entries(resolvedTokens.spacing).map(([token, resolved]) => ({ value: token, resolved }))} onChange={(value) => updateNode((node) => {
                node.layout.paddingTokens ??= { top: node.layout.paddingToken, right: node.layout.paddingToken, bottom: node.layout.paddingToken, left: node.layout.paddingToken };
                node.layout.paddingTokens[side] = value;
              }, `Bound ${side} padding to ${value}.`)} />)}
            </div> : null}
            {isContainerNode(selectedNode) ? (
              <div className="grid grid-cols-2 gap-2">
                <NumberField disabled={Boolean(componentContext)} label="Columns" value={selectedNode.layout.columns} min={1} max={12} onCommit={(value) => { if (value !== undefined) updateNode((node) => { node.layout.columns = Math.round(value); }, `Set the container to ${Math.round(value)} columns.`); }} />
                <NumberField disabled={Boolean(componentContext)} label="Split ratio" value={selectedNode.layout.splitRatio} min={0.1} max={0.9} step={0.05} onCommit={(value) => { if (value !== undefined) updateNode((node) => { node.layout.splitRatio = value; }, `Set the split ratio to ${value}.`); }} />
              </div>
            ) : null}
            {!componentContext ? <div className="grid grid-cols-2 gap-2" data-testid="grid-placement-controls">
              <NumberField label="Grid column" value={selectedNode.layout.gridColumn?.start} min={1} max={12} onCommit={(value) => updateNode((node) => { if (value === undefined) delete node.layout.gridColumn; else node.layout.gridColumn = { start: Math.round(value), span: node.layout.gridColumn?.span ?? 1 }; }, "Updated grid column placement.")} />
              <NumberField label="Column span" value={selectedNode.layout.gridColumn?.span} min={1} max={12} onCommit={(value) => { if (value !== undefined) updateNode((node) => { node.layout.gridColumn = { start: node.layout.gridColumn?.start ?? 1, span: Math.round(value) }; }, "Updated grid column span."); }} />
              <NumberField label="Grid row" value={selectedNode.layout.gridRow?.start} min={1} max={100} onCommit={(value) => updateNode((node) => { if (value === undefined) delete node.layout.gridRow; else node.layout.gridRow = { start: Math.round(value), span: node.layout.gridRow?.span ?? 1 }; }, "Updated grid row placement.")} />
              <NumberField label="Row span" value={selectedNode.layout.gridRow?.span} min={1} max={100} onCommit={(value) => { if (value !== undefined) updateNode((node) => { node.layout.gridRow = { start: node.layout.gridRow?.start ?? 1, span: Math.round(value) }; }, "Updated grid row span."); }} />
            </div> : null}
            {selectedNode.kind === "adaptive" && selectedNode.layout.adaptive ? (
              <div className="grid grid-cols-2 gap-2">
                {(["compact", "regular"] as const).map((deviceClass) => (
                  <label key={deviceClass} className="grid gap-1.5 text-[11px] font-medium capitalize text-[var(--muted)]">
                    {deviceClass} mode
                    <select disabled={Boolean(componentContext)} value={selectedNode.layout.adaptive![deviceClass]} onChange={(event) => updateNode((node) => { if (node.layout.adaptive) node.layout.adaptive[deviceClass] = event.target.value as typeof adaptiveModes[number]; }, `Changed the ${deviceClass} adaptive mode.`)} className="select-control text-[11px] font-normal disabled:cursor-not-allowed disabled:opacity-45">
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

          {graph.expo ? (
            <Section title="Expo Adaptive">
              <p className="text-[10px] leading-relaxed text-[var(--faint)]">Choose a universal React Native renderer, an IntentForm-owned platform file adapter, or a project-owned component boundary.</p>
              <label className="grid gap-1.5 text-[11px] font-medium text-[var(--muted)]">
                Render strategy
                <select
                  disabled={Boolean(componentContext)}
                  value={selectedNode.expo?.strategy ?? graph.expo.defaultRenderStrategy}
                  onChange={(event) => updateNode((node) => {
                    const strategy = event.target.value;
                    node.expo = strategy === "platform-native"
                      ? { strategy, adapter: `intent.${node.kind}` }
                      : strategy === "project-component"
                        ? { strategy, componentId: `project.${node.kind}` }
                        : { strategy: "universal-react-native" };
                  }, `Changed Expo rendering to ${event.target.value}.`)}
                  className="select-control text-[11px] font-normal disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <option value="universal-react-native">Universal React Native</option>
                  <option value="platform-native">Platform-native adapter</option>
                  <option value="project-component">Project component</option>
                </select>
              </label>
              {selectedNode.expo?.strategy === "platform-native" ? (
                <TextField label="Adapter ID" value={selectedNode.expo.adapter} onCommit={(value) => {
                  if (value) updateNode((node) => { node.expo = { strategy: "platform-native", adapter: value }; }, `Bound Expo adapter ${value}.`);
                }} />
              ) : null}
              {selectedNode.expo?.strategy === "project-component" ? (
                <TextField label="Project component ID" value={selectedNode.expo.componentId} onCommit={(value) => {
                  if (value) updateNode((node) => { node.expo = { strategy: "project-component", componentId: value }; }, `Bound project component ${value}.`);
                }} />
              ) : null}
            </Section>
          ) : null}

          {graph.web ? (
            <Section title="Responsive web">
              <p className="text-[10px] leading-relaxed text-[var(--faint)]">Typed CSS behavior compiles into owned route and stylesheet files. Breakpoints come from the project profile.</p>
              <SegmentedControl disabled={Boolean(componentContext)} label="Display" value={selectedNode.web?.display ?? (isContainerNode(selectedNode) ? selectedNode.kind === "grid" ? "grid" : "flex" : "block")} options={[{ value: "block", label: "Block" }, { value: "flex", label: "Flex" }, { value: "grid", label: "Grid" }]} onChange={(value) => updateWeb((web) => {
                web.display = value;
                if (value !== "grid") { web.gridMinColumnWidth = 240; web.gridMaxColumns = 4; }
              }, `Changed responsive-web display to ${value}.`)} />
              {(selectedNode.web?.display ?? (isContainerNode(selectedNode) ? "flex" : "block")) === "flex" ? <>
                <SegmentedControl disabled={Boolean(componentContext)} label="Direction" value={selectedNode.web?.direction ?? (selectedNode.layout.axis === "horizontal" ? "row" : "column")} options={[{ value: "row", label: "Row" }, { value: "column", label: "Column" }]} onChange={(value) => updateWeb((web) => { web.direction = value; }, `Changed responsive-web direction to ${value}.`)} />
                <SegmentedControl disabled={Boolean(componentContext)} label="Wrap" value={selectedNode.web?.wrap ?? "nowrap"} options={[{ value: "nowrap", label: "No wrap" }, { value: "wrap", label: "Wrap" }]} onChange={(value) => updateWeb((web) => { web.wrap = value; }, `Changed responsive-web wrapping to ${value}.`)} />
              </> : null}
              {(selectedNode.web?.display ?? (selectedNode.kind === "grid" ? "grid" : "block")) === "grid" ? <div className="grid grid-cols-2 gap-2">
                <NumberField disabled={Boolean(componentContext)} label="Min column" value={selectedNode.web?.gridMinColumnWidth ?? 240} min={80} max={1600} onCommit={(value) => { if (value !== undefined) updateWeb((web) => { web.display = "grid"; web.gridMinColumnWidth = Math.round(value); }, "Updated the intrinsic grid minimum."); }} />
                <NumberField disabled={Boolean(componentContext)} label="Max columns" value={selectedNode.web?.gridMaxColumns ?? selectedNode.layout.columns} min={1} max={12} onCommit={(value) => { if (value !== undefined) updateWeb((web) => { web.display = "grid"; web.gridMaxColumns = Math.round(value); }, "Updated the intrinsic grid maximum."); }} />
              </div> : null}
              <SegmentedControl disabled={Boolean(componentContext)} label="Position" value={selectedNode.web?.position ?? "static"} options={[{ value: "static", label: "Static" }, { value: "relative", label: "Relative" }, { value: "sticky", label: "Sticky" }, { value: "fixed", label: "Fixed" }]} onChange={(value) => updateWeb((web) => {
                web.position = value;
                if (value !== "sticky" && value !== "fixed") delete web.insetBlockStart;
              }, `Changed responsive-web position to ${value}.`)} />
              {selectedNode.web?.position === "sticky" || selectedNode.web?.position === "fixed" ? <NumberField disabled={Boolean(componentContext)} label="Block inset" value={selectedNode.web.insetBlockStart} min={-2000} max={2000} onCommit={(value) => updateWeb((web) => { if (value === undefined) delete web.insetBlockStart; else web.insetBlockStart = value; }, "Updated responsive-web block inset.")} /> : null}
              <div className="grid grid-cols-2 gap-2">
                <label className="grid gap-1.5 text-[11px] font-medium text-[var(--muted)]">Overflow X<select disabled={Boolean(componentContext)} value={selectedNode.web?.overflowX ?? "visible"} onChange={(event) => updateWeb((web) => { web.overflowX = event.target.value as NonNullable<SemanticNode["web"]>["overflowX"]; }, "Changed responsive-web horizontal overflow.")} className="select-control text-[11px] font-normal">{["visible", "clip", "hidden", "auto", "scroll"].map((value) => <option key={value}>{value}</option>)}</select></label>
                <label className="grid gap-1.5 text-[11px] font-medium text-[var(--muted)]">Overflow Y<select disabled={Boolean(componentContext)} value={selectedNode.web?.overflowY ?? "visible"} onChange={(event) => updateWeb((web) => { web.overflowY = event.target.value as NonNullable<SemanticNode["web"]>["overflowY"]; }, "Changed responsive-web vertical overflow.")} className="select-control text-[11px] font-normal">{["visible", "clip", "hidden", "auto", "scroll"].map((value) => <option key={value}>{value}</option>)}</select></label>
              </div>
              <NumberField disabled={Boolean(componentContext)} label="Aspect ratio" value={selectedNode.web?.aspectRatio} min={0.1} max={10} step={0.1} onCommit={(value) => updateWeb((web) => { if (value === undefined) delete web.aspectRatio; else web.aspectRatio = value; }, "Updated responsive-web aspect ratio.")} />
              <label className="flex min-h-8 items-center justify-between rounded-lg border border-[var(--line)] bg-[var(--field)] px-2.5 text-[11px] font-medium text-[var(--muted)]">Container queries
                <input type="checkbox" checked={selectedNode.web?.containerType === "inline-size"} disabled={Boolean(componentContext)} onChange={(event) => updateWeb((web) => { web.containerType = event.target.checked ? "inline-size" : "normal"; }, "Changed responsive-web container-query boundary.")} className="size-4 accent-[var(--accent)]" />
              </label>
              <div className="grid gap-2" data-testid="web-breakpoint-overrides">
                {graph.web.breakpoints.map((breakpoint) => <label key={breakpoint.id} className="grid grid-cols-[minmax(0,1fr)_100px] items-center gap-2 text-[10px] text-[var(--muted)]"><span className="truncate">{breakpoint.label} · {breakpoint.minWidth}px{breakpoint.maxWidth ? `–${breakpoint.maxWidth}px` : "+"}</span><select disabled={Boolean(componentContext)} value={selectedNode.web?.breakpointOverrides[breakpoint.id]?.display ?? ""} onChange={(event) => updateWeb((web) => {
                  const display = event.target.value as "block" | "flex" | "grid" | "";
                  if (!display) delete web.breakpointOverrides[breakpoint.id];
                  else web.breakpointOverrides[breakpoint.id] = { ...(web.breakpointOverrides[breakpoint.id] ?? {}), display };
                }, `Updated the ${breakpoint.label} web override.`)} className="select-control text-[10px] font-normal"><option value="">Inherit</option><option value="block">Block</option><option value="flex">Flex</option><option value="grid">Grid</option></select></label>)}
              </div>
            </Section>
          ) : null}

          {!componentContext && contractStates.length > 0 ? (
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

          {!componentContext && isAction && contract && contract.events.length > 0 ? (
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
            <SegmentedControl label="Emphasis" value={selectedNode.style.emphasis} options={[{ value: "quiet", label: "Quiet" }, { value: "normal", label: "Normal" }, { value: "strong", label: "Strong" }]} onChange={(value) => componentContext ? onSetComponentOverride({ op: "set-emphasis", target: componentContext.targetId, value }) : updateNode((node) => { node.style.emphasis = value; }, `Changed semantic emphasis to ${value}.`)} />
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
