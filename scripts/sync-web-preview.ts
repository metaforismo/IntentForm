import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { compileWeb } from "../packages/compiler-web/src/index.ts";
import { responsiveWebDemoGraph } from "../packages/proof-report/src/demo.ts";

const destination = join(process.cwd(), "apps/web-preview/src/generated");
const stagedDestination = `${destination}.${process.pid}.tmp`;
const output = compileWeb(responsiveWebDemoGraph);

await rm(stagedDestination, { recursive: true, force: true });
for (const file of output.files.filter((candidate) => candidate.path.startsWith("src/") && candidate.path !== "src/main.tsx")) {
  const target = join(stagedDestination, file.path.slice("src/".length));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, file.content, "utf8");
}
await rm(destination, { recursive: true, force: true });
await rename(stagedDestination, destination);
