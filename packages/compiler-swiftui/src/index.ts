import {
  fingerprintFiles,
  lowerGraph,
  validateGeneratedOutput,
  type CompilerBackend,
  type CompilerDiagnostic,
  type GeneratedFileSet,
  type PlatformIR,
  type PlatformIRField,
  type PlatformIRNode,
} from "@intentform/compiler-core";
import {
  DEVICE_CLASS_LIMITS,
  type Expression,
  type SemanticInterfaceGraph,
} from "@intentform/semantic-schema";

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

const swiftKeywords = new Set([
  "as", "associatedtype", "break", "case", "catch", "class", "continue", "default", "defer", "do",
  "else", "enum", "extension", "fallthrough", "false", "fileprivate", "for", "func", "guard", "if",
  "import", "in", "init", "inout", "internal", "is", "let", "nil", "open", "operator", "private",
  "protocol", "public", "repeat", "rethrows", "return", "self", "static", "struct", "subscript", "super",
  "switch", "throw", "throws", "true", "try", "typealias", "var", "where", "while",
]);

const swiftMember = (value: string): string => swiftKeywords.has(value) ? `\`${value}\`` : value;

const swiftScreenName = (screenId: string): string =>
  `${swiftIdentifier(screenId).replace(/^./, (character) => character.toUpperCase())}Screen`;

const swiftType = (field: PlatformIRField): string => {
  const base = field.type === "number" ? "Double" : field.type === "boolean" ? "Bool" : "String";
  return field.required ? base : `${base}?`;
};

const swiftLiteral = (value: string | number | boolean | undefined, field: PlatformIRField): string => {
  if (value === undefined) return field.required
    ? field.type === "number" ? "0" : field.type === "boolean" ? "false" : field.type === "money" ? '"0.00"' : '""'
    : "nil";
  if (typeof value === "string") return `"${escapeSwift(value)}"`;
  return String(value);
};

const swiftDisplay = (field: PlatformIRField | null): string => {
  if (!field) return '""';
  const member = `data.${swiftMember(field.name)}`;
  return field.required ? `String(describing: ${member})` : `${member}.map { String(describing: $0) } ?? ""`;
};

const swiftExpression = (expression: Expression): string => {
  if (expression.op === "value") {
    if (typeof expression.value === "string") return `"${escapeSwift(expression.value)}"`;
    return String(expression.value);
  }
  if (expression.op === "field") return `data.${swiftMember(expression.path.slice("data.".length))}`;
  if (expression.op === "not") return `!(${swiftExpression(expression.value)})`;
  return `(${swiftExpression(expression.left)} == ${swiftExpression(expression.right)})`;
};

const swiftEventCall = (node: PlatformIRNode): string => node.events.map((event) => {
  const member = `events.${swiftMember(event.name)}`;
  if (!event.payload) return `${member}()`;
  const fallback = event.payload === "string" ? '""' : event.payload === "number" ? "0" : "false";
  const payload = event.payloadField
    ? `data.${swiftMember(event.payloadField.name)}${event.payloadField.required ? "" : ` ?? ${fallback}`}`
    : fallback;
  return `${member}(${payload})`;
}).join("; ");

function swiftNode(node: PlatformIRNode): string {
  const label = escapeSwift(node.label);
  const value = swiftDisplay(node.bindings.value);
  const detail = node.bindings.detail?.name === node.bindings.value?.name
    ? '""'
    : swiftDisplay(node.bindings.detail);
  const eventCall = swiftEventCall(node);
  let source: string;
  switch (node.kind) {
    case "balance-summary":
      source = `BalanceSummary(title: "${label}", value: ${value})`;
      break;
    case "transaction-list":
      source = `TransactionList(title: "${label}", value: ${node.bindings.value ? value : "nil"})`;
      break;
    case "money-input":
      source = `MoneyInput(label: "${label}", initialValue: ${value})`;
      break;
    case "recipient-identity":
      source = `RecipientIdentity(label: "${label}", value: ${value}, detail: ${node.bindings.detail && node.bindings.detail.name !== node.bindings.value?.name ? detail : "nil"})`;
      break;
    case "primary-action":
      source = `Button("${label}") { ${eventCall} }\n                    .buttonStyle(.borderedProminent)\n                    .controlSize(.large)\n                    .frame(maxWidth: .infinity)\n                    .accessibilityLabel("${escapeSwift(node.accessibilityLabel)}")\n                    .accessibilityIdentifier("intentform.${node.id}")`;
      break;
    case "secondary-action":
      source = `Button("${label}") { ${eventCall} }\n                    .buttonStyle(.bordered)`;
      break;
    case "status-message":
      source = `StatusMessage(text: "${label}")`;
      break;
    case "receipt-summary":
      source = `ReceiptSummary(label: "${label}", value: ${value}, detail: ${node.bindings.detail ? detail : "nil"})`;
      break;
  }

  if (node.kind !== "primary-action") {
    source += `\n                    .accessibilityIdentifier("intentform.${escapeSwift(node.id)}")`;
  }

  if (node.visibility.length > 0) {
    const condition = node.visibility.map((visibility) => visibility.expression
      ? swiftExpression(visibility.expression)
      : node.bindings.status
        ? `data.${swiftMember(node.bindings.status.name)} == "${escapeSwift(visibility.state)}"`
        : "true").join(" || ");
    return `if ${condition} {\n                    ${source}\n                }`;
  }
  return source;
}

