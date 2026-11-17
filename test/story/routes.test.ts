// The Story page's routes: a chat's story record, at its newest turn or as it stood at a turn; the
// timeline in the chat's order with what is struck shown and marked, the story model's parts, the
// Author's horizon and the futures apart; each list bounded by the story's own setting, with what it
// left out counted; what a migration carried told apart; an item struck from the page as the
// player's own change on the newest turn, and the strike taken back; refusals in the story's own
// words, a branch with no turn of its own among them; a turn that begins while a strike waits for its
// write; and one user's chat is not another's to read or strike. Every name and every word here is
// made up.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { JsonObject } from "rp-harness/contract";
import { Lines, SHIPPED_GUIDANCE, shippedTexts } from "../../src/iface/texts";
import type { ShownMessage, TurnRow } from "../../src/store";
import { type StoryAnswer, type StoryItemShown, type StoryCorrected, type StoryCoverageAnswer, type StoryTimelinePage, storyRoutes, type StoryRoutesDeps, type StorySettings, type StoryStruck } from "../../src/story/index";
import type { StoryWrite } from "../../src/story/record";
import { hashOf } from "../store/fixtures";
import { CHAT, openTable, type Table, USER } from "./rig";
import { callRoute } from "../app/call";

const OTHER = "user-b";
const BRANCH = "chat-b";
const LINES = Lines.parse(readFileSync(join(SHIPPED_GUIDANCE, ".prompts", "story-answers.md"), "utf8"), "story-answers.md");
const words = (line: string, fields: JsonObject = {}): string => LINES.line(line, fields) ?? "";

interface Page {
  t: Table;
  running: Set<string>;
  /** What the prompt's window is taken to be: the first message it keeps, and whether agents read what the player hid. */
  window: { edge: string | null; hiddenReadable: boolean };
  story(query?: Record<string, string>, user?: string, chat?: string): Promise<StoryAnswer>;
  strike(body: unknown, user?: string, chat?: string): Promise<StoryStruck>;
  correct(body: unknown, user?: string, chat?: string): Promise<StoryCorrected>;
  timeline(query: Record<string, string | number>, chat?: string): Promise<StoryTimelinePage>;
  coverage(chat?: string): Promise<StoryCoverageAnswer>;
}

async function openPage(settings: Partial<StorySettings> = {}): Promise<Page> {
  const t = await openTable();
  const running = new Set<string>();
  const window = { edge: null as string | null, hiddenReadable: false };
  const deps: StoryRoutesDeps = { store: t.store, writes: t.writes, files: () => shippedTexts(), settings: async () => settings, window: async () => window };
  const [storyRoute, correctRoute, timelineRoute, coverageRoute, , strikeRoute] = storyRoutes(deps);
  const timelineHandle = timelineRoute.handle as unknown as (call: { params: { chat: string }; query: Record<string, string | number>; user: string }) => Promise<StoryTimelinePage>;
  return {
    t,
    running,
    window,
    story: async (query = {}, user = USER, chat = CHAT) => await callRoute(storyRoute, { params: { chat }, query, user }),
    strike: async (body, user = USER, chat = CHAT) => await callRoute(strikeRoute, { params: { chat }, body, user }),
    correct: async (body, user = USER, chat = CHAT) => await callRoute(correctRoute, { params: { chat }, body, user }),
    // The server reads a paged route's `limit` and `after` from its cursor; the handler is given them beside what the route declares.
    timeline: async (query, chat = CHAT) => await timelineHandle({ params: { chat }, query, user: USER }),
    coverage: async (chat = CHAT) => await callRoute(coverageRoute, { params: { chat }, user: USER }),
  };
}

/** Chat B, branched from the chat at its newest reply: the same messages under its own ids, as the chat application shows them. */
async function branchOf(t: Table): Promise<ShownMessage[]> {
  const map = Object.fromEntries(t.shown.map((m) => [m.id, `b-${m.id}`]));
  await t.writes.run(() => t.s.branchChat({ id: BRANCH, from: CHAT, map, at: t.shown.at(-1)?.id ?? null }));
  const shown = t.shown.map((m) => ({ ...m, id: `b-${m.id}` }));
  await t.writes.run(() => t.s.sync(BRANCH, shown));
  return shown;
}

