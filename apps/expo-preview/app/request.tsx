import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Payment_dash_requestScreen } from "@/screens/payment-dash-request";
import type { Payment_dash_requestScreenData } from "@/contracts/payment-dash-request";

const fixtures = {
  "idle": {
    "amount": "120.00",
    "recipientName": "Mara Rinaldi",
    "recipientHandle": "mara@northline.test",
    "status": "idle"
  },
  "failed": {
    "amount": "120.00",
    "recipientName": "Mara Rinaldi",
    "recipientHandle": "mara@northline.test",
    "status": "failed"
  }
} as const satisfies Record<string, Payment_dash_requestScreenData>;
const defaultState = "idle";

export default function Payment_dash_requestRoute() {
  const router = useRouter();
  const { state } = useLocalSearchParams<{ state?: string }>();
  const data = fixtures[state && Object.hasOwn(fixtures, state) ? state as keyof typeof fixtures : defaultState as keyof typeof fixtures];
  return <><Stack.Screen options={{ title: "Request payment" }} /><Payment_dash_requestScreen data={data} events={{
    onConfirm: () => router.push("/receipt"),
    onCancel: () => undefined,
    onRetry: () => undefined,
  }} /></>;
}
