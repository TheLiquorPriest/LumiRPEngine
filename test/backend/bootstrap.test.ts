// The bootstrap (DEPTH-PLAN §8) end to end on a small Port Alder chat, with fake model answers: the
// survey's chunks, the historian's beats landing at their own messages, minds formed from each
// character's experience, the author's notebook and chapters, the import's reconciliation (LumiBooks'
// book among it) and the spot checks, the D-18 advice; a kill mid-chunk that resumes with no duplicate
// entry and no model call asked twice; a beat marked wrong, amended and lived again; a switch of
// player character and a new place inside the history (D-10); the room rule of every stage of long
// answers (the historian, the author, the catch-ups and reflections, the truth link): the most a room
// may be unless the user set its role's own, an answer cut off at it asked once more at twice it and,
// cut again, pausing the run with what both spent, a refusal in words no limit is read from asked
// again at the role's own room and, refused there too, pausing the run naming that room's setting;
// and the historian's answer: a beat of speech's exact words in its quotes, and
// a new place listed under a listed place's name bound to that place.

import { describe, expect, test } from "bun:test";
import type { QuietRequest } from "../../src/backend/host";
import type { BootstrapEstimate, BootstrapView } from "../../src/shared/bootstrap";
import type { LayerDraft } from "../../src/shared/layer";
import { drewOn, mindMetaAt, mindV2At, MIND_POV, povOf, reachOf, type MindFileMeta, type RecallDoc } from "../../src/shared/character-engine";
import { CHARACTER_TEXT, CORE_WORLD } from "../../src/shared/character-prompts";
import { mindEdit, readMind, recallFor } from "../../src/backend/character-engine";
import { readNotebook } from "../../src/backend/depth/notebook";
import { historian } from "../../src/backend/depth/historian";
import { roomAgain, type ModelPort } from "../../src/backend/depth/port";
import { DEPTH_ROOM_MOST, defaultDepthSettings, depthSettingsOf, ownRoom } from "../../src/shared/depth-settings";
import { modernUsWorld } from "../packs/riverton";
import { startState } from "../packs/support";
import { Rig } from "../support/rig";
import { DANNY, PRIYA } from "../support/mind-chat";
import { readyLoopback } from "../support/relay";

const PROSE = "The kettle ticked on the stove while the rain worked at the window, and the shop smelled of solder and wet coats. ".repeat(30);

/** A Port Alder chat with history written before depth: three exchanges, a summary core kept, a newcomer met and a chapter's end; its user's loopback ready, so it may opt in. */
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
  chat.metadata.loom_summary = "Danny swore the lighthouse lamp was sold for scrap.";
  // LumiBooks' book for this chat, marked as LumiBooks marks its own and not attached to the chat: memory, never lore.
  const lumi = rig.host.userBook("Port Alder chronicle", { metadata: { lumibooks_chat_id: chatId } });
  await rig.host.books.createEntry(lumi, { comment: "Chapter 1", content: "LUMIBOOKS-MARK: Danny talked about the lighthouse.", keys: ["lighthouse"], disabled: false, constant: true, position: 0, depth: 4, role: null, order: 100, extensions: {} }, rig.host.userId);
  chat.metadata.lumibooks_book_id = lumi;
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  rig.body(await rig.send({ type: "lre.settings.set", patch: { depth: { bootstrap: { chunkTokens: 2000 } } } }));
  return chatId;
}

const text = (req: QuietRequest): string => req.messages.map((m) => m.content).join("\n");
const BEAT_IDS = /\bb[0-9a-f]{16,}\b/g;

