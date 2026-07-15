import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { demoGraph } from "../packages/proof-report/src/demo";
import { applyGraphPatch } from "../packages/semantic-schema/src/index";
import { verifyGraph } from "../packages/verifier/src/index";
import { POST as interpret } from "../apps/studio-web/app/api/interpret/route";
import { GET as getProject, POST as migrateProjectRoute, PUT as putProject } from "../apps/studio-web/app/api/project/route";
import { POST as repair } from "../apps/studio-web/app/api/repair/route";
import { loadProject, saveProject } from "../packages/mcp-server/src/store";
import {
  API_BODY_LIMIT_BYTES,
  ApiInputError,
  interpretRequestSchema,
  parseRequestBody,
} from "../apps/studio-web/lib/api-contracts";

const originalVercel = process.env.VERCEL;
const originalVercelEnv = process.env.VERCEL_ENV;
const originalApiKey = process.env.OPENAI_API_KEY;
const originalProjectDir = process.env.INTENTFORM_PROJECT_DIR;

afterEach(() => {
  if (originalVercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = originalVercel;
  if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = originalVercelEnv;
  if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalApiKey;
  if (originalProjectDir === undefined) delete process.env.INTENTFORM_PROJECT_DIR;
  else process.env.INTENTFORM_PROJECT_DIR = originalProjectDir;
});

function jsonRequest(url: string, body: unknown, method = "POST", headers: HeadersInit = {}) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("strict API request contracts", () => {
  it("distinguishes malformed JSON, oversized payloads, and invalid shapes", async () => {
    await expect(parseRequestBody(
      new Request("http://localhost/api/interpret", { method: "POST", body: "{" }),
      interpretRequestSchema,
      "invalid",
    )).rejects.toMatchObject<ApiInputError>({ status: 400 });

    await expect(parseRequestBody(
      new Request("http://localhost/api/interpret", {
        method: "POST",
        headers: { "content-length": String(API_BODY_LIMIT_BYTES + 1) },
        body: "{}",
      }),
      interpretRequestSchema,
      "invalid",
    )).rejects.toMatchObject<ApiInputError>({ status: 413 });

    await expect(parseRequestBody(
      new Request("http://localhost/api/interpret", {
        method: "POST",
        body: "x".repeat(API_BODY_LIMIT_BYTES + 1),
      }),
      interpretRequestSchema,
      "invalid",
    )).rejects.toMatchObject<ApiInputError>({ status: 413 });

    const response = await interpret(jsonRequest("http://localhost/api/interpret", {
      operation: "create",
      brief: "Create a payment flow.",
      unexpected: true,
    }));
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: "The interpretation request is invalid." });
  });

  it("returns the deterministic graph for a valid create request without an API key", async () => {
    delete process.env.OPENAI_API_KEY;
    const response = await interpret(jsonRequest("http://localhost/api/interpret", {
      operation: "create",
      brief: "Create a trustworthy payment request flow.",
    }));
    const payload = await response.json() as { mode: string; graph: unknown };
    expect(response.status).toBe(200);
    expect(payload.mode).toBe("replay");
    expect(payload.graph).toEqual(demoGraph);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects an edit scoped to a screen that is not in the graph", async () => {
    const response = await interpret(jsonRequest("http://localhost/api/interpret", {
      operation: "edit",
      brief: "Rename the primary action label to “Continue”",
      graph: demoGraph,
      screenId: "missing-screen",
    }));
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: "The requested edit screen does not exist in the current graph.",
    });
  });
});

describe("repair verification boundary", () => {
  it("recomputes the finding and ignores forged browser descriptions", async () => {
    delete process.env.OPENAI_API_KEY;
    const graph = applyGraphPatch(demoGraph, {
      id: "test.break-placement",
      rationale: "Create a controlled verifier failure.",
      operations: [{
        op: "set-placement",
        target: "payment-request.confirm",
        compact: "inline",
        regular: "inline",
      }],
    });
    const scenario = { target: "swiftui" as const, viewport: { width: 375, height: 667 }, buildStatus: "not-run" as const };
    const finding = verifyGraph(graph, scenario).findings.find((candidate) => candidate.id.endsWith("primary.compact-reachability"));
    expect(finding).toBeDefined();

    const response = await repair(jsonRequest("http://localhost/api/repair", {
      graph,
      finding: { ...finding!, violatedIntent: "FORGED CLIENT DESCRIPTION" },
      scenario: { target: scenario.target, viewport: scenario.viewport },
    }));
    const payload = await response.json() as { proposal: { patch: { rationale: string } } };
    expect(response.status).toBe(200);
    expect(payload.proposal.patch.rationale).toBe(finding!.violatedIntent);
    expect(payload.proposal.patch.rationale).not.toContain("FORGED");
  });

  it("rejects a finding that fresh server-side verification cannot reproduce", async () => {
    const scenario = { target: "swiftui" as const, viewport: { width: 375, height: 667 }, buildStatus: "not-run" as const };
    const realFinding = verifyGraph(demoGraph, scenario).findings[0]!;
    const response = await repair(jsonRequest("http://localhost/api/repair", {
      graph: demoGraph,
      finding: { ...realFinding, id: "swiftui.forged.finding" },
      scenario: { target: scenario.target, viewport: scenario.viewport },
    }));
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: "That finding is not present in a fresh server-side verification of this graph.",
    });
  });
});

