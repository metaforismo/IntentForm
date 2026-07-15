import {
  fingerprintFiles,
  lowerGraph,
  validateGeneratedOutput,
  type CompilerBackend,
  type CompilerDiagnostic,
  type GeneratedFile,
  type GeneratedFileSet,
  type PlatformIR,
  type PlatformIRNode,
} from "@intentform/compiler-core";
import type { Expression, SemanticInterfaceGraph } from "@intentform/semantic-schema";

// Graph identifiers admit dots and hyphens but not underscores. Mapping those
// separators independently keeps generated CSS readable without collisions.
const styleIdentifier = (value: string) => [...value].map((character) =>
  character === "." ? "-" : character === "-" ? "_" : character,
).join("");
const codeIdentifier = (value: string) => [...value].map((character) =>
  character === "." ? "_dot_" : character === "-" ? "_" : character,
).join("");
const nodeClass = (nodeId: string) => `if-web-${styleIdentifier(nodeId)}`;
const cssVarName = (key: string) => `--if-${styleIdentifier(key)}`;
const codeComponentName = (definitionId: string) => `IntentForm_${codeIdentifier(definitionId)}`;

function componentName(screenId: string): string {
  const encoded = codeIdentifier(screenId);
  const value = `${encoded[0]?.toUpperCase() ?? ""}${encoded.slice(1)}` || "Page";
  return `${/^\d/.test(value) ? `Page${value}` : value}Route`;
}

function reactExpression(expression: Expression): string {
  if (expression.op === "value") return JSON.stringify(expression.value);
  if (expression.op === "field") return `data.${expression.path.slice("data.".length)}`;
  if (expression.op === "not") return `!(${reactExpression(expression.value)})`;
  return `(${reactExpression(expression.left)} === ${reactExpression(expression.right)})`;
}

function accessibility(node: PlatformIRNode): string {
  const hint = node.accessibility.hint ? ` aria-description=${JSON.stringify(node.accessibility.hint)}` : "";
  const live = node.accessibility.live === "off" ? "" : ` aria-live=${JSON.stringify(node.accessibility.live)}`;
  return ` aria-label=${JSON.stringify(node.accessibility.label)}${hint}${live}`;
}

function fieldValue(node: PlatformIRNode, binding: "value" | "detail"): string | null {
  const field = node.bindings[binding];
  return field ? `{String(data.${field.name} ?? "")}` : null;
}

function eventHandler(node: PlatformIRNode): string {
  if (node.events.length === 0) return "";
  const calls = node.events.map((event) => {
    if (!event.payload) return `events.${event.name}()`;
    const fallback = event.payload === "number" ? "0" : event.payload === "boolean" ? "false" : '""';
    const value = event.payloadField ? `data.${event.payloadField.name} ?? ${fallback}` : fallback;
    return `events.${event.name}(${value})`;
  });
  return ` onClick={() => { ${calls.join("; ")}; }}`;
}

