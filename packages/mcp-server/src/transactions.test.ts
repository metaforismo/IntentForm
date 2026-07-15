import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadProject } from "./store.ts";
import { applyPatch, projectRevisions } from "./tools.ts";
import { SemanticTransactionService } from "./transactions.ts";

let dir: string;

const labelPatch = (id: string, label: string) => ({
  id,
  rationale: `Set the payment confirmation label to ${label}`,
  operations: [{ op: "set-label" as const, target: "payment-request.confirm", label }],
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "intentform-transactions-"));
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(dir, { recursive: true, force: true });
});

describe("semantic MCP transactions", () => {
  it("previews without writing and commits the exact reviewed fingerprint once", () => {
    const transactions = new SemanticTransactionService();
    const before = loadProject(dir);
    const begun = transactions.begin(dir, "session-a", before.fingerprint, "Review the primary action copy");
    const previewed = transactions.preview(dir, "session-a", begun.transactionId, labelPatch("tx.label", "Send request"));

    expect(previewed.status).toBe("previewed");
    expect(previewed.preview.previewFingerprint).not.toBe(before.fingerprint);
    expect(loadProject(dir)).toMatchObject({ fingerprint: before.fingerprint, graph: before.graph });
    expect(projectRevisions(dir).revisions).toEqual([]);

    const committed = transactions.commit(dir, "session-a", begun.transactionId);
    expect(committed).toMatchObject({
      status: "committed",
      baseFingerprint: before.fingerprint,
      previewFingerprint: previewed.preview.previewFingerprint,
      committed: { fingerprint: previewed.preview.previewFingerprint },
    });
    expect(loadProject(dir).graph.screens[1]?.nodes[3]?.intent.label).toBe("Send request");
    expect(projectRevisions(dir).revisions).toHaveLength(1);
    expect(() => transactions.commit(dir, "session-a", begun.transactionId)).toThrow(/unknown or inaccessible/i);
  });

  it("rolls back without changing the project or revision history", () => {
    const transactions = new SemanticTransactionService();
    const before = loadProject(dir);
    const begun = transactions.begin(dir, "session-a", before.fingerprint, "Discard this edit");
    transactions.preview(dir, "session-a", begun.transactionId, labelPatch("tx.rollback", "Temporary"));

    expect(transactions.rollback(dir, "session-a", begun.transactionId)).toEqual({
      transactionId: begun.transactionId,
      status: "rolled-back",
      baseFingerprint: before.fingerprint,
      projectChanged: false,
    });
    expect(loadProject(dir)).toMatchObject({ fingerprint: before.fingerprint, graph: before.graph });
    expect(projectRevisions(dir).revisions).toEqual([]);
  });

  it("fails a stale commit closed and preserves the winning graph", () => {
    const transactions = new SemanticTransactionService();
    const before = loadProject(dir);
    const begun = transactions.begin(dir, "session-a", before.fingerprint, "Potential agent edit");
    transactions.preview(dir, "session-a", begun.transactionId, labelPatch("tx.stale", "Agent label"));
    const winner = applyPatch(dir, labelPatch("studio.winner", "Studio label"), before.fingerprint);

    expect(() => transactions.commit(dir, "session-a", begun.transactionId)).toThrow(/fingerprint conflict/i);
    expect(loadProject(dir)).toMatchObject({ fingerprint: winner.fingerprint });
    expect(loadProject(dir).graph.screens[1]?.nodes[3]?.intent.label).toBe("Studio label");
    expect(projectRevisions(dir).revisions).toHaveLength(1);
  });

  it("isolates transactions by session and clears an owner's outstanding work", () => {
    const transactions = new SemanticTransactionService();
    const before = loadProject(dir);
    const begun = transactions.begin(dir, "session-a", before.fingerprint, "Private session edit");

    expect(() => transactions.preview(dir, "session-b", begun.transactionId, labelPatch("tx.other", "Other")))
      .toThrow(/unknown or inaccessible/i);
    expect(() => transactions.rollback(dir, "session-b", begun.transactionId)).toThrow(/unknown or inaccessible/i);
    transactions.clearOwner("session-a");
    expect(() => transactions.preview(dir, "session-a", begun.transactionId, labelPatch("tx.cleared", "Cleared")))
      .toThrow(/unknown or inaccessible/i);
  });

  it("rejects stale opens, expires abandoned work, and bounds each session", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T10:00:00.000Z"));
    const transactions = new SemanticTransactionService(10_000);
    const before = loadProject(dir);
    expect(() => transactions.begin(dir, "session-a", "00000000", "Stale"))
      .toThrow(/fingerprint conflict/i);

    const first = transactions.begin(dir, "session-a", before.fingerprint, "Expires");
    for (let index = 0; index < 7; index += 1) {
      transactions.begin(dir, "session-a", before.fingerprint, `Open ${index}`);
    }
    expect(() => transactions.begin(dir, "session-a", before.fingerprint, "Too many"))
      .toThrow(/maximum number/i);

    vi.advanceTimersByTime(10_001);
    expect(() => transactions.rollback(dir, "session-a", first.transactionId)).toThrow(/unknown or inaccessible/i);
    expect(transactions.begin(dir, "session-a", before.fingerprint, "Capacity recovered").status).toBe("open");
  });

  it("bounds aggregate transaction state across independent sessions", () => {
    const transactions = new SemanticTransactionService();
    const before = loadProject(dir);
    for (let owner = 0; owner < 4; owner += 1) {
      for (let index = 0; index < 8; index += 1) {
        transactions.begin(dir, `session-${owner}`, before.fingerprint, `Transaction ${owner}-${index}`);
      }
    }
    expect(() => transactions.begin(dir, "session-overflow", before.fingerprint, "Overflow"))
      .toThrow(/capacity is full/i);
  });
});
