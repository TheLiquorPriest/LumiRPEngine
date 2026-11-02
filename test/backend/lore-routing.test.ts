// The lore index (DESIGN §4.2, Settings → Lore), on the fake host in Port Alder: made live from the
// World Info books LRE reads, so an edit is what the next index holds; each entry by a short id that
// stays its own as entries come and go (its tag, a key matching the pattern, when it has one), which
// every lore tool takes; under everyone's knowledge a restricted entry's line is inside its secret
// mark, its title and what it holds alike; an entry loaded by id reaches the reply the turn is
// writing; the user's own index entry is what the agents get when Settings names it; and Build's index
// entry stays in step with its books until it is stopped, reading Settings as they stand, never a
// turn's.

import { describe, expect, test } from "bun:test";
import { classicRoles } from "../../src/backend/agents/roles/classic";
import type { ToolOutcome } from "../../src/backend/agents/runtime";
import { LORE_TOOLS } from "../../src/backend/agents/tools/lore";
import { outsideReader } from "../../src/backend/agents/tools/read-view";
import { toolsFor } from "../../src/backend/agents/tools/registry";
import type { HostBookEntryInput } from "../../src/backend/host";
import { outsideTurns } from "../../src/backend/turn-frame";
import { ROLE_IDS } from "../../src/shared/agent-roles";
import type { AgentKnowledge } from "../../src/shared/agent-tools";
import { LEDGER_NAMESPACE } from "../../src/shared/ledger";
import { builtIndexOf } from "../../src/shared/lore";
import { holdsOf } from "../../src/shared/lore-routing";
import type { LoreIndexView } from "../../src/shared/protocol";
import { secretMarkText } from "../../src/shared/secret-marks";
import type { BuiltLoreIndex } from "../../src/shared/settings";
import { outputsOf } from "../../src/engine/outputs";
import { Rig } from "../support/rig";

const LIGHT = "The old lighthouse stands dark on the breakwater.";
const LIT = "The lighthouse burns again; its keeper is back.";
const FERRY = "FERRY-LINE: the ferry runs hourly from the home dock.";
const MARINA = "The marina rents slips by the month.";
const CHANDLERY = "The chandlery sells rope, paint and charts.";

const entry = (comment: string, content: string, keys: string[]): HostBookEntryInput => ({ comment, content, keys, disabled: false, constant: false, extensions: {} });

async function tool(rig: Rig, chatId: string, name: string, args: Record<string, string>, knowledge: AgentKnowledge = "gm"): Promise<ToolOutcome> {
  const found = LORE_TOOLS.find((t) => t.name === name);
  if (!found) throw new Error(`no ${name} tool`);
  const base = { userId: rig.host.userId, chatId, knowledge };
  return found.run(args, { ...base, reader: outsideReader(rig.rt, base), writer: null, agent: { role: "assistant", id: "agent_test" }, signal: new AbortController().signal });
}

async function index(rig: Rig, chatId: string, knowledge: AgentKnowledge = "gm"): Promise<string> {
  const out = await tool(rig, chatId, "lore_index", {}, knowledge);
  if (out.error) throw new Error(out.text);
  return (JSON.parse(out.text) as { index: string }).index;
}

async function read(rig: Rig, chatId: string, id: string): Promise<{ id: string; title: string; text: string } | null> {
  const out = await tool(rig, chatId, "lore_read", { id });
  return out.error ? null : (JSON.parse(out.text) as { id: string; title: string; text: string });
}

/** Port Alder, a chat on it, and a book of the user's the chat reads, attached as the host's World Info picker attaches one. */
async function harbor() {
  const rig = new Rig({ shipped: true });
  const user = rig.host.userId;
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  const bookId = await rig.host.books.create("Harbor notes", "", user);
  const meta = await rig.host.chats.chatMetadata(chatId, user);
  const attached = Array.isArray(meta.chat_world_book_ids) ? meta.chat_world_book_ids : [];
  await rig.host.chats.mergeChatMetadata(chatId, { chat_world_book_ids: [...attached, bookId] }, user);
  return { rig, user, worldId, chatId, bookId };
}