function swiftDataSource(screen: PlatformIR["screens"][number], name: string): string {
  const fields = screen.contract?.data ?? [];
  const declarations = fields.map((field) =>
    `    var ${swiftMember(field.name)}: ${swiftType(field)} = ${swiftLiteral(screen.defaultFixture.data[field.name], field)}`,
  ).join("\n");
  const fixtureCases = screen.fixtures.map((fixture) => {
    const argumentsSource = fields.map((field) =>
      `${field.name}: ${swiftLiteral(fixture.data[field.name], field)}`,
    ).join(", ");
    return `        case "${escapeSwift(fixture.state)}": return Self(${argumentsSource})`;
  }).join("\n");

  return `struct ${name}Data {
${declarations}

    static func fixture(_ state: String?) -> Self {
        switch state {
${fixtureCases}
        default: return Self()
        }
    }
}`;
}

function swiftEventsSource(screen: PlatformIR["screens"][number], name: string): string {
  const events = screen.contract?.events ?? [];
  const declarations = events.map((event) => {
    const payloadType = event.payload === "number" ? "Double" : event.payload === "boolean" ? "Bool" : "String";
    return event.payload
      ? `    var ${swiftMember(event.name)}: (${payloadType}) -> Void = { _ in }`
      : `    var ${swiftMember(event.name)}: () -> Void = {}`;
  }).join("\n");
  return `struct ${name}Events {${declarations ? `\n${declarations}\n` : ""}}`;
}

function swiftScreen(ir: PlatformIR, screenIndex: number): string {
  const screen = ir.screens[screenIndex];
  if (!screen) throw new Error(`Screen index ${screenIndex} is missing`);
  const name = swiftScreenName(screen.id);
  const primary = screen.nodes.find((node) => node.kind === "primary-action");
  const contentNodes = screen.nodes.filter((node) => node.kind !== "primary-action");
  const content = contentNodes.map((node) => `                ${swiftNode(node)}`).join("\n\n");
  const adaptiveContent = primary
    ? `${content}\n\n                if !usesPersistentPrimary {\n                    ${swiftNode(primary)}\n                }`
    : content;
  const screenBody = primary
    ? `GeometryReader { proxy in
            let viewportFrame = proxy.frame(in: .global)
            let deviceClass = IntentFormDeviceClass.resolve(width: viewportFrame.maxX, height: viewportFrame.maxY)
            let usesPersistentPrimary = deviceClass == .compact
                ? ${primary.compactPlacement === "persistent-bottom"}
                : ${primary.regularPlacement === "persistent-bottom"}

            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Text("${escapeSwift(ir.productName)}")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(.tint)
                        .accessibilityIdentifier("intentform.${escapeSwift(screen.id)}.scroll-anchor")
${adaptiveContent}
                }
                .padding(20)
            }
            .safeAreaInset(edge: .bottom) {
                if usesPersistentPrimary {
                    ${swiftNode(primary)}
                        .padding(.horizontal, 20)
                        .padding(.vertical, 12)
                        .background(.regularMaterial)
                }
            }
        }`
    : `ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text("${escapeSwift(ir.productName)}")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.tint)
                    .accessibilityIdentifier("intentform.${escapeSwift(screen.id)}.scroll-anchor")
${content}
            }
            .padding(20)
        }`;

  return `import SwiftUI

${swiftDataSource(screen, name)}

${swiftEventsSource(screen, name)}

struct ${name}: View {
    let data: ${name}Data
    let events: ${name}Events

    var body: some View {
        ${screenBody}
        .navigationTitle("${escapeSwift(screen.title)}")
        .tint(IntentFormTheme.accent)
    }
}
`;
}

