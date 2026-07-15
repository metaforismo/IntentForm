import {
  fingerprintFiles,
  flattenIRNodes,
  lowerGraph,
  validateGeneratedOutput,
  type CompilerBackend,
  type CompilerDiagnostic,
  type GeneratedFile,
  type GeneratedFileSet,
  type PlatformIR,
  type PlatformIRNode,
  type PlatformIRScreen,
} from "@intentform/compiler-core";
import { DEVICE_CLASS_LIMITS, type Expression, type SemanticInterfaceGraph } from "@intentform/semantic-schema";

const EXPO_DEPENDENCIES = {
  expo: "~57.0.4",
  "expo-image": "~57.0.0",
  "expo-linking": "~57.0.2",
  "expo-router": "~57.0.4",
  "expo-status-bar": "~57.0.0",
  react: "19.2.3",
  "react-dom": "19.2.3",
  "react-native": "0.86.0",
  "react-native-safe-area-context": "~5.7.0",
  "react-native-screens": "4.25.2",
} as const;

const sourceIdentifier = (value: string) => [...value].map((character) =>
  character === "." ? "_dot_" : character === "-" ? "_dash_" : character,
).join("");

const fileFragment = (value: string) => [...value].map((character) =>
  character === "." ? "-dot-" : character === "-" ? "-dash-" : character,
).join("");

function componentName(value: string, suffix: string): string {
  const encoded = sourceIdentifier(value);
  const capitalized = `${encoded[0]?.toUpperCase() ?? ""}${encoded.slice(1)}` || "Generated";
  return `${/^\d/.test(capitalized) ? `Generated${capitalized}` : capitalized}${suffix}`;
}

function routeFilePath(route: string): string {
  return route === "/" ? "app/index.tsx" : `app/${route.slice(1)}.tsx`;
}

function nativeExpression(expression: Expression): string {
  if (expression.op === "value") return JSON.stringify(expression.value);
  if (expression.op === "field") return `data.${expression.path.slice("data.".length)}`;
  if (expression.op === "not") return `!(${nativeExpression(expression.value)})`;
  return `(${nativeExpression(expression.left)} === ${nativeExpression(expression.right)})`;
}

function fieldValue(node: PlatformIRNode, binding: "value" | "detail"): string | null {
  const field = node.bindings[binding];
  return field ? `String(data.${field.name} ?? "")` : null;
}

function eventCallback(node: PlatformIRNode): string | null {
  if (node.events.length === 0) return null;
  const calls = node.events.map((event) => {
    if (!event.payload) return `events.${event.name}()`;
    const fallback = event.payload === "number" ? "0" : event.payload === "boolean" ? "false" : '""';
    const value = event.payloadField ? `data.${event.payloadField.name} ?? ${fallback}` : fallback;
    return `events.${event.name}(${value})`;
  });
  return `() => { ${calls.join("; ")}; }`;
}

function accessibility(node: PlatformIRNode, role?: string): string {
  const hint = node.accessibility.hint ? ` accessibilityHint=${JSON.stringify(node.accessibility.hint)}` : "";
  const live = node.accessibility.live === "off" ? "" : ` accessibilityLiveRegion=${JSON.stringify(node.accessibility.live)}`;
  const accessibilityRole = role ? ` accessibilityRole=${JSON.stringify(role)}` : "";
  return ` accessible accessibilityLabel=${JSON.stringify(node.accessibility.label)}${hint}${live}${accessibilityRole}`;
}

function layoutLiteral(node: PlatformIRNode): string {
  return JSON.stringify({
    compactMode: node.layout.compactMode,
    regularMode: node.layout.regularMode,
    axis: node.layout.axis,
    width: node.layout.width,
    height: node.layout.height,
    fixedWidth: node.layout.fixedWidth,
    fixedHeight: node.layout.fixedHeight,
    minWidth: node.layout.minWidth,
    maxWidth: node.layout.maxWidth,
    minHeight: node.layout.minHeight,
    maxHeight: node.layout.maxHeight,
    align: node.layout.align,
    justify: node.layout.justify,
    overflow: node.layout.overflow,
    columns: node.layout.columns,
    splitRatio: node.layout.splitRatio,
    position: node.layout.position,
    gap: node.layout.gap,
    padding: node.layout.padding,
  });
}

