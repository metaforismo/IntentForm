import { useMemo } from "react";
import { Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ReceiptScreenData, ReceiptScreenEvents } from "@/contracts/receipt";
import { containerStyle, nodeStyle } from "@/runtime/layout";
import { createIntentFormStyles } from "@/theme/styles";
import { useIntentFormTheme } from "@/theme/tokens";



export interface ReceiptScreenProps {
  data: ReceiptScreenData;
  events: ReceiptScreenEvents;
}

export function ReceiptScreen({ data, events }: ReceiptScreenProps) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const compact = width <= 390 || height <= 700;
  const theme = useIntentFormTheme();
  const styles = useMemo(() => createIntentFormStyles(theme), [theme]);
  const persistent = (compact ? true : false);
  return (
    <View style={styles.screen} testID="screen-receipt">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.scrollContent, { paddingBottom: persistent ? 24 : Math.max(insets.bottom, 24) }]}
      >
        <View style={styles.header}>
          <Text selectable allowFontScaling style={styles.eyebrow}>{"Verdant Pay"}</Text>
          <Text selectable allowFontScaling accessibilityRole="header" style={styles.title}>{"Request sent"}</Text>
          <Text selectable allowFontScaling style={styles.body}>{"Confirm completion and reference"}</Text>
        </View>
        <View style={styles.content}>
          <View testID="node-receipt.summary" style={nodeStyle({"compactMode":"leaf","regularMode":"leaf","axis":"vertical","width":"fill","height":"hug","align":"stretch","justify":"start","overflow":"visible","columns":2,"splitRatio":0.5,"gap":16,"padding":20,"paddingBySide":{"top":20,"right":20,"bottom":20,"left":20}})}><View accessible accessibilityLabel="Payment request sent" accessibilityRole="summary" style={styles.card}><Text selectable allowFontScaling style={styles.sectionTitle}>{"Payment request sent"}</Text><Text selectable allowFontScaling style={styles.heroValue}>{String(data.amount ?? "")}</Text><Text selectable allowFontScaling style={styles.body}>{String(data.reference ?? "")}</Text></View></View>
          {(compact ? false : true) ? (<View testID="node-receipt.confirm" style={nodeStyle({"compactMode":"leaf","regularMode":"leaf","axis":"vertical","width":"fill","height":"hug","align":"stretch","justify":"start","overflow":"visible","columns":2,"splitRatio":0.5,"gap":16,"padding":20,"paddingBySide":{"top":20,"right":20,"bottom":20,"left":20}})}><Pressable testID="action-receipt.confirm" accessible accessibilityLabel="Done" accessibilityRole="button" onPress={() => { events.onDone(); }} style={({ pressed }) => [styles.primaryAction, pressed && styles.pressed]}><Text selectable allowFontScaling style={styles.primaryActionLabel}>{"Done"}</Text></Pressable></View>) : null}
        </View>
      </ScrollView>
      {persistent ? <View style={[styles.persistentAction, { paddingBottom: Math.max(insets.bottom, 12) }]}><View testID="node-receipt.confirm" style={nodeStyle({"compactMode":"leaf","regularMode":"leaf","axis":"vertical","width":"fill","height":"hug","align":"stretch","justify":"start","overflow":"visible","columns":2,"splitRatio":0.5,"gap":16,"padding":20,"paddingBySide":{"top":20,"right":20,"bottom":20,"left":20}})}><Pressable testID="action-receipt.confirm" accessible accessibilityLabel="Done" accessibilityRole="button" onPress={() => { events.onDone(); }} style={({ pressed }) => [styles.primaryAction, pressed && styles.pressed]}><Text selectable allowFontScaling style={styles.primaryActionLabel}>{"Done"}</Text></Pressable></View></View> : null}

    </View>
  );
}