/** Fake answers by the answer each prompt asks for; `asked` counts the calls per role. `switchAt`: the player starts playing Priya at that message; `placeAt`: that message's beat happens at a new place; `drop`: the author strikes a beat marked wrong. */
function fakeModels(rig: Rig, o: { switchAt?: string; placeAt?: string; drop?: boolean; core?: string } = {}): Record<string, number> {
  const asked: Record<string, number> = {};
  const count = (role: string): void => void (asked[role] = (asked[role] ?? 0) + 1);
  rig.host.quietReply = (req) => {
    const all = text(req);
    const user = req.messages.at(-1)?.content ?? "";
    if (all.includes('"drop": true only when')) {
      count("amend");
      if (o.drop) return JSON.stringify({ drop: true, why: "The message holds no such beat." });
      return JSON.stringify({ drop: false, what: "AMENDED: Danny tells the player the lamp was sold for scrap.", surface: "Danny, by the counter, saying the lamp was sold.", quotes: "It was sold for scrap.", act: "said", actors: [DANNY], exposure: [{ who: DANNY, channel: "sight", reach: "whole" }, { who: PRIYA, channel: "hearing", reach: "whole" }, { who: "pov", channel: "sight", reach: "whole" }], why: "He said sold, not dark." });
    }
    if (all.includes('"beats": [{"message"')) {
      count("historian");
      const ids = [...user.matchAll(/^\[(h\d+|m\d+)\] /gm)].map((m) => m[1] as string);
      const beats = ids.map((id) => ({
        message: id,
        ...(id === o.placeAt ? { place: "new:the_lighthouse" } : {}),
        what: `WHAT ${id}: Danny tells the player the lighthouse has been dark since spring.`,
        surface: `Danny, by the counter, talking about the lighthouse (${id}).`,
        quotes: `It's been dark since spring (${id}).`,
        actors: user.includes(`[${id}]`) && user.includes("ROSA") && id === "h4" ? [DANNY, "Rosa Vance"] : [DANNY],
        act: "said",
        about: [PRIYA],
        exposure: [
          { who: DANNY, channel: "sight", reach: "whole" },
          { who: PRIYA, channel: "hearing", reach: "partial" },
          { who: "pov", channel: "sight", reach: "whole" },
        ],
      }));
      return JSON.stringify({
        beats,
        staging: [{ who: DANNY, where: "behind the counter", doing: "wiping his hands" }, { who: PRIYA, where: "by the door", doing: "listening" }],
        newcomers: [],
        newPlaces: o.placeAt !== undefined && ids.includes(o.placeAt) ? [{ ref: "new:the_lighthouse", name: "The Lighthouse", note: "the dark lighthouse on the point" }] : [],
        switches: o.switchAt !== undefined && ids.includes(o.switchAt) ? [{ message: o.switchAt, who: PRIYA }] : [],
        uncertain: [],
      });
    }
    if (all.includes('"chapter": {"ends"')) {
      count("author");
      return JSON.stringify({ files: [{ path: "notebook/story.md", text: `NOTEBOOK-MARK after ${user.includes("[h6]") ? "the walk home" : "the shop"}.` }], comments: [], chapter: { ends: user.includes("CHAPTER-END"), title: "The dark lamp" }, cast: [{ who: DANNY, mind: true, why: "He is at the heart of it.", ...(o.core !== undefined ? { core: o.core } : {}) }, { who: PRIYA, mind: true, why: "She is always there." }], uncertain: [], reasoning: "The lamp matters." });
    }
    if (all.includes('"facts": [{"ref"')) {
      count("truthlink");
      return JSON.stringify({ facts: [], links: [], unlinks: [], settle: [] });
    }
    if (all.includes('"agree": [{"entry"')) {
      count("reconcile");
      const beat = user.match(BEAT_IDS)?.[0] ?? "";
      const lumi = user.match(/lumibooks:(\S+)/)?.[1];
      return JSON.stringify({ agree: [], recorded: [], contradictions: [{ entry: `summary:${user.match(/summary:(\S+)/)?.[1] ?? ""}`, against: beat, why: "The summary says the lamp was sold; the beats say it went dark." }, ...(lumi ? [{ entry: `lumibooks:${lumi}`, against: beat, why: "The chronicle has him talking; the beats have it dark." }] : [])] });
    }
    if (all.includes('{"povs":')) {
      count("pov");
      return JSON.stringify({ povs: { [PRIYA]: "Muffled words from the counter: something about spring.", [DANNY]: "DANNY-POV: a woman by the door shakes the rain off her coat." } });
    }
    if (all.includes('"memories": [{"lived"')) {
      count("catchup");
      // What reached it (each message's marks among it), and the files it is asked to rewrite, each rewritten from that alone.
      const reached = user.split("## What reached you\n")[1]?.split("\n## ")[0] ?? "";
      const lived = [...new Set(reached.match(BEAT_IDS) ?? [])];
      const marks = [...new Set(reached.match(/\([hm]\d+\)/g) ?? [])].join(" ");
      const rewrite = [...user.matchAll(/^### (\S+\.md)$/gm)].map((m) => m[1] as string);
      return JSON.stringify({
        memories: lived.length > 0 ? [{ lived, about: [], text: `MEMORY-MARK: what I made of the lighthouse talk (${lived.length} beats) ${marks}` }] : [],
        beliefs: "- The lighthouse is dark. I'd swear to it.",
        people: {},
        plans: null,
        ...(rewrite.length > 0 ? { rewrites: Object.fromEntries(rewrite.map((path) => [path, { verdict: "rewrite", text: `REWRITE-MARK: as it stands now ${marks}` }])) } : {}),
      });
    }
    if (all.includes('"on_my_mind"')) {
      count("reflect");
      return JSON.stringify({ self: "SELF-MARK: I keep the lamp in mind.", on_my_mind: "The dark lighthouse.", beliefs: null, people: {}, plans: null, planned: [], now: "thoughtful" });
    }
    count("other");
    return "{}";
  };
  return asked;
}

/** What `who` recalls that holds message `message`'s own words (each beat's surface and quotes carry its mark), over everything it may recall, and its files whose latest write drew on `beat`. */
async function oldOf(rig: Rig, chatId: string, who: string, beat: string, message: string): Promise<{ recalled: RecallDoc[]; drew: Record<string, MindFileMeta> }> {
  const hits = await recallFor(rig.rt, chatId, rig.host.userId, who, `lighthouse dark spring ${message}`, { limit: 1000 });
  const basis = await rig.rt.ledger.basisFor(chatId, rig.host.userId);
  const at = basis ? await rig.rt.ledger.foldAtBasis(chatId, rig.host.userId, basis) : null;
  if (!at) throw new Error("no fold");
  const mind = mindV2At(at.state, who);
  return { recalled: hits.map((h) => h.doc).filter((d) => d.text.includes(`(${message})`)), drew: Object.fromEntries(drewOn(mind, new Set([beat])).flatMap((rel) => (mind.files[rel] ? [[rel, mind.files[rel]] as const] : []))) };
}

async function bootstrap(rig: Rig, chatId: string, op: Record<string, unknown>): Promise<{ view: BootstrapView; estimate?: unknown }> {
  return rig.body(await rig.send({ type: "lre.bootstrap", chatId, ...op })) as { view: BootstrapView; estimate?: unknown };
}

async function finished(rig: Rig, chatId: string): Promise<BootstrapView> {
  await rig.dispatch.bootstraps.idle();
  await rig.host.settle();
  return (await bootstrap(rig, chatId, { op: "status" })).view;
}

describe("bootstrap", () => {
  test("a small starter-world chat bootstraps end to end with fake model answers", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await historyChat(rig);
    const asked = fakeModels(rig);
    const opted = await bootstrap(rig, chatId, { op: "opt", on: true });
    expect(opted.view.optedIn).toBe(true);
    expect(opted.estimate).toBeDefined();
    expect(opted.view.remaining?.chunks).toBe(3);
    expect(opted.view.remaining?.total.calls).toBeGreaterThan(0);
    await bootstrap(rig, chatId, { op: "start", cap: "none" });
    const view = await finished(rig, chatId);
    expect(view.reason).toBeNull();
    expect(view.status).toBe("done");
    expect(view.chunks).toEqual({ done: 3, total: 3 });
    // The author ended a chapter at the newcomer's message; the last one closed where the history ends.
    expect(view.chapters.map((c) => [c.chunks, c.ended])).toEqual([
      [[0, 1], true],
      [[2, 2], true],
    ]);
    expect(asked.historian).toBe(3);
    // Each beat landed at its own source message, the partial reach with its point of view; nothing twice.
    const story = await rig.rt.ledger.readStory(chatId, rig.host.userId);
    expect(story.duplicates).toEqual([]);
    const messages = story.beats.map((p) => ("bootstrap" in p.beat.by ? p.beat.by.bootstrap.message : null));
    expect(new Set(messages)).toEqual(new Set(["h1", "h2", "h3", "h4", "h5", "h6", messages.find((m) => m?.startsWith("m")) ?? "?"]));
    expect(story.beats.every((p) => p.beat.exposure.find((e) => e.who === PRIYA)?.pov !== undefined)).toBe(true);
    // The newcomer's beat reached Danny whole, but she is a stranger to him: it reached him through his own point of view, which tells her as she appears.
    const rosa = story.beats.find((p) => p.beat.actors.some((a) => a.startsWith("bs_")))?.beat;
    const seen = rosa?.exposure.find((e) => e.who === DANNY);
    expect(seen?.reach).toBe("whole");
    expect(seen?.pov).toBeDefined();
    expect(rosa ? reachOf(rosa, DANNY)?.text : undefined).toBe(seen?.pov);
    // Minds formed from what each lived; the player character has none; the newcomer is in the world; the notebook was written.
    const basis = await rig.rt.ledger.basisFor(chatId, rig.host.userId);
    const at = basis ? await rig.rt.ledger.foldAtBasis(chatId, rig.host.userId, basis) : null;
    if (!at) throw new Error("no fold");
    const danny = await readMind(rig.rt.blobs, rig.host.userId, at.state, DANNY);
    expect(Object.entries(danny).some(([path, t]) => path.startsWith("memories/") && t.includes("MEMORY-MARK"))).toBe(true);
    expect(danny["self.md"] ?? "").toContain("SELF-MARK");
    expect(Object.keys(mindMetaAt(at.state, "pov"))).toEqual([]);
    expect(Object.values(at.state.entities).some((e) => e.name === "Rosa Vance")).toBe(true);
    expect((await readNotebook(rig.rt, rig.host.userId, at.state)).files["notebook/story.md"]).toContain("the walk home");
    // The summary was imported and reconciled: its contradiction waits on a spot-check card beside sampled beats.
    expect(view.imported.find((v) => v.source === "summary")?.entries).toBe(1);
    const items = view.spot.flatMap((c) => c.items);
    expect(items.some((i) => i.kind === "contradiction")).toBe(true);
    expect(items.some((i) => i.kind === "beat" && i.prose.includes("lighthouse"))).toBe(true);
    // LumiBooks' book for this chat, not attached to it, was read as memory and reconciled: its contradiction waits too.
    expect(view.imported.find((v) => v.source === "lumibooks")?.entries).toBe(1);
    expect(items.some((i) => i.kind === "contradiction" && i.source === "lumibooks")).toBe(true);
    // D-18: advise turning off what the bootstrap replaced, nothing more.
    expect(view.advice.find((a) => a.system === "summary")?.found).toBe(true);
    expect(view.advice.find((a) => a.system === "lumibooks")?.found).toBe(true);
    // A mark on the card is kept; a rerun lands nothing new and asks nothing.
    const card = view.spot[0];
    const item = card?.items[0];
    if (!card || !item) throw new Error("no card");
    const marked = await bootstrap(rig, chatId, { op: "mark", card: card.id, item: item.id, right: true });
    expect(marked.view.spot.find((c) => c.id === card.id)?.items.find((i) => i.id === item.id)?.mark?.right).toBe(true);
    const entries = (await rig.rt.ledger.layerSummaries(chatId, rig.host.userId)).length;
    const calls = Object.values(asked).reduce((a, b) => a + b, 0);
    await bootstrap(rig, chatId, { op: "resume" });
    expect((await finished(rig, chatId)).status).toBe("done");
    expect((await rig.rt.ledger.layerSummaries(chatId, rig.host.userId)).length).toBe(entries);
    expect(Object.values(asked).reduce((a, b) => a + b, 0)).toBe(calls);
  }, 60_000);

  test("a kill mid-chunk resumes with no duplicate entry and asks no model twice", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await historyChat(rig);
    const asked = fakeModels(rig);
    await bootstrap(rig, chatId, { op: "opt", on: true });
    // The second landing of the run (the first chunk's catch-ups, answered and recorded) dies.
    const land = rig.rt.ledger.landLayers.bind(rig.rt.ledger);
    let landings = 0;
    rig.rt.ledger.landLayers = async (c: string, u: string, drafts: readonly LayerDraft[]) => {
      if (++landings === 2) throw new Error("killed");
      return land(c, u, drafts);
    };
    await bootstrap(rig, chatId, { op: "start", cap: "none" });
    const killed = await finished(rig, chatId);
    expect(killed.status).toBe("paused");
    expect(killed.chunks.done).toBe(0);
    const before = { ...asked };
    // The process restarts over the same storage and resumes.
    const again = rig.restart();
    const asked2 = fakeModels(again);
    const resumed = await bootstrap(again, chatId, { op: "status" });
    expect(resumed.view.status).toBe("paused");
    await bootstrap(again, chatId, { op: "resume" });
    const view = await finished(again, chatId);
    expect(view.status).toBe("done");
    // Recorded answers were landed, not asked again: the first chunk's historian and catch-ups once in all.
    expect((before.historian ?? 0) + (asked2.historian ?? 0)).toBe(3);
    expect(before.catchup ?? 0).toBe(2);
    expect((before.catchup ?? 0) + (asked2.catchup ?? 0)).toBe(6);
    const summaries = await again.rt.ledger.layerSummaries(chatId, again.host.userId);
    expect(new Set(summaries.map((s) => s.id)).size).toBe(summaries.length);
    // One entry per job, kind and message: every beat once, every catch-up once.
    const jobs = summaries.map((s) => `${s.by?.job ?? ""}:${s.kind}:${s.basis.message}`);
    expect(new Set(jobs).size).toBe(jobs.length);
    const story = await again.rt.ledger.readStory(chatId, again.host.userId);
    expect(story.duplicates).toEqual([]);
    expect(story.beats.length).toBe(7);
  }, 60_000);

  test("a beat marked wrong is amended at its own message, and the characters who lived it live the corrected beat", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await historyChat(rig);
    const asked = fakeModels(rig);
    await bootstrap(rig, chatId, { op: "opt", on: true });
    await bootstrap(rig, chatId, { op: "start", cap: "none" });
    const done = await finished(rig, chatId);
    const card = done.spot[0];
    const item = card?.items.find((i) => i.kind === "beat");
    if (!card || !item || item.kind !== "beat") throw new Error("no beat on a card");
    const catchups = asked.catchup ?? 0;
    // Before the mark, Danny recalls the beat as it was, from its own words and from a file that drew on it beside other beats.
    const was = await oldOf(rig, chatId, DANNY, item.beat, item.message);
    expect(was.recalled.some((d) => d.kind === "lived")).toBe(true);
    expect(was.recalled.some((d) => d.kind === "file")).toBe(true);
    expect(Object.values(was.drew).some((m) => m.lived.length > 1)).toBe(true);
    // Marked wrong on a finished run: the run starts again for the amendment.
    await bootstrap(rig, chatId, { op: "mark", card: card.id, item: item.id, right: false, note: "He said the lamp was sold, not dark." });
    const view = await finished(rig, chatId);
    expect(view.status).toBe("done");
    expect(asked.amend).toBe(1);
    // The corrected beat stands at the same message in the old one's place.
    const story = await rig.rt.ledger.readStory(chatId, rig.host.userId);
    const by = story.replaced.find((r) => r.id === item.beat)?.by;
    if (typeof by !== "string") throw new Error("the beat wasn't superseded by a beat");
    const amended = story.beats.find((p) => p.beat.id === by)?.beat;
    if (!amended) throw new Error("no amended beat");
    expect("bootstrap" in amended.by ? amended.by.bootstrap.message : null).toBe(item.message);
    expect(amended.supersedes).toEqual([item.beat]);
    expect(await rig.rt.blobs.get(rig.host.userId, amended.what)).toContain("AMENDED");
    // Both characters with a mind lived it again; what they wrote from the old beat is superseded in their minds.
    expect((asked.catchup ?? 0) - catchups).toBe(2);
    const basis = await rig.rt.ledger.basisFor(chatId, rig.host.userId);
    const at = basis ? await rig.rt.ledger.foldAtBasis(chatId, rig.host.userId, basis) : null;
    if (!at) throw new Error("no fold");
    for (const who of [DANNY, PRIYA]) {
      expect(mindV2At(at.state, who).superseded[item.beat]).toBe(true);
      expect(mindV2At(at.state, who).lived[by]).toBe(true);
    }
    // Every file that drew on the old beat was rewritten at the same path, and recall never gives the old beat back.
    for (const who of [DANNY, PRIYA]) {
      const after = await oldOf(rig, chatId, who, item.beat, item.message);
      expect(after.recalled).toEqual([]);
      expect(after.drew).toEqual({});
    }
    const files = mindV2At(at.state, DANNY).files;
    for (const [rel, m] of Object.entries(was.drew)) {
      expect(files[rel]?.rev).toBeGreaterThan(m.rev);
      expect(files[rel]?.supersedes).toBe(item.beat);
    }
  }, 60_000);

  test("a beat marked wrong and struck: whoever lived it rewrites what they wrote from it at the same path, and recall never returns it", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await historyChat(rig);
    const asked = fakeModels(rig, { drop: true });
    await bootstrap(rig, chatId, { op: "opt", on: true });
    await bootstrap(rig, chatId, { op: "start", cap: "none" });
    const done = await finished(rig, chatId);
    const card = done.spot[0];
    const item = card?.items.find((i) => i.kind === "beat");
    if (!card || !item || item.kind !== "beat") throw new Error("no beat on a card");
    const was = await oldOf(rig, chatId, DANNY, item.beat, item.message);
    expect(was.recalled.some((d) => d.kind === "file")).toBe(true);
    const catchups = asked.catchup ?? 0;
    await bootstrap(rig, chatId, { op: "mark", card: card.id, item: item.id, right: false, note: "Danny never said that." });
    const view = await finished(rig, chatId);
    expect(view.status).toBe("done");
    const story = await rig.rt.ledger.readStory(chatId, rig.host.userId);
    expect(typeof story.replaced.find((r) => r.id === item.beat)?.by).toBe("object");
    // Both lived it and wrote from it: each rewrites, with nothing new to live.
    expect((asked.catchup ?? 0) - catchups).toBe(2);
    for (const who of [DANNY, PRIYA]) {
      const after = await oldOf(rig, chatId, who, item.beat, item.message);
      expect(after.recalled).toEqual([]);
      expect(after.drew).toEqual({});
    }
    const basis = await rig.rt.ledger.basisFor(chatId, rig.host.userId);
    const at = basis ? await rig.rt.ledger.foldAtBasis(chatId, rig.host.userId, basis) : null;
    if (!at) throw new Error("no fold");
    const files = mindV2At(at.state, DANNY).files;
    for (const [rel, m] of Object.entries(was.drew)) expect(files[rel]?.rev).toBeGreaterThan(m.rev);
    expect(view.log.some((l) => l.includes("rewrote what they wrote from it"))).toBe(true);
  }, 60_000);

  test("a switch of player character inside the history lands at its message, the new one lives only what came before it, and a new place is made", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await historyChat(rig);
    const asked = fakeModels(rig, { switchAt: "h6", placeAt: "h5" });
    await bootstrap(rig, chatId, { op: "opt", on: true });
    await bootstrap(rig, chatId, { op: "start", cap: "none" });
    const view = await finished(rig, chatId);
    expect(view.status).toBe("done");
    expect(view.log.filter((l) => l.includes("wasn't kept"))).toEqual([]);
    const basis = await rig.rt.ledger.basisFor(chatId, rig.host.userId);
    const at = basis ? await rig.rt.ledger.foldAtBasis(chatId, rig.host.userId, basis) : null;
    if (!at) throw new Error("no fold");
    // From h6 on the player plays Priya: the switch landed at h6, and she is the player character now.
    const switches = (await rig.rt.ledger.layerSummaries(chatId, rig.host.userId)).filter((s) => s.kind === MIND_POV);
    expect(switches.map((s) => s.basis.message)).toEqual(["h6"]);
    expect(povOf(at.world, at.state)).toBe(PRIYA);
    const story = await rig.rt.ledger.readStory(chatId, rig.host.userId);
    const byMessage = new Map(story.beats.flatMap((p) => ("bootstrap" in p.beat.by ? [[p.beat.by.bootstrap.message, p.beat] as const] : [])));
    const h5 = byMessage.get("h5");
    const h6 = byMessage.get("h6");
    if (!h5 || !h6) throw new Error("no beats at h5 and h6");
    // She lived h5's beat before she was played, never h6's; Danny lived both. She has no agent to reflect at the history's end.
    expect(mindV2At(at.state, PRIYA).lived[h5.id]).toBe(true);
    expect(mindV2At(at.state, PRIYA).lived[h6.id]).toBeUndefined();
    expect(h6.exposure.find((e) => e.who === PRIYA)?.pending).toBeUndefined();
    expect(mindV2At(at.state, DANNY).lived[h6.id]).toBe(true);
    expect(asked.reflect).toBe(3);
    // The lighthouse, a place the world didn't have, was made, and h5's beat happens there.
    const lighthouse = Object.values(at.world.places).find((p) => p.name === "The Lighthouse");
    expect(lighthouse).toBeDefined();
    expect(h5.place).toBe(lighthouse?.id ?? "");
  }, 60_000);

  test("every stage of long answers asks for the most room a room may be where the user set its role none, and the room he set otherwise; the point-of-view render asks its role's own", async () => {
    const shipped = defaultDepthSettings();
    expect(ownRoom(shipped, "historian")).toBeNull();
    // A model of its own whose room is still its default, or the strong model's, is no room the user set.
    expect(ownRoom(depthSettingsOf({ roles: { historian: { uses: "own", own: { connectionId: "conn-ds" } } } }), "historian")).toBeNull();
    expect(ownRoom(depthSettingsOf({ strong: { maxTokens: 4096 }, roles: { author: { uses: "strong" } } }), "author")).toBeNull();
    expect(ownRoom(depthSettingsOf({ roles: { historian: { uses: "own", own: { maxTokens: 1024 } } } }), "historian")).toBe(1024);
    const rig = new Rig({ shipped: true });
    const chatId = await historyChat(rig);
    // The Author on a room of its own the user set.
    rig.body(await rig.send({ type: "lre.settings.set", patch: { depth: { roles: { author: { uses: "own", own: { maxTokens: 50_000 } } } } } }));
    const asked = fakeModels(rig);
    const answer = rig.host.quietReply;
    const rooms: Record<string, (number | undefined)[]> = {};
    const stageOf = (all: string): string => (all.includes('"beats": [{"message"') ? "historian" : all.includes('"chapter": {"ends"') ? "author" : all.includes('"drift": [{"who"') ? "chapter" : all.includes('"facts": [{"ref"') ? "truthlink" : all.includes('"memories": [{"lived"') ? "catchup" : all.includes('"on_my_mind"') ? "reflect" : all.includes('{"povs":') ? "pov" : "other");
    rig.host.quietReply = (req) => {
      (rooms[stageOf(text(req))] ??= []).push(req.maxTokens);
      return answer ? answer(req) : "{}";
    };
    await bootstrap(rig, chatId, { op: "opt", on: true });
    await bootstrap(rig, chatId, { op: "start", cap: "none" });
    expect((await finished(rig, chatId)).status).toBe("done");
    expect(rooms.historian?.length).toBe(3);
    for (const stage of ["historian", "truthlink", "catchup", "reflect"]) expect([stage, new Set(rooms[stage] ?? [])]).toEqual([stage, new Set([DEPTH_ROOM_MOST])]);
    // The author's readings and its chapter revisions, at the room the user set it.
    expect(rooms.author?.length).toBe(asked.author);
    expect((rooms.chapter?.length ?? 0) > 0).toBe(true);
    expect(new Set([...(rooms.author ?? []), ...(rooms.chapter ?? [])])).toEqual(new Set([50_000]));
    // A point of view is no long answer: the Fast model's room, as its role has it.
    expect((rooms.pov?.length ?? 0) > 0).toBe(true);
    expect(new Set(rooms.pov)).toEqual(new Set([defaultDepthSettings().fast.maxTokens]));
  }, 60_000);

  test("the historian's first room, refused in words no limit is read from, is asked again at its role's own room; refused there too, the run pauses naming Settings → Depth → Historian's answer room, which Resume then asks first", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await historyChat(rig);
    fakeModels(rig);
    const answer = rig.host.quietReply;
    const own = defaultDepthSettings().strong.maxTokens;
    let takes = own;
    const rooms: (number | undefined)[] = [];
    rig.host.quietReply = (req) => {
      if (text(req).includes('"beats": [{"message"')) {
        rooms.push(req.maxTokens);
        if (req.maxTokens > takes) throw new Error("Custom stream failed (422): the request can't be processed as sent");
      }
      return answer ? answer(req) : "{}";
    };
    await bootstrap(rig, chatId, { op: "opt", on: true });
    await bootstrap(rig, chatId, { op: "start", cap: "none" });
    expect((await finished(rig, chatId)).status).toBe("done");
    // Each stretch refused at the most room, and answered at the Historian's own (the Strong model's).
    expect(rooms).toEqual([DEPTH_ROOM_MOST, own, DEPTH_ROOM_MOST, own, DEPTH_ROOM_MOST, own]);
    // A provider that takes less than the role's own room too: the run pauses saying where the room is set.
    const second = new Rig({ shipped: true });
    const chat2 = await historyChat(second);
    fakeModels(second);
    const answer2 = second.host.quietReply;
    takes = 4096;
    rooms.length = 0;
    second.host.quietReply = (req) => {
      if (text(req).includes('"beats": [{"message"')) {
        rooms.push(req.maxTokens);
        if (req.maxTokens > takes) throw new Error("Custom stream failed (422): the request can't be processed as sent");
      }
      return answer2 ? answer2(req) : "{}";
    };
    await bootstrap(second, chat2, { op: "opt", on: true });
    await bootstrap(second, chat2, { op: "start", cap: "none" });
    const stopped = await finished(second, chat2);
    expect(stopped.status).toBe("paused");
    expect(stopped.reason).toContain("(422)");
    expect(stopped.reason).toContain("Settings → Depth → Historian's answer room");
    expect(rooms).toEqual([DEPTH_ROOM_MOST, own]);
    // The room the user then sets is what the historian asks first.
    second.body(await second.send({ type: "lre.settings.set", patch: { depth: { roles: { historian: { uses: "own", own: { maxTokens: 4096 } } } } } }));
    await bootstrap(second, chat2, { op: "resume" });
    expect((await finished(second, chat2)).status).toBe("done");
    expect(rooms.slice(2)).toEqual([4096, 4096, 4096]);
  }, 90_000);

  test("a refusal that isn't of the room (a bad key) is asked again at the role's own room, as any refusal is, and pauses the run without telling the user to set a room (the final correctness review, finding 2)", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await historyChat(rig);
    fakeModels(rig);
    const answer = rig.host.quietReply;
    const rooms: (number | undefined)[] = [];
    rig.host.quietReply = (req) => {
      if (text(req).includes('"beats": [{"message"')) {
        rooms.push(req.maxTokens);
        throw new Error("Custom stream failed (401): Invalid API key");
      }
      return answer ? answer(req) : "{}";
    };
    await bootstrap(rig, chatId, { op: "opt", on: true });
    await bootstrap(rig, chatId, { op: "start", cap: "none" });
    const stopped = await finished(rig, chatId);
    expect(rooms).toEqual([DEPTH_ROOM_MOST, defaultDepthSettings().strong.maxTokens]);
    expect(stopped.status).toBe("paused");
    expect(stopped.reason).toContain("(401): Invalid API key");
    expect(stopped.reason).not.toContain("answer room");
  }, 90_000);

  test("the historian asks at the room the user set it; an answer cut off at it is asked once more at twice it; cut off again it pauses the run saying what both spent, and Resume asks only that stretch again", async () => {
    expect(roomAgain(44925)).toBe(89850);
    // Twice is held to the most Settings → Depth lets a room be; at it, there is no more room to ask for.
    expect(roomAgain(DEPTH_ROOM_MOST - 10)).toBe(DEPTH_ROOM_MOST);
    expect(roomAgain(DEPTH_ROOM_MOST)).toBeNull();
    const rig = new Rig({ shipped: true });
    const chatId = await historyChat(rig);
    // The Historian on a room of its own the user set.
    rig.body(await rig.send({ type: "lre.settings.set", patch: { depth: { roles: { historian: { uses: "own", own: { maxTokens: 1024 } } } } } }));
    const asked = fakeModels(rig);
    const answer = rig.host.quietReply;
    const rooms: { want: number; got: number | undefined }[] = [];
    let h3 = 0;
    rig.host.quietReply = (req) => {
      if (text(req).includes('"beats": [{"message"')) {
        const ids = [...(req.messages.at(-1)?.content ?? "").matchAll(/^\[(h\d+|m\d+)\] /gm)].map((m) => m[1] as string);
        // The stretch holding h3 is cut off mid-JSON, after reasoning, at its room and at twice it, then at its room again on Resume; asked at twice it, it answers.
        const call = ids.includes("h3") ? h3++ : 0;
        rooms.push({ want: call % 2 === 1 ? 2048 : 1024, got: req.maxTokens });
        if (ids.includes("h3") && call < 3) return { content: '{"beats": [{"message": "h3", "what": "Danny tells', finishReason: "length", reasoning: "Danny first.", usage: { completion_tokens_details: { reasoning_tokens: 600 } } };
      }
      return answer ? answer(req) : "{}";
    };
    await bootstrap(rig, chatId, { op: "opt", on: true });
    await bootstrap(rig, chatId, { op: "start", cap: "none" });
    const stopped = await finished(rig, chatId);
    expect(stopped.status).toBe("paused");
    expect(stopped.reason).toContain("the historian's answer was cut off at its answer room");
    expect(stopped.reason).toContain("600 of them reasoning");
    // Beside its record, the failed job keeps why, both calls and their answers as written: the audit's alone, never read by Resume.
    expect(h3).toBe(2);
    const jobs = await rig.host.storage.list(`runs/${chatId}/bootstrap/jobs/`, rig.host.userId);
    const failed = jobs.filter((p) => p.endsWith(".failed.json"));
    expect(failed.length).toBe(1);
    const kept = JSON.parse((await rig.host.storage.read(failed[0] ?? "", rig.host.userId)) ?? "null") as { slot: string; why: string; spent: { calls: number }; misread: { call: number; fields: { field: string; said: string; why?: string }[]; count: number; raw: string }[] };
    expect(kept.slot).toMatch(/^historian:/);
    expect(kept.why).toContain("cut off at its answer room");
    expect(kept.spent.calls).toBe(2);
    const cutAnswer = '{"beats": [{"message": "h3", "what": "Danny tells';
    expect(kept.misread).toEqual([0, 1].map((call) => ({ call, fields: [{ field: "(the answer)", said: JSON.stringify(cutAnswer), why: kept.why }], count: 1, raw: cutAnswer })));
    await bootstrap(rig, chatId, { op: "resume" });
    const view = await finished(rig, chatId);
    expect(view.status).toBe("done");
    // Asked again on Resume, the cut stretch answered at twice its room; the stretches recorded before it weren't asked again.
    expect(h3).toBe(4);
    expect(asked.historian).toBe(3);
    // Every first call's room was the user's, and each retry twice it.
    expect(rooms.length).toBe(6);
    for (const r of rooms) expect(r.got).toBe(r.want);
    const story = await rig.rt.ledger.readStory(chatId, rig.host.userId);
    expect(story.duplicates).toEqual([]);
    expect(story.beats.length).toBe(7);
  }, 60_000);

  test("an author's answer cut off at the room the user set it is asked once more at twice it and lands; its job keeps both calls and the cut answer as written", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await historyChat(rig);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { depth: { roles: { author: { uses: "own", own: { maxTokens: 4096 } } } } } }));
    fakeModels(rig);
    const answer = rig.host.quietReply;
    const rooms: (number | undefined)[] = [];
    const cut = '{"files": [{"path": "notebook/story.md", "text": "The lamp';
    rig.host.quietReply = (req) => {
      if (text(req).includes('"chapter": {"ends"')) {
        rooms.push(req.maxTokens);
        // Its first reading runs out of room mid-JSON, after reasoning, as the trial's 32,768-token cut did.
        if (rooms.length === 1) return { content: cut, finishReason: "length", reasoning: "The lamp matters.", usage: { completion_tokens_details: { reasoning_tokens: 3000 } } };
      }
      return answer ? answer(req) : "{}";
    };
    await bootstrap(rig, chatId, { op: "opt", on: true });
    await bootstrap(rig, chatId, { op: "start", cap: "none" });
    expect((await finished(rig, chatId)).status).toBe("done");
    expect(rooms.slice(0, 2)).toEqual([4096, 8192]);
    expect(rooms.slice(2).every((r) => r === 4096)).toBe(true);
    const jobs = await rig.host.storage.list(`runs/${chatId}/bootstrap/jobs/`, rig.host.userId);
    expect(jobs.filter((p) => p.endsWith(".failed.json"))).toEqual([]);
    const rec = JSON.parse((await rig.host.storage.read(jobs.find((p) => /\/author_0\.json$/.test(p)) ?? "", rig.host.userId)) ?? "null") as { spent: { calls: number }; misread?: { call: number; fields: { field: string; why?: string }[]; raw: string }[] };
    expect(rec.spent.calls).toBe(2);
    expect(rec.misread?.map((m) => [m.call, m.raw])).toEqual([[0, cut]]);
    expect(rec.misread?.[0]?.fields[0]?.why).toContain("the author's answer was cut off at its answer room");
  }, 60_000);

  test("an author's answer that wasn't JSON is asked once more; not JSON again, it pauses the run, and its failed job keeps both answers as written beside why and what both spent", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await historyChat(rig);
    fakeModels(rig);
    const answer = rig.host.quietReply;
    const prose = "Chapter 1 opens at the shop. Danny is the heart of it; I'd give him a mind. The notebook should say the lamp matters.";
    let authored = 0;
    rig.host.quietReply = (req) => {
      if (text(req).includes('"chapter": {"ends"') && authored++ < 2) return { content: prose, usage: { completion_tokens: 40, completion_tokens_details: { reasoning_tokens: 12 } } };
      return answer ? answer(req) : "{}";
    };
    await bootstrap(rig, chatId, { op: "opt", on: true });
    await bootstrap(rig, chatId, { op: "start", cap: "none" });
    const stopped = await finished(rig, chatId);
    expect(stopped.status).toBe("paused");
    expect(stopped.reason).toContain("the author's answer wasn't the JSON object it was asked for");
    const jobs = await rig.host.storage.list(`runs/${chatId}/bootstrap/jobs/`, rig.host.userId);
    const failed = jobs.filter((p) => p.endsWith(".failed.json"));
    expect(failed.length).toBe(1);
    const kept = JSON.parse((await rig.host.storage.read(failed[0] ?? "", rig.host.userId)) ?? "null") as { slot: string; why: string; spent: { calls: number; tokensOut: number; reasoningOut: number }; misread?: { call: number; fields: { field: string; why?: string }[]; count: number; raw: string }[] };
    expect(kept.slot).toMatch(/^author/);
    expect(kept.why).toContain("the author's answer wasn't the JSON object it was asked for");
    expect([kept.spent.calls, kept.spent.reasoningOut]).toEqual([2, 24]);
    expect(kept.misread?.map((m) => [m.call, m.fields.map((f) => [f.field, f.why]), m.raw])).toEqual([0, 1].map((call) => [call, [["(the answer)", kept.why]], prose]));
    // Resume asks the author again and finishes.
    await bootstrap(rig, chatId, { op: "resume" });
    expect((await finished(rig, chatId)).status).toBe("done");
  }, 60_000);

  test("an author's answer that wasn't JSON, asked once more, lands the second; the job's record keeps the first as written, and both calls in what it spent", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await historyChat(rig);
    fakeModels(rig);
    const answer = rig.host.quietReply;
    const prose = "Chapter 1 opens at the shop. Danny is the heart of it.";
    let authored = 0;
    rig.host.quietReply = (req) => {
      if (text(req).includes('"chapter": {"ends"') && authored++ === 0) return { content: prose, usage: { completion_tokens: 40 } };
      return answer ? answer(req) : "{}";
    };
    await bootstrap(rig, chatId, { op: "opt", on: true });
    await bootstrap(rig, chatId, { op: "start", cap: "none" });
    expect((await finished(rig, chatId)).status).toBe("done");
    const jobs = await rig.host.storage.list(`runs/${chatId}/bootstrap/jobs/`, rig.host.userId);
    expect(jobs.filter((p) => p.endsWith(".failed.json"))).toEqual([]);
    type Rec = { slot: string; spent: { calls: number }; misread?: { call: number; fields: { field: string; why?: string }[]; raw: string }[] };
    const records = await Promise.all(jobs.filter((p) => /\/author_\d+\.json$/.test(p)).map(async (p) => JSON.parse((await rig.host.storage.read(p, rig.host.userId)) ?? "null") as Rec));
    const asked = records.filter((r) => r.misread?.some((m) => m.raw === prose));
    expect(asked.length).toBe(1);
    expect(asked[0]?.spent.calls).toBe(2);
    expect(asked[0]?.misread?.map((m) => [m.call, m.fields.map((f) => f.field), m.raw])).toEqual([[0, ["(the answer)"], prose]]);
    expect(asked[0]?.misread?.[0]?.fields[0]?.why).toContain("the author's answer wasn't the JSON object it was asked for");
  }, 60_000);

  test("an answer that wasn't JSON whose asking again the cap stops keeps its failed job, with the answer as written and why the run stopped", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await historyChat(rig);
    fakeModels(rig);
    const answer = rig.host.quietReply;
    const prose = "Chapter 1 opens at the shop.";
    let authored = 0;
    rig.host.quietReply = (req) => {
      // The author's first answer, prose, spends past the cap, so it is never asked again.
      if (text(req).includes('"chapter": {"ends"') && authored++ === 0) return { content: prose, usage: { cost: 10 } };
      return answer ? answer(req) : "{}";
    };
    await bootstrap(rig, chatId, { op: "opt", on: true });
    await bootstrap(rig, chatId, { op: "start", cap: { unit: "money", value: 5 } });
    const stopped = await finished(rig, chatId);
    expect(stopped.status).toBe("paused");
    expect(stopped.reason).toContain("The run reached its cap");
    expect(authored).toBe(1);
    const jobs = await rig.host.storage.list(`runs/${chatId}/bootstrap/jobs/`, rig.host.userId);
    const failed = jobs.filter((p) => /\/author_[^/]*\.failed\.json$/.test(p));
    expect(failed.length).toBe(1);
    const kept = JSON.parse((await rig.host.storage.read(failed[0] ?? "", rig.host.userId)) ?? "null") as { slot: string; why: string; spent: { calls: number }; misread?: { call: number; fields: { field: string; why?: string }[]; raw: string }[] };
    expect(kept.why).toContain("The run reached its cap");
    expect(kept.spent.calls).toBe(1);
    expect(kept.misread?.map((m) => [m.call, m.fields.map((f) => f.field), m.raw])).toEqual([[0, ["(the answer)"], prose]]);
    expect(kept.misread?.[0]?.fields[0]?.why).toContain("the author's answer wasn't the JSON object it was asked for");
    // Without the cap, Resume asks the author again and finishes.
    await bootstrap(rig, chatId, { op: "resume", cap: "none" });
    expect((await finished(rig, chatId)).status).toBe("done");
  }, 60_000);

  test("the estimate names each stage's connection by its name (by its id once Lumiverse no longer has it), and says one message, one word and one chunk as one", async () => {
    const rig = new Rig({ shipped: true });
    await readyLoopback(rig);
    const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    const strong = "c7c0f78d-99e7-40d8-b087-7e5a7030b3ec";
    const gone = "0b6f2d4e-1a3c-4e5f-9a7b-2c8d0e1f3a5b";
    rig.host.connectionProfiles.push({ id: strong, name: "Harbor Gateway", models: ["harbor-large"] });
    rig.body(await rig.send({ type: "lre.settings.set", patch: { depth: { strong: { connectionId: strong, model: "harbor-large" }, fast: { connectionId: gone, model: "harbor-small" } } } }));
    const { estimate } = (await bootstrap(rig, chatId, { op: "estimate" })) as { estimate?: BootstrapEstimate };
    if (!estimate) throw new Error("no estimate");
    const routes = estimate.stages.map((s) => `${s.stage}: ${s.connection} · ${s.model}`);
    expect(routes).toContain("historian: Harbor Gateway · harbor-large");
    expect(routes).toContain(`pov: ${gone} · harbor-small`);
    expect(routes.some((r) => r.includes(strong))).toBe(false);
    expect(estimate.messages).toBe(1);
    expect(estimate.notes[0]).toStartWith("A first guess from the chat's 1 message (1 word) in 1 chunk, assuming ");
  });

  test("the import reads the world's own lore beside the chat's World Info books, as lore: the starter's 26 entries, none of them reconciled as memory", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await historyChat(rig);
    fakeModels(rig);
    const answer = rig.host.quietReply;
    const reconciled: string[] = [];
    rig.host.quietReply = (req) => {
      if (text(req).includes('"agree": [{"entry"')) reconciled.push(req.messages.at(-1)?.content ?? "");
      return answer ? answer(req) : "{}";
    };
    await bootstrap(rig, chatId, { op: "opt", on: true });
    await bootstrap(rig, chatId, { op: "start", cap: "none" });
    const view = await finished(rig, chatId);
    expect(view.status).toBe("done");
    // The starter keeps its lore in the world itself, in no book: the chat's books (none of the user's; the engine's own is never read) hold none of it.
    expect(view.imported.find((v) => v.source === "world_lore")).toEqual({ source: "world_lore", entries: 26, unreadable: null });
    expect(view.imported.find((v) => v.source === "world_info")?.entries).toBe(0);
    // Lore stays lore: the GM reconciles memory only.
    expect(reconciled.length).toBeGreaterThan(0);
    expect(reconciled.some((u) => u.includes("world_lore:"))).toBe(false);
  }, 60_000);

  test("a mind's core seeds from the world's own description of the person and its lore about them, never the author's reading that contradicts it", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await historyChat(rig);
    fakeModels(rig, { core: "AUTHOR-CORE: the man at the counter who hands out the work, the player's boss or one who acts like it." });
    await bootstrap(rig, chatId, { op: "opt", on: true });
    await bootstrap(rig, chatId, { op: "start", cap: "none" });
    expect((await finished(rig, chatId)).status).toBe("done");
    const basis = await rig.rt.ledger.basisFor(chatId, rig.host.userId);
    const at = basis ? await rig.rt.ledger.foldAtBasis(chatId, rig.host.userId, basis) : null;
    if (!at) throw new Error("no fold");
    const core = (await readMind(rig.rt.blobs, rig.host.userId, at.state, DANNY))["core.md"] ?? "";
    // The world's entity: his name, role and age, description and traits; then the world's lore entry about him.
    expect(core).toStartWith("# Danny Okafor\n\nSenior mechanic at Alder Automotive, 31.");
    expect(core).toContain("Funny, quick with a wrench");
    expect(core).toContain("- competitive");
    expect(core).toContain("he knows every engine in town by its sound");
    expect(core).not.toContain("AUTHOR-CORE");
    // The world is the user's own, as a card is: not marked for review.
    const meta = mindMetaAt(at.state, DANNY)["core.md"];
    expect(meta?.source).toBe("world");
    expect(meta?.review).toBeUndefined();
    // Priya, whom the author gave no reading of, is seeded from the world too.
    expect((await readMind(rig.rt.blobs, rig.host.userId, at.state, PRIYA))["core.md"] ?? "").toContain("Township accountant and Harbor Fest organizer, 34.");
  }, 60_000);

  test("a Redo from chapter 1 seeds again a core the run seeded, superseding it, and a core the user wrote later still stands", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await historyChat(rig);
    fakeModels(rig);
    // The first run seeds from a wording of the user's that the redo no longer has (as a build before the world's description was read seeded from the author's reading).
    rig.body(await rig.send({ type: "lre.settings.set", patch: { prompts: { texts: { [CHARACTER_TEXT.coreWorld]: "OLD-CORE of {{name}}: {{role}}" } } } }));
    await bootstrap(rig, chatId, { op: "opt", on: true });
    await bootstrap(rig, chatId, { op: "start", cap: "none" });
    expect((await finished(rig, chatId)).status).toBe("done");
    const head = async () => {
      const basis = await rig.rt.ledger.basisFor(chatId, rig.host.userId);
      const at = basis ? await rig.rt.ledger.foldAtBasis(chatId, rig.host.userId, basis) : null;
      if (!at) throw new Error("no fold");
      return at;
    };
    expect((await readMind(rig.rt.blobs, rig.host.userId, (await head()).state, DANNY))["core.md"]).toBe("OLD-CORE of Danny Okafor: Senior mechanic at Alder Automotive, 31.");
    await mindEdit(rig.rt, chatId, rig.host.userId, PRIYA, "core.md", "USER-CORE: Priya, as I see her.");
    rig.body(await rig.send({ type: "lre.settings.set", patch: { prompts: { texts: { [CHARACTER_TEXT.coreWorld]: CORE_WORLD } } } }));
    await bootstrap(rig, chatId, { op: "redo", chapter: 0 });
    await bootstrap(rig, chatId, { op: "resume", cap: "none" });
    expect((await finished(rig, chatId)).status).toBe("done");
    const at = await head();
    expect((await readMind(rig.rt.blobs, rig.host.userId, at.state, DANNY))["core.md"] ?? "").toStartWith("# Danny Okafor\n\nSenior mechanic at Alder Automotive, 31.");
    // The old seed is superseded, not written over: the core is at its first revision again.
    expect(mindMetaAt(at.state, DANNY)["core.md"]?.rev).toBe(1);
    expect((await readMind(rig.rt.blobs, rig.host.userId, at.state, PRIYA))["core.md"]).toBe("USER-CORE: Priya, as I see her.");
  }, 60_000);
});