function nodeSource(node: PlatformIRNode): string {
  const label = `{${JSON.stringify(node.intent.label)}}`;
  const attributes = `${accessibility(node)}${eventHandler(node)}`;
  const value = fieldValue(node, "value");
  const detail = fieldValue(node, "detail");
  const children = node.children.map(nodeSource).join("\n");
  let content: string;
  if (node.codeComponent) {
    const properties = Object.entries(node.codeComponent.props)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, propertyValue]) => ` ${name}={${JSON.stringify(propertyValue)}}`)
      .join("");
    const name = codeComponentName(node.codeComponent.definitionId);
    content = `<${name}${properties}${attributes}>${children}</${name}>`;
  } else switch (node.kind) {
    case "text":
      content = `<p${attributes}>${label}</p>`;
      break;
    case "image":
      content = `<figure className="if-media"${accessibility(node)}><figcaption>${label}</figcaption></figure>`;
      break;
    case "shape":
      content = `<div className="if-shape" aria-hidden="true" />`;
      break;
    case "action":
      content = `<button type="button" className="if-action if-action-secondary"${attributes}>${label}</button>`;
      break;
    case "input":
      content = `<label className="if-field"><span>${label}</span><input${accessibility(node)} /></label>`;
      break;
    case "divider":
      content = `<hr aria-hidden="true" />`;
      break;
    case "spacer":
      content = `<span className="if-spacer" aria-hidden="true" />`;
      break;
    case "primary-action":
      content = `<button type="button" className="if-action if-action-primary"${attributes}>${label}</button>`;
      break;
    case "secondary-action":
      content = `<button type="button" className="if-action if-action-secondary"${attributes}>${label}</button>`;
      break;
    case "money-input":
      content = `<label className="if-field"><span>${label}</span><input inputMode="decimal"${node.bindings.value ? ` defaultValue={data.${node.bindings.value.name}}` : ""}${accessibility(node)} /></label>`;
      break;
    case "balance-summary":
      content = `<section className="if-card if-balance"${accessibility(node)}><p>${label}</p>${value ? `<strong>${value}</strong>` : ""}</section>`;
      break;
    case "transaction-list":
      content = `<section className="if-section"${accessibility(node)}><h2>${label}</h2>${value ? `<p>${value}</p>` : ""}</section>`;
      break;
    case "recipient-identity":
      content = `<address className="if-card if-address"${accessibility(node)}><strong>${value ?? label}</strong>${detail ? `<span>${detail}</span>` : ""}</address>`;
      break;
    case "status-message":
      content = `<p role="status" className="if-status"${attributes}>${label}</p>`;
      break;
    case "receipt-summary":
      content = `<section className="if-card if-receipt"${accessibility(node)}><h2>${label}</h2>${detail ? `<strong>${detail}</strong>` : ""}${value ? `<p>${value}</p>` : ""}</section>`;
      break;
    default:
      content = `<section className="if-layout"${attributes}>${children}</section>`;
  }

  if (node.asset && node.asset.exportPolicy !== "blocked") {
    const path = `/${node.asset.storageKey}`;
    const alt = node.asset.decorative ? "" : node.accessibility.label;
    const media = node.asset.kind === "video"
      ? `<video src=${JSON.stringify(path)} controls preload="metadata" />`
      : node.asset.kind === "audio"
        ? `<audio src=${JSON.stringify(path)} controls preload="metadata" />`
        : `<img src=${JSON.stringify(path)} alt=${JSON.stringify(alt)} loading="lazy" decoding="async" />`;
    content = `<figure className="if-media" data-asset-id=${JSON.stringify(node.asset.id)}>${media}${content}</figure>`;
  }

  const wrapped = `<div className="if-web-node ${nodeClass(node.id)}" data-node-id=${JSON.stringify(node.id)} data-intent=${JSON.stringify(node.intent.purpose)} data-style-role=${JSON.stringify(node.style.role)} data-emphasis=${JSON.stringify(node.style.emphasis)}>${content}</div>`;
  if (node.visibility.length === 0) return wrapped;
  const condition = node.visibility.map((entry) => entry.expression
    ? reactExpression(entry.expression)
    : node.bindings.status ? `data.${node.bindings.status.name} === ${JSON.stringify(entry.state)}` : "true").join(" || ");
  return `{${condition} ? (${wrapped}) : null}`;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function staticFieldValue(node: PlatformIRNode, fixture: PlatformIR["screens"][number]["defaultFixture"], binding: "value" | "detail"): string {
  const field = node.bindings[binding];
  return field ? escapeHtml(fixture.data[field.name] ?? "") : "";
}

