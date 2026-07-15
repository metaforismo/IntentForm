import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { compileExpo } from "../packages/compiler-expo/src/index.ts";
import { buildProofReport } from "../packages/proof-report/src/index.ts";
import { demoGraph } from "../packages/proof-report/src/demo.ts";

const destination = join(process.cwd(), "apps/expo-preview");
const stagedDestination = `${destination}.${process.pid}.tmp`;
const repairedGraph = buildProofReport(demoGraph, { before: "not-run", after: "not-run" }).after.graph;
const output = compileExpo(repairedGraph);
const nextPaths = new Set(output.files.map((file) => file.path));

function compilerOwnedPath(path: string): boolean {
  if (path.startsWith("/") || path.split("/").includes("..")) return false;
  return [
    ".gitignore",
    "package.json",
    "app.json",
    "eas.json",
    "expo-env.d.ts",
    "tsconfig.json",
    "README.generated.md",
    "INTENTFORM.generated.txt",
    "intentform.expo.json",
  ].includes(path) || ["app/", "src/adapters/", "src/contracts/", "src/runtime/", "src/screens/", "src/theme/"].some((prefix) => path.startsWith(prefix));
}

let previousPaths: string[] = [];
try {
  const manifest = JSON.parse(await readFile(join(destination, "intentform.expo.json"), "utf8")) as { ownedPaths?: unknown };
  if (Array.isArray(manifest.ownedPaths)) previousPaths = manifest.ownedPaths.filter((path): path is string => typeof path === "string" && compilerOwnedPath(path));
} catch {
  // A missing or invalid prior manifest is treated as an empty generated tree.
}

await rm(stagedDestination, { recursive: true, force: true });
for (const file of output.files) {
  const target = join(stagedDestination, file.path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, file.content, "utf8");
}
await mkdir(destination, { recursive: true });
for (const stalePath of previousPaths.filter((path) => !nextPaths.has(path))) {
  await rm(join(destination, stalePath), { force: true });
}
for (const file of output.files) {
  const target = join(destination, file.path);
  await mkdir(dirname(target), { recursive: true });
  await rm(target, { force: true });
  await rename(join(stagedDestination, file.path), target);
}
await rm(stagedDestination, { recursive: true, force: true });
