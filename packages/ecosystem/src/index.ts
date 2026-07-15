import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  verify as verifySignature,
} from "node:crypto";
import {
  previewBindingSchema,
  samePreviewBinding,
  type PreviewBinding,
} from "@intentform/preview-daemon";
import {
  componentDefinitionSchema,
  ecosystemDependencySchema,
  emptyTokenModeValues,
  parseGraph,
  semanticDiff,
  semanticInterfaceGraphSchema,
  stableSerialize,
  type EcosystemDependency,
  type SemanticInterfaceGraph,
} from "@intentform/semantic-schema";
import { z } from "zod";

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const exactVersionSchema = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
const packageIdSchema = z.string().min(3).max(160).regex(/^@[a-z0-9][a-z0-9.-]*\/[a-z0-9][a-z0-9.-]*$/);
const stableIdSchema = z.string().min(1).max(160).regex(/^[a-z][a-z0-9.-]*$/);
const actorIdSchema = z.string().min(1).max(160).regex(/^[a-zA-Z0-9._:-]+$/);
const base64Schema = z.string().min(4).max(40_000_000).regex(/^[A-Za-z0-9+/]+={0,2}$/);
const registrySchema = z.string().url().max(2_048).superRefine((value, context) => {
  const url = new URL(value);
  const loopback = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !loopback) context.addIssue({ code: "custom", message: "Registry endpoints require HTTPS or loopback HTTP" });
  if (url.username || url.password) context.addIssue({ code: "custom", message: "Registry URLs cannot contain credentials" });
  if (url.hash) context.addIssue({ code: "custom", message: "Registry URLs cannot contain fragments" });
});

export const pluginPermissionSchema = z.enum([
  "project.read",
  "project.write",
  "history.read",
  "compile.run",
  "preview.run",
  "review.export",
]);
export type PluginPermission = z.infer<typeof pluginPermissionSchema>;

const pluginParameterSchema = z.union([z.string().max(240), z.number().finite(), z.boolean()]);
export const pluginManifestSchema = z.strictObject({
  apiVersion: z.literal("1.0.0"),
  id: packageIdSchema,
  version: exactVersionSchema,
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(1_000),
  permissions: z.array(pluginPermissionSchema).max(16),
  commands: z.array(z.strictObject({
    id: stableIdSchema,
    title: z.string().min(1).max(120),
    action: z.enum(["verify-project", "compile-target", "preview-patch", "apply-patch", "export-review"]),
    parameters: z.record(z.string().min(1).max(64), pluginParameterSchema)
      .refine((value) => Object.keys(value).length <= 16, "Plugin command parameters are bounded"),
  })).max(64),
});
export type PluginManifest = z.infer<typeof pluginManifestSchema>;

const componentArtifactSchema = z.strictObject({
  formatVersion: z.literal("1.0.0"),
  packageId: packageIdSchema,
  packageVersion: exactVersionSchema,
  kind: z.literal("component-library"),
  components: z.array(componentDefinitionSchema).min(1).max(128),
});

