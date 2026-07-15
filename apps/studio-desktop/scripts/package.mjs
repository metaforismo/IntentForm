import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { packager } from "@electron/packager";
import { flipFuses, FuseVersion, FuseV1Options } from "@electron/fuses";
import { sign } from "@electron/osx-sign";

const run = promisify(execFile);
const appRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(appRoot, "../..");
const desktopRoot = join(appRoot, ".desktop");
const studioResource = join(desktopRoot, "studio");
const outputRoot = join(workspaceRoot, "output/desktop");

await rm(outputRoot, { recursive: true, force: true });

const paths = await packager({
  dir: join(desktopRoot, "app"),
  name: "IntentForm",
  appBundleId: "dev.intentform.studio",
  appVersion: "0.1.0",
  buildVersion: "1",
  electronVersion: "41.10.2",
  platform: process.platform,
  arch: process.arch,
  out: outputRoot,
  overwrite: true,
  asar: { unpack: "**/*.node" },
  prune: false,
  extraResource: [studioResource],
  extendInfo: {
    NSHumanReadableCopyright: "Copyright © 2026 IntentForm contributors",
    NSAppTransportSecurity: { NSAllowsArbitraryLoads: false, NSAllowsLocalNetworking: true },
  },
});

if (paths.length !== 1) throw new Error(`Expected one desktop bundle, received ${paths.length}.`);
const packageDirectory = paths[0];
const bundle = process.platform === "darwin" ? join(packageDirectory, "IntentForm.app") : packageDirectory;
const executable = process.platform === "darwin" ? join(bundle, "Contents/MacOS/IntentForm") : join(bundle, "IntentForm");
await flipFuses(executable, {
  version: FuseVersion.V1,
  resetAdHocDarwinSignature: process.platform === "darwin" && process.arch === "arm64",
  strictlyRequireAllFuses: true,
  [FuseV1Options.RunAsNode]: false,
  // IntentForm stores no authentication material in Chromium cookies. Electron
  // 41's cookie-encryption fuse prevents the signed macOS utility service from
  // starting under the verified ad-hoc package profile, so keep this unused
  // feature off instead of shipping a package that cannot launch.
  [FuseV1Options.EnableCookieEncryption]: false,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: false,
  // Electron does not ship a browser_v8_context_snapshot.bin by default.
  // Enabling this without producing that build-time artifact prevents launch.
  [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
  [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
  [FuseV1Options.WasmTrapHandlers]: true,
});

if (process.platform === "darwin") {
  const identity = process.env.INTENTFORM_MAC_SIGN_IDENTITY ?? "-";
  if (identity === "-") {
    // A plain ad-hoc signature is the only local profile that exercises
    // Electron's sandbox preload startup faithfully without a real Team ID.
    await run("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", bundle]);
  } else {
    await sign({
      app: bundle,
      identity,
      identityValidation: true,
      platform: "darwin",
      preAutoEntitlements: false,
      preEmbedProvisioningProfile: false,
      strictVerify: true,
      version: "41.10.2",
      optionsForFile: () => ({
        entitlements: join(appRoot, "resources/entitlements.mac.plist"),
        hardenedRuntime: true,
      }),
    });
  }
  await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--verbose=2", bundle]);
}
process.stdout.write(`${bundle}\n`);