describe("the lore index", () => {
  test("is the books as they are: an entry edited in World Info is what the next index holds, by its id, its title and what it holds", async () => {
    const { rig, user, chatId, bookId } = await harbor();
    const light = await rig.host.books.createEntry(bookId, entry("Lighthouse", LIGHT, ["lighthouse"]), user);
    expect(await index(rig, chatId)).toContain(`Harbor notes: lre0001 Lighthouse (${LIGHT})`);
    rig.host.editEntry(light, { comment: "Beacon", content: LIT });
    const after = await index(rig, chatId);
    expect(after).toContain(`Harbor notes: lre0001 Beacon (${LIT})`);
    expect(after).not.toContain("Lighthouse");
  }, 30_000);

  test("ids stay each entry's own as entries are added and deleted, a tag (a key matching the pattern) is the entry's id, and a restart keeps them", async () => {
    const { rig, user, chatId, bookId } = await harbor();
    const light = await rig.host.books.createEntry(bookId, entry("Lighthouse", LIGHT, ["lighthouse"]), user);
    await rig.host.books.createEntry(bookId, entry("Ferry", FERRY, ["ferry", "lr0101"]), user);
    await rig.host.books.createEntry(bookId, entry("Marina", MARINA, ["marina"]), user);
    const first = await index(rig, chatId);
    for (const line of ["lre0001 Lighthouse", "lr0101 Ferry", "lre0002 Marina"]) expect(first).toContain(line);
    await rig.host.books.deleteEntry(light, user);
    await rig.host.books.createEntry(bookId, entry("Chandlery", CHANDLERY, ["chandlery"]), user);
    const second = await index(rig, chatId);
    for (const line of ["lr0101 Ferry", "lre0002 Marina", "lre0003 Chandlery"]) expect(second).toContain(line);
    expect(second).not.toContain("lre0001");
    expect(await index(rig.restart(), chatId)).toBe(second);
  }, 30_000);

  test("lore_read takes a short id or bookId/entryId, and answers by the short id", async () => {
    const { rig, user, chatId, bookId } = await harbor();
    const ferry = await rig.host.books.createEntry(bookId, entry("Ferry", FERRY, ["ferry", "lr0101"]), user);
    const byTag = await read(rig, chatId, "lr0101");
    expect(byTag).toMatchObject({ id: "lr0101", title: "Ferry" });
    expect(byTag?.text).toContain(FERRY);
    expect(await read(rig, chatId, `${bookId}/${ferry}`)).toEqual(byTag);
    expect(await read(rig, chatId, "lr0102")).toBeNull();
  }, 30_000);

  test("under everyone's knowledge a restricted entry's title and what it holds are each inside its secret mark; the GM's reads them plainly, and the player character's has no line for it", async () => {
    const { rig, user, chatId, bookId } = await harbor();
    const affair = "Marcus has been meeting the harbor master's wife at the boathouse.\nNobody else knows.";
    await rig.host.books.createEntry(bookId, { ...entry("Boathouse meetings", affair, ["boathouse"]), extensions: { [LEDGER_NAMESPACE]: { lore: { visibility: "known_by", links: ["nobody_the_pov_knows"] } } } }, user);
    await rig.host.books.createEntry(bookId, entry("Ferry", FERRY, ["ferry", "lr0101"]), user);
    const holds = holdsOf("Boathouse meetings", affair, (await rig.rt.settings.get(user)).loreIndex.holdsChars);
    if (holds === null) throw new Error("the entry holds no line beside its title");
    const kept = (text: string): string => secretMarkText(text, [], "everyone");
    const everyone = await index(rig, chatId, "everyone");
    expect(everyone).toContain(`lre0001 ${kept("Boathouse meetings")} (${kept(holds)})`);
    // An entry anyone may read is as it is.
    expect(everyone).toContain(`lr0101 Ferry (${FERRY})`);
    expect(await index(rig, chatId)).toContain(`lre0001 Boathouse meetings (${holds})`);
    expect(await index(rig, chatId, "pov")).not.toContain("Boathouse");
  }, 30_000);

  test("the user's own index entry is what lore_index gives once Settings names it, as written, and its tags read their entries", async () => {
    const { rig, user, chatId, bookId } = await harbor();
    await rig.host.books.createEntry(bookId, entry("Ferry", FERRY, ["ferry", "lr0101"]), user);
    const own = "LORE INDEX\nHarbor notes: lr0101 Ferry\nWrite a tag in the lore call block to load that entry with the next reply.";
    const entryId = await rig.host.books.createEntry(bookId, { ...entry("LORE INDEX", own, []), constant: true }, user);
    expect(await index(rig, chatId)).not.toBe(own);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { loreIndex: { own: { bookId, entryId } } } }));
    expect(await index(rig, chatId)).toBe(own);
    expect((await read(rig, chatId, "lr0101"))?.text).toContain(FERRY);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { loreIndex: { own: null } } }));
    expect(await index(rig, chatId)).toContain("lr0101 Ferry");
  }, 30_000);
});

