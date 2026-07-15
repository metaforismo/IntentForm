import { Link } from "expo-router";
import { ScrollView, Text } from "react-native";

export default function NotFoundRoute() {
  return <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ flexGrow: 1, justifyContent: "center", gap: 16, padding: 24 }}><Text selectable allowFontScaling accessibilityRole="header" style={{ fontSize: 28, fontWeight: "700" }}>Page not found</Text><Link href="/">Return home</Link></ScrollView>;
}
