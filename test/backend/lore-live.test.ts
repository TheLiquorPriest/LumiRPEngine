// World Info read as lore live (DESIGN §4.2), on the fake host in Port Alder: no copy of a book is
// read, so an edit, an addition or a deletion in the book is what the next lookup finds, with no
// press of the user's; an old world's copy of an entry stays in its revision (a chat on it folds as
// it did) but its book entry is read in its place, by the entry's own fields, and an agent turn that
// recorded the copy's id among its scene lore tells that entry, its Re-narrate too; the user's Lore
// books setting limits which books are read; and no edit makes a new copy.

import { describe, expect, test } from "bun:test";
import { classicRoles } from "../../src/backend/agents/roles/classic";
import type { ToolOutcome } from "../../src/backend/agents/runtime";
import { LORE_TOOLS } from "../../src/backend/agents/tools/lore";
import { outsideReader } from "../../src/backend/agents/tools/read-view";
import { bookLoreId } from "../../src/backend/book-lore";
import type { HostBookEntryInput } from "../../src/backend/host";
import { toChain } from "../../src/backend/ledger-io";
import { ROLE_IDS } from "../../src/shared/agent-roles";
import type { Rec } from "../../src/shared/ledger";
import { bookTextHash } from "../../src/shared/lore";
import { outputsOf } from "../../src/engine/outputs";
import { Rig } from "../support/rig";

const LIGHT = "The old lighthouse stands dark on the breakwater.";
const LIT = "The lighthouse burns again; its keeper is back.";
const FERRY = "The ferry runs hourly from the home dock.";

const entry = (comment: string, content: string, keys: string[], secondaryKeys: string[] = []): HostBookEntryInput => ({ comment, content, keys, secondaryKeys, disabled: false, constant: false, position: 0, depth: 4, role: null, order: 100, extensions: {} });

async function tool(rig: Rig, chatId: string, name: string, args: Record<string, string>): Promise<ToolOutcome> {
  const found = LORE_TOOLS.find((t) => t.name === name);
  if (!found) throw new Error(`no ${name} tool`);
  const base = { userId: rig.host.userId, chatId, knowledge: "gm" as const };
  return found.run(args, { ...base, reader: outsideReader(rig.rt, base), writer: null, agent: { role: "assistant", id: "agent_test" }, signal: new AbortController().signal });
}

async function search(rig: Rig, chatId: string, query: string): Promise<string[]> {
  const out = await tool(rig, chatId, "lore_search", { query });
  if (out.error) throw new Error(out.text);
  return (JSON.parse(out.text) as { results: { id: string }[] }).results.map((r) => r.id);
}

async function read(rig: Rig, chatId: string, id: string): Promise<{ id: string; title: string; text: string } | null> {
  const out = await tool(rig, chatId, "lore_read", { id });
  return out.error ? null : (JSON.parse(out.text) as { id: string; title: string; text: string });
}

/** Port Alder and a chat on it, whose committed lore holds an earlier build's copy of an entry of a book the chat doesn't scan itself. */
async function copiedWorld() {
  const rig = new Rig({ shipped: true });
  const user = rig.host.userId;
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  const bookId = await rig.host.books.create("Harbor notes", "", user);
  const light = await rig.host.books.createEntry(bookId, entry("Lighthouse", LIGHT, ["lighthouse"], ["the gloomspire"]), user);
  await rig.oldCopy(worldId, { id: "breakwater_lighthouse", title: "Breakwater Lighthouse", content: LIGHT, keys: ["lighthouse"], links: [], aliases: ["the copied alias"], source: { kind: "book", bookId, entryId: light, hash: bookTextHash(LIGHT) } });
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  return { rig, user, worldId, bookId, light, chatId };
}

async function headState(rig: Rig, chatId: string): Promise<string> {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  const render = core?.renderState(toChain(await rig.host.chats.messages(chatId, rig.host.userId)));
  if (!render) throw new Error("no head");
  return JSON.stringify(render.state);
}

async function headRecord(rig: Rig, chatId: string): Promise<Rec> {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  const head = rig.host.head(chatId);
  const rec = head ? core?.journal.messages[head.id]?.ledger.swipes[String(head.swipeId)] : undefined;
  if (!rec) throw new Error("no record");
  return rec;
}

