import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { demoGraph } from "../packages/proof-report/src/demo";
import { applyGraphPatch } from "../packages/semantic-schema/src/index";
import { verifyGraph } from "../packages/verifier/src/index";
import { bezelManifestChecksum, deviceBezelPackManifestSchema } from "../packages/device-bezels/src/index";
import { POST as interpret } from "../apps/studio-web/app/api/interpret/route";
import { GET as getProject, POST as migrateProjectRoute, PUT as putProject } from "../apps/studio-web/app/api/project/route";
import { GET as getPreviews, POST as mutatePreview } from "../apps/studio-web/app/api/project/previews/route";
import { GET as getProjectAsset } from "../apps/studio-web/app/api/project/assets/[digest]/route";
import { DELETE as cleanProjectAssets, POST as importProjectAssetRoute } from "../apps/studio-web/app/api/project/assets/route";
import { GET as listBezelPacks } from "../apps/studio-web/app/api/project/bezel-packs/route";
import { GET as getAgentActivity } from "../apps/studio-web/app/api/project/agent-activity/route";
import { GET as getBezelAsset } from "../apps/studio-web/app/api/project/bezel-packs/[packId]/[digest]/route";
import { POST as repair } from "../apps/studio-web/app/api/repair/route";
import { loadProject, saveProject } from "../packages/mcp-server/src/store";
import { recordAgentActivity } from "../packages/mcp-server/src/activity";
import {
  createPreviewBinding,
  createQueuedManifest,
  writePreviewEvidence,
} from "../packages/preview-daemon/src/index";
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
const originalBezelEnablement = process.env.INTENTFORM_ENABLE_LOCAL_BEZELS;

afterEach(() => {
  if (originalVercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = originalVercel;
  if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = originalVercelEnv;
  if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalApiKey;
  if (originalProjectDir === undefined) delete process.env.INTENTFORM_PROJECT_DIR;
  else process.env.INTENTFORM_PROJECT_DIR = originalProjectDir;
  if (originalBezelEnablement === undefined) delete process.env.INTENTFORM_ENABLE_LOCAL_BEZELS;
  else process.env.INTENTFORM_ENABLE_LOCAL_BEZELS = originalBezelEnablement;
});

function writeFixtureBezelPack(projectDir: string, revoked = false) {
  const bytes = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("api-fixture-only-bezel")]);
  const digest = createHash("sha256").update(bytes).digest("hex");
  const manifest = {
    format: "intentform-device-bezel-pack",
    version: "1.0.0",
    packId: "fixture.api",
    name: "API fixture",
    publisher: "IntentForm tests",
    revoked,
    license: {
      name: "Fixture terms",
      sourceUrl: "https://example.test/terms",
      termsAcknowledgement: "I confirm this fixture is used for local tests only.",
      redistribution: "local-reference-only",
    },
    profiles: [{
      deviceProfileId: "neutral.phone.compact",
      asset: { fileName: "frame.png", digest, mediaType: "image/png", byteLength: bytes.byteLength, width: 395, height: 707 },
      viewport: { x: 10, y: 20, width: 375, height: 667 },
    }],
  };
  const packRoot = join(projectDir, "bezel-packs", manifest.packId);
  mkdirSync(packRoot, { recursive: true });
  writeFileSync(join(packRoot, "frame.png"), bytes);
  writeFileSync(join(packRoot, "manifest.json"), JSON.stringify(manifest));
  return { bytes, digest, manifest };
}

function jsonRequest(url: string, body: unknown, method = "POST", headers: HeadersInit = {}) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function legacyDemoGraph() {
  const legacy = structuredClone(demoGraph) as unknown as Record<string, unknown> & {
    tokens: unknown;
    assets?: unknown;
  };
  legacy.schemaVersion = "0.0.1";
  legacy.tokens = structuredClone(demoGraph.tokens.modes[demoGraph.tokens.defaultMode]!.values);
  delete legacy.assets;
  return legacy;
}

