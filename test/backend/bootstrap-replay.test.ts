// The bootstrap's history and what it replaces (DEPTH-PLAN §8.2–§8.4), on a small Port Alder chat with
// fake model answers. Once the run has reached the latest message, what is sent after is play: a mark
// on a card amends and reads nothing past what the run covered, though the chain holds the messages
// sent since; the history ends where depth's play begins, a reply on depth nothing read, or a turn in
// flight. A turn in flight while the run lands holds what it lands, and the run waits for it, so each
// catch-up reads the ones before. A Redo builds on the world without what it replaces: the newcomer
// its chunks meet comes in again, and the redone chapters' notebook revisions and titles land; a
// redone chunk whose new beats later play refuses halts saying to Redo, which Resume can't change.
// What a redone job no longer makes, and every job of a chunk past a shorter end, is retired.

import { describe, expect, test } from "bun:test";
import type { QuietRequest } from "../../src/backend/host";
import type { BootstrapView } from "../../src/shared/bootstrap";
import type { MessageLedger } from "../../src/shared/ledger";
import { mindV2At } from "../../src/shared/character-engine";
import { STORY_PASSAGE } from "../../src/shared/passage";
import type { ChainMessage } from "../../src/engine/ledger/chain";
import { bootstrapEnv, historyEnd } from "../../src/backend/bootstrap/wiring";
import { toChain } from "../../src/backend/ledger-io";
import { readNotebook } from "../../src/backend/depth/notebook";
import { notebookOf } from "../../src/engine/notebook";
import { Rig } from "../support/rig";
import { alderChat, DANNY, fakeModels as mindModels, PRIYA } from "../support/mind-chat";
import { readyLoopback } from "../support/relay";

const PROSE = "The kettle ticked on the stove while the rain worked at the window, and the shop smelled of solder and wet coats. ".repeat(30);

/** A Port Alder chat with history written before depth: three exchanges in three chunks, a newcomer met at h4 and a chapter's end there. */
async function historyChat(rig: Rig): Promise<string> {
  await readyLoopback(rig);
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  const chatId = rig.host.createChat("Morning.");
  const chat = rig.host.chat(chatId);
  const say = (i: number, isUser: boolean, text: string): void => void rig.host.append(chat, { id: `h${i}`, isUser, name: isUser ? "User" : "Narrator", swipes: [text], swipeId: 0, bag: {} });
  say(1, true, "I ask Danny about the lighthouse.");
  say(2, false, `Danny wipes his hands. "It's been dark since spring," he says. ${PROSE}`);
  say(3, true, "I ask Priya who the stranger by the door is.");
  say(4, false, `ROSA A woman named Rosa Vance shakes the rain off her coat. CHAPTER-END ${PROSE}`);
  say(5, true, "I offer to walk Priya home.");
  say(6, false, `Priya laughs and takes her umbrella. ${PROSE}`);
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  rig.body(await rig.send({ type: "lre.settings.set", patch: { depth: { bootstrap: { chunkTokens: 2000 } } } }));
  return chatId;
}

const text = (req: QuietRequest): string => req.messages.map((m) => m.content).join("\n");
const BEAT_IDS = /\bb[0-9a-f]{16,}\b/g;

/** What the fake author answers, per run: who gets a mind, the notebook text for a stretch (null: no file), and a chapter's title. */
interface Author {
  minds: string[];
  notebook: (user: string) => string | null;
  title: string;
}

