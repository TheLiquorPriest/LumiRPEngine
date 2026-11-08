// The tools LumiRPEngine serves outside clients (`lre.tools`; DESIGN §23, INC3-SPEC D4 as INC3-REEVAL
// §2.3 amends it), asked by a session that said hello as an outside client: the list names no world,
// describe fills a chat's world in, the agent families need spoilers and are checked at call time, a
// family write applies at once with one Undo chip and the client named, a read-only call of a write
// is refused here, and a served tool's text edited tells every outside client the list changed.

import { expect, test } from "bun:test";
import { isRecord, type JsonObject } from "../../src/shared/json";
import type { OutsideTool } from "../../src/shared/outside-tools";
import { PROTOCOL_VERSION } from "../../src/shared/protocol";
import { cliRig, type CliRig } from "../support/cli-rig";

const CLIENT_SESSION = "s_cli";

async function portAlder(): Promise<CliRig & { chatId: string }> {
  const cli = await cliRig({ shipped: true });
  const created = await cli.call("lre_world_create", { name: "Port Alder", template: "modern_slice_of_life" });
  const chatId = cli.rig.host.createChat("Morning.");
  await cli.call("lre_attach", { worldId: String(created.worldId), chatId });
  await cli.rig.turn(chatId, "Hello.", "A quiet morning on Harbor Street.");
  return { ...cli, chatId };
}

const listOf = async (cli: CliRig): Promise<OutsideTool[]> => (await cli.conn.request("lre.tools", { op: "list" })).tools ?? [];

/** A served tool's answer, as the MCP server forwards it. */
async function served(cli: CliRig, name: string, args: JsonObject, readOnly = false): Promise<{ text: string; isError?: true }> {
  const result = (await cli.conn.request("lre.tools", { op: "call", name, args, readOnly })).result;
  if (result === undefined) throw new Error(`${name} wasn't answered`);
  return result;
}

const propertyOf = (tool: OutsideTool | undefined, key: string): JsonObject | undefined => {
  const properties = tool?.inputSchema.properties;
  const value = isRecord(properties) ? properties[key] : undefined;
  return isRecord(value) ? (value as JsonObject) : undefined;
};