function universalNodeSource(node: PlatformIRNode, renderChild: (child: PlatformIRNode) => string): string {
  const label = JSON.stringify(node.intent.label);
  const value = fieldValue(node, "value");
  const detail = fieldValue(node, "detail");
  const callback = eventCallback(node);
  const children = node.children.map(renderChild).join("\n");
  let content: string;
  switch (node.kind) {
    case "primary-action":
      content = `<Pressable testID=${JSON.stringify(`action-${node.id}`)}${accessibility(node, "button")}${callback ? ` onPress={${callback}}` : ""} style={({ pressed }) => [styles.primaryAction, pressed && styles.pressed]}><Text selectable allowFontScaling style={styles.primaryActionLabel}>{${label}}</Text></Pressable>`;
      break;
    case "secondary-action":
      content = `<Pressable${accessibility(node, "button")}${callback ? ` onPress={${callback}}` : ""} style={({ pressed }) => [styles.secondaryAction, pressed && styles.pressed]}><Text selectable allowFontScaling style={styles.secondaryActionLabel}>{${label}}</Text></Pressable>`;
      break;
    case "money-input":
      content = `<View style={styles.field}><Text selectable allowFontScaling style={styles.fieldLabel}>{${label}}</Text><TextInput allowFontScaling${accessibility(node)} keyboardType="decimal-pad" defaultValue={${value ?? '""'}} style={styles.input} /></View>`;
      break;
    case "balance-summary":
      content = `<View${accessibility(node, "summary")} style={styles.card}><Text selectable allowFontScaling style={styles.eyebrow}>{${label}}</Text>${value ? `<Text selectable allowFontScaling style={styles.heroValue}>{${value}}</Text>` : ""}</View>`;
      break;
    case "transaction-list":
      content = `<View${accessibility(node, "list")} style={styles.card}><Text selectable allowFontScaling style={styles.sectionTitle}>{${label}}</Text>${value ? `<Text selectable allowFontScaling style={styles.body}>{${value}}</Text>` : ""}</View>`;
      break;
    case "recipient-identity":
      content = `<View${accessibility(node, "summary")} style={styles.card}><Text selectable allowFontScaling style={styles.sectionTitle}>{${value ?? label}}</Text>${detail ? `<Text selectable allowFontScaling style={styles.body}>{${detail}}</Text>` : ""}</View>`;
      break;
    case "status-message":
      content = `<View${accessibility(node)} style={styles.status}><Text selectable allowFontScaling style={styles.body}>{${label}}</Text></View>`;
      break;
    case "receipt-summary":
      content = `<View${accessibility(node, "summary")} style={styles.card}><Text selectable allowFontScaling style={styles.sectionTitle}>{${label}}</Text>${detail ? `<Text selectable allowFontScaling style={styles.heroValue}>{${detail}}</Text>` : ""}${value ? `<Text selectable allowFontScaling style={styles.body}>{${value}}</Text>` : ""}</View>`;
      break;
    default:
      content = `<View${accessibility(node)} style={containerStyle(${layoutLiteral(node)}, compact)}>${children}</View>`;
  }

  if (node.asset?.exportPolicy === "copy" && !["font", "audio", "video"].includes(node.asset.kind)) {
    const fit = node.asset.fit === "fill" ? "fill" : node.asset.fit === "none" ? "none" : node.asset.fit;
    content = `<View style={styles.media}><Image source={require(${JSON.stringify(`../../${node.asset.storageKey}`)})} contentFit=${JSON.stringify(fit)} accessibilityLabel=${JSON.stringify(node.asset.decorative ? "" : node.accessibility.label)} style={styles.image} />${content}</View>`;
  }
  return `<View testID=${JSON.stringify(`node-${node.id}`)} style={nodeStyle(${layoutLiteral(node)})}>${content}</View>`;
}

