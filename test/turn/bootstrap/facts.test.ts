// The six facts of "done enough" (plan §12), read at the chat's head from the areas that keep them, as
// counts and names only: whether the record is done enough is the bootstrap skill's to say, so neither the
// job nor the page is given a verdict. On a chat that plays an invented world with one attached book, the
// history window set to the latest two messages, after one turn: then the records of each fact are written
// one kind at a time, through each area's own writers, and after each only the counts of the facts they
// belong to have changed. Every name and text is invented.

import { afterEach, expect, test } from "bun:test";
import { addCharacter, pinCasting, writeCast } from "../../../src/cast";
import { writeBase } from "../../../src/cast/record";
import { writeStory, type StoryWrite } from "../../../src/story";
import { BOOTSTRAP_CHAT_PATH, BOOTSTRAP_FACTS, type BootstrapChat, type DoneEnough } from "../../../src/turn/bootstrap";
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
const NO_STORY = { known: true as const, premise: 0, chapters: 0, scenes: 0, beats: 0, threads: 0, openThreads: 0, arcs: 0, principals: 0, principalsWithArc: 0, player: 0 };

/** The facts whose counts differ between two readings, in the skill's order. */
function changed(before: DoneEnough, after: DoneEnough): (keyof DoneEnough)[] {
  return (["lore", "history", "cast", "story", "horizon", "principals"] as const).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
}