describe("World Info read as lore, live", () => {
  test("an old copy isn't read; its book entry is, by its own title, keys and secondary keys, and an edit, an addition and a deletion are what the next lookup finds", async () => {
    const { rig, user, bookId, light, chatId } = await copiedWorld();
    const id = bookLoreId(bookId, light);
    expect(await read(rig, chatId, "breakwater_lighthouse")).toBeNull();
    expect(await search(rig, chatId, "the copied alias")).not.toContain("breakwater_lighthouse");
    const read0 = await read(rig, chatId, id);
    expect(read0).toMatchObject({ title: "Lighthouse" });
    // The tools name it by its short id, which a lookup gives too.
    expect(await search(rig, chatId, "the gloomspire")).toContain(read0?.id ?? "");
    // Edited in World Info: the next lookup reads it, with nothing pressed.
    rig.host.editEntry(light, { comment: "Beacon", content: LIT });
    expect(await read(rig, chatId, id)).toMatchObject({ title: "Beacon" });
    expect((await read(rig, chatId, id))?.text).toContain(LIT);
    // Added, then deleted.
    const ferry = await rig.host.books.createEntry(bookId, entry("Ferry", FERRY, ["ferry"]), user);
    expect((await read(rig, chatId, bookLoreId(bookId, ferry)))?.text).toContain(FERRY);
    await rig.host.books.deleteEntry(ferry, user);
    expect(await read(rig, chatId, bookLoreId(bookId, ferry))).toBeNull();
    expect(rig.rt.ledger.errors).toEqual([]);
  }, 30_000);

  test("the Lore books setting reads only the books picked, and its reset reads them all again", async () => {
    const { rig, user, bookId, light, chatId } = await copiedWorld();
    const other = await rig.host.books.create("Town notes", "", user);
    const ferry = await rig.host.books.createEntry(other, entry("Ferry", FERRY, ["ferry"]), user);
    await rig.host.chats.mergeChatMetadata(chatId, { chat_world_book_ids: [other] }, user);
    expect(await read(rig, chatId, bookLoreId(other, ferry))).not.toBeNull();
    rig.body(await rig.send({ type: "lre.settings.set", patch: { loreBooks: [bookId] } }));
    expect(await read(rig, chatId, bookLoreId(other, ferry))).toBeNull();
    expect(await read(rig, chatId, bookLoreId(bookId, light))).not.toBeNull();
    rig.body(await rig.send({ type: "lre.settings.set", patch: { loreBooks: null } }));
    expect((await rig.rt.settings.get(user)).loreBooks).toBe("auto");
    expect(await read(rig, chatId, bookLoreId(other, ferry))).not.toBeNull();
  }, 30_000);

  test("a chat on a revision holding an old copy folds as it did, after a turn and a restart; the revision keeps the copy", async () => {
    const { rig, user, worldId, chatId } = await copiedWorld();
    await rig.turn(chatId, "I walk to the breakwater.", "The lighthouse stands over the water.");
    const before = await headState(rig, chatId);
    const restarted = rig.restart();
    const run = await restarted.rt.runOf(chatId, user);
    expect((await restarted.rt.worlds.get(worldId, user, run?.revision)).world.lore.breakwater_lighthouse?.content).toBe(LIGHT);
    expect(await headState(restarted, chatId)).toBe(before);
    expect(restarted.rt.ledger.errors).toEqual([]);
  }, 60_000);

  test("an agent turn whose scene lore names an old copy tells the copy's book entry as the book has it now; its Re-narrate tells it again, from the record as it was", async () => {
    const { rig, user, light, chatId } = await copiedWorld();
    expect(rig.body(await rig.send({ type: "lre.chat.knowledge", chatId, engine: "agents" })).engine).toBe("agents");
    rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { roles: Object.fromEntries(ROLE_IDS.map((role) => [role, { promptOnly: true }])) } } }));
    // Every role is classic's own call, but the scene names the copy by its lore id, as a turn recorded while copies were read named it.
    const roles = classicRoles();
    rig.rt.orchestrator.roles = {
      ...roles,
      scene: async (task, ctx) => {
        const ran = await roles.scene(task, ctx);
        return ran.ok ? { ...ran, out: { ...ran.out, lore: ["breakwater_lighthouse"] } } : ran;
      },
    };
    // The book's entry as it is now, no longer the copy's words.
    rig.host.editEntry(light, { content: LIT });
    const told = `Lighthouse: ${LIT}`;
    rig.host.sendUser(chatId, "I walk to the breakwater.");
    await rig.host.settle();
    const g = await rig.host.start(chatId, { type: "normal" });
    const scene = rig.host.section("Scene");
    await rig.host.finish(g, "The lighthouse stands over the water.");
    expect(scene).toContain(told);
    expect(scene).not.toContain(LIGHT);
    const first = await headRecord(rig, chatId);
    expect(outputsOf(first.events)?.scene.lore).toEqual(["breakwater_lighthouse"]);
    const chip = (await rig.rt.view(chatId, user)).chips.find((c) => c.kind === "swipe_option");
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: chip?.id, choice: "renarrate" }));
    const again = await rig.host.start(chatId, { type: "swipe" });
    expect(rig.host.section("Scene")).toContain(told);
    await rig.host.finish(again, "The lighthouse stands on over the water.");
    const renarrated = await headRecord(rig, chatId);
    expect(renarrated.events.slice(0, renarrated.pre)).toEqual(first.events.slice(0, first.pre));
    expect(rig.rt.ledger.errors).toEqual([]);
  }, 60_000);

  test("the editor and lre_edit's patch refuse a new copy of a World Info entry; an old copy can still be edited and deleted", async () => {
    const { rig, worldId, bookId, light } = await copiedWorld();
    const draft = async () => rig.body(await rig.send({ type: "lre.editor", op: "get", worldId, base: null })).draft as { lore: Record<string, { title: string; source?: unknown }> };
    const copy = { id: "second_copy", title: "Lighthouse again", content: LIGHT, keys: [], links: [], source: { kind: "book", bookId, entryId: light, hash: bookTextHash(LIGHT) } };
    const refused = async (request: Record<string, unknown>): Promise<string> => {
      const reply = await rig.send(request);
      if (reply.type !== "lre.error") throw new Error(`not refused: ${JSON.stringify(request).slice(0, 120)}`);
      return reply.message;
    };
    expect(await refused({ type: "lre.editor", op: "put", worldId, base: null, collection: "lore", id: copy.id, value: copy })).toContain(`copy the World Info entry ${bookId}/${light}`);
    expect(await refused({ type: "lre.editor", op: "patch", worldId, base: null, ops: [{ op: "add", path: "/lore/second_copy", value: copy }] })).toContain("reads World Info live");
    // An entry of the world's own can't become one either, nor can an old copy be pointed at another entry.
    rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "lore", id: "own_note", value: { id: "own_note", title: "A note", content: "Written in Build.", keys: [], links: [] } }));
    expect(await refused({ type: "lre.editor", op: "patch", worldId, base: null, ops: [{ op: "add", path: "/lore/own_note/source", value: copy.source }] })).toContain("own_note");
    expect(await refused({ type: "lre.editor", op: "patch", worldId, base: null, ops: [{ op: "replace", path: "/lore/breakwater_lighthouse/source/entryId", value: "another" }] })).toContain("breakwater_lighthouse");
    expect(Object.keys((await draft()).lore)).not.toContain("second_copy");
    // The old copy keeps its source through an edit, and goes on a delete.
    rig.body(await rig.send({ type: "lre.editor", op: "patch", worldId, base: null, ops: [{ op: "replace", path: "/lore/breakwater_lighthouse/title", value: "Old lighthouse copy" }] }));
    expect((await draft()).lore.breakwater_lighthouse).toMatchObject({ title: "Old lighthouse copy", source: { kind: "book", bookId, entryId: light } });
    rig.body(await rig.send({ type: "lre.editor", op: "remove", worldId, base: null, collection: "lore", id: "breakwater_lighthouse" }));
    expect(Object.keys((await draft()).lore)).not.toContain("breakwater_lighthouse");
  }, 30_000);
});