describe("local project trust boundary", () => {
  it("probes local bridge availability without seeding or reading a project", async () => {
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    const projectDir = mkdtempSync(join(tmpdir(), "intentform-api-probe-"));
    process.env.INTENTFORM_PROJECT_DIR = projectDir;
    try {
      const response = await getProject(new Request("http://localhost/api/project?capability=1"));
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ available: true });
      expect(readdirSync(projectDir)).toEqual([]);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("fails closed on Vercel before accessing the filesystem", async () => {
    process.env.VERCEL = "1";
    const response = await getProject(new Request("https://intentform.example/api/project"));
    expect(response.status).toBe(403);
    const probe = await getProject(new Request("https://intentform.example/api/project?capability=1"));
    expect(probe.status).toBe(200);
    await expect(probe.json()).resolves.toEqual({ available: false });
  });

  it("rejects cross-origin browser requests and invalid save bodies", async () => {
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    const crossOrigin = await getProject(new Request("http://localhost/api/project", {
      headers: { origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
    }));
    expect(crossOrigin.status).toBe(403);

    const invalid = await putProject(jsonRequest(
      "http://localhost/api/project",
      { graph: demoGraph, reason: "test", unexpected: true },
      "PUT",
      { origin: "http://localhost", "sec-fetch-site": "same-origin" },
    ));
    expect(invalid.status).toBe(422);
  });

  it("returns a conflict instead of overwriting an intervening agent edit", async () => {
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    const projectDir = mkdtempSync(join(tmpdir(), "intentform-api-project-"));
    process.env.INTENTFORM_PROJECT_DIR = projectDir;
    try {
      const openedResponse = await getProject(new Request("http://localhost/api/project"));
      const opened = await openedResponse.json() as { fingerprint: string };
      const agentGraph = structuredClone(demoGraph);
      agentGraph.tokens.colors["color.accent"] = "#7a4b9e";
      const agentSave = saveProject(projectDir, agentGraph, "agent edit", opened.fingerprint);

      const staleGraph = structuredClone(demoGraph);
      staleGraph.tokens.colors["color.accent"] = "#315fcb";
      const response = await putProject(jsonRequest(
        "http://localhost/api/project",
        { graph: staleGraph, reason: "studio save", expectedFingerprint: opened.fingerprint },
        "PUT",
        { origin: "http://localhost", "sec-fetch-site": "same-origin" },
      ));
      const payload = await response.json() as { currentFingerprint?: string; error?: string };

      expect(response.status).toBe(409);
      expect(payload.currentFingerprint).toBe(agentSave.fingerprint);
      expect(payload.error).toMatch(/changed after it was opened/i);
      expect(loadProject(projectDir).graph.tokens.colors["color.accent"]).toBe("#7a4b9e");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("reports migration diagnostics on open and migrates only after explicit conflict-safe approval", async () => {
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    const projectDir = mkdtempSync(join(tmpdir(), "intentform-api-migration-"));
    process.env.INTENTFORM_PROJECT_DIR = projectDir;
    try {
      const legacy = structuredClone(demoGraph) as unknown as Record<string, unknown>;
      legacy.schemaVersion = "0.0.1";
      const original = ` ${JSON.stringify(legacy, null, 2)}\n`;
      writeFileSync(join(projectDir, "graph.json"), original, "utf8");

      const open = await getProject(new Request("http://localhost/api/project"));
      const blocked = await open.json() as {
        migration: { sourceFingerprint: string; fromVersion: string; toVersion: string };
      };
      expect(open.status).toBe(409);
      expect(blocked.migration).toMatchObject({ fromVersion: "0.0.1", toVersion: "0.1.0" });
      expect(readdirSync(projectDir)).toEqual(["graph.json"]);

      const stale = await migrateProjectRoute(jsonRequest(
        "http://localhost/api/project",
        { expectedSourceFingerprint: "0".repeat(64) },
        "POST",
        { origin: "http://localhost", "sec-fetch-site": "same-origin" },
      ));
      expect(stale.status).toBe(409);
      expect(readFileSync(join(projectDir, "graph.json"), "utf8")).toBe(original);

      const applied = await migrateProjectRoute(jsonRequest(
        "http://localhost/api/project",
        { expectedSourceFingerprint: blocked.migration.sourceFingerprint },
        "POST",
        { origin: "http://localhost", "sec-fetch-site": "same-origin" },
      ));
      const payload = await applied.json() as { graph: typeof demoGraph; migration: { checkpointCreated: boolean } };
      expect(applied.status).toBe(200);
      expect(payload.graph).toEqual(demoGraph);
      expect(payload.migration.checkpointCreated).toBe(true);
      const checkpoints = readdirSync(join(projectDir, "migration-checkpoints"));
      expect(checkpoints).toHaveLength(1);
      expect(readFileSync(join(projectDir, "migration-checkpoints", checkpoints[0]!), "utf8")).toBe(original);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