function nodeSource(node: PlatformIRNode, raw = false): string {
  const universal = universalNodeSource(node, (child) => nodeSource(child));
  const callback = eventCallback(node);
  let source = universal;
  if (node.expo?.strategy === "platform-native") {
    const adapter = componentName(node.expo.adapter, "NativeAdapter");
    source = `<${adapter} kind=${JSON.stringify(node.kind)} label=${JSON.stringify(node.intent.label)} value={${fieldValue(node, "value") ?? '""'}}${callback ? ` onPress={${callback}}` : ""} fallback={${universal}} />`;
  } else if (node.expo?.strategy === "project-component") {
    const projectComponent = componentName(node.expo.componentId, "ProjectComponent");
    source = `<${projectComponent} data={data} events={events} intent={${JSON.stringify(node.intent)}} fallback={${universal}} />`;
  }
  if (!raw && node.kind === "primary-action") {
    const inline = `(compact ? ${node.layout.compactPlacement !== "persistent-bottom"} : ${node.layout.regularPlacement !== "persistent-bottom"})`;
    source = `{${inline} ? (${source}) : null}`;
  }
  if (node.visibility.length > 0) {
    const condition = node.visibility.map((entry) => entry.expression
      ? nativeExpression(entry.expression)
      : node.bindings.status ? `data.${node.bindings.status.name} === ${JSON.stringify(entry.state)}` : "true").join(" || ");
    source = `{${condition} ? (${source}) : null}`;
  }
  return source;
}

function contractSource(screen: PlatformIRScreen): string {
  const name = componentName(screen.id, "Screen");
  const fields = screen.contract?.data.map((field) =>
    `  ${field.name}${field.required ? "" : "?"}: ${field.type === "number" ? "number" : field.type === "boolean" ? "boolean" : "string"};`).join("\n")
    ?? "  readonly empty?: never;";
  const events = screen.contract?.events.map((event) =>
    `  ${event.name}(${event.payload ? `payload: ${event.payload}` : ""}): void;`).join("\n")
    ?? "  readonly empty?: never;";
  return `export interface ${name}Data {\n${fields}\n}\n\nexport interface ${name}Events {\n${events}\n}\n`;
}

function screenSource(screen: PlatformIRScreen, productName: string): string {
  const name = componentName(screen.id, "Screen");
  const nodes = flattenIRNodes(screen.nodes);
  const nativeAdapters = new Map(nodes.flatMap((node) => node.expo?.strategy === "platform-native"
    ? [[node.expo.adapter, componentName(node.expo.adapter, "NativeAdapter")] as const]
    : []));
  const projectComponents = new Map(nodes.flatMap((node) => node.expo?.strategy === "project-component"
    ? [[node.expo.componentId, componentName(node.expo.componentId, "ProjectComponent")] as const]
    : []));
  const adapterImports = [...nativeAdapters].map(([id, identifier]) =>
    `import { NativeAdapter as ${identifier} } from "@/adapters/${fileFragment(id)}";`).join("\n");
  const projectImports = [...projectComponents].map(([id, identifier]) =>
    `import ${identifier} from "@/project-components/${fileFragment(id)}";`).join("\n");
  const primary = nodes.find((node) => node.kind === "primary-action");
  const persistent = primary
    ? `(compact ? ${primary.layout.compactPlacement === "persistent-bottom"} : ${primary.layout.regularPlacement === "persistent-bottom"})`
    : "false";
  return `import { useMemo } from "react";
import { Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ${name}Data, ${name}Events } from "@/contracts/${fileFragment(screen.id)}";
import { containerStyle, nodeStyle } from "@/runtime/layout";
import { createIntentFormStyles } from "@/theme/styles";
import { useIntentFormTheme } from "@/theme/tokens";
${adapterImports}
${projectImports}

export interface ${name}Props {
  data: ${name}Data;
  events: ${name}Events;
}

export function ${name}({ data, events }: ${name}Props) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const compact = width <= ${DEVICE_CLASS_LIMITS.compactMaxWidth} || height <= ${DEVICE_CLASS_LIMITS.compactMaxHeight};
  const theme = useIntentFormTheme();
  const styles = useMemo(() => createIntentFormStyles(theme), [theme]);
  const persistent = ${persistent};
  return (
    <View style={styles.screen} testID=${JSON.stringify(`screen-${screen.id}`)}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.scrollContent, { paddingBottom: persistent ? 24 : Math.max(insets.bottom, 24) }]}
      >
        <View style={styles.header}>
          <Text selectable allowFontScaling style={styles.eyebrow}>{${JSON.stringify(productName)}}</Text>
          <Text selectable allowFontScaling accessibilityRole="header" style={styles.title}>{${JSON.stringify(screen.title)}}</Text>
          <Text selectable allowFontScaling style={styles.body}>{${JSON.stringify(screen.purpose)}}</Text>
        </View>
        <View style={styles.content}>
          ${screen.nodes.map((node) => nodeSource(node)).join("\n          ")}
        </View>
      </ScrollView>
${primary ? `      {persistent ? <View style={[styles.persistentAction, { paddingBottom: Math.max(insets.bottom, 12) }]}>${nodeSource(primary, true)}</View> : null}\n` : ""}
    </View>
  );
}
`;
}

