import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { compileReact } from "../packages/compiler-react/src/index.ts";
import { buildProofReport } from "../packages/proof-report/src/index.ts";
import { demoGraph } from "../packages/proof-report/src/demo.ts";

const root = process.cwd();
const destination = join(root, "apps/react-preview/src/generated");
const report = buildProofReport(demoGraph, { before: "not-run", after: "not-run" });

async function emit(relativePath: string, content: string) {
  const target = join(destination, relativePath);
  const temporary = `${target}.${process.pid}.tmp`;
  await mkdir(dirname(target), { recursive: true });
  await writeFile(temporary, content, "utf8");
  await rename(temporary, target);
}

for (const [variant, graph] of [["before", report.before.graph], ["after", report.after.graph]] as const) {
  for (const file of compileReact(graph).files) {
    await emit(join(variant, file.path.replace(/^src\/generated\//, "")), file.content);
  }
}
