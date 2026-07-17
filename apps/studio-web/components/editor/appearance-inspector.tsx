"use client";

import { Eye, EyeSlash, LinkSimple, Plus, Trash } from "@phosphor-icons/react";
import { resolveTokenMode, type SemanticInterfaceGraph, type SemanticNode } from "@intentform/semantic-schema";
import { CompositionSafeField, DisclosureSection, NumericScrubField, PropertyRow, SearchablePicker } from "../ui/editor-controls";
import { replaceSelectionColor, selectionColors, setSelectionColorOpacity } from "./appearance";

type Appearance = NonNullable<SemanticNode["style"]["appearance"]>;

const selectClass = "h-7 w-full rounded-[5px] border border-[var(--if-border)] bg-[var(--if-input)] px-2 text-[11px] text-[var(--if-text)] outline-none hover:border-[var(--if-border-strong)] focus:border-[var(--if-blue)]";
const iconButton = "grid size-7 shrink-0 place-items-center rounded-[5px] text-[var(--if-text-secondary)] hover:bg-[var(--if-hover)] hover:text-[var(--if-text)] disabled:opacity-35";

function ensureAppearance(node: SemanticNode): Appearance {
  node.style.appearance ??= { fills: [], effects: [], opacity: 1, blendMode: "normal" };
  return node.style.appearance;
}

function shared<T>(nodes: readonly SemanticNode[], read: (node: SemanticNode) => T): { value: T | undefined; mixed: boolean } {
  if (nodes.length === 0) return { value: undefined, mixed: false };
  const first = read(nodes[0]!);
  const mixed = nodes.slice(1).some((node) => JSON.stringify(read(node)) !== JSON.stringify(first));
  return { value: mixed ? undefined : first, mixed };
}

function CompactSelect<const T extends string>({ label, value, mixed, options, onChange }: { label: string; value: T | undefined; mixed: boolean; options: readonly T[]; onChange(value: T): void }) {
  return <PropertyRow label={label}><select aria-label={label} value={value ?? ""} onChange={(event) => onChange(event.target.value as T)} className={selectClass}>{mixed ? <option value="" disabled>Mixed</option> : null}{options.map((option) => <option key={option} value={option}>{option.replaceAll("-", " ")}</option>)}</select></PropertyRow>;
}

function nextLayerId(prefix: string, used: readonly string[]): string {
  for (let index = 1; index < 100; index += 1) {
    const candidate = `${prefix}-${index}`;
    if (!used.includes(candidate)) return candidate;
  }
  return `${prefix}-99`;
}

