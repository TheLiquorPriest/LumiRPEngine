// The MCP server end to end in process: JSON-RPC lines in, lines out, over a fake Lumiverse. The
// lifecycle a client runs (initialize, notifications, tools/list, tools/call), what it gets for
// anything malformed, and calls in flight side by side.

import { describe, expect, test } from "bun:test";
import { isRecord } from "../../src/shared/json";
import { kit } from "../../src/cli/agent-kit";
import type { KitContext } from "../../src/cli/kit-api";
import type { RpcReply } from "../../src/cli/mcp";
import { lineServer, McpServer, PROTOCOL_VERSIONS } from "../../src/cli/mcp";
import { KeyedQueue, TOOLS } from "../../src/cli/tools";
import { client, FakeLumiverse } from "./fake-lumiverse";

function serve(fake: FakeLumiverse, readOnly = false): { feed(text: string): void; replies(): Promise<RpcReply[]> } {
  const lines: string[] = [];
  const { conn } = client(fake, { readOnly });
  const queue = new KeyedQueue();
  const context: KitContext = { readFile: () => "", readOnly, connection: () => conn, serialize: (key, work) => queue.run(key, work) };
  const server = lineServer(new McpServer({ readOnly, kit: () => kit, ready: async () => undefined, context }), (line) => {
    lines.push(line);
  });
  return {
    feed: (text) => server.feed(text),
    replies: async () => {
      await server.drain();
      return lines.map((l) => JSON.parse(l) as RpcReply);
    },
  };
}

const rpc = (id: number | string | null, method: string, params?: unknown): string => `${JSON.stringify({ jsonrpc: "2.0", ...(id !== null ? { id } : {}), method, ...(params !== undefined ? { params } : {}) })}\n`;
const resultOf = (replies: RpcReply[], id: number | string): Record<string, unknown> => {
  const reply = replies.find((r) => r.id === id);
  if (!reply || !isRecord(reply.result)) throw new Error(`no result for ${String(id)}: ${JSON.stringify(reply)}`);
  return reply.result;
};
const textOf = (result: Record<string, unknown>): string => {
  const content = result.content;
  const first = Array.isArray(content) ? content[0] : undefined;
  return isRecord(first) && typeof first.text === "string" ? first.text : "";
};

