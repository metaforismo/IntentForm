import {
  fingerprintFiles,
  lowerGraph,
  validateGeneratedOutput,
  type CompilerBackend,
  type CompilerDiagnostic,
  type GeneratedFileSet,
  type PlatformIR,
  type PlatformIRNode,
} from "@intentform/compiler-core";
export {
  lowerGraph,
  type PlatformIR,
  type PlatformIRNode,
  type PlatformIRScreen,
} from "@intentform/compiler-core";
import {
  DEVICE_CLASS_LIMITS,
  type Expression,
  type SemanticInterfaceGraph,
} from "@intentform/semantic-schema";

const reactExpression = (expression: Expression): string => {
  if (expression.op === "value") return JSON.stringify(expression.value);
  if (expression.op === "field") return `data.${expression.path.slice("data.".length)}`;
  if (expression.op === "not") return `!(${reactExpression(expression.value)})`;
  return `(${reactExpression(expression.left)} === ${reactExpression(expression.right)})`;
};

const fieldValue = (name: string): string => `data.${name}`;
const displayedField = (name: string): string => `{String(${fieldValue(name)} ?? "")}`;

const eventCall = (event: PlatformIRNode["events"][number]): string => {
  if (!event.payload) return `events.${event.name}()`;
  const fallback = event.payload === "string" ? '""' : event.payload === "number" ? "0" : "false";
  const payload = event.payloadField
    ? `${fieldValue(event.payloadField.name)}${event.payloadField.required ? "" : ` ?? ${fallback}`}`
    : fallback;
  return `events.${event.name}(${payload})`;
};

const eventHandler = (node: PlatformIRNode): string => {
  if (node.events.length === 0) return "";
  if (node.events.length === 1 && !node.events[0]!.payload) {
    return ` onClick={events.${node.events[0]!.name}}`;
  }
  return ` onClick={() => { ${node.events.map(eventCall).join("; ")}; }}`;
};

const classFragment = (value: string): string => value.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();

const accessibilityAttributes = (node: PlatformIRNode): string => {
  const hint = node.accessibility.hint
    ? ` aria-description={${JSON.stringify(node.accessibility.hint)}}`
    : "";
  const live = node.accessibility.live === "off"
    ? ""
    : ` aria-live=${JSON.stringify(node.accessibility.live)}`;
  return ` aria-label={${JSON.stringify(node.accessibility.label)}}${hint}${live}`;
};

const componentForNode = (node: PlatformIRNode): string => {
  const label = `{${JSON.stringify(node.intent.label)}}`;
  const accessibility = accessibilityAttributes(node);
  const handler = eventHandler(node);
  const value = node.bindings.value ? displayedField(node.bindings.value.name) : null;
  const detail = node.bindings.detail && node.bindings.detail.name !== node.bindings.value?.name
    ? displayedField(node.bindings.detail.name)
    : null;
  let source: string;
  switch (node.kind) {
    case "balance-summary":
      source = `<section className="balance"${accessibility}><span>${label}</span>${value ? `<strong>${value}</strong>` : ""}${detail ? `<small>${detail}</small>` : ""}</section>`;
      break;
    case "transaction-list":
      source = `<section${accessibility}><h2>${label}</h2>${value ? `<p>${value}</p>` : ""}</section>`;
      break;
    case "money-input":
      source = `<label className="money-field"><span>${label}</span><input inputMode="decimal"${node.bindings.value ? ` defaultValue={${fieldValue(node.bindings.value.name)}}` : ""}${accessibility} /></label>`;
      break;
    case "recipient-identity":
      source = `<section className="recipient"${accessibility}>${node.bindings.value ? `<span className="avatar" aria-hidden="true">{String(${fieldValue(node.bindings.value.name)} ?? "").slice(0, 2).toUpperCase()}</span>` : ""}<span><strong>${value ?? label}</strong>${detail ? `<small>${detail}</small>` : ""}</span></section>`;
      break;
    case "primary-action": {
      const compactPlacement = node.layout.compactPlacement === "persistent-bottom" ? "persistent" : "inline";
      const regularPlacement = node.layout.regularPlacement === "persistent-bottom" ? "persistent" : "inline";
      const className = `primary placement-compact-${compactPlacement} placement-regular-${regularPlacement}`;
      source = `<button className="${className}" type="button"${accessibility}${handler}>${label}</button>`;
      break;
    }
    case "secondary-action":
      source = `<button className="secondary" type="button"${accessibility}${handler}>${label}</button>`;
      break;
    case "status-message":
      source = `<p role="status" className="status"${accessibility}>${label}</p>`;
      break;
    case "receipt-summary":
      source = `<section className="receipt"${accessibility}><span>${label}</span>${detail ? `<strong>${detail}</strong>` : ""}${value ? `<small>${value}</small>` : ""}</section>`;
      break;
    default:
      source = `<div>${label}</div>`;
  }

  const wrapperClasses = [
    "if-node",
    `if-axis-${node.layout.axis}`,
    `if-width-${node.layout.width}`,
    `if-gap-${classFragment(node.layout.gapToken)}`,
    `if-padding-${classFragment(node.layout.paddingToken)}`,
    `if-role-${classFragment(node.style.role)}`,
    `if-emphasis-${node.style.emphasis}`,
    `if-importance-${node.intent.importance}`,
  ].join(" ");
  source = `<div className="${wrapperClasses}" data-intent-purpose={${JSON.stringify(node.intent.purpose)}} data-intent-role={${JSON.stringify(node.style.role)}}>${source}</div>`;

  if (node.visibility.length > 0) {
    const condition = node.visibility.map((visibility) => visibility.expression
      ? reactExpression(visibility.expression)
      : node.bindings.status
        ? `${fieldValue(node.bindings.status.name)} === ${JSON.stringify(visibility.state)}`
        : "true").join(" || ");
    return `{${condition} ? (${source}) : null}`;
  }
  return source;
};

