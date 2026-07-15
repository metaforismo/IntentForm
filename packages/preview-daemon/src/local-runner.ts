import { spawn } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { compileExpo } from "@intentform/compiler-expo";
import { compileReact } from "@intentform/compiler-react";
import { compileSwiftUI } from "@intentform/compiler-swiftui";
import { compileWeb } from "@intentform/compiler-web";
import type { PreviewArtifact } from "./evidence.ts";
import {
  PreviewBuildError,
  PreviewToolchainMissingError,
  type PreviewRunContext,
  type PreviewRunResult,
} from "./supervisor.ts";

const REACT_PACKAGE = {
  name: "intentform-local-react-preview",
  private: true,
  version: "0.0.0",
  type: "module",
} as const;

interface GeneratedFileSet {
  fingerprint: string;
  files: Array<{ path: string; content: string }>;
}

const REACT_TSCONFIG = {
  compilerOptions: {
    target: "ES2022",
    useDefineForClassFields: true,
    lib: ["ES2022", "DOM", "DOM.Iterable"],
    skipLibCheck: true,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    strict: true,
    forceConsistentCasingInFileNames: true,
    module: "ESNext",
    moduleResolution: "Bundler",
    resolveJsonModule: true,
    isolatedModules: true,
    noEmit: true,
    jsx: "react-jsx",
  },
  include: ["src", "vite.config.ts"],
} as const;

function assertContained(base: string, candidate: string): void {
  const path = relative(resolve(base), resolve(candidate));
  if (path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !path.startsWith(sep))) return;
  throw new PreviewBuildError("Generated preview path escaped its build root.");
}

function workspaceRoot(start: string): string {
  let current = resolve(start);
  while (true) {
    if (existsSync(join(/* turbopackIgnore: true */ current, "pnpm-workspace.yaml"))) return current;
    const parent = dirname(current);
    if (parent === current) throw new PreviewToolchainMissingError("IntentForm workspace");
    current = parent;
  }
}

function prepareBuildRoot(context: PreviewRunContext): void {
  const ownedRoot = join(resolve(context.projectDir), "preview-builds");
  mkdirSync(ownedRoot, { recursive: true, mode: 0o700 });
  if (lstatSync(ownedRoot).isSymbolicLink()) throw new PreviewBuildError("Preview build root cannot be a symlink.");
  assertContained(ownedRoot, context.buildRoot);
  const targetRoot = join(ownedRoot, context.binding.target);
  if (!existsSync(targetRoot)) mkdirSync(targetRoot, { mode: 0o700 });
  const targetStat = lstatSync(targetRoot);
  if (!targetStat.isDirectory() || targetStat.isSymbolicLink()) {
    throw new PreviewBuildError("Preview target directory must be a regular directory.");
  }
  if (existsSync(context.buildRoot)) {
    if (lstatSync(context.buildRoot).isSymbolicLink()) throw new PreviewBuildError("Preview build directory cannot be a symlink.");
    rmSync(context.buildRoot, { recursive: true, force: true });
  }
  mkdirSync(context.buildRoot, { recursive: true, mode: 0o700 });
}

function writeGeneratedFiles(root: string, output: GeneratedFileSet): void {
  for (const file of output.files) {
    const target = resolve(root, file.path);
    assertContained(root, target);
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    writeFileSync(target, file.content, { encoding: "utf8", mode: 0o600 });
  }
}

function writeText(root: string, path: string, source: string): void {
  const target = resolve(root, path);
  assertContained(root, target);
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  writeFileSync(target, source, { encoding: "utf8", mode: 0o600 });
}

function linkDependencies(root: string, source: string): void {
  if (!existsSync(source) || !lstatSync(source).isDirectory()) throw new PreviewToolchainMissingError("workspace JavaScript dependencies");
  const target = join(root, "node_modules");
  assertContained(root, target);
  symlinkSync(source, target, "dir");
}

function executable(path: string, toolchain: string): string {
  if (!existsSync(path) || !lstatSync(path).isFile()) throw new PreviewToolchainMissingError(toolchain);
  return path;
}