/** Fake answers by the answer each prompt asks for; `asked` counts the calls per role, and the historian's by the messages it read. `met.rosa` false: the historian no longer meets Rosa Vance at h4. */
function fakeModels(rig: Rig, author: Author, met: { rosa: boolean } = { rosa: true }): { asked: Record<string, number>; read: string[] } {
  const asked: Record<string, number> = {};
  const read: string[] = [];
  const count = (role: string): void => void (asked[role] = (asked[role] ?? 0) + 1);
  rig.host.quietReply = (req) => {
    const all = text(req);
    const user = req.messages.at(-1)?.content ?? "";
    if (all.includes('"drop": true only when')) {
      count("amend");
      return JSON.stringify({ drop: false, what: "AMENDED: Danny tells the player the lamp was sold for scrap.", surface: "Danny, by the counter, saying the lamp was sold.", quotes: "It was sold for scrap.", act: "said", actors: [DANNY], exposure: [{ who: DANNY, channel: "sight", reach: "whole" }, { who: "pov", channel: "sight", reach: "whole" }], why: "He said sold, not dark." });
    }
    if (all.includes('"beats": [{"message"')) {
      count("historian");
      const ids = [...user.matchAll(/^\[([a-z]\d+)\] /gm)].map((m) => m[1] as string);
      read.push(...ids);
      const beats = ids.map((id) => ({
        message: id,
        what: `WHAT ${id}: Danny tells the player the lighthouse has been dark since spring.`,
        surface: `Danny, by the counter, talking about the lighthouse (${id}).`,
        quotes: `It's been dark since spring (${id}).`,
        actors: id === "h4" && user.includes("ROSA") && met.rosa ? [DANNY, "Rosa Vance"] : [DANNY],
        act: "said",
        about: [PRIYA],
        exposure: [
          { who: DANNY, channel: "sight", reach: "whole" },
          { who: PRIYA, channel: "hearing", reach: "partial" },
          { who: "pov", channel: "sight", reach: "whole" },
        ],
      }));
      return JSON.stringify({ beats, staging: [{ who: DANNY, where: "behind the counter", doing: "wiping his hands" }, { who: PRIYA, where: "by the door", doing: "listening" }], newcomers: [], newPlaces: [], switches: [], uncertain: [] });
    }
    if (all.includes('"chapter": {"ends"')) {
      count("author");
      const note = author.notebook(user);
      return JSON.stringify({ files: note === null ? [] : [{ path: "notebook/story.md", text: note }], comments: [], chapter: { ends: user.includes("CHAPTER-END"), title: author.title }, cast: author.minds.map((who) => ({ who, mind: true, why: "At the heart of it." })), uncertain: [], reasoning: "The lamp matters." });
    }
    if (all.includes('"facts": [{"ref"')) {
      count("truthlink");
      return JSON.stringify({ facts: [], links: [], unlinks: [], settle: [] });
    }
    if (all.includes('"agree": [{"entry"')) {
      count("reconcile");
      return JSON.stringify({ agree: [], recorded: [], contradictions: [] });
    }
    if (all.includes('{"povs":')) {
      count("pov");
      return JSON.stringify({ povs: { [PRIYA]: "Muffled words from the counter: something about spring.", [DANNY]: "DANNY-POV: a woman by the door shakes the rain off her coat." } });
    }
    if (all.includes('"memories": [{"lived"')) {
      count("catchup");
      const reached = user.split("## What reached you\n")[1]?.split("\n## ")[0] ?? "";
      const lived = [...new Set(reached.match(BEAT_IDS) ?? [])];
      return JSON.stringify({ memories: lived.length > 0 ? [{ lived, about: [], text: `MEMORY-MARK: what I made of the lighthouse talk (${lived.length} beats)` }] : [], beliefs: "- The lighthouse is dark. I'd swear to it.", people: {}, plans: null });
    }
    if (all.includes('"on_my_mind"')) {
      count("reflect");
      return JSON.stringify({ self: "SELF-MARK: I keep the lamp in mind.", on_my_mind: "The dark lighthouse.", beliefs: null, people: {}, plans: null, planned: [], now: "thoughtful" });
    }
    count("other");
    return "{}";
  };
  return { asked, read };
}

const MINDS: Author = { minds: [DANNY, PRIYA], notebook: (user) => `NOTEBOOK-MARK after ${user.includes("[h6]") ? "the walk home" : "the shop"}.`, title: "The dark lamp" };

async function bootstrap(rig: Rig, chatId: string, op: Record<string, unknown>): Promise<{ view: BootstrapView }> {
  return rig.body(await rig.send({ type: "lre.bootstrap", chatId, ...op })) as { view: BootstrapView };
}

