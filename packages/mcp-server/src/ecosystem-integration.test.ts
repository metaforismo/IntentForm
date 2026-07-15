import { generateKeyPairSync, sign } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  packageManifestSchema,
  packageSigningBytes,
  remoteEvidenceSigningBytes,
  sha256,
  type EncryptedReviewBundle,
  type PackageArtifact,
  type PackageManifest,
  type TrustStore,
} from "@intentform/ecosystem";
import { createPreviewBinding } from "@intentform/preview-daemon";
import { stableSerialize } from "@intentform/semantic-schema";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyPatch,
  applyProjectBranchPatch,
  applyProjectPackageUpdate,
  applyProjectReviewBundle,
  createProjectBranch,
  exportProjectReviewBundle,
  previewProjectPackageUpdate,
  previewProjectReviewBundle,
  projectEcosystemResource,
  setProjectPluginPermissions,
  verifyProjectRemoteEvidence,
} from "./tools.ts";
import { loadProject } from "./store.ts";
import { readPackageArtifact, writePackageArtifact } from "./ecosystem-store.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function projectDir(): string {
  const root = mkdtempSync(join(tmpdir(), "intentform-ecosystem-"));
  roots.push(root);
  return root;
}

const keyPair = generateKeyPairSync("ed25519");
const publicKeyPem = keyPair.publicKey.export({ format: "pem", type: "spki" }).toString();
const trust: TrustStore = {
  version: "1.0.0",
  keys: [{ keyId: "publisher.integration", algorithm: "Ed25519", publicKeyPem, scopes: ["packages", "remote-evidence"], revoked: false }],
};

function writeTrust(dir: string, store: TrustStore = trust): void {
  mkdirSync(join(dir, "ecosystem"), { recursive: true });
  writeFileSync(join(dir, "ecosystem", "trust.json"), stableSerialize(store), { mode: 0o600 });
}

function pluginArtifact(version = "1.0.0"): PackageArtifact {
  return {
    formatVersion: "1.0.0",
    packageId: "@verdant/auditor",
    packageVersion: version,
    kind: "plugin",
    plugin: {
      apiVersion: "1.0.0",
      id: "@verdant/auditor",
      version,
      name: "Verdant Auditor",
      description: "Declaratively exposes built-in verification.",
      permissions: ["project.read", "compile.run"],
      commands: [{ id: "audit.run", title: "Run audit", action: "verify-project", parameters: {} }],
    },
  };
}

function signedPackage(artifact: PackageArtifact, changes: Partial<PackageManifest> = {}) {
  const canonical = stableSerialize(artifact);
  const exports = artifact.kind === "plugin"
    ? artifact.plugin.commands.map((command) => `command:${command.id}`)
    : artifact.kind === "component-library"
      ? artifact.components.map((component) => `component:${component.id}`)
      : artifact.tokens.map((token) => `token:${token.modeId}:${token.key}`);
  const manifest = packageManifestSchema.parse({
    abiVersion: "1.0.0",
    id: artifact.packageId,
    version: artifact.packageVersion,
    kind: artifact.kind,
    artifact: { digest: sha256(canonical), byteLength: Buffer.byteLength(canonical), mediaType: "application/vnd.intentform.package+json" },
    exports,
    dependencies: [],
    publisherKeyId: "publisher.integration",
    visibility: "private",
    registry: "https://packages.example.test/intentform",
    publishedAt: "2026-07-14T08:00:00.000Z",
    sourceRevision: "git:integration",
    license: "Proprietary",
    ...changes,
  });
  return { manifest, signature: sign(null, packageSigningBytes(manifest), keyPair.privateKey).toString("base64") };
}

function installPlugin(dir: string) {
  const opened = loadProject(dir);
  writeTrust(dir);
  const artifact = pluginArtifact();
  const signed = signedPackage(artifact);
  const applied = applyProjectPackageUpdate(dir, signed, artifact, opened.fingerprint);
  return { artifact, signed, applied };
}

