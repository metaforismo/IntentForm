import { listenIntentFormHttpServer } from "@intentform/mcp-server/http";

async function main(): Promise<void> {
  const parentPort = process.parentPort;
  if (!parentPort) throw new Error("The desktop MCP service requires an Electron utility-process parent.");
  const token = process.env.INTENTFORM_MCP_TOKEN;
  if (!token) throw new Error("The desktop MCP service requires a private bearer token.");
  const handle = await listenIntentFormHttpServer({ token, port: 0 });
  parentPort.postMessage({ type: "ready", address: handle.address });
  const shutdown = async () => {
    await handle.close();
    process.exit(0);
  };
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "The desktop MCP service failed."}\n`);
  process.exitCode = 1;
});
