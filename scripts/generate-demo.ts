import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { compileReact } from "../packages/compiler-react/src/index.ts";
import { compileSwiftUI } from "../packages/compiler-swiftui/src/index.ts";
import { buildProofReport } from "../packages/proof-report/src/index.ts";
import { demoBrief, demoGraph } from "../packages/proof-report/src/demo.ts";
import { stableSerialize } from "../packages/semantic-schema/src/index.ts";

const root = process.cwd();
const outputRoot = join(root, "generated");
const report = buildProofReport(demoGraph, { before: "not-run", after: "not-run" });
const reactBefore = compileReact(report.before.graph);
const reactAfter = compileReact(report.after.graph);
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

for (const file of reactBefore.files) await emit(join("react", "before", file.path), file.content);
for (const file of reactAfter.files) await emit(join("react", "after", file.path), file.content);
for (const file of swift.files) await emit(join("swiftui", file.path), file.content);

console.log(`Generated deterministic demo source artifacts in ${outputRoot}`);
console.log(`React ${reactBefore.fingerprint} → ${reactAfter.fingerprint} · SwiftUI ${swift.fingerprint}`);