function staticNodeSource(node: PlatformIRNode, fixture: PlatformIR["screens"][number]["defaultFixture"]): string {
  const label = escapeHtml(node.intent.label);
  const aria = ` aria-label="${escapeHtml(node.accessibility.label)}"`;
  const value = staticFieldValue(node, fixture, "value");
  const detail = staticFieldValue(node, fixture, "detail");
  const children = node.children.map((child) => staticNodeSource(child, fixture)).join("\n");
  let content: string;
  switch (node.kind) {
    case "text": content = `<p${aria}>${label}</p>`; break;
    case "image": content = `<figure class="if-media"${aria}><figcaption>${label}</figcaption></figure>`; break;
    case "shape": content = '<div class="if-shape" aria-hidden="true"></div>'; break;
    case "action":
    case "secondary-action": content = `<button type="button" class="if-action if-action-secondary"${aria}>${label}</button>`; break;
    case "primary-action": content = `<button type="button" class="if-action if-action-primary"${aria}>${label}</button>`; break;
    case "input": content = `<label class="if-field"><span>${label}</span><input${aria}></label>`; break;
    case "money-input": content = `<label class="if-field"><span>${label}</span><input inputmode="decimal" value="${value}"${aria}></label>`; break;
    case "divider": content = '<hr aria-hidden="true">'; break;
    case "spacer": content = '<span class="if-spacer" aria-hidden="true"></span>'; break;
    case "balance-summary": content = `<section class="if-card if-balance"${aria}><p>${label}</p>${value ? `<strong>${value}</strong>` : ""}</section>`; break;
    case "transaction-list": content = `<section class="if-section"${aria}><h2>${label}</h2>${value ? `<p>${value}</p>` : ""}</section>`; break;
    case "recipient-identity": content = `<address class="if-card if-address"${aria}><strong>${value || label}</strong>${detail ? `<span>${detail}</span>` : ""}</address>`; break;
    case "status-message": content = `<p role="status" class="if-status"${aria}>${label}</p>`; break;
    case "receipt-summary": content = `<section class="if-card if-receipt"${aria}><h2>${label}</h2>${detail ? `<strong>${detail}</strong>` : ""}${value ? `<p>${value}</p>` : ""}</section>`; break;
    default: content = `<section class="if-layout"${aria}>${children}</section>`;
  }
  if (node.asset && node.asset.exportPolicy !== "blocked") {
    const path = `../${escapeHtml(node.asset.storageKey)}`;
    const alt = node.asset.decorative ? "" : escapeHtml(node.accessibility.label);
    const media = node.asset.kind === "video"
      ? `<video src="${path}" controls preload="metadata"></video>`
      : node.asset.kind === "audio"
        ? `<audio src="${path}" controls preload="metadata"></audio>`
        : `<img src="${path}" alt="${alt}" loading="lazy" decoding="async">`;
    content = `<figure class="if-media" data-asset-id="${escapeHtml(node.asset.id)}">${media}${content}</figure>`;
  }
  return `<div class="if-web-node ${nodeClass(node.id)}" data-node-id="${escapeHtml(node.id)}" data-intent="${escapeHtml(node.intent.purpose)}" data-style-role="${escapeHtml(node.style.role)}" data-emphasis="${node.style.emphasis}">${content}</div>`;
}

function staticDocumentSource(ir: PlatformIR, index: number): string {
  const screen = ir.screens[index]!;
  return `<!doctype html>
<html lang="en" dir="auto">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(screen.title)}</title>
  <link rel="stylesheet" href="./styles.css">
</head>
<body>
  <a class="if-skip-link" href="#main-content">Skip to content</a>
  <main id="main-content" class="if-page" aria-label="${escapeHtml(screen.title)}" data-screen-id="${escapeHtml(screen.id)}" data-token-mode="${escapeHtml(ir.activeTokenMode)}">
    ${screen.nodes.map((node) => staticNodeSource(node, screen.defaultFixture)).join("\n    ")}
  </main>
</body>
</html>
`;
}

function contractSource(ir: PlatformIR, index: number): string {
  const screen = ir.screens[index]!;
  const name = componentName(screen.id);
  const fields = screen.contract?.data.map((field) =>
    `  ${field.name}${field.required ? "" : "?"}: ${field.type === "number" ? "number" : field.type === "boolean" ? "boolean" : "string"};`).join("\n")
    ?? "  readonly empty?: never;";
  const events = screen.contract?.events.map((event) =>
    `  ${event.name}(${event.payload ? `payload: ${event.payload}` : ""}): void;`).join("\n")
    ?? "  readonly empty?: never;";
  return `export interface ${name}Data {\n${fields}\n}\n\nexport interface ${name}Events {\n${events}\n}\n`;
}

function routeSource(ir: PlatformIR, index: number): string {
  const screen = ir.screens[index]!;
  const name = componentName(screen.id);
  const codeComponents = flattenNodes(screen.nodes).flatMap((node) => node.codeComponent ? [node.codeComponent] : []);
  const codeImports = [...new Map(codeComponents.map((component) => [component.definitionId, component])).values()]
    .sort((left, right) => left.definitionId.localeCompare(right.definitionId))
    .map((component) => `import { ${component.exportName} as ${codeComponentName(component.definitionId)} } from ${JSON.stringify(component.module)};`)
    .join("\n");
  return `${codeImports}${codeImports ? "\n" : ""}import type { ${name}Data, ${name}Events } from "../contracts/${screen.id}";

export interface ${name}Props {
  data: ${name}Data;
  events: ${name}Events;
}

export function ${name}({ data, events }: ${name}Props) {
  return (
    <main id="main-content" className="if-page" aria-label=${JSON.stringify(screen.title)} data-screen-id=${JSON.stringify(screen.id)} data-token-mode=${JSON.stringify(ir.activeTokenMode)}>
      ${screen.nodes.map(nodeSource).join("\n      ")}
    </main>
  );
}
`;
}

