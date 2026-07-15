import { describe, expect, it } from "vitest";
import { MCP_CLIENTS, createMcpInstallPlan } from "./installers.ts";

describe("MCP client installer plans", () => {
  it.each(MCP_CLIENTS)("prints an absolute, read-only-by-default %s plan", (client) => {
    const plan = createMcpInstallPlan({ client, projectDir: "/tmp/intentform-project", serverEntry: "/tmp/intentform/server.ts", homeDir: "/tmp/home", command: "/usr/bin/node" });
    expect(plan.configPath.startsWith("/tmp/home/") || plan.configPath === "/tmp/home/.claude.json").toBe(true);
    expect(plan.content).toContain("/tmp/intentform-project");
    expect(plan.content).toContain("/tmp/intentform/server.ts");
    expect(plan.content).not.toContain("INTENTFORM_MCP_PERMISSION");
    if (plan.format === "json") expect(() => JSON.parse(plan.content)).not.toThrow();
  });
});