describe("the MCP server", () => {
  test("initialize answers a version it speaks with that version, any other with the newest, and says how to work", async () => {
    const s = serve(new FakeLumiverse());
    s.feed(rpc(1, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } }));
    s.feed(rpc(2, "initialize", { protocolVersion: "1999-01-01" }));
    s.feed(rpc(null, "notifications/initialized"));
    s.feed(rpc(3, "ping"));
    const replies = await s.replies();
    expect(replies).toHaveLength(3);
    expect(resultOf(replies, 1)).toMatchObject({ protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "lumirpengine" } });
    expect(resultOf(replies, 2).protocolVersion).toBe(PROTOCOL_VERSIONS[0]);
    expect(String(resultOf(replies, 1).instructions)).toContain("never leave one lying around");
    expect(resultOf(replies, 3)).toEqual({});
  });

  test("tools/list offers every tool, and none that writes when read-only; a hidden one is refused, not run", async () => {
    const fake = new FakeLumiverse();
    const w = fake.lre.seed("Alpha");
    const full = serve(fake);
    full.feed(rpc(1, "tools/list"));
    const all = (resultOf(await full.replies(), 1).tools as { name: string }[]).map((t) => t.name);
    expect(all).toEqual(TOOLS.map((t) => t.name));
    const ro = serve(fake, true);
    ro.feed(rpc(1, "tools/list"));
    ro.feed(rpc(2, "tools/call", { name: "lre_world_delete", arguments: { worldId: w.index.id, confirm: "Alpha" } }));
    const replies = await ro.replies();
    const listed = (resultOf(replies, 1).tools as { name: string }[]).map((t) => t.name);
    expect(listed).toEqual(TOOLS.filter((t) => !t.write).map((t) => t.name));
    expect(listed).not.toContain("lre_edit");
    expect(resultOf(replies, 2).isError).toBe(true);
    expect(textOf(resultOf(replies, 2))).toContain("read-only");
    expect([...fake.lre.worlds.keys()]).toContain(w.index.id);
  });

  test("a tool call answers text; a refusal is a tool error; an unknown method and a nameless call are protocol errors", async () => {
    const s = serve(new FakeLumiverse());
    s.feed(rpc(1, "tools/call", { name: "lre_templates", arguments: {} }));
    s.feed(rpc(2, "tools/call", { name: "lre_template", arguments: { id: "no_such_starter" } }));
    s.feed(rpc(3, "resources/list"));
    s.feed(rpc(4, "tools/call", { arguments: {} }));
    s.feed(rpc(5, "tools/call", { name: "lre_guide", arguments: { topik: "tracks" } }));
    const replies = await s.replies();
    expect(JSON.parse(textOf(resultOf(replies, 1))).templates.map((t: { id: string }) => t.id)).toEqual(["fantasy_town", "mystery_manor", "modern_slice_of_life"]);
    expect(resultOf(replies, 1).isError).toBeUndefined();
    expect(resultOf(replies, 2).isError).toBe(true);
    expect(textOf(resultOf(replies, 2))).toContain("The starters: fantasy_town, mystery_manor, modern_slice_of_life");
    expect(replies.find((r) => r.id === 3)?.error).toEqual({ code: -32601, message: "Method not found: resources/list" });
    expect(replies.find((r) => r.id === 4)?.error?.code).toBe(-32602);
    expect(textOf(resultOf(replies, 5))).toContain("Unknown argument topik. This tool takes topic.");
  });

  test("lines split across chunks, blank lines, garbage and batches", async () => {
    const s = serve(new FakeLumiverse());
    const ping = rpc(7, "ping");
    s.feed(ping.slice(0, 9));
    s.feed(`${ping.slice(9)}\r\n\n`);
    s.feed("this is not json\n");
    s.feed(`${JSON.stringify([{ jsonrpc: "2.0", id: 8, method: "ping" }, { jsonrpc: "2.0", method: "notifications/initialized" }])}\n`);
    s.feed(`${JSON.stringify({ jsonrpc: "2.0", id: 9, result: {} })}\n`);
    const replies = await s.replies();
    expect(replies).toContainEqual({ jsonrpc: "2.0", id: 7, result: {} });
    expect(replies).toContainEqual({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    expect(replies).toContainEqual([{ jsonrpc: "2.0", id: 8, result: {} }] as unknown as RpcReply);
    // A client's own reply (id 9, a result) gets no answer.
    expect(replies.filter((r) => !Array.isArray(r) && r.id === 9)).toEqual([]);
  });

  test("calls run side by side, each answered whole, and one world's edits apply one after the other", async () => {
    const fake = new FakeLumiverse();
    const w = fake.lre.seed("Alpha");
    const s = serve(fake);
    const add = (id: string) => ({ op: "add", path: `/entities/${id}`, value: { id, kind: "person", name: id, tier: "background", fields: {}, relations: [] } });
    for (let i = 1; i <= 5; i++) s.feed(rpc(i, "tools/call", { name: "lre_edit", arguments: { worldId: w.index.id, ops: [add(`p${i}`)] } }));
    s.feed(rpc(6, "tools/call", { name: "lre_worlds", arguments: {} }));
    const replies = await s.replies();
    expect(replies).toHaveLength(6);
    for (let i = 1; i <= 5; i++) expect(resultOf(replies, i).isError).toBeUndefined();
    // Serialized: every edit read the draft the previous one left, so none was refused or lost.
    expect(Object.keys(w.draft?.doc.entities ?? {}).filter((k) => /^p\d$/.test(k)).sort()).toEqual(["p1", "p2", "p3", "p4", "p5"]);
    expect(w.draft?.version).toBe(5);
    expect(fake.lre.sent("lre.editor", "patch").map((r) => r.version)).toEqual([0, 1, 2, 3, 4]);
  });

  test("an unknown tool and a null id are protocol errors, as MCP has them", async () => {
    const s = serve(new FakeLumiverse());
    s.feed(rpc(1, "tools/call", { name: "lre_no_such_tool", arguments: {} }));
    s.feed(`${JSON.stringify({ jsonrpc: "2.0", id: null, method: "tools/list" })}\n`);
    const replies = await s.replies();
    expect(replies.find((r) => r.id === 1)).toEqual({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: "Unknown tool: lre_no_such_tool" } });
    const nullId = replies.find((r) => r.id === null);
    expect(nullId?.error?.code).toBe(-32600);
    expect(nullId?.result).toBeUndefined();
  });

  test("every tool says how it acts: the read-only ones exactly those read-only mode keeps, and the ones that can lose work destructive", async () => {
    const fake = new FakeLumiverse();
    const s = serve(fake);
    s.feed(rpc(1, "tools/list"));
    const tools = resultOf(await s.replies(), 1).tools as { name: string; annotations?: Record<string, unknown> }[];
    const ro = serve(fake, true);
    ro.feed(rpc(1, "tools/list"));
    const kept = (resultOf(await ro.replies(), 1).tools as { name: string }[]).map((t) => t.name);
    for (const t of tools) {
      expect([t.name, t.annotations?.openWorldHint]).toEqual([t.name, false]);
      expect([t.name, t.annotations?.readOnlyHint]).toEqual([t.name, kept.includes(t.name)]);
      // A client goes by these when it decides what to ask the user about first.
      if (t.annotations?.readOnlyHint === false) expect([t.name, typeof t.annotations.destructiveHint, typeof t.annotations.idempotentHint]).toEqual([t.name, "boolean", "boolean"]);
    }
    const destructive = tools.filter((t) => t.annotations?.destructiveHint === true).map((t) => t.name);
    expect(destructive).toEqual(expect.arrayContaining(["lre_edit", "lre_discard", "lre_restore", "lre_world_delete", "lre_upgrade"]));
    expect(destructive).not.toContain("lre_world_create");
  });
});
