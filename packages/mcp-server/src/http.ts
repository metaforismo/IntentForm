import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import {
  StreamableHTTPServerTransport,
  type EventStore,
  type EventId,
  type StreamId,
} from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { isInitializeRequest, type JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { createIntentFormMcpServer, type IntentFormMcpRuntime } from "./index.ts";

const LOOPBACK_ADDRESS = "127.0.0.1";
const DEFAULT_PORT = 47831;
const DEFAULT_SESSION_IDLE_MS = 30 * 60_000;
const MAX_REQUEST_BYTES = 1024 * 1024;
const MAX_SESSIONS = 16;
const MAX_EVENTS = 256;

export interface IntentFormHttpOptions {
  token: string;
  port?: number;
  sessionIdleMs?: number;
}

export interface IntentFormHttpHandle {
  address: string;
  port: number;
  close(): Promise<void>;
}

interface StoredEvent {
  id: EventId;
  streamId: StreamId;
  message: JSONRPCMessage;
}

interface Session {
  id: string;
  runtime: IntentFormMcpRuntime;
  transport: StreamableHTTPServerTransport;
  lastUsedAt: number;
}

export class BoundedEventStore implements EventStore {
  readonly #events: StoredEvent[] = [];

  async storeEvent(streamId: StreamId, message: JSONRPCMessage): Promise<EventId> {
    const id = randomUUID();
    this.#events.push({ id, streamId, message });
    if (this.#events.length > MAX_EVENTS) this.#events.splice(0, this.#events.length - MAX_EVENTS);
    return id;
  }

  async getStreamIdForEventId(eventId: EventId): Promise<StreamId | undefined> {
    return this.#events.find((event) => event.id === eventId)?.streamId;
  }

  async replayEventsAfter(
    lastEventId: EventId,
    { send }: { send: (eventId: EventId, message: JSONRPCMessage) => Promise<void> },
  ): Promise<StreamId> {
    const index = this.#events.findIndex((event) => event.id === lastEventId);
    if (index < 0) throw new Error("The requested resumable MCP event is no longer available.");
    const streamId = this.#events[index]!.streamId;
    for (const event of this.#events.slice(index + 1)) {
      if (event.streamId === streamId) await send(event.id, event.message);
    }
    return streamId;
  }
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

export function isAllowedLocalHost(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  try {
    return isLoopbackHostname(new URL(`http://${hostHeader}`).hostname);
  } catch {
    return false;
  }
}

export function isAllowedLocalOrigin(originHeader: string | undefined): boolean {
  if (!originHeader) return true;
  try {
    const origin = new URL(originHeader);
    return (origin.protocol === "http:" || origin.protocol === "https:") && isLoopbackHostname(origin.hostname);
  } catch {
    return false;
  }
}

function validateToken(token: string): string {
  if (token.length < 32 || token.length > 512) {
    throw new Error("INTENTFORM_MCP_TOKEN must contain between 32 and 512 characters.");
  }
  return token;
}

function tokenMatches(expected: string, authorization: string | undefined): boolean {
  if (!authorization?.startsWith("Bearer ")) return false;
  const actual = authorization.slice("Bearer ".length);
  const expectedDigest = createHash("sha256").update(expected).digest();
  const actualDigest = createHash("sha256").update(actual).digest();
  return timingSafeEqual(expectedDigest, actualDigest);
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(json),
    "cache-control": "no-store",
  });
  res.end(json);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > MAX_REQUEST_BYTES) throw new RangeError("MCP request body exceeds the one MiB limit.");
    chunks.push(buffer);
  }
  if (length === 0) throw new SyntaxError("MCP POST requests require a JSON body.");
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function requestSessionId(req: IncomingMessage): string | undefined {
  const value = req.headers["mcp-session-id"];
  return Array.isArray(value) ? value[0] : value;
}

