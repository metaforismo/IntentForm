import {
  fingerprintFiles,
  findPrimaryAction,
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

const escapeSwift = (value: string): string => value
  .replaceAll("\\", "\\\\")
  .replaceAll('"', '\\"')
  .replaceAll("\n", "\\n")
  .replaceAll("\r", "\\r");

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

const swiftOptionalNumber = (value: number | undefined): string => value === undefined ? "nil" : String(value);

function swiftNode(node: PlatformIRNode, guardedPrimaryId?: string): string {
  const label = escapeSwift(node.intent.label);
  const value = swiftDisplay(node.bindings.value);
  const detail = node.bindings.detail?.name === node.bindings.value?.name
    ? '""'
    : swiftDisplay(node.bindings.detail);
  const eventCall = swiftEventCall(node);
  const children = node.children.map((child) => swiftNode(child, guardedPrimaryId)).filter(Boolean).join("\n\n");
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
      source = `Button("${label}") { ${eventCall} }\n                        .buttonStyle(.borderedProminent)\n                        .controlSize(.large)\n                        .frame(maxWidth: .infinity)`;
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
    case "stack":
    case "grid":
    case "overlay":
    case "scroll":
    case "safe-area":
    case "adaptive":
    case "wrap":
    case "split":
    case "freeform":
    case "page-flow":
      source = `IntentFormContainer(
                        mode: deviceClass == .compact ? "${node.layout.compactMode}" : "${node.layout.regularMode}",
                        axis: "${node.layout.axis}",
                        gap: ${node.layout.gap},
                        columns: ${node.layout.columns},
                        splitRatio: ${node.layout.splitRatio},
                        align: "${node.layout.align}",
                        justify: "${node.layout.justify}"
                    ) {
                        ${children}
                    }`;
      break;
  }

  if (node.asset?.kind === "raster" && node.asset.exportPolicy !== "blocked") {
    const contentMode = node.asset.fit === "cover" || node.asset.fit === "fill" ? "fill" : "fit";
    source = `VStack(spacing: ${node.layout.gap}) {\n                        Image("${node.asset.digest}")\n                            .resizable()\n                            .aspectRatio(contentMode: .${contentMode})\n                            .clipped()\n                            .accessibilityHidden(${node.asset.decorative})\n                        // IntentForm focal point: ${node.asset.focalPoint.x}, ${node.asset.focalPoint.y}\n                        ${source}\n                    }`;
  }

  source += `\n                        .accessibilityLabel(Text("${escapeSwift(node.accessibility.label)}"))`;
  if (node.accessibility.hint) {
    source += `\n                        .accessibilityHint(Text("${escapeSwift(node.accessibility.hint)}"))`;
  }
  if (node.accessibility.live !== "off") {
    source += `\n                        // IntentForm live region: ${node.accessibility.live}`;
    source += `\n                        .accessibilityAddTraits(.updatesFrequently)`;
  }
  source += `\n                        .accessibilityIdentifier("intentform.${escapeSwift(node.id)}")`;

  source = `IntentFormNodeLayout(\n                        axis: "${node.layout.axis}",\n                        width: "${node.layout.width}",\n                        height: "${node.layout.height}",\n                        fixedWidth: ${swiftOptionalNumber(node.layout.fixedWidth)},\n                        fixedHeight: ${swiftOptionalNumber(node.layout.fixedHeight)},\n                        minWidth: ${swiftOptionalNumber(node.layout.minWidth)},\n                        maxWidth: ${swiftOptionalNumber(node.layout.maxWidth)},\n                        minHeight: ${swiftOptionalNumber(node.layout.minHeight)},\n                        maxHeight: ${swiftOptionalNumber(node.layout.maxHeight)},\n                        x: ${node.layout.position?.x ?? 0},\n                        y: ${node.layout.position?.y ?? 0},\n                        z: ${node.layout.position?.z ?? 0},\n                        gap: ${node.layout.gap},\n                        padding: ${node.layout.padding},\n                        align: "${node.layout.align}",\n                        overflow: "${node.layout.overflow}",\n                        role: "${escapeSwift(node.style.role)}",\n                        emphasis: "${node.style.emphasis}",\n                        importance: "${node.intent.importance}",\n                        purpose: "${escapeSwift(node.intent.purpose)}"\n                    ) {\n                        ${source}\n                    }`;

  if (node.visibility.length > 0) {
    const condition = node.visibility.map((visibility) => visibility.expression
      ? swiftExpression(visibility.expression)
      : node.bindings.status
        ? `data.${swiftMember(node.bindings.status.name)} == "${escapeSwift(visibility.state)}"`
        : "true").join(" || ");
    source = `if ${condition} {\n                    ${source}\n                }`;
  }
  if (guardedPrimaryId === node.id) {
    source = `if !usesPersistentPrimary {\n                    ${source}\n                }`;
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
  const primary = findPrimaryAction(screen);
  const content = screen.nodes.map((node) => `                ${swiftNode(node, primary?.id)}`).join("\n\n");
  const persistentInset = primary
    ? `.safeAreaInset(edge: .bottom) {
                if usesPersistentPrimary {
                    ${swiftNode(primary)}
                        .padding(.horizontal, 20)
                        .padding(.vertical, 12)
                        .background(.regularMaterial)
                }
            }`
    : "";
  const persistentBinding = primary
    ? `            let usesPersistentPrimary = deviceClass == .compact
                ? ${primary.layout.compactPlacement === "persistent-bottom"}
                : ${primary.layout.regularPlacement === "persistent-bottom"}`
    : "";
  const screenBody = `GeometryReader { proxy in
            let viewportFrame = proxy.frame(in: .global)
            let deviceClass = IntentFormDeviceClass.resolve(width: viewportFrame.maxX, height: viewportFrame.maxY)
${persistentBinding}

            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Text("${escapeSwift(ir.productName)}")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(.tint)
                        .accessibilityIdentifier("intentform.${escapeSwift(screen.id)}.scroll-anchor")
${content}
                }
                .padding(20)
            }
            ${persistentInset}
        }`;

  return `import SwiftUI

// Intent: ${escapeSwift(screen.purpose)}
// Route: ${escapeSwift(screen.route)}

${swiftDataSource(screen, name)}

${swiftEventsSource(screen, name)}

struct ${name}: View {
    let data: ${name}Data
    let events: ${name}Events

    var body: some View {
        ${screenBody}
        .navigationTitle("${escapeSwift(screen.title)}")
        .tint(IntentFormTheme.accent)
        .background(IntentFormTheme.surface)
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
  const canvas = parseHex(ir.tokens.colors["color.canvas"], { r: 0.953, g: 0.961, b: 0.945 });
  const surface = parseHex(ir.tokens.colors["color.surface"], { r: 0.984, g: 0.988, b: 0.976 });
  const white: Rgb = { r: 1, g: 1, b: 1 };
  const controlRadius = ir.tokens.radii["radius.control"] ?? 18;
  const surfaceRadius = ir.tokens.radii["radius.surface"] ?? 28;

  return `import SwiftUI

enum IntentFormTheme {
    static let activeMode = "${escapeSwift(ir.activeTokenMode)}"
    static let availableModes = [${Object.keys(ir.tokenModes).sort().map((mode) => `"${escapeSwift(mode)}"`).join(", ")}]
    static let accent = ${swiftColor(accent)}
    static let ink = ${swiftColor(ink)}
    static let canvas = ${swiftColor(canvas)}
    static let surface = ${swiftColor(surface)}
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

struct IntentFormLinearLayout: Layout {
    let axis: String
    let gap: CGFloat
    let align: String
    let justify: String
    let leadingRatio: CGFloat?

    private func naturalSizes(_ subviews: Subviews) -> [CGSize] {
        subviews.map { $0.sizeThatFits(.unspecified) }
    }

    private func mainLength(_ size: CGSize) -> CGFloat {
        axis == "horizontal" ? size.width : size.height
    }

    private func crossLength(_ size: CGSize) -> CGFloat {
        axis == "horizontal" ? size.height : size.width
    }

    func sizeThatFits(
        proposal: ProposedViewSize,
        subviews: Subviews,
        cache: inout ()
    ) -> CGSize {
        let sizes = naturalSizes(subviews)
        let totalGap = gap * CGFloat(max(0, subviews.count - 1))
        let naturalMain = sizes.reduce(0) { $0 + mainLength($1) } + totalGap
        let naturalCross = sizes.map(crossLength).max() ?? 0
        let natural = axis == "horizontal"
            ? CGSize(width: naturalMain, height: naturalCross)
            : CGSize(width: naturalCross, height: naturalMain)
        return CGSize(
            width: proposal.width ?? natural.width,
            height: proposal.height ?? natural.height
        )
    }

    func placeSubviews(
        in bounds: CGRect,
        proposal: ProposedViewSize,
        subviews: Subviews,
        cache: inout ()
    ) {
        guard !subviews.isEmpty else { return }
        let sizes = naturalSizes(subviews)
        let availableMain = axis == "horizontal" ? bounds.width : bounds.height
        let availableCross = axis == "horizontal" ? bounds.height : bounds.width
        let naturalMain = sizes.reduce(0) { $0 + mainLength($1) }
        let minimumGaps = gap * CGFloat(max(0, subviews.count - 1))
        let contentMain = naturalMain + minimumGaps
        var resolvedGap = gap
        var cursor: CGFloat = 0

        if leadingRatio == nil {
            switch justify {
            case "center": cursor = max(0, (availableMain - contentMain) / 2)
            case "end": cursor = max(0, availableMain - contentMain)
            case "space-between" where subviews.count > 1:
                resolvedGap = max(gap, (availableMain - naturalMain) / CGFloat(subviews.count - 1))
            default: break
            }
        }

        let splitContentMain = max(0, availableMain - minimumGaps)
        let clampedRatio = min(0.9, max(0.1, leadingRatio ?? 0.5))
        for (index, subview) in subviews.enumerated() {
            let naturalSize = sizes[index]
            let childMain: CGFloat
            if leadingRatio != nil && subviews.count > 1 {
                childMain = index == 0
                    ? splitContentMain * clampedRatio
                    : splitContentMain * (1 - clampedRatio) / CGFloat(subviews.count - 1)
            } else {
                childMain = mainLength(naturalSize)
            }
            let naturalCross = crossLength(naturalSize)
            let childCross = align == "stretch" ? availableCross : min(availableCross, naturalCross)
            let crossOffset: CGFloat
            switch align {
            case "center": crossOffset = max(0, (availableCross - childCross) / 2)
            case "end": crossOffset = max(0, availableCross - childCross)
            default: crossOffset = 0
            }
            let point = axis == "horizontal"
                ? CGPoint(x: bounds.minX + cursor, y: bounds.minY + crossOffset)
                : CGPoint(x: bounds.minX + crossOffset, y: bounds.minY + cursor)
            let childProposal = axis == "horizontal"
                ? ProposedViewSize(width: childMain, height: childCross)
                : ProposedViewSize(width: childCross, height: childMain)
            subview.place(at: point, anchor: .topLeading, proposal: childProposal)
            cursor += childMain + resolvedGap
        }
    }
}

struct IntentFormContainer<Content: View>: View {
    let mode: String
    let axis: String
    let gap: CGFloat
    let columns: Int
    let splitRatio: CGFloat
    let align: String
    let justify: String
    @ViewBuilder let content: Content

    init(
        mode: String,
        axis: String,
        gap: CGFloat,
        columns: Int,
        splitRatio: CGFloat,
        align: String,
        justify: String,
        @ViewBuilder content: () -> Content
    ) {
        self.mode = mode
        self.axis = axis
        self.gap = gap
        self.columns = columns
        self.splitRatio = splitRatio
        self.align = align
        self.justify = justify
        self.content = content()
    }

    private var gridColumns: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: gap), count: max(1, columns))
    }

    private var horizontalAlignment: HorizontalAlignment {
        switch align {
        case "center": return .center
        case "end": return .trailing
        default: return .leading
        }
    }

    private var overlayAlignment: Alignment {
        switch align {
        case "center": return .center
        case "end": return .bottomTrailing
        default: return .topLeading
        }
    }

    @ViewBuilder var body: some View {
        switch mode {
        case "grid":
            LazyVGrid(columns: gridColumns, alignment: horizontalAlignment, spacing: gap) { content }
        case "overlay", "freeform":
            ZStack(alignment: overlayAlignment) { content }
        case "scroll":
            ScrollView(axis == "horizontal" ? .horizontal : .vertical) {
                IntentFormLinearLayout(
                    axis: axis,
                    gap: gap,
                    align: align,
                    justify: justify,
                    leadingRatio: nil
                ) {
                    content
                }
            }
        case "wrap":
            LazyVGrid(
                columns: [GridItem(.adaptive(minimum: 160), spacing: gap)],
                alignment: horizontalAlignment,
                spacing: gap
            ) { content }
        case "split":
            IntentFormLinearLayout(
                axis: axis,
                gap: gap,
                align: align,
                justify: justify,
                leadingRatio: splitRatio
            ) {
                content
            }
        case "safe-area":
            IntentFormLinearLayout(
                axis: axis,
                gap: gap,
                align: align,
                justify: justify,
                leadingRatio: nil
            ) {
                content
            }
                .padding(.horizontal)
        default:
            IntentFormLinearLayout(
                axis: axis,
                gap: gap,
                align: align,
                justify: justify,
                leadingRatio: nil
            ) {
                content
            }
        }
    }
}

