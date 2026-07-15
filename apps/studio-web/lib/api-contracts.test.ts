import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  API_BODY_LIMIT_BYTES,
  historyMutationRequestSchema,
  isLocalProjectRequestAllowed,
  parseRequestBody,
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
