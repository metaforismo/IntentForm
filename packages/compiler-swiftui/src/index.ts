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

const swiftIdentifier = (value: string): string => {
  const parts = value.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const camel = parts
    .map((part, index) => index === 0
      ? `${part[0]?.toLowerCase() ?? ""}${part.slice(1)}`
      : `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join("") || "generated";
  return /^\d/.test(camel) ? `screen${camel}` : camel;
};

const escapeSwift = (value: string): string => value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');

function swiftNode(node: PlatformIRNode): string {
  const label = escapeSwift(node.label);
  let source: string;
  switch (node.kind) {
    case "balance-summary":
      source = `BalanceSummary(balance: "€8,420.16")`;
      break;
    case "transaction-list":
      source = `TransactionList()`;
      break;
    case "money-input":
      source = `MoneyInput(label: "${label}", amount: $amount)`;
      break;
    case "recipient-identity":
      source = `RecipientIdentity(name: "Mara Rinaldi", handle: "mara@northline.test")`;
      break;
    case "primary-action":
      source = `Button("${label}") { events.onConfirm() }\n                    .buttonStyle(.borderedProminent)\n                    .controlSize(.large)\n                    .frame(maxWidth: .infinity)\n                    .accessibilityLabel("${escapeSwift(node.accessibilityLabel)}")\n                    .accessibilityIdentifier("intentform.${node.id}")`;
      break;
    case "secondary-action":
      source = `Button("${label}") { events.onCancel() }\n                    .buttonStyle(.bordered)`;
      break;
    case "status-message":
      source = `StatusMessage(text: "${label}")`;
      break;
    case "receipt-summary":
      source = `ReceiptSummary(amount: "€120.00", reference: "IF-2048")`;
      break;
  }

  if (node.visibleStates.length > 0) {
    return `if ${JSON.stringify(node.visibleStates)}.contains(data.status) {\n                    ${source}\n                }`;
  }
  return source;
}

function swiftScreen(ir: PlatformIR, screenIndex: number): string {
  const screen = ir.screens[screenIndex];
  if (!screen) throw new Error(`Screen index ${screenIndex} is missing`);
  const name = `${swiftIdentifier(screen.id).replace(/^./, (character) => character.toUpperCase())}Screen`;
  const primary = screen.nodes.find((node) => node.kind === "primary-action");
  const contentNodes = screen.nodes.filter((node) => node.kind !== "primary-action");
  const content = contentNodes.map((node) => `                ${swiftNode(node)}`).join("\n\n");
  const inlineAction = primary ? `\n\n                ${swiftNode(primary)}` : "";
  const safeArea = primary && primary.compactPlacement === "persistent-bottom"
    ? `\n        .safeAreaInset(edge: .bottom) {\n            ${swiftNode(primary)}\n                .padding(.horizontal, 20)\n                .padding(.vertical, 12)\n                .background(.regularMaterial)\n        }`
    : "";

  return `import SwiftUI

struct ${name}Data {
    var status: String = "idle"
}

struct ${name}Events {
    var onConfirm: () -> Void = {}
    var onCancel: () -> Void = {}
}

struct ${name}: View {
    @State private var amount = "120.00"
    let data: ${name}Data
    let events: ${name}Events

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text("${escapeSwift(ir.productName)}")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.tint)
${content}${primary?.compactPlacement === "inline" ? inlineAction : ""}
            }
            .padding(20)
        }${safeArea}
        .navigationTitle("${escapeSwift(screen.title)}")
        .tint(IntentFormTheme.accent)
    }
}
`;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

const parseHex = (value: string | undefined, fallback: Rgb): Rgb => {
  if (typeof value !== "string") return fallback;
  const hex = value.replace("#", "");
  const expanded = hex.length === 3 ? hex.split("").map((char) => char + char).join("") : hex;
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(expanded)) return fallback;
  return {
    r: parseInt(expanded.slice(0, 2), 16) / 255,
    g: parseInt(expanded.slice(2, 4), 16) / 255,
    b: parseInt(expanded.slice(4, 6), 16) / 255,
  };
};

const mix = (a: Rgb, b: Rgb, weight: number): Rgb => ({
  r: a.r * weight + b.r * (1 - weight),
  g: a.g * weight + b.g * (1 - weight),
  b: a.b * weight + b.b * (1 - weight),
});

const swiftColor = (color: Rgb): string =>
  `Color(red: ${color.r.toFixed(3)}, green: ${color.g.toFixed(3)}, blue: ${color.b.toFixed(3)})`;

/* Token resolution: the theme is computed from the graph's design tokens, so a
   token edit deterministically changes the generated Swift on recompile. */
function componentsSource(ir: PlatformIR): string {
  const accent = parseHex(ir.tokens.colors["color.accent"], { r: 0.224, g: 0.455, b: 0.38 });
  const ink = parseHex(ir.tokens.colors["color.ink"], { r: 0.094, g: 0.11, b: 0.102 });
  const white: Rgb = { r: 1, g: 1, b: 1 };
  const controlRadius = ir.tokens.radii["radius.control"] ?? 18;
  const surfaceRadius = ir.tokens.radii["radius.surface"] ?? 28;

  return `import SwiftUI