function childEnvironment(): NodeJS.ProcessEnv {
  const allowed = ["HOME", "PATH", "TMPDIR", "LANG", "LC_ALL", "DEVELOPER_DIR"] as const;
  const environment: NodeJS.ProcessEnv = { CI: "1", EXPO_NO_TELEMETRY: "1", NODE_ENV: "production" };
  for (const key of allowed) {
    if (process.env[key]) environment[key] = process.env[key];
  }
  return environment;
}

async function runCommand(
  context: PreviewRunContext,
  label: string,
  command: string,
  args: readonly string[],
  cwd: string,
): Promise<void> {
  if (context.signal.aborted) throw new PreviewBuildError("Preview cancelled before the local command started.");
  context.log("system", `${label}: ${command} ${args.join(" ")}`);
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, [...args], {
      cwd,
      env: childEnvironment(),
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let settled = false;
    let killTimer: ReturnType<typeof setTimeout> | null = null;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      context.signal.removeEventListener("abort", abort);
      if (killTimer) clearTimeout(killTimer);
      if (error) reject(error);
      else resolvePromise();
    };
    const terminate = (signal: NodeJS.Signals) => {
      if (!child.pid) return;
      try {
        if (process.platform === "win32") child.kill(signal);
        else process.kill(-child.pid, signal);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") context.log("system", `Could not stop ${label}: ${(error as Error).message}`);
      }
    };
    const abort = () => {
      terminate("SIGTERM");
      killTimer = setTimeout(() => terminate("SIGKILL"), 1_500);
    };
    context.signal.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => context.log("stdout", chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => context.log("stderr", chunk.toString("utf8")));
    child.once("error", (error) => finish(new PreviewBuildError(`${label} could not start: ${error.message}`)));
    child.once("exit", (code, signal) => {
      if (context.signal.aborted) return finish(new PreviewBuildError(`${label} was cancelled.`));
      if (code === 0) return finish();
      finish(new PreviewBuildError(`${label} exited with ${signal ? `signal ${signal}` : `code ${code ?? "unknown"}`}.`));
    });
  });
}

function relativeArtifact(projectDir: string, absolutePath: string, kind: PreviewArtifact["kind"]): PreviewArtifact {
  const path = relative(resolve(projectDir), resolve(absolutePath)).split(sep).join("/");
  if (path.startsWith("../") || path === "..") throw new PreviewBuildError("Preview artifact escaped the local project.");
  return { kind, path };
}

function createReactProject(context: PreviewRunContext): GeneratedFileSet {
  const output = compileReact(context.graph);
  writeGeneratedFiles(context.buildRoot, output);
  writeText(context.buildRoot, "package.json", `${JSON.stringify(REACT_PACKAGE, null, 2)}\n`);
  writeText(context.buildRoot, "tsconfig.json", `${JSON.stringify(REACT_TSCONFIG, null, 2)}\n`);
  writeText(context.buildRoot, "index.html", "<!doctype html>\n<html lang=\"en\"><head><meta charset=\"UTF-8\" /><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\" /><title>IntentForm local preview</title></head><body><div id=\"root\"></div><script type=\"module\" src=\"/src/main.tsx\"></script></body></html>\n");
  writeText(context.buildRoot, "vite.config.ts", "import { defineConfig } from \"vite\";\nexport default defineConfig({ base: \"./\", esbuild: { jsx: \"automatic\" }, build: { outDir: \"dist\", emptyOutDir: true } });\n");
  writeText(context.buildRoot, "src/main.tsx", "import { StrictMode } from \"react\";\nimport { createRoot } from \"react-dom/client\";\nimport { GeneratedApp } from \"./generated/App\";\nconst root = document.getElementById(\"root\");\nif (!root) throw new Error(\"Missing application root\");\ncreateRoot(root).render(<StrictMode><GeneratedApp /></StrictMode>);\n");
  return output;
}

