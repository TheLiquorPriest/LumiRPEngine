// The MCP server: JSON-RPC 2.0 over stdio, one message per line (MCP's stdio transport). Calls run
// side by side and each is answered when it is done, one whole line at a time; one world's writes
// still go one by one (ToolContext.serialize). Pure: the tool context and the line writer are passed
// in, so the tests run the whole server in process.

import type { JsonObject, JsonValue } from "../shared/json";
import { hasOwn, isRecord } from "../shared/json";
import type { ToolContext } from "./tools";
import { annotationsOf, callTool, findTool, toolsFor } from "./tools";
import { CLI_NAME, CLI_VERSION } from "./version";

/** The protocol versions this server speaks, newest first; a client asking for another gets the newest. */
export const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;

const WORKFLOW = `Tools for LumiRPEngine (LRE) worlds on the user's Lumiverse: the persistent world simulations their roleplay chats play.

Work like this:
1. Read lre_guide first: the world model, and the mistakes that are easy to make. Look kinds, fields, effects and formulas up with lre_docs.
2. Find the world: lre_worlds, lre_search, then lre_world to read it at a JSON Pointer.
3. Change its draft with lre_edit (JSON Patch), passing expectVersion from your last read.
4. Check it: lre_draft gives its lint and what it changes against the head; lre_playtest and lre_check_world run it.
5. Commit it with lre_commit and a short note, or drop it with lre_discard.

The draft is the user's Build draft: they see your changes as you make them, and you see theirs, and a Commit in Build commits your unfinished work as yours commits theirs. If lre_worlds shows a draft already stored before you start, it is the user's: ask them before you touch it. Commit or discard every draft you start; never leave one lying around. Deleting a world (lre_world_delete) takes its exact name as confirm. The offline tools (lre_guide, lre_docs, lre_schema, lre_templates, lre_template, lre_check, lre_playtest and lre_check_world on a file) need no sign-in.

Money and minds: accounts, cards, flows (standing payments and income), jobs, businesses, invoices, holdings, properties, trusts and households are entities, told apart by kind (lre_search takes kinds); an account or a business names its holders in fields.owners with their roles, not fields.owner. A business runs at its own tier's Money level. A world's own account products, assets and tax settings sit in packs.economy.config, and its character-minds settings (secrecy, the focus ladder, pins, memory) in its minds part. lre_guide's sections "Money", "Holdings and property" and "Character minds" show each with a patch to copy. Playtest and Check world call no model, so no mind runs there.`;

export function instructions(readOnly: boolean): string {
  return readOnly ? `${WORKFLOW}\n\nThis server is read-only: it offers no tool that changes worlds or chats.` : WORKFLOW;
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
  constructor(private readonly ctx: ToolContext) {}

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
          return reply({ protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: { name: CLI_NAME, version: CLI_VERSION }, instructions: instructions(this.ctx.readOnly) });
        }
        case "ping":
          return reply({});
        case "tools/list":
          return reply({ tools: toolsFor(this.ctx.readOnly).map((t): JsonObject => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: annotationsOf(t) })) });
        case "tools/call": {
          if (typeof params.name !== "string") return fail(id, -32602, "Invalid params: tools/call needs the tool's name");
          // An unknown tool is a protocol error (MCP's "Unknown tools"); a known one that refuses answers isError.
          if (findTool(params.name) === undefined) return fail(id, -32602, `Unknown tool: ${params.name}`);
          const result = await callTool(params.name, params.arguments, this.ctx);
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
}

/**
 * The stdio side: each complete line is one message, handled as soon as it arrives, and each reply
 * is written as one line in the order replies are ready, never two at once.
 */
export function lineServer(server: McpServer, write: (line: string) => Promise<void> | void): LineServer {
  let buffer = "";
  let output: Promise<void> = Promise.resolve();
  const working = new Set<Promise<void>>();
  const send = (reply: RpcReply | RpcReply[]): Promise<void> => {
    // A client that went away can't be answered; the replies after it still try.
    output = output.then(() => write(JSON.stringify(reply))).catch(() => undefined);
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
    const job: Promise<void> = server.handle(message).then((reply) => (reply === null ? undefined : send(reply)));
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
  };
}