/** A whole exchange in chat B: the player's line, a turn begun after it, its reply tied and shown. */
async function playIn(t: Table, shown: ShownMessage[]): Promise<TurnRow> {
  shown.push({ id: `b-u${shown.length}`, user: true, hash: hashOf("the player's line in the branch"), hidden: false });
  await t.writes.run(() => t.s.sync(BRANCH, shown));
  const turn = await t.writes.run(() => t.s.beginTurn({ chat: BRANCH, kind: "new" }));
  const reply = { id: `b-r${shown.length}`, user: false, hash: hashOf("The branch goes its own way."), date: 9_000, hidden: false };
  const tied = await t.writes.run(() => t.s.tieTurn(turn.id, { message: reply.id, hash: reply.hash, date: reply.date }));
  shown.push(reply);
  await t.writes.run(() => t.s.sync(BRANCH, shown));
  return tied;
}

interface Story {
  page: Page;
  /** The migration's turn; then two turns played on RPE. */
  carried: TurnRow;
  first: TurnRow;
  second: TurnRow;
  ids: { chapter: string; scene: string; beat: string; later: string; thread: string; retcon: string };
}

/**
 * The migration carried a beat and a draft. On RPE the Author opens a chapter and a scene, records a
 * beat, a hot thread, Wren's arc, what the player enjoys, a piece of canon, its record of the turn
 * and its horizon; next turn it records another beat, strikes the carried one, closes the scene with
 * its summary and records a retcon.
 */
async function played(settings: Partial<StorySettings> = {}): Promise<Story> {
  const page = await openPage(settings);
  const { t } = page;
  t.shown.push({ id: "old-0", user: true, hash: hashOf("an old line"), hidden: false });
  await t.writes.run(() => t.s.sync(CHAT, t.shown));
  const opened = await t.writes.run(() => t.s.beginTurn({ chat: CHAT, kind: "new", imported: true }));
  const carriedWrites: StoryWrite[] = [
    { part: "beat", item: "b:x1", value: { text: "Wren reaches Thornbury in the rain.", who: ["Wren"] } },
    { part: "future", item: "fu:d1", value: { text: "The reeve sends for the letter.", tier: 2, who: ["Tam"], state: "open", close: false, drop: false } },
  ];
  await t.write(opened, carriedWrites, "migration");
  const carried = await t.tie(opened);

  const first = await t.begin();
  const [chapter, scene, beat, thread] = await t.write(first, [
    { part: "chapter", item: null, value: { title: "The sealed letter" } },
    { part: "scene", item: null, value: { title: "At the bar", who: ["Wren", "Bram"], purpose: "Get the letter." } },
    { part: "beat", item: null, value: { text: "Bram slides the letter across the bar.", who: ["Bram", "Wren"] } },
    { part: "thread", item: null, value: { text: "Who sealed the letter?", kind: "question", hot: true } },
    { part: "arc", item: "arc:wren", value: { who: "Wren", began: "A courier.", stands: "Holds the letter." } },
    { part: "player", item: null, value: { text: "Enjoys slow tension.", kind: "enjoys" } },
    { part: "canon", item: null, value: { text: "The seal is the reeve's." } },
    { part: "record", item: `rec:${first.id}`, value: { intent: "An action: Wren takes the letter.", decided: "Bram gives it." } },
  ]);
  await t.writes.run(() => t.s.addChanges(first.id, [{ lane: "story", op: "story.horizon", value: { list: ["cellar", "the_harbour"] }, by: "author", source: "author" }]));
  await t.tie(first);

  const second = await t.begin();
  const [later, , , retcon] = await t.write(second, [
    { part: "beat", item: null, value: { text: "Wren breaks the seal." } },
    { part: "beat", item: "b:x1", value: { drop: true, why: "It was dry that day." } },
    { part: "scene", item: scene?.item ?? "", value: { summary: "Wren takes the letter.", close: true } },
    { part: "retcon", item: null, value: { text: "The rain was mist.", of: "b:x1" } },
  ]);
  await t.tie(second);
  const id = (row: { item: string } | undefined): string => row?.item ?? "";
  return { page, carried, first, second, ids: { chapter: id(chapter), scene: id(scene), beat: id(beat), later: id(later), thread: id(thread), retcon: id(retcon) } };
}

