import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { compileReact } from "@intentform/compiler-react";
import { createPreviewBinding } from "@intentform/preview-daemon";
import { demoGraph } from "@intentform/proof-report/demo";
import { parseGraph, stableSerialize } from "@intentform/semantic-schema";
import { describe, expect, it } from "vitest";
import {
  OptionalSyncCoordinator,
  assertFreshReviewSequence,
  authorizePluginPermission,
  decryptReviewBundle,
  encryptReviewBundle,
  packageManifestSchema,
  packageSigningBytes,
  pluginGrantSchema,
  pluginManifestSchema,
  previewPackageUpdate,
  remoteEvidenceSigningBytes,
  reviewBundlePayloadSchema,
  sha256,
  syncConfigurationSchema,
  verifyPackage,
  verifyRemoteEvidence,
  type PackageArtifact,
  type PackageManifest,
  type TrustStore,
} from "./index.ts";

const keys = generateKeyPairSync("ed25519");
const otherKeys = generateKeyPairSync("ed25519");
const publicKeyPem = keys.publicKey.export({ format: "pem", type: "spki" }).toString();
const trust: TrustStore = {
  version: "1.0.0",
  keys: [{ keyId: "publisher.main", algorithm: "Ed25519", publicKeyPem, scopes: ["packages", "remote-evidence"], revoked: false }],
};

function componentArtifact(): PackageArtifact {
  return {
    formatVersion: "1.0.0",
    packageId: "@verdant/core",
    packageVersion: "1.0.0",
    kind: "component-library",
    components: [structuredClone(demoGraph.components[0]!)],
  };
}

function exportsFor(artifact: PackageArtifact): string[] {
  if (artifact.kind === "component-library") return artifact.components.map((entry) => `component:${entry.id}`).sort();
  if (artifact.kind === "token-library") return artifact.tokens.map((entry) => `token:${entry.modeId}:${entry.key}`).sort();
  return artifact.plugin.commands.map((entry) => `command:${entry.id}`).sort();
}

function signedPackage(artifact: PackageArtifact, changes: Partial<PackageManifest> = {}) {
  const canonical = stableSerialize(artifact);
  const manifest = packageManifestSchema.parse({
    abiVersion: "1.0.0",
    id: artifact.packageId,
    version: artifact.packageVersion,
    kind: artifact.kind,
    artifact: { digest: sha256(canonical), byteLength: Buffer.byteLength(canonical), mediaType: "application/vnd.intentform.package+json" },
    exports: exportsFor(artifact),
    dependencies: [],
    publisherKeyId: "publisher.main",
    visibility: "public",
    registry: "https://registry.intentform.test",
    publishedAt: "2026-07-14T08:00:00.000Z",
    sourceRevision: "git:abc123",
    license: "Apache-2.0",
    ...changes,
  });
  return { manifest, signature: sign(null, packageSigningBytes(manifest), keys.privateKey).toString("base64") };
}

function reviewPayload(sequence = 1, expiresAt = "2026-07-15T08:00:00.000Z") {
  const proposed = structuredClone(demoGraph);
  proposed.product.name = "Reviewed Verdant Pay";
  return reviewBundlePayloadSchema.parse({
    version: "1.0.0",
    bundleId: "00000000-0000-4000-8000-000000000001",
    projectId: "verdant-pay",
    tenantId: "tenant.eu",
    actorId: "reviewer.one",
    sequence,
    createdAt: "2026-07-14T08:00:00.000Z",
    expiresAt,
    baseGraphDigest: sha256(stableSerialize(demoGraph)),
    proposedGraphDigest: sha256(stableSerialize(proposed)),
    baseGraph: demoGraph,
    proposedGraph: proposed,
  });
}

const reviewKey = Buffer.alloc(32, 7);
const reviewNow = new Date("2026-07-14T09:00:00.000Z");
const fixedNonce = Buffer.alloc(12, 3);

