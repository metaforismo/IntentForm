import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Layout_dash_labScreen } from "@/screens/layout-dash-lab";
import type { Layout_dash_labScreenData } from "@/contracts/layout-dash-lab";

const fixtures = {
  "idle": {}
} as const satisfies Record<string, Layout_dash_labScreenData>;
const defaultState = "idle";

export default function Layout_dash_labRoute() {
  const router = useRouter();
  const { state } = useLocalSearchParams<{ state?: string }>();
  const data = fixtures[state && Object.hasOwn(fixtures, state) ? state as keyof typeof fixtures : defaultState as keyof typeof fixtures];
  return <><Stack.Screen options={{ title: "Layout lab" }} /><Layout_dash_labScreen data={data} events={{

  }} /></>;
}
