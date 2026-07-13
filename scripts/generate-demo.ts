import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { compileReact } from "../packages/compiler-react/src/index";
import { compileSwiftUI } from "../packages/compiler-swiftui/src/index";
import { buildProofReport } from "../packages/proof-report/src/index";
import { demoBrief, demoGraph } from "../packages/proof-report/src/demo";
import { stableSerialize } from "../packages/semantic-schema/src/index";

const root = process.cwd();
const outputRoot = join(root, "generated");
const report = buildProofReport(demoGraph);
const react = compileReact(report.after.graph);
const swift = compileSwiftUI(report.after.graph);

await rm(outputRoot, { recursive: true, force: true });

async function emit(relativePath: string, content: string) {
  const destination = join(outputRoot, relativePath);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, content, "utf8");
}

await emit("brief.txt", `${demoBrief}\n`);
await emit("graph.before.json", stableSerialize(report.before.graph));
await emit("graph.after.json", stableSerialize(report.after.graph));
await emit("proof-report.json", stableSerialize(report));

for (const file of react.files) await emit(join("react", file.path), file.content);
for (const file of swift.files) await emit(join("swiftui", file.path), file.content);

console.log(`Generated verified demo artifacts in ${outputRoot}`);
console.log(`React ${react.fingerprint} · SwiftUI ${swift.fingerprint}`);
