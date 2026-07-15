import {
  GRAPH_LIMITS,
  parseGraph,
  stableSerialize,
  type SemanticInterfaceGraph,
} from "./index";

export const CURRENT_SCHEMA_VERSION = "0.4.0" as const;
export const SUPPORTED_SCHEMA_VERSIONS = ["0.0.1", "0.1.0", "0.2.0", "0.3.0", CURRENT_SCHEMA_VERSION] as const;

export type SupportedSchemaVersion = typeof SUPPORTED_SCHEMA_VERSIONS[number];
export type MigrationDiagnosticSeverity = "info" | "warning" | "error";

export interface MigrationDiagnostic {
  severity: MigrationDiagnosticSeverity;
  code: string;
  path: string;
  message: string;
}

export interface GraphMigrationPreview {
  fromVersion: SupportedSchemaVersion;
  toVersion: typeof CURRENT_SCHEMA_VERSION;
  changed: boolean;
  graph: SemanticInterfaceGraph;
  canonical: string;
  diagnostics: MigrationDiagnostic[];
}

export class GraphMigrationError extends Error {
  readonly diagnostics: MigrationDiagnostic[];

  constructor(diagnostics: MigrationDiagnostic[]) {
    super(diagnostics[0]?.message ?? "The graph could not be migrated.");
    this.name = "GraphMigrationError";
    this.diagnostics = diagnostics;
  }
}

type MigrationStep = {
  toVersion: SupportedSchemaVersion;
  convert(input: Readonly<Record<string, unknown>>): Record<string, unknown>;
};

/* Version converters are deliberately data-only. They cannot evaluate source,
   load modules, or depend on wall-clock state. A step must preserve authored
   identities unless that version's ADR explicitly documents an ID rewrite. */
