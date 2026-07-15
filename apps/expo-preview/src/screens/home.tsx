import { useMemo } from "react";
import { Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { HomeScreenData, HomeScreenEvents } from "@/contracts/home";
import { containerStyle, nodeStyle } from "@/runtime/layout";
import { createIntentFormStyles } from "@/theme/styles";
import { useIntentFormTheme } from "@/theme/tokens";



export interface HomeScreenProps {
  data: HomeScreenData;
  events: HomeScreenEvents;
}

export function HomeScreen({ data, events }: HomeScreenProps) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const compact = width <= 390 || height <= 700;
  const theme = useIntentFormTheme();
  const styles = useMemo(() => createIntentFormStyles(theme), [theme]);
  const persistent = (compact ? true : false);
  return (
    <View style={styles.screen} testID="screen-home">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.scrollContent, { paddingBottom: persistent ? 24 : Math.max(insets.bottom, 24) }]}
      >
        <View style={styles.header}>
          <Text selectable allowFontScaling style={styles.eyebrow}>{"Verdant Pay"}</Text>
          <Text selectable allowFontScaling accessibilityRole="header" style={styles.title}>{"Good evening"}</Text>
          <Text selectable allowFontScaling style={styles.body}>{"See balance and recent activity"}</Text>
        </View>
        <View style={styles.content}>
          <View testID="node-home.balance" style={nodeStyle({"compactMode":"leaf","regularMode":"leaf","axis":"vertical","width":"fill","height":"hug","align":"stretch","justify":"start","overflow":"visible","columns":2,"splitRatio":0.5,"gap":16,"padding":20})}><View accessible accessibilityLabel="Available balance" accessibilityRole="summary" style={styles.card}><Text selectable allowFontScaling style={styles.eyebrow}>{"Available balance"}</Text><Text selectable allowFontScaling style={styles.heroValue}>{String(data.balance ?? "")}</Text></View></View>
          <View testID="node-home.activity" style={nodeStyle({"compactMode":"leaf","regularMode":"leaf","axis":"vertical","width":"fill","height":"hug","align":"stretch","justify":"start","overflow":"visible","columns":2,"splitRatio":0.5,"gap":16,"padding":20})}><View accessible accessibilityLabel="Recent activity" accessibilityRole="list" style={styles.card}><Text selectable allowFontScaling style={styles.sectionTitle}>{"Recent activity"}</Text><Text selectable allowFontScaling style={styles.body}>{String(data.activitySummary ?? "")}</Text></View></View>
          {(compact ? false : true) ? (<View testID="node-home.confirm" style={nodeStyle({"compactMode":"leaf","regularMode":"leaf","axis":"vertical","width":"fill","height":"hug","align":"stretch","justify":"start","overflow":"visible","columns":2,"splitRatio":0.5,"gap":16,"padding":20})}><Pressable testID="action-home.confirm" accessible accessibilityLabel="Request payment" accessibilityRole="button" onPress={() => { events.onRequestPayment(); }} style={({ pressed }) => [styles.primaryAction, pressed && styles.pressed]}><Text selectable allowFontScaling style={styles.primaryActionLabel}>{"Request payment"}</Text></Pressable></View>) : null}
        </View>
      </ScrollView>
      {persistent ? <View style={[styles.persistentAction, { paddingBottom: Math.max(insets.bottom, 12) }]}><View testID="node-home.confirm" style={nodeStyle({"compactMode":"leaf","regularMode":"leaf","axis":"vertical","width":"fill","height":"hug","align":"stretch","justify":"start","overflow":"visible","columns":2,"splitRatio":0.5,"gap":16,"padding":20})}><Pressable testID="action-home.confirm" accessible accessibilityLabel="Request payment" accessibilityRole="button" onPress={() => { events.onRequestPayment(); }} style={({ pressed }) => [styles.primaryAction, pressed && styles.pressed]}><Text selectable allowFontScaling style={styles.primaryActionLabel}>{"Request payment"}</Text></Pressable></View></View> : null}

    </View>
  );
}
