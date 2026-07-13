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
  const label = JSON.stringify(node.label);
  switch (node.kind) {
    case "balance-summary":
      return `<section className="balance" aria-label={${JSON.stringify(node.accessibilityLabel)}}><span>Available balance</span><strong>€8,420.16</strong><small>Updated just now</small></section>`;
    case "transaction-list":
      return `<section aria-label={${JSON.stringify(node.accessibilityLabel)}}><h2>Recent activity</h2><ul className="transactions"><li><span>Riva Studio</span><strong>−€84.20</strong></li><li><span>Northline Market</span><strong>−€32.70</strong></li></ul></section>`;
    case "money-input":
      return `<label className="money-field"><span>${node.label}</span><input inputMode="decimal" defaultValue="120.00" aria-label={${JSON.stringify(node.accessibilityLabel)}} /></label>`;
    case "recipient-identity":
      return `<section className="recipient" aria-label={${JSON.stringify(node.accessibilityLabel)}}><span className="avatar" aria-hidden="true">MR</span><span><strong>Mara Rinaldi</strong><small>mara@northline.test</small></span></section>`;
    case "primary-action": {
      const className = node.compactPlacement === "persistent-bottom" ? "primary persistent" : "primary";
      return `<button className="${className}" type="button" aria-label={${JSON.stringify(node.accessibilityLabel)}}>${label}</button>`;
    }
    case "secondary-action":
      return `<button className="secondary" type="button">${label}</button>`;
    case "status-message":
      return `<p role="status" className="status">${label}</p>`;
    case "receipt-summary":
      return `<section className="receipt" aria-label={${JSON.stringify(node.accessibilityLabel)}}><span>Payment complete</span><strong>€120.00</strong><small>Reference IF-2048</small></section>`;
    default:
      return `<div>${label}</div>`;
  }
};

function screenSource(ir: PlatformIR, screenIndex: number): string {
  const screen = ir.screens[screenIndex];
  if (!screen) throw new Error(`Screen index ${screenIndex} is missing`);
  const body = screen.nodes.map((node) => `        ${componentForNode(node)}`).join("\n");
  const componentName = `${screen.id.replace(/(^|-)([a-z])/g, (_, __, char: string) => char.toUpperCase())}Screen`;
  return `import type { ${componentName}Data, ${componentName}Events } from "../contracts/${screen.id}";

export interface ${componentName}Props {
  data: ${componentName}Data;
  events: ${componentName}Events;
}

export function ${componentName}({ data: _data, events: _events }: ${componentName}Props) {
  return (
    <main className="screen" data-screen-id="${screen.id}">
      <header><span className="eyebrow">${ir.productName}</span><h1>${screen.title}</h1></header>
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
  const componentName = `${screen.id.replace(/(^|-)([a-z])/g, (_, __, char: string) => char.toUpperCase())}Screen`;
  const fields = screen.contract?.data.map((field) => `  ${field.name}${field.required ? "" : "?"}: ${field.type === "number" ? "number" : field.type === "boolean" ? "boolean" : "string"};`).join("\n") ?? "  readonly empty: never;";
  const events = screen.contract?.events.map((event) => `  ${event.name}(${event.payload ? `payload: ${event.payload}` : ""}): void;`).join("\n") ?? "  readonly empty: never;";
  return `export interface ${componentName}Data {\n${fields}\n}\n\nexport interface ${componentName}Events {\n${events}\n}\n`;
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
.primary { padding: 16px 20px; color: white; background: #397461; }
.primary.persistent { position: fixed; right: max(22px, calc((100vw - 396px) / 2)); bottom: max(18px, env(safe-area-inset-bottom)); left: max(22px, calc((100vw - 396px) / 2)); }
.secondary { color: #397461; background: #e7eee9; }
.status { padding: 14px; border-left: 3px solid #b65e46; background: #f8e9e3; }
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
