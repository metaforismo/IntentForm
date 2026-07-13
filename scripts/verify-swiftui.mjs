import { spawnSync } from "node:child_process";
import { join } from "node:path";

const packageRoot = join(process.cwd(), "examples/preview-ios");
const result = spawnSync(
  "xcodebuild",
  [
    "-scheme",
    "IntentFormPreview",
    "-destination",
    "generic/platform=iOS Simulator",
    "-derivedDataPath",
    ".build/xcode",
    "CODE_SIGNING_ALLOWED=NO",
    "build",
  ],
  { cwd: packageRoot, stdio: "inherit" },
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