describe("project ecosystem integration", () => {
  it("previews then installs a signed plugin into the graph and verified cache", () => {
    const dir = projectDir();
    const opened = loadProject(dir);
    writeTrust(dir);
    const artifact = pluginArtifact();
    const signed = signedPackage(artifact);

    const preview = previewProjectPackageUpdate(dir, signed, artifact);
    expect(preview).toMatchObject({ fingerprint: opened.fingerprint, dependency: { id: "@verdant/auditor" } });
    expect(loadProject(dir).graph.dependencies).toEqual([]);

    const applied = applyProjectPackageUpdate(dir, signed, artifact, opened.fingerprint);
    expect(applied).toMatchObject({ fingerprint: preview.previewFingerprint, cacheStatus: "verified" });
    expect(projectEcosystemResource(dir)).toMatchObject({
      executablePlugins: false,
      compilersFetchPackages: false,
      packages: [{ id: "@verdant/auditor", cache: "verified", plugin: { grantedPermissions: [] } }],
    });
  });

  it("refuses package mutation without a trusted publisher or with a stale graph fingerprint", () => {
    const dir = projectDir();
    const opened = loadProject(dir);
    const artifact = pluginArtifact();
    const signed = signedPackage(artifact);
    expect(() => previewProjectPackageUpdate(dir, signed, artifact)).toThrow(/unknown trust key/i);
    writeTrust(dir);
    expect(() => applyProjectPackageUpdate(dir, signed, artifact, "00000000")).toThrow(/fingerprint conflict/i);
    expect(loadProject(dir).graph.dependencies).toEqual([]);
    expect(loadProject(dir).fingerprint).toBe(opened.fingerprint);
  });

  it("binds plugin grants to declared permissions and the exact installed manifest", () => {
    const dir = projectDir();
    const { applied } = installPlugin(dir);
    const dependency = loadProject(dir).graph.dependencies[0]!;
    expect(() => setProjectPluginPermissions(dir, {
      pluginId: dependency.id,
      manifestDigest: dependency.manifestDigest,
      permissions: ["project.write"],
      grantedBy: "owner.integration",
      expectedFingerprint: applied.fingerprint,
    })).toThrow(/did not request/i);
    expect(() => setProjectPluginPermissions(dir, {
      pluginId: dependency.id,
      manifestDigest: "f".repeat(64),
      permissions: ["project.read"],
      grantedBy: "owner.integration",
      expectedFingerprint: applied.fingerprint,
    })).toThrow(/changed after permission review/i);
    expect(setProjectPluginPermissions(dir, {
      pluginId: dependency.id,
      manifestDigest: dependency.manifestDigest,
      permissions: ["project.read"],
      grantedBy: "owner.integration",
      expectedFingerprint: applied.fingerprint,
    })).toMatchObject({ grantedPermissions: ["project.read"] });
    expect(projectEcosystemResource(dir).packages[0]?.plugin).toMatchObject({ grantedPermissions: ["project.read"] });
  });

  it("refuses symlinked package cache directories without mutating the graph", () => {
    const dir = projectDir();
    const opened = loadProject(dir);
    writeTrust(dir);
    const outside = projectDir();
    symlinkSync(outside, join(dir, "ecosystem", "packages"), "dir");
    const artifact = pluginArtifact();
    expect(() => applyProjectPackageUpdate(dir, signedPackage(artifact), artifact, opened.fingerprint)).toThrow(/regular local directories/i);
    expect(loadProject(dir).graph.dependencies).toEqual([]);
  });

  it("refuses symlinked package cache files even when their target bytes match", () => {
    const dir = projectDir();
    const { artifact } = installPlugin(dir);
    const dependency = loadProject(dir).graph.dependencies[0]!;
    const canonical = stableSerialize(artifact);
    const cachePath = join(dir, "ecosystem", "packages", `${dependency.artifactDigest}.json`);
    const outside = projectDir();
    const outsideArtifact = join(outside, "artifact.json");
    writeFileSync(outsideArtifact, canonical, { mode: 0o600 });
    rmSync(cachePath);
    symlinkSync(outsideArtifact, cachePath, "file");

    expect(() => readPackageArtifact(dir, dependency.artifactDigest)).toThrow(/regular local files/i);
    expect(() => writePackageArtifact(dir, dependency.artifactDigest, canonical)).toThrow(/regular local files/i);
    expect(projectEcosystemResource(dir).packages[0]?.cache).toBe("invalid");
  });

  it("exports a branch and applies an encrypted semantic review exactly once", () => {
    const source = projectDir();
    const target = projectDir();
    const base = loadProject(source);
    const targetBase = loadProject(target);
    const branch = createProjectBranch(source, "copy-review");
    const nodeId = base.graph.screens[0]!.nodes[0]!.id;
    applyProjectBranchPatch(source, "copy-review", {
      id: "review-copy",
      rationale: "Review a copy improvement",
      operations: [{ op: "set-label", target: nodeId, label: "Encrypted review label" }],
    }, branch.fingerprint);
    const keyBase64 = Buffer.alloc(32, 9).toString("base64");
    const exported = exportProjectReviewBundle(source, {
      branch: "copy-review",
      projectId: "verdant-pay",
      tenantId: "tenant.integration",
      actorId: "reviewer.integration",
      sequence: 1,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      keyId: "review.integration",
      keyBase64,
    });
    const envelope = exported.envelope as EncryptedReviewBundle;
    const preview = previewProjectReviewBundle(target, envelope, keyBase64, targetBase.fingerprint, "verdant-pay", "tenant.integration");
    expect(preview).toMatchObject({ conflicts: [], sequence: 1 });
    const applied = applyProjectReviewBundle(target, envelope, keyBase64, targetBase.fingerprint, "verdant-pay", "tenant.integration");
    expect(applied.fingerprint).toBe(preview.previewFingerprint);
    expect(loadProject(target).graph.screens[0]!.nodes[0]!.intent.label).toBe("Encrypted review label");
    expect(() => previewProjectReviewBundle(target, envelope, keyBase64, applied.fingerprint, "verdant-pay", "tenant.integration")).toThrow(/replay/i);
  });

  it("surfaces encrypted review conflicts without changing either side", () => {
    const source = projectDir();
    const target = projectDir();
    const base = loadProject(source);
    createProjectBranch(source, "conflicting-review");
    const nodeId = base.graph.screens[0]!.nodes[0]!.id;
    applyProjectBranchPatch(source, "conflicting-review", {
      id: "theirs",
      rationale: "Theirs",
      operations: [{ op: "set-label", target: nodeId, label: "Their label" }],
    }, base.fingerprint);
    const keyBase64 = Buffer.alloc(32, 5).toString("base64");
    const envelope = exportProjectReviewBundle(source, {
      branch: "conflicting-review",
      projectId: "verdant-pay",
      tenantId: "tenant.integration",
      actorId: "reviewer.integration",
      sequence: 2,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      keyId: "review.integration",
      keyBase64,
    }).envelope;
    const targetBase = loadProject(target);
    const local = applyPatch(target, { id: "ours", rationale: "Ours", operations: [{ op: "set-label", target: nodeId, label: "Our label" }] }, targetBase.fingerprint);
    const preview = previewProjectReviewBundle(target, envelope, keyBase64, local.fingerprint, "verdant-pay", "tenant.integration");
    expect(preview.conflicts).toEqual([expect.objectContaining({ reason: "both-modified" })]);
    expect(() => applyProjectReviewBundle(target, envelope, keyBase64, local.fingerprint, "verdant-pay", "tenant.integration")).toThrow(/requires review/i);
    expect(loadProject(target).graph.screens[0]!.nodes[0]!.intent.label).toBe("Our label");
  });

  it("accepts remote evidence without overwriting local evidence", () => {
    const dir = projectDir();
    const opened = loadProject(dir);
    writeTrust(dir);
    const binding = createPreviewBinding(opened.graph, opened.fingerprint, "browser");
    const statement = {
      version: "1.0.0",
      statementId: "00000000-0000-4000-8000-000000000009",
      projectId: "verdant-pay",
      tenantId: "tenant.integration",
      verifierId: "verifier.integration",
      issuerKeyId: "publisher.integration",
      issuedAt: new Date(Date.now() - 1_000).toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      binding,
      result: { evidence: "built", buildStatus: "passed", artifactDigests: ["a".repeat(64)] },
    };
    const signed = { statement, signature: sign(null, remoteEvidenceSigningBytes(statement), keyPair.privateKey).toString("base64") };
    expect(verifyProjectRemoteEvidence(dir, "browser", signed, "tenant.integration")).toMatchObject({
      accepted: true,
      source: "remote",
      localEvidenceChanged: false,
    });
  });
});