function routeSource(ir: PlatformIR, screen: PlatformIRScreen): string {
  const name = componentName(screen.id, "Screen");
  const fixtures = screen.fixtures.length > 0 ? screen.fixtures : [screen.defaultFixture];
  const fixtureObject = JSON.stringify(Object.fromEntries(fixtures.map((fixture) => [fixture.state, fixture.data])), null, 2);
  const eventLines = (screen.contract?.events ?? []).map((event) => {
    const target = ir.screens.find((candidate) => candidate.id === screen.eventTargets[event.name]);
    const parameters = event.payload ? `_payload: ${event.payload}` : "";
    return `    ${event.name}: (${parameters}) => ${target ? `router.push(${JSON.stringify(target.route)})` : "undefined"},`;
  }).join("\n");
  return `import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { ${name} } from "@/screens/${fileFragment(screen.id)}";
import type { ${name}Data } from "@/contracts/${fileFragment(screen.id)}";

const fixtures = ${fixtureObject} as const satisfies Record<string, ${name}Data>;
const defaultState = ${JSON.stringify(screen.defaultFixture.state)};

export default function ${componentName(screen.id, "Route")}() {
  const router = useRouter();
  const { state } = useLocalSearchParams<{ state?: string }>();
  const data = fixtures[state && Object.hasOwn(fixtures, state) ? state as keyof typeof fixtures : defaultState as keyof typeof fixtures];
  return <><Stack.Screen options={{ title: ${JSON.stringify(screen.title)} }} /><${name} data={data} events={{
${eventLines}
  }} /></>;
}
`;
}