function appSource(ir: PlatformIR): string {
  const imports = ir.screens.map((screen) => `import { ${componentName(screen.id)} } from "./routes/${screen.id}";`).join("\n");
  const fixtures = ir.screens.map((screen) => {
    const available = screen.fixtures.length > 0 ? screen.fixtures : [screen.defaultFixture];
    return `const ${componentName(screen.id)}Fixtures = ${JSON.stringify(Object.fromEntries(available.map((fixture) => [fixture.state, fixture.data])))} as const;`;
  }).join("\n");
  const routes = ir.screens.map((screen) => `${JSON.stringify(screen.route)}: ${JSON.stringify(screen.id)}`).join(", ");
  const defaultStates = ir.screens.map((screen) => `${JSON.stringify(screen.id)}: ${JSON.stringify(screen.defaultFixture.state)}`).join(", ");
  const branches = ir.screens.map((screen) => {
    const events = (screen.contract?.events ?? []).map((event) => {
      const targetId = screen.eventTargets[event.name];
      const target = ir.screens.find((candidate) => candidate.id === targetId);
      return `          ${event.name}: (${event.payload ? `_payload: ${event.payload}` : ""}) => ${target ? `navigate(${JSON.stringify(target.route)})` : "undefined"},`;
    }).join("\n");
    const fixtureName = `${componentName(screen.id)}Fixtures`;
    return `      {active === ${JSON.stringify(screen.id)} ? <${componentName(screen.id)} data={${fixtureName}[visualState as keyof typeof ${fixtureName}] ?? ${fixtureName}[${JSON.stringify(screen.defaultFixture.state)}]} events={{\n${events}\n        }} /> : null}`;
  }).join("\n");
  const fallback = ir.screens[0]!;
  return `import { useEffect, useState } from "react";
${imports}
import "./styles.css";

type ScreenId = ${ir.screens.map((screen) => JSON.stringify(screen.id)).join(" | ")};
const routes: Record<string, ScreenId> = { ${routes} };
const defaultStates: Record<ScreenId, string> = { ${defaultStates} };
${fixtures}

export function App() {
  const routeForLocation = () => routes[window.location.pathname] ?? ${JSON.stringify(fallback.id)};
  const stateForLocation = (screen: ScreenId) => new URLSearchParams(window.location.search).get("state") ?? defaultStates[screen];
  const [active, setActive] = useState<ScreenId>(routeForLocation);
  const [visualState, setVisualState] = useState(() => stateForLocation(routeForLocation()));
  useEffect(() => {
    const onPopState = () => {
      const screen = routeForLocation();
      setActive(screen);
      setVisualState(stateForLocation(screen));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  const navigate = (path: string) => {
    window.history.pushState({}, "", path);
    const screen = routes[path] ?? ${JSON.stringify(fallback.id)};
    setActive(screen);
    setVisualState(defaultStates[screen]);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  return (
    <>
      <a className="if-skip-link" href="#main-content">Skip to content</a>
${branches}
    </>
  );
}
`;
}

type WebStyle = NonNullable<PlatformIRNode["web"]>;
type WebStyleOverride = WebStyle["breakpointOverrides"][string];

function resolvedWebStyle(node: PlatformIRNode, override: WebStyleOverride = {}): Omit<WebStyle, "breakpointOverrides"> {
  const inferredDisplay = node.children.length === 0
    ? "block"
    : node.layout.compactMode === "grid" ? "grid" : "flex";
  const base = node.web ?? {
    display: inferredDisplay,
    direction: node.layout.axis === "horizontal" ? "row" : "column",
    wrap: node.layout.compactMode === "wrap" ? "wrap" : "nowrap",
    position: "static",
    overflowX: node.layout.overflow === "scroll" ? "auto" : node.layout.overflow === "clip" ? "clip" : "visible",
    overflowY: node.layout.overflow === "scroll" ? "auto" : node.layout.overflow === "clip" ? "clip" : "visible",
    containerType: "normal",
    gridMinColumnWidth: 240,
    gridMaxColumns: node.layout.columns,
    breakpointOverrides: {},
  } satisfies WebStyle;
  const { breakpointOverrides: _ignored, ...style } = { ...base, ...override } as WebStyle;
  if (style.display !== "grid") {
    style.gridMinColumnWidth = 240;
    style.gridMaxColumns = 4;
  }
  if (style.position !== "sticky" && style.position !== "fixed") delete style.insetBlockStart;
  return style;
}

