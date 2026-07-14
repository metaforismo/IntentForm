import { access, readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const root = process.cwd();
const excludedDirectories = new Set([".git", ".claude", "docsdoneforplanning", "node_modules", "output"]);

async function markdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!excludedDirectories.has(entry.name)) files.push(...await markdownFiles(join(directory, entry.name)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(join(directory, entry.name));
    }
  }
  return files;
}

const failures = [];
let checkedLinks = 0;
const files = await markdownFiles(root);
for (const file of files) {
  const source = await readFile(file, "utf8");
  for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const rawTarget = match[1]?.trim().replace(/^<|>$/g, "") ?? "";
    const target = rawTarget.split(/\s+['"]/u, 1)[0]?.split("#", 1)[0] ?? "";
    if (!target || /^(?:https?:|mailto:|#)/i.test(rawTarget)) continue;
    checkedLinks += 1;
    const absolute = resolve(dirname(file), decodeURIComponent(target));
    try {
      await access(absolute);
    } catch {
      failures.push(`${file.slice(root.length + 1)} -> ${rawTarget}`);
    }
  }
}

if (failures.length > 0) {
  throw new Error(`Broken documentation links:\n${failures.join("\n")}`);
}
console.log(`Documentation links: ${checkedLinks} relative links verified across ${files.length} files.`);