function themeFiles(ir: PlatformIR): GeneratedFile[] {
  const modes = JSON.stringify(ir.tokenModes, null, 2);
  return [{
    path: "src/theme/tokens.ts",
    content: `import { useColorScheme } from "react-native";

export const tokenModes = ${modes} as const;
export type IntentFormTheme = (typeof tokenModes)[keyof typeof tokenModes];

export function useIntentFormTheme(): IntentFormTheme {
  const scheme = useColorScheme();
  if (scheme === "dark" && Object.hasOwn(tokenModes, "evening")) return tokenModes.evening as IntentFormTheme;
  return tokenModes[${JSON.stringify(ir.activeTokenMode)}] ?? tokenModes[${JSON.stringify(ir.tokenCollection.defaultMode)}];
}
`,
  }, {
    path: "src/theme/styles.ts",
    content: `import { StyleSheet, type ImageStyle, type TextStyle, type ViewStyle } from "react-native";
import type { IntentFormTheme } from "./tokens";

interface IntentFormStyles {
  screen: ViewStyle;
  scrollContent: ViewStyle;
  header: ViewStyle;
  content: ViewStyle;
  eyebrow: TextStyle;
  title: TextStyle;
  body: TextStyle;
  sectionTitle: TextStyle;
  heroValue: TextStyle;
  card: ViewStyle;
  status: ViewStyle;
  field: ViewStyle;
  fieldLabel: TextStyle;
  input: TextStyle;
  primaryAction: ViewStyle;
  primaryActionLabel: TextStyle;
  secondaryAction: ViewStyle;
  secondaryActionLabel: TextStyle;
  pressed: ViewStyle;
  persistentAction: ViewStyle;
  media: ViewStyle;
  image: ImageStyle;
}

export function createIntentFormStyles(theme: IntentFormTheme) {
  const colors = theme.colors as Record<string, string>;
  const radii = theme.radii as Record<string, number>;
  return StyleSheet.create<IntentFormStyles>({
    screen: { flex: 1, backgroundColor: colors["color.canvas"] ?? "#f3f5f1" },
    scrollContent: { flexGrow: 1, gap: 28, paddingHorizontal: 20, paddingTop: 20 },
    header: { gap: 10, paddingTop: 8 },
    content: { gap: 16 },
    eyebrow: { color: colors["color.accent"] ?? "#397461", fontSize: 12, fontWeight: "700", letterSpacing: 1.2, textTransform: "uppercase" },
    title: { color: colors["color.ink"] ?? "#181c1a", fontSize: 36, fontWeight: "700", letterSpacing: -1.5, lineHeight: 39 },
    body: { color: colors["color.ink"] ?? "#181c1a", fontSize: 16, lineHeight: 23 },
    sectionTitle: { color: colors["color.ink"] ?? "#181c1a", fontSize: 18, fontWeight: "700" },
    heroValue: { color: colors["color.ink"] ?? "#181c1a", fontSize: 34, fontWeight: "700", fontVariant: ["tabular-nums"] },
    card: { gap: 10, padding: 20, borderRadius: radii["radius.surface"] ?? 24, backgroundColor: colors["color.surface"] ?? "#fbfcf9", boxShadow: "0 10px 30px rgba(24, 28, 26, 0.08)", borderCurve: "continuous" },
    status: { padding: 16, borderRadius: radii["radius.control"] ?? 16, borderLeftWidth: 4, borderLeftColor: colors["color.accent"] ?? "#397461", backgroundColor: colors["color.surface"] ?? "#fbfcf9", borderCurve: "continuous" },
    field: { gap: 8 },
    fieldLabel: { color: colors["color.ink"] ?? "#181c1a", fontSize: 13, fontWeight: "600" },
    input: { minHeight: 52, paddingHorizontal: 16, borderWidth: 1, borderColor: "rgba(24,28,26,.18)", borderRadius: radii["radius.control"] ?? 16, backgroundColor: colors["color.surface"] ?? "#fbfcf9", color: colors["color.ink"] ?? "#181c1a", fontSize: 18, fontVariant: ["tabular-nums"], borderCurve: "continuous" },
    primaryAction: { minHeight: 52, alignItems: "center", justifyContent: "center", paddingHorizontal: 20, borderRadius: radii["radius.control"] ?? 16, backgroundColor: colors["color.accent"] ?? "#397461", borderCurve: "continuous" },
    primaryActionLabel: { color: "#ffffff", fontSize: 16, fontWeight: "700" },
    secondaryAction: { minHeight: 48, alignItems: "center", justifyContent: "center", paddingHorizontal: 18, borderRadius: radii["radius.control"] ?? 16, backgroundColor: colors["color.surface"] ?? "#fbfcf9", borderCurve: "continuous" },
    secondaryActionLabel: { color: colors["color.ink"] ?? "#181c1a", fontSize: 15, fontWeight: "600" },
    pressed: { opacity: 0.72, transform: [{ scale: 0.99 }] },
    persistentAction: { gap: 8, paddingHorizontal: 20, paddingTop: 12, backgroundColor: colors["color.canvas"] ?? "#f3f5f1", boxShadow: "0 -8px 24px rgba(24, 28, 26, 0.08)" },
    media: { gap: 12 },
    image: { width: "100%", minHeight: 180, borderRadius: radii["radius.surface"] ?? 24 },
  });
}
`,
  }];
}

function layoutRuntimeSource(): string {
  return `import type { ViewStyle } from "react-native";

export interface IntentFormLayout {
  compactMode: string;
  regularMode: string;
  axis: "vertical" | "horizontal" | "overlay";
  width: "hug" | "fill" | "fixed";
  height: "hug" | "fill" | "fixed";
  fixedWidth?: number;
  fixedHeight?: number;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  align: "start" | "center" | "end" | "stretch";
  justify: "start" | "center" | "end" | "space-between";
  overflow: "visible" | "clip" | "scroll";
  columns: number;
  splitRatio: number;
  position?: { x: number; y: number; z: number };
  gap: number;
  padding: number;
}

const alignItems: Record<IntentFormLayout["align"], ViewStyle["alignItems"]> = { start: "flex-start", center: "center", end: "flex-end", stretch: "stretch" };
const justifyContent: Record<IntentFormLayout["justify"], ViewStyle["justifyContent"]> = { start: "flex-start", center: "center", end: "flex-end", "space-between": "space-between" };

export function nodeStyle(layout: IntentFormLayout): ViewStyle {
  return {
    ...(layout.width === "fill" ? { alignSelf: "stretch" } : {}),
    ...(layout.width === "fixed" && layout.fixedWidth ? { width: layout.fixedWidth } : {}),
    ...(layout.height === "fixed" && layout.fixedHeight ? { height: layout.fixedHeight } : {}),
    ...(layout.minWidth !== undefined ? { minWidth: layout.minWidth } : {}),
    ...(layout.maxWidth !== undefined ? { maxWidth: layout.maxWidth } : {}),
    ...(layout.minHeight !== undefined ? { minHeight: layout.minHeight } : {}),
    ...(layout.maxHeight !== undefined ? { maxHeight: layout.maxHeight } : {}),
    ...(layout.position ? { position: "absolute", left: layout.position.x, top: layout.position.y, zIndex: layout.position.z } : {}),
  };
}

export function containerStyle(layout: IntentFormLayout, compact: boolean): ViewStyle {
  const mode = compact ? layout.compactMode : layout.regularMode;
  const horizontal = mode === "split" || layout.axis === "horizontal";
  return {
    position: "relative",
    flexDirection: horizontal ? "row" : "column",
    flexWrap: mode === "wrap" || mode === "grid" ? "wrap" : "nowrap",
    alignItems: alignItems[layout.align],
    justifyContent: justifyContent[layout.justify],
    overflow: layout.overflow === "visible" ? "visible" : "hidden",
    gap: layout.gap,
    padding: layout.padding,
  };
}
`;
}

