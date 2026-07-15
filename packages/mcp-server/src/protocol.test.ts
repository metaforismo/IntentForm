import { mkdtempSync, rmSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  CallToolResultSchema,
  ResourceUpdatedNotificationSchema,
  type JSONRPCMessage,
} from "@modelcontextprotocol/sdk/types.js";
import {
  BoundedEventStore,
  isAllowedLocalHost,
  isAllowedLocalOrigin,
  listenIntentFormHttpServer,
  type IntentFormHttpHandle,
} from "./http.ts";
import { PROTOCOL_VERSION, availableToolDefinitions } from "./index.ts";

const ROOT = join(import.meta.dirname, "../../..");
const SERVER_ENTRY = join(import.meta.dirname, "index.ts");
const TOKEN = "intentform-test-token-0123456789-abcdef";
let dir: string;
let httpHandle: IntentFormHttpHandle | undefined;

function protocolClient() {
  return new Client(
    { name: "intentform-conformance-test", version: "1.0.0" },
    { capabilities: { tasks: { requests: { tools: { call: {} } } } } },
  );
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "intentform-protocol-"));
  process.env.INTENTFORM_MCP_PERMISSION = "write";
});

afterEach(async () => {
  await httpHandle?.close();
  httpHandle = undefined;
  rmSync(dir, { recursive: true, force: true });
  delete process.env.INTENTFORM_MCP_PERMISSION;
});

