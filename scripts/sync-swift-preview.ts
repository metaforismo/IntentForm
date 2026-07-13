import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { compileSwiftUI } from "../packages/compiler-swiftui/src/index.ts";
import { buildProofReport } from "../packages/proof-report/src/index.ts";
import { demoGraph } from "../packages/proof-report/src/demo.ts";

const root = process.cwd();
const destination = join(root, "examples/preview-ios/Sources/IntentFormPreview");
const output = compileSwiftUI(buildProofReport(demoGraph).after.graph);

for (const file of output.files) {
  const target = join(destination, file.path);
  const temporary = `${target}.${process.pid}.tmp`;
  await mkdir(dirname(target), { recursive: true });
  await writeFile(temporary, file.content, "utf8");
  await rename(temporary, target);
}