describe("the story record of a chat", () => {
  test("gives the timeline in the chat's order, struck beats shown and marked, scenes and chapters with their spans and summaries", async () => {
    const { page, carried, first, second, ids } = await played();
    const got = await page.story();
    expect({ chat: got.chat, turn: got.turn, listed: got.listed }).toEqual({ chat: CHAT, turn: null, listed: 50 });
    // Messages: 0 and 1 the carried exchange, 2 and 3 the first played, 4 and 5 the second.
    expect(got.timeline.beat).toMatchObject({ total: 3, before: 0, after: 0 });
    expect(got.timeline.beat.items.map((b) => ({ id: b.id, from: b.from, to: b.to, turn: b.turn, message: b.message, by: b.by, imported: b.imported, struck: b.struck }))).toEqual([
      { id: "b:x1", from: 1, to: 1, turn: carried.id, message: 1, by: "migration", imported: true, struck: true },
      { id: ids.beat, from: 3, to: 3, turn: first.id, message: 3, by: "author", imported: false, struck: false },
      { id: ids.later, from: 5, to: 5, turn: second.id, message: 5, by: "author", imported: false, struck: false },
    ]);
    expect(got.timeline.beat.items[0]?.writes).toEqual([
      { turn: carried.id, message: 1, imported: true, by: "migration", wrote: { text: "Wren reaches Thornbury in the rain.", who: ["Wren"] } },
      { turn: second.id, message: 5, imported: false, by: "author", wrote: { drop: true, why: "It was dry that day." } },
    ]);
    expect(got.timeline.scene.items).toEqual([
      expect.objectContaining({ id: ids.scene, from: 2, to: 5, closed: true, struck: false, fields: { title: "At the bar", who: ["Wren", "Bram"], purpose: "Get the letter.", summary: "Wren takes the letter." } }),
    ]);
    expect(got.timeline.chapter.items).toEqual([expect.objectContaining({ id: ids.chapter, from: 2, to: 5, closed: false, fields: { title: "The sealed letter" } })]);
    expect(got.current).toEqual({ chapter: ids.chapter, scene: null });
  });

  test("gives the story model's parts as recorded, the Author's horizon, and the futures apart", async () => {
    const { page, first, ids } = await played();
    const got = await page.story();
    expect(got.model.premise).toBeNull();
    expect(got.model.thread.items).toEqual([expect.objectContaining({ id: ids.thread, fields: { text: "Who sealed the letter?", kind: "question", hot: true } })]);
    expect(got.model.arc.items.map((a) => a.fields)).toEqual([{ who: "Wren", began: "A courier.", stands: "Holds the letter." }]);
    expect(got.model.player.items.map((p) => p.fields)).toEqual([{ text: "Enjoys slow tension.", kind: "enjoys" }]);
    expect(got.model.canon.items.map((c) => c.fields)).toEqual([{ text: "The seal is the reeve's." }]);
    expect(got.model.retcon.items).toEqual([expect.objectContaining({ id: ids.retcon, fields: { text: "The rain was mist.", of: "b:x1" } })]);
    expect(got.model.record.items).toEqual([expect.objectContaining({ id: `rec:${first.id}`, turn: first.id, message: 3, fields: { intent: "An action: Wren takes the letter.", decided: "Bram gives it." } })]);
    expect(got.horizon).toEqual([
      { at: "cellar", ref: "place:cellar", name: "The Cellar", depth: "full" },
      { at: "the_harbour", ref: null, name: null, depth: "full" },
    ]);
    expect(got.futures.items).toEqual([expect.objectContaining({ id: "fu:d1", by: "migration", imported: true, closed: false, struck: false, fields: { text: "The reeve sends for the letter.", tier: 2, who: ["Tam"], state: "open" } })]);
    expect(typeof got.now).toBe("string");
  });

  test("as it stood at a turn: what came later is left out, and what was struck or closed later stands open", async () => {
    const { page, first, ids } = await played();
    const then = await page.story({ turn: first.id });
    expect(then.turn).toBe(first.id);
    expect(then.timeline.beat.items.map((b) => [b.id, b.struck])).toEqual([
      ["b:x1", false],
      [ids.beat, false],
    ]);
    expect(then.timeline.scene.items.map((s) => s.closed)).toEqual([false]);
    expect(then.current).toEqual({ chapter: ids.chapter, scene: ids.scene });
    expect(then.model.retcon).toEqual({ items: [], total: 0, before: 0, after: 0 });
  });

  test("bounds each list by the story's setting, counts what it left out, and reads one list further back", async () => {
    const { page, ids, first } = await played({ queryItems: 2 });
    const got = await page.story();
    expect(got.listed).toBe(2);
    // The newest two beats, the oldest left out before them.
    expect(got.timeline.beat.items.map((b) => b.id)).toEqual([ids.beat, ids.later]);
    expect({ total: got.timeline.beat.total, before: got.timeline.beat.before, after: got.timeline.beat.after }).toEqual({ total: 3, before: 1, after: 0 });
    const back = await page.story({ part: "beat", skip: "2" });
    expect(back.timeline.beat.items.map((b) => b.id)).toEqual(["b:x1"]);
    expect({ before: back.timeline.beat.before, after: back.timeline.beat.after }).toEqual({ before: 0, after: 2 });
    // Only the list named is read further back.
    expect(back.model.record.items.map((r) => r.id)).toEqual([`rec:${first.id}`]);
    const everyList = await page.story({ skip: "1" });
    expect(everyList.model.record).toEqual({ items: [], total: 1, before: 0, after: 1 });
    expect(everyList.timeline.beat.items.map((b) => b.id)).toEqual(["b:x1", ids.beat]);
  });

  test("refuses what it cannot read in the story's words, and is not another user's to read", async () => {
    const { page, first } = await played();
    await expect(page.story({}, OTHER)).rejects.toMatchObject({ status: 404, message: words("no_chat", { id: CHAT }) });
    await expect(page.story({ turn: first.id }, OTHER)).rejects.toMatchObject({ status: 404, message: words("no_chat", { id: CHAT }) });
    await expect(page.story({ turn: "turn-nowhere" })).rejects.toMatchObject({ status: 404, message: words("no_turn", { id: "turn-nowhere" }) });
    const parts = "chapter, scene, beat, thread, arc, player, future, canon, retcon, record";
    await expect(page.story({ part: "premise" })).rejects.toMatchObject({ status: 400 });
    await expect(page.story({ skip: "-1" })).rejects.toMatchObject({ status: 400 });
  });
});