describe("signed ecosystem packages", () => {
  it("verifies an Ed25519 signature, digest, identity, exports and provenance", () => {
    const artifact = componentArtifact();
    expect(verifyPackage(signedPackage(artifact), artifact, trust).dependency).toMatchObject({
      id: "@verdant/core",
      version: "1.0.0",
      kind: "component-library",
      publisherKeyId: "publisher.main",
    });
  });

  it("rejects tampered artifact bytes", () => {
    const artifact = componentArtifact();
    const tampered = structuredClone(artifact);
    if (tampered.kind === "component-library") tampered.components[0]!.name = "Tampered";
    expect(() => verifyPackage(signedPackage(artifact), tampered, trust)).toThrow(/byte length|digest/i);
  });

  it("rejects unknown, revoked, and wrong-scope trust roots", () => {
    const artifact = componentArtifact();
    const signed = signedPackage(artifact);
    expect(() => verifyPackage(signed, artifact, { version: "1.0.0", keys: [] })).toThrow(/unknown trust key/i);
    expect(() => verifyPackage(signed, artifact, { ...trust, keys: [{ ...trust.keys[0]!, revoked: true }] })).toThrow(/revoked/i);
    expect(() => verifyPackage(signed, artifact, { ...trust, keys: [{ ...trust.keys[0]!, scopes: ["remote-evidence"] }] })).toThrow(/not authorized/i);
  });

  it("rejects an invalid signature and identity mismatch", () => {
    const artifact = componentArtifact();
    const signed = signedPackage(artifact);
    const invalid = { ...signed, signature: sign(null, packageSigningBytes(signed.manifest), otherKeys.privateKey).toString("base64") };
    expect(() => verifyPackage(invalid, artifact, trust)).toThrow(/signature verification/i);
    expect(() => verifyPackage(signed, { ...artifact, packageVersion: "2.0.0" }, trust)).toThrow(/identity/i);
  });

  it("requires signed exports to equal typed artifact exports", () => {
    const artifact = componentArtifact();
    const signed = signedPackage(artifact, { exports: [] });
    expect(() => verifyPackage(signed, artifact, trust)).toThrow(/exports/i);
  });

  it("installs a component library into a graph and records its exact lock", () => {
    const artifact = componentArtifact();
    const graph = parseGraph({ ...structuredClone(demoGraph), components: [] });
    const preview = previewPackageUpdate(graph, signedPackage(artifact), artifact, trust);
    expect(preview.graph.components).toHaveLength(1);
    expect(preview.graph.dependencies[0]).toMatchObject({ id: "@verdant/core", version: "1.0.0" });
    expect(preview.changes.some((change) => change.path.includes("dependencies"))).toBe(true);
  });

  it("rejects collisions with locally owned components", () => {
    const artifact = componentArtifact();
    expect(() => previewPackageUpdate(demoGraph, signedPackage(artifact), artifact, trust)).toThrow(/collides/i);
  });

  it("requires every transitive dependency to be exactly locked", () => {
    const artifact = componentArtifact();
    const signed = signedPackage(artifact, { dependencies: [{ id: "@verdant/tokens", version: "1.0.0", manifestDigest: "a".repeat(64) }] });
    expect(() => previewPackageUpdate(parseGraph({ ...structuredClone(demoGraph), components: [] }), signed, artifact, trust)).toThrow(/exactly locked/i);
  });

  it("imports and atomically updates namespaced token values", () => {
    const artifact: PackageArtifact = {
      formatVersion: "1.0.0",
      packageId: "@verdant/tokens",
      packageVersion: "1.0.0",
      kind: "token-library",
      tokens: [{ modeId: "default", modeName: "Default", key: "color.ecosystem", type: "color", value: "#123456" }],
    };
    const installed = previewPackageUpdate(demoGraph, signedPackage(artifact), artifact, trust).graph;
    expect(installed.tokens.modes.default?.values.colors["color.ecosystem"]).toBe("#123456");

    const update: PackageArtifact = {
      formatVersion: "1.0.0",
      packageId: "@verdant/tokens",
      packageVersion: "1.1.0",
      kind: "token-library",
      tokens: [{ modeId: "default", modeName: "Default", key: "color.ecosystem", type: "color", value: "#654321" }],
    };
    const updated = previewPackageUpdate(installed, signedPackage(update), update, trust).graph;
    expect(updated.tokens.modes.default?.values.colors["color.ecosystem"]).toBe("#654321");
    expect(updated.dependencies.find((entry) => entry.id === "@verdant/tokens")?.version).toBe("1.1.0");
  });

  it("rejects non-HTTPS, credential-bearing, and inconsistent registry policy", () => {
    const artifact = componentArtifact();
    expect(() => signedPackage(artifact, { registry: "http://registry.example.test" })).toThrow(/HTTPS/i);
    expect(() => signedPackage(artifact, { registry: "https://user:pass@registry.example.test" })).toThrow(/credentials/i);
    expect(() => signedPackage(artifact, { visibility: "local", registry: "https://registry.example.test" })).toThrow(/local packages/i);
  });
});

