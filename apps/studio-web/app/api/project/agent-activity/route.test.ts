import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadProject } from "@intentform/mcp-server/store";
import { SemanticTransactionService } from "@intentform/mcp-server/transactions";
import { GET, POST } from "./route";

let dir: string;
let priorProjectDir: string | undefined;

const request = (body?: unknown, origin = "http://127.0.0.1:3000") => new Request(`${origin}/api/project/agent-activity`, {
  ...(body === undefined ? { headers: { host: "127.0.0.1:3000" } } : {
    method: "POST",
    headers: { "content-type": "application/json", host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000", "sec-fetch-site": "same-origin" },
    body: JSON.stringify(body),
  }),
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "intentform-agent-review-api-"));
  priorProjectDir = process.env.INTENTFORM_PROJECT_DIR;
  process.env.INTENTFORM_PROJECT_DIR = dir;
});

afterEach(() => {
  if (priorProjectDir === undefined) delete process.env.INTENTFORM_PROJECT_DIR;
  else process.env.INTENTFORM_PROJECT_DIR = priorProjectDir;
  rmSync(dir, { recursive: true, force: true });
});

function previewTransaction() {
  const transactions = new SemanticTransactionService();
  const before = loadProject(dir);
  const begun = transactions.begin(dir, "api-test", before.fingerprint, "Move the primary action", "http");
  const previewed = transactions.preview(dir, "api-test", begun.transactionId, {
    id: "api.review",
    rationale: "Move the primary action",
    operations: [{ op: "set-placement", target: "payment-request.confirm", compact: "persistent-bottom", regular: "inline" }],
  });
  return { before, begun, previewed };
}

describe("local agent transaction review route", () => {
  it("streams an initial review snapshot and closes on abort", async () => {
    previewTransaction();
    const controller = new AbortController();
    const streamRequest = new Request("http://127.0.0.1:3000/api/project/agent-activity?stream=1", {
      headers: { host: "127.0.0.1:3000" },
      signal: controller.signal,
    });
    const response = await GET(streamRequest);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toMatch(/^data: .*"reviews"/);
    controller.abort();
    await reader.cancel().catch(() => undefined);
  });

  it("lists review-safe metadata and commits the exact candidate", async () => {
    const { before, begun, previewed } = previewTransaction();
    const listed = await GET(request());
    expect(listed.status).toBe(200);
    const payload = await listed.json();
    expect(payload.reviews[0]).toMatchObject({
      transactionId: begun.transactionId,
      transport: "http",
      status: "previewed",
      baseFingerprint: before.fingerprint,
      previewFingerprint: previewed.preview.previewFingerprint,
      commentId: null,
      historyOperationId: null,
    });
    expect(payload.reviews[0]).not.toHaveProperty("patch");

    const committed = await POST(request({
      action: "commit",
      transactionId: begun.transactionId,
      expectedPreviewFingerprint: previewed.preview.previewFingerprint,
    }));
    expect(committed.status).toBe(200);
    const committedPayload = await committed.json();
    expect(committedPayload).toMatchObject({ review: { status: "committed" }, committed: { fingerprint: previewed.preview.previewFingerprint } });
    expect(committedPayload.review.historyOperationId).toBe(committedPayload.committed.operation.id);
    expect(loadProject(dir).fingerprint).toBe(previewed.preview.previewFingerprint);
  });

  it("rejects without mutation and refuses stale or cross-origin actions", async () => {
    const { before, begun, previewed } = previewTransaction();
    const rejected = await POST(request({
      action: "reject",
      transactionId: begun.transactionId,
      expectedPreviewFingerprint: previewed.preview.previewFingerprint,
    }));
    expect(rejected.status).toBe(200);
    expect(await rejected.json()).toMatchObject({ review: { status: "rejected" }, projectChanged: false });
    expect(loadProject(dir).fingerprint).toBe(before.fingerprint);

    const stale = await POST(request({
      action: "commit",
      transactionId: begun.transactionId,
      expectedPreviewFingerprint: previewed.preview.previewFingerprint,
    }));
    expect(stale.status).toBe(409);

    const remote = new Request("http://localhost:3000/api/project/agent-activity", {
      method: "POST",
      headers: { "content-type": "application/json", host: "localhost:3000", origin: "https://evil.example", "sec-fetch-site": "cross-site" },
      body: JSON.stringify({ action: "reject", transactionId: begun.transactionId, expectedPreviewFingerprint: previewed.preview.previewFingerprint }),
    });
    expect((await POST(remote)).status).toBe(403);
  });
});