export function AppearanceInspector({ graph, nodes, onUpdate }: { graph: SemanticInterfaceGraph; nodes: readonly SemanticNode[]; onUpdate(mutate: (node: SemanticNode) => void, notice: string): void }) {
  const primary = nodes[0];
  if (!primary) return null;
  const tokens = resolveTokenMode(graph.tokens);
  const appearance = primary.style.appearance;
  const colors = selectionColors(nodes, graph);
  const positionX = shared(nodes, (node) => node.layout.position?.x);
  const positionY = shared(nodes, (node) => node.layout.position?.y);
  const width = shared(nodes, (node) => node.layout.width === "fixed" ? node.layout.fixedWidth : undefined);
  const height = shared(nodes, (node) => node.layout.height === "fixed" ? node.layout.fixedHeight : undefined);
  const rotation = shared(nodes, (node) => node.layout.rotation ?? 0);
  const horizontalConstraint = shared(nodes, (node) => node.layout.constraints?.horizontal ?? "left");
  const verticalConstraint = shared(nodes, (node) => node.layout.constraints?.vertical ?? "top");
  const typography = appearance?.typography;
  const typographyValue = <Key extends keyof NonNullable<Appearance["typography"]>>(key: Key) => shared(nodes, (node) => node.style.appearance?.typography?.[key]);
  const opacity = shared(nodes, (node) => node.style.appearance?.opacity ?? 1);
  const blend = shared(nodes, (node) => node.style.appearance?.blendMode ?? "normal");
  const tokenOptions = (values: Record<string, string | number>) => Object.entries(values).map(([value, resolved]) => ({ value, resolved }));
  const updateTypography = (mutate: (value: NonNullable<Appearance["typography"]>) => void, notice: string) => onUpdate((node) => {
    const target = ensureAppearance(node);
    target.typography ??= { style: "normal", align: "start", transform: "none", wrapping: "wrap", truncation: "none", features: [] };
    mutate(target.typography);
  }, notice);

  return <>
    <DisclosureSection title="Position and size">
      <NumericScrubField label="X" value={positionX.value} mixed={positionX.mixed} onCommit={(value) => onUpdate((node) => { node.layout.position = { x: value ?? 0, y: node.layout.position?.y ?? 0, z: node.layout.position?.z ?? 0 }; }, "Updated the horizontal position.")} />
      <NumericScrubField label="Y" value={positionY.value} mixed={positionY.mixed} onCommit={(value) => onUpdate((node) => { node.layout.position = { x: node.layout.position?.x ?? 0, y: value ?? 0, z: node.layout.position?.z ?? 0 }; }, "Updated the vertical position.")} />
      <NumericScrubField label="Width" value={width.value} mixed={width.mixed} min={1} max={10_000} onCommit={(value) => onUpdate((node) => { if (value === undefined) { node.layout.width = "hug"; delete node.layout.fixedWidth; } else { node.layout.width = "fixed"; node.layout.fixedWidth = value; } }, "Updated the selection width.")} />
      <NumericScrubField label="Height" value={height.value} mixed={height.mixed} min={1} max={10_000} onCommit={(value) => onUpdate((node) => { if (value === undefined) { node.layout.height = "hug"; delete node.layout.fixedHeight; } else { node.layout.height = "fixed"; node.layout.fixedHeight = value; } }, "Updated the selection height.")} />
      <NumericScrubField label="Rotation" value={rotation.value} mixed={rotation.mixed} min={-360} max={360} onCommit={(value) => onUpdate((node) => { if (!value) delete node.layout.rotation; else node.layout.rotation = value; }, "Updated the selection rotation.")} />
      <CompactSelect label="Horizontal" value={horizontalConstraint.value} mixed={horizontalConstraint.mixed} options={["left", "center", "right", "stretch"]} onChange={(value) => onUpdate((node) => { node.layout.constraints = { horizontal: value, vertical: node.layout.constraints?.vertical ?? "top", fixedOnScroll: node.layout.constraints?.fixedOnScroll ?? false }; }, "Updated horizontal constraints.")} />
      <CompactSelect label="Vertical" value={verticalConstraint.value} mixed={verticalConstraint.mixed} options={["top", "middle", "bottom", "stretch"]} onChange={(value) => onUpdate((node) => { node.layout.constraints = { horizontal: node.layout.constraints?.horizontal ?? "left", vertical: value, fixedOnScroll: node.layout.constraints?.fixedOnScroll ?? false }; }, "Updated vertical constraints.")} />
    </DisclosureSection>

    <DisclosureSection title="Typography" defaultOpen={primary.kind === "text"}>
      <CompositionSafeField label="Family" value={typographyValue("family").value as string ?? ""} mixed={typographyValue("family").mixed} placeholder="System UI" onCommit={(value) => updateTypography((target) => { if (value) target.family = value; else delete target.family; delete target.familyToken; }, "Updated the font family.")} />
      <SearchablePicker label="Family token" value={typography?.familyToken ?? ""} options={tokenOptions(tokens.fontFamilies)} allowDetach token onChange={(value) => updateTypography((target) => { if (value) target.familyToken = value; else delete target.familyToken; delete target.family; }, "Updated the font-family token binding.")} />
      <NumericScrubField label="Weight" value={typographyValue("weight").value as number | undefined} mixed={typographyValue("weight").mixed} min={1} max={1_000} onCommit={(value) => updateTypography((target) => { if (value === undefined) delete target.weight; else target.weight = Math.round(value); delete target.weightToken; }, "Updated font weight.")} />
      <NumericScrubField label="Size" value={typographyValue("size").value as number | undefined} mixed={typographyValue("size").mixed} min={1} max={1_000} onCommit={(value) => updateTypography((target) => { if (value === undefined) delete target.size; else target.size = value; delete target.sizeToken; }, "Updated font size.")} />
      <NumericScrubField label="Line height" value={typographyValue("lineHeight").value as number | undefined} mixed={typographyValue("lineHeight").mixed} min={1} max={2_000} onCommit={(value) => updateTypography((target) => { if (value === undefined) delete target.lineHeight; else target.lineHeight = value; delete target.lineHeightToken; }, "Updated line height.")} />
      <NumericScrubField label="Tracking" value={typographyValue("letterSpacing").value as number | undefined} mixed={typographyValue("letterSpacing").mixed} min={-100} max={1_000} step={0.1} onCommit={(value) => updateTypography((target) => { if (value === undefined) delete target.letterSpacing; else target.letterSpacing = value; delete target.letterSpacingToken; }, "Updated letter spacing.")} />
      <CompactSelect label="Align" value={typographyValue("align").value as NonNullable<Appearance["typography"]>["align"] | undefined} mixed={typographyValue("align").mixed} options={["start", "center", "end", "justify"]} onChange={(value) => updateTypography((target) => { target.align = value; }, "Updated text alignment.")} />
      <CompactSelect label="Case" value={typographyValue("transform").value as NonNullable<Appearance["typography"]>["transform"] | undefined} mixed={typographyValue("transform").mixed} options={["none", "uppercase", "lowercase", "capitalize"]} onChange={(value) => updateTypography((target) => { target.transform = value; }, "Updated text case.")} />
      <CompactSelect label="Wrapping" value={typographyValue("wrapping").value as NonNullable<Appearance["typography"]>["wrapping"] | undefined} mixed={typographyValue("wrapping").mixed} options={["wrap", "nowrap", "balance"]} onChange={(value) => updateTypography((target) => { target.wrapping = value; }, "Updated text wrapping.")} />
      <CompactSelect label="Truncation" value={typographyValue("truncation").value as NonNullable<Appearance["typography"]>["truncation"] | undefined} mixed={typographyValue("truncation").mixed} options={["none", "clip", "ellipsis"]} onChange={(value) => updateTypography((target) => { target.truncation = value; }, "Updated text truncation.")} />
      <CompositionSafeField label="OpenType" value={typography?.features.join(", ") ?? ""} placeholder="liga, kern" onCommit={(value) => updateTypography((target) => { target.features = value.split(",").map((item) => item.trim()).filter((item) => /^[a-z0-9]{4}$/i.test(item)).slice(0, 32); }, "Updated OpenType features.")} />
    </DisclosureSection>

    <DisclosureSection title="Fill">
      {(appearance?.fills ?? []).map((fill, index) => <div key={fill.id} className="grid gap-1.5 rounded-[6px] border border-[var(--if-border-subtle)] p-2">
        <div className="flex items-center gap-1.5"><button type="button" aria-label={fill.visible ? "Hide fill" : "Show fill"} onClick={() => onUpdate((node) => { const target = ensureAppearance(node).fills[index]; if (target) target.visible = !fill.visible; }, "Updated fill visibility.")} className={iconButton}>{fill.visible ? <Eye size={12} /> : <EyeSlash size={12} />}</button><span className="min-w-0 flex-1 truncate text-[10px] font-medium uppercase tracking-[.06em] text-[var(--if-text-secondary)]">{fill.type.replace("-", " ")}</span><button type="button" aria-label="Remove fill" onClick={() => onUpdate((node) => { ensureAppearance(node).fills.splice(index, 1); }, "Removed a fill.")} className={iconButton}><Trash size={12} /></button></div>
        {fill.type === "solid" ? <>
          <CompositionSafeField label="Color" value={fill.color.color ?? ""} placeholder="#4f8ff7" onCommit={(value) => onUpdate((node) => { const target = ensureAppearance(node).fills[index]; if (target?.type === "solid") { target.color = value ? { color: value } : { token: Object.keys(tokens.colors)[0] ?? "color.accent" }; } }, "Updated fill color.")} />
          <SearchablePicker label="Color token" value={fill.color.token ?? ""} options={tokenOptions(tokens.colors)} allowDetach token onChange={(value) => onUpdate((node) => { const target = ensureAppearance(node).fills[index]; if (target?.type === "solid") target.color = value ? { token: value } : { color: fill.color.color ?? "#4f8ff7" }; }, "Updated fill token binding.")} />
          <NumericScrubField label="Opacity" value={fill.opacity} min={0} max={1} step={0.01} onCommit={(value) => onUpdate((node) => { const target = ensureAppearance(node).fills[index]; if (target) target.opacity = value ?? 1; }, "Updated fill opacity.")} />
        </> : <>
          <NumericScrubField label="Angle" value={fill.angle} min={-360} max={360} onCommit={(value) => onUpdate((node) => { const target = ensureAppearance(node).fills[index]; if (target?.type === "linear-gradient") target.angle = value ?? 180; }, "Updated gradient angle.")} />
          {fill.stops.map((stop, stopIndex) => <CompositionSafeField key={stopIndex} label={`Stop ${Math.round(stop.position * 100)}%`} value={stop.color.color ?? ""} placeholder="#4f8ff7" onCommit={(value) => onUpdate((node) => { const target = ensureAppearance(node).fills[index]; if (target?.type === "linear-gradient" && target.stops[stopIndex]) target.stops[stopIndex]!.color = value ? { color: value } : stop.color; }, "Updated gradient stop.")} />)}
        </>}
      </div>)}
      <div className="grid grid-cols-2 gap-1.5"><button type="button" onClick={() => onUpdate((node) => { const target = ensureAppearance(node); target.fills.push({ id: nextLayerId("fill", target.fills.map((fill) => fill.id)), type: "solid", visible: true, color: { token: Object.keys(tokens.colors)[0] ?? "color.accent" }, opacity: 1, blendMode: "normal" }); }, "Added a solid fill.")} className="h-7 rounded-[5px] border border-[var(--if-border)] text-[10.5px] hover:bg-[var(--if-hover)]"><Plus size={11} className="mr-1 inline" />Solid</button><button type="button" onClick={() => onUpdate((node) => { const target = ensureAppearance(node); const colorKeys = Object.keys(tokens.colors); target.fills.push({ id: nextLayerId("gradient", target.fills.map((fill) => fill.id)), type: "linear-gradient", visible: true, angle: 180, stops: [{ position: 0, color: { token: colorKeys[0] ?? "color.accent" } }, { position: 1, color: { token: colorKeys[1] ?? colorKeys[0] ?? "color.ink" } }], opacity: 1, blendMode: "normal" }); }, "Added a linear gradient.")} className="h-7 rounded-[5px] border border-[var(--if-border)] text-[10.5px] hover:bg-[var(--if-hover)]"><Plus size={11} className="mr-1 inline" />Gradient</button></div>
    </DisclosureSection>

    <DisclosureSection title="Stroke and corners" defaultOpen={Boolean(appearance?.stroke || appearance?.radius)}>
      {appearance?.stroke ? <>
        <CompositionSafeField label="Stroke" value={appearance.stroke.color.color ?? ""} placeholder="#000000" onCommit={(value) => onUpdate((node) => { const target = ensureAppearance(node); if (target.stroke) target.stroke.color = value ? { color: value } : { token: Object.keys(tokens.colors)[0] ?? "color.ink" }; }, "Updated stroke color.")} />
        <NumericScrubField label="Width" value={appearance.stroke.width} min={0} max={256} onCommit={(value) => onUpdate((node) => { const target = ensureAppearance(node); if (target.stroke) target.stroke.width = value ?? 1; }, "Updated stroke width.")} />
        <CompactSelect label="Alignment" value={appearance.stroke.alignment} mixed={false} options={["inside", "center", "outside"]} onChange={(value) => onUpdate((node) => { const target = ensureAppearance(node); if (target.stroke) target.stroke.alignment = value; }, "Updated stroke alignment.")} />
        <button type="button" onClick={() => onUpdate((node) => { delete ensureAppearance(node).stroke; }, "Removed the stroke.")} className="h-7 rounded-[5px] border border-[var(--if-border)] text-[10.5px] hover:bg-[var(--if-hover)]">Remove stroke</button>
      </> : <button type="button" onClick={() => onUpdate((node) => { ensureAppearance(node).stroke = { visible: true, color: { token: Object.keys(tokens.colors)[0] ?? "color.ink" }, width: 1, style: "solid", alignment: "inside" }; }, "Added a stroke.")} className="h-7 rounded-[5px] border border-[var(--if-border)] text-[10.5px] hover:bg-[var(--if-hover)]"><Plus size={11} className="mr-1 inline" />Add stroke</button>}
      <NumericScrubField label="Radius" value={appearance?.radius?.topLeft} min={0} max={10_000} onCommit={(value) => onUpdate((node) => { const target = ensureAppearance(node); const radius = value ?? 0; target.radius = { linked: true, topLeft: radius, topRight: radius, bottomRight: radius, bottomLeft: radius }; }, "Updated corner radius.")} />
      <SearchablePicker label="Radius token" value={appearance?.radius?.token ?? ""} options={tokenOptions(tokens.radii)} allowDetach token onChange={(value) => onUpdate((node) => { const target = ensureAppearance(node); target.radius ??= { linked: true, topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 }; if (value) target.radius.token = value; else delete target.radius.token; }, "Updated radius token binding.")} />
    </DisclosureSection>

    <DisclosureSection title="Effects and opacity" defaultOpen={Boolean(appearance?.effects.length)}>
      <NumericScrubField label="Opacity" value={opacity.value} mixed={opacity.mixed} min={0} max={1} step={0.01} onCommit={(value) => onUpdate((node) => { ensureAppearance(node).opacity = value ?? 1; }, "Updated layer opacity.")} />
      <CompactSelect label="Blend mode" value={blend.value} mixed={blend.mixed} options={["normal", "multiply", "screen", "overlay", "darken", "lighten"]} onChange={(value) => onUpdate((node) => { ensureAppearance(node).blendMode = value; }, "Updated blend mode.")} />
      {(appearance?.effects ?? []).map((effect, index) => <div key={effect.id} className="flex h-8 items-center gap-2 rounded-[5px] border border-[var(--if-border-subtle)] px-2"><span className="min-w-0 flex-1 truncate text-[10.5px] capitalize">{effect.type.replace("-", " ")}</span>{"radius" in effect ? <span className="font-mono text-[9.5px] text-[var(--if-text-tertiary)]">{effect.radius}px</span> : <span className="font-mono text-[9.5px] text-[var(--if-text-tertiary)]">{effect.blur}px</span>}<button type="button" aria-label="Remove effect" onClick={() => onUpdate((node) => { ensureAppearance(node).effects.splice(index, 1); }, "Removed an effect.")} className={iconButton}><Trash size={11} /></button></div>)}
      <div className="grid grid-cols-2 gap-1.5"><button type="button" onClick={() => onUpdate((node) => { const target = ensureAppearance(node); target.effects.push({ id: nextLayerId("shadow", target.effects.map((effect) => effect.id)), type: "shadow", visible: true, color: { color: "rgba(0, 0, 0, 0.2)" }, x: 0, y: 8, blur: 24, spread: 0 }); }, "Added a shadow.")} className="h-7 rounded-[5px] border border-[var(--if-border)] text-[10.5px] hover:bg-[var(--if-hover)]"><Plus size={11} className="mr-1 inline" />Shadow</button><button type="button" onClick={() => onUpdate((node) => { const target = ensureAppearance(node); target.effects.push({ id: nextLayerId("blur", target.effects.map((effect) => effect.id)), type: "blur", visible: true, radius: 8 }); }, "Added a blur.")} className="h-7 rounded-[5px] border border-[var(--if-border)] text-[10.5px] hover:bg-[var(--if-hover)]"><Plus size={11} className="mr-1 inline" />Blur</button></div>
    </DisclosureSection>

    {colors.length > 0 ? <DisclosureSection title={`Selection colors · ${colors.length}`} defaultOpen={false}>
      {colors.map((color) => <div key={color.key} className="grid gap-2 rounded-[6px] border border-[var(--if-border-subtle)] p-2" data-testid="selection-color-row">
        <div className="grid grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-2">
          <input
            type="color"
            aria-label={`Change selection color ${color.token ?? color.color}`}
            value={/^#[0-9a-f]{6}$/i.test(color.color) ? color.color : "#4f8ff7"}
            onChange={(event) => onUpdate((node) => replaceSelectionColor(node, graph, color.key, { color: event.target.value }), "Updated the selection color across matching fills and strokes.")}
            className="size-5 cursor-pointer rounded-[4px] border border-[var(--if-border)] bg-transparent p-0"
          />
          <span className="min-w-0 truncate font-mono text-[9.5px]">{color.token ?? color.color}</span>
          <span className="text-[9px] text-[var(--if-text-tertiary)]">{color.usages} {color.usages === 1 ? "use" : "uses"} · {color.nodes} {color.nodes === 1 ? "layer" : "layers"}</span>
        </div>
        <label className="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-2 text-[9.5px] text-[var(--if-text-secondary)]"><span>Token</span><select aria-label={`Map ${color.token ?? color.color} to token`} value={color.token ?? ""} onChange={(event) => onUpdate((node) => replaceSelectionColor(node, graph, color.key, event.target.value ? { token: event.target.value } : { color: color.color }), event.target.value ? "Mapped the selection color to a design token." : "Detached the selection color token.")} className={selectClass}><option value="">Literal · {color.color}</option>{Object.keys(tokens.colors).map((token) => <option key={token} value={token}>{token} · {tokens.colors[token]}</option>)}</select></label>
        {color.origins.includes("fill") ? <label className="grid grid-cols-[64px_minmax(0,1fr)_36px] items-center gap-2 text-[9.5px] text-[var(--if-text-secondary)]"><span>Alpha</span><input aria-label={`Alpha for ${color.token ?? color.color}`} type="range" min={0} max={1} step={0.01} value={color.opacity ?? 1} onChange={(event) => onUpdate((node) => setSelectionColorOpacity(node, graph, color.key, Number(event.target.value)), "Updated matching fill alpha.")} className="accent-[var(--if-blue)]" /><span className="text-right font-mono">{color.mixedOpacity ? "Mixed" : `${Math.round((color.opacity ?? 1) * 100)}%`}</span></label> : null}
        <span className="text-[8.5px] text-[var(--if-text-tertiary)]">{color.origins.join(" + ")}</span>
      </div>)}
      {colors.some((color) => color.token) ? <p className="flex gap-1.5 text-[9.5px] leading-4 text-[var(--if-text-tertiary)]"><LinkSimple size={11} className="mt-0.5 shrink-0" />Token-bound colors update with the active design-system mode.</p> : null}
    </DisclosureSection> : null}
  </>;
}