function nativeAdapterFiles(adapterId: string): GeneratedFile[] {
  const base = fileFragment(adapterId);
  const shared = `import type { ReactNode } from "react";

export interface NativeAdapterProps {
  kind: string;
  label: string;
  value?: string;
  onPress?: () => void;
  fallback: ReactNode;
}
`;
  const platform = (platform: "ios" | "android") => `${shared}import { Pressable, Text, TextInput, View } from "react-native";

export function NativeAdapter({ kind, label, value, onPress, fallback }: NativeAdapterProps) {
  if (kind === "primary-action" || kind === "secondary-action") {
    return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={{ minHeight: 52, alignItems: "center", justifyContent: "center", paddingHorizontal: 20, borderRadius: ${platform === "ios" ? 16 : 14}, backgroundColor: ${platform === "ios" ? '"#397461"' : '"#2f6f5b"'}, borderCurve: "continuous" }}><Text selectable allowFontScaling style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}>{label}</Text></Pressable>;
  }
  if (kind === "money-input") {
    return <View style={{ gap: 8 }}><Text selectable allowFontScaling style={{ fontSize: 13, fontWeight: "600" }}>{label}</Text><TextInput allowFontScaling accessibilityLabel={label} keyboardType="decimal-pad" defaultValue={value} style={{ minHeight: 52, borderWidth: 1, borderColor: "rgba(24,28,26,.18)", borderRadius: ${platform === "ios" ? 16 : 12}, paddingHorizontal: 16, fontSize: 18, borderCurve: "continuous" }} /></View>;
  }
  return fallback;
}
`;
  return [
    { path: `src/adapters/${base}.ios.tsx`, content: platform("ios") },
    { path: `src/adapters/${base}.android.tsx`, content: platform("android") },
    { path: `src/adapters/${base}.tsx`, content: `${shared}\nexport function NativeAdapter({ fallback }: NativeAdapterProps) { return fallback; }\n` },
  ];
}