enum IntentFormTheme {
    static let accent = ${swiftColor(accent)}
    static let accentDeep = ${swiftColor(mix(accent, ink, 0.62))}
    static let accentSoft = ${swiftColor(mix(accent, white, 0.14))}
    static let controlRadius: CGFloat = ${controlRadius}
    static let surfaceRadius: CGFloat = ${surfaceRadius}
}

struct BalanceSummary: View {
    let balance: String
    var body: some View { VStack(alignment: .leading) { Text("Available balance"); Text(balance).font(.system(size: 36, weight: .bold)); Text("Updated just now").font(.caption) }.frame(maxWidth: .infinity, alignment: .leading).padding(24).foregroundStyle(.white).background(IntentFormTheme.accentDeep, in: RoundedRectangle(cornerRadius: IntentFormTheme.surfaceRadius)) }
}
struct TransactionList: View { var body: some View { VStack { LabeledContent("Riva Studio", value: "−€84.20"); Divider(); LabeledContent("Northline Market", value: "−€32.70") } } }
struct MoneyInput: View { let label: String; @Binding var amount: String; var body: some View { TextField(label, text: $amount).keyboardType(.decimalPad).textFieldStyle(.roundedBorder) } }
struct RecipientIdentity: View { let name: String; let handle: String; var body: some View { HStack { Text("MR").font(.caption.bold()).foregroundStyle(IntentFormTheme.accentDeep).frame(width: 44, height: 44).background(IntentFormTheme.accentSoft, in: Circle()); VStack(alignment: .leading) { Text(name).bold(); Text(handle).font(.caption).foregroundStyle(.secondary) } } } }
struct StatusMessage: View { let text: String; var body: some View { Text(text).frame(maxWidth: .infinity, alignment: .leading).padding().background(.orange.opacity(0.12)) } }
struct ReceiptSummary: View { let amount: String; let reference: String; var body: some View { VStack { Text("Payment complete"); Text(amount).font(.largeTitle.bold()); Text(reference).font(.caption) }.frame(maxWidth: .infinity).padding(24).background(IntentFormTheme.accentSoft, in: RoundedRectangle(cornerRadius: IntentFormTheme.surfaceRadius)) } }
`;
}

export class SwiftUICompiler implements CompilerBackend {
  readonly id = "swiftui" as const;

  capabilities() {
    return { target: this.id, nativeSafeArea: true, adaptivePlacement: true, accessibility: true };
  }

  lower(graph: SemanticInterfaceGraph): PlatformIR {
    return lowerGraph(graph, this.id);
  }

  generate(ir: PlatformIR): GeneratedFileSet {
    const files = [
      ...ir.screens.map((screen, index) => ({ path: `Generated/Screens/${swiftIdentifier(screen.id)}.swift`, content: swiftScreen(ir, index) })),
      { path: "Generated/Components/IntentFormComponents.swift", content: componentsSource(ir) },
    ];
    return { target: this.id, files, fingerprint: fingerprintFiles(files) };
  }

  validate(output: GeneratedFileSet): CompilerDiagnostic[] {
    return output.files.flatMap((file) =>
      file.content.includes(".position(")
        ? [{ severity: "error" as const, path: file.path, message: "Absolute position is forbidden outside Freeform." }]
        : [],
    );
  }
}

export function compileSwiftUI(graph: SemanticInterfaceGraph): GeneratedFileSet {
  const compiler = new SwiftUICompiler();
  return compiler.generate(compiler.lower(graph));
}
