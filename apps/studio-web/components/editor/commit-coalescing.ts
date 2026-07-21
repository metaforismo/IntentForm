export interface CommitStamp {
  at: number;
  notice: string;
  anchor: string;
}

export const COMMIT_COALESCE_WINDOW_MS = 900;

/**
 * Rapid identical edits (dragging a color token, scrubbing a size field)
 * coalesce into one undo step. Two edits only coalesce when they carry the
 * same notice AND the same selection anchor: identical notice text alone
 * (renaming node A, then node B) must not merge unrelated edits into a
 * single undo entry.
 */
export function shouldCoalesceCommit(
  previous: CommitStamp,
  next: CommitStamp,
  windowMs: number = COMMIT_COALESCE_WINDOW_MS,
): boolean {
  return (
    previous.notice === next.notice &&
    previous.anchor === next.anchor &&
    previous.notice !== "" &&
    next.at - previous.at < windowMs
  );
}
