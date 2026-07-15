import { describe, expect, it } from "vitest";
import { demoGraph } from "@intentform/proof-report/demo";
import { parseGraph } from "@intentform/semantic-schema";
import { compileExpo } from "./index";

describe("Expo Adaptive compiler", () => {
  it("generates a deterministic Expo Router project with routes, contracts, themes, and owned paths", () => {
    const first = compileExpo(demoGraph);
    const second = compileExpo(demoGraph);

    expect(first).toEqual(second);
    expect(first.target).toBe("expo");
    expect(first.files.map((file) => file.path)).toEqual(expect.arrayContaining([
      "package.json",
      "app.json",
      "eas.json",
      "app/_layout.tsx",
      "app/index.tsx",
      "app/request.tsx",
      "src/contracts/home.ts",
      "src/screens/home.tsx",
      "src/runtime/layout.ts",
      "src/theme/tokens.ts",
      "src/theme/styles.ts",
      "intentform.expo.json",
    ]));
    const packageJson = JSON.parse(first.files.find((file) => file.path === "package.json")!.content) as {
      main: string;
      dependencies: Record<string, string>;
    };
    expect(packageJson.main).toBe("expo-router/entry");
    expect(packageJson.dependencies).toEqual(expect.objectContaining({
      expo: "~57.0.4",
      "expo-router": "~57.0.4",
      react: "19.2.3",
      "react-native": "0.86.0",
    }));
    expect(packageJson.dependencies["expo-dev-client"]).toBe("~57.0.5");
    const appJson = JSON.parse(first.files.find((file) => file.path === "app.json")!.content) as {
      expo: { plugins: string[]; experiments: { typedRoutes: boolean } };
    };
    expect(appJson.expo.plugins).toContain("expo-router");
    expect(appJson.expo.experiments.typedRoutes).toBe(true);
    const screen = first.files.find((file) => file.path === "src/screens/payment-dash-request.tsx")!.content;
    expect(screen).toContain('contentInsetAdjustmentBehavior="automatic"');
    expect(screen).toContain("useSafeAreaInsets");
    expect(screen).toContain("useWindowDimensions");
    expect(screen).toContain("allowFontScaling");
    expect(first.files.find((file) => file.path === "src/theme/styles.ts")!.content).toContain("minHeight: 52");
    expect(screen).not.toContain("persistent-bottom");
    expect(screen).toContain("const persistent = (compact ? false : false)");
    const route = first.files.find((file) => file.path === "app/request.tsx")!.content;
    expect(route).toContain('"failed"');
    expect(route).toContain("useLocalSearchParams");
    expect(route).toContain('<Stack.Screen options={{ title: "Request payment" }} />');
    expect(first.files.find((file) => file.path === "README.generated.md")!.content).toContain("custom development client");
    const manifest = JSON.parse(first.files.find((file) => file.path === "intentform.expo.json")!.content) as {
      sdkVersion: string;
      requiredProjectComponents: unknown[];
      ownedPaths: string[];
    };
    expect(manifest.sdkVersion).toBe("57.0.0");
    expect(manifest.requiredProjectComponents).toEqual([]);
    expect(manifest.ownedPaths).toContain("intentform.expo.json");
    expect(new Set(manifest.ownedPaths).size).toBe(manifest.ownedPaths.length);
    expect(first.files.some((file) => /\beval\s*\(|new Function\s*\(/.test(file.content))).toBe(false);
  });

  it("emits explicit platform and project adapter boundaries without owning project components", () => {
    const graph = structuredClone(demoGraph);
    graph.screens[0]!.nodes[0]!.expo = { strategy: "platform-native", adapter: "intent.balance" };
    graph.screens[1]!.nodes[0]!.expo = { strategy: "project-component", componentId: "payments.money-field" };
    const output = compileExpo(parseGraph(graph));
    const paths = output.files.map((file) => file.path);

    expect(paths).toEqual(expect.arrayContaining([
      "src/adapters/intent-dot-balance.ios.tsx",
      "src/adapters/intent-dot-balance.android.tsx",
      "src/adapters/intent-dot-balance.tsx",
    ]));
    expect(paths.some((path) => path.startsWith("src/project-components/"))).toBe(false);
    const manifest = JSON.parse(output.files.find((file) => file.path === "intentform.expo.json")!.content) as {
      requiredProjectComponents: Array<{ id: string; path: string }>;
    };
    expect(manifest.requiredProjectComponents).toEqual([{
      id: "payments.money-field",
      path: "src/project-components/payments-dot-money-dash-field.tsx",
    }]);
    expect(output.diagnostics).toContainEqual(expect.objectContaining({
      severity: "warning",
      message: expect.stringContaining("must be provided"),
    }));
  });

  it("includes a development-client profile only when the graph explicitly enables it", () => {
    const graph = structuredClone(demoGraph);
    graph.expo!.developmentBuild = false;
    const output = compileExpo(parseGraph(graph));
    const packageJson = JSON.parse(output.files.find((file) => file.path === "package.json")!.content) as {
      dependencies: Record<string, string>;
    };
    const eas = JSON.parse(output.files.find((file) => file.path === "eas.json")!.content) as {
      build: Record<string, unknown>;
    };
    expect(packageJson.dependencies).not.toHaveProperty("expo-dev-client");
    expect(eas.build).not.toHaveProperty("development");
    expect(output.files.find((file) => file.path === "README.generated.md")!.content).toContain("open the project in Expo Go");

    graph.expo!.developmentBuild = true;
    const developmentOutput = compileExpo(parseGraph(graph));
    const developmentPackage = JSON.parse(developmentOutput.files.find((file) => file.path === "package.json")!.content) as { dependencies: Record<string, string> };
    const developmentEas = JSON.parse(developmentOutput.files.find((file) => file.path === "eas.json")!.content) as { build: Record<string, unknown> };
    expect(developmentPackage.dependencies["expo-dev-client"]).toBe("~57.0.5");
    expect(developmentEas.build).toHaveProperty("development");
  });

  it("lowers compact persistent actions without duplicating them inline", () => {
    const graph = structuredClone(demoGraph);
    const screen = graph.screens.find((candidate) => candidate.id === "payment-request")!;
    const action = screen.nodes.find((node) => node.id === "payment-request.confirm")!;
    action.layout.placement = { compact: "persistent-bottom", regular: "inline" };
    const output = compileExpo(parseGraph(graph));
    const source = output.files.find((file) => file.path === "src/screens/payment-dash-request.tsx")!.content;
    expect(source).toContain("const persistent = (compact ? true : false)");
    expect(source).toContain("{(compact ? false : true) ? (");
    expect(source).toContain("{persistent ? <View");
  });

  it("fails closed when Expo is disabled or the profile is absent", () => {
    const disabled = structuredClone(demoGraph);
    disabled.platforms.find((platform) => platform.target === "expo")!.enabled = false;
    expect(() => compileExpo(parseGraph(disabled))).toThrow(/expo target is not enabled/i);

    const missing = structuredClone(demoGraph);
    delete missing.expo;
    expect(() => parseGraph(missing)).toThrow(/requires an Expo Router profile/i);
  });
});
