import type { GitSnapshot } from "./protocol.ts";
import { sanitizeDesktopText } from "./security.ts";
import type { DesktopCommandRunner } from "./toolchains.ts";

const unavailable = (message: string): GitSnapshot => ({
  available: false,
  repository: false,
  branch: null,
  upstream: null,
  ahead: 0,
  behind: 0,
  changed: 0,
  branches: [],
  commits: [],
  message,
});

export async function inspectGitRepository(
  projectRoot: string,
  gitExecutable: string | undefined,
  runner: DesktopCommandRunner,
): Promise<GitSnapshot> {
  if (!gitExecutable) return unavailable("Git is not available in the trusted installation paths.");
  const execute = (args: readonly string[]) => runner.run(gitExecutable, ["-C", projectRoot, ...args], { timeoutMs: 5_000 });
  try {
    const status = await execute(["status", "--porcelain=v2", "--branch", "--untracked-files=normal"]);
    if (status.code !== 0) return { ...unavailable("The granted project is not inside a Git repository."), available: true };
    const branchesResult = await execute(["branch", "--format=%(HEAD)%09%(refname:short)"]);
    const logResult = await execute(["log", "-n", "20", "--format=%H%x1f%aI%x1f%s"]);
    const lines = status.stdout.split(/\r?\n/).filter(Boolean);
    const field = (prefix: string) => lines.find((line) => line.startsWith(prefix))?.slice(prefix.length) ?? null;
    const counts = field("# branch.ab ")?.match(/^\+(\d+) -(\d+)$/);
    const branches = branchesResult.code === 0 ? branchesResult.stdout.split(/\r?\n/).filter(Boolean).slice(0, 500).map((line) => {
      const [head = "", name = ""] = line.split("\t", 2);
      return { name: sanitizeDesktopText(name), current: head === "*" };
    }).filter((entry) => entry.name) : [];
    const commits = logResult.code === 0 ? logResult.stdout.split(/\r?\n/).filter(Boolean).slice(0, 20).flatMap((line) => {
      const [hash, authoredAt, subject] = line.split("\x1f", 3);
      if (!hash || !authoredAt || !subject || !/^[a-f0-9]{7,64}$/i.test(hash) || Number.isNaN(Date.parse(authoredAt))) return [];
      return [{ hash, authoredAt: new Date(authoredAt).toISOString(), subject: sanitizeDesktopText(subject, 400) }];
    }) : [];
    return {
      available: true,
      repository: true,
      branch: field("# branch.head "),
      upstream: field("# branch.upstream "),
      ahead: Number(counts?.[1] ?? 0),
      behind: Number(counts?.[2] ?? 0),
      changed: lines.filter((line) => !line.startsWith("# ")).length,
      branches,
      commits,
      message: status.stderr ? sanitizeDesktopText(status.stderr) : "Read-only Git status is current.",
    };
  } catch (error) {
    return unavailable(sanitizeDesktopText(error instanceof Error ? error.message : "Git inspection failed."));
  }
}
