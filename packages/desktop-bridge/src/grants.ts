import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { z } from "zod";

const MAX_GRANT_FILE_BYTES = 64 * 1024;
const grantFileSchema = z.strictObject({
  version: z.literal(1),
  projects: z.array(z.strictObject({ path: z.string().min(1).max(4_096), grantedAt: z.string().datetime() })).max(100),
});
export type ProjectGrant = z.infer<typeof grantFileSchema>["projects"][number];

function canonicalDirectory(path: string): string {
  const canonical = realpathSync.native(path);
  const stat = lstatSync(canonical);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("A project grant must resolve to a regular directory.");
  return canonical;
}

function intentFormDirectory(selection: string): string {
  const root = canonicalDirectory(selection);
  if (basename(root) === ".intentform") return root;
  const nested = join(root, ".intentform");
  if (!existsSync(nested)) throw new Error("The selected directory does not contain an .intentform project.");
  return canonicalDirectory(nested);
}

export class ProjectGrantStore {
  constructor(readonly path: string) {}

  list(): ProjectGrant[] {
    if (!existsSync(this.path)) return [];
    const stat = lstatSync(this.path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_GRANT_FILE_BYTES) {
      throw new Error("Desktop path grants must be a bounded regular file.");
    }
    return grantFileSchema.parse(JSON.parse(readFileSync(this.path, "utf8"))).projects;
  }

  grant(selection: string, grantedAt = new Date().toISOString()): ProjectGrant {
    const path = intentFormDirectory(selection);
    const grant = { path, grantedAt };
    const projects = [grant, ...this.list().filter((entry) => entry.path !== path)].slice(0, 100);
    this.#write(projects);
    return grant;
  }

  revoke(path: string): void {
    const projects = this.list().filter((entry) => entry.path !== path);
    this.#write(projects);
  }

  isGranted(path: string): boolean {
    let canonical: string;
    try { canonical = intentFormDirectory(path); } catch { return false; }
    return this.list().some((entry) => entry.path === canonical);
  }

  #write(projects: ProjectGrant[]): void {
    const parent = dirname(this.path);
    mkdirSync(parent, { recursive: true, mode: 0o700 });
    if (lstatSync(parent).isSymbolicLink()) throw new Error("Desktop grant storage cannot be symlinked.");
    if (existsSync(this.path) && lstatSync(this.path).isSymbolicLink()) throw new Error("Desktop grant file cannot be symlinked.");
    const temporary = join(parent, `.${process.pid}-${Date.now()}-path-grants.tmp`);
    let descriptor: number | null = null;
    try {
      descriptor = openSync(temporary, "wx", 0o600);
      writeFileSync(descriptor, `${JSON.stringify({ version: 1, projects }, null, 2)}\n`, "utf8");
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = null;
      renameSync(temporary, this.path);
      const directory = openSync(parent, "r");
      try { fsyncSync(directory); } finally { closeSync(directory); }
    } catch (error) {
      if (descriptor !== null) closeSync(descriptor);
      rmSync(temporary, { force: true });
      throw error;
    }
  }
}