function swiftAppSource(ir: PlatformIR): string {
  const initialScreen = ir.screens[0];
  if (!initialScreen) throw new Error("SwiftUI output needs at least one screen");
  const screenIds = ir.screens.map((screen) => `"${escapeSwift(screen.id)}"`).join(", ");
  const branches = ir.screens.map((screen) => {
    const name = swiftScreenName(screen.id);
    const eventArguments = (screen.contract?.events ?? []).map((event) => {
      const target = screen.eventTargets[event.name];
      const body = target ? `screen = "${escapeSwift(target)}"` : "";
      const closure = event.payload ? `{ _ in ${body} }` : `{ ${body} }`;
      return `${event.name}: ${closure}`;
    }).join(", ");
    return `            case "${escapeSwift(screen.id)}":
                ${name}(
                    data: ${name}Data.fixture(fixtureState),
                    events: ${name}Events(${eventArguments})
                )`;
  }).join("\n");
  const firstName = swiftScreenName(initialScreen.id);
  const firstEventArguments = (initialScreen.contract?.events ?? []).map((event) => {
    const target = initialScreen.eventTargets[event.name];
    const body = target ? `screen = "${escapeSwift(target)}"` : "";
    return `${event.name}: ${event.payload ? `{ _ in ${body} }` : `{ ${body} }`}`;
  }).join(", ");

  return `import SwiftUI

struct GeneratedIntentFormApp: View {
    @State private var screen: String
    let fixtureState: String?

    init(initialScreen: String = "${escapeSwift(initialScreen.id)}", fixtureState: String? = nil) {
        let supportedScreens = [${screenIds}]
        _screen = State(initialValue: supportedScreens.contains(initialScreen) ? initialScreen : "${escapeSwift(initialScreen.id)}")
        self.fixtureState = fixtureState
    }

    var body: some View {
        NavigationStack {
            switch screen {
${branches}
            default:
                ${firstName}(
                    data: ${firstName}Data.fixture(fixtureState),
                    events: ${firstName}Events(${firstEventArguments})
                )
            }
        }
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

enum IntentFormDeviceClass {
    case compact
    case regular

    static func resolve(width: CGFloat, height: CGFloat) -> Self {
        width <= ${DEVICE_CLASS_LIMITS.compactMaxWidth} || height <= ${DEVICE_CLASS_LIMITS.compactMaxHeight}
            ? .compact
            : .regular
    }
}

struct BalanceSummary: View {
    let title: String
    let value: String
    var body: some View { VStack(alignment: .leading) { Text(title); Text(value).font(.system(size: 36, weight: .bold)) }.frame(maxWidth: .infinity, alignment: .leading).padding(24).foregroundStyle(.white).background(IntentFormTheme.accentDeep, in: RoundedRectangle(cornerRadius: IntentFormTheme.surfaceRadius)) }
}
struct TransactionList: View {
    let title: String
    let value: String?
    var body: some View { VStack(alignment: .leading) { Text(title).font(.headline); if let value, !value.isEmpty { Text(value) } }.frame(maxWidth: .infinity, alignment: .leading) }
}
struct MoneyInput: View {
    let label: String
    @State private var value: String
    init(label: String, initialValue: String) { self.label = label; _value = State(initialValue: initialValue) }
    var body: some View { TextField(label, text: $value).keyboardType(.decimalPad).textFieldStyle(.roundedBorder) }
}
struct RecipientIdentity: View {
    let label: String
    let value: String
    let detail: String?
    var body: some View { HStack { Text(String(value.prefix(2)).uppercased()).font(.caption.bold()).foregroundStyle(IntentFormTheme.accentDeep).frame(width: 44, height: 44).background(IntentFormTheme.accentSoft, in: Circle()); VStack(alignment: .leading) { Text(label).font(.caption).foregroundStyle(.secondary); Text(value).bold(); if let detail, !detail.isEmpty { Text(detail).font(.caption).foregroundStyle(.secondary) } } } }
}
struct StatusMessage: View {
    let text: String
    var body: some View { Text(text).frame(maxWidth: .infinity, alignment: .leading).padding().background(.orange.opacity(0.12)) }
}
struct ReceiptSummary: View {
    let label: String
    let value: String
    let detail: String?
    var body: some View { VStack { Text(label); Text(value).font(.largeTitle.bold()); if let detail, !detail.isEmpty { Text(detail).font(.caption) } }.frame(maxWidth: .infinity).padding(24).background(IntentFormTheme.accentSoft, in: RoundedRectangle(cornerRadius: IntentFormTheme.surfaceRadius)) }
}
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
      { path: "Generated/IntentFormApp.swift", content: swiftAppSource(ir) },
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
  return validateGeneratedOutput(compiler, compiler.generate(compiler.lower(graph)));
}
