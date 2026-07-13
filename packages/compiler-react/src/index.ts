import {
  fingerprintFiles,
  lowerGraph,
  type CompilerBackend,
  type CompilerDiagnostic,
  type GeneratedFileSet,
  type PlatformIR,
  type PlatformIRNode,
} from "@intentform/compiler-core";
import type { SemanticInterfaceGraph } from "@intentform/semantic-schema";

const componentForNode = (node: PlatformIRNode): string => {
  const label = `{${JSON.stringify(node.label)}}`;
  const handler = node.eventName ? ` onClick={events.${node.eventName}}` : "";
  let source: string;
  switch (node.kind) {
    case "balance-summary":
      source = `<section className="balance" aria-label={${JSON.stringify(node.accessibilityLabel)}}><span>Available balance</span><strong>€8,420.16</strong><small>Updated just now</small></section>`;
      break;
    case "transaction-list":
      source = `<section aria-label={${JSON.stringify(node.accessibilityLabel)}}><h2>Recent activity</h2><ul className="transactions"><li><span>Riva Studio</span><strong>−€84.20</strong></li><li><span>Northline Market</span><strong>−€32.70</strong></li></ul></section>`;
      break;
    case "money-input":
      source = `<label className="money-field"><span>${label}</span><input inputMode="decimal" defaultValue="120.00" aria-label={${JSON.stringify(node.accessibilityLabel)}} /></label>`;
      break;
    case "recipient-identity":
      source = `<section className="recipient" aria-label={${JSON.stringify(node.accessibilityLabel)}}><span className="avatar" aria-hidden="true">MR</span><span><strong>Mara Rinaldi</strong><small>mara@northline.test</small></span></section>`;
      break;
    case "primary-action": {
      const className = node.compactPlacement === "persistent-bottom" ? "primary persistent" : "primary";
      source = `<button className="${className}" type="button" aria-label={${JSON.stringify(node.accessibilityLabel)}}${handler}>${label}</button>`;
      break;
    }
    case "secondary-action":
      source = `<button className="secondary" type="button"${handler}>${label}</button>`;
      break;
    case "status-message":
      source = `<p role="status" className="status">${label}</p>`;
      break;
    case "receipt-summary":
      source = `<section className="receipt" aria-label={${JSON.stringify(node.accessibilityLabel)}}><span>Payment complete</span><strong>€120.00</strong><small>Reference IF-2048</small></section>`;
      break;
    default:
      source = `<div>${label}</div>`;
  }

  if (node.visibleStates.length > 0) {
    return `{${JSON.stringify(node.visibleStates)}.includes(data.status) ? (${source}) : null}`;
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
    <main className="screen" data-screen-id="${screen.id}">
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

const defaultValue = (type: "string" | "number" | "boolean" | "money" | "status"): unknown => {
  if (type === "number") return 0;
  if (type === "boolean") return false;
  return type === "status" ? "idle" : "";
};

function appSource(ir: PlatformIR): string {
  const imports = ir.screens
    .map((screen) => `import { ${componentName(screen.id)} } from "./screens/${screen.id}";`)
    .join("\n");
  const screenIds = ir.screens.map((screen) => JSON.stringify(screen.id)).join(" | ");
  const initialScreen = ir.screens[0]?.id;
  if (!initialScreen) throw new Error("React output needs at least one screen");

  const branches = ir.screens.map((screen) => {
    const data = Object.fromEntries(
      (screen.contract?.data ?? []).map((field) => [
        field.name,
        screen.fixture[field.name] ?? defaultValue(field.type),
      ]),
    );
    const events = (screen.contract?.events ?? []).map((event) => {
      const target = screen.eventTargets[event.name];
      const argument = event.payload ? `_payload: ${event.payload}` : "";
      return `          ${event.name}: (${argument}) => ${target ? `setScreen(${JSON.stringify(target)})` : "undefined"},`;
    }).join("\n");
    return `      {screen === ${JSON.stringify(screen.id)} ? (
        <${componentName(screen.id)}
          data={${JSON.stringify(data)}}
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

export function GeneratedApp() {
  const requestedScreen = new URLSearchParams(window.location.search).get("screen") as ScreenId | null;
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

const styles = `:root { color-scheme: light; font-family: ui-sans-serif, system-ui, sans-serif; }
* { box-sizing: border-box; }
body { margin: 0; color: #181c1a; background: #f3f5f1; }
.screen { min-height: 100dvh; max-width: 440px; margin: auto; padding: 28px 22px 110px; background: #fbfcf9; }
.eyebrow { color: #397461; font-size: 12px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
h1 { margin: 8px 0 28px; font-size: 32px; letter-spacing: -.04em; }
.screen-content { display: grid; gap: 18px; }
.balance, .receipt { display: grid; gap: 6px; padding: 24px; border-radius: 28px; background: #173c32; color: #f7fbf8; }
.balance strong, .receipt strong { font-size: 36px; letter-spacing: -.04em; }
.balance small, .receipt small { color: #a8c7bc; }
.transactions { padding: 0; list-style: none; border-top: 1px solid #dce2dd; }
.transactions li { display: flex; justify-content: space-between; padding: 16px 0; border-bottom: 1px solid #dce2dd; }
.money-field { display: grid; gap: 8px; }
.money-field input { width: 100%; padding: 20px; border: 1px solid #cfd8d1; border-radius: 20px; font: inherit; font-size: 28px; }
.recipient { display: flex; align-items: center; gap: 12px; padding: 14px 0; }
.recipient span:last-child { display: grid; gap: 3px; }
.recipient small { color: #69736e; }
.avatar { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 50%; background: #dcebe4; color: #285a49; font-weight: 700; }
button { min-height: 48px; border: 0; border-radius: 18px; font: inherit; font-weight: 700; cursor: pointer; }
button:focus-visible, input:focus-visible { outline: 3px solid #79a995; outline-offset: 3px; }
.primary { padding: 16px 20px; color: white; background: #397461; }
.primary.persistent { position: fixed; right: max(22px, calc((100vw - 396px) / 2)); bottom: max(18px, env(safe-area-inset-bottom)); left: max(22px, calc((100vw - 396px) / 2)); }
.secondary { color: #397461; background: #e7eee9; }
.status { padding: 14px; border-left: 3px solid #b65e46; background: #f8e9e3; }
@media (min-width: 700px) { .primary.persistent { position: static; } }
`;

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
      { path: "src/generated/styles.css", content: styles },
      { path: "src/generated/App.tsx", content: appSource(ir) },
    ];
    return { target: this.id, files, fingerprint: fingerprintFiles(files) };
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
  return compiler.generate(compiler.lower(graph));
}
