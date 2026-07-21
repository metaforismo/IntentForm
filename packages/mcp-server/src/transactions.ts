import { randomUUID } from "node:crypto";
import { graphPatchSchema, type GraphPatch } from "@intentform/semantic-schema";
import { previewPatch } from "./tools.ts";
import { loadProject } from "./store.ts";
import {
  commitTransactionReview,
  projectGraphDigest,
  recordTransactionReview,
  rejectTransactionReview,
} from "./transaction-reviews.ts";

const DEFAULT_TRANSACTION_TTL_MS = 5 * 60_000;
const MAX_TRANSACTIONS = 32;
const MAX_OWNER_TRANSACTIONS = 8;

interface TransactionRecord {
  id: string;
  ownerId: string;
  projectDir: string;
  baseFingerprint: string;
  rationale: string;
  createdAt: string;
  expiresAt: string;
  patch: GraphPatch | null;
  previewFingerprint: string | null;
  transport: "stdio" | "http";
  commentId: string | null;
}

function publicRecord(record: TransactionRecord) {
  return {
    transactionId: record.id,
    baseFingerprint: record.baseFingerprint,
    rationale: record.rationale,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    status: record.patch ? "previewed" as const : "open" as const,
    previewFingerprint: record.previewFingerprint,
    commentId: record.commentId,
  };
}

export class SemanticTransactionService {
  readonly #transactions = new Map<string, TransactionRecord>();
  readonly ttlMs: number;

  constructor(ttlMs = DEFAULT_TRANSACTION_TTL_MS) {
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 10_000 || ttlMs > 30 * 60_000) {
      throw new RangeError("Semantic transaction TTL must be between ten seconds and thirty minutes.");
    }
    this.ttlMs = ttlMs;
  }

  begin(projectDir: string, ownerId: string, expectedFingerprint: string, rationale: string, transport: "stdio" | "http" = "stdio", commentId?: string) {
    this.#prune();
    const { graph, fingerprint } = loadProject(projectDir);
    if (fingerprint !== expectedFingerprint) {
      throw new Error(`Project fingerprint conflict: expected ${expectedFingerprint}, current ${fingerprint}.`);
    }
    if ([...this.#transactions.values()].filter((entry) => entry.ownerId === ownerId).length >= MAX_OWNER_TRANSACTIONS) {
      throw new Error("This MCP session already has the maximum number of open transactions.");
    }
    if (this.#transactions.size >= MAX_TRANSACTIONS) {
      throw new Error("The local MCP transaction capacity is full.");
    }
    const linkedComment = commentId?.trim() || null;
    if (linkedComment) {
      const thread = graph.reviewThreads.find((candidate) => candidate.id === linkedComment);
      if (!thread) throw new Error(`Unknown review comment: ${linkedComment}.`);
      if (thread.resolvedAt) throw new Error(`Review comment is resolved: ${linkedComment}.`);
    }
    const createdAt = new Date();
    const record: TransactionRecord = {
      id: randomUUID(),
      ownerId,
      projectDir,
      baseFingerprint: fingerprint,
      rationale: rationale.trim().slice(0, 160) || "agent semantic transaction",
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + this.ttlMs).toISOString(),
      patch: null,
      previewFingerprint: null,
      transport,
      commentId: linkedComment,
    };
    this.#transactions.set(record.id, record);
    return publicRecord(record);
  }

  preview(projectDir: string, ownerId: string, transactionId: string, patchInput: unknown) {
    const record = this.#owned(projectDir, ownerId, transactionId);
    const patch = graphPatchSchema.parse(patchInput);
    const preview = previewPatch(projectDir, patch, record.baseFingerprint);
    record.patch = patch;
    record.previewFingerprint = preview.previewFingerprint;
    recordTransactionReview(projectDir, {
      transactionId: record.id,
      transport: record.transport,
      rationale: record.rationale,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
      baseFingerprint: record.baseFingerprint,
      baseDigest: projectGraphDigest(projectDir),
      previewFingerprint: preview.previewFingerprint,
      patch,
      changes: preview.changes,
      verification: preview.verification,
      commentId: record.commentId,
      historyOperationId: null,
    });
    return { ...publicRecord(record), preview };
  }

  commit(projectDir: string, ownerId: string, transactionId: string) {
    const record = this.#owned(projectDir, ownerId, transactionId);
    if (!record.patch || !record.previewFingerprint) {
      throw new Error("Preview this semantic transaction before committing it.");
    }
    try {
      const { committed } = commitTransactionReview(projectDir, record.id, record.previewFingerprint);
      if (committed.fingerprint !== record.previewFingerprint) {
        throw new Error("Committed output did not match the reviewed transaction preview.");
      }
      return {
        transactionId: record.id,
        status: "committed" as const,
        baseFingerprint: record.baseFingerprint,
        previewFingerprint: record.previewFingerprint,
        committed,
      };
    } finally {
      this.#transactions.delete(record.id);
    }
  }

  rollback(projectDir: string, ownerId: string, transactionId: string) {
    const record = this.#owned(projectDir, ownerId, transactionId);
    rejectTransactionReview(projectDir, record.id, record.previewFingerprint ?? undefined, true);
    this.#transactions.delete(record.id);
    return {
      transactionId: record.id,
      status: "rolled-back" as const,
      baseFingerprint: record.baseFingerprint,
      projectChanged: false,
    };
  }

  clearOwner(ownerId: string): void {
    for (const [id, record] of this.#transactions) {
      if (record.ownerId === ownerId) {
        try {
          rejectTransactionReview(record.projectDir, record.id, record.previewFingerprint ?? undefined, true);
        } catch {
          // A human may already have committed or rejected the persisted review.
        }
        this.#transactions.delete(id);
      }
    }
  }

  #owned(projectDir: string, ownerId: string, transactionId: string): TransactionRecord {
    this.#prune();
    const record = this.#transactions.get(transactionId);
    if (!record || record.ownerId !== ownerId || record.projectDir !== projectDir) {
      throw new Error("Unknown or inaccessible semantic transaction.");
    }
    return record;
  }

  #prune(): void {
    const now = Date.now();
    for (const [id, record] of this.#transactions) {
      if (Date.parse(record.expiresAt) <= now) this.#transactions.delete(id);
    }
  }
}