struct IntentFormNodeLayout<Content: View>: View {
    let axis: String
    let width: String
    let height: String
    let fixedWidth: CGFloat?
    let fixedHeight: CGFloat?
    let minWidth: CGFloat?
    let maxWidth: CGFloat?
    let minHeight: CGFloat?
    let maxHeight: CGFloat?
    let x: CGFloat
    let y: CGFloat
    let z: Double
    let gap: CGFloat
    let padding: CGFloat
    let align: String
    let overflow: String
    let role: String
    let emphasis: String
    let importance: String
    let purpose: String
    @ViewBuilder let content: Content

    init(
        axis: String,
        width: String,
        height: String,
        fixedWidth: CGFloat?,
        fixedHeight: CGFloat?,
        minWidth: CGFloat?,
        maxWidth: CGFloat?,
        minHeight: CGFloat?,
        maxHeight: CGFloat?,
        x: CGFloat,
        y: CGFloat,
        z: Double,
        gap: CGFloat,
        padding: CGFloat,
        align: String,
        overflow: String,
        role: String,
        emphasis: String,
        importance: String,
        purpose: String,
        @ViewBuilder content: () -> Content
    ) {
        self.axis = axis
        self.width = width
        self.height = height
        self.fixedWidth = fixedWidth
        self.fixedHeight = fixedHeight
        self.minWidth = minWidth
        self.maxWidth = maxWidth
        self.minHeight = minHeight
        self.maxHeight = maxHeight
        self.x = x
        self.y = y
        self.z = z
        self.gap = gap
        self.padding = padding
        self.align = align
        self.overflow = overflow
        self.role = role
        self.emphasis = emphasis
        self.importance = importance
        self.purpose = purpose
        self.content = content()
    }

