import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { MCP_CLIENTS, createMcpInstallPlan, type McpClient } from "../packages/mcp-server/src/installers.ts";

const valueAfter = (flag: string) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const clientValue = valueAfter("--client");
if (!MCP_CLIENTS.includes(clientValue as McpClient)) throw new Error(`Use --client ${MCP_CLIENTS.join("|")}`);
const projectDir = resolve(valueAfter("--project") ?? process.cwd());
const plan = createMcpInstallPlan({ client: clientValue as McpClient, projectDir, serverEntry: resolve("packages/mcp-server/src/index.ts") });
const printable = `Client: ${plan.client}\nConfig: ${plan.configPath}\nPermission: read-only (set INTENTFORM_MCP_PERMISSION=write explicitly to enable commits)\n\n${plan.content}`;

if (!process.argv.includes("--apply")) {
  stdout.write(printable);
  process.exit(0);
}

let exists = false;
try { await access(plan.configPath); exists = true; } catch { exists = false; }
if (exists && !process.argv.includes("--yes")) {
  const prompt = createInterface({ input: stdin, output: stdout });
  const answer = await prompt.question(`Back up and replace ${plan.configPath}? Type yes to continue: `);
  prompt.close();
  if (answer.trim().toLowerCase() !== "yes") throw new Error("Installation cancelled; existing configuration was not changed.");
}
await mkdir(dirname(plan.configPath), { recursive: true });
if (exists) {
  await readFile(plan.configPath, "utf8");
  await copyFile(plan.configPath, `${plan.configPath}.intentform-backup-${new Date().toISOString().replace(/[:.]/g, "-")}`);
}
await writeFile(plan.configPath, plan.content, { encoding: "utf8", flag: exists ? "w" : "wx", mode: 0o600 });
stdout.write(`Installed the read-only IntentForm MCP configuration for ${plan.client}.\n`);
