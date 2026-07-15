import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyPatch, applyProjectBranchPatch } from "@intentform/mcp-server/tools";
import { loadProject } from "@intentform/mcp-server/store";
import { GET, POST } from "./route";

let dir: string;
let priorProjectDir: string | undefined;

const request = (body?: unknown, origin = "http://127.0.0.1:3000") => new Request(`${origin}/api/project/history`, {
  ...(body === undefined ? {} : {
    method: "POST",
    headers: { "content-type": "application/json", host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000", "sec-fetch-site": "same-origin" },
    body: JSON.stringify(body),
  }),
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "intentform-history-api-"));
  priorProjectDir = process.env.INTENTFORM_PROJECT_DIR;
  process.env.INTENTFORM_PROJECT_DIR = dir;
});

afterEach(() => {
  if (priorProjectDir === undefined) delete process.env.INTENTFORM_PROJECT_DIR;
  else process.env.INTENTFORM_PROJECT_DIR = priorProjectDir;
  rmSync(dir, { recursive: true, force: true });
});

describe("local operation history route", () => {
  it("reads history and creates an isolated human branch", async () => {
    const seeded = loadProject(dir);
    const read = await GET(request());
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ integrity: "valid", currentFingerprint: seeded.fingerprint });

    const created = await POST(request({ action: "create-branch", name: "human-review" }));
    expect(created.status).toBe(200);
    expect(await created.json()).toMatchObject({
      branch: "human-review",
      operation: { kind: "branch-create", author: "human" },
    });
    expect(loadProject(dir).fingerprint).toBe(seeded.fingerprint);
  });

  it("returns path conflicts and refuses a conflicting merge", async () => {
    const seeded = loadProject(dir);
    await POST(request({ action: "create-branch", name: "copy-review" }));
    applyProjectBranchPatch(dir, "copy-review", {
      id: "agent-copy",
      rationale: "agent label",
      operations: [{ op: "set-label", target: "payment-request.confirm", label: "Agent label" }],
    }, seeded.fingerprint);
    const main = applyPatch(dir, {
      id: "human-copy",
      rationale: "human label",
      operations: [{ op: "set-label", target: "payment-request.confirm", label: "Human label" }],
    }, seeded.fingerprint);

    const preview = await POST(request({ action: "preview-merge", name: "copy-review" }));
    expect(preview.status).toBe(200);
    expect(await preview.json()).toMatchObject({
      conflicts: [expect.objectContaining({ reason: "both-modified", path: expect.stringContaining("intent.label") })],
    });
    const merge = await POST(request({ action: "merge-branch", name: "copy-review", expectedFingerprint: main.fingerprint }));
    expect(merge.status).toBe(409);
    expect(await merge.json()).toMatchObject({ error: expect.stringMatching(/requires review/i), conflicts: expect.any(Array) });
    expect(loadProject(dir).fingerprint).toBe(main.fingerprint);
  });

  it("rejects malformed, cross-origin and hosted requests before mutation", async () => {
    loadProject(dir);
    const malformed = await POST(request({ action: "create-branch", name: "../escape" }));
    expect(malformed.status).toBe(422);
    const crossOrigin = new Request("http://localhost:3000/api/project/history", {
      headers: { host: "localhost:3000", origin: "https://evil.example", "sec-fetch-site": "cross-site" },
    });
    expect((await GET(crossOrigin)).status).toBe(403);
    process.env.VERCEL = "1";
    try {
      expect((await GET(request())).status).toBe(403);
    } finally {
      delete process.env.VERCEL;
    }
  });
});
