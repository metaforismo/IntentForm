import { describe, expect, it } from "vitest";
import { resolveTokenMode } from "@intentform/semantic-schema";
import {
  exportDtcg,
  importDtcg,
  serializeDtcg,
  tokenCount,
} from "./tokens.ts";

const dtcgFixture = {
  color: {
    $type: "color",
    accent: {
      $value: { colorSpace: "srgb", components: [0.2, 0.4, 0.6], hex: "#336699" },
      $description: "Brand accent",
      $extensions: { "com.example.source": { collection: "brand" } },
    },
    action: { $value: "{color.accent}", $deprecated: "Prefer color.accent" },
  },
  space: {
    $type: "dimension",
    $description: "Spacing scale",
    $deprecated: true,
    $extensions: { "com.example.group": { owner: "design-systems" } },
    16: { $value: { value: 16, unit: "px" } },
    content: { $ref: "#/space/16", $deprecated: false },
  },
  radius: {
    $type: "dimension",
    surface: { $value: { value: 24, unit: "px" } },
  },
  $extensions: {
    "com.example.root": { source: "tokens.tokens.json" },
    "org.intentform.tokens": {
      formatVersion: "2025.10",
      defaultMode: "default",
      activeMode: "night",
      modes: {
        default: {
          name: "Brand default",
          values: {
            colors: { "color.accent": "#336699" },
            spacing: { "space.16": 16 },
            radii: { "radius.surface": 24 },
          },
        },
        night: {
          name: "Night",
          description: "Low-light colors",
          values: {
            colors: { "color.accent": "#88aacc" },
            spacing: {},
            radii: {},
          },
        },
      },
    },
  },
};

describe("DTCG 2025.10 adapter", () => {
  it("imports typed values, aliases, modes, deprecation, and vendor metadata", () => {
    const result = importDtcg(dtcgFixture);
    expect(result.tokens).toMatchObject({
      defaultMode: "default",
      activeMode: "night",
      aliases: {
        "color.action": "color.accent",
        "space.content": "space.16",
      },
      deprecated: {
        "color.action": "Prefer color.accent",
        "space.16": true,
        "space.content": false,
      },
      modes: {
        default: { name: "Brand default" },
        night: { name: "Night", description: "Low-light colors" },
      },
    });
    expect(resolveTokenMode(result.tokens, "night")).toMatchObject({
      colors: { "color.accent": "#88aacc", "color.action": "#88aacc" },
      spacing: { "space.16": 16, "space.content": 16 },
      radii: { "radius.surface": 24 },
    });
    expect(result.tokens.extensions).toHaveProperty("org.intentform.dtcg-preserved");
    expect(tokenCount(result.tokens)).toBe(5);
  });

  it("round-trips deterministically without dropping supported metadata", () => {
    const first = importDtcg(dtcgFixture).tokens;
    const serialized = serializeDtcg(first);
    expect(serialized).toBe(serializeDtcg(first));
    expect(serialized.endsWith("\n")).toBe(true);
    const exported = exportDtcg(first);
    expect(exported).toMatchObject({
      color: {
        accent: { $type: "color", $description: "Brand accent" },
        action: { $type: "color", $value: "{color.accent}", $deprecated: "Prefer color.accent" },
      },
      space: {
        $description: "Spacing scale",
        $deprecated: true,
        $extensions: { "com.example.group": { owner: "design-systems" } },
        content: { $deprecated: false },
      },
      $extensions: { "com.example.root": { source: "tokens.tokens.json" } },
    });
    expect(importDtcg(JSON.parse(serialized)).tokens).toEqual(first);
  });

  it.each([
    [{ color: { $type: "color", bad: { $value: "#ffffff" } } }, /must be an object/i],
    [{ color: { $type: "color", bad: { $value: "{color.missing}" } } }, /unknown token alias/i],
    [{ color: { $type: "color", a: { $value: "{color.b}" }, b: { $value: "{color.a}" } } }, /alias cycle/i],
    [{ group: { $extends: "{other}" } }, /group extension is not supported/i],
    [{ color: { $type: "color", "bad.name": { $value: {} } } }, /invalid DTCG/i],
    [{ unsupported: { $type: "duration", token: { $value: 120 } } }, /unsupported DTCG token type/i],
    [{ color: { $type: "color", bad: { $value: { colorSpace: "srgb", components: [1, 1, 1], alpha: "1" } } } }, /uses alpha/i],
    [{ $extensions: { "org.intentform.tokens": { formatVersion: "2099.1" } } }, /unsupported IntentForm DTCG extension version/i],
    [{ $extensions: { "org.intentform.tokens": { formatVersion: "2025.10", modes: [] } } }, /modes must be an object/i],
  ])("fails closed for unsupported or invalid documents %#", (input, error) => {
    expect(() => importDtcg(input)).toThrow(error);
  });
});