describe("striking from the page", () => {
  test("strikes an item as the player's own change on the chat's newest turn, and takes the strike back", async () => {
    const { page, carried, first, second, ids } = await played();
    const done = await page.strike({ id: ids.beat, struck: true, why: "Bram never touched the letter." });
    expect(done.changed).toBe(true);
    expect(done.item).toMatchObject({ id: ids.beat, struck: true, from: 3, to: 3, turn: first.id, by: "author" });
    expect(done.item.writes.at(-1)).toEqual({ turn: null, message: null, imported: false, by: "player", wrote: { drop: true, why: "Bram never touched the letter." } });
    // Read at the chat's newest turn it is struck; as the turn it was recorded on stood, it is not.
    expect((await page.story()).timeline.beat.items.map((b) => [b.id, b.struck])).toEqual([
      ["b:x1", true],
      [ids.beat, true],
      [ids.later, false],
    ]);
    expect((await page.story({ turn: first.id })).timeline.beat.items.map((b) => b.struck)).toEqual([false, false]);
    // Struck already: nothing more is written.
    const again = await page.strike({ id: ids.beat, struck: true });
    expect({ changed: again.changed, writes: again.item.writes.length }).toEqual({ changed: false, writes: 2 });
    // The migration's beat the Author struck is the player's to take back, by the player's own write.
    const back = await page.strike({ id: "b:x1", struck: false });
    expect({ changed: back.changed, struck: back.item.struck, by: back.item.by, last: back.item.writes.at(-1) }).toEqual({ changed: true, struck: false, by: "migration", last: { turn: null, message: null, imported: false, by: "player", wrote: { drop: false } } });
    expect(back.item.turn).toBe(carried.id);
    // A chapter struck is no longer where the chat is, and taking its strike back makes it so again.
    await page.strike({ id: ids.chapter, struck: true });
    expect((await page.story()).current.chapter).toBeNull();
    await page.strike({ id: ids.chapter, struck: false });
    expect((await page.story()).current.chapter).toBe(ids.chapter);
  });

  test("refuses in the story's words for an item the record does not hold, and for what it cannot read; writes nothing", async () => {
    const { page, ids } = await played();
    const rows = (): number => page.t.db.query<{ n: number }, []>("SELECT count(*) AS n FROM change WHERE op LIKE 'story.%'").get()?.n ?? 0;
    const before = rows();
    await expect(page.strike({ id: "b-nowhere", struck: true })).rejects.toMatchObject({ status: 404, message: words("unknown_id", { id: '"b-nowhere"' }) });
    await expect(page.strike({ id: ids.beat, struck: "yes" })).rejects.toMatchObject({ status: 400 });
    await expect(page.strike({ id: 7, struck: true })).rejects.toMatchObject({ status: 400 });
    await expect(page.strike({ id: ids.beat, struck: true, why: ["no"] })).rejects.toMatchObject({ status: 400 });
    // One user's chat is not another's to strike.
    await expect(page.strike({ id: ids.beat, struck: true }, OTHER)).rejects.toMatchObject({ status: 404, message: words("no_chat", { id: CHAT }) });
    expect(rows()).toBe(before);
  });

  test("in a branch with no turn of its own a strike lands on the branch's own line, and the chat it was branched from keeps its record", async () => {
    const { page, ids } = await played();
    const shown = await branchOf(page.t);
    const beats = async (chat: string) => (await page.story({}, USER, chat)).timeline.beat.items.map((b) => [b.id, b.struck]);
    const standing = [
      ["b:x1", true],
      [ids.beat, false],
      [ids.later, false],
    ];
    expect(await beats(CHAT)).toEqual(standing);
    await page.strike({ id: ids.beat, struck: true }, USER, BRANCH);
    expect(await beats(BRANCH)).toEqual([
      ["b:x1", true],
      [ids.beat, true],
      [ids.later, false],
    ]);
    expect(await beats(CHAT)).toEqual(standing);
    // A turn played in the branch afterwards goes on from it.
    await playIn(page.t, shown);
    expect(await beats(BRANCH)).toEqual([
      ["b:x1", true],
      [ids.beat, true],
      [ids.later, false],
    ]);
  });
});