export async function listenIntentFormHttpServer(options: IntentFormHttpOptions): Promise<IntentFormHttpHandle> {
  const token = validateToken(options.token);
  const port = options.port ?? DEFAULT_PORT;
  const sessionIdleMs = options.sessionIdleMs ?? DEFAULT_SESSION_IDLE_MS;
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new RangeError("MCP HTTP port must be between 0 and 65535.");
  if (!Number.isSafeInteger(sessionIdleMs) || sessionIdleMs < 10_000 || sessionIdleMs > 24 * 60 * 60_000) {
    throw new RangeError("MCP HTTP session idle limit must be between ten seconds and twenty-four hours.");
  }

  const sessions = new Map<string, Session>();
  let closing = false;

  const closeSession = async (sessionId: string) => {
    const session = sessions.get(sessionId);
    if (!session) return;
    sessions.delete(sessionId);
    await session.runtime.close().catch(() => undefined);
  };

  const pruneSessions = async () => {
    const cutoff = Date.now() - sessionIdleMs;
    const expired = [...sessions.values()].filter((session) => session.lastUsedAt <= cutoff);
    await Promise.all(expired.map((session) => closeSession(session.id)));
  };

  const server = createServer(async (req, res) => {
    res.setHeader("cache-control", "no-store");
    res.setHeader("x-content-type-options", "nosniff");

    if (req.url !== "/mcp") {
      writeJson(res, 404, { error: "Not found." });
      return;
    }
    if (!isAllowedLocalHost(req.headers.host) || !isAllowedLocalOrigin(req.headers.origin)) {
      writeJson(res, 403, { error: "Only loopback MCP clients are allowed." });
      return;
    }
    if (req.headers.origin) {
      res.setHeader("access-control-allow-origin", req.headers.origin);
      res.setHeader("vary", "origin");
      res.setHeader("access-control-expose-headers", "mcp-session-id");
    }

    if (req.method === "OPTIONS") {
      if (req.headers.origin) res.setHeader("access-control-allow-origin", req.headers.origin);
      res.setHeader("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
      res.setHeader("access-control-allow-headers", "authorization, content-type, last-event-id, mcp-protocol-version, mcp-session-id");
      res.setHeader("access-control-expose-headers", "mcp-session-id");
      res.writeHead(204);
      res.end();
      return;
    }

    if (!tokenMatches(token, req.headers.authorization)) {
      res.setHeader("www-authenticate", "Bearer realm=\"IntentForm local MCP\"");
      writeJson(res, 401, { error: "Bearer authentication is required." });
      return;
    }
    if (!["GET", "POST", "DELETE"].includes(req.method ?? "")) {
      res.setHeader("allow", "GET, POST, DELETE, OPTIONS");
      writeJson(res, 405, { error: "Method not allowed." });
      return;
    }
    if (req.method === "POST" && req.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
      writeJson(res, 415, { error: "MCP POST requests require application/json." });
      return;
    }

    await pruneSessions();
    const sessionId = requestSessionId(req);
    let session = sessionId ? sessions.get(sessionId) : undefined;

    let pendingRuntime: IntentFormMcpRuntime | undefined;
    try {
      let body: unknown;
      if (req.method === "POST") body = await readJsonBody(req);

      if (!session) {
        if (sessionId || req.method !== "POST" || !isInitializeRequest(body)) {
          writeJson(res, sessionId ? 404 : 400, { error: sessionId ? "Unknown or expired MCP session." : "Initialize an MCP session first." });
          return;
        }
        if (sessions.size >= MAX_SESSIONS) {
          writeJson(res, 503, { error: "The local MCP session capacity is full." });
          return;
        }

        const runtime = createIntentFormMcpServer(`http-pending-${randomUUID()}`);
        pendingRuntime = runtime;
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: randomUUID,
          enableJsonResponse: true,
          eventStore: new BoundedEventStore(),
          retryInterval: 1_000,
          onsessioninitialized: (initializedId) => {
            sessions.set(initializedId, {
              id: initializedId,
              runtime,
              transport,
              lastUsedAt: Date.now(),
            });
          },
          onsessionclosed: closeSession,
        });
        // SDK 1.x declares optional transport callbacks differently under
        // exactOptionalPropertyTypes; the runtime contract is still Transport.
        await runtime.server.connect(transport as unknown as Transport);
        session = { id: "pending", runtime, transport, lastUsedAt: Date.now() };
      }

      session.lastUsedAt = Date.now();
      (req as IncomingMessage & { auth?: AuthInfo }).auth = {
        token: "[authenticated]",
        clientId: `intentform-local-${session.id}`,
        scopes: ["intentform:local"],
      };
      await session.transport.handleRequest(req, res, body);
      pendingRuntime = undefined;
    } catch (error) {
      await pendingRuntime?.close().catch(() => undefined);
      if (res.headersSent) {
        res.end();
        return;
      }
      const status = error instanceof RangeError ? 413 : error instanceof SyntaxError ? 400 : 500;
      writeJson(res, status, { error: status === 500 ? "The local MCP request failed." : error instanceof Error ? error.message : "Invalid request." });
    }
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, LOOPBACK_ADDRESS);
  });

  const address = server.address();
  if (!address || typeof address === "string") throw new Error("IntentForm MCP HTTP did not expose a TCP address.");
  return {
    address: `http://${LOOPBACK_ADDRESS}:${address.port}/mcp`,
    port: address.port,
    async close() {
      if (closing) return;
      closing = true;
      await Promise.all([...sessions.keys()].map(closeSession));
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

async function startFromEnvironment(): Promise<void> {
  const token = process.env.INTENTFORM_MCP_TOKEN;
  if (!token) throw new Error("Set INTENTFORM_MCP_TOKEN to a private random value before starting MCP HTTP.");
  const configuredPort = process.env.INTENTFORM_MCP_PORT;
  const handle = await listenIntentFormHttpServer({
    token,
    ...(configuredPort ? { port: Number(configuredPort) } : {}),
  });
  process.stderr.write(`IntentForm MCP HTTP listening on ${handle.address}.\n`);
  const shutdown = async () => {
    await handle.close();
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startFromEnvironment().catch((error) => {
    const message = error instanceof Error ? error.message : "The local MCP HTTP server failed.";
    process.stderr.write(`IntentForm MCP HTTP failed: ${message}\n`);
    process.exitCode = 1;
  });
}