async function finished(rig: Rig, chatId: string): Promise<BootstrapView> {
  await rig.dispatch.bootstraps.idle();
  await rig.host.settle();
  return (await bootstrap(rig, chatId, { op: "status" })).view;
}

async function done(rig: Rig, chatId: string): Promise<BootstrapView> {
  await bootstrap(rig, chatId, { op: "opt", on: true });
  await bootstrap(rig, chatId, { op: "start", cap: "none" });
  const view = await finished(rig, chatId);
  expect(view.status).toBe("done");
  return view;
}

async function head(rig: Rig, chatId: string) {
  const basis = await rig.rt.ledger.basisFor(chatId, rig.host.userId);
  const at = basis ? await rig.rt.ledger.foldAtBasis(chatId, rig.host.userId, basis) : null;
  if (!at) throw new Error("no fold");
  return at;
}

/** The beats on the active chain, by the message each was distilled from. */
async function beatsBy(rig: Rig, chatId: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const p of (await rig.rt.ledger.readStory(chatId, rig.host.userId)).beats) {
    const at = "bootstrap" in p.beat.by ? p.beat.by.bootstrap.message : p.from.messageId;
    out[at] = (out[at] ?? 0) + 1;
  }
  return out;
}

describe("the bootstrap's history", () => {
  test("once the run reached the latest message, what is sent later is play: a beat marked wrong is amended, and nothing past what the run covered is read", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await historyChat(rig);
    const history = rig.host.chat(chatId).messages.map((m) => m.id).sort();
    const { asked, read } = fakeModels(rig, MINDS);
    const first = await done(rig, chatId);
    expect(first.chunks).toEqual({ done: 3, total: 3 });
    const card = first.spot[0];
    const item = card?.items.find((i) => i.kind === "beat");
    if (!card || !item) throw new Error("no beat on a card");
    // Play goes on after the history: the player's message and the reply generated for it, both on the
    // chain the survey reads, so only what the run covered keeps them out of it (the ledger review's H1).
    rig.host.sendUser(chatId, "I ask Danny about the scrapyard.");
    await rig.host.settle();
    const reply = await rig.host.start(chatId, { type: "normal" });
    await rig.host.finish(reply, `The scrapyard is closed on Sundays. ${PROSE}`);
    await rig.host.settle();
    const played = rig.host.chat(chatId).messages.slice(-2).map((m) => m.id);
    expect(rig.host.chat(chatId).messages.at(-1)?.isUser).toBe(false);
    const chain = (await rig.rt.ledger.chainBases(chatId, rig.host.userId)).map((b) => b.message);
    expect(played.filter((id) => chain.includes(id))).toEqual(played);
    // A wrong mark on a finished run starts it again by itself, to amend.
    await bootstrap(rig, chatId, { op: "mark", card: card.id, item: item.id, right: false, note: "He said the lamp was sold." });
    const view = await finished(rig, chatId);
    expect(view.status).toBe("done");
    expect(asked.amend).toBe(1);
    expect(view.chunks).toEqual({ done: 3, total: 3 });
    expect(asked.historian).toBe(3);
    expect([...read].sort()).toEqual(history);
    expect(Object.keys(await beatsBy(rig, chatId)).sort()).toEqual(history);
    // The estimate reads the history as covered too.
    expect((await bootstrap(rig, chatId, { op: "estimate" })).view.chunks.total).toBe(3);
  }, 60_000);

  test("the history ends before the first turn depth played and the player's messages it answered, or before a turn in flight", () => {
    const rec = (types: string[]) => ({ swipes: { "0": { events: types.map((type) => ({ type, data: {} })), post: [] } }, markers: [] }) as unknown as MessageLedger;
    const m = (id: string, isUser: boolean, ledger: MessageLedger | null = null, swipeId = 0): ChainMessage => ({ id, isUser, swipeId, swipes: ["x", "y"], ledger });
    const plain = [m("h1", true), m("h2", false, rec(["set"])), m("h3", true), m("h4", false)];
    expect(historyEnd(plain, new Set(), false)).toBe(4);
    // A depth turn's reply (its shown record holds the narrator's prose), and the player's message it answered, start play.
    const played = [...plain, m("u5", true), m("u6", true), m("d7", false, rec(["story.beat", STORY_PASSAGE])), m("u8", true), m("d9", false)];
    expect(historyEnd(played, new Set(), false)).toBe(4);
    // A depth record on a swipe that isn't shown leaves the reply in the history.
    expect(historyEnd([...plain, m("u5", true), m("d6", false, rec([STORY_PASSAGE]), 1)], new Set(), false)).toBe(6);
    // A reply in the making at the chain's end, or a turn's engine run before its reply exists, is play too; the same reply earlier is history.
    expect(historyEnd([...plain, m("u5", true), m("g6", false)], new Set(["g6"]), false)).toBe(4);
    expect(historyEnd([...plain, m("u5", true)], new Set(), true)).toBe(4);
    expect(historyEnd(plain, new Set(["h2"]), false)).toBe(4);
    // A reply on depth nothing read is play too (`Rec.unread`): one no scene played, before a later depth turn, and a reply written before depth that a Continue on depth added to.
    const unread = (kind: "reply" | "continue") => ({ swipes: { "0": { events: [], post: [], unread: kind } }, markers: [] }) as unknown as MessageLedger;
    expect(historyEnd([...plain, m("u5", true), m("d6", false, unread("reply")), m("u7", true), m("d8", false, rec([STORY_PASSAGE]))], new Set(), false)).toBe(4);
    expect(historyEnd([m("h1", true), m("h2", false, rec(["set"])), m("h3", true), m("h4", false, unread("continue"))], new Set(), false)).toBe(2);
  });

  test("a reply on depth no scene played is never read as history: the survey ends before it and the player's message it answered", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    mindModels(rig);
    const chatId = await alderChat(rig, async () => {}, [DANNY, PRIYA]);
    await rig.turn(chatId, "Morning, Danny.", "Danny looks up from the bench and nods.");
    await readyLoopback(rig);
    rig.body(await rig.send({ type: "lre.bootstrap", chatId, op: "opt", on: true }));
    // Generated off the loopback, the reply commits unread: Not canon.
    await rig.turn(chatId, "I ask Priya how her morning is going.", "Priya says it has been slow, and hands you a coffee.");
    const reply = rig.host.head(chatId);
    if (!reply) throw new Error("no reply");
    const core = await rig.rt.ledger.core(chatId, rig.host.userId);
    expect(core?.chain(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).at(-1)?.ledger?.swipes[String(reply.swipeId)]?.unread).toBe("reply");
    const surveyed = (await bootstrapEnv(rig.rt, chatId, rig.host.userId, () => {}).messages()).map((m) => m.text);
    expect(surveyed).toContain("Danny looks up from the bench and nods.");
    expect(surveyed).not.toContain("Priya says it has been slow, and hands you a coffee.");
    expect(surveyed).not.toContain("I ask Priya how her morning is going.");
  }, 60_000);

  test("a turn in flight while the run lands holds what it lands, and the run waits for it: each catch-up reads the ones before, and no memory is written over", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await historyChat(rig);
    fakeModels(rig, MINDS);
    await bootstrap(rig, chatId, { op: "opt", on: true });
    // The player's turn is in flight as the run starts: its first landing is held.
    const held = Promise.withResolvers<void>();
    const write = rig.host.storage.write;
    rig.host.storage.write = async (path, data, userId) => {
      await write(path, data, userId);
      if (path.endsWith("/layer/held.json.tmp")) held.resolve();
    };
    rig.host.sendUser(chatId, "I wait for the rain to stop.");
    await rig.host.settle();
    const g = await rig.host.start(chatId, { type: "normal" });
    expect(g.halted).toBeUndefined();
    await bootstrap(rig, chatId, { op: "start", cap: "none" });
    await held.promise;
    expect((await rig.rt.ledger.layerSummaries(chatId, rig.host.userId)).length).toBe(0);
    await rig.host.finish(g, "The rain eases off.");
    const view = await finished(rig, chatId);
    expect(view.status).toBe("done");
    expect(view.chunks).toEqual({ done: 3, total: 3 });
    // Danny lived each chunk and kept each memory: none written over by the next catch-up.
    const files = mindV2At((await head(rig, chatId)).state, DANNY).files;
    const memories = Object.entries(files).filter(([rel]) => rel.startsWith("memories/"));
    expect(memories.map(([, meta]) => meta.rev)).toEqual([1, 1, 1]);
    const jobs = (await rig.rt.ledger.layerSummaries(chatId, rig.host.userId)).map((s) => `${s.by?.job ?? ""}:${s.kind}:${s.basis.message}`);
    expect(new Set(jobs).size).toBe(jobs.length);
  }, 60_000);
});