test("each fact's counts change exactly when its own records are written, and neither the job nor the page is given a verdict", async () => {
  const boot = await openBootBed({ global: "history:\n  window: 2\n", answers: [replying("Wren trims the wick and waits.")] });
  beds.push(boot);
  const { b, jobs } = boot;
  await playsWorld(b, world());
  b.db.run("INSERT INTO world_books (id, name, user_id) VALUES (?, ?, ?)", BOOK.id, BOOK.name, USER);
  for (const [i, e] of [STAIR, SKERRY].entries()) b.db.run("INSERT INTO world_book_entries (id, world_book_id, uid, key, content, comment) VALUES (?, ?, ?, ?, ?, ?)", e.id, BOOK.id, String(i + 1), JSON.stringify(e.keys), e.content, e.title);
  b.db.run("UPDATE chats SET metadata = ? WHERE id = ?", JSON.stringify({ chat_world_book_ids: [BOOK.id] }), CHAT);

  b.host.send(CHAT, "I climb the stair to the lamp room.");
  const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
  expect(out.error).toBeNull();
  const turn = (await settledTurn(b, out.generationId!)).id;
  const store = b.turns.store.user(USER);
  const [greeting] = store.path(CHAT);
  expect(b.host.chats.get(CHAT)?.messages[0]?.content).toBe(GREETING);
  const at = { user: USER, turn, by: "author", agent: "author-1", job: null, now: Date.now() };
  const story = (writes: StoryWrite[]) => b.app.writes.run((db) => writeStory(db, at, writes));
  const entries = await b.turns.loreIndex.entries({ user: USER, chat: CHAT });
  expect(entries.length).toBeGreaterThanOrEqual(2);

  // The chat's three messages, the window keeping the latest two: the greeting is left out, and nothing is recorded of anything.
  let last = await jobs.facts(USER, CHAT);
  expect(last).toEqual({
    lore: { known: true, entries: entries.length, indexed: 0, stale: 0 },
    history: { known: true, messages: 3, leftOut: 1, covered: 0, stretches: 0, summarized: 0, nearestUncovered: { from: 0, to: 0 }, nearestUnsummarized: null },
    cast: { known: true, listed: 0, cast: 0, uncast: [] },
    story: NO_STORY,
    horizon: { known: true, entries: 0, named: 0, clock: true },
    principals: { known: true, principals: [] },
  });
  /** The facts now, with which of them changed since the last reading. */
  const next = async (): Promise<{ now: DoneEnough; moved: (keyof DoneEnough)[] }> => {
    const now = await jobs.facts(USER, CHAT);
    const moved = changed(last, now);
    last = now;
    return { now, moved };
  };

  // 1. The lore index: lines for every entry of the chat's lore.
  await b.turns.loreIndex.write({ user: USER, chat: CHAT }, entries.map((e) => ({ id: e.id, revision: e.revision, kind: "place", line: `What ${e.title} is.`, defines: [], related: [] })), "indexer");
  let step = await next();
  expect([step.moved, step.now.lore]).toEqual([["lore"], { known: true, entries: entries.length, indexed: entries.length, stale: 0 }]);

  // 2. The history the window leaves out: a beat covers the greeting, which then has beats and no summary; a scene's summary over it.
  await story([{ part: "beat", item: null, value: { text: "The lamp is lit at dusk.", message: greeting!.message } }]);
  step = await next();
  expect([step.moved, step.now.history]).toEqual([["history", "story"], { known: true, messages: 3, leftOut: 1, covered: 1, stretches: 1, summarized: 0, nearestUncovered: null, nearestUnsummarized: { from: 0, to: 0 } }]);
  await story([{ part: "scene", item: null, value: { title: "Dusk on the rock", first: greeting!.message, last: greeting!.message, summary: "The lamp was lit at dusk." } }]);
  step = await next();
  expect([step.moved, step.now.history]).toEqual([["history", "story"], { known: true, messages: 3, leftOut: 1, covered: 1, stretches: 1, summarized: 1, nearestUncovered: null, nearestUnsummarized: null }]);

  // 3. The cast: a character listed with no casting, then cast as a principal, which the story model and the principals count too.
  const wren = await b.app.writes.run((db) => addCharacter(db, USER, CHAT, "Wren Hale", Date.now()));
  step = await next();
  expect([step.moved, step.now.cast]).toEqual([["cast"], { known: true, listed: 1, cast: 0, uncast: ["Wren Hale"] }]);
  await b.app.writes.run((db) => pinCasting(db, USER, wren.id, "principal"));
  step = await next();
  expect([step.moved, step.now.cast, step.now.principals]).toEqual([["cast", "story", "principals"], { known: true, listed: 1, cast: 1, uncast: [] }, { known: true, principals: [{ id: wren.id, name: "Wren Hale", base: [], memories: 0 }] }]);

  // 4. The story model: a premise, the scene already there for the timeline, a thread, an arc for the principal, a first read of the player.
  await story([
    { part: "premise", item: "premise", value: { text: "A keeper's last winter on Gannet Rock." } },
    { part: "thread", item: null, value: { text: "Who keeps lighting the north lamp?" } },
    { part: "arc", item: "arc:wren hale", value: { who: "Wren Hale", began: "Alone with the lamp." } },
    { part: "player", item: null, value: { text: "Enjoys slow, quiet scenes." } },
  ]);
  step = await next();
  expect([step.moved, step.now.story]).toEqual([["story"], { ...NO_STORY, premise: 1, scenes: 1, beats: 1, threads: 1, openThreads: 1, arcs: 1, principals: 1, principalsWithArc: 1, player: 1 }]);

  // 5. The horizon: the Author's list, set by a recorded change.
  await b.app.writes.run(() => store.addChanges(turn, [{ lane: "story", op: "store.horizon", value: { list: ["bram"] }, by: "author", source: "author" }]));
  step = await next();
  expect([step.moved, step.now.horizon]).toEqual([["horizon"], { known: true, entries: 1, named: 1, clock: true }]);

  // 6. The principal's base, then a memory written by its own agent.
  await b.app.writes.run((db) => writeBase(db, { user: USER, chat: CHAT, turn, by: "author", agent: "author-1", now: Date.now() }, wren.id, { seed: "A keeper's daughter who never sleeps before the lamp is lit." }, {}));
  step = await next();
  expect([step.moved, step.now.principals]).toEqual([["principals"], { known: true, principals: [{ id: wren.id, name: "Wren Hale", base: ["seed"], memories: 0 }] }]);
  await b.app.writes.run(() => writeCast(b.turns.store, { ...at, by: "character", agent: "character-1", at: null }, [{ character: wren.id, part: "memory", item: null, value: { text: "The night the lamp nearly failed." } }]));
  step = await next();
  expect([step.moved, step.now.principals]).toEqual([["principals"], { known: true, principals: [{ id: wren.id, name: "Wren Hale", base: ["seed"], memories: 1 }] }]);

  // What a job's agent is given by name, and what the chat's page reads, are the same counts: with every record of the six written, no fact says it holds.
  const given = await jobs.view({ user: USER, chat: CHAT, session: "none" }, { id: "author-1", definition: "author", job: "job-1" }, BOOTSTRAP_FACTS);
  const page = await boot.call<BootstrapChat>("GET", BOOTSTRAP_CHAT_PATH, { chat: CHAT });
  expect([JSON.parse(given ?? "null"), page.status, page.body.facts, page.body.jobs]).toEqual([last, 200, last, []]);
  expect(given).not.toContain("holds");
  expect(Object.values(page.body.facts).some((f) => "holds" in f)).toBe(false);
});

test("a chat the store has not met reads its history from Lumiverse; a fact that cannot be read is given as a code, without the error's words", async () => {
  const boot = await openBootBed({ global: "history:\n  window: 2\n", answers: [], messages: ["m-1", "m-2", "m-3", "m-4", "m-5"].map((id, i) => ({ id, role: i % 2 === 0 ? ("assistant" as const) : ("user" as const), content: `Line ${i + 1} of the past.` })) });
  beds.push(boot);
  const facts = await boot.jobs.facts(USER, CHAT);
  expect(facts.history).toEqual({ known: true, messages: 5, leftOut: 3, covered: 0, stretches: 0, summarized: 0, nearestUncovered: { from: 0, to: 2 }, nearestUnsummarized: null });
  // Lumiverse holds no such chat: its length cannot be read. The job is given the code its skill words; the error's own words go to the log alone.
  const nowhere = "chat-nowhere";
  expect((await boot.jobs.facts(USER, nowhere)).history).toEqual({ known: false, why: "unreadable" });
  const given = await boot.jobs.view({ user: USER, chat: nowhere, session: "none" }, { id: "author-1", definition: "author", job: "job-1" }, BOOTSTRAP_FACTS);
  expect(JSON.parse(given ?? "null").history).toEqual({ known: false, why: "unreadable" });
  expect(given).not.toContain(nowhere);
});
