import type { ViewStyle } from "react-native";

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
  flexGrow?: number;
  flexShrink?: number;
  flexBasis?: number;
  gridColumn?: { start: number; span: number };
  gridRow?: { start: number; span: number };
  align: "start" | "center" | "end" | "stretch" | "baseline";
  justify: "start" | "center" | "end" | "space-between";
  overflow: "visible" | "clip" | "scroll";
  columns: number;
  splitRatio: number;
  position?: { x: number; y: number; z: number };
  gap: number;
  padding: number;
  paddingBySide: { top: number; right: number; bottom: number; left: number };
}

const alignItems: Record<IntentFormLayout["align"], ViewStyle["alignItems"]> = { start: "flex-start", center: "center", end: "flex-end", stretch: "stretch", baseline: "baseline" };
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
    ...(layout.flexGrow !== undefined ? { flexGrow: layout.flexGrow } : {}),
    ...(layout.flexShrink !== undefined ? { flexShrink: layout.flexShrink } : {}),
    ...(layout.flexBasis !== undefined ? { flexBasis: layout.flexBasis } : {}),
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
    paddingTop: layout.paddingBySide.top,
    paddingRight: layout.paddingBySide.right,
    paddingBottom: layout.paddingBySide.bottom,
    paddingLeft: layout.paddingBySide.left,
  };
}
