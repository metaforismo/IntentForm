import { useMemo } from "react";
import { Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Payment_dash_requestScreenData, Payment_dash_requestScreenEvents } from "@/contracts/payment-dash-request";
import { containerStyle, nodeStyle } from "@/runtime/layout";
import { createIntentFormStyles } from "@/theme/styles";
import { useIntentFormTheme } from "@/theme/tokens";



export interface Payment_dash_requestScreenProps {
  data: Payment_dash_requestScreenData;
  events: Payment_dash_requestScreenEvents;
}

export function Payment_dash_requestScreen({ data, events }: Payment_dash_requestScreenProps) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const compact = width <= 390 || height <= 700;
  const theme = useIntentFormTheme();
  const styles = useMemo(() => createIntentFormStyles(theme), [theme]);
  const persistent = (compact ? true : false);
  return (
    <View style={styles.screen} testID="screen-payment-request">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.scrollContent, { paddingBottom: persistent ? 24 : Math.max(insets.bottom, 24) }]}
      >
        <View style={styles.header}>
          <Text selectable style={styles.eyebrow}>{"Verdant Pay"}</Text>
          <Text selectable accessibilityRole="header" style={styles.title}>{"Request payment"}</Text>
          <Text selectable style={styles.body}>{"Confirm a payment request"}</Text>
        </View>
        <View style={styles.content}>
          <View testID="node-payment-request.amount" style={nodeStyle({"compactMode":"leaf","regularMode":"leaf","axis":"vertical","width":"fill","height":"hug","align":"stretch","justify":"start","overflow":"visible","columns":2,"splitRatio":0.5,"gap":16,"padding":20})}><View style={styles.field}><Text selectable style={styles.fieldLabel}>{"Amount"}</Text><TextInput accessible accessibilityLabel="Amount" keyboardType="decimal-pad" defaultValue={String(data.amount ?? "")} style={styles.input} /></View></View>
          <View testID="node-payment-request.recipient" style={nodeStyle({"compactMode":"leaf","regularMode":"leaf","axis":"vertical","width":"fill","height":"hug","align":"stretch","justify":"start","overflow":"visible","columns":2,"splitRatio":0.5,"gap":16,"padding":20})}><View accessible accessibilityLabel="Recipient" accessibilityRole="summary" style={styles.card}><Text selectable style={styles.sectionTitle}>{String(data.recipientName ?? "")}</Text><Text selectable style={styles.body}>{String(data.recipientHandle ?? "")}</Text></View></View>
          {(data.status === "failed") ? (<View testID="node-payment-request.failure" style={nodeStyle({"compactMode":"leaf","regularMode":"leaf","axis":"vertical","width":"fill","height":"hug","align":"stretch","justify":"start","overflow":"visible","columns":2,"splitRatio":0.5,"gap":16,"padding":20})}><View accessible accessibilityLabel="Payment could not be sent. Check the amount and try again." accessibilityLiveRegion="polite" style={styles.status}><Text selectable style={styles.body}>{"Payment could not be sent. Check the amount and try again."}</Text></View></View>) : null}
          {(compact ? false : true) ? (<View testID="node-payment-request.confirm" style={nodeStyle({"compactMode":"leaf","regularMode":"leaf","axis":"vertical","width":"fill","height":"hug","align":"stretch","justify":"start","overflow":"visible","columns":2,"splitRatio":0.5,"gap":16,"padding":20})}><Pressable testID="action-payment-request.confirm" accessible accessibilityLabel="Confirm request" accessibilityRole="button" onPress={() => { events.onConfirm(); }} style={({ pressed }) => [styles.primaryAction, pressed && styles.pressed]}><Text selectable style={styles.primaryActionLabel}>{"Confirm request"}</Text></Pressable></View>) : null}
        </View>
      </ScrollView>
      {persistent ? <View style={[styles.persistentAction, { paddingBottom: Math.max(insets.bottom, 12) }]}><View testID="node-payment-request.confirm" style={nodeStyle({"compactMode":"leaf","regularMode":"leaf","axis":"vertical","width":"fill","height":"hug","align":"stretch","justify":"start","overflow":"visible","columns":2,"splitRatio":0.5,"gap":16,"padding":20})}><Pressable testID="action-payment-request.confirm" accessible accessibilityLabel="Confirm request" accessibilityRole="button" onPress={() => { events.onConfirm(); }} style={({ pressed }) => [styles.primaryAction, pressed && styles.pressed]}><Text selectable style={styles.primaryActionLabel}>{"Confirm request"}</Text></Pressable></View></View> : null}

    </View>
  );
}
