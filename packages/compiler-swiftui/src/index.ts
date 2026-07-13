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
  switch (node.kind) {
    case "balance-summary":
      return `BalanceSummary(balance: "€8,420.16")`;
    case "transaction-list":
      return `TransactionList()`;
    case "money-input":
      return `MoneyInput(label: "${label}", amount: $amount)`;
    case "recipient-identity":
      return `RecipientIdentity(name: "Mara Rinaldi", handle: "mara@northline.test")`;
    case "primary-action":
      return `Button("${label}") { events.onConfirm() }\n                    .buttonStyle(.borderedProminent)\n                    .controlSize(.large)\n                    .frame(maxWidth: .infinity)\n                    .accessibilityLabel("${escapeSwift(node.accessibilityLabel)}")`;
    case "secondary-action":
      return `Button("${label}") { events.onCancel() }\n                    .buttonStyle(.bordered)`;
    case "status-message":
      return `StatusMessage(text: "${label}")`;
    case "receipt-summary":
      return `ReceiptSummary(amount: "€120.00", reference: "IF-2048")`;
  }
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
                Text("${escapeSwift(screen.title)}")
                    .font(.largeTitle.bold())
${content}${primary?.compactPlacement === "inline" ? inlineAction : ""}
            }
            .padding(20)
        }${safeArea}
        .navigationTitle("${escapeSwift(screen.title)}")
    }
}
`;
}

const components = `import SwiftUI

struct BalanceSummary: View {
    let balance: String
    var body: some View { VStack(alignment: .leading) { Text("Available balance"); Text(balance).font(.system(size: 36, weight: .bold)); Text("Updated just now").font(.caption) }.frame(maxWidth: .infinity, alignment: .leading).padding(24).foregroundStyle(.white).background(Color(red: 0.09, green: 0.24, blue: 0.20), in: RoundedRectangle(cornerRadius: 28)) }
}
struct TransactionList: View { var body: some View { VStack { LabeledContent("Riva Studio", value: "−€84.20"); Divider(); LabeledContent("Northline Market", value: "−€32.70") } } }
struct MoneyInput: View { let label: String; @Binding var amount: String; var body: some View { TextField(label, text: $amount).keyboardType(.decimalPad).textFieldStyle(.roundedBorder) } }
struct RecipientIdentity: View { let name: String; let handle: String; var body: some View { HStack { Text("MR").font(.caption.bold()).frame(width: 44, height: 44).background(.green.opacity(0.15), in: Circle()); VStack(alignment: .leading) { Text(name).bold(); Text(handle).font(.caption).foregroundStyle(.secondary) } } } }
struct StatusMessage: View { let text: String; var body: some View { Text(text).frame(maxWidth: .infinity, alignment: .leading).padding().background(.orange.opacity(0.12)) } }
struct ReceiptSummary: View { let amount: String; let reference: String; var body: some View { VStack { Text("Payment complete"); Text(amount).font(.largeTitle.bold()); Text(reference).font(.caption) }.frame(maxWidth: .infinity).padding(24).background(.green.opacity(0.12), in: RoundedRectangle(cornerRadius: 28)) } }
`;

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
      { path: "Generated/Components/IntentFormComponents.swift", content: components },
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
