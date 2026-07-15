import { StyleSheet, type ImageStyle, type TextStyle, type ViewStyle } from "react-native";
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