function migratedLegacyDemoGraph() {
  const migrated = structuredClone(demoGraph);
  migrated.tokens = {
    defaultMode: "default",
    activeMode: "default",
    modes: {
      default: {
        name: "Default",
        values: structuredClone(demoGraph.tokens.modes[demoGraph.tokens.defaultMode]!.values),
      },
    },
    aliases: {},
    deprecated: {},
    extensions: {},
  };
  migrated.assets = [];
  return migrated;
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
  it("serves metadata-only agent policy locally and fails closed cross-origin", async () => {
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    const projectDir = mkdtempSync(join(tmpdir(), "intentform-agent-api-"));
    process.env.INTENTFORM_PROJECT_DIR = projectDir;
    try {
      recordAgentActivity(projectDir, {
        transport: "stdio",
        tool: "intentform_get_graph",
        access: "read",
        outcome: "succeeded",
        durationMs: 4,
      });
      const response = await getAgentActivity(new Request("http://localhost/api/project/agent-activity"));
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const payload = await response.json() as Record<string, unknown>;
      expect(payload).toMatchObject({
        policy: {
          scope: "current-local-project",
          arbitraryShell: false,
          arbitraryFilesystem: false,
          outboundNetwork: false,
        },
        entries: [{
          transport: "stdio",
          tool: "intentform_get_graph",
          access: "read",
          outcome: "succeeded",
          durationMs: 4,
        }],
      });
      expect(JSON.stringify(payload)).not.toMatch(/authorization|bearer [a-z0-9]|sourcePath|graph\.json/i);

      const blocked = await getAgentActivity(new Request("http://localhost/api/project/agent-activity", {
        headers: { origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
      }));
      expect(blocked.status).toBe(403);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("probes local preview availability without seeding or reading a project", async () => {
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    const projectDir = mkdtempSync(join(tmpdir(), "intentform-preview-probe-"));
    process.env.INTENTFORM_PROJECT_DIR = projectDir;
    try {
      const response = await getPreviews(new Request("http://localhost/api/project/previews?capability=1"));
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ available: true });
      expect(readdirSync(projectDir)).toEqual([]);

      process.env.VERCEL = "1";
      const hosted = await getPreviews(new Request("https://intentform.example/api/project/previews"));
      expect(hosted.status).toBe(403);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("rejects DNS-rebinding authorities even when Origin and Host agree", async () => {
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    const response = await getPreviews(new Request("http://localhost/api/project/previews?capability=1", {
      headers: {
        host: "attacker.example",
        origin: "http://attacker.example",
        "sec-fetch-site": "same-origin",
      },
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ available: false });
  });

  it("returns fresh fingerprint-bound preview evidence and marks it stale after an edit", async () => {
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    const projectDir = mkdtempSync(join(tmpdir(), "intentform-preview-evidence-"));
    process.env.INTENTFORM_PROJECT_DIR = projectDir;
    try {
      const opened = loadProject(projectDir);
      const binding = createPreviewBinding(opened.graph, opened.fingerprint, "browser");
      const queued = createQueuedManifest(binding);
      const now = new Date().toISOString();
      writePreviewEvidence(projectDir, {
        ...queued,
        phase: "ready",
        evidence: "built",
        updatedAt: now,
        completedAt: now,
        lastVerifiedRevision: opened.fingerprint,
      });
      const currentResponse = await getPreviews(new Request("http://localhost/api/project/previews"));
      const current = await currentResponse.json() as { fingerprint: string; targets: Array<Record<string, unknown>> };
      expect(currentResponse.status).toBe(200);
      expect(current.fingerprint).toBe(opened.fingerprint);
      expect(current.targets.find((entry) => entry.target === "browser")).toMatchObject({
        freshness: "fresh",
        buildStatus: "passed",
      });
      expect(JSON.stringify(current)).not.toContain("\"screens\"");

      const edited = structuredClone(opened.graph);
      edited.product.name = "Edited evidence project";
      const saved = saveProject(projectDir, edited, "invalidate evidence", opened.fingerprint);
      const staleResponse = await getPreviews(new Request("http://localhost/api/project/previews"));
      const stale = await staleResponse.json() as { fingerprint: string; targets: Array<Record<string, unknown>> };
      expect(stale.fingerprint).toBe(saved.fingerprint);
      expect(stale.targets.find((entry) => entry.target === "browser")).toMatchObject({
        freshness: "stale",
        buildStatus: "not-run",
      });
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("validates preview mutations and refuses a stale graph fingerprint before starting work", async () => {
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    const projectDir = mkdtempSync(join(tmpdir(), "intentform-preview-mutation-"));
    process.env.INTENTFORM_PROJECT_DIR = projectDir;
    try {
      const project = loadProject(projectDir);
      const invalid = await mutatePreview(jsonRequest(
        "http://localhost/api/project/previews",
        { action: "start", target: "shell", expectedGraphFingerprint: project.fingerprint },
        "POST",
        { origin: "http://localhost", "sec-fetch-site": "same-origin" },
      ));
      expect(invalid.status).toBe(422);

      const stale = await mutatePreview(jsonRequest(
        "http://localhost/api/project/previews",
        { action: "start", target: "browser", expectedGraphFingerprint: "00000000" },
        "POST",
        { origin: "http://localhost", "sec-fetch-site": "same-origin" },
      ));
      expect(stale.status).toBe(409);
      await expect(stale.json()).resolves.toMatchObject({ currentFingerprint: project.fingerprint });

      const cancelled = await mutatePreview(jsonRequest(
        "http://localhost/api/project/previews",
        { action: "cancel", target: "browser", expectedGraphFingerprint: project.fingerprint },
        "POST",
        { origin: "http://localhost", "sec-fetch-site": "same-origin" },
      ));
      expect(cancelled.status).toBe(200);
      await expect(cancelled.json()).resolves.toMatchObject({ target: { phase: "idle", buildStatus: "not-run" } });
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

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

  it("serves only manifest-authorized, digest-verified local media and never fonts", async () => {
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    const projectDir = mkdtempSync(join(tmpdir(), "intentform-api-assets-"));
    process.env.INTENTFORM_PROJECT_DIR = projectDir;
    try {
      const opened = loadProject(projectDir);
      const graph = structuredClone(opened.graph);
      const bytes = Buffer.from('<svg viewBox="0 0 8 8"><path d="M0 0h8v8H0z"/></svg>\n');
      const digest = createHash("sha256").update(bytes).digest("hex");
      graph.assets.push({
        id: "brand.mark",
        name: "Brand mark",
        kind: "icon",
        digest,
        mediaType: "image/svg+xml",
        byteLength: bytes.byteLength,
        storageKey: `assets/${digest}.svg`,
        width: 8,
        height: 8,
        variants: [],
        license: { name: "Project-owned", redistribution: "allowed" },
        exportPolicy: "copy",
        metadata: {},
      });
      const fontDigest = "b".repeat(64);
      graph.assets.push({
        id: "brand.font",
        name: "Brand font",
        kind: "font",
        digest: fontDigest,
        mediaType: "font/woff2",
        byteLength: 4,
        storageKey: `assets/${fontDigest}.woff2`,
        variants: [],
        license: { name: "Project-owned", redistribution: "allowed" },
        exportPolicy: "copy",
        metadata: {},
      });
      saveProject(projectDir, graph, "seed asset route", opened.fingerprint);
      mkdirSync(join(projectDir, "assets"), { recursive: true });
      writeFileSync(join(projectDir, "assets", `${digest}.svg`), bytes);

      const response = await getProjectAsset(
        new Request(`http://localhost/api/project/assets/${digest}`),
        { params: Promise.resolve({ digest }) },
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/svg+xml");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("content-security-policy")).toContain("sandbox");
      expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);

      const invalid = await getProjectAsset(
        new Request("http://localhost/api/project/assets/not-a-digest"),
        { params: Promise.resolve({ digest: "not-a-digest" }) },
      );
      expect(invalid.status).toBe(400);
      const missingDigest = "f".repeat(64);
      const missing = await getProjectAsset(
        new Request(`http://localhost/api/project/assets/${missingDigest}`),
        { params: Promise.resolve({ digest: missingDigest }) },
      );
      expect(missing.status).toBe(404);
      const font = await getProjectAsset(
        new Request(`http://localhost/api/project/assets/${fontDigest}`),
        { params: Promise.resolve({ digest: fontDigest }) },
      );
      expect(font.status).toBe(404);

      process.env.VERCEL = "1";
      const hosted = await getProjectAsset(
        new Request(`https://intentform.example/api/project/assets/${digest}`),
        { params: Promise.resolve({ digest }) },
      );
      expect(hosted.status).toBe(403);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("imports Studio asset bytes with an atomic fingerprinted manifest update", async () => {
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    const projectDir = mkdtempSync(join(tmpdir(), "intentform-api-asset-import-"));
    process.env.INTENTFORM_PROJECT_DIR = projectDir;
    try {
      const project = loadProject(projectDir);
      const svg = '<svg viewBox="0 0 12 6"><path fill="#123456" d="M0 0h12v6H0z"/></svg>';
      const form = new FormData();
      form.set("file", new File([svg], "Client Mark.svg", { type: "image/svg+xml" }));
      form.set("id", "asset.client-mark");
      form.set("name", "Client Mark");
      form.set("expectedFingerprint", project.fingerprint);
      form.set("licenseName", "Project-owned");
      form.set("spdx", "CC0-1.0");
      form.set("redistribution", "allowed");
      form.set("exportPolicy", "copy");
      const response = await importProjectAssetRoute(new Request("http://localhost/api/project/assets", {
        method: "POST",
        headers: { origin: "http://localhost", "sec-fetch-site": "same-origin" },
        body: form,
      }));
      expect(response.status).toBe(201);
      const payload = await response.json() as { asset: { id: string; width: number; height: number; storageKey: string }; graph: { assets: unknown[] }; fingerprint: string };
      expect(payload).toMatchObject({
        asset: { id: "asset.client-mark", width: 12, height: 6 },
      });
      expect(payload.fingerprint).not.toBe(project.fingerprint);
      expect(payload.graph.assets).toHaveLength(1);
      expect(readFileSync(join(projectDir, payload.asset.storageKey), "utf8")).toBe(`${svg}\n`);
      expect(readdirSync(join(projectDir, "imports"))).toEqual([]);
      expect(loadProject(projectDir).graph.assets).toEqual([expect.objectContaining({ id: "asset.client-mark" })]);

      const orphanStorageKey = `assets/${"a".repeat(64)}.svg`;
      writeFileSync(join(projectDir, orphanStorageKey), "unused");
      const cleaned = await cleanProjectAssets(new Request(`http://localhost/api/project/assets?expectedFingerprint=${payload.fingerprint}`, {
        method: "DELETE",
        headers: { origin: "http://localhost", "sec-fetch-site": "same-origin" },
      }));
      expect(cleaned.status).toBe(200);
      await expect(cleaned.json()).resolves.toEqual({ unused: [orphanStorageKey], removed: [orphanStorageKey] });
      expect(readFileSync(join(projectDir, payload.asset.storageKey), "utf8")).toBe(`${svg}\n`);

      const stale = new FormData();
      stale.set("file", new File([svg], "stale.svg", { type: "image/svg+xml" }));
      stale.set("id", "asset.stale");
      stale.set("name", "Stale");
      stale.set("expectedFingerprint", "0".repeat(64));
      stale.set("licenseName", "Project-owned");
      stale.set("redistribution", "unknown");
      stale.set("exportPolicy", "reference");
      const conflict = await importProjectAssetRoute(new Request("http://localhost/api/project/assets", {
        method: "POST",
        headers: { origin: "http://localhost", "sec-fetch-site": "same-origin" },
        body: stale,
      }));
      expect(conflict.status).toBe(409);

      process.env.VERCEL = "1";
      const hosted = await importProjectAssetRoute(new Request("https://intentform.example/api/project/assets", { method: "POST" }));
      expect(hosted.status).toBe(403);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("keeps local bezel packs kill-switched, acknowledged, inert and digest verified", async () => {
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    const projectDir = mkdtempSync(join(tmpdir(), "intentform-api-bezels-"));
    process.env.INTENTFORM_PROJECT_DIR = projectDir;
    try {
      const { bytes, digest, manifest: input } = writeFixtureBezelPack(projectDir);
      const manifest = deviceBezelPackManifestSchema.parse(input);
      const disabled = await listBezelPacks(new Request("http://localhost/api/project/bezel-packs"));
      expect(disabled.status).toBe(200);
      await expect(disabled.json()).resolves.toEqual({ enabled: false, packs: [], diagnostics: [] });

      process.env.INTENTFORM_ENABLE_LOCAL_BEZELS = "1";
      const listed = await listBezelPacks(new Request("http://localhost/api/project/bezel-packs"));
      const listing = await listed.json() as { packs: Array<{ manifestChecksum: string }> };
      expect(listing.packs).toHaveLength(1);
      expect(JSON.stringify(listing)).not.toMatch(/fileName|sourcePath|bytes/i);
      const checksum = bezelManifestChecksum(manifest);
      expect(listing.packs[0]?.manifestChecksum).toBe(checksum);
      const url = `http://localhost/api/project/bezel-packs/${manifest.packId}/${digest}?profile=neutral.phone.compact&version=1.0.0&manifest=${checksum}`;
      const unacknowledged = await getBezelAsset(new Request(url), { params: Promise.resolve({ packId: manifest.packId, digest }) });
      expect(unacknowledged.status).toBe(428);
      const asset = await getBezelAsset(new Request(`${url}&ack=1`), { params: Promise.resolve({ packId: manifest.packId, digest }) });
      expect(asset.status).toBe(200);
      expect(asset.headers.get("content-type")).toBe("image/png");
      expect(Buffer.from(await asset.arrayBuffer())).toEqual(bytes);

      writeFileSync(join(projectDir, "bezel-packs", manifest.packId, "frame.png"), "changed");
      const changed = await getBezelAsset(new Request(`${url}&ack=1`), { params: Promise.resolve({ packId: manifest.packId, digest }) });
      expect(changed.status).toBe(404);

      process.env.VERCEL = "1";
      const hosted = await listBezelPacks(new Request("https://intentform.example/api/project/bezel-packs"));
      expect(hosted.status).toBe(403);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("rejects cross-origin browser requests and invalid save bodies", async () => {
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    const crossOrigin = await getProject(new Request("http://localhost/api/project", {
      headers: { origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
    }));
    expect(crossOrigin.status).toBe(403);

    const normalizedSameOrigin = await getProject(new Request("http://localhost:4319/api/project?capability=1", {
      headers: {
        host: "127.0.0.1:4319",
        origin: "http://127.0.0.1:4319",
        "sec-fetch-site": "same-origin",
      },
    }));
    expect(normalizedSameOrigin.status).toBe(200);
    await expect(normalizedSameOrigin.json()).resolves.toEqual({ available: true });

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
      agentGraph.tokens.modes.default!.values.colors["color.accent"] = "#7a4b9e";
      const agentSave = saveProject(projectDir, agentGraph, "agent edit", opened.fingerprint);

      const staleGraph = structuredClone(demoGraph);
      staleGraph.tokens.modes.default!.values.colors["color.accent"] = "#315fcb";
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
      expect(loadProject(projectDir).graph.tokens.modes.default!.values.colors["color.accent"]).toBe("#7a4b9e");
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
      const legacy = legacyDemoGraph();
      const original = ` ${JSON.stringify(legacy, null, 2)}\n`;
      writeFileSync(join(projectDir, "graph.json"), original, "utf8");

      const open = await getProject(new Request("http://localhost/api/project"));
      const blocked = await open.json() as {
        migration: { sourceFingerprint: string; fromVersion: string; toVersion: string };
      };
      expect(open.status).toBe(409);
      expect(blocked.migration).toMatchObject({ fromVersion: "0.0.1", toVersion: "0.11.0" });
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
      expect(payload.graph).toEqual(migratedLegacyDemoGraph());
      expect(payload.migration.checkpointCreated).toBe(true);
      const checkpoints = readdirSync(join(projectDir, "migration-checkpoints"));
      expect(checkpoints).toHaveLength(1);
      expect(readFileSync(join(projectDir, "migration-checkpoints", checkpoints[0]!), "utf8")).toBe(original);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