function generatedProjectFiles(ir: PlatformIR): GeneratedFile[] {
  if (!ir.expo) throw new Error("Expo output requires an Expo Router profile");
  const profile = ir.expo;
  const dependencies: Record<string, string> = { ...EXPO_DEPENDENCIES };
  if (profile.developmentBuild) dependencies["expo-dev-client"] = "~57.0.5";
  const packageJson = {
    name: `intentform-${profile.slug}`,
    private: true,
    version: "1.0.0",
    main: "expo-router/entry",
    scripts: {
      start: "expo start",
      ios: "expo start --ios",
      android: "expo start --android",
      typecheck: "tsc --noEmit",
      "export:ios": "expo export --platform ios --output-dir dist/ios",
      "export:android": "expo export --platform android --output-dir dist/android",
    },
    dependencies,
    devDependencies: { "@types/react": "~19.2.2", typescript: "~6.0.3" },
  };
  const appJson = {
    expo: {
      name: ir.productName,
      slug: profile.slug,
      version: "1.0.0",
      scheme: profile.scheme,
      orientation: "default",
      userInterfaceStyle: "automatic",
      newArchEnabled: true,
      plugins: ["expo-router"],
      experiments: { typedRoutes: true },
      ios: { supportsTablet: true, bundleIdentifier: `dev.intentform.${profile.slug.replace(/-/g, "")}` },
      android: { package: `dev.intentform.${profile.slug.replace(/-/g, "_")}` },
    },
  };
  const easJson = {
    cli: { version: ">= 16.0.1", appVersionSource: "remote" },
    build: {
      preview: { distribution: "internal" },
      ...(profile.developmentBuild ? { development: { developmentClient: true, distribution: "internal", autoIncrement: true } } : {}),
      production: { autoIncrement: true },
    },
  };
  return [
    { path: ".gitignore", content: ".expo/\ndist/\nnode_modules/\n" },
    { path: "package.json", content: `${JSON.stringify(packageJson, null, 2)}\n` },
    { path: "app.json", content: `${JSON.stringify(appJson, null, 2)}\n` },
    { path: "eas.json", content: `${JSON.stringify(easJson, null, 2)}\n` },
    { path: "expo-env.d.ts", content: "/// <reference types=\"expo/types\" />\n" },
    { path: "tsconfig.json", content: `${JSON.stringify({ extends: "expo/tsconfig.base", compilerOptions: { strict: true, paths: { "@/*": ["./src/*"] } }, include: ["**/*.ts", "**/*.tsx", ".expo/types/**/*.ts", "expo-env.d.ts"] }, null, 2)}\n` },
    { path: "app/_layout.tsx", content: `import { Stack } from "expo-router/stack";
import { StatusBar } from "expo-status-bar";

export default function RootLayout() {
  return <><StatusBar style="auto" /><Stack screenOptions={{ headerBackButtonDisplayMode: "minimal", headerShadowVisible: false }} /></>;
}
` },
    { path: "app/+not-found.tsx", content: `import { Link } from "expo-router";
import { ScrollView, Text } from "react-native";

export default function NotFoundRoute() {
  return <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ flexGrow: 1, justifyContent: "center", gap: 16, padding: 24 }}><Text selectable allowFontScaling accessibilityRole="header" style={{ fontSize: 28, fontWeight: "700" }}>Page not found</Text><Link href="/">Return home</Link></ScrollView>;
}
` },
    { path: "src/runtime/layout.ts", content: layoutRuntimeSource() },
    { path: "README.generated.md", content: `# ${ir.productName} — generated Expo project\n\nThis Expo Router project targets Expo SDK 57 and React Native 0.86. ${profile.developmentBuild ? "The graph enables a custom development client. Install it with `pnpm ios`, `pnpm android`, or the EAS `development` profile, then run `pnpm start`." : "Run `pnpm start` and open the project in Expo Go. The generated dependencies and APIs stay inside the Expo Go-compatible boundary."} Use the EAS \`preview\` profile for internal distribution.\n\nIntentForm owns the paths listed in \`intentform.expo.json\`. Files under \`src/project-components/\` are project-owned integration points and are never generated.\n` },
  ];
}

export class ExpoCompiler implements CompilerBackend {
  readonly id = "expo" as const;

  capabilities() {
    return { target: this.id, nativeSafeArea: true, adaptivePlacement: true, accessibility: true };
  }

  lower(graph: SemanticInterfaceGraph): PlatformIR {
    if (!graph.expo) throw new Error("The Expo target requires an Expo Router profile");
    return lowerGraph(graph, this.id);
  }