describe("lore_load", () => {
  test("an agent of the turn loads an entry by its id, and the reply the turn writes has it in its prompt", async () => {
    const { rig, user, chatId, bookId } = await harbor();
    await rig.host.books.createEntry(bookId, entry("Ferry", FERRY, ["ferry", "lr0101"]), user);
    expect(rig.body(await rig.send({ type: "lre.chat.knowledge", chatId, engine: "agents" })).engine).toBe("agents");
    rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { roles: Object.fromEntries(ROLE_IDS.map((role) => [role, { promptOnly: true }])) } } }));
    const roles = classicRoles();
    const answers: ToolOutcome[] = [];
    rig.rt.orchestrator.roles = {
      ...roles,
      scene: async (task, ctx) => {
        const { world } = await ctx.reader.view();
        const load = toolsFor({ world, tiers: ["read"], families: ["lore"], texts: {}, env: { userId: ctx.userId, chatId: ctx.chatId, knowledge: "everyone", reader: ctx.reader, writer: null, agent: { role: "scene", id: ctx.agentId }, signal: ctx.signal, loads: ctx.loads } }).find((t) => t.name === "lore_load");
        if (!load) throw new Error("no lore_load for a turn's agent");
        answers.push(await load.run({ id: "lr0101" }, { signal: ctx.signal, agentId: ctx.agentId, role: "scene", callId: "load_1" }));
        return roles.scene(task, ctx);
      },
    };
    rig.host.sendUser(chatId, "I head down to the dock.");
    await rig.host.settle();
    const g = await rig.host.start(chatId, { type: "normal" });
    const scene = rig.host.section("Scene");
    await rig.host.finish(g, "The ferry is in.");
    expect(answers.map((a) => a.error === true)).toEqual([false]);
    expect(scene).toContain(FERRY);
    expect(rig.rt.ledger.errors).toEqual([]);
  }, 60_000);
});

describe("the scene role", () => {
  test("keeps the entries its answer names by short id, by tag or by bookId/entryId, and the reply's Scene section has them; an id that names nothing is dropped", async () => {
    const { rig, user, chatId, bookId } = await harbor();
    const ferry = await rig.host.books.createEntry(bookId, entry("Ferry", FERRY, ["ferry", "lr0101"]), user);
    const marina = await rig.host.books.createEntry(bookId, entry("Marina", MARINA, ["marina"]), user);
    const chandlery = await rig.host.books.createEntry(bookId, entry("Chandlery", CHANDLERY, ["chandlery"]), user);
    const ids = await index(rig, chatId);
    expect(ids).toContain("lr0101 Ferry");
    expect(ids).toContain("lre0001 Marina");
    expect(rig.body(await rig.send({ type: "lre.chat.knowledge", chatId, engine: "agents" })).engine).toBe("agents");
    // Every role but the scene runs prompt-only, so the scene's agent alone answers here.
    rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { roles: Object.fromEntries(ROLE_IDS.filter((role) => role !== "scene").map((role) => [role, { promptOnly: true }])) } } }));
    const plain = rig.host.quietReply;
    let asked = 0;
    rig.host.quietReply = (req) => {
      if (!/You are the scene agent of LumiRPEngine/.test(req.messages[0]?.content ?? "")) return plain ? plain(req) : "{}";
      asked++;
      return JSON.stringify({ lore: ["lr0101", "lre0001", `${bookId}/${chandlery}`, "lr0101", "lr9999"], notes: [] });
    };
    rig.host.sendUser(chatId, "I head down to the dock.");
    await rig.host.settle();
    const g = await rig.host.start(chatId, { type: "normal" });
    const scene = rig.host.section("Scene");
    await rig.host.finish(g, "The ferry is in.");
    expect(asked).toBe(1);
    for (const text of [FERRY, MARINA, CHANDLERY]) expect(scene).toContain(text);
    // The turn records each entry once, by its live lore id.
    const core = await rig.rt.ledger.core(chatId, user);
    const head = rig.host.head(chatId);
    const rec = head ? core?.journal.messages[head.id]?.ledger.swipes[String(head.swipeId)] : undefined;
    expect(outputsOf(rec?.events ?? [])?.scene.lore).toEqual([`book:${bookId}/${ferry}`, `book:${bookId}/${marina}`, `book:${bookId}/${chandlery}`]);
    expect(rig.rt.ledger.errors).toEqual([]);
  }, 60_000);
});

/**
 * Has the user act once `rig`'s next turn has started, before it reads its lore: the turn runs on
 * Settings as they stood as it started (its snapshot), and `act` changes them as they stand.
 */
function whileTurnRuns(rig: Rig, act: () => Promise<void>): void {
  const frame = rig.rt.frame.bind(rig.rt);
  let acted = false;
  rig.rt.frame = async (chatId, userId) => {
    const started = await frame(chatId, userId);
    if (!acted) {
      acted = true;
      await outsideTurns(act);
    }
    return started;
  };
}

/** The world's books indexed into a new book's entry, on Build's press: the entry Settings keeps. */
async function buildIndex(rig: Rig, worldId: string, bookId: string): Promise<BuiltLoreIndex> {
  const built = (rig.body(await rig.send({ type: "lre.lore", op: "build", worldId, bookId })).index as LoreIndexView).built;
  if (!built) throw new Error("nothing built");
  return { bookId: built.bookId, entryId: built.entryId, worldId: built.worldId };
}