const packagedTokenSchema = z.discriminatedUnion("type", [
  z.strictObject({ modeId: stableIdSchema, modeName: z.string().min(1).max(120), key: z.string().regex(/^color\.[a-z0-9.-]+$/), type: z.literal("color"), value: z.string().regex(/^#[0-9a-fA-F]{6}$/) }),
  z.strictObject({ modeId: stableIdSchema, modeName: z.string().min(1).max(120), key: z.string().regex(/^space\.[a-z0-9.-]+$/), type: z.literal("spacing"), value: z.number().finite().nonnegative().max(4_096) }),
  z.strictObject({ modeId: stableIdSchema, modeName: z.string().min(1).max(120), key: z.string().regex(/^radius\.[a-z0-9.-]+$/), type: z.literal("radius"), value: z.number().finite().nonnegative().max(4_096) }),
]);

const tokenArtifactSchema = z.strictObject({
  formatVersion: z.literal("1.0.0"),
  packageId: packageIdSchema,
  packageVersion: exactVersionSchema,
  kind: z.literal("token-library"),
  tokens: z.array(packagedTokenSchema).min(1).max(512),
}).superRefine((artifact, context) => {
  const keys = new Set<string>();
  artifact.tokens.forEach((token, index) => {
    const key = `${token.modeId}:${token.key}`;
    if (keys.has(key)) context.addIssue({ code: "custom", message: `Duplicate packaged token ${key}`, path: ["tokens", index] });
    keys.add(key);
  });
});

const pluginArtifactSchema = z.strictObject({
  formatVersion: z.literal("1.0.0"),
  packageId: packageIdSchema,
  packageVersion: exactVersionSchema,
  kind: z.literal("plugin"),
  plugin: pluginManifestSchema,
});

export const packageArtifactSchema = z.discriminatedUnion("kind", [
  componentArtifactSchema,
  tokenArtifactSchema,
  pluginArtifactSchema,
]);
export type PackageArtifact = z.infer<typeof packageArtifactSchema>;

const packageReferenceSchema = z.strictObject({
  id: packageIdSchema,
  version: exactVersionSchema,
  manifestDigest: digestSchema,
});

export const packageManifestSchema = z.strictObject({
  abiVersion: z.literal("1.0.0"),
  id: packageIdSchema,
  version: exactVersionSchema,
  kind: z.enum(["component-library", "token-library", "plugin"]),
  artifact: z.strictObject({ digest: digestSchema, byteLength: z.number().int().positive().max(24_000_000), mediaType: z.literal("application/vnd.intentform.package+json") }),
  exports: z.array(z.string().min(1).max(200).regex(/^[a-z][a-z0-9.:/-]*$/)).max(512),
  dependencies: z.array(packageReferenceSchema).max(64),
  publisherKeyId: actorIdSchema,
  visibility: z.enum(["public", "private", "local"]),
  registry: registrySchema.nullable(),
  publishedAt: z.string().datetime({ offset: true }),
  sourceRevision: z.string().min(1).max(200),
  license: z.string().min(1).max(160),
}).superRefine((manifest, context) => {
  if (manifest.visibility === "local" && manifest.registry !== null) context.addIssue({ code: "custom", message: "Local packages cannot name a registry", path: ["registry"] });
  if (manifest.visibility !== "local" && manifest.registry === null) context.addIssue({ code: "custom", message: "Public and private packages require a registry", path: ["registry"] });
  const dependencies = new Set<string>();
  manifest.dependencies.forEach((dependency, index) => {
    if (dependency.id === manifest.id) context.addIssue({ code: "custom", message: "A package cannot depend on itself", path: ["dependencies", index] });
    if (dependencies.has(dependency.id)) context.addIssue({ code: "custom", message: `Duplicate package dependency ${dependency.id}`, path: ["dependencies", index] });
    dependencies.add(dependency.id);
  });
});
export type PackageManifest = z.infer<typeof packageManifestSchema>;

export const signedPackageManifestSchema = z.strictObject({
  manifest: packageManifestSchema,
  signature: base64Schema,
});
export type SignedPackageManifest = z.infer<typeof signedPackageManifestSchema>;

export const trustStoreSchema = z.strictObject({
  version: z.literal("1.0.0"),
  keys: z.array(z.strictObject({
    keyId: actorIdSchema,
    algorithm: z.literal("Ed25519"),
    publicKeyPem: z.string().min(80).max(8_192).regex(/^-----BEGIN PUBLIC KEY-----[\s\S]+-----END PUBLIC KEY-----\s*$/),
    scopes: z.array(z.enum(["packages", "remote-evidence"])).min(1).max(2),
    revoked: z.boolean(),
  })).max(256),
}).superRefine((store, context) => {
  const ids = new Set<string>();
  store.keys.forEach((entry, index) => {
    if (ids.has(entry.keyId)) context.addIssue({ code: "custom", message: `Duplicate trust key ${entry.keyId}`, path: ["keys", index] });
    ids.add(entry.keyId);
  });
});
export type TrustStore = z.infer<typeof trustStoreSchema>;

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(stableSerialize(value), "utf8");
}

export function packageSigningBytes(manifestInput: unknown): Buffer {
  return canonicalBytes(packageManifestSchema.parse(manifestInput));
}

function decodeBase64(value: string, label: string, expectedBytes?: number): Buffer {
  if (!base64Schema.safeParse(value).success) throw new Error(`${label} is not canonical base64.`);
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) throw new Error(`${label} is not canonical base64.`);
  if (expectedBytes !== undefined && decoded.byteLength !== expectedBytes) throw new Error(`${label} must contain ${expectedBytes} bytes.`);
  return decoded;
}

function trustedKey(storeInput: unknown, keyId: string, scope: "packages" | "remote-evidence"): string {
  const store = trustStoreSchema.parse(storeInput);
  const entry = store.keys.find((candidate) => candidate.keyId === keyId);
  if (!entry) throw new Error(`Unknown trust key: ${keyId}.`);
  if (entry.revoked) throw new Error(`Trust key ${keyId} is revoked.`);
  if (!entry.scopes.includes(scope)) throw new Error(`Trust key ${keyId} is not authorized for ${scope}.`);
  return entry.publicKeyPem;
}

function artifactExports(artifact: PackageArtifact): string[] {
  if (artifact.kind === "component-library") return artifact.components.map((entry) => `component:${entry.id}`).sort();
  if (artifact.kind === "token-library") return artifact.tokens.map((entry) => `token:${entry.modeId}:${entry.key}`).sort();
  return artifact.plugin.commands.map((entry) => `command:${entry.id}`).sort();
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

export interface VerifiedPackage {
  manifest: PackageManifest;
  manifestDigest: string;
  artifact: PackageArtifact;
  artifactCanonical: string;
  dependency: EcosystemDependency;
}

export function verifyPackage(
  signedInput: unknown,
  artifactInput: unknown,
  trustInput: unknown,
): VerifiedPackage {
  const signed = signedPackageManifestSchema.parse(signedInput);
  const artifact = packageArtifactSchema.parse(artifactInput);
  if (artifact.packageId !== signed.manifest.id || artifact.packageVersion !== signed.manifest.version || artifact.kind !== signed.manifest.kind) {
    throw new Error("Package artifact identity does not match its signed manifest.");
  }
  if (artifact.kind === "plugin" && (artifact.plugin.id !== artifact.packageId || artifact.plugin.version !== artifact.packageVersion)) {
    throw new Error("Plugin identity does not match its package artifact.");
  }
  const artifactCanonical = stableSerialize(artifact);
  if (Buffer.byteLength(artifactCanonical) !== signed.manifest.artifact.byteLength) throw new Error("Package artifact byte length does not match its signed manifest.");
  if (sha256(artifactCanonical) !== signed.manifest.artifact.digest) throw new Error("Package artifact digest does not match its signed manifest.");
  const exports = artifactExports(artifact);
  if (!sameStrings(exports, signed.manifest.exports)) throw new Error("Package manifest exports do not match the typed artifact.");
  const publicKey = trustedKey(trustInput, signed.manifest.publisherKeyId, "packages");
  const signature = decodeBase64(signed.signature, "Package signature");
  if (!verifySignature(null, packageSigningBytes(signed.manifest), publicKey, signature)) throw new Error("Package signature verification failed.");
  const manifestDigest = sha256(packageSigningBytes(signed.manifest));
  return {
    manifest: signed.manifest,
    manifestDigest,
    artifact,
    artifactCanonical,
    dependency: ecosystemDependencySchema.parse({
      id: signed.manifest.id,
      version: signed.manifest.version,
      kind: signed.manifest.kind,
      manifestDigest,
      artifactDigest: signed.manifest.artifact.digest,
      publisherKeyId: signed.manifest.publisherKeyId,
      visibility: signed.manifest.visibility,
      registry: signed.manifest.registry,
      publishedAt: signed.manifest.publishedAt,
      sourceRevision: signed.manifest.sourceRevision,
      license: signed.manifest.license,
      exports,
    }),
  };
}

function removeOwnedTokens(graph: SemanticInterfaceGraph, dependency: EcosystemDependency | undefined): void {
  for (const entry of dependency?.exports ?? []) {
    const match = /^token:([^:]+):(.+)$/.exec(entry);
    if (!match) continue;
    const [, modeId, tokenKey] = match;
    const values = graph.tokens.modes[modeId!]?.values;
    if (!values) continue;
    if (tokenKey!.startsWith("color.")) delete values.colors[tokenKey!];
    if (tokenKey!.startsWith("space.")) delete values.spacing[tokenKey!];
    if (tokenKey!.startsWith("radius.")) delete values.radii[tokenKey!];
  }
}

function applyVerifiedPackage(graph: SemanticInterfaceGraph, verified: VerifiedPackage): SemanticInterfaceGraph {
  const draft = structuredClone(graph);
  const previous = draft.dependencies.find((entry) => entry.id === verified.manifest.id);
  if (previous && previous.kind !== verified.manifest.kind) throw new Error("A package update cannot change package kind.");
  for (const requirement of verified.manifest.dependencies) {
    const locked = draft.dependencies.find((entry) => entry.id === requirement.id);
    if (!locked || locked.version !== requirement.version || locked.manifestDigest !== requirement.manifestDigest) {
      throw new Error(`Package dependency ${requirement.id}@${requirement.version} is not exactly locked.`);
    }
  }

  if (verified.artifact.kind === "component-library") {
    const previouslyOwned = new Set((previous?.exports ?? []).filter((entry) => entry.startsWith("component:")).map((entry) => entry.slice("component:".length)));
    draft.components = draft.components.filter((entry) => !previouslyOwned.has(entry.id));
    for (const component of verified.artifact.components) {
      if (draft.components.some((entry) => entry.id === component.id)) throw new Error(`Package component collides with existing component ${component.id}.`);
      draft.components.push(component);
    }
  } else if (verified.artifact.kind === "token-library") {
    removeOwnedTokens(draft, previous);
    for (const token of verified.artifact.tokens) {
      const mode = draft.tokens.modes[token.modeId] ??= { name: token.modeName, values: emptyTokenModeValues() };
      const allValues = { ...mode.values.colors, ...mode.values.spacing, ...mode.values.radii };
      if (Object.hasOwn(allValues, token.key)) throw new Error(`Package token collides with existing token ${token.modeId}:${token.key}.`);
      if (token.type === "color") mode.values.colors[token.key] = token.value;
      if (token.type === "spacing") mode.values.spacing[token.key] = token.value;
      if (token.type === "radius") mode.values.radii[token.key] = token.value;
    }
  }
  draft.dependencies = draft.dependencies.filter((entry) => entry.id !== verified.manifest.id);
  draft.dependencies.push(verified.dependency);
  draft.dependencies.sort((left, right) => left.id.localeCompare(right.id));
  return parseGraph(draft);
}

export function previewPackageUpdate(
  graphInput: SemanticInterfaceGraph,
  signedInput: unknown,
  artifactInput: unknown,
  trustInput: unknown,
) {
  const graph = parseGraph(graphInput);
  const verified = verifyPackage(signedInput, artifactInput, trustInput);
  const candidate = applyVerifiedPackage(graph, verified);
  return {
    dependency: verified.dependency,
    artifactCanonical: verified.artifactCanonical,
    graph: candidate,
    changes: semanticDiff(graph, candidate),
  };
}

export const pluginGrantSchema = z.strictObject({
  pluginId: packageIdSchema,
  manifestDigest: digestSchema,
  permissions: z.array(pluginPermissionSchema).max(16),
  grantedAt: z.string().datetime({ offset: true }),
  grantedBy: actorIdSchema,
});
export type PluginGrant = z.infer<typeof pluginGrantSchema>;

export function authorizePluginPermission(
  pluginInput: unknown,
  manifestDigest: string,
  grantInput: unknown,
  permission: PluginPermission,
): void {
  const plugin = pluginManifestSchema.parse(pluginInput);
  const grant = pluginGrantSchema.parse(grantInput);
  if (grant.pluginId !== plugin.id || grant.manifestDigest !== manifestDigest) throw new Error("Plugin grant is stale or belongs to another plugin.");
  if (!plugin.permissions.includes(permission)) throw new Error(`Plugin did not declare permission ${permission}.`);
  if (!grant.permissions.includes(permission)) throw new Error(`Plugin permission ${permission} is not granted.`);
}

export const collaborationPolicySchema = z.strictObject({
  version: z.literal("1.0.0"),
  projectId: stableIdSchema,
  tenantId: actorIdSchema,
  roles: z.record(actorIdSchema, z.enum(["owner", "editor", "reviewer"]))
    .refine((value) => Object.keys(value).length <= 256, "Collaboration roles are bounded"),
  minimumReviewers: z.number().int().min(0).max(16),
  retentionDays: z.number().int().min(1).max(3_650),
  region: z.enum(["eu", "us", "apac", "self-hosted"]),
  keyOwnership: z.literal("client-managed"),
});

export const reviewBundlePayloadSchema = z.strictObject({
  version: z.literal("1.0.0"),
  bundleId: z.string().uuid(),
  projectId: stableIdSchema,
  tenantId: actorIdSchema,
  actorId: actorIdSchema,
  sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  createdAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
  baseGraphDigest: digestSchema,
  proposedGraphDigest: digestSchema,
  baseGraph: semanticInterfaceGraphSchema,
  proposedGraph: semanticInterfaceGraphSchema,
}).superRefine((payload, context) => {
  if (sha256(stableSerialize(payload.baseGraph)) !== payload.baseGraphDigest) context.addIssue({ code: "custom", message: "Base graph digest does not match", path: ["baseGraphDigest"] });
  if (sha256(stableSerialize(payload.proposedGraph)) !== payload.proposedGraphDigest) context.addIssue({ code: "custom", message: "Proposed graph digest does not match", path: ["proposedGraphDigest"] });
  if (Date.parse(payload.expiresAt) <= Date.parse(payload.createdAt)) context.addIssue({ code: "custom", message: "Review bundle expiry must be after creation", path: ["expiresAt"] });
});
export type ReviewBundlePayload = z.infer<typeof reviewBundlePayloadSchema>;

const reviewAadSchema = z.strictObject({
  version: z.literal("1.0.0"),
  bundleId: z.string().uuid(),
  projectId: stableIdSchema,
  tenantId: actorIdSchema,
  baseGraphDigest: digestSchema,
  expiresAt: z.string().datetime({ offset: true }),
  keyId: actorIdSchema,
});

export const encryptedReviewBundleSchema = z.strictObject({
  version: z.literal("1.0.0"),
  algorithm: z.literal("AES-256-GCM"),
  aad: reviewAadSchema,
  nonce: base64Schema,
  ciphertext: base64Schema,
  authTag: base64Schema,
});
export type EncryptedReviewBundle = z.infer<typeof encryptedReviewBundleSchema>;

function reviewAad(payload: ReviewBundlePayload, keyId: string) {
  return reviewAadSchema.parse({
    version: "1.0.0",
    bundleId: payload.bundleId,
    projectId: payload.projectId,
    tenantId: payload.tenantId,
    baseGraphDigest: payload.baseGraphDigest,
    expiresAt: payload.expiresAt,
    keyId,
  });
}

export function encryptReviewBundle(
  payloadInput: unknown,
  key: Uint8Array,
  keyId: string,
  nonceInput: Uint8Array = randomBytes(12),
): EncryptedReviewBundle {
  const payload = reviewBundlePayloadSchema.parse(payloadInput);
  if (key.byteLength !== 32) throw new Error("Review bundle key must contain 32 bytes.");
  if (nonceInput.byteLength !== 12) throw new Error("Review bundle nonce must contain 12 bytes.");
  const plaintext = canonicalBytes(payload);
  if (plaintext.byteLength > 24_000_000) throw new Error("Review bundle exceeds the size limit.");
  const aad = reviewAad(payload, keyId);
  const cipher = createCipheriv("aes-256-gcm", key, nonceInput, { authTagLength: 16 });
  cipher.setAAD(canonicalBytes(aad));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return encryptedReviewBundleSchema.parse({
    version: "1.0.0",
    algorithm: "AES-256-GCM",
    aad,
    nonce: Buffer.from(nonceInput).toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  });
}

export function decryptReviewBundle(
  envelopeInput: unknown,
  key: Uint8Array,
  now = new Date(),
): ReviewBundlePayload {
  const envelope = encryptedReviewBundleSchema.parse(envelopeInput);
  if (key.byteLength !== 32) throw new Error("Review bundle key must contain 32 bytes.");
  const nonce = decodeBase64(envelope.nonce, "Review bundle nonce", 12);
  const authTag = decodeBase64(envelope.authTag, "Review bundle authentication tag", 16);
  const ciphertext = decodeBase64(envelope.ciphertext, "Review bundle ciphertext");
  if (ciphertext.byteLength > 24_000_000) throw new Error("Review bundle exceeds the size limit.");
  let payload: ReviewBundlePayload;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
    decipher.setAAD(canonicalBytes(envelope.aad));
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    payload = reviewBundlePayloadSchema.parse(JSON.parse(plaintext.toString("utf8")));
  } catch {
    throw new Error("Review bundle is invalid, expired, or has been tampered with.");
  }
  const expectedAad = reviewAad(payload, envelope.aad.keyId);
  if (stableSerialize(expectedAad) !== stableSerialize(envelope.aad)) throw new Error("Review bundle authenticated metadata does not match its payload.");
  if (Date.parse(payload.expiresAt) <= now.getTime()) throw new Error("Review bundle is invalid, expired, or has been tampered with.");
  return payload;
}

export function assertFreshReviewSequence(payload: ReviewBundlePayload, highWaterMarks: Readonly<Record<string, number>>): void {
  const prior = highWaterMarks[payload.actorId] ?? 0;
  if (payload.sequence <= prior) throw new Error(`Review bundle sequence ${payload.sequence} is a replay for ${payload.actorId}.`);
}

export const syncConfigurationSchema = z.strictObject({
  mode: z.enum(["disabled", "hosted", "self-hosted"]),
  endpoint: registrySchema.nullable(),
  tenantId: actorIdSchema,
  region: z.enum(["eu", "us", "apac", "self-hosted"]),
  retentionDays: z.number().int().min(1).max(3_650),
  keyOwnership: z.literal("client-managed"),
}).superRefine((configuration, context) => {
  if (configuration.mode === "disabled" && configuration.endpoint !== null) context.addIssue({ code: "custom", message: "Disabled sync cannot retain an endpoint", path: ["endpoint"] });
  if (configuration.mode !== "disabled" && configuration.endpoint === null) context.addIssue({ code: "custom", message: "Enabled sync requires an endpoint", path: ["endpoint"] });
  if (configuration.mode === "self-hosted" && configuration.region !== "self-hosted") context.addIssue({ code: "custom", message: "Self-hosted sync requires the self-hosted region", path: ["region"] });
});
export type SyncConfiguration = z.infer<typeof syncConfigurationSchema>;

export interface EncryptedSyncAdapter {
  push(envelope: EncryptedReviewBundle, signal?: AbortSignal): Promise<{ cursor: string }>;
}

export class OptionalSyncCoordinator {
  readonly #queue: EncryptedReviewBundle[] = [];
  readonly configuration: SyncConfiguration;

  constructor(configurationInput: unknown, readonly adapter: EncryptedSyncAdapter | null, readonly maxQueued = 64) {
    this.configuration = syncConfigurationSchema.parse(configurationInput);
    if (!Number.isSafeInteger(maxQueued) || maxQueued < 1 || maxQueued > 1_024) throw new RangeError("Sync queue bound is invalid.");
    if (this.configuration.mode !== "disabled" && !adapter) throw new Error("Enabled sync requires an adapter.");
  }

  get status() {
    return { mode: this.configuration.mode, queued: this.#queue.length, localEditingAvailable: true as const };
  }

  async submit(envelopeInput: unknown, signal?: AbortSignal): Promise<{ state: "disabled" | "pushed" | "queued"; cursor?: string }> {
    const envelope = encryptedReviewBundleSchema.parse(envelopeInput);
    if (envelope.aad.tenantId !== this.configuration.tenantId) throw new Error("Sync envelope tenant does not match the configured tenant.");
    if (this.configuration.mode === "disabled") return { state: "disabled" };
    try {
      const result = await this.adapter!.push(envelope, signal);
      return { state: "pushed", cursor: result.cursor };
    } catch {
      if (this.#queue.length >= this.maxQueued) this.#queue.shift();
      this.#queue.push(envelope);
      return { state: "queued" };
    }
  }

  async flush(signal?: AbortSignal): Promise<{ pushed: number; remaining: number }> {
    if (this.configuration.mode === "disabled") return { pushed: 0, remaining: this.#queue.length };
    let pushed = 0;
    while (this.#queue.length > 0) {
      try {
        await this.adapter!.push(this.#queue[0]!, signal);
        this.#queue.shift();
        pushed += 1;
      } catch {
        break;
      }
    }
    return { pushed, remaining: this.#queue.length };
  }
}

export const remoteEvidenceStatementSchema = z.strictObject({
  version: z.literal("1.0.0"),
  statementId: z.string().uuid(),
  projectId: stableIdSchema,
  tenantId: actorIdSchema,
  verifierId: actorIdSchema,
  issuerKeyId: actorIdSchema,
  issuedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
  binding: previewBindingSchema,
  result: z.strictObject({
    evidence: z.enum(["built", "render-verified"]),
    buildStatus: z.literal("passed"),
    artifactDigests: z.array(digestSchema).max(24),
  }),
});
export type RemoteEvidenceStatement = z.infer<typeof remoteEvidenceStatementSchema>;

export const signedRemoteEvidenceSchema = z.strictObject({
  statement: remoteEvidenceStatementSchema,
  signature: base64Schema,
});

export function remoteEvidenceSigningBytes(statementInput: unknown): Buffer {
  return canonicalBytes(remoteEvidenceStatementSchema.parse(statementInput));
}

export function verifyRemoteEvidence(
  signedInput: unknown,
  trustInput: unknown,
  expectedBinding: PreviewBinding,
  expectedTenantId: string,
  now = new Date(),
): RemoteEvidenceStatement {
  const signed = signedRemoteEvidenceSchema.parse(signedInput);
  const publicKey = trustedKey(trustInput, signed.statement.issuerKeyId, "remote-evidence");
  if (!verifySignature(null, remoteEvidenceSigningBytes(signed.statement), publicKey, decodeBase64(signed.signature, "Remote evidence signature"))) {
    throw new Error("Remote evidence signature verification failed.");
  }
  if (signed.statement.tenantId !== expectedTenantId) throw new Error("Remote evidence tenant does not match the active tenant.");
  if (Date.parse(signed.statement.expiresAt) <= now.getTime() || Date.parse(signed.statement.issuedAt) > now.getTime()) throw new Error("Remote evidence is outside its validity window.");
  if (!samePreviewBinding(signed.statement.binding, previewBindingSchema.parse(expectedBinding))) throw new Error("Remote evidence is stale for the active graph, compiler, target, or device profile.");
  return signed.statement;
}