  generate(ir: PlatformIR): GeneratedFileSet {
    if (!ir.expo) throw new Error("Expo generation requires the validated source graph profile");
    const allNodes = ir.screens.flatMap((screen) => flattenIRNodes(screen.nodes));
    const nativeAdapters = [...new Set(allNodes.flatMap((node) => node.expo?.strategy === "platform-native" ? [node.expo.adapter] : []))].sort();
    const requiredProjectComponents = [...new Set(allNodes.flatMap((node) => node.expo?.strategy === "project-component" ? [node.expo.componentId] : []))].sort();
    const diagnostics: CompilerDiagnostic[] = [...ir.diagnostics];
    for (const screen of ir.screens) {
      for (const node of flattenIRNodes(screen.nodes)) {
        if (node.expo?.strategy === "project-component") {
          diagnostics.push({ severity: "warning", path: `screens.${screen.id}.nodes.${node.id}.expo`, message: `Project component ${node.expo.componentId} must be provided at src/project-components/${fileFragment(node.expo.componentId)}.tsx.` });
        }
        if (node.expo?.strategy === "platform-native" && !["primary-action", "secondary-action", "money-input"].includes(node.kind)) {
          diagnostics.push({ severity: "warning", path: `screens.${screen.id}.nodes.${node.id}.expo`, message: `Platform adapter ${node.expo.adapter} does not specialize ${node.kind}; the universal React Native fallback remains active.` });
        }
        if (node.asset && ["audio", "video", "font"].includes(node.asset.kind)) {
          diagnostics.push({ severity: "warning", path: `screens.${screen.id}.nodes.${node.id}.asset`, message: `Expo ${node.asset.kind} rendering requires a project adapter; the semantic fallback remains active.` });
        }
      }
    }
    const files: GeneratedFile[] = [
      ...generatedProjectFiles(ir),
      ...themeFiles(ir),
      ...ir.screens.map((screen) => ({ path: `src/contracts/${fileFragment(screen.id)}.ts`, content: contractSource(screen) })),
      ...ir.screens.map((screen) => ({ path: `src/screens/${fileFragment(screen.id)}.tsx`, content: screenSource(screen, ir.productName) })),
      ...ir.screens.map((screen) => ({ path: routeFilePath(screen.route), content: routeSource(ir, screen) })),
      ...nativeAdapters.flatMap(nativeAdapterFiles),
    ];
    const ownedPaths = files.map((file) => file.path).sort();
    files.push({
      path: "intentform.expo.json",
      content: `${JSON.stringify({
        version: 1,
        sdkVersion: ir.expo.sdkVersion,
        strategy: ir.expo.strategy,
        routes: ir.screens.map((screen) => ({ id: screen.id, route: screen.route, file: routeFilePath(screen.route) })),
        nodeStrategies: ir.screens.flatMap((screen) => flattenIRNodes(screen.nodes).map((node) => ({ screenId: screen.id, nodeId: node.id, strategy: node.expo?.strategy ?? ir.expo!.defaultRenderStrategy }))),
        platformAdapters: nativeAdapters,
        requiredProjectComponents: requiredProjectComponents.map((id) => ({ id, path: `src/project-components/${fileFragment(id)}.tsx` })),
        ownedPaths: [...ownedPaths, "intentform.expo.json"],
      }, null, 2)}\n`,
    });
    return { target: this.id, files, fingerprint: fingerprintFiles(files), diagnostics };
  }

  validate(output: GeneratedFileSet): CompilerDiagnostic[] {
    const diagnostics: CompilerDiagnostic[] = [];
    const paths = new Set(output.files.map((file) => file.path));
    for (const required of ["package.json", "app.json", "eas.json", "tsconfig.json", "app/_layout.tsx", "app/index.tsx", "src/runtime/layout.ts", "intentform.expo.json"]) {
      if (!paths.has(required)) diagnostics.push({ severity: "error", path: required, message: "Required Expo output is missing" });
    }
    for (const file of output.files) {
      if (/\beval\s*\(|new Function\s*\(|dangerouslySetInnerHTML|from ["']@react-navigation\//.test(file.content)) {
        diagnostics.push({ severity: "error", path: file.path, message: "Generated Expo output cannot evaluate source, inject raw markup, or bypass Expo Router navigation boundaries" });
      }
      if (file.path.startsWith("app/") && !file.path.endsWith(".tsx")) {
        diagnostics.push({ severity: "error", path: file.path, message: "Expo Router app directories may contain route modules only" });
      }
      if (file.path.startsWith("app/") && !file.content.includes("export default")) {
        diagnostics.push({ severity: "error", path: file.path, message: "Every Expo Router route or layout must have a default export" });
      }
    }
    const routeFiles = output.files.filter((file) => file.path.startsWith("app/") && !file.path.endsWith("_layout.tsx") && !file.path.endsWith("+not-found.tsx"));
    if (new Set(routeFiles.map((file) => file.path)).size !== routeFiles.length) {
      diagnostics.push({ severity: "error", path: "app", message: "Expo routes must map to unique generated files" });
    }
    return diagnostics;
  }
}

export function compileExpo(graph: SemanticInterfaceGraph): GeneratedFileSet {
  const compiler = new ExpoCompiler();
  const ir = compiler.lower(graph);
  return validateGeneratedOutput(compiler, compiler.generate(ir));
}