function declarations(style: Omit<WebStyle, "breakpointOverrides">, node: PlatformIRNode): string[] {
  const align = node.layout.align === "start" ? "flex-start" : node.layout.align === "end" ? "flex-end" : node.layout.align;
  const justify = node.layout.justify === "start" ? "flex-start" : node.layout.justify === "end" ? "flex-end" : node.layout.justify;
  const result = [
    `display: ${style.display}`,
    ...(style.display === "flex" ? [`flex-direction: ${style.direction}`, `flex-wrap: ${style.wrap}`] : []),
    ...(style.display === "grid" ? [
      `--if-grid-min: ${style.gridMinColumnWidth}px`,
      `--if-grid-max: ${style.gridMaxColumns}`,
      `grid-template-columns: ${node.layout.gridTracks?.map((track) => `${track}fr`).join(" ") ?? "repeat(auto-fit, minmax(min(100%, max(var(--if-grid-min), calc((100% - (var(--if-grid-max) - 1) * var(--if-node-gap)) / var(--if-grid-max)))), 1fr))"}`,
      ...(node.layout.gridRows ? [`grid-template-rows: ${node.layout.gridRows.map((track) => `${track}fr`).join(" ")}`] : []),
    ] : []),
    ...(node.children.length > 0 ? [`align-items: ${align}`, `justify-content: ${justify}`] : [`align-self: ${align}`]),
    `position: ${style.position}`,
    ...(style.insetBlockStart !== undefined ? [`inset-block-start: ${style.insetBlockStart}px`] : []),
    `overflow-x: ${style.overflowX}`,
    `overflow-y: ${style.overflowY}`,
    ...(style.aspectRatio !== undefined ? [`aspect-ratio: ${style.aspectRatio}`] : []),
    `container-type: ${style.containerType}`,
    `--if-node-gap: ${node.layout.gap}px`,
    `--if-node-padding: ${node.layout.padding}px`,
    `padding: ${node.layout.paddingBySide.top}px ${node.layout.paddingBySide.right}px ${node.layout.paddingBySide.bottom}px ${node.layout.paddingBySide.left}px`,
    ...(node.layout.flexGrow !== undefined ? [`flex-grow: ${node.layout.flexGrow}`] : []),
    ...(node.layout.flexShrink !== undefined ? [`flex-shrink: ${node.layout.flexShrink}`] : []),
    ...(node.layout.flexBasis !== undefined ? [`flex-basis: ${node.layout.flexBasis}px`] : []),
    ...(node.layout.gridColumn ? [`grid-column: ${node.layout.gridColumn.start} / span ${node.layout.gridColumn.span}`] : []),
    ...(node.layout.gridRow ? [`grid-row: ${node.layout.gridRow.start} / span ${node.layout.gridRow.span}`] : []),
    ...(node.layout.width === "fixed" && node.layout.fixedWidth ? [`width: ${node.layout.fixedWidth}px`] : []),
    ...(node.layout.minWidth !== undefined ? [`min-width: ${node.layout.minWidth}px`] : []),
    ...(node.layout.maxWidth !== undefined ? [`max-width: ${node.layout.maxWidth}px`] : []),
    ...(node.layout.height === "fixed" && node.layout.fixedHeight ? [`height: ${node.layout.fixedHeight}px`] : []),
    ...(node.layout.minHeight !== undefined ? [`min-height: ${node.layout.minHeight}px`] : []),
    ...(node.layout.maxHeight !== undefined ? [`max-height: ${node.layout.maxHeight}px`] : []),
    ...(style.visual?.color ? [`color: ${style.visual.color}`] : []),
    ...(style.visual?.backgroundColor ? [`background-color: ${style.visual.backgroundColor}`] : []),
    ...(style.visual?.borderColor ? [`border-color: ${style.visual.borderColor}`] : []),
    ...(style.visual?.borderWidth !== undefined ? [`border-width: ${style.visual.borderWidth}px`] : []),
    ...(style.visual?.borderStyle ? [`border-style: ${style.visual.borderStyle}`] : []),
    ...(style.visual?.borderRadius !== undefined ? [`border-radius: ${style.visual.borderRadius}px`] : []),
    ...(style.visual?.paddingTop !== undefined && style.visual.paddingRight !== undefined
      && style.visual.paddingBottom !== undefined && style.visual.paddingLeft !== undefined
      ? [`padding: ${style.visual.paddingTop}px ${style.visual.paddingRight}px ${style.visual.paddingBottom}px ${style.visual.paddingLeft}px`]
      : []),
    ...(style.visual?.opacity !== undefined ? [`opacity: ${style.visual.opacity}`] : []),
    ...(style.visual?.fontFamily ? [`font-family: ${style.visual.fontFamily}`] : []),
    ...(style.visual?.fontSize !== undefined ? [`font-size: ${style.visual.fontSize}px`] : []),
    ...(style.visual?.fontWeight !== undefined ? [`font-weight: ${style.visual.fontWeight}`] : []),
    ...(style.visual?.lineHeight !== undefined ? [`line-height: ${style.visual.lineHeight}px`] : []),
    ...(style.visual?.letterSpacing !== undefined ? [`letter-spacing: ${style.visual.letterSpacing}px`] : []),
    ...(style.visual?.textAlign ? [`text-align: ${style.visual.textAlign}`] : []),
  ];
  return result;
}