describe("MCP 2025-11-25 protocol surface", () => {
  it("defaults new clients to a read-only semantic surface", () => {
    const names = availableToolDefinitions("read-only").map((tool) => tool.name);
    expect(names).toContain("intentform_describe_project");
    expect(names).toContain("intentform_preview_patch");
    expect(names).toContain("intentform_preview_transaction");
    expect(names).not.toContain("intentform_apply_patch");
    expect(names).not.toContain("intentform_commit_transaction");
    expect(availableToolDefinitions("write")).toHaveLength(46);
  });
  it("negotiates the official SDK over stdio with resources, schemas and structured output", async () => {
    const client = protocolClient();
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", SERVER_ENTRY],
      cwd: ROOT,
      env: { ...getDefaultEnvironment(), INTENTFORM_PROJECT_DIR: dir, INTENTFORM_MCP_PERMISSION: "write" },
      stderr: "pipe",
    });

    try {
      await client.connect(transport as unknown as Transport);
      expect(client.getServerVersion()).toMatchObject({ name: "intentform", version: "0.1.0" });
      expect(client.getServerCapabilities()).toMatchObject({
        tools: { listChanged: false },
        resources: { subscribe: true, listChanged: false },
        tasks: { list: {}, cancel: {}, requests: { tools: { call: {} } } },
      });

      const tools = await client.listTools();
      expect(tools.tools).toHaveLength(46);
      expect(tools.tools.find((tool) => tool.name === "intentform_describe_project")).toMatchObject({
        outputSchema: { type: "object", required: ["result", "scope"] },
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
        execution: { taskSupport: "forbidden" },
      });
      expect(tools.tools.find((tool) => tool.name === "intentform_run_preview")?.execution)
        .toEqual({ taskSupport: "optional" });

      const resources = await client.listResources();
      expect(resources.resources.map((resource) => resource.uri)).toEqual([
        "intentform://project/summary",
        "intentform://project/graph",
        "intentform://project/scope",
        "intentform://project/tokens",
        "intentform://project/components",
        "intentform://project/screens",
        "intentform://project/diagnostics",
        "intentform://project/capabilities",
        "intentform://project/revisions",
        "intentform://project/history",
        "intentform://project/accessibility",
        "intentform://project/previews",
        "intentform://project/ecosystem",
        "intentform://agent/activity",
        "intentform://device-profiles",
        "intentform://device-bezel-packs",
      ]);

      const resourceUpdates: string[] = [];
      client.setNotificationHandler(ResourceUpdatedNotificationSchema, (notification) => {
        resourceUpdates.push(notification.params.uri);
      });
      await client.subscribeResource({ uri: "intentform://agent/activity" });
      await client.subscribeResource({ uri: "intentform://project/graph" });
      await client.subscribeResource({ uri: "intentform://project/history" });
      const described = await client.callTool({ name: "intentform_describe_project", arguments: {} });
      expect(described.isError).not.toBe(true);
      expect(described.structuredContent).toMatchObject({
        result: { product: { name: "Verdant Pay" }, screens: expect.any(Array) },
      });
      expect(JSON.stringify(described.content)).toContain("Verdant Pay");
      expect(resourceUpdates).toContain("intentform://agent/activity");

      const baseFingerprint = (described.structuredContent as { result: { fingerprint: string } }).result.fingerprint;
      const begun = await client.callTool({
        name: "intentform_begin_transaction",
        arguments: { expectedFingerprint: baseFingerprint, rationale: "Protocol transaction conformance" },
      });
      const transactionId = (begun.structuredContent as { result: { transactionId: string } }).result.transactionId;
      const previewed = await client.callTool({
        name: "intentform_preview_transaction",
        arguments: {
          transactionId,
          patch: {
            id: "protocol.transaction",
            rationale: "Verify exact SDK transaction commit",
            operations: [{ op: "set-label", target: "payment-request.confirm", label: "Protocol verified" }],
          },
        },
      });
      const previewFingerprint = (previewed.structuredContent as { result: { previewFingerprint: string } }).result.previewFingerprint;
      const committed = await client.callTool({
        name: "intentform_commit_transaction",
        arguments: { transactionId },
      });
      expect(committed.structuredContent).toMatchObject({
        result: { status: "committed", previewFingerprint, committed: { fingerprint: previewFingerprint } },
      });
      expect(resourceUpdates).toContain("intentform://project/graph");

      const branchCreated = await client.callTool({
        name: "intentform_create_branch",
        arguments: { name: "wire-copy" },
      });
      expect(branchCreated.isError).not.toBe(true);
      const branchPatched = await client.callTool({
        name: "intentform_apply_branch_patch",
        arguments: {
          name: "wire-copy",
          expectedFingerprint: previewFingerprint,
          patch: {
            id: "wire.branch",
            rationale: "Verify branch protocol surface",
            operations: [{ op: "set-label", target: "payment-request.confirm", label: "Wire branch" }],
          },
        },
      });
      expect(branchPatched.structuredContent).toMatchObject({ result: { operation: { kind: "branch-edit" } } });
      const branchPreview = await client.callTool({
        name: "intentform_preview_branch_merge",
        arguments: { name: "wire-copy" },
      });
      expect(branchPreview.structuredContent).toMatchObject({ result: { conflicts: [], currentFingerprint: previewFingerprint } });
      const history = await client.readResource({ uri: "intentform://project/history" });
      expect(history.contents[0]).toMatchObject({ text: expect.stringContaining('"name": "wire-copy"') });
      expect(resourceUpdates).toContain("intentform://project/history");

      const accessibility = await client.callTool({
        name: "intentform_audit_accessibility",
        arguments: { target: "react" },
      });
      expect(accessibility.structuredContent).toMatchObject({
        result: {
          ruleset: { standard: "WCAG 2.2 AA", version: "1.0.0" },
          passed: false,
          findings: expect.arrayContaining([expect.objectContaining({ ruleId: "label-in-name", status: "open" })]),
        },
      });
      const accessibilityResource = await client.readResource({ uri: "intentform://project/accessibility" });
      expect(accessibilityResource.contents[0]).toMatchObject({ text: expect.stringContaining('"long-text"') });

      const graph = await client.readResource({ uri: "intentform://project/graph" });
      expect(graph.contents[0]).toMatchObject({
        uri: "intentform://project/graph",
        mimeType: "application/json",
        text: expect.stringContaining('"schemaVersion": "0.8.0"'),
      });
      await expect(client.callTool({ name: "intentform_verify", arguments: { scenario: "wide" } }))
        .rejects.toThrow(/invalid.*arguments/i);

      const taskMessages: string[] = [];
      const progressMessages: string[] = [];
      let taskId: string | undefined;
      for await (const message of client.experimental.tasks.callToolStream(
        {
          name: "intentform_run_preview",
          arguments: { target: "browser", expectedFingerprint: "00000000" },
        },
        undefined,
        {
          task: { ttl: 30_000 },
          timeout: 10_000,
          onprogress: (progress) => { if (progress.message) progressMessages.push(progress.message); },
        },
      )) {
        taskMessages.push(message.type);
        if (message.type === "taskCreated") taskId = message.task.taskId;
      }
      expect(taskMessages).toContain("taskCreated");
      expect(taskMessages).toContain("taskStatus");
      expect(taskMessages.at(-1)).toBe("error");
      expect(progressMessages).toContain("Starting fingerprint-bound local preview.");
      expect(taskId).toBeDefined();
      expect(await client.experimental.tasks.getTask(taskId!)).toMatchObject({ status: "failed" });
      expect(await client.experimental.tasks.getTaskResult(taskId!, CallToolResultSchema)).toMatchObject({ isError: true });

      const projectFingerprint = previewFingerprint;
      const cancellationMessages: string[] = [];
      let cancelledTaskId: string | undefined;
      for await (const message of client.experimental.tasks.callToolStream(
        {
          name: "intentform_run_preview",
          arguments: { target: "browser", expectedFingerprint: projectFingerprint, restart: true },
        },
        undefined,
        { task: { ttl: 30_000 }, timeout: 10_000 },
      )) {
        cancellationMessages.push(message.type);
        if (message.type === "taskCreated") {
          cancelledTaskId = message.task.taskId;
          await client.experimental.tasks.cancelTask(cancelledTaskId);
        }
      }
      expect(cancellationMessages).toContain("taskCreated");
      expect(cancellationMessages.at(-1)).toBe("error");
      expect(await client.experimental.tasks.getTask(cancelledTaskId!)).toMatchObject({ status: "cancelled" });
      let cancelledPreview = "";
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const status = await client.callTool({ name: "intentform_preview_status", arguments: {} });
        cancelledPreview = JSON.stringify(status.structuredContent);
        if (cancelledPreview.includes('"phase":"cancelled"')) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(cancelledPreview).toContain('"phase":"cancelled"');

      const forbiddenTaskMessages: string[] = [];
      for await (const message of client.experimental.tasks.callToolStream(
        { name: "intentform_describe_project", arguments: {} },
        undefined,
        { task: {}, timeout: 5_000 },
      )) forbiddenTaskMessages.push(message.type);
      expect(forbiddenTaskMessages.at(-1)).toBe("error");
      await client.unsubscribeResource({ uri: "intentform://project/graph" });
      await client.unsubscribeResource({ uri: "intentform://project/history" });
      await client.unsubscribeResource({ uri: "intentform://agent/activity" });
    } finally {
      await client.close();
    }
  }, 20_000);

  it("serves authenticated loopback Streamable HTTP through the official SDK", async () => {
    httpHandle = await listenIntentFormHttpServer({ token: TOKEN, port: 0 });
    const client = protocolClient();
    const transport = new StreamableHTTPClientTransport(new URL(httpHandle.address), {
      requestInit: { headers: { authorization: `Bearer ${TOKEN}` } },
    });

    try {
      await client.connect(transport as unknown as Transport);
      expect(transport.protocolVersion).toBe(PROTOCOL_VERSION);
      expect(transport.sessionId).toMatch(/^[a-f0-9-]{36}$/);
      expect((await client.listTools()).tools).toHaveLength(46);
      expect((await client.listResources()).resources).toHaveLength(16);
      await client.ping();
      await transport.terminateSession();
    } finally {
      await client.close();
    }
  }, 20_000);

  it("rejects unauthenticated, non-loopback, oversized and session-invalid HTTP requests", async () => {
    httpHandle = await listenIntentFormHttpServer({ token: TOKEN, port: 0 });
    const initialize = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "negative-test", version: "1.0.0" },
      },
    };
    const headers = {
      authorization: `Bearer ${TOKEN}`,
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    };

    expect((await fetch(httpHandle.address, { method: "POST", body: JSON.stringify(initialize) })).status).toBe(401);
    expect((await fetch(httpHandle.address, {
      method: "POST",
      headers: { ...headers, authorization: "Bearer wrong-token-wrong-token-wrong-token" },
      body: JSON.stringify(initialize),
    })).status).toBe(401);
    expect((await fetch(httpHandle.address, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(initialize),
    })).status).toBe(415);
    expect((await fetch(httpHandle.address, {
      method: "POST",
      headers: { ...headers, origin: "https://attacker.example" },
      body: JSON.stringify(initialize),
    })).status).toBe(403);
    expect(await rawHttpStatus(
      httpHandle.address,
      { method: "POST", headers: { ...headers, host: "attacker.example" } },
      JSON.stringify(initialize),
    )).toBe(403);
    expect((await fetch(httpHandle.address, { method: "OPTIONS", headers: { origin: "http://localhost:3000" } })).status).toBe(204);
    expect((await fetch(httpHandle.address.replace("/mcp", "/missing"), { headers })).status).toBe(404);
    expect((await fetch(httpHandle.address, { method: "PUT", headers, body: "{}" })).status).toBe(405);
    expect((await fetch(httpHandle.address, {
      method: "POST",
      headers: { ...headers, "mcp-session-id": randomSessionId() },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" }),
    })).status).toBe(404);
    expect((await fetch(httpHandle.address, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "ping" }),
    })).status).toBe(400);
    expect((await fetch(httpHandle.address, { method: "POST", headers, body: "{" })).status).toBe(400);
    expect((await fetch(httpHandle.address, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...initialize, padding: "x".repeat(1024 * 1024) }),
    })).status).toBe(413);
  }, 20_000);

  it("accepts only loopback Host and Origin values", () => {
    expect(isAllowedLocalHost("127.0.0.1:47831")).toBe(true);
    expect(isAllowedLocalHost("localhost:47831")).toBe(true);
    expect(isAllowedLocalHost("[::1]:47831")).toBe(true);
    expect(isAllowedLocalHost("intentform.example:47831")).toBe(false);
    expect(isAllowedLocalHost(undefined)).toBe(false);
    expect(isAllowedLocalOrigin(undefined)).toBe(true);
    expect(isAllowedLocalOrigin("http://localhost:3000")).toBe(true);
    expect(isAllowedLocalOrigin("https://127.0.0.1:3000")).toBe(true);
    expect(isAllowedLocalOrigin("https://intentform.example")).toBe(false);
    expect(isAllowedLocalOrigin("not a URL")).toBe(false);
  });

  it("fails closed on invalid HTTP transport configuration before binding", async () => {
    await expect(listenIntentFormHttpServer({ token: "too-short", port: 0 })).rejects.toThrow(/32 and 512/i);
    await expect(listenIntentFormHttpServer({ token: "x".repeat(513), port: 0 })).rejects.toThrow(/32 and 512/i);
    await expect(listenIntentFormHttpServer({ token: TOKEN, port: -1 })).rejects.toThrow(/port/i);
    await expect(listenIntentFormHttpServer({ token: TOKEN, port: Number.NaN })).rejects.toThrow(/port/i);
    await expect(listenIntentFormHttpServer({ token: TOKEN, port: 0, sessionIdleMs: 9_999 })).rejects.toThrow(/idle limit/i);
  });

  it("bounds resumable events and replays only the matching stream", async () => {
    const store = new BoundedEventStore();
    const first = await store.storeEvent("stream-a", { jsonrpc: "2.0", method: "notifications/message" });
    await store.storeEvent("stream-b", { jsonrpc: "2.0", method: "notifications/cancelled" });
    const last = await store.storeEvent("stream-a", { jsonrpc: "2.0", id: 1, result: {} });
    const replayed: Array<{ id: string; message: JSONRPCMessage }> = [];

    expect(await store.getStreamIdForEventId(first)).toBe("stream-a");
    expect(await store.replayEventsAfter(first, {
      send: async (id, message) => { replayed.push({ id, message }); },
    })).toBe("stream-a");
    expect(replayed).toEqual([{ id: last, message: { jsonrpc: "2.0", id: 1, result: {} } }]);
    for (let index = 0; index < 254; index += 1) {
      await store.storeEvent("stream-c", { jsonrpc: "2.0", id: index + 2, result: {} });
    }
    expect(await store.getStreamIdForEventId(first)).toBeUndefined();
    await expect(store.replayEventsAfter("missing", { send: async () => undefined })).rejects.toThrow(/no longer available/i);
  });
});

function randomSessionId(): string {
  return "00000000-0000-4000-8000-000000000000";
}

function rawHttpStatus(url: string, options: Parameters<typeof httpRequest>[1], body?: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, options, (response) => {
      response.resume();
      response.once("end", () => resolve(response.statusCode ?? 0));
    });
    request.once("error", reject);
    if (body) request.write(body);
    request.end();
  });
}
