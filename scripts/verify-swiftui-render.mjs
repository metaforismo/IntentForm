import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const hostRoot = join(root, "examples/native-preview-app");
const project = join(hostRoot, "IntentFormNativePreview.xcodeproj");
const derivedData = join(hostRoot, ".build/ci-derived");
const appPath = join(derivedData, "Build/Products/Debug-iphonesimulator/IntentFormNativePreview.app");
const bundleId = "dev.intentform.native-preview";
const serveSim = join(root, "node_modules/.bin/serve-sim");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    env: options.env ?? process.env,
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = options.capture ? `\n${result.stdout ?? ""}\n${result.stderr ?? ""}` : "";
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}.${detail}`);
  }
  return result.stdout?.trim() ?? "";
}

function tryRun(command, args) {
  spawnSync(command, args, { cwd: root, encoding: "utf8", stdio: "ignore" });
}

function selectSimulator() {
  const requested = process.env.INTENTFORM_SIMULATOR_UDID;
  const payload = JSON.parse(run("xcrun", ["simctl", "list", "devices", "available", "--json"], { capture: true }));
  const candidates = Object.entries(payload.devices)
    .filter(([runtime]) => runtime.includes("iOS"))
    .flatMap(([runtime, devices]) => devices.map((device) => ({ ...device, runtime })))
    .filter((device) => device.isAvailable !== false && device.name.startsWith("iPhone"))
    .sort((left, right) => right.runtime.localeCompare(left.runtime, undefined, { numeric: true })
      || Number(right.name.includes("Pro")) - Number(left.name.includes("Pro"))
      || left.name.localeCompare(right.name));
  const selected = requested
    ? candidates.find((device) => device.udid === requested)
    : candidates[0];
  if (!selected) throw new Error(requested
    ? `Requested Simulator ${requested} is not available.`
    : "No available iPhone Simulator was found.");
  return selected;
}

async function waitForAccessibility(axUrl) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      const response = await fetch(axUrl, { signal: AbortSignal.timeout(15_000) });
      if (response.ok) {
        const tree = await response.json();
        const serialized = JSON.stringify(tree);
        if (serialized.includes("intentform.payment-request.confirm")) return;
      }
    } catch {
      // The helper or application is still becoming ready.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("Native preview did not expose the semantic primary action through accessibility.");
}

const simulator = selectSimulator();
const wasBooted = simulator.state === "Booted";
let helperStarted = false;

console.log(`Native evidence Simulator: ${simulator.name} · ${simulator.runtime} · ${simulator.udid}`);

try {
  if (!wasBooted) run("xcrun", ["simctl", "boot", simulator.udid]);
  run("xcrun", ["simctl", "bootstatus", simulator.udid, "-b"]);
  run("xcrun", ["simctl", "ui", simulator.udid, "appearance", "light"]);
  run("xcrun", ["simctl", "ui", simulator.udid, "content_size", "medium"]);

  run(process.execPath, ["--experimental-strip-types", join(root, "scripts/sync-swift-preview.ts")]);
  run("xcodebuild", [
    "-project", project,
    "-scheme", "IntentFormNativePreview",
    "-destination", `id=${simulator.udid}`,
    "-derivedDataPath", derivedData,
    "CODE_SIGNING_ALLOWED=NO",
    "-quiet",
    "build",
  ], { cwd: hostRoot });
  if (!existsSync(appPath)) throw new Error(`Native preview app was not produced at ${appPath}`);

  run("xcrun", ["simctl", "install", simulator.udid, appPath]);
  run("xcrun", ["simctl", "launch", "--terminate-running-process", simulator.udid, bundleId]);

  tryRun(serveSim, ["--kill", simulator.udid]);
  const helper = JSON.parse(run(serveSim, ["--detach", "-q", simulator.udid], { capture: true }));
  helperStarted = true;
  const streamUrl = new URL(helper.streamUrl);
  const axUrl = new URL(streamUrl.pathname.replace(/stream\.mjpeg$/, "ax"), streamUrl.origin).href;
  console.log(`Native accessibility endpoint: ${axUrl}`);
  await waitForAccessibility(axUrl);

  run(process.execPath, ["--experimental-strip-types", join(root, "scripts/capture-swiftui-evidence.ts")], {
    env: {
      ...process.env,
      INTENTFORM_SIMULATOR_UDID: simulator.udid,
      INTENTFORM_SIMULATOR_AX_URL: axUrl,
    },
  });
} finally {
  if (helperStarted) tryRun(serveSim, ["--kill", simulator.udid]);
  tryRun("xcrun", ["simctl", "terminate", simulator.udid, bundleId]);
  if (!wasBooted) tryRun("xcrun", ["simctl", "shutdown", simulator.udid]);
}