async function runBrowser(context: PreviewRunContext, root: string): Promise<PreviewRunResult> {
  const web = context.binding.compilerTarget === "web";
  const output = web ? compileWeb(context.graph) : createReactProject(context);
  if (web) writeGeneratedFiles(context.buildRoot, output);
  if (output.fingerprint !== context.binding.compilerFingerprint) throw new PreviewBuildError("Compiler output changed after the preview binding was created.");
  linkDependencies(context.buildRoot, join(root, web ? "apps/web-preview/node_modules" : "apps/react-preview/node_modules"));
  context.update("building", "generated");
  const tsc = executable(join(root, "node_modules/typescript/bin/tsc"), "TypeScript");
  const vite = executable(join(root, web ? "apps/web-preview/node_modules/vite/bin/vite.js" : "apps/react-preview/node_modules/vite/bin/vite.js"), "Vite");
  await runCommand(context, "TypeScript validation", process.execPath, [tsc, "--noEmit", "-p", "tsconfig.json"], context.buildRoot);
  context.update("building", "validated");
  await runCommand(context, "Browser production build", process.execPath, [vite, "build"], context.buildRoot);
  return { evidence: "built", artifacts: [relativeArtifact(context.projectDir, join(context.buildRoot, "dist"), "bundle")] };
}

async function runExpo(context: PreviewRunContext, root: string): Promise<PreviewRunResult> {
  const output = compileExpo(context.graph);
  if (output.fingerprint !== context.binding.compilerFingerprint) throw new PreviewBuildError("Compiler output changed after the preview binding was created.");
  writeGeneratedFiles(context.buildRoot, output);
  linkDependencies(context.buildRoot, join(root, "apps/expo-preview/node_modules"));
  context.update("building", "generated");
  const tsc = executable(join(root, "apps/expo-preview/node_modules/typescript/bin/tsc"), "TypeScript");
  const expo = executable(join(root, "apps/expo-preview/node_modules/expo/bin/cli"), "Expo");
  await runCommand(context, "Expo TypeScript validation", process.execPath, [tsc, "--noEmit", "-p", "tsconfig.json"], context.buildRoot);
  context.update("building", "validated");
  const platform = context.binding.target === "expo-android" ? "android" : "ios";
  await runCommand(context, `Expo ${platform} export`, process.execPath, [expo, "export", "--platform", platform, "--output-dir", `dist/${platform}`, "--clear"], context.buildRoot);
  return { evidence: "built", artifacts: [relativeArtifact(context.projectDir, join(context.buildRoot, "dist", platform), "bundle")] };
}

async function runSwiftUI(context: PreviewRunContext, root: string): Promise<PreviewRunResult> {
  const output = compileSwiftUI(context.graph);
  if (output.fingerprint !== context.binding.compilerFingerprint) throw new PreviewBuildError("Compiler output changed after the preview binding was created.");
  const sourceRoot = join(context.buildRoot, "Sources/IntentFormPreview");
  writeText(context.buildRoot, "Package.swift", readFileSync(join(root, "examples/preview-ios/Package.swift"), "utf8"));
  writeText(context.buildRoot, "Sources/IntentFormPreview/PreviewRoot.swift", readFileSync(join(root, "examples/preview-ios/Sources/IntentFormPreview/PreviewRoot.swift"), "utf8"));
  writeGeneratedFiles(sourceRoot, output);
  context.update("building", "generated");
  const xcrun = executable("/usr/bin/xcrun", "Xcode");
  await runCommand(context, "SwiftUI simulator build", xcrun, [
    "xcodebuild",
    "-scheme", "IntentFormPreview",
    "-destination", "generic/platform=iOS Simulator",
    "-derivedDataPath", join(context.buildRoot, ".build/xcode"),
    "CODE_SIGNING_ALLOWED=NO",
    "build",
  ], context.buildRoot);
  return { evidence: "built", artifacts: [relativeArtifact(context.projectDir, join(context.buildRoot, ".build/xcode"), "bundle")] };
}

export async function runLocalPreview(context: PreviewRunContext): Promise<PreviewRunResult> {
  prepareBuildRoot(context);
  context.log("system", `Bound to revision ${context.binding.revisionFingerprint}, compiler ${context.binding.compilerFingerprint}, profile ${context.binding.profileId}.`);
  // The project directory may be explicitly located outside the repository
  // (for example, a temporary or user-selected workspace). Toolchains remain
  // resolved from the trusted running IntentForm installation.
  const root = workspaceRoot(process.cwd());
  if (context.binding.target === "browser") return runBrowser(context, root);
  if (context.binding.target === "swiftui") return runSwiftUI(context, root);
  return runExpo(context, root);
}
