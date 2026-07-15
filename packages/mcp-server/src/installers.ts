import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const MCP_CLIENTS = ["codex", "claude", "opencode", "pi"] as const;
export type McpClient = typeof MCP_CLIENTS[number];

export interface McpInstallPlan {
  client: McpClient;
  configPath: string;
  format: "toml" | "json";
  content: string;
}

function jsonConfig(command: string, args: string[], projectDir: string, key = "mcpServers"): string {
  return `${JSON.stringify({ [key]: { intentform: { command, args, env: { INTENTFORM_PROJECT_DIR: projectDir } } } }, null, 2)}\n`;
}

export function createMcpInstallPlan(input: {
  client: McpClient;
  projectDir: string;
  serverEntry: string;
  homeDir?: string;
  command?: string;
}): McpInstallPlan {
  const home = resolve(input.homeDir ?? homedir());
  const projectDir = resolve(input.projectDir);
  const serverEntry = resolve(input.serverEntry);
  const command = resolve(input.command ?? process.execPath);
  const args = ["--import", "tsx", serverEntry];
  if (input.client === "codex") {
    return {
      client: input.client,
      configPath: join(home, ".codex", "config.toml"),
      format: "toml",
      content: `[mcp_servers.intentform]\ncommand = ${JSON.stringify(command)}\nargs = ${JSON.stringify(args)}\n\n[mcp_servers.intentform.env]\nINTENTFORM_PROJECT_DIR = ${JSON.stringify(projectDir)}\n`,
    };
  }
  if (input.client === "claude") {
    return { client: input.client, configPath: join(home, ".claude.json"), format: "json", content: jsonConfig(command, args, projectDir) };
  }
  if (input.client === "opencode") {
    return { client: input.client, configPath: join(home, ".config", "opencode", "opencode.json"), format: "json", content: jsonConfig(command, args, projectDir, "mcp") };
  }
  return { client: input.client, configPath: join(home, ".pi", "agent", "settings.json"), format: "json", content: jsonConfig(command, args, projectDir) };
}