describe("declarative plugin permissions", () => {
  const plugin = pluginManifestSchema.parse({
    apiVersion: "1.0.0",
    id: "@verdant/auditor",
    version: "1.0.0",
    name: "Auditor",
    description: "Runs the built-in verifier.",
    permissions: ["project.read", "compile.run"],
    commands: [{ id: "audit.run", title: "Run audit", action: "verify-project", parameters: {} }],
  });
  const grant = pluginGrantSchema.parse({
    pluginId: plugin.id,
    manifestDigest: "b".repeat(64),
    permissions: ["project.read"],
    grantedAt: "2026-07-14T08:00:00.000Z",
    grantedBy: "owner.one",
  });

  it("rejects executable plugin entrypoints because the ABI is data-only", () => {
    expect(() => pluginManifestSchema.parse({ ...plugin, entrypoint: "index.js" })).toThrow();
    expect(() => pluginManifestSchema.parse({ ...plugin, scripts: { postinstall: "node evil.js" } })).toThrow();
  });

  it("defaults to denial and only allows declared, current, explicitly granted permissions", () => {
    expect(() => authorizePluginPermission(plugin, "b".repeat(64), grant, "compile.run")).toThrow(/not granted/i);
    expect(() => authorizePluginPermission(plugin, "c".repeat(64), grant, "project.read")).toThrow(/stale/i);
    expect(() => authorizePluginPermission(plugin, "b".repeat(64), grant, "project.write")).toThrow(/did not declare/i);
    expect(() => authorizePluginPermission(plugin, "b".repeat(64), grant, "project.read")).not.toThrow();
  });
});

describe("encrypted collaboration and optional sync", () => {
  it("round-trips a fingerprint-bound review bundle with AES-256-GCM", () => {
    const encrypted = encryptReviewBundle(reviewPayload(), reviewKey, "review-key.one", fixedNonce);
    expect(encrypted.ciphertext).not.toContain("Reviewed Verdant Pay");
    expect(decryptReviewBundle(encrypted, reviewKey, reviewNow).proposedGraph.product.name).toBe("Reviewed Verdant Pay");
  });

  it("fails closed for wrong keys, ciphertext tampering, and AAD tampering", () => {
    const encrypted = encryptReviewBundle(reviewPayload(), reviewKey, "review-key.one", fixedNonce);
    expect(() => decryptReviewBundle(encrypted, randomBytes(32), reviewNow)).toThrow(/invalid|tampered/i);
    const ciphertext = Buffer.from(encrypted.ciphertext, "base64");
    ciphertext[0] = ciphertext[0]! ^ 1;
    expect(() => decryptReviewBundle({ ...encrypted, ciphertext: ciphertext.toString("base64") }, reviewKey, reviewNow)).toThrow(/invalid|tampered/i);
    expect(() => decryptReviewBundle({ ...encrypted, aad: { ...encrypted.aad, tenantId: "tenant.other" } }, reviewKey, reviewNow)).toThrow(/invalid|tampered/i);
  });

  it("rejects expired bundles and replayed actor sequences", () => {
    const encrypted = encryptReviewBundle(reviewPayload(4, "2026-07-14T08:30:00.000Z"), reviewKey, "review-key.one", fixedNonce);
    expect(() => decryptReviewBundle(encrypted, reviewKey, reviewNow)).toThrow(/expired|tampered/i);
    expect(() => assertFreshReviewSequence(reviewPayload(4), { "reviewer.one": 4 })).toThrow(/replay/i);
    expect(() => assertFreshReviewSequence(reviewPayload(5), { "reviewer.one": 4 })).not.toThrow();
  });

  it("disables sync cleanly with no endpoint or adapter", async () => {
    const coordinator = new OptionalSyncCoordinator({ mode: "disabled", endpoint: null, tenantId: "tenant.eu", region: "eu", retentionDays: 30, keyOwnership: "client-managed" }, null);
    const envelope = encryptReviewBundle(reviewPayload(), reviewKey, "review-key.one", fixedNonce);
    await expect(coordinator.submit(envelope)).resolves.toEqual({ state: "disabled" });
    expect(coordinator.status).toEqual({ mode: "disabled", queued: 0, localEditingAvailable: true });
  });

  it("queues encrypted envelopes during a total provider outage without blocking local compile", async () => {
    const coordinator = new OptionalSyncCoordinator(
      { mode: "hosted", endpoint: "https://sync.intentform.test", tenantId: "tenant.eu", region: "eu", retentionDays: 30, keyOwnership: "client-managed" },
      { push: async () => { throw new Error("total outage"); } },
    );
    const before = compileReact(demoGraph).fingerprint;
    await expect(coordinator.submit(encryptReviewBundle(reviewPayload(), reviewKey, "review-key.one", fixedNonce))).resolves.toEqual({ state: "queued" });
    expect(compileReact(demoGraph).fingerprint).toBe(before);
    expect(coordinator.status).toMatchObject({ queued: 1, localEditingAvailable: true });
  });

  it("enforces tenant isolation before an adapter sees an envelope", async () => {
    let calls = 0;
    const coordinator = new OptionalSyncCoordinator(
      { mode: "self-hosted", endpoint: "https://sync.example.test", tenantId: "tenant.other", region: "self-hosted", retentionDays: 7, keyOwnership: "client-managed" },
      { push: async () => { calls += 1; return { cursor: "1" }; } },
    );
    await expect(coordinator.submit(encryptReviewBundle(reviewPayload(), reviewKey, "review-key.one", fixedNonce))).rejects.toThrow(/tenant/i);
    expect(calls).toBe(0);
  });

  it("flushes a bounded offline queue after recovery", async () => {
    let online = false;
    const coordinator = new OptionalSyncCoordinator(
      { mode: "hosted", endpoint: "https://sync.intentform.test", tenantId: "tenant.eu", region: "eu", retentionDays: 30, keyOwnership: "client-managed" },
      { push: async () => { if (!online) throw new Error("offline"); return { cursor: "restored" }; } },
    );
    await coordinator.submit(encryptReviewBundle(reviewPayload(), reviewKey, "review-key.one", fixedNonce));
    online = true;
    await expect(coordinator.flush()).resolves.toEqual({ pushed: 1, remaining: 0 });
  });

  it("validates governance and self-host configuration instead of accepting ambiguous state", () => {
    expect(() => syncConfigurationSchema.parse({ mode: "disabled", endpoint: "https://sync.test", tenantId: "tenant.eu", region: "eu", retentionDays: 30, keyOwnership: "client-managed" })).toThrow(/disabled sync/i);
    expect(() => syncConfigurationSchema.parse({ mode: "self-hosted", endpoint: "https://sync.test", tenantId: "tenant.eu", region: "eu", retentionDays: 30, keyOwnership: "client-managed" })).toThrow(/self-hosted region/i);
  });
});