describe("Build's index entry", () => {
  test("is written into the book picked, marked as LRE's, kept in step with its books on each turn, and left as it is once stopped", async () => {
    const { rig, user, worldId, chatId, bookId } = await harbor();
    const light = await rig.host.books.createEntry(bookId, entry("Lighthouse", LIGHT, ["lighthouse"]), user);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { loreBooks: [bookId] } }));
    const target = await rig.host.books.create("Index", "", user);
    const view = rig.body(await rig.send({ type: "lre.lore", op: "build", worldId, bookId: target })).index as LoreIndexView;
    const built = view.built;
    if (!built) throw new Error("nothing built");
    const stored = () => rig.host.storedEntry(built.entryId);
    expect(stored()).toMatchObject({ bookId: target, constant: true, disabled: false, preventRecursion: true });
    expect(builtIndexOf(stored()?.extensions)).toBe(worldId);
    expect(stored()?.content).toContain("lre0001 Lighthouse");
    // Never lore itself: the index lists the book's entries, not the entry it is.
    expect(await index(rig, chatId)).not.toContain("LORE INDEX");
    rig.host.editEntry(light, { comment: "Beacon", content: LIT });
    await rig.turn(chatId, "I look out to sea.", "The beacon turns.");
    expect(stored()?.content).toContain("lre0001 Beacon");
    expect(rig.host.storedEntry(light)).toMatchObject({ comment: "Beacon", content: LIT, keys: ["lighthouse"] });
    rig.body(await rig.send({ type: "lre.settings.set", patch: { loreIndex: { built: null } } }));
    rig.host.editEntry(light, { comment: "Tower" });
    await rig.turn(chatId, "I walk on.", "The tower stands.");
    expect(stored()?.content).toContain("lre0001 Beacon");
    expect(rig.rt.ledger.errors).toEqual([]);
  }, 60_000);

  test("a Stop while a turn runs counts at once: the turn leaves the entry as it stands", async () => {
    const { rig, user, worldId, chatId, bookId } = await harbor();
    const light = await rig.host.books.createEntry(bookId, entry("Lighthouse", LIGHT, ["lighthouse"]), user);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { loreBooks: [bookId] } }));
    const built = await buildIndex(rig, worldId, await rig.host.books.create("Index", "", user));
    const written = rig.host.storedEntry(built.entryId)?.content;
    expect(written).toContain("lre0001 Lighthouse");
    rig.host.editEntry(light, { comment: "Beacon", content: LIT });
    // Stop, pressed once the turn has started: its snapshot of Settings still names the entry.
    whileTurnRuns(rig, async () => void (await rig.rt.settings.set(user, { loreIndex: { built: null } })));
    await rig.turn(chatId, "I look out to sea.", "The beacon turns.");
    expect((await rig.rt.settings.get(user)).loreIndex.built).toBeNull();
    expect(rig.host.storedEntry(built.entryId)?.content).toBe(written);
    expect(rig.rt.ledger.errors).toEqual([]);
  }, 60_000);

  test("an entry built while a turn runs, the one before deleted and stopped, is the one kept: the turn brings it up to date and never lets it go", async () => {
    const { rig, user, worldId, chatId, bookId } = await harbor();
    const light = await rig.host.books.createEntry(bookId, entry("Lighthouse", LIGHT, ["lighthouse"]), user);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { loreBooks: [bookId] } }));
    const target = await rig.host.books.create("Index", "", user);
    const first = await buildIndex(rig, worldId, target);
    const made: { built: BuiltLoreIndex | null } = { built: null };
    // Once the turn has started, its snapshot of Settings naming the first: the user deletes it, stops it and builds another, then edits a book entry it indexes.
    whileTurnRuns(rig, async () => {
      await rig.host.books.deleteEntry(first.entryId, user);
      await rig.rt.settings.set(user, { loreIndex: { built: null } });
      made.built = await rig.rt.loreRouting.build(user, worldId, target);
      rig.host.editEntry(light, { comment: "Beacon", content: LIT });
    });
    await rig.turn(chatId, "I look out to sea.", "The beacon turns.");
    const kept = made.built;
    if (!kept) throw new Error("nothing built while the turn ran");
    expect(kept.entryId).not.toBe(first.entryId);
    expect((await rig.rt.settings.get(user)).loreIndex.built).toEqual(kept);
    expect(rig.host.storedEntry(kept.entryId)?.content).toContain("lre0001 Beacon");
    expect(rig.host.logs.some((l) => l.includes("is gone or no longer LumiRPEngine's"))).toBe(false);
    expect(rig.rt.ledger.errors).toEqual([]);
  }, 60_000);
});