describe("a redo's replacements", () => {
  test("a Redo from chapter 1 reads the world without what it replaces: the newcomer its chunks meet comes in again, and the redone chapters' notebook revisions and titles land", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await historyChat(rig);
    const author: Author = { ...MINDS };
    fakeModels(rig, author);
    await done(rig, chatId);
    const first = await head(rig, chatId);
    expect(Object.values(first.state.entities).some((e) => e.name === "Rosa Vance")).toBe(true);
    expect(notebookOf(first.state).chapters[0]).toMatchObject({ index: 0, title: "The dark lamp" });
    author.notebook = (user) => `REDONE-MARK after ${user.includes("[h6]") ? "the walk home" : "the shop"}.`;
    author.title = "REDONE lamp";
    await bootstrap(rig, chatId, { op: "redo", chapter: 0 });
    await bootstrap(rig, chatId, { op: "resume", cap: "none" });
    const view = await finished(rig, chatId);
    expect(view.status).toBe("done");
    expect(view.log.filter((l) => l.includes("wasn't kept"))).toEqual([]);
    const at = await head(rig, chatId);
    expect(Object.values(at.state.entities).some((e) => e.name === "Rosa Vance")).toBe(true);
    expect((await readNotebook(rig.rt, rig.host.userId, at.state)).files["notebook/story.md"]).toBe("REDONE-MARK after the walk home.");
    // The redone chapter's close lands too: chapter 1 takes the redo's title (the ledger review's H3).
    expect(notebookOf(at.state).chapters[0]).toMatchObject({ index: 0, title: "REDONE lamp" });
    // Every beat once, at its own message, as the redo read it.
    expect(await beatsBy(rig, chatId)).toEqual({ [rig.host.chat(chatId).messages[0]?.id ?? ""]: 1, h1: 1, h2: 1, h3: 1, h4: 1, h5: 1, h6: 1 });
    expect((await rig.rt.ledger.readStory(chatId, rig.host.userId)).duplicates).toEqual([]);
  }, 90_000);

  test("a Redo whose chunk's new beats later play refuses halts saying so and offering a Redo, never that Resume tries again; Resume lands the same reading and meets the same", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await historyChat(rig);
    const met = { rosa: true };
    fakeModels(rig, MINDS, met);
    await done(rig, chatId);
    const rosa = Object.entries((await head(rig, chatId)).state.entities).find(([, e]) => e.name === "Rosa Vance")?.[0];
    if (!rosa) throw new Error("the run met no Rosa Vance");
    // Play after the history stands on her: the GM edits her at the latest message.
    rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "set", entity: rosa, field: "description", value: "A sailor's widow from the point." }] }));
    // The redo's historian no longer meets her, so its beats for her chunk would take her out from under that edit.
    met.rosa = false;
    await bootstrap(rig, chatId, { op: "redo", chapter: 0 });
    await bootstrap(rig, chatId, { op: "resume", cap: "none" });
    const halted = await finished(rig, chatId);
    expect(halted.status).toBe("paused");
    expect(halted.reason).toContain("beats, read again, can't take the place of what the run landed for it before (a later turn no longer folds with it");
    expect(halted.reason).toContain("Redo from chapter 1, perhaps with other models for the historian");
    expect(halted.reason).not.toContain("Resume tries again");
    expect(halted.redoFrom).toBe(0);
    // Resume asks nothing again and meets the same refusal; the Redo is still offered, and the old reading, Rosa with it, still stands.
    await bootstrap(rig, chatId, { op: "resume", cap: "none" });
    const again = await finished(rig, chatId);
    expect([again.status, again.reason, again.redoFrom]).toEqual(["paused", halted.reason, 0]);
    expect((await head(rig, chatId)).state.entities[rosa]?.name).toBe("Rosa Vance");
  }, 90_000);

  test("a Redo retires what its jobs no longer make: one the author no longer gives a mind keeps none of the old run's, and a revision the author no longer writes is gone", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await historyChat(rig);
    const author: Author = { ...MINDS };
    fakeModels(rig, author);
    await done(rig, chatId);
    expect(Object.keys(mindV2At((await head(rig, chatId)).state, PRIYA).files).length).toBeGreaterThan(0);
    const before = new Set((await rig.rt.ledger.layerSummaries(chatId, rig.host.userId)).map((s) => s.id));
    // The redo's author gives only Danny a mind, and writes nothing for the first stretch.
    author.minds = [DANNY];
    author.notebook = (user) => (user.includes("[h1]") ? null : `REDONE-MARK after ${user.includes("[h6]") ? "the walk home" : "the shop"}.`);
    await bootstrap(rig, chatId, { op: "redo", chapter: 0 });
    await bootstrap(rig, chatId, { op: "resume", cap: "none" });
    expect((await finished(rig, chatId)).status).toBe("done");
    const at = await head(rig, chatId);
    expect(mindV2At(at.state, PRIYA).files).toEqual({});
    expect(Object.keys(mindV2At(at.state, DANNY).files).length).toBeGreaterThan(0);
    // Nothing the first run landed folds any more: each was replaced or retired.
    const summaries = await rig.rt.ledger.layerSummaries(chatId, rig.host.userId);
    const superseded = new Set(summaries.flatMap((s) => s.supersedes ?? []));
    expect([...before].filter((id) => !superseded.has(id))).toEqual([]);
    // The first stretch's revision is replaced by an entry that holds nothing.
    const redone = summaries.filter((s) => s.kind === "bootstrap.redone");
    expect(redone.some((s) => s.by?.job === "author:0" && s.events === 0)).toBe(true);
  }, 90_000);

  test("a re-cut into fewer chunks retires every job of the chunks past its end: each message's beats come from one job", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await historyChat(rig);
    const { asked } = fakeModels(rig, MINDS);
    await done(rig, chatId);
    // Deleting h4 leaves h3, h5 and h6 one stretch: two chunks where there were three.
    rig.host.deleteMessage(chatId, "h4");
    await rig.host.settle();
    await bootstrap(rig, chatId, { op: "resume", cap: "none" });
    const view = await finished(rig, chatId);
    expect(view.status).toBe("done");
    expect(view.chunks).toEqual({ done: 2, total: 2 });
    expect(asked.historian).toBe(4);
    expect(await beatsBy(rig, chatId)).toEqual({ [rig.host.chat(chatId).messages[0]?.id ?? ""]: 1, h1: 1, h2: 1, h3: 1, h5: 1, h6: 1 });
    // What the third chunk's jobs landed folds no more: its catch-ups' memories of h5 and h6 are retired with it.
    const summaries = await rig.rt.ledger.layerSummaries(chatId, rig.host.userId);
    const superseded = new Set(summaries.flatMap((s) => s.supersedes ?? []));
    const third = summaries.filter((s) => /^[a-z]+:2(:|$)/.test(s.by?.job ?? ""));
    expect(third.length).toBeGreaterThan(0);
    expect(third.filter((s) => !superseded.has(s.id))).toEqual([]);
  }, 90_000);
});