describe("correcting from the page", () => {
  test("a correction of a thread's state and of a scene's summary is the player's own change, kept apart from any turn, and a turn that runs does not stop it", async () => {
    const { page, ids } = await played();
    const thread = await page.correct({ id: ids.thread, fields: { state: "The seal was forged." } });
    expect(thread).toMatchObject({ changed: true, said: [], item: { id: ids.thread, fields: expect.objectContaining({ state: "The seal was forged." }) } });
    expect(thread.item.writes.at(-1)).toMatchObject({ by: "player", wrote: { state: "The seal was forged." } });
    // A turn is under way; the correction is made all the same.
    await page.t.writes.run(() => page.t.s.beginTurn({ chat: CHAT, kind: "new" }));
    const scene = await page.correct({ id: ids.scene, fields: { summary: "Wren hands over the letter." } });
    expect(scene.item.fields.summary).toBe("Wren hands over the letter.");
    const owner = page.t.db.query<{ turn: string; source: string | null }, []>("SELECT turn, source FROM change WHERE op = 'story.write' ORDER BY id DESC LIMIT 2").all();
    expect(owner).toEqual([
      { turn: "", source: "player" },
      { turn: "", source: "player" },
    ]);
  });

  test("in a fresh branch it lands on the branch's own line, and what cannot be read, and an item the record does not hold, are answered in the story's words", async () => {
    const { page, ids } = await played();
    await branchOf(page.t);
    await page.correct({ id: ids.thread, fields: { state: "Forged." } }, USER, BRANCH);
    expect((await page.story({}, USER, BRANCH)).model.thread.items[0]?.fields.state).toBe("Forged.");
    expect((await page.story({}, USER, CHAT)).model.thread.items[0]?.fields.state).toBeUndefined();
    const sent = await page.correct({ id: ids.thread, fields: { kind: "riddle", state: "Still forged.", colour: "red" } });
    expect(sent.said).toEqual([words("unreadable_op", { n: 1, op: "thread", field: "kind", value: '"riddle"', choices: "question, promise, setup", says: "text" }), words("correction_ignored", { id: ids.thread, fields: "colour" })]);
    await expect(page.correct({ id: ids.thread, fields: { colour: "red" } })).rejects.toMatchObject({ status: 400 });
    await expect(page.correct({ id: "b-nowhere", fields: { text: "x" } })).rejects.toMatchObject({ status: 404, message: words("unknown_id", { id: '"b-nowhere"' }) });
  });

  test("a field he sends blank is blanked, where a tool's blank is a field not given", async () => {
    const { page, ids } = await played();
    const done = await page.correct({ id: ids.thread, fields: { state: "" } });
    expect(done).toMatchObject({ changed: true, said: [], item: { id: ids.thread, fields: expect.objectContaining({ state: "" }) } });
    expect(done.item.writes.at(-1)).toMatchObject({ by: "player", wrote: { state: "" } });
  });

  test("a reading of the player is corrected in his words, shown with its writes by the Author and then by the player", async () => {
    const { page, ids } = await played();
    const before = (await page.story()).model.player.items[0] as StoryItemShown;
    const done = await page.correct({ id: before.id, fields: { text: "Enjoys fast, short scenes.", kind: "pacing" } });
    expect(done.item.fields).toMatchObject({ text: "Enjoys fast, short scenes.", kind: "pacing" });
    expect(done.item.writes.map((w) => [w.by, w.wrote.text])).toEqual([...before.writes.map((w) => [w.by, w.wrote.text]), ["player", "Enjoys fast, short scenes."]]);
    expect(ids.thread).not.toBe("");
  });
});

