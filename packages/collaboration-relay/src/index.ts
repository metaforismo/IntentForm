import { encryptedReviewBundleSchema, sha256, type EncryptedReviewBundle } from "@intentform/ecosystem";
import { stableSerialize } from "@intentform/semantic-schema";
import { z } from "zod";

const actorIdSchema = z.string().min(1).max(160).regex(/^[a-zA-Z0-9._:-]+$/);
const stableIdSchema = z.string().min(1).max(160).regex(/^[a-z][a-z0-9.-]*$/);

export const relayPrincipalSchema = z.strictObject({
  tenantId: actorIdSchema,
  actorId: actorIdSchema,
  role: z.enum(["owner", "editor", "reviewer"]),
});
export type RelayPrincipal = z.infer<typeof relayPrincipalSchema>;

export const relayConfigurationSchema = z.strictObject({
  region: z.enum(["eu", "us", "apac", "self-hosted"]),
  retentionDays: z.number().int().min(1).max(3_650),
  maxBundlesPerProject: z.number().int().min(1).max(1_024),
  maxEnvelopeBytes: z.number().int().min(1_024).max(40_000_000),
});
export type RelayConfiguration = z.infer<typeof relayConfigurationSchema>;

interface StoredEnvelope {
  cursor: number;
  receivedAt: string;
  digest: string;
  envelope: EncryptedReviewBundle;
}

/**
 * Reference service core for a hosted or self-hosted opaque relay. Identity is
 * authenticated by the embedding transport and supplied as a principal; this
 * class enforces authorization and tenant/project separation again. It never
 * receives encryption keys or plaintext graphs.
 */
export class OpaqueCollaborationRelay {
  readonly #projects = new Map<string, StoredEnvelope[]>();
  #cursor = 0;
  readonly configuration: RelayConfiguration;

  constructor(configurationInput: unknown) {
    this.configuration = relayConfigurationSchema.parse(configurationInput);
  }

  #scope(principalInput: unknown, projectId: string): { principal: RelayPrincipal; projectId: string; key: string } {
    const principal = relayPrincipalSchema.parse(principalInput);
    const project = stableIdSchema.parse(projectId);
    return { principal, projectId: project, key: `${principal.tenantId}\u0000${project}` };
  }

  put(principalInput: unknown, envelopeInput: unknown, now = new Date()): { cursor: string; duplicate: boolean } {
    const principal = relayPrincipalSchema.parse(principalInput);
    if (principal.role === "reviewer") throw new Error("Reviewer principals cannot upload collaboration bundles.");
    const envelope = encryptedReviewBundleSchema.parse(envelopeInput);
    if (envelope.aad.tenantId !== principal.tenantId) throw new Error("Relay tenant does not match authenticated principal.");
    const { key } = this.#scope(principal, envelope.aad.projectId);
    const bytes = Buffer.byteLength(stableSerialize(envelope));
    if (bytes > this.configuration.maxEnvelopeBytes) throw new Error("Encrypted relay envelope exceeds the configured size limit.");
    const expiry = Date.parse(envelope.aad.expiresAt);
    const latest = now.getTime() + this.configuration.retentionDays * 86_400_000;
    if (expiry <= now.getTime()) throw new Error("Relay envelope is already expired.");
    if (expiry > latest) throw new Error("Relay envelope exceeds the configured retention window.");

    const digest = sha256(stableSerialize(envelope));
    const entries = this.#projects.get(key) ?? [];
    const existing = entries.find((entry) => entry.envelope.aad.bundleId === envelope.aad.bundleId);
    if (existing) {
      if (existing.digest !== digest) throw new Error("Relay bundle id already exists with different authenticated bytes.");
      return { cursor: String(existing.cursor), duplicate: true };
    }
    this.#cursor += 1;
    entries.push({ cursor: this.#cursor, receivedAt: now.toISOString(), digest, envelope });
    while (entries.length > this.configuration.maxBundlesPerProject) entries.shift();
    this.#projects.set(key, entries);
    return { cursor: String(this.#cursor), duplicate: false };
  }

  list(
    principalInput: unknown,
    projectId: string,
    afterCursor = "0",
    limit = 50,
    now = new Date(),
  ): { envelopes: EncryptedReviewBundle[]; cursor: string } {
    const { key } = this.#scope(principalInput, projectId);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new RangeError("Relay list limit must be between one and 100.");
    const after = Number(afterCursor);
    if (!Number.isSafeInteger(after) || after < 0) throw new Error("Relay cursor is invalid.");
    this.prune(now);
    const entries = (this.#projects.get(key) ?? []).filter((entry) => entry.cursor > after).slice(0, limit);
    return { envelopes: entries.map((entry) => structuredClone(entry.envelope)), cursor: String(entries.at(-1)?.cursor ?? after) };
  }

  deleteProject(principalInput: unknown, projectId: string): boolean {
    const { principal, key } = this.#scope(principalInput, projectId);
    if (principal.role !== "owner") throw new Error("Only an owner can delete relay project data.");
    return this.#projects.delete(key);
  }

  prune(now = new Date()): number {
    let removed = 0;
    for (const [key, entries] of this.#projects) {
      const retained = entries.filter((entry) => Date.parse(entry.envelope.aad.expiresAt) > now.getTime());
      removed += entries.length - retained.length;
      if (retained.length === 0) this.#projects.delete(key);
      else this.#projects.set(key, retained);
    }
    return removed;
  }
}