function flattenNodes(nodes: PlatformIRNode[]): PlatformIRNode[] {
  return nodes.flatMap((node) => [node, ...flattenNodes(node.children)]);
}

function stylesSource(ir: PlatformIR): string {
  if (!ir.web) throw new Error("Web output requires a responsive-web profile");
  const declarationsForMode = (mode: PlatformIR["tokens"]) => [
    ...Object.entries(mode.colors).map(([key, value]) => `  ${cssVarName(key)}: ${value};`),
    ...Object.entries(mode.spacing).map(([key, value]) => `  ${cssVarName(key)}: ${value}px;`),
    ...Object.entries(mode.radii).map(([key, value]) => `  ${cssVarName(key)}: ${value}px;`),
    ...Object.entries(mode.fontFamilies).map(([key, value]) => `  ${cssVarName(key)}: ${value};`),
    ...Object.entries(mode.fontWeights).map(([key, value]) => `  ${cssVarName(key)}: ${value};`),
    ...Object.entries(mode.fontSizes).map(([key, value]) => `  ${cssVarName(key)}: ${value}px;`),
    ...Object.entries(mode.lineHeights).map(([key, value]) => `  ${cssVarName(key)}: ${value}px;`),
    ...Object.entries(mode.letterSpacing).map(([key, value]) => `  ${cssVarName(key)}: ${value}px;`),
    ...Object.entries(mode.shadows).map(([key, value]) => `  ${cssVarName(key)}: ${value};`),
    ...Object.entries(mode.opacity).map(([key, value]) => `  ${cssVarName(key)}: ${value};`),
    ...Object.entries(mode.durations).map(([key, value]) => `  ${cssVarName(key)}: ${value}ms;`),
    ...Object.entries(mode.easings).map(([key, value]) => `  ${cssVarName(key)}: ${value};`),
    ...Object.entries(mode.containers).map(([key, value]) => `  ${cssVarName(key)}: ${value}px;`),
    ...Object.entries(mode.breakpoints).map(([key, value]) => `  ${cssVarName(key)}: ${value}px;`),
    ...Object.entries(mode.zIndices).map(([key, value]) => `  ${cssVarName(key)}: ${value};`),
  ].sort().join("\n");
  const modeDeclarations = Object.entries(ir.tokenModes)
    .filter(([modeId]) => modeId !== ir.tokenCollection.defaultMode)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([modeId, mode]) => `.if-page[data-token-mode=${JSON.stringify(modeId)}] {\n${declarationsForMode(mode)}\n}`)
    .join("\n");
  const allNodes = ir.screens.flatMap((screen) => flattenNodes(screen.nodes));
  const nodeRules = allNodes.map((node) => {
    const assetRule = node.asset
      ? `\n.${nodeClass(node.id)} img, .${nodeClass(node.id)} video { object-fit: ${node.asset.fit}; object-position: ${node.asset.focalPoint.x * 100}% ${node.asset.focalPoint.y * 100}%; }`
      : "";
    return `.${nodeClass(node.id)} {\n  ${declarations(resolvedWebStyle(node), node).join(";\n  ")};\n}${assetRule}`;
  }).join("\n");
  const breakpointRules = [...ir.web.breakpoints].sort((left, right) => left.minWidth - right.minWidth).map((breakpoint) => {
    const rules = allNodes.flatMap((node) => {
      const override = node.web?.breakpointOverrides[breakpoint.id];
      if (!override || Object.keys(override).length === 0) return [];
      return [`.${nodeClass(node.id)} {\n    ${declarations(resolvedWebStyle(node, override), node).join(";\n    ")};\n  }`];
    });
    if (rules.length === 0) return "";
    const query = `(min-width: ${breakpoint.minWidth}px)${breakpoint.maxWidth !== undefined ? ` and (max-width: ${breakpoint.maxWidth}px)` : ""}`;
    return `@media ${query} {\n  ${rules.join("\n  ")}\n}`;
  }).filter(Boolean).join("\n");
  const padding = cssVarName(ir.web.inlinePaddingToken);
  return `:root {
  color-scheme: light;
  font-family: var(--if-font-family, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
  --if-content-max: ${ir.web.contentMaxWidth}px;
${declarationsForMode(ir.tokenModes[ir.tokenCollection.defaultMode] ?? ir.tokens)}
  --if-accent: var(${cssVarName("color.accent")}, #397461);
  --if-ink: var(${cssVarName("color.ink")}, #181c1a);
  --if-canvas: var(${cssVarName("color.canvas")}, #f3f5f1);
  --if-surface: var(${cssVarName("color.surface")}, #fbfcf9);
}
${modeDeclarations}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body { margin: 0; color: var(--if-ink); background: var(--if-canvas); }
button, input { font: inherit; }
button, a { touch-action: manipulation; }
:focus-visible { outline: 3px solid color-mix(in oklab, var(--if-accent) 58%, white); outline-offset: 3px; }
.if-skip-link { position: fixed; inset-block-start: 12px; inset-inline-start: 12px; z-index: 100; min-height: 44px; padding: 12px 14px; color: white; background: var(--if-ink); transform: translateY(-180%); }
.if-skip-link:focus { transform: translateY(0); }
.if-page { width: min(calc(100% - 2 * var(${padding})), var(--if-content-max)); min-height: 100dvh; margin-inline: auto; }
.if-web-node { min-width: 0; gap: var(--if-node-gap); padding: var(--if-node-padding); }
.if-layout { display: contents; }
.if-card, .if-section, .if-status, .if-field { display: grid; gap: 10px; }
.if-address { font-style: normal; }
.if-field input { min-height: 44px; max-width: 100%; }
.if-action { min-height: 44px; cursor: pointer; }
.if-action-primary { color: white; background: var(--if-accent); }
.if-action-secondary { color: inherit; background: transparent; }
.if-media { display: grid; margin: 0; }
.if-media img, .if-media video { display: block; width: 100%; height: 100%; }
.if-media audio { width: 100%; }
.if-web-node[data-emphasis="quiet"] { opacity: .72; }
.if-web-node[data-emphasis="strong"] { font-weight: 650; }
${nodeRules}
${breakpointRules}
@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; animation-duration: .01ms !important; }
}
@media (forced-colors: active) {
  :focus-visible { outline: 3px solid Highlight !important; }
  button, input, select, textarea { border: 1px solid ButtonText; }
}
`;
}

