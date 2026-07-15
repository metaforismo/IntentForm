import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { ReceiptScreen } from "@/screens/receipt";
import type { ReceiptScreenData } from "@/contracts/receipt";

const fixtures = {
  "completed": {
    "reference": "IF-2048",
    "amount": "120.00"
  }
} as const satisfies Record<string, ReceiptScreenData>;
const defaultState = "completed";

export default function ReceiptRoute() {
  const router = useRouter();
  const { state } = useLocalSearchParams<{ state?: string }>();
  const data = fixtures[state && Object.hasOwn(fixtures, state) ? state as keyof typeof fixtures : defaultState as keyof typeof fixtures];
  return <><Stack.Screen options={{ title: "Request sent" }} /><ReceiptScreen data={data} events={{
    onDone: () => undefined,
  }} /></>;
}
