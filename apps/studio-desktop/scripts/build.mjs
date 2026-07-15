import { cp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { build } from "esbuild";

const appRoot = resolve(import.meta.dirname, "..");
const outputRoot = join(appRoot, ".desktop");
const applicationRoot = join(outputRoot, "app");
const serviceRoot = join(applicationRoot, "service");
const studioRoot = join(outputRoot, "studio");
const linkedStudioRoot = join(outputRoot, "studio-linked");
const workspaceRoot = resolve(appRoot, "../..");
await rm(outputRoot, { recursive: true, force: true });
await Promise.all([mkdir(serviceRoot, { recursive: true }), mkdir(studioRoot, { recursive: true }), mkdir(linkedStudioRoot, { recursive: true })]);

const shared = {
  bundle: true,
  platform: "node",
  target: "node24",
  sourcemap: true,
  legalComments: "none",
  logLevel: "warning",
};

await Promise.all([
  build({ ...shared, entryPoints: [join(appRoot, "src/main.ts")], outfile: join(applicationRoot, "main.cjs"), format: "cjs", external: ["electron"] }),
  build({ ...shared, entryPoints: [join(appRoot, "src/preload.ts")], outfile: join(applicationRoot, "preload.cjs"), format: "cjs", external: ["electron"] }),
  build({ ...shared, entryPoints: [join(appRoot, "src/studio-service.ts")], outfile: join(serviceRoot, "studio-service.mjs"), format: "esm", external: ["electron"] }),
  build({ ...shared, entryPoints: [join(appRoot, "src/mcp-service.ts")], outfile: join(serviceRoot, "mcp-service.mjs"), format: "esm", external: ["electron"] }),
]);

await writeFile(join(applicationRoot, "package.json"), `${JSON.stringify({
  name: "intentform-desktop-runtime",
  version: "0.1.0",
  private: true,
  main: "main.cjs",
}, null, 2)}\n`);
await cp(join(appRoot, "resources"), join(applicationRoot, "resources"), { recursive: true });
await cp(join(workspaceRoot, "LICENSE"), join(applicationRoot, "resources", "LICENSE.txt"));
await cp(join(workspaceRoot, "NOTICE"), join(applicationRoot, "resources", "NOTICE.txt"));
await cp(join(workspaceRoot, "apps/studio-web/.next/standalone"), linkedStudioRoot, { recursive: true, dereference: false });
const linkedApplicationModules = join(linkedStudioRoot, "apps/studio-web/node_modules");
const linkedNextPackage = await realpath(join(linkedApplicationModules, "next"));
const linkedNextDependencyRoot = dirname(linkedNextPackage);
// Next's traced pnpm tree can contain an optional semver link without its
// package target. The server does not use it, while a dangling bundle link
// makes macOS deep-signature verification fail closed.
await rm(join(linkedStudioRoot, "node_modules/.pnpm/node_modules/semver"), { force: true });
// macOS treats dependency symlinks in an application bundle as unsafe when
// they resolve outside their immediate package directory. Materialize the
// traced runtime so the signed resource tree contains regular files only.
await cp(linkedStudioRoot, studioRoot, { recursive: true, dereference: true });
// A dereferenced pnpm package no longer benefits from Node resolving the
// package through its virtual-store realpath. Recreate the small production
// dependency closure beside the standalone server so runtime resolution stays
// portable without retaining bundle symlinks.
const applicationModules = join(studioRoot, "apps/studio-web/node_modules");
await rm(applicationModules, { recursive: true, force: true });
await mkdir(applicationModules, { recursive: true });
await cp(join(linkedStudioRoot, "node_modules/.pnpm/node_modules"), applicationModules, { recursive: true, dereference: true });
await cp(linkedNextDependencyRoot, applicationModules, { recursive: true, dereference: true });
await rm(linkedStudioRoot, { recursive: true, force: true });
await cp(join(workspaceRoot, "apps/studio-web/.next/static"), join(studioRoot, "apps/studio-web/.next/static"), { recursive: true, dereference: true });
await cp(join(workspaceRoot, "apps/studio-web/public"), join(studioRoot, "apps/studio-web/public"), { recursive: true, dereference: true });