function generatedPackageFiles(ir: PlatformIR): GeneratedFile[] {
  return [
    { path: "package.json", content: `${JSON.stringify({ name: "intentform-responsive-web", private: true, version: "0.0.0", type: "module", scripts: { build: "vite build", dev: "vite", typecheck: "tsc --noEmit" }, dependencies: { react: "19.2.4", "react-dom": "19.2.4", ...ir.dependencies }, devDependencies: { "@types/react": "19.2.14", "@types/react-dom": "19.2.3", typescript: "5.9.3", vite: "8.1.4" } }, null, 2)}\n` },
    { path: "index.html", content: "<!doctype html>\n<html lang=\"en\" dir=\"auto\"><head><meta charset=\"UTF-8\" /><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\" /><link rel=\"icon\" href=\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='16' fill='%23397461'/%3E%3C/svg%3E\" /><title>IntentForm responsive web</title></head><body><div id=\"root\"></div><script type=\"module\" src=\"/src/main.tsx\"></script></body></html>\n" },
    { path: "tsconfig.json", content: `${JSON.stringify({ compilerOptions: { target: "ES2022", useDefineForClassFields: true, lib: ["ES2022", "DOM", "DOM.Iterable"], allowJs: false, skipLibCheck: true, esModuleInterop: true, allowSyntheticDefaultImports: true, strict: true, forceConsistentCasingInFileNames: true, module: "ESNext", moduleResolution: "Bundler", resolveJsonModule: true, isolatedModules: true, noEmit: true, jsx: "react-jsx" }, include: ["src"] }, null, 2)}\n` },
    { path: "vite.config.ts", content: "import { defineConfig } from \"vite\";\nexport default defineConfig({ esbuild: { jsx: \"automatic\" }, build: { outDir: \"dist\", emptyOutDir: true } });\n" },
    { path: "src/main.tsx", content: "import { StrictMode } from \"react\";\nimport { createRoot } from \"react-dom/client\";\nimport { App } from \"./app\";\nconst root = document.getElementById(\"root\");\nif (!root) throw new Error(\"Missing application root\");\ncreateRoot(root).render(<StrictMode><App /></StrictMode>);\n" },
  ];
}