describe("signed remote evidence", () => {
  const binding = createPreviewBinding(demoGraph, "1234abcd", "browser");
  function signedEvidence(overrides: Record<string, unknown> = {}) {
    const statement = {
      version: "1.0.0",
      statementId: "00000000-0000-4000-8000-000000000002",
      projectId: "verdant-pay",
      tenantId: "tenant.eu",
      verifierId: "verifier.eu.one",
      issuerKeyId: "publisher.main",
      issuedAt: "2026-07-14T08:00:00.000Z",
      expiresAt: "2026-07-14T10:00:00.000Z",
      binding,
      result: { evidence: "built", buildStatus: "passed", artifactDigests: ["d".repeat(64)] },
      ...overrides,
    };
    return { statement, signature: sign(null, remoteEvidenceSigningBytes(statement), keys.privateKey).toString("base64") };
  }

  it("accepts signed evidence only for the exact tenant and preview binding", () => {
    expect(verifyRemoteEvidence(signedEvidence(), trust, binding, "tenant.eu", reviewNow)).toMatchObject({ result: { buildStatus: "passed" } });
  });

  it("rejects stale bindings, tenant confusion, invalid signatures, and expired statements", () => {
    const stale = createPreviewBinding({ ...structuredClone(demoGraph), product: { ...demoGraph.product, name: "Drifted" } }, "87654321", "browser");
    expect(() => verifyRemoteEvidence(signedEvidence(), trust, stale, "tenant.eu", reviewNow)).toThrow(/stale/i);
    expect(() => verifyRemoteEvidence(signedEvidence(), trust, binding, "tenant.other", reviewNow)).toThrow(/tenant/i);
    expect(() => verifyRemoteEvidence({ ...signedEvidence(), signature: sign(null, Buffer.from("wrong"), otherKeys.privateKey).toString("base64") }, trust, binding, "tenant.eu", reviewNow)).toThrow(/signature/i);
    expect(() => verifyRemoteEvidence(signedEvidence({ expiresAt: "2026-07-14T08:30:00.000Z" }), trust, binding, "tenant.eu", reviewNow)).toThrow(/validity/i);
  });
});