const componentName = (screenId: string): string => {
  const pascal = screenId
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join("") || "Generated";
  const identifier = /^\d/.test(pascal) ? `Screen${pascal}` : pascal;
  return `${identifier}Screen`;
};

function screenSource(ir: PlatformIR, screenIndex: number): string {
  const screen = ir.screens[screenIndex];
  if (!screen) throw new Error(`Screen index ${screenIndex} is missing`);
  const body = screen.nodes.map((node) => `        ${componentForNode(node)}`).join("\n");
  const name = componentName(screen.id);
  return `import type { ${name}Data, ${name}Events } from "../contracts/${screen.id}";

export interface ${name}Props {
  data: ${name}Data;
  events: ${name}Events;
}

export function ${name}({ data, events }: ${name}Props) {
  return (
    <main className="screen" data-screen-id="${screen.id}" data-screen-route={${JSON.stringify(screen.route)}} data-screen-purpose={${JSON.stringify(screen.purpose)}}>
      <header><span className="eyebrow">{${JSON.stringify(ir.productName)}}</span><h1>{${JSON.stringify(screen.title)}}</h1></header>
      <div className="screen-content">
${body}
      </div>
    </main>
  );
}
`;
}

function contractSource(ir: PlatformIR, screenIndex: number): string {
  const screen = ir.screens[screenIndex];
  if (!screen) throw new Error(`Screen index ${screenIndex} is missing`);
  const name = componentName(screen.id);
  const fields = screen.contract?.data.map((field) => `  ${field.name}${field.required ? "" : "?"}: ${field.type === "number" ? "number" : field.type === "boolean" ? "boolean" : "string"};`).join("\n") ?? "  readonly empty?: never;";
  const events = screen.contract?.events.map((event) => `  ${event.name}(${event.payload ? `payload: ${event.payload}` : ""}): void;`).join("\n") ?? "  readonly empty?: never;";
  return `export interface ${name}Data {\n${fields}\n}\n\nexport interface ${name}Events {\n${events}\n}\n`;
}