describe("the timeline, the coverage and the story so far", () => {
  test("the timeline pages chapters, scenes and beats as one list in the chat's order, each beat with its scene, its chapter and its messages", async () => {
    const { page, ids } = await played({ queryItems: 2 });
    const first = await page.timeline({ limit: 2 });
    // The carried beat lies before the chapter the first turn opened.
    expect(first.items.map((e) => [e.kind, e.item.id])).toEqual([
      ["beat", "b:x1"],
      ["chapter", ids.chapter],
    ]);
    expect(first.next).toBe(ids.chapter);
    const second = await page.timeline({ limit: 20, after: first.next ?? "" });
    const beat = second.items.find((e) => e.item.id === ids.beat);
    expect(beat).toMatchObject({ kind: "beat", chapter: ids.chapter, scene: ids.scene });
    expect(beat?.messages.length).toBeGreaterThan(0);
    await expect(page.timeline({ limit: 2, after: "b-nowhere" })).rejects.toMatchObject({ status: 409, message: words("timeline_gone", { id: '"b-nowhere"' }) });
  });

  test("the coverage route tells every stretch, with the window's edge and the count of what lies above it that the record does not cover", async () => {
    const { page } = await played();
    const whole = await page.coverage();
    expect(whole.messages).toBe(page.t.shown.length);
    expect(whole.edge).toBeNull();
    expect(whole.above).toBe(0);
    expect(whole.stretches[0]?.from).toBe(0);
    expect(whole.stretches.at(-1)?.to).toBe(whole.messages - 1);
    // A window that keeps the newest two messages: what lies above its edge and is not covered is counted.
    page.window.edge = page.t.shown.at(-2)?.id ?? null;
    const cut = await page.coverage();
    expect(cut.edge).toBe(page.t.shown.length - 2);
    expect(cut.above).toBe(cut.stretches.filter((s) => !s.window && !s.covered).reduce((n, s) => n + (s.to - s.from + 1), 0));
    expect(cut.stretches.every((s) => s.window === s.from >= (cut.edge ?? 0))).toBe(true);
  });
});
