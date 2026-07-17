import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  graphPatchSchema,
  type GraphPatch,
  type SemanticChange,
} from "@intentform/semantic-schema";
import type { VerificationFinding } from "@intentform/verifier";
import { applyPatch, type MutationResult } from "./tools.ts";

const REVIEW_FILE = "transaction-reviews.json";
const REVIEW_LOCK = ".transaction-reviews.lock";
const STALE_LOCK_MS = 5_000;
const MAX_REVIEW_ENTRIES = 64;

export type TransactionReviewStatus = "previewed" | "committed" | "rejected" | "expired" | "stale";

interface StoredTransactionReview {
  transactionId: string;
  transport: "stdio" | "http";
  rationale: string;
  createdAt: string;
  expiresAt: string;
  resolvedAt: string | null;
  baseFingerprint: string;
  previewFingerprint: string;
  status: Exclude<TransactionReviewStatus, "expired">;
  patch: GraphPatch;
  changes: SemanticChange[];
  verification: {
    passed: boolean;
    buildStatus: "passed" | "failed" | "not-run";
    findings: VerificationFinding[];
  };
  commentId?: string | null;
  historyOperationId?: string | null;
}

interface ReviewFile {
  version: 1;
  entries: StoredTransactionReview[];
}

export interface PublicTransactionReview extends Omit<StoredTransactionReview, "patch" | "status"> {
  status: TransactionReviewStatus;
}

export class TransactionReviewBusyError extends Error {
  constructor() {
    super("Agent transaction reviews are busy. Retry the action.");
    this.name = "TransactionReviewBusyError";
  }
}

function reviewPath(projectDir: string): string {
  return join(projectDir, REVIEW_FILE);
}

function validReview(input: unknown): input is StoredTransactionReview {
  if (!input || typeof input !== "object") return false;
  const review = input as Partial<StoredTransactionReview>;
  return typeof review.transactionId === "string"
    && (review.transport === "stdio" || review.transport === "http")
    && typeof review.rationale === "string"
    && typeof review.createdAt === "string"
    && typeof review.expiresAt === "string"
    && (review.resolvedAt === null || typeof review.resolvedAt === "string")
    && typeof review.baseFingerprint === "string"
    && typeof review.previewFingerprint === "string"
    && (review.commentId === undefined || review.commentId === null || typeof review.commentId === "string")
    && (review.historyOperationId === undefined || review.historyOperationId === null || typeof review.historyOperationId === "string")
    && ["previewed", "committed", "rejected", "stale"].includes(review.status ?? "")
    && graphPatchSchema.safeParse(review.patch).success
    && Array.isArray(review.changes)
    && review.changes.every((change) => Boolean(change) && typeof change === "object" && typeof (change as { path?: unknown }).path === "string")
    && typeof review.verification?.passed === "boolean"
    && ["passed", "failed", "not-run"].includes(review.verification?.buildStatus ?? "")
    && Array.isArray(review.verification?.findings);
}

function readStored(projectDir: string): StoredTransactionReview[] {
  try {
    const parsed = JSON.parse(readFileSync(reviewPath(projectDir), "utf8")) as Partial<ReviewFile>;
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) return [];
    return parsed.entries.filter(validReview).slice(0, MAX_REVIEW_ENTRIES);
  } catch {
    return [];
  }
}

