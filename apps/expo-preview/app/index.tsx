import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { HomeScreen } from "@/screens/home";
import type { HomeScreenData } from "@/contracts/home";

const fixtures = {
  "idle": {
    "balance": "8420.16",
    "activitySummary": "Riva Studio −84.20 · Northline Market −32.70"
  }
} as const satisfies Record<string, HomeScreenData>;
const defaultState = "idle";

export default function HomeRoute() {
  const router = useRouter();
  const { state } = useLocalSearchParams<{ state?: string }>();
  const data = fixtures[state && Object.hasOwn(fixtures, state) ? state as keyof typeof fixtures : defaultState as keyof typeof fixtures];
  return <><Stack.Screen options={{ title: "Good evening" }} /><HomeScreen data={data} events={{
    onRequestPayment: () => router.push("/request"),
  }} /></>;
}
