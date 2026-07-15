import { useColorScheme } from "react-native";

export const tokenModes = {
  "default": {
    "colors": {
      "color.accent": "#397461",
      "color.action": "#397461",
      "color.canvas": "#f3f5f1",
      "color.ink": "#181c1a",
      "color.surface": "#fbfcf9"
    },
    "spacing": {
      "space.12": 12,
      "space.16": 16,
      "space.20": 20,
      "space.24": 24,
      "space.8": 8
    },
    "radii": {
      "radius.control": 18,
      "radius.surface": 28
    },
    "fontFamilies": {},
    "fontWeights": {},
    "fontSizes": {},
    "lineHeights": {},
    "letterSpacing": {},
    "shadows": {},
    "opacity": {},
    "durations": {},
    "easings": {},
    "containers": {},
    "breakpoints": {},
    "zIndices": {}
  },
  "evening": {
    "colors": {
      "color.accent": "#68a990",
      "color.action": "#68a990",
      "color.canvas": "#111714",
      "color.ink": "#eef4f0",
      "color.surface": "#18211d"
    },
    "spacing": {
      "space.12": 12,
      "space.16": 16,
      "space.20": 20,
      "space.24": 24,
      "space.8": 8
    },
    "radii": {
      "radius.control": 18,
      "radius.surface": 28
    },
    "fontFamilies": {},
    "fontWeights": {},
    "fontSizes": {},
    "lineHeights": {},
    "letterSpacing": {},
    "shadows": {},
    "opacity": {},
    "durations": {},
    "easings": {},
    "containers": {},
    "breakpoints": {},
    "zIndices": {}
  }
} as const;
export type IntentFormTheme = (typeof tokenModes)[keyof typeof tokenModes];

export function useIntentFormTheme(): IntentFormTheme {
  const scheme = useColorScheme();
  if (scheme === "dark" && Object.hasOwn(tokenModes, "evening")) return tokenModes.evening as IntentFormTheme;
  return tokenModes["default"] ?? tokenModes["default"];
}