function writeStored(projectDir: string, entries: StoredTransactionReview[]): void {
  mkdirSync(projectDir, { recursive: true });
  const temporaryPath = join(projectDir, `.transaction-reviews-${process.pid}-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporaryPath, `${JSON.stringify({ version: 1, entries: entries.slice(0, MAX_REVIEW_ENTRIES) }, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    renameSync(temporaryPath, reviewPath(projectDir));
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

function acquireLock(projectDir: string): number {
  mkdirSync(projectDir, { recursive: true });
  const path = join(projectDir, REVIEW_LOCK);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return openSync(path, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        if (Date.now() - statSync(path).mtimeMs <= STALE_LOCK_MS) throw new TransactionReviewBusyError();
        rmSync(path, { force: true });
      } catch (lockError) {
        if (lockError instanceof TransactionReviewBusyError) throw lockError;
        throw new TransactionReviewBusyError();
      }
    }
  }
  throw new TransactionReviewBusyError();
}

function withLock<T>(projectDir: string, operation: (entries: StoredTransactionReview[]) => T): T {
  const descriptor = acquireLock(projectDir);
  try {
    return operation(readStored(projectDir));
  } finally {
    closeSync(descriptor);
    rmSync(join(projectDir, REVIEW_LOCK), { force: true });
  }
}

function publicReview(review: StoredTransactionReview): PublicTransactionReview {
  const { patch: _patch, status, ...rest } = review;
  return {
    ...rest,
    commentId: review.commentId ?? null,
    historyOperationId: review.historyOperationId ?? null,
    status: status === "previewed" && Date.parse(review.expiresAt) <= Date.now() ? "expired" : status,
  };
}

export function readTransactionReviews(projectDir: string): { reviews: PublicTransactionReview[] } {
  return { reviews: readStored(projectDir).slice(0, 16).map(publicReview) };
}

export function recordTransactionReview(projectDir: string, review: Omit<StoredTransactionReview, "resolvedAt" | "status">): PublicTransactionReview {
  return withLock(projectDir, (entries) => {
    const stored: StoredTransactionReview = { ...review, commentId: review.commentId ?? null, historyOperationId: null, resolvedAt: null, status: "previewed" };
    writeStored(projectDir, [stored, ...entries.filter((entry) => entry.transactionId !== stored.transactionId)]);
    return publicReview(stored);
  });
}

export function commitTransactionReview(
  projectDir: string,
  transactionId: string,
  expectedPreviewFingerprint?: string,
): { review: PublicTransactionReview; committed: MutationResult } {
  return withLock(projectDir, (entries) => {
    const review = entries.find((entry) => entry.transactionId === transactionId);
    if (!review) throw new Error("Unknown agent transaction review.");
    if (review.status !== "previewed") throw new Error(`Agent transaction review is already ${review.status}.`);
    if (Date.parse(review.expiresAt) <= Date.now()) throw new Error("Agent transaction review has expired.");
    if (expectedPreviewFingerprint && review.previewFingerprint !== expectedPreviewFingerprint) {
      throw new Error("Agent transaction review fingerprint conflict.");
    }
    try {
      const committed = applyPatch(projectDir, review.patch, review.baseFingerprint);
      if (committed.fingerprint !== review.previewFingerprint) {
        throw new Error("Committed output did not match the reviewed transaction preview.");
      }
      review.status = "committed";
      review.resolvedAt = new Date().toISOString();
      review.historyOperationId = committed.operation?.id ?? null;
      writeStored(projectDir, entries);
      return { review: publicReview(review), committed };
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (/fingerprint conflict|did not match the reviewed/i.test(message)) {
        review.status = "stale";
        review.resolvedAt = new Date().toISOString();
        writeStored(projectDir, entries);
      }
      throw error;
    }
  });
}

export function rejectTransactionReview(
  projectDir: string,
  transactionId: string,
  expectedPreviewFingerprint?: string,
  allowMissing = false,
): PublicTransactionReview | null {
  return withLock(projectDir, (entries) => {
    const review = entries.find((entry) => entry.transactionId === transactionId);
    if (!review) {
      if (allowMissing) return null;
      throw new Error("Unknown agent transaction review.");
    }
    if (review.status !== "previewed") throw new Error(`Agent transaction review is already ${review.status}.`);
    if (expectedPreviewFingerprint && review.previewFingerprint !== expectedPreviewFingerprint) {
      throw new Error("Agent transaction review fingerprint conflict.");
    }
    review.status = "rejected";
    review.resolvedAt = new Date().toISOString();
    writeStored(projectDir, entries);
    return publicReview(review);
  });
}
