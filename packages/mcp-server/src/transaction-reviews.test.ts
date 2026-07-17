import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadProject, saveProject } from "./store.ts";
import { applyPatch } from "./tools.ts";
import { SemanticTransactionService } from "./transactions.ts";
import {
  commitTransactionReview,
  readTransactionReviews,
  rejectTransactionReview,
} from "./transaction-reviews.ts";

let dir: string;

const patch = (id: string, label: string) => ({
  id,
  rationale: `Set the confirmation label to ${label}`,
  operations: [{ op: "set-label" as const, target: "payment-request.confirm", label }],
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "intentform-review-inbox-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("persisted agent transaction reviews", () => {
  it("publishes an exact preview without exposing the retained patch", () => {
    const transactions = new SemanticTransactionService();
    const before = loadProject(dir);
    const begun = transactions.begin(dir, "session-a", before.fingerprint, "Review copy", "http");
    const previewed = transactions.preview(dir, "session-a", begun.transactionId, patch("review.preview", "Review me"));

    const [review] = readTransactionReviews(dir).reviews;
    expect(review).toMatchObject({
      transactionId: begun.transactionId,
      transport: "http",
      status: "previewed",
      baseFingerprint: before.fingerprint,
      previewFingerprint: previewed.preview.previewFingerprint,
      changes: [{
        path: "payment-request.confirm.intent.label",
        before: before.graph.screens[1]?.nodes[3]?.intent.label,
        after: "Review me",
      }],
    });
    expect(review).not.toHaveProperty("patch");
    expect(statSync(join(dir, "transaction-reviews.json")).mode & 0o777).toBe(0o600);
    expect(loadProject(dir).fingerprint).toBe(before.fingerprint);
  });

  it("binds a transaction to one exact unresolved canvas comment", () => {
    const transactions = new SemanticTransactionService();
    const initial = loadProject(dir);
    const commentId = "review.agent-link";
    initial.graph.reviewThreads.push({
      id: commentId,
      anchor: { screenId: initial.graph.screens[0]!.id, x: 0.5, y: 0.5 },
      messages: [{ id: "message.agent-link", author: { id: "reviewer", name: "Reviewer", kind: "human" }, createdAt: new Date().toISOString(), body: "Please address this", mentions: [] }],
    });
    saveProject(dir, initial.graph, "add review comment", initial.fingerprint);
    const before = loadProject(dir);
    const begun = transactions.begin(dir, "session-a", before.fingerprint, "Address canvas feedback", "http", commentId);
    transactions.preview(dir, "session-a", begun.transactionId, patch("review.comment", "Comment linked"));
    expect(readTransactionReviews(dir).reviews[0]?.commentId).toBe(commentId);
    expect(() => transactions.begin(dir, "session-b", before.fingerprint, "Unknown comment", "stdio", "missing-comment")).toThrow(/unknown review comment/i);
    const thread = before.graph.reviewThreads.find((candidate) => candidate.id === commentId)!;
    thread.resolvedAt = new Date().toISOString();
    thread.resolvedBy = { id: "reviewer", name: "Reviewer", kind: "human" };
    const resolved = saveProject(dir, before.graph, "resolve review comment", before.fingerprint);
    expect(() => transactions.begin(dir, "session-b", resolved.fingerprint, "Resolved comment", "stdio", commentId)).toThrow(/review comment is resolved/i);
  });

  it("allows Studio to commit the reviewed fingerprint exactly once", () => {
    const transactions = new SemanticTransactionService();
    const before = loadProject(dir);
    const begun = transactions.begin(dir, "session-a", before.fingerprint, "Review copy");
    const previewed = transactions.preview(dir, "session-a", begun.transactionId, patch("review.commit", "Committed in Studio"));

    const result = commitTransactionReview(dir, begun.transactionId, previewed.preview.previewFingerprint);
    expect(result.committed.fingerprint).toBe(previewed.preview.previewFingerprint);
    expect(result.review.status).toBe("committed");
    expect(result.review.historyOperationId).toBe(result.committed.operation?.id);
    expect(loadProject(dir).graph.screens[1]?.nodes[3]?.intent.label).toBe("Committed in Studio");
    expect(() => transactions.clearOwner("session-a")).not.toThrow();
    expect(readTransactionReviews(dir).reviews[0]?.status).toBe("committed");
    expect(() => transactions.commit(dir, "session-a", begun.transactionId)).toThrow(/unknown or inaccessible/i);
  });

  it("makes a Studio rejection authoritative for the originating MCP session", () => {
    const transactions = new SemanticTransactionService();
    const before = loadProject(dir);
    const begun = transactions.begin(dir, "session-a", before.fingerprint, "Reject copy");
    const previewed = transactions.preview(dir, "session-a", begun.transactionId, patch("review.reject", "Rejected"));

    expect(rejectTransactionReview(dir, begun.transactionId, previewed.preview.previewFingerprint)?.status).toBe("rejected");
    expect(() => transactions.commit(dir, "session-a", begun.transactionId)).toThrow(/already rejected/i);
    expect(loadProject(dir).fingerprint).toBe(before.fingerprint);
  });

  it("fails a stale reviewed commit closed after another writer wins", () => {
    const transactions = new SemanticTransactionService();
    const before = loadProject(dir);
    const begun = transactions.begin(dir, "session-a", before.fingerprint, "Stale copy");
    const previewed = transactions.preview(dir, "session-a", begun.transactionId, patch("review.stale", "Agent"));
    const winner = applyPatch(dir, patch("review.winner", "Human"), before.fingerprint);

    expect(() => commitTransactionReview(dir, begun.transactionId, previewed.preview.previewFingerprint)).toThrow(/fingerprint conflict/i);
    expect(readTransactionReviews(dir).reviews[0]).toMatchObject({ status: "stale" });
    expect(loadProject(dir).fingerprint).toBe(winner.fingerprint);
    expect(loadProject(dir).graph.screens[1]?.nodes[3]?.intent.label).toBe("Human");
  });

  it("refuses a UI action bound to the wrong preview fingerprint", () => {
    const transactions = new SemanticTransactionService();
    const before = loadProject(dir);
    const begun = transactions.begin(dir, "session-a", before.fingerprint, "Fingerprint guard");
    transactions.preview(dir, "session-a", begun.transactionId, patch("review.guard", "Guarded"));

    expect(() => commitTransactionReview(dir, begun.transactionId, "00000000")).toThrow(/fingerprint conflict/i);
    expect(() => rejectTransactionReview(dir, begun.transactionId, "00000000")).toThrow(/fingerprint conflict/i);
    expect(readTransactionReviews(dir).reviews[0]?.status).toBe("previewed");
  });

  it("keeps a review retryable when another process temporarily holds its lock", () => {
    const transactions = new SemanticTransactionService();
    const before = loadProject(dir);
    const begun = transactions.begin(dir, "session-a", before.fingerprint, "Retry lock");
    const previewed = transactions.preview(dir, "session-a", begun.transactionId, patch("review.lock", "Retry"));
    const lockPath = join(dir, ".transaction-reviews.lock");
    writeFileSync(lockPath, "busy", { mode: 0o600 });

    expect(() => commitTransactionReview(dir, begun.transactionId, previewed.preview.previewFingerprint)).toThrow(/busy/i);
    rmSync(lockPath, { force: true });
    expect(readTransactionReviews(dir).reviews[0]?.status).toBe("previewed");
  });
});
