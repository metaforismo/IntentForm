import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GRAPH_LIMITS, stableSerialize } from "./index";
import {
  CURRENT_SCHEMA_VERSION,
  GraphMigrationError,
  previewGraphMigration,
} from "./migrations";

function fixture(version: "0.0.1" | "0.1.0" | "0.2.0" | "0.3.0" | "0.4.0" | "0.5.0" | "0.6.0" | "0.7.0" | "0.8.0"): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/migrations/${version}.json`, import.meta.url), "utf8"));
}

describe("Semantic Interface Graph migrations", () => {
  it("converts the 0.0.1 golden fixture through every step to byte-stable canonical 0.8.0 output", () => {
    const preview = previewGraphMigration(fixture("0.0.1"));
    const expected = previewGraphMigration(fixture("0.8.0"));

    expect(preview).toMatchObject({
      fromVersion: "0.0.1",
      toVersion: CURRENT_SCHEMA_VERSION,
      changed: true,
      diagnostics: [
        { severity: "info", code: "schema.migrated.0.0.1.to.0.1.0", path: "schemaVersion" },
        { severity: "info", code: "schema.migrated.0.1.0.to.0.2.0", path: "schemaVersion" },
        { severity: "info", code: "schema.migrated.0.2.0.to.0.3.0", path: "schemaVersion" },
        { severity: "info", code: "schema.migrated.0.3.0.to.0.4.0", path: "schemaVersion" },
        { severity: "info", code: "schema.migrated.0.4.0.to.0.5.0", path: "schemaVersion" },
        { severity: "info", code: "schema.migrated.0.5.0.to.0.6.0", path: "schemaVersion" },
        { severity: "info", code: "schema.migrated.0.6.0.to.0.7.0", path: "schemaVersion" },
        { severity: "info", code: "schema.migrated.0.7.0.to.0.8.0", path: "schemaVersion" },
      ],
    });
    expect(preview.graph).toEqual(expected.graph);
    expect(preview.canonical).toBe(expected.canonical);
    expect(preview.canonical).toBe(stableSerialize(JSON.parse(preview.canonical)));
  });

  it("converts a flat 0.1.0 graph into recursive roots with explicit layout defaults", () => {
    const preview = previewGraphMigration(fixture("0.1.0"));
    expect(preview).toMatchObject({ fromVersion: "0.1.0", toVersion: "0.8.0", changed: true });
    expect(preview.graph.screens[0]?.nodes[0]).toMatchObject({
      children: [],
      layout: {
        height: "hug",
        align: "stretch",
        justify: "start",
        overflow: "visible",
        columns: 2,
        splitRatio: 0.5,
      },
    });
    expect(preview.graph).toEqual(previewGraphMigration(fixture("0.8.0")).graph);
  });

  it("upgrades legacy component catalog metadata into executable local definitions", () => {
    const input = fixture("0.2.0") as Record<string, unknown> & { components: unknown[] };
    input.components = [{
      id: "intent.status-message",
      kind: "status-message",
      description: "A reusable status message.",
    }];

    const preview = previewGraphMigration(input);
    expect(preview.graph.components).toEqual([expect.objectContaining({
      id: "intent.status-message",
      name: "Intent Status Message",
      description: "A reusable status message.",
      version: "1.0.0",
      template: expect.objectContaining({
        id: "intent.status-message.root",
        kind: "status-message",
        children: [],
      }),
      properties: [],
      slots: [],
      variants: [],
      states: [],
    })]);
    expect(preview.diagnostics).toContainEqual(expect.objectContaining({
      code: "schema.migrated.0.2.0.to.0.3.0",
    }));
  });

  it("preserves stable IDs, platform declarations, capabilities, and overrides", () => {
    const source = fixture("0.0.1") as {
      screens: Array<{ id: string; nodes: Array<{ id: string }> }>;
      platforms: unknown;
    };
    const preview = previewGraphMigration(source);

    expect(preview.graph.screens.map((screen) => screen.id)).toEqual(source.screens.map((screen) => screen.id));
    expect(preview.graph.screens.flatMap((screen) => screen.nodes.map((node) => node.id)))
      .toEqual(source.screens.flatMap((screen) => screen.nodes.map((node) => node.id)));
    expect(preview.graph.platforms).toEqual(source.platforms);
    expect(preview.graph.screens[0]?.nodes[0]?.platformOverrides).toEqual({
      compose: { "vendor-mode": true },
    });
  });

  it("treats the current version as an identity conversion", () => {
    const input = fixture("0.8.0");
    const preview = previewGraphMigration(input);
    expect(preview.changed).toBe(false);
    expect(preview.graph).toEqual(input);
    expect(preview.diagnostics).toEqual([expect.objectContaining({ code: "schema.current" })]);
  });

  it.each([
    [{ product: {} }, "schema.version.missing"],
    [{ schemaVersion: "0.0.0" }, "schema.version.unsupported"],
    [{ schemaVersion: "0.9.0" }, "schema.version.future"],
    [{ schemaVersion: "not-semver" }, "schema.version.unsupported"],
  ])("fails closed for unsupported version input %#", (input, code) => {
    expect(() => previewGraphMigration(input)).toThrow(GraphMigrationError);
    try {
      previewGraphMigration(input);
    } catch (error) {
      expect((error as GraphMigrationError).diagnostics[0]?.code).toBe(code);
    }
  });

  it("rejects invalid converted output and bounded oversized input", () => {
    expect(() => previewGraphMigration({ schemaVersion: "0.0.1" })).toThrow(/could not be converted/i);
    expect(() => previewGraphMigration({
      schemaVersion: "0.0.1",
      padding: "x".repeat(GRAPH_LIMITS.maxSerializedBytes),
    })).toThrow(/serialized bytes/i);
  });

  it("inherits expression-depth validation after conversion", () => {
    const input = fixture("0.0.1") as Record<string, unknown> & {
      screens: Array<{ nodes: Array<Record<string, unknown>> }>;
    };
    const node = input.screens[0]!.nodes[0]!;
    let expression: unknown = { op: "value", value: true };
    for (let index = 0; index < GRAPH_LIMITS.maxExpressionDepth + 2; index += 1) {
      expression = { op: "not", value: expression };
    }
    node.states = [{ name: "idle", visibleWhen: expression }];
    expect(() => previewGraphMigration(input)).toThrow(/maximum depth/i);
  });
});