function appSource(ir: PlatformIR): string {
  const imports = ir.screens
    .map((screen) => `import { ${componentName(screen.id)} } from "./screens/${screen.id}";`)
    .join("\n");
  const screenIds = ir.screens.map((screen) => JSON.stringify(screen.id)).join(" | ");
  const initialScreen = ir.screens[0]?.id;
  if (!initialScreen) throw new Error("React output needs at least one screen");

  const fixtureConstants = ir.screens.map((screen) => {
    const fixtures = screen.fixtures.length > 0 ? screen.fixtures : [screen.defaultFixture];
    const byState = Object.fromEntries(fixtures.map((fixture) => [fixture.state, fixture.data]));
    return `const ${componentName(screen.id).replace(/Screen$/, "")}Fixtures = ${JSON.stringify(byState)} as const;`;
  }).join("\n");

  const branches = ir.screens.map((screen) => {
    const fixturesName = `${componentName(screen.id).replace(/Screen$/, "")}Fixtures`;
    const events = (screen.contract?.events ?? []).map((event) => {
      const target = screen.eventTargets[event.name];
      const argument = event.payload ? `_payload: ${event.payload}` : "";
      return `          ${event.name}: (${argument}) => ${target ? `setScreen(${JSON.stringify(target)})` : "undefined"},`;
    }).join("\n");
    return `      {screen === ${JSON.stringify(screen.id)} ? (
        <${componentName(screen.id)}
          data={${fixturesName}[(requestedState ?? "") as keyof typeof ${fixturesName}] ?? ${fixturesName}[${JSON.stringify(screen.defaultFixture.state)}]}
          events={{
${events}
          }}
        />
      ) : null}`;
  }).join("\n");

  return `import { useState } from "react";
${imports}
import "./styles.css";

type ScreenId = ${screenIds};

${fixtureConstants}

export function GeneratedApp() {
  const search = new URLSearchParams(window.location.search);
  const requestedScreen = search.get("screen") as ScreenId | null;
  const requestedState = search.get("state");
  const [screen, setScreen] = useState<ScreenId>(
    requestedScreen && [${ir.screens.map((screen) => JSON.stringify(screen.id)).join(", ")}].includes(requestedScreen)
      ? requestedScreen
      : ${JSON.stringify(initialScreen)},
  );
  return (
    <>
${branches}
    </>
  );
}
`;
}

const cssVarName = (key: string): string => `--if-${key.replace(/[^a-zA-Z0-9]+/g, "-")}`;

/* Token resolution: every graph token becomes a CSS custom property, and the
   semantic classes consume them. Editing a token in the graph deterministically
   changes the generated stylesheet on the next compile. */