    @ViewBuilder private var arrangedContent: some View {
        if axis == "horizontal" {
            HStack(spacing: gap) { content }
        } else if axis == "overlay" {
            ZStack(alignment: .leading) { content }
        } else {
            VStack(alignment: .leading, spacing: gap) { content }
        }
    }

    private var frameAlignment: Alignment {
        switch align {
        case "center": return .center
        case "end": return .trailing
        default: return .leading
        }
    }

    private var resolvedMinWidth: CGFloat? { width == "fixed" ? fixedWidth : minWidth }
    private var resolvedIdealWidth: CGFloat? { width == "fixed" ? fixedWidth : nil }
    private var resolvedMaxWidth: CGFloat? {
        if width == "fill" { return .infinity }
        return width == "fixed" ? fixedWidth : maxWidth
    }
    private var resolvedMinHeight: CGFloat? { height == "fixed" ? fixedHeight : minHeight }
    private var resolvedIdealHeight: CGFloat? { height == "fixed" ? fixedHeight : nil }
    private var resolvedMaxHeight: CGFloat? {
        if height == "fill" { return .infinity }
        return height == "fixed" ? fixedHeight : maxHeight
    }

    @ViewBuilder var body: some View {
        let laidOut = arrangedContent
            .frame(
                minWidth: resolvedMinWidth,
                idealWidth: resolvedIdealWidth,
                maxWidth: resolvedMaxWidth,
                minHeight: resolvedMinHeight,
                idealHeight: resolvedIdealHeight,
                maxHeight: resolvedMaxHeight,
                alignment: frameAlignment
            )
            .padding(padding)
            .offset(x: x, y: y)
            .zIndex(z)
            .opacity(emphasis == "quiet" ? 0.72 : 1)
            .fontWeight(emphasis == "strong" || importance == "primary" ? .semibold : nil)
            .accessibilityValue(Text(purpose))
        if overflow == "clip" {
            laidOut.clipped()
        } else {
            laidOut
        }
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

function deviceProfilesSource(ir: PlatformIR): string {
  const profiles = [...ir.devices.profiles]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((profile) => `        IntentFormDeviceProfile(
            id: "${escapeSwift(profile.id)}",
            width: ${profile.viewport.width},
            height: ${profile.viewport.height},
            scale: ${profile.viewport.scale},
            orientation: "${profile.orientation}",
            safeArea: IntentFormDeviceInsets(top: ${profile.safeArea.top}, right: ${profile.safeArea.right}, bottom: ${profile.safeArea.bottom}, left: ${profile.safeArea.left}),
            cornerRadius: ${profile.corners.radius},
            capabilities: [${profile.capabilities.map((capability) => `"${escapeSwift(capability)}"`).join(", ")}]
        )`)
    .join(",\n");
  return `import SwiftUI

struct IntentFormDeviceInsets: Sendable {
    let top: CGFloat
    let right: CGFloat
    let bottom: CGFloat
    let left: CGFloat
}

struct IntentFormDeviceProfile: Identifiable, Sendable {
    let id: String
    let width: CGFloat
    let height: CGFloat
    let scale: CGFloat
    let orientation: String
    let safeArea: IntentFormDeviceInsets
    let cornerRadius: CGFloat
    let capabilities: [String]
}

enum IntentFormDeviceProfiles {
    static let defaultID = "${escapeSwift(ir.devices.defaultProfile.id)}"
    static let all: [IntentFormDeviceProfile] = [
${profiles}
    ]
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
      { path: "Generated/IntentFormDeviceProfiles.swift", content: deviceProfilesSource(ir) },
      { path: "Generated/IntentFormApp.swift", content: swiftAppSource(ir) },
      ...(ir.assets.length > 0 ? [{
        path: "Generated/Assets.manifest.json",
        content: `${JSON.stringify({
          version: 1,
          assets: ir.assets.map((asset) => ({
            id: asset.id,
            kind: asset.kind,
            digest: asset.digest,
            storageKey: asset.storageKey,
            exportPolicy: asset.exportPolicy,
            license: asset.license,
          })),
        }, null, 2)}\n`,
      }] : []),
    ];
    return { target: this.id, files, fingerprint: fingerprintFiles(files), diagnostics: ir.diagnostics };
  }

  validate(output: GeneratedFileSet): CompilerDiagnostic[] {
    const diagnostics = output.files.flatMap((file) =>
      file.content.includes(".position(")
        ? [{ severity: "error" as const, path: file.path, message: "Absolute position is forbidden outside Freeform." }]
        : [],
    );
    if (!output.files.some((file) => file.path === "Generated/IntentFormDeviceProfiles.swift")) {
      diagnostics.push({ severity: "error", path: "Generated/IntentFormDeviceProfiles.swift", message: "SwiftUI output must include resolved device profile metadata." });
    }
    return diagnostics;
  }
}

export function compileSwiftUI(graph: SemanticInterfaceGraph): GeneratedFileSet {
  const compiler = new SwiftUICompiler();
  return validateGeneratedOutput(compiler, compiler.generate(compiler.lower(graph)));
}
