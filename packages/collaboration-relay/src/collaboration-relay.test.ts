import { encryptReviewBundle, reviewBundlePayloadSchema, sha256 } from "@intentform/ecosystem";
import { demoGraph } from "@intentform/proof-report/demo";
import { stableSerialize } from "@intentform/semantic-schema";
import { describe, expect, it } from "vitest";
import { OpaqueCollaborationRelay } from "./index.ts";

const key = Buffer.alloc(32, 4);
const now = new Date("2026-07-14T09:00:00.000Z");
const owner = { tenantId: "tenant.one", actorId: "owner.one", role: "owner" as const };
const editor = { tenantId: "tenant.one", actorId: "editor.one", role: "editor" as const };
const reviewer = { tenantId: "tenant.one", actorId: "reviewer.one", role: "reviewer" as const };
const otherTenant = { tenantId: "tenant.two", actorId: "owner.two", role: "owner" as const };

function envelope(bundleId = "00000000-0000-4000-8000-000000000011", expiresAt = "2026-07-15T09:00:00.000Z") {
  const proposed = structuredClone(demoGraph);
  proposed.product.name = "Relay proposal";
  const payload = reviewBundlePayloadSchema.parse({
    version: "1.0.0",
    bundleId,
    projectId: "verdant-pay",
    tenantId: "tenant.one",
    actorId: "editor.one",
    sequence: 1,
    createdAt: now.toISOString(),
    expiresAt,
    baseGraphDigest: sha256(stableSerialize(demoGraph)),
    proposedGraphDigest: sha256(stableSerialize(proposed)),
    baseGraph: demoGraph,
    proposedGraph: proposed,
  });
  return encryptReviewBundle(payload, key, "review.one", Buffer.alloc(12, 2));
}

function relay(maxBundlesPerProject = 4) {
  return new OpaqueCollaborationRelay({ region: "eu", retentionDays: 7, maxBundlesPerProject, maxEnvelopeBytes: 24_000_000 });
}

describe("opaque collaboration relay", () => {
  it("stores only encrypted envelopes and provides cursor-based review access", () => {
    const service = relay();
    const submitted = service.put(editor, envelope(), now);
    expect(submitted).toEqual({ cursor: "1", duplicate: false });
    const listed = service.list(reviewer, "verdant-pay", "0", 10, now);
    expect(listed.cursor).toBe("1");
    expect(JSON.stringify(listed.envelopes)).not.toContain("Relay proposal");
  });

  it("enforces tenant isolation and write roles before storage", () => {
    const service = relay();
    expect(() => service.put(otherTenant, envelope(), now)).toThrow(/tenant/i);
    expect(() => service.put(reviewer, envelope(), now)).toThrow(/cannot upload/i);
    service.put(owner, envelope(), now);
    expect(service.list(otherTenant, "verdant-pay", "0", 10, now).envelopes).toEqual([]);
  });

  it("is idempotent for identical bytes but rejects bundle-id substitution", () => {
    const service = relay();
    const first = envelope();
    service.put(editor, first, now);
    expect(service.put(editor, first, now)).toEqual({ cursor: "1", duplicate: true });
    const changed = { ...first, ciphertext: `${first.ciphertext.slice(0, -4)}AAAA` };
    expect(() => service.put(editor, changed, now)).toThrow(/different authenticated bytes/i);
  });

  it("enforces retention and prunes expired opaque data", () => {
    const service = relay();
    expect(() => service.put(editor, envelope("00000000-0000-4000-8000-000000000012", "2026-08-01T09:00:00.000Z"), now)).toThrow(/retention/i);
    service.put(editor, envelope(), now);
    expect(service.prune(new Date("2026-07-16T09:00:00.000Z"))).toBe(1);
    expect(service.list(reviewer, "verdant-pay", "0", 10, new Date("2026-07-16T09:00:00.000Z")).envelopes).toEqual([]);
  });

  it("bounds per-project storage and restricts deletion to owners", () => {
    const service = relay(1);
    service.put(editor, envelope("00000000-0000-4000-8000-000000000013"), now);
    service.put(editor, envelope("00000000-0000-4000-8000-000000000014"), now);
    expect(service.list(reviewer, "verdant-pay", "0", 10, now).envelopes[0]?.aad.bundleId).toBe("00000000-0000-4000-8000-000000000014");
    expect(() => service.deleteProject(editor, "verdant-pay")).toThrow(/owner/i);
    expect(service.deleteProject(owner, "verdant-pay")).toBe(true);
  });
});
