import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  API_BODY_LIMIT_BYTES,
  historyMutationRequestSchema,
  isLocalProjectRequestAllowed,
  parseRequestBody,
  transactionReviewMutationSchema,
  verificationFindingSchema,
} from "./api-contracts";

describe("local history API contracts", () => {
  it("accepts only bounded explicit history actions", () => {
    expect(historyMutationRequestSchema.parse({ action: "create-branch", name: "agent-copy" }))
      .toEqual({ action: "create-branch", name: "agent-copy" });
    expect(historyMutationRequestSchema.parse({
      action: "apply-operation",
      operationId: "8e6941eb-d125-4c4a-b220-36f78fb9f32c",
      direction: "revert",
      expectedFingerprint: "1234abcd",
    })).toMatchObject({ action: "apply-operation", direction: "revert" });
    for (const invalid of [
      { action: "create-branch", name: "../escape" },
      { action: "create-branch", name: "main" },
      { action: "merge-branch", name: "agent-copy", expectedFingerprint: "stale" },
      { action: "recover-history", path: "/tmp/project" },
      { action: "shell", command: "git reset --hard" },
    ]) {
      expect(historyMutationRequestSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it("keeps history access loopback and same-origin only", () => {
    const local = new Request("http://127.0.0.1:3000/api/project/history", {
      headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000", "sec-fetch-site": "same-origin" },
    });
    const remoteHost = new Request("https://studio.example/api/project/history", {
      headers: { host: "studio.example", origin: "https://studio.example", "sec-fetch-site": "same-origin" },
    });
    const crossOrigin = new Request("http://localhost:3000/api/project/history", {
      headers: { host: "localhost:3000", origin: "https://evil.example", "sec-fetch-site": "cross-site" },
    });
    expect(isLocalProjectRequestAllowed(local)).toBe(true);
    expect(isLocalProjectRequestAllowed(remoteHost)).toBe(false);
    expect(isLocalProjectRequestAllowed(crossOrigin)).toBe(false);
  });

  it("accepts only fingerprint-bound agent transaction decisions", () => {
    const valid = {
      action: "commit",
      transactionId: "8e6941eb-d125-4c4a-b220-36f78fb9f32c",
      expectedPreviewFingerprint: "1234abcd",
    };
    expect(transactionReviewMutationSchema.parse(valid)).toEqual(valid);
    expect(transactionReviewMutationSchema.safeParse({ ...valid, expectedPreviewFingerprint: "stale" }).success).toBe(false);
    expect(transactionReviewMutationSchema.safeParse({ ...valid, action: "approve", shell: "git commit" }).success).toBe(false);
  });

  it("accepts exact verification evidence identity and rejects malformed source fingerprints", () => {
    const finding = {
      id: "react.checkout.primary",
      target: "react",
      screenId: "checkout",
      severity: "error",
      violatedIntent: "Keep the action reachable.",
      evidence: [],
      responsibleLayer: "graph",
      status: "open",
      nodeId: "checkout.confirm",
      propertyPath: "checkout.confirm.layout.placement.compact",
      deviceProfile: "device:phone",
      visualState: "idle",
      sourceFingerprint: "1234abcd",
    } as const;
    expect(verificationFindingSchema.parse(finding)).toEqual(finding);
    expect(verificationFindingSchema.safeParse({ ...finding, sourceFingerprint: "stale" }).success).toBe(false);
  });

  it("keeps the public body limit while allowing an explicit bounded local-project envelope", async () => {
    const source = JSON.stringify({ value: "x".repeat(API_BODY_LIMIT_BYTES + 1) });
    const request = () => new Request("http://127.0.0.1:3000/api/project", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: source,
    });
    const schema = z.object({ value: z.string() }).strict();

    await expect(parseRequestBody(request(), schema, "invalid")).rejects.toMatchObject({ status: 413 });
    await expect(parseRequestBody(request(), schema, "invalid", source.length + 1)).resolves.toEqual({
      value: "x".repeat(API_BODY_LIMIT_BYTES + 1),
    });
  });
});
