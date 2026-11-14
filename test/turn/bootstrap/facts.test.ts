// The six facts of "done enough" (plan §12), read at the chat's head from the areas that keep them: each
// reads true exactly when its records exist. On a chat that plays an invented world with one attached
// book, the history window set to the latest two messages, after one turn: then the records of each fact
// are written one kind at a time, through each area's own writers, and after each only the fact they
// belong to has changed. Every name and text is invented.

import { afterEach, expect, test } from "bun:test";
import { addCharacter, pinCasting, writeCast } from "../../../src/cast";
import { writeBase } from "../../../src/cast/record";
import { writeStory, type StoryWrite } from "../../../src/story";
import { BOOTSTRAP_CHAT_PATH, type BootstrapChat, type DoneEnough } from "../../../src/turn/bootstrap";
import { world } from "../../iface/rig";
import { CHAT, CONNECTION, GREETING, playsWorld, PRESET, replying, settledTurn, USER } from "../bed";
import { type BootBed, openBootBed } from "./rig";

const beds: BootBed[] = [];
afterEach(async () => {
  for (const { b } of beds.splice(0)) await b.close();
});

const BOOK = { id: "wb-gannet", name: "Gannet Rock" };
const STAIR = { id: "wbe-stair", title: "The lamp-room stair", keys: ["stair"], content: "Ninety-one iron steps wind up to the lamp room." };
const SKERRY = { id: "wbe-skerry", title: "The north skerry", keys: ["skerry"], content: "A reef that shows only at the lowest tides." };

/** Whether each fact holds, in the skill's order; null for one not known. */
function holding(facts: DoneEnough): (boolean | null)[] {
  return [facts.lore, facts.history, facts.cast, facts.story, facts.horizon, facts.principals].map((f) => (f.known ? f.holds : null));
}