const migrationSteps: Partial<Record<SupportedSchemaVersion, MigrationStep>> = {
  "0.0.1": {
    toVersion: "0.1.0",
    convert: (input) => ({ ...structuredClone(input), schemaVersion: "0.1.0" }),
  },
  "0.1.0": {
    toVersion: "0.2.0",
    convert: (input) => ({ ...structuredClone(input), schemaVersion: "0.2.0" }),
  },
  "0.2.0": {
    toVersion: "0.3.0",
    convert: (input) => {
      const next = structuredClone(input) as Record<string, unknown>;
      const components = Array.isArray(next.components) ? next.components : [];
      const spacing = next.tokens && typeof next.tokens === "object"
        && "spacing" in next.tokens && next.tokens.spacing && typeof next.tokens.spacing === "object"
        ? Object.keys(next.tokens.spacing)
        : [];
      const gapToken = spacing[0] ?? "space.16";
      const paddingToken = spacing[1] ?? gapToken;
      next.components = components.map((value, index) => {
        if (!value || typeof value !== "object" || !("kind" in value)) return value;
        const legacy = value as Record<string, unknown>;
        const id = typeof legacy.id === "string" ? legacy.id : `component-${index + 1}`;
        const kind = typeof legacy.kind === "string" ? legacy.kind : "stack";
        const description = typeof legacy.description === "string"
          ? legacy.description
          : `Migrated ${id} component`;
        const rootId = `${id.slice(0, 89)}.root`;
        const name = id.split(/[.-]/).filter(Boolean).map((part) =>
          `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(" ") || `Component ${index + 1}`;
        return {
          id,
          name,
          description,
          version: "1.0.0",
          template: {
            id: rootId,
            kind,
            intent: { purpose: description, label: name, importance: "supporting" },
            layout: { axis: "vertical", width: "fill", gapToken, paddingToken },
            style: { role: kind, emphasis: "normal" },
            accessibility: { label: name, live: "off" },
            states: [],
            interactions: [],
            provenance: { author: "system", revision: 0 },
            children: [],
          },
          properties: [],
          slots: [],
          variants: [],
          states: [],
        };
      });
      next.schemaVersion = "0.3.0";
      return next;
    },
  },
  "0.3.0": {
    toVersion: CURRENT_SCHEMA_VERSION,
    convert: (input) => {
      const next = structuredClone(input) as Record<string, unknown>;
      const legacyTokens = next.tokens && typeof next.tokens === "object"
        ? next.tokens as Record<string, unknown>
        : {};
      next.tokens = {
        defaultMode: "default",
        activeMode: "default",
        modes: {
          default: {
            name: "Default",
            values: {
              colors: structuredClone(legacyTokens.colors ?? {}),
              spacing: structuredClone(legacyTokens.spacing ?? {}),
              radii: structuredClone(legacyTokens.radii ?? {}),
            },
          },
        },
        aliases: {},
        deprecated: {},
        extensions: {},
      };
      next.assets = [];
      next.schemaVersion = CURRENT_SCHEMA_VERSION;
      return next;
    },
  },
};

function fail(code: string, message: string, path = "schemaVersion"): never {
  throw new GraphMigrationError([{ severity: "error", code, path, message }]);
}

function serializedSize(input: unknown): number {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(input);
  } catch {
    fail("schema.input.not-json", "Graph input must be JSON-serializable.", "$");
  }
  if (serialized === undefined) fail("schema.input.not-object", "Graph input must be a JSON object.", "$");
  return new TextEncoder().encode(serialized).byteLength;
}

function rootRecord(input: unknown): Record<string, unknown> {
  const size = serializedSize(input);
  if (size > GRAPH_LIMITS.maxSerializedBytes) {
    fail(
      "schema.input.too-large",
      `Graph input exceeds ${GRAPH_LIMITS.maxSerializedBytes} serialized bytes.`,
      "$",
    );
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("schema.input.not-object", "Graph input must be a JSON object.", "$");
  }
  return input as Record<string, unknown>;
}

function supportedVersion(input: Record<string, unknown>): SupportedSchemaVersion {
  const version = input.schemaVersion;
  if (typeof version !== "string" || version.length === 0) {
    fail(
      "schema.version.missing",
      `Graph schemaVersion is required. Supported versions: ${SUPPORTED_SCHEMA_VERSIONS.join(", ")}.`,
    );
  }
  if ((SUPPORTED_SCHEMA_VERSIONS as readonly string[]).includes(version)) {
    return version as SupportedSchemaVersion;
  }
  const currentParts = CURRENT_SCHEMA_VERSION.split(".").map(Number);
  const candidateParts = /^\d+\.\d+\.\d+$/.test(version) ? version.split(".").map(Number) : null;
  const firstDifference = candidateParts?.findIndex((part, index) => part !== currentParts[index]) ?? -1;
  const isFuture = firstDifference >= 0
    && candidateParts![firstDifference]! > currentParts[firstDifference]!;
  fail(
    isFuture ? "schema.version.future" : "schema.version.unsupported",
    isFuture
      ? `Graph schema ${version} is newer than supported schema ${CURRENT_SCHEMA_VERSION}; update IntentForm before opening it.`
      : `Graph schema ${version} is not supported. Supported versions: ${SUPPORTED_SCHEMA_VERSIONS.join(", ")}.`,
  );
}

function invalidMigration(error: unknown, fromVersion: SupportedSchemaVersion): never {
  const detail = error instanceof Error ? error.message.slice(0, 500) : "schema validation failed";
  fail(
    "schema.migration.invalid-result",
    `Schema ${fromVersion} could not be converted to ${CURRENT_SCHEMA_VERSION}: ${detail}`,
    "$",
  );
}

export function previewGraphMigration(input: unknown): GraphMigrationPreview {
  let current = rootRecord(input);
  const fromVersion = supportedVersion(current);
  const diagnostics: MigrationDiagnostic[] = [];
  let version: SupportedSchemaVersion = fromVersion;

  while (version !== CURRENT_SCHEMA_VERSION) {
    const step = migrationSteps[version];
    if (!step) {
      fail("schema.migration.missing-step", `No migration step is registered for schema ${version}.`);
    }
    current = rootRecord(step.convert(current));
    diagnostics.push({
      severity: "info",
      code: `schema.migrated.${version}.to.${step.toVersion}`,
      path: "schemaVersion",
      message: `Converted schema ${version} to ${step.toVersion}.`,
    });
    version = step.toVersion;
  }

  let graph: SemanticInterfaceGraph;
  try {
    graph = parseGraph(current);
  } catch (error) {
    invalidMigration(error, fromVersion);
  }

  const changed = fromVersion !== CURRENT_SCHEMA_VERSION;
  if (!changed) {
    diagnostics.push({
      severity: "info",
      code: "schema.current",
      path: "schemaVersion",
      message: `Graph already uses schema ${CURRENT_SCHEMA_VERSION}.`,
    });
  }
  return {
    fromVersion,
    toVersion: CURRENT_SCHEMA_VERSION,
    changed,
    graph,
    canonical: stableSerialize(graph),
    diagnostics,
  };
}