describe("the historian's answer", () => {
  const w = modernUsWorld("w", "R");
  const s = startState(w);
  const cast = [{ id: w.pov, name: "Sam" }, { id: "maya", name: "Maya Chen" }];
  const rows = [
    { id: "m1", isUser: true, name: "Sam", text: "I follow Maya into the café.", clock: null, basis: { swipe: "c1" } },
    { id: "m2", isUser: false, name: "Narrator", text: 'Maya slides into the back booth. "Not a word, Sam. Not one."', clock: null, basis: { swipe: "c2" } },
  ];
  /** A port answering once with `answer`, keeping the system text it was asked with. */
  const port = (answer: unknown, sent: string[]): ModelPort => async (_role, messages) => {
    sent.push(messages[0]?.content ?? "");
    return { text: JSON.stringify(answer), misread: () => undefined };
  };

  test("is told that a beat of speech carries the exact words spoken in its quotes, and keeps them word for word", async () => {
    const sent: string[] = [];
    const words = "Not a word, Sam. Not one.";
    const out = await historian({ world: w, state: s, texts: {}, chunk: rows, before: { beats: [], staging: [] }, cast }, port({ beats: [{ message: "m2", place: "cafe", actors: ["maya"], act: "said", what: "Maya tells Sam to keep quiet.", surface: "Maya in the back booth, warning Sam.", quotes: words, exposure: [{ who: "Sam", channel: "hearing", reach: "whole" }] }] }, sent));
    expect(sent[0]).toContain('A beat of speech ("act": "said") carries the exact words spoken in its quotes, word for word as the prose has them, never summed up or reworded');
    expect(sent[0]).toContain('"quotes": the exact words spoken or written, word for word as the prose has them (a "said" beat\'s always)');
    expect(out.beats[0]?.quotes).toBe(words);
  });

  test("binds a new place listed under a listed place's name, and named by its new: ref, to the listed place", async () => {
    const told: string[] = [];
    const model: ModelPort = async () => ({
      text: JSON.stringify({
        beats: [
          { message: "m1", place: "new:daybreak", actors: [w.pov], act: "did", about: ["new:daybreak"], what: "Sam follows Maya into the café.", surface: "Sam at the café door.", exposure: [] },
          { message: "m2", place: "new:back_booth", actors: ["maya"], act: "said", what: "Maya tells Sam to keep quiet.", surface: "Maya in the back booth.", quotes: "Not a word, Sam. Not one.", exposure: [] },
        ],
        newPlaces: [
          { ref: "new:daybreak", name: "Daybreak Café", in: "riverton", note: "the corner café" },
          { ref: "new:back_booth", name: "The back booth", in: "new:daybreak", note: "a booth at the back" },
        ],
      }),
      misread: (fields) => void told.push(...fields.map((f) => `${f.field} as ${f.as ?? "-"}: ${f.why ?? ""}`)),
    });
    const out = await historian({ world: w, state: s, texts: {}, chunk: rows, before: { beats: [], staging: [] }, cast }, model);
    const [into, booth] = out.beats.map((b) => b.beat);
    // The café the world has, not a second one made under its ref; a place said to be in that ref is in the café.
    expect(into?.place).toBe("cafe");
    expect(into?.about).toEqual([{ place: "cafe" }]);
    expect(out.newPlaces).toEqual([{ ref: "new:back_booth", name: "The back booth", note: "a booth at the back", parent: "cafe" }]);
    expect(booth?.place).toBe("new:back_booth");
    expect(told).toEqual(['newPlaces[0] as "cafe": a listed place has its name']);
  });
});