test("each fact reads true exactly when its records exist", async () => {
  const boot = await openBootBed({ global: "history:\n  window: 2\n", answers: [replying("Wren trims the wick and waits.")] });
  beds.push(boot);
  const { b, jobs } = boot;
  await playsWorld(b, world());
  b.db.run("INSERT INTO world_books (id, name, user_id) VALUES (?, ?, ?)", BOOK.id, BOOK.name, USER);
  for (const [i, e] of [STAIR, SKERRY].entries()) b.db.run("INSERT INTO world_book_entries (id, world_book_id, uid, key, content, comment) VALUES (?, ?, ?, ?, ?, ?)", e.id, BOOK.id, String(i + 1), JSON.stringify(e.keys), e.content, e.title);
  b.db.run("UPDATE chats SET metadata = ? WHERE id = ?", JSON.stringify({ chat_world_book_ids: [BOOK.id] }), CHAT);
  b.host.chats.get(CHAT)!.books = [STAIR, SKERRY].map((e) => ({ id: e.id, book: BOOK.id, content: e.content, comment: e.title, keys: e.keys }));

  b.host.send(CHAT, "I climb the stair to the lamp room.");
  const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
  expect(out.error).toBeNull();
  const turn = (await settledTurn(b, out.generationId!)).id;
  const store = b.turns.store.user(USER);
  const [greeting] = store.path(CHAT);
  expect(b.host.chats.get(CHAT)?.messages[0]?.content).toBe(GREETING);
  const at = { user: USER, turn, by: "author", agent: "author-1", job: null, now: Date.now() };
  const story = (writes: StoryWrite[]) => b.app.writes.run((db) => writeStory(db, at, writes));

  // The chat's three messages, the window keeping the latest two: the greeting is left out, and nothing is recorded of anything.
  const before = await jobs.facts(USER, CHAT);
  expect(holding(before)).toEqual([false, false, false, false, false, false]);
  expect(before.lore).toMatchObject({ known: true, indexed: 0, stale: 0 });
  expect(before.history).toEqual({ known: true, holds: false, messages: 3, leftOut: 1, covered: 0, stretches: 0, summarized: 0, nearestUncovered: { from: 0, to: 0 }, nearestUnsummarized: null });
  expect(before.cast).toEqual({ known: true, holds: false, listed: 0, cast: 0, uncast: [] });
  expect(before.horizon).toEqual({ known: true, holds: false, entries: 0, named: 0, clock: true });

  // 1. The lore index: lines for every entry of the chat's lore.
  const entries = await b.turns.loreIndex.entries({ user: USER, chat: CHAT });
  expect(entries.length).toBeGreaterThanOrEqual(2);
  await b.turns.loreIndex.write({ user: USER, chat: CHAT }, entries.map((e) => ({ id: e.id, kind: "place", line: `What ${e.title} is.`, defines: [], related: [] })), "indexer");
  expect(holding(await jobs.facts(USER, CHAT))).toEqual([true, false, false, false, false, false]);

  // 2. The history the window leaves out: a beat covers the greeting, which then has beats and no summary; a scene's summary over it.
  await story([{ part: "beat", item: null, value: { text: "The lamp is lit at dusk.", message: greeting!.message } }]);
  const beat = await jobs.facts(USER, CHAT);
  expect(beat.history).toEqual({ known: true, holds: false, messages: 3, leftOut: 1, covered: 1, stretches: 1, summarized: 0, nearestUncovered: null, nearestUnsummarized: { from: 0, to: 0 } });
  await story([{ part: "scene", item: null, value: { title: "Dusk on the rock", first: greeting!.message, last: greeting!.message, summary: "The lamp was lit at dusk." } }]);
  expect(holding(await jobs.facts(USER, CHAT))).toEqual([true, true, false, false, false, false]);

  // 3. The cast: a character listed with no casting, then cast.
  const wren = await b.app.writes.run((db) => addCharacter(db, USER, CHAT, "Wren Hale", Date.now()));
  expect((await jobs.facts(USER, CHAT)).cast).toEqual({ known: true, holds: false, listed: 1, cast: 0, uncast: ["Wren Hale"] });
  await b.app.writes.run((db) => pinCasting(db, USER, wren.id, "principal"));
  expect(holding(await jobs.facts(USER, CHAT))).toEqual([true, true, true, false, false, false]);

  // 4. The story model: a premise, the scene already there for the timeline, a thread, an arc for the principal, a first read of the player.
  await story([
    { part: "premise", item: "premise", value: { text: "A keeper's last winter on Gannet Rock." } },
    { part: "thread", item: null, value: { text: "Who keeps lighting the north lamp?" } },
    { part: "arc", item: "arc:wren hale", value: { who: "Wren Hale", began: "Alone with the lamp." } },
  ]);
  expect((await jobs.facts(USER, CHAT)).story).toMatchObject({ known: true, holds: false, premise: 1, scenes: 1, beats: 1, threads: 1, openThreads: 1, arcs: 1, principals: 1, principalsWithArc: 1, player: 0 });
  await story([{ part: "player", item: null, value: { text: "Enjoys slow, quiet scenes." } }]);
  expect(holding(await jobs.facts(USER, CHAT))).toEqual([true, true, true, true, false, false]);

  // 5. The horizon: the Author's list, set by a recorded change.
  await b.app.writes.run(() => store.addChanges(turn, [{ lane: "story", op: "store.horizon", value: { list: ["bram"] }, by: "author", source: "author" }]));
  expect((await jobs.facts(USER, CHAT)).horizon).toEqual({ known: true, holds: true, entries: 1, named: 1, clock: true });
  expect(holding(await jobs.facts(USER, CHAT))).toEqual([true, true, true, true, true, false]);

  // 6. The principal's base, then a memory written by its own agent.
  await b.app.writes.run((db) => writeBase(db, { user: USER, turn, by: "author", agent: "author-1", now: Date.now() }, wren.id, { seed: "A keeper's daughter who never sleeps before the lamp is lit." }, {}));
  expect((await jobs.facts(USER, CHAT)).principals).toEqual({ known: true, holds: false, principals: [{ id: wren.id, name: "Wren Hale", base: ["seed"], memories: 0 }] });
  await b.app.writes.run((db) => writeCast(db, { ...at, by: "character", agent: "character-1", at: null }, [{ character: wren.id, part: "memory", item: null, value: { text: "The night the lamp nearly failed." } }]));
  expect(holding(await jobs.facts(USER, CHAT))).toEqual([true, true, true, true, true, true]);

  // The chat's page reads the same six, with no bootstrap job yet.
  const page = await boot.call<BootstrapChat>("GET", BOOTSTRAP_CHAT_PATH, { chat: CHAT });
  expect([page.status, holding(page.body.facts), page.body.jobs]).toEqual([200, [true, true, true, true, true, true], []]);
});

test("a chat the store has not met reads its history from Lumiverse, and a fact that cannot be read is not known", async () => {
  const boot = await openBootBed({ global: "history:\n  window: 2\n", answers: [], messages: ["m-1", "m-2", "m-3", "m-4", "m-5"].map((id, i) => ({ id, role: i % 2 === 0 ? ("assistant" as const) : ("user" as const), content: `Line ${i + 1} of the past.` })) });
  beds.push(boot);
  const facts = await boot.jobs.facts(USER, CHAT);
  expect(facts.history).toEqual({ known: true, holds: false, messages: 5, leftOut: 3, covered: 0, stretches: 0, summarized: 0, nearestUncovered: { from: 0, to: 2 }, nearestUnsummarized: null });
  expect(holding(facts)).toEqual([true, false, false, false, false, false]);
  // Lumiverse holds no such chat: its length cannot be read.
  const nowhere = await boot.jobs.facts(USER, "chat-nowhere");
  expect(nowhere.history).toEqual({ known: false, why: "There is no chat chat-nowhere for this RPE's Lumiverse user." });
});
