import { cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

const source = join(process.cwd(), "generated/swiftui/Generated");
const destination = join(process.cwd(), "examples/preview-ios/Sources/IntentFormPreview/Generated");

await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true });