function stylesSource(ir: PlatformIR): string {
  const declarations = [
    ...Object.entries(ir.tokens.colors).map(([key, value]) => [cssVarName(key), value] as const),
    ...Object.entries(ir.tokens.spacing).map(([key, value]) => [cssVarName(key), `${value}px`] as const),
    ...Object.entries(ir.tokens.radii).map(([key, value]) => [cssVarName(key), `${value}px`] as const),
  ]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => `  ${name}: ${value};`)
    .join("\n");
  const spacingClasses = Object.keys(ir.tokens.spacing)
    .sort()
    .flatMap((key) => {
      const fragment = classFragment(key);
      const variable = `var(${cssVarName(key)})`;
      return [`.if-gap-${fragment} { --if-node-gap: ${variable}; }`, `.if-padding-${fragment} { --if-node-padding: ${variable}; }`];
    })
    .join("\n");

  return `:root {
  color-scheme: light;
  font-family: ui-sans-serif, system-ui, sans-serif;
${declarations}
  --if-accent: var(--if-color-accent, #397461);
  --if-ink: var(--if-color-ink, #181c1a);
  --if-canvas: var(--if-color-canvas, #f3f5f1);
  --if-surface: var(--if-color-surface, #fbfcf9);
  --if-accent-deep: color-mix(in oklab, var(--if-accent) 62%, var(--if-ink));
  --if-accent-soft: color-mix(in oklab, var(--if-accent) 14%, #ffffff);
  --if-hairline: color-mix(in oklab, var(--if-ink) 12%, #ffffff);
  --if-control-radius: var(--if-radius-control, 18px);
  --if-surface-radius: var(--if-radius-surface, 28px);
}
* { box-sizing: border-box; }
body { margin: 0; color: var(--if-ink); background: var(--if-canvas); }
.screen { min-height: 100dvh; max-width: 440px; margin: auto; padding: 28px 22px 110px; background: var(--if-surface); }
.eyebrow { color: var(--if-accent); font-size: 12px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
h1 { margin: 8px 0 28px; font-size: 32px; letter-spacing: -.04em; }
.screen-content { display: grid; gap: 18px; }
.if-node { min-width: 0; padding: var(--if-node-padding, 0); }
.if-axis-vertical > * { display: grid; gap: var(--if-node-gap, 0); }
.if-axis-horizontal > * { display: flex; align-items: center; gap: var(--if-node-gap, 0); }
.if-axis-overlay > * { display: grid; gap: 0; }
.if-axis-overlay > * > * { grid-area: 1 / 1; }
.if-width-hug { width: fit-content; max-width: 100%; }
.if-width-fill, .if-width-fixed { width: 100%; }
.if-emphasis-quiet { opacity: .72; }
.if-emphasis-strong > * { font-weight: 700; }
.if-importance-primary > * { filter: saturate(1.08); }
.if-importance-supporting > * { filter: saturate(.88); }
${spacingClasses}
.balance { display: grid; gap: 6px; padding: 24px; border-radius: var(--if-surface-radius); background: var(--if-accent-deep); color: #ffffff; }
.balance strong { font-size: 36px; letter-spacing: -.04em; }
.balance small { color: rgb(255 255 255 / .62); }
.receipt { display: grid; gap: 6px; padding: 24px; border-radius: var(--if-surface-radius); background: var(--if-accent-soft); text-align: center; }
.receipt strong { font-size: 36px; letter-spacing: -.04em; }
.receipt small { color: color-mix(in oklab, var(--if-ink) 55%, #ffffff); }
.transactions { padding: 0; list-style: none; border-top: 1px solid var(--if-hairline); }
.transactions li { display: flex; justify-content: space-between; padding: 16px 0; border-bottom: 1px solid var(--if-hairline); }
.money-field { display: grid; gap: 8px; }
.money-field input { width: 100%; padding: 20px; border: 1px solid var(--if-hairline); border-radius: var(--if-control-radius); font: inherit; font-size: 28px; }
.recipient { display: flex; align-items: center; gap: 12px; padding: 14px 0; }
.recipient span:last-child { display: grid; gap: 3px; }
.recipient small { color: color-mix(in oklab, var(--if-ink) 58%, #ffffff); }
.avatar { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 50%; background: var(--if-accent-soft); color: var(--if-accent-deep); font-weight: 700; }
button { min-height: 48px; border: 0; border-radius: var(--if-control-radius); font: inherit; font-weight: 700; cursor: pointer; }
button:focus-visible, input:focus-visible { outline: 3px solid color-mix(in oklab, var(--if-accent) 55%, #ffffff); outline-offset: 3px; }
.primary { padding: 16px 20px; color: white; background: var(--if-accent); }
.primary.placement-compact-persistent { position: fixed; right: max(22px, calc((100vw - 396px) / 2)); bottom: max(18px, env(safe-area-inset-bottom)); left: max(22px, calc((100vw - 396px) / 2)); }
.secondary { color: var(--if-accent-deep); background: var(--if-accent-soft); }
.status { padding: 14px; border-left: 3px solid #b65e46; background: #f8e9e3; }
@media (min-width: ${DEVICE_CLASS_LIMITS.compactMaxWidth + 1}px) and (min-height: ${DEVICE_CLASS_LIMITS.compactMaxHeight + 1}px) {
  .primary.placement-compact-persistent { position: static; }
  .primary.placement-regular-persistent { position: fixed; right: max(22px, calc((100vw - 396px) / 2)); bottom: max(18px, env(safe-area-inset-bottom)); left: max(22px, calc((100vw - 396px) / 2)); }
}
`;
}

export class ReactCompiler implements CompilerBackend {
  readonly id = "react" as const;

  capabilities() {
    return { target: this.id, nativeSafeArea: true, adaptivePlacement: true, accessibility: true };
  }

  lower(graph: SemanticInterfaceGraph): PlatformIR {
    return lowerGraph(graph, this.id);
  }

  generate(ir: PlatformIR): GeneratedFileSet {
    const files = [
      ...ir.screens.map((_, index) => ({ path: `src/generated/screens/${ir.screens[index]?.id}.tsx`, content: screenSource(ir, index) })),
      ...ir.screens.map((_, index) => ({ path: `src/generated/contracts/${ir.screens[index]?.id}.ts`, content: contractSource(ir, index) })),
      { path: "src/generated/styles.css", content: stylesSource(ir) },
      { path: "src/generated/App.tsx", content: appSource(ir) },
    ];
    return { target: this.id, files, fingerprint: fingerprintFiles(files), diagnostics: ir.diagnostics };
  }

  validate(output: GeneratedFileSet): CompilerDiagnostic[] {
    const diagnostics: CompilerDiagnostic[] = [];
    for (const file of output.files) {
      if (file.content.includes("position(x")) {
        diagnostics.push({ severity: "error", path: file.path, message: "Absolute positioning escaped the semantic layout compiler." });
      }
    }
    return diagnostics;
  }
}

export function compileReact(graph: SemanticInterfaceGraph): GeneratedFileSet {
  const compiler = new ReactCompiler();
  return validateGeneratedOutput(compiler, compiler.generate(compiler.lower(graph)));
}
