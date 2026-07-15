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
  switch (node.kind) {
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

  const wrapped = `<div className="if-web-node ${nodeClass(node.id)}" data-node-id=${JSON.stringify(node.id)} data-intent=${JSON.stringify(node.intent.purpose)}>${content}</div>`;
  if (node.visibility.length === 0) return wrapped;
  const condition = node.visibility.map((entry) => entry.expression
    ? reactExpression(entry.expression)
    : node.bindings.status ? `data.${node.bindings.status.name} === ${JSON.stringify(entry.state)}` : "true").join(" || ");
  return `{${condition} ? (${wrapped}) : null}`;
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
  return `import type { ${name}Data, ${name}Events } from "../contracts/${screen.id}";

export interface ${name}Props {
  data: ${name}Data;
  events: ${name}Events;
}

export function ${name}({ data, events }: ${name}Props) {
  return (
    <main id="main-content" className="if-page" data-screen-id=${JSON.stringify(screen.id)} data-token-mode=${JSON.stringify(ir.activeTokenMode)}>
      <header className="if-page-header">
        <p className="if-eyebrow">{${JSON.stringify(ir.productName)}}</p>
        <h1>{${JSON.stringify(screen.title)}}</h1>
        <p>{${JSON.stringify(screen.purpose)}}</p>
      </header>
      <div className="if-page-content">
        ${screen.nodes.map(nodeSource).join("\n        ")}
      </div>
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
  const nav = ir.screens.map((screen) => `<a href=${JSON.stringify(screen.route)} aria-current={active === ${JSON.stringify(screen.id)} ? "page" : undefined} onClick={(event) => { event.preventDefault(); navigate(${JSON.stringify(screen.route)}); }}>{${JSON.stringify(screen.title)}}</a>`).join("\n          ");
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
      <nav className="if-site-nav" aria-label="Primary">
        <strong>{${JSON.stringify(ir.productName)}}</strong>
        <div>
          ${nav}
        </div>
      </nav>
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
  const result = [
    `display: ${style.display}`,
    ...(style.display === "flex" ? [`flex-direction: ${style.direction}`, `flex-wrap: ${style.wrap}`] : []),
    ...(style.display === "grid" ? [
      `--if-grid-min: ${style.gridMinColumnWidth}px`,
      `--if-grid-max: ${style.gridMaxColumns}`,
      "grid-template-columns: repeat(auto-fit, minmax(min(100%, max(var(--if-grid-min), calc((100% - (var(--if-grid-max) - 1) * var(--if-node-gap)) / var(--if-grid-max)))), 1fr))",
    ] : []),
    `position: ${style.position}`,
    ...(style.insetBlockStart !== undefined ? [`inset-block-start: ${style.insetBlockStart}px`] : []),
    `overflow-x: ${style.overflowX}`,
    `overflow-y: ${style.overflowY}`,
    ...(style.aspectRatio !== undefined ? [`aspect-ratio: ${style.aspectRatio}`] : []),
    `container-type: ${style.containerType}`,
    `--if-node-gap: ${node.layout.gap}px`,
    `--if-node-padding: ${node.layout.padding}px`,
    ...(node.layout.width === "fixed" && node.layout.fixedWidth ? [`width: ${node.layout.fixedWidth}px`] : []),
    ...(node.layout.minWidth !== undefined ? [`min-width: ${node.layout.minWidth}px`] : []),
    ...(node.layout.maxWidth !== undefined ? [`max-width: ${node.layout.maxWidth}px`] : []),
    ...(node.layout.height === "fixed" && node.layout.fixedHeight ? [`height: ${node.layout.fixedHeight}px`] : []),
    ...(node.layout.minHeight !== undefined ? [`min-height: ${node.layout.minHeight}px`] : []),
    ...(node.layout.maxHeight !== undefined ? [`max-height: ${node.layout.maxHeight}px`] : []),
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
  ].sort().join("\n");
  const modeDeclarations = Object.entries(ir.tokenModes)
    .filter(([modeId]) => modeId !== ir.tokenCollection.defaultMode)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([modeId, mode]) => `.if-page[data-token-mode=${JSON.stringify(modeId)}] {\n${declarationsForMode(mode)}\n}`)
    .join("\n");
  const allNodes = ir.screens.flatMap((screen) => flattenNodes(screen.nodes));
  const nodeRules = allNodes.map((node) => `.${nodeClass(node.id)} {\n  ${declarations(resolvedWebStyle(node), node).join(";\n  ")};\n}`).join("\n");
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
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
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
.if-skip-link { position: fixed; inset: 12px auto auto 12px; z-index: 100; padding: 10px 14px; color: white; background: var(--if-ink); transform: translateY(-180%); }
.if-skip-link:focus { transform: translateY(0); }
.if-site-nav { position: sticky; inset-block-start: 0; z-index: 20; display: flex; align-items: center; justify-content: space-between; gap: 24px; min-height: 64px; padding-inline: max(var(${padding}), calc((100vw - var(--if-content-max)) / 2)); border-bottom: 1px solid color-mix(in oklab, var(--if-ink) 12%, transparent); background: color-mix(in oklab, var(--if-surface) 92%, transparent); backdrop-filter: blur(16px); }
.if-site-nav div { display: flex; flex-wrap: wrap; gap: 16px; }
.if-site-nav a { color: inherit; text-decoration: none; }
.if-site-nav a[aria-current="page"] { color: var(--if-accent); }
.if-page { min-height: 100dvh; }
.if-page-header, .if-page-content { width: min(calc(100% - 2 * var(${padding})), var(--if-content-max)); margin-inline: auto; }
.if-page-header { padding-block: clamp(56px, 9vw, 128px) clamp(36px, 6vw, 80px); }
.if-page-header h1 { max-width: 16ch; margin: 8px 0 18px; font-size: clamp(2.5rem, 7vw, 6.8rem); line-height: .92; letter-spacing: -.065em; }
.if-page-header > p:last-child { max-width: 62ch; color: color-mix(in oklab, var(--if-ink) 66%, transparent); font-size: clamp(1rem, 1.8vw, 1.35rem); line-height: 1.55; }
.if-eyebrow { color: var(--if-accent); font-size: .75rem; font-weight: 750; letter-spacing: .14em; text-transform: uppercase; }
.if-page-content { display: grid; gap: clamp(20px, 4vw, 48px); padding-block-end: 96px; }
.if-web-node { min-width: 0; gap: var(--if-node-gap); padding: var(--if-node-padding); }
.if-layout { display: contents; }
.if-card, .if-section, .if-status, .if-field { display: grid; gap: 10px; }
.if-card, .if-section, .if-status { padding: clamp(20px, 4vw, 42px); border: 1px solid color-mix(in oklab, var(--if-ink) 10%, transparent); border-radius: var(${cssVarName("radius.surface")}, 24px); background: var(--if-surface); }
.if-card strong { font-size: clamp(2rem, 5vw, 4.8rem); letter-spacing: -.05em; }
.if-address { font-style: normal; }
.if-field input { min-height: 54px; padding: 12px 16px; border: 1px solid color-mix(in oklab, var(--if-ink) 18%, transparent); border-radius: var(${cssVarName("radius.control")}, 14px); background: var(--if-surface); }
.if-action { min-height: 48px; padding: 14px 20px; border: 0; border-radius: var(${cssVarName("radius.control")}, 14px); font-weight: 750; cursor: pointer; }
.if-action-primary { color: white; background: var(--if-accent); }
.if-action-secondary { color: var(--if-ink); background: color-mix(in oklab, var(--if-accent) 14%, var(--if-surface)); }
.if-status { border-inline-start: 4px solid var(--if-accent); }
.if-media { display: grid; gap: 16px; margin: 0; }
.if-media img, .if-media video { display: block; width: 100%; height: auto; border-radius: var(${cssVarName("radius.surface")}, 24px); }
.if-media audio { width: 100%; }
${nodeRules}
${breakpointRules}
@media (max-width: 640px) {
  .if-site-nav { align-items: flex-start; flex-direction: column; padding-block: 14px; }
}
@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; animation-duration: .01ms !important; }
}
`;
}

