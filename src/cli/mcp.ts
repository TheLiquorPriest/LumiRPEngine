// The MCP server: JSON-RPC 2.0 over stdio, one message per line (MCP's stdio transport). Calls run
// side by side and each is answered when it is done, one whole line at a time; one world's writes
// still go one by one (KitContext.serialize). The tools come from whichever agent kit the host has
// loaded now (DESIGN §23): when it swaps one in, the client is told the tool list changed. Pure: the
// tool host and the line writer are passed in, so the tests run the whole server in process.

import type { JsonObject, JsonValue } from "../shared/json";
import { hasOwn, isRecord } from "../shared/json";
import type { AgentKit, KitContext } from "./kit-api";
import { CLI_NAME, CLI_VERSION } from "./version";

/** The protocol versions this server speaks, newest first; a client asking for another gets the newest. */
export const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;

// Short and stable: the core sends it once, and it never follows the extension's updates, so the
// guidance itself is lre_guide's, which does.
const WORKFLOW = `Tools for LumiRPEngine (LRE) worlds on the user's Lumiverse: the persistent world simulations their roleplay chats play. Read lre_guide before anything else: the world model, how to work on a world, and the mistakes that are easy to make; look kinds, fields, effects and formulas up with lre_docs. The draft is the user's Build draft: if one is stored before you start, ask them before you touch it. Commit or discard every draft you start; never leave one lying around. These tools follow the LumiRPEngine installed on the user's Lumiverse: when it updates, the tool list changes, and lre_guide says what is new.`;

export function instructions(readOnly: boolean): string {
  return readOnly ? `${WORKFLOW}\n\nThis server is read-only: it offers no tool that changes worlds or chats.` : WORKFLOW;
}

/** Where the server's tools come from: the kit loaded now, and what each call runs with. */
export interface ToolHost {
  readonly readOnly: boolean;
  kit(): AgentKit;
  /** Waited for before each call: a session checks there whether LumiRPEngine's kit moved on. */
  ready(): Promise<void>;
  /** The client's `initialize`: the harness that runs this server (its clientInfo.name), or null when it gave none. */
  initialized?(harness: string | null): void;
  readonly context: KitContext;
}

type Id = string | number | null;

export interface RpcReply {
  jsonrpc: "2.0";
  id: Id;
  result?: JsonValue;
  error?: { code: number; message: string };
}

const fail = (id: Id, code: number, message: string): RpcReply => ({ jsonrpc: "2.0", id, error: { code, message } });

export class McpServer {
  constructor(private readonly host: ToolHost) {}

  /** One message (or a batch) in, its reply out; null when nothing answers it (a notification, a client's reply). */
  async handle(message: unknown): Promise<RpcReply | RpcReply[] | null> {
    if (!Array.isArray(message)) return this.one(message);
    if (message.length === 0) return fail(null, -32600, "Invalid Request: an empty batch");
    const replies = (await Promise.all(message.map((m) => this.one(m)))).filter((r): r is RpcReply => r !== null);
    return replies.length > 0 ? replies : null;
  }

  private async one(message: unknown): Promise<RpcReply | null> {
    if (!isRecord(message)) return fail(null, -32600, "Invalid Request: not a JSON-RPC message");
    const hasId = hasOwn(message, "id");
    const raw = message.id;
    const id: Id = typeof raw === "string" || typeof raw === "number" ? raw : null;
    if (hasId && raw !== null && id === null) return fail(null, -32600, "Invalid Request: id must be a string or a number");
    // A reply to a request of ours: this server sends none, so there is nothing to match it to.
    if (typeof message.method !== "string") return hasId && (hasOwn(message, "result") || hasOwn(message, "error")) ? null : fail(id, -32600, "Invalid Request: no method");
    if (message.jsonrpc !== "2.0") return hasId ? fail(id, -32600, 'Invalid Request: jsonrpc must be "2.0"') : null;
    // Notifications (notifications/initialized, notifications/cancelled…) get no answer, whatever they are.
    if (!hasId) return null;
    // MCP, unlike plain JSON-RPC, never allows a null request id.
    if (raw === null) return fail(null, -32600, "Invalid Request: an MCP request's id is a string or a number, never null");
    const params = isRecord(message.params) ? message.params : {};
    const reply = (result: JsonValue): RpcReply => ({ jsonrpc: "2.0", id, result });
    try {
      switch (message.method) {
        case "initialize": {
          const protocolVersion = PROTOCOL_VERSIONS.find((v) => v === params.protocolVersion) ?? PROTOCOL_VERSIONS[0];
          this.host.initialized?.(isRecord(params.clientInfo) && typeof params.clientInfo.name === "string" ? params.clientInfo.name : null);
          return reply({ protocolVersion, capabilities: { tools: { listChanged: true } }, serverInfo: { name: CLI_NAME, version: CLI_VERSION }, instructions: instructions(this.host.readOnly) });
        }
        case "ping":
          return reply({});
        case "tools/list":
          return reply({ tools: this.host.kit().tools(this.host.readOnly).map((t): JsonObject => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations })) });
        case "tools/call": {
          if (typeof params.name !== "string") return fail(id, -32602, "Invalid params: tools/call needs the tool's name");
          await this.host.ready();
          const kit = this.host.kit();
          // An unknown tool is a protocol error (MCP's "Unknown tools"); a known one that refuses answers isError.
          if (!kit.has(params.name)) return fail(id, -32602, `Unknown tool: ${params.name}`);
          const result = await kit.call(params.name, params.arguments, this.host.context);
          return reply({ content: [{ type: "text", text: result.text }], ...(result.isError ? { isError: true } : {}) });
        }
      }
      return fail(id, -32601, `Method not found: ${message.method}`);
    } catch (error) {
      return fail(id, -32603, `Internal error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export interface LineServer {
  /** Takes text as it arrives; a line that isn't complete yet waits for the rest. */
  feed(chunk: string): void;
  /** Resolves once every message fed so far is answered and written. */
  drain(): Promise<void>;
  /** Sends a notification (`notifications/tools/list_changed`), in turn with the replies; none before the client's initialize is answered. */
  notify(method: string): void;
}

/**
 * The stdio side: each complete line is one message, handled as soon as it arrives, and each reply
 * is written as one line in the order replies are ready, never two at once.
 */
export function lineServer(server: McpServer, write: (line: string) => Promise<void> | void): LineServer {
  let buffer = "";
  let output: Promise<void> = Promise.resolve();
  let initialized = false;
  const working = new Set<Promise<void>>();
  const send = (message: RpcReply | RpcReply[] | JsonObject): Promise<void> => {
    // A client that went away can't be answered; the replies after it still try.
    output = output.then(() => write(JSON.stringify(message))).catch(() => undefined);
    return output;
  };
  const take = (line: string): void => {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      void send(fail(null, -32700, "Parse error"));
      return;
    }
    const job: Promise<void> = server.handle(message).then((reply) => {
      if (reply === null) return;
      const sent = send(reply);
      // Queued behind the initialize answer, a notification never reaches the client before it.
      if (isRecord(message) && message.method === "initialize") initialized = true;
      return sent;
    });
    working.add(job);
    void job.finally(() => working.delete(job));
  };
  return {
    feed(chunk) {
      buffer += chunk;
      for (let nl = buffer.indexOf("\n"); nl >= 0; nl = buffer.indexOf("\n")) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line !== "") take(line);
      }
    },
    async drain() {
      while (working.size > 0) await Promise.all([...working]);
      await output;
    },
    notify(method) {
      if (initialized) void send({ jsonrpc: "2.0", method });
    },
  };
}