test("lre.tools lists the chat, lore and agent tools with no world's ids, describe fills a chat's in, and a page is refused", async () => {
  const { rig, conn, chatId } = await portAlder();
  const answer = await conn.request("lre.tools", { op: "list" });
  expect(answer.build).toBe(rig.rt.agents.build.id);
  const tools = answer.tools ?? [];
  const byName = new Map(tools.map((t) => [t.name, t]));
  expect(byName.get("lre_chat_state")?.cli?.command).toBe("chat");
  expect(byName.get("lre_lore_books")?.cli?.command).toBe("lore-books");
  expect(byName.get("lre_tool_describe")?.annotations).toEqual({ readOnlyHint: true, openWorldHint: false });
  // The families at the GM tier, but nothing that works a turn, condenses a source or notes facts for a reply's read.
  for (const name of ["workspace_read", "workspace_write", "gm_set_field", "gm_move", "items_find", "lore_read"]) expect([name, byName.has(name)]).toEqual([name, true]);
  for (const name of ["lore_load", "condense", "purchase", "person_add"]) expect([name, byName.has(name)]).toEqual([name, false]);
  const setField = byName.get("gm_set_field");
  expect(setField?.inputSchema.required).toEqual(["entity", "field", "value", "chatId", "spoilers"]);
  expect(setField?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
  expect(setField?.description).toContain("it applies at once, as your own GM edit with an Undo chip");
  expect(propertyOf(setField, "field")).toEqual({ type: "string", description: expect.any(String) });
  // describe: the chat's fields as the enum its agents are given.
  const described = (await conn.request("lre.tools", { op: "describe", name: "gm_set_field", chatId })).tool;
  expect(propertyOf(described, "field")?.enum).toContain("age");
  expect(JSON.parse((await served({ rig, conn } as CliRig, "lre_tool_describe", { name: "gm_set_field", chatId })).text)).toEqual(described);
  // A page is no outside client: it is served none of them.
  const refused = await rig.send({ type: "lre.tools", op: "list" }, "page");
  expect(refused).toMatchObject({ type: "lre.error", code: "forbidden" });
});

test("the agent families are refused without spoilers and checked against the chat's schema, before anything is read or written", async () => {
  const cli = await portAlder();
  const { chatId } = cli;
  const refused = await served(cli, "workspace_list", { chatId });
  expect({ isError: refused.isError, says: refused.text.includes("spoilers: true") }).toEqual({ isError: true, says: true });
  const write = await served(cli, "gm_move", { chatId, entity: "pov", to: "bluebird_coffee" });
  expect({ isError: write.isError, says: write.text.includes("spoilers: true") }).toEqual({ isError: true, says: true });
  const bad = await served(cli, "gm_set_field", { chatId, spoilers: true, entity: "pov", field: "no_such_field", value: "1" });
  expect(bad.isError).toBe(true);
  expect(bad.text).toContain("gm_set_field's arguments don't fit its schema for chat");
  const nowhere = await served(cli, "workspace_list", { chatId: "c_nowhere", spoilers: true });
  expect(nowhere).toEqual({ text: "Chat c_nowhere plays no world (or there is no such chat): lre_chats lists the chats that play one, and lre_attach attaches a world to a chat.", isError: true });
  expect((await served(cli, "lre_chat_state", { chatId, pointer: "/hud/place/id" })).text).toContain('"harbor_street_114"');
  const read = await served(cli, "workspace_list", { chatId, spoilers: true });
  expect(read.isError).toBeUndefined();
  // A name no tool has is no tool of the list.
  await expect(cli.conn.request("lre.tools", { op: "call", name: "lre_nothing", args: {} })).rejects.toMatchObject({ code: "not_found" });
});

test("an agent write through MCP applies at once as the GM's own edit, with one Undo chip, its client named; a read-only call is refused", async () => {
  const cli = await portAlder();
  const { rig, chatId } = cli;
  // The MCP server's hello names the harness that runs it.
  await rig.dispatch.handle({ lre: PROTOCOL_VERSION, reqId: "h2", type: "lre.hello", chatId: null, client: { name: "lumirpengine", version: "0.0.1", harness: "claude-code" } }, rig.host.userId, CLIENT_SESSION);
  await rig.host.settle();
  const before = (await cli.call("lre_chips", { chatId })).chips;
  const readOnly = await served(cli, "gm_move", { chatId, spoilers: true, entity: "pov", to: "bluebird_coffee" }, true);
  expect(readOnly).toEqual({ text: "gm_move changes your worlds or chats, and this client runs read-only (--read-only or LRE_READ_ONLY=1): nothing was done.", isError: true });
  const answer = JSON.parse((await served(cli, "gm_move", { chatId, spoilers: true, entity: "pov", to: "bluebird_coffee" })).text) as { applied: { undo: string; pending: boolean } };
  const { undo, pending } = answer.applied;
  expect({ pending, undo: undo.startsWith("fix:") }).toEqual({ pending: false, undo: true });
  expect(JSON.parse((await served(cli, "lre_chat_state", { chatId, pointer: "/hud/place/id" })).text.split("\n\n")[1] ?? "null")).toBe("bluebird_coffee");
  // One Undo chip, and the GM edit's entry names the client.
  const chips = (await cli.call("lre_chips", { chatId })).chips;
  const fixes = (Array.isArray(chips) ? chips : []).filter((c) => isRecord(c) && c.kind === "fix" && !(Array.isArray(before) && before.some((b) => isRecord(b) && b.id === c.id)));
  expect(fixes.map((c) => (isRecord(c) ? c.id : null))).toEqual([undo]);
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  const head = rig.host.head(chatId);
  const record = head ? core?.journal.messages[head.id]?.ledger.swipes[String(head.swipeId)] : undefined;
  expect(record?.post.filter((p) => p.agent !== undefined).map((p) => p.agent)).toEqual([expect.objectContaining({ role: "gm", client: "lumirpengine (claude-code)" })]);
  // Its Undo takes the move back.
  expect(await cli.call("lre_chip", { chatId, chip: undo, choice: "undo" })).toMatchObject({ applied: true });
  expect(JSON.parse((await served(cli, "lre_chat_state", { chatId, pointer: "/hud/place/id" })).text.split("\n\n")[1] ?? "null")).toBe("harbor_street_114");
});

test("a served tool's text edited tells every outside client the list changed; another text doesn't", async () => {
  const cli = await portAlder();
  const { rig } = cli;
  const pushes = (): number => rig.host.sent.filter((m) => m.type === "lre.tools.changed").length;
  rig.body(await rig.send({ type: "lre.settings.set", patch: { prompts: { texts: { "narrator.mark.known": "known: {{names}}" } } } }));
  expect(pushes()).toBe(0);
  rig.body(await rig.send({ type: "lre.settings.set", patch: { prompts: { texts: { "tool.lre_chips": "The chat's chips, in my words." } } } }));
  expect(pushes()).toBe(1);
  expect((await listOf(cli)).find((t) => t.name === "lre_chips")?.description).toBe("The chat's chips, in my words.");
});