function generatedPackageFiles(): GeneratedFile[] {
  return [
    { path: "package.json", content: `${JSON.stringify({ name: "intentform-responsive-web", private: true, version: "0.0.0", type: "module", scripts: { build: "vite build", dev: "vite", typecheck: "tsc --noEmit" }, dependencies: { react: "19.2.4", "react-dom": "19.2.4" }, devDependencies: { "@types/react": "19.2.14", "@types/react-dom": "19.2.3", typescript: "5.9.3", vite: "8.1.4" } }, null, 2)}\n` },
    { path: "index.html", content: "<!doctype html>\n<html lang=\"en\"><head><meta charset=\"UTF-8\" /><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\" /><link rel=\"icon\" href=\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='16' fill='%23397461'/%3E%3C/svg%3E\" /><title>IntentForm responsive web</title></head><body><div id=\"root\"></div><script type=\"module\" src=\"/src/main.tsx\"></script></body></html>\n" },
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
    const files: GeneratedFile[] = [
      ...generatedPackageFiles(),
      ...ir.screens.map((_, index) => ({ path: `src/routes/${ir.screens[index]!.id}.tsx`, content: routeSource(ir, index) })),
      ...ir.screens.map((_, index) => ({ path: `src/contracts/${ir.screens[index]!.id}.ts`, content: contractSource(ir, index) })),
      { path: "src/app.tsx", content: appSource(ir) },
      { path: "src/styles.css", content: stylesSource(ir) },
      { path: "intentform.web.json", content: `${JSON.stringify({ version: 1, strategy: ir.web.strategy, frames: ir.web.frames, breakpoints: ir.web.breakpoints, routes: ir.screens.map((screen) => ({ id: screen.id, route: screen.route })), ownedPaths: ["src/routes", "src/contracts", "src/app.tsx", "src/styles.css"] }, null, 2)}\n` },
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
    if (!app.includes("Skip to content") || !app.includes('aria-label="Primary"')) {
      diagnostics.push({ severity: "error", path: "src/app.tsx", message: "Generated web shell requires skip navigation and a labelled primary landmark" });
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