export class WebCompiler implements CompilerBackend {
  readonly id = "web" as const;

  capabilities() {
    return { target: this.id, nativeSafeArea: false, adaptivePlacement: true, accessibility: true };
  }

  lower(graph: SemanticInterfaceGraph): PlatformIR {
    if (!graph.web) throw new Error("The web target requires a responsive-web profile");
    return lowerGraph(graph, this.id);
  }

  generate(ir: PlatformIR): GeneratedFileSet {
    if (!ir.web) throw new Error("The web target requires a responsive-web profile");
    const css = stylesSource(ir);
    const files: GeneratedFile[] = [
      ...generatedPackageFiles(ir),
      ...ir.screens.map((_, index) => ({ path: `src/routes/${ir.screens[index]!.id}.tsx`, content: routeSource(ir, index) })),
      ...ir.screens.map((_, index) => ({ path: `src/contracts/${ir.screens[index]!.id}.ts`, content: contractSource(ir, index) })),
      ...ir.screens.map((_, index) => ({ path: `html/${ir.screens[index]!.id}.html`, content: staticDocumentSource(ir, index) })),
      { path: "src/app.tsx", content: appSource(ir) },
      { path: "src/styles.css", content: css },
      { path: "html/styles.css", content: css },
      { path: "intentform.web.json", content: `${JSON.stringify({ version: 1, strategy: ir.web.strategy, frames: ir.web.frames, breakpoints: ir.web.breakpoints, routes: ir.screens.map((screen) => ({ id: screen.id, route: screen.route })), ownedPaths: ["src/routes", "src/contracts", "src/app.tsx", "src/styles.css", "html"] }, null, 2)}\n` },
    ];
    return { target: this.id, files, fingerprint: fingerprintFiles(files), diagnostics: ir.diagnostics };
  }

  validate(output: GeneratedFileSet): CompilerDiagnostic[] {
    const diagnostics: CompilerDiagnostic[] = [];
    const required = ["package.json", "index.html", "src/main.tsx", "src/app.tsx", "src/styles.css", "intentform.web.json"];
    const paths = new Set(output.files.map((file) => file.path));
    for (const path of required) {
      if (!paths.has(path)) diagnostics.push({ severity: "error", path, message: "Required responsive-web output is missing" });
    }
    for (const file of output.files) {
      if (/\beval\s*\(|new Function\s*\(|dangerouslySetInnerHTML/.test(file.content)) {
        diagnostics.push({ severity: "error", path: file.path, message: "Generated web output cannot evaluate source or inject raw HTML" });
      }
    }
    const app = output.files.find((file) => file.path === "src/app.tsx")?.content ?? "";
    const styles = output.files.find((file) => file.path === "src/styles.css")?.content ?? "";
    if (!app.includes("Skip to content")) {
      diagnostics.push({ severity: "error", path: "src/app.tsx", message: "Generated web shell requires skip navigation" });
    }
    if (!styles.includes("@media")) {
      diagnostics.push({ severity: "error", path: "src/styles.css", message: "Generated web CSS requires responsive media rules" });
    }
    return diagnostics;
  }
}

export function compileWeb(graph: SemanticInterfaceGraph): GeneratedFileSet {
  const compiler = new WebCompiler();
  return validateGeneratedOutput(compiler, compiler.generate(compiler.lower(graph)));
}
