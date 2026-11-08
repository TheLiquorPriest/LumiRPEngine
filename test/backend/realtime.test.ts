// Real-time dialogue (DEPTH-PLAN §2.5, §4.2, §9.2 A2). `story.talk` lives with its turn and its tap: a
// swipe of the turn that entered real time leaves it, a switch back brings it back, a Re-narrate keeps
// it, a Re-run reads it at its basis, and a Leave tapped on one swipe of the last reply stays with that
// swipe; an offer stands only under the last reply and never runs a turn by itself. Each line goes
// straight to the character, verbatim, beside the author's watch; a line the watch takes into a scene
// writes nothing, so the character's dropped answer never reaches its mind; a line it lets through
// is the exchange, rendered in its moments, cut on a Stop, and timed. Who perceived an answer that is
// more than words said back to the player character, and how its attempt turned out, is the author's
// to write, never a rule's.

import { describe, expect, test } from "bun:test";
import type { Moment, NarrationOutcome, RealtimeCtx, RealtimeOutcome, TurnSink } from "../../src/backend/depth/scene/contract";
import { readWatch, realtimeTurn } from "../../src/backend/depth/scene/realtime";
import { talkChipOn, talkTap, TALK_CHOICES } from "../../src/backend/depth/scene/talk";
import type { ModelPort } from "../../src/backend/depth/port";
import { toChain } from "../../src/backend/ledger-io";
import { defaultSettings } from "../../src/backend/settings-store";
import { MIND_LIVED, MIND_TAKE, mindFileWrite, mindPath, reachOf } from "../../src/shared/character-engine";
import type { ChatId, MessageId } from "../../src/shared/ids";
import type { LedgerEvent } from "../../src/shared/ledger";
import { beatEvent, beatOf, stagingEvent, STORY_BEAT, type Beat } from "../../src/shared/story";
import { blobHash } from "../../src/shared/stores";
import { STORY_TALK, talkEvent, talkNow, talkOf } from "../../src/shared/talk";
import type { TurnModel } from "../../src/engine/ledger/journal";
import type { WorldDoc } from "../../src/shared/world";
import storyPack from "../../src/packs/story/core/index";
import { Harness } from "../support/harness";
import { POV } from "../support/test-pack";

// ------------------------------------------------------------------ story.talk on a chain

/** The author enters real time in a first turn whose line asks to talk, offers it where the line asks for an offer; a re-run (a swipe) enters nothing. */
const talkModel: TurnModel = {
  plan: ({ kind, userTexts }) => {
    const said = userTexts.at(-1) ?? "";
    if (kind !== "normal") return [];
    if (said.includes("talk")) return [talkEvent({ with: "dev", state: "on", by: "author", scene: "s1", why: "Sam sits down to talk." })];
    if (said.includes("offer")) return [talkEvent({ with: "dev", state: "offer", by: "author", scene: "s1", why: "A quiet moment between them." })];
    return [];
  },
  read: () => [],
};

async function swipe(h: Harness, chat: ChatId, reply: string): Promise<void> {
  await h.host.finish(await h.host.start(chat, { type: "swipe" }), reply);
  await h.host.settle();
}

/** The talk as the chat stands: whom with and how, or null; and the chip under the last reply. */
async function talkOn(h: Harness, chat: ChatId): Promise<{ talk: string | null; chip: string | null; chipId: string | null }> {
  const head = [...(await h.chain(chat))].reverse().find((m) => !m.isUser) ?? null;
  const live = await h.service.readEvents(chat, h.host.userId, [STORY_TALK]);
  const t = talkNow(live, head?.id ?? null);
  const chip = talkChipOn(await h.core(chat), toChain(await h.host.chats.messages(chat, h.host.userId)), {});
  const { reference, optimized } = await h.folds(chat);
  expect(reference.violations).toEqual([]);
  expect(optimized.violations).toEqual([]);
  return { talk: t ? `${t.state} ${t.with} by ${t.by}` : null, chip: chip ? `${chip.label} [${chip.actions.map((a) => a.id).join(", ")}]` : null, chipId: chip?.id ?? null };
}

describe("real-time dialogue on a chain", () => {
  test("it lives with the turn that entered it, and the player's Leave with the swipe he tapped it on", async () => {
    const h = new Harness("fresh", { packs: [storyPack], model: talkModel });
    const chat = await h.newChat();
    const rt = { host: h.host, ledger: h.service };
    await h.send(chat, "Sit down, Dev, let's talk.", "Dev sits.");
    expect((await talkOn(h, chat)).talk).toBe("on dev by author");
    expect((await talkOn(h, chat)).chip).toBe("Talking with Dev [leave]");

    // A swipe of the turn that entered it leaves it; a switch back brings it back; a Re-narrate keeps it.
    const entering = (await h.chain(chat)).at(-1)?.id as MessageId;
    await swipe(h, chat, "Dev stays standing.");
    expect((await talkOn(h, chat)).talk).toBeNull();
    h.host.navigate(chat, entering, 0);
    await h.host.settle();
    expect((await talkOn(h, chat)).talk).toBe("on dev by author");
    h.renarrateNext = true;
    await swipe(h, chat, "Dev sits, told again.");
    expect((await talkOn(h, chat)).talk).toBe("on dev by author");

    // It runs on, line after line, until something ends it; a turn reads it at its basis.
    await h.send(chat, "How have you been?", "Fine.");
    const asked = (await h.chain(chat)).at(-2)?.id as MessageId;
    const basis = await h.service.basisFor(chat, h.host.userId, asked);
    if (!basis) throw new Error("no basis");
    const at = await h.service.foldAtBasis(chat, h.host.userId, basis, [STORY_TALK]);
    expect(talkNow(at?.events ?? [], null)?.with).toBe("dev");

    // Leave lands at the last reply: real time ends there, and the chip goes; the tap names the talk it ended, for its end (the partner remembers it then).
    const { chipId } = await talkOn(h, chat);
    if (!chipId) throw new Error("no chip");
    const reply = (await h.chain(chat)).at(-1);
    expect(await talkTap(rt, chat, h.host.userId, chipId, TALK_CHOICES.leave)).toMatchObject({ applied: true, pending: false, left: { with: "dev", scene: "s1", basis: { message: reply?.id } } });
    expect(await talkOn(h, chat)).toMatchObject({ talk: null, chip: null });
    expect(await talkTap(rt, chat, h.host.userId, chipId, TALK_CHOICES.leave)).toEqual({ lapsed: "the chip has lapsed: real-time dialogue has moved on" });

    // The Leave stays with the swipe it was tapped on: a swipe of that reply runs on in real time, a switch back has left it.
    const last = (await h.chain(chat)).at(-1)?.id as MessageId;
    await swipe(h, chat, "Fine, thanks.");
    expect((await talkOn(h, chat)).talk).toBe("on dev by author");
    h.host.navigate(chat, last, 0);
    await h.host.settle();
    expect((await talkOn(h, chat)).talk).toBeNull();
  });

  test("a tap made while a reply is written lands before that reply, held through its turn, so its kept key never refuses it", async () => {
    const h = new Harness("fresh", { packs: [storyPack], model: talkModel });
    const chat = await h.newChat();
    const rt = { host: h.host, ledger: h.service };
    await h.send(chat, "Sit down, Dev, let's talk.", "Dev sits.");
    await h.send(chat, "How have you been?", "Fine.");
    const { chipId } = await talkOn(h, chat);
    if (!chipId) throw new Error("no chip");
    const asked = (await h.chain(chat)).at(-2)?.id as MessageId;
    // The player swipes the reply and taps Leave while its new swipe is written: the Leave waits, anchored at his message.
    const writing = await h.host.start(chat, { type: "swipe" });
    const tap = await talkTap(rt, chat, h.host.userId, chipId, TALK_CHOICES.leave);
    expect(tap).toEqual({ applied: true, pending: true });
    await h.host.finish(writing, "Fine, thanks.");
    await h.host.settle();
    const live = await h.service.readEvents(chat, h.host.userId, [STORY_TALK]);
    expect(live.at(-1)?.from.messageId).toBe(asked);
    expect((await talkOn(h, chat)).talk).toBeNull();
  });

  test("an offer stands only under the last reply, never runs a turn by itself, and Talk takes it", async () => {
    const h = new Harness("fresh", { packs: [storyPack], model: talkModel });
    const chat = await h.newChat();
    const rt = { host: h.host, ledger: h.service };
    await h.send(chat, "I could offer a coffee.", "Dev nods.");
    const offered = await talkOn(h, chat);
    expect(offered.talk).toBe("offer dev by author");
    expect(offered.chip).toBe("Talk with Dev in real time? [talk]");
    // A turn never treats an offer as on.
    expect(talkNow(await h.service.readEvents(chat, h.host.userId, [STORY_TALK]), null)).toBeNull();

    // A line sent without the tap lets it lapse.
    await h.send(chat, "Anyway.", "Dev goes back to his papers.");
    expect(await talkOn(h, chat)).toMatchObject({ talk: null, chip: null });
    if (!offered.chipId) throw new Error("no chip");
    expect(await talkTap(rt, chat, h.host.userId, offered.chipId, TALK_CHOICES.talk)).toEqual({ lapsed: "the chip has lapsed: a later reply came" });

    // Offered again, and taken: the player's tap starts it.
    await h.send(chat, "Another offer, then.", "Dev looks up.");
    const again = await talkOn(h, chat);
    if (!again.chipId) throw new Error("no chip");
    expect(await talkTap(rt, chat, h.host.userId, again.chipId, TALK_CHOICES.talk)).toEqual({ applied: true, pending: false });
    expect((await talkOn(h, chat)).talk).toBe("on dev by player");
  });
});

// ------------------------------------------------------------------ one line

const LINE = "*leans on the doorframe* So, Dev. What did the auditor want?";
const NOTEBOOK = "notebook/player.md: He wants to find out what Dev is hiding about the March books.";
const LINE_WHAT = "Sam asks Dev, casually, what the auditor wanted.";

/** A chat with Sam and Dev in the office (scene s1), Dev's core, and the fold at its last reply. */
async function office(): Promise<{ h: Harness; chat: ChatId; at: RealtimeCtx["at"]; texts: Map<string, string> }> {
  const texts = new Map<string, string>();
  const put = (t: string): string => {
    texts.set(blobHash(t), t);
    return blobHash(t);
  };
  const h = new Harness("fresh", { packs: [storyPack] });
  const chat = await h.newChat();
  await h.send(chat, "Morning, Dev.", "Dev looks up from his desk.");
  const basis = await h.service.basisFor(chat, h.host.userId);
  if (!basis) throw new Error("no basis");
  const opening: Beat = { id: "b-open", at: 0, order: 0, scene: "s1", place: "home", actors: ["dev"], act: "said", about: [], what: put("Dev greets Sam without warmth."), surface: put("Dev looks up from his desk."), quotes: put("Morning."), exposure: [{ who: POV, channel: "hearing", reach: "whole" }, { who: "dev", channel: "hearing", reach: "whole" }], by: { entry: "test" } };
  const core = mindFileWrite({ who: "dev", path: mindPath("dev", "core"), at: 0, mode: "seed", lived: [], about: [], source: "card" }, "Dev, a tired accountant who hates small talk and keeps his books close.");
  for (const [hash, text] of Object.entries(core.blobs)) texts.set(hash, text);
  const events: LedgerEvent[] = [
    stagingEvent({ who: POV, scene: "s1", where: put("in the office doorway"), doing: put("leaning on the frame") }),
    stagingEvent({ who: "dev", scene: "s1", where: put("behind his desk"), doing: put("sorting receipts") }),
    beatEvent(opening),
    ...core.events,
  ];
  const landed = await h.service.landLayer(chat, h.host.userId, { id: "office", basis, kind: "story.staging", events });
  expect(landed.status).toBe("landed");
  await h.host.settle();
  const read = await h.service.foldAtBasis(chat, h.host.userId, basis, [STORY_TALK]);
  if (!read) throw new Error("no fold");
  return { h, chat, at: { basis, state: read.state, world: read.world, story: read.story, events: read.events }, texts };
}

const PLAYED = { do: "Dev sets his pen down.", say: "He wanted the March ledgers. All of them.", to: ["sam"], take: "Sam is fishing. Careful what I give him.", now: "On guard." };

interface Run {
  outcome: RealtimeOutcome;
  calls: { role: string; content: string }[];
  lines: string[];
  moments: Moment[];
  narrated: number;
}

/** One line through `realtimeTurn`, every model call answered by role (the watch's own answer, then `exposure`'s), the world given `actions` too, the narration faked to stream what it is given (or as `narration` says); Sam and Dev both at home, face to face, or `apart`: Sam at home and Dev at the shop, on the phone (`"unplaced"`: Dev given no place at all). */
async function line(o: { watch: unknown; play?: unknown; exposure?: unknown[]; gm?: unknown[]; pov?: unknown; actions?: WorldDoc["actions"]; narration?: Partial<NarrationOutcome>; binds?: RealtimeCtx["binds"]; apart?: true | "unplaced" }): Promise<Run> {
  const { h, chat, at: folded, texts } = await office();
  const acted = o.actions ? { ...folded, world: { ...folded.world, actions: { ...folded.world.actions, ...o.actions } } } : folded;
  const placed = (id: string, fields: (typeof acted.state.entities)[string]["fields"]): typeof fields => {
    if (id === POV || !o.apart) return { ...fields, place: "home" };
    if (o.apart === true) return { ...fields, place: "shop" };
    const { place: _, ...rest } = fields;
    return rest;
  };
  const at = {
    ...acted,
    world: o.apart ? { ...acted.world, places: { ...acted.world.places, shop: { id: "shop", name: "Shop", fields: {} } } } : acted.world,
    state: { ...acted.state, entities: Object.fromEntries(Object.entries(acted.state.entities).map(([id, e]) => [id, id === POV || id === "dev" ? { ...e, fields: placed(id, e.fields) } : e])) },
  };
  const answers: Record<string, unknown[]> = { watch: [o.watch, ...(o.exposure ?? [])], realtime: [o.play ?? PLAYED], gm: o.gm ?? [], pov: o.pov !== undefined ? [o.pov] : [] };
  const calls: Run["calls"] = [];
  const model: ModelPort = async (role, messages) => {
    calls.push({ role, content: messages.map((m) => m.content).join("\n") });
    return { text: JSON.stringify(answers[role]?.shift() ?? {}), usage: { tokensIn: 1, tokensOut: 1 } };
  };
  const lines: string[] = [];
  const sink: TurnSink = { progress: (t) => void lines.push(t.trim()), reasoning: (t) => void lines.push(t.trim()), content: (t) => void lines.push(`content: ${t}`), call: () => {} };
  const moments: Moment[] = [];
  let narrated = 0;
  const ctx: RealtimeCtx = {
    chatId: chat,
    userId: h.host.userId,
    rt: { registry: h.registry, blobs: { get: async (_u, hash) => texts.get(hash) ?? null } },
    at,
    turn: "turn-1",
    runSeed: "run-1",
    seed: "seed-1",
    line: LINE,
    talk: { with: "dev", state: "on", by: "author", scene: "s1", from: { layer: "office", messageId: at.basis.message } },
    scene: "s1",
    model,
    sink,
    signal: new AbortController().signal,
    notebook: NOTEBOOK,
    settings: defaultSettings(),
    ...(o.binds ? { binds: o.binds } : {}),
    narrate: () => {
      narrated++;
      return {
        add: (m) => void moments.push(m),
        drain: async () => ({
          told: moments.map((m, index) => ({ index, mark: m.mark, beats: m.beats.map((b) => b.beat.id), text: `passage ${index}`, faithful: true, redrafts: 0, ms: { render: 1200, check: 400, total: 1600 } })),
          events: [],
          blobs: {},
          streamedThrough: moments.at(-1)?.mark ?? null,
          stopped: false,
          usage: { tokensIn: 0, tokensOut: 0 },
          ...o.narration,
        }),
      };
    },
  };
  return { outcome: await realtimeTurn(ctx), calls, lines, moments, narrated };
}

const THROUGH = { takeover: null, line: { what: LINE_WHAT, said: "So, Dev. What did the auditor want?", did: "leans on the doorframe" }, others: [], world: [], end: null, poll: "later", reasoning: "A question he can simply answer." };

function beatsIn(events: readonly LedgerEvent[]): Beat[] {
  return events.flatMap((e) => (e.type === STORY_BEAT && "data" in e ? [beatOf(e.data)].filter((b): b is Beat => b !== null) : []));
}

describe("one line of real-time dialogue", () => {
  test("the line goes straight to the character, verbatim, beside the author's watch; the exchange is written as decided, rendered and timed", async () => {
    const run = await line({ watch: THROUGH });
    // The character heard the line verbatim on the real-time row; its call held neither the author's notebook nor the line's truth.
    const played = run.calls.filter((c) => c.role === "realtime");
    expect(played).toHaveLength(1);
    expect(played[0]?.content).toContain(LINE);
    expect(played[0]?.content).not.toContain(NOTEBOOK);
    expect(played[0]?.content).not.toContain(LINE_WHAT);
    // What it can see of him is the line itself: the author's staging of him never reaches it (finding 10).
    expect(played[0]?.content).not.toContain("leaning on the frame");
    expect(played[0]?.content).not.toContain("in the office doorway");
    expect(run.calls.map((c) => c.role).sort()).toEqual(["realtime", "watch"]);
    expect(run.calls.find((c) => c.role === "watch")?.content).toContain(NOTEBOOK);

    if (run.outcome.kind !== "exchange") throw new Error(`a ${run.outcome.kind}`);
    const beats = beatsIn(run.outcome.events);
    expect(beats.map((b) => [b.actors.join(), b.act, "turn" in b.by ? b.by.decided : ""])).toEqual([
      ["sam", "said", "player"],
      ["dev", "said", "character"],
    ]);
    const [said, answered] = beats as [Beat, Beat];
    expect(run.outcome.blobs[said.surface]).toBe(LINE);
    expect(run.outcome.blobs[said.quotes ?? ""]).toBe("So, Dev. What did the auditor want?");
    // Face to face (the world doesn't place them apart), Dev sees him say it as well as hears it (LIVE3c L3c-4).
    expect(said.exposure).toContainEqual({ who: "dev", channel: "sight", also: ["hearing"], reach: "whole" });
    expect(run.outcome.blobs[answered.quotes ?? ""]).toBe("He wanted the March ledgers. All of them.");
    expect([said.order, answered.order]).toEqual([1, 2]);
    // The character's own events from its play: the line and its answer lived, its take kept.
    const types = run.outcome.events.map((e) => e.type);
    expect(types).toContain(MIND_LIVED);
    expect(types).toContain(MIND_TAKE);
    // One moment, the line as context and the answer; the poll waits for the conversation's end.
    expect(run.moments.map((m) => [m.mark, m.beats.map((b) => b.beat.id)])).toEqual([[0, [said.id, answered.id]]]);
    expect(run.outcome.pollDeferred).toBe(true);
    expect(run.outcome.ended).toBeUndefined();
    expect(run.lines.some((l) => /^Dev answered in \d+\.\d s beside the author's watch \(\d+\.\d s\); the narrator rendered the exchange in 1\.2 s and the GM checked it in 0\.4 s\. The line took \d+\.\d s\.$/.test(l))).toBe(true);
  });

  test("a line the watch takes into a scene writes nothing: the character's dropped answer never reaches its mind", async () => {
    const run = await line({ watch: { takeover: "He reaches across the desk for the ledger: the GM must resolve that.", line: null } });
    expect(run.outcome).toEqual({ kind: "takeover", why: "He reaches across the desk for the ledger: the GM must resolve that." });
    // The character answered beside the watch, and none of it is kept: no event, no blob, nothing rendered.
    expect(run.calls.some((c) => c.role === "realtime")).toBe(true);
    expect(run.narrated).toBe(0);
    expect(run.moments).toEqual([]);
    expect(run.lines.some((l) => l.startsWith("The author takes this line into a scene; Dev's answer is dropped"))).toBe(true);
    // The same answer, let through, is what would have reached Dev's mind.
    const kept = await line({ watch: THROUGH });
    if (kept.outcome.kind !== "exchange") throw new Error("not an exchange");
    expect(kept.outcome.events.filter((e) => e.type === MIND_TAKE || e.type === MIND_LIVED).length).toBeGreaterThan(0);
  });

  test("the world's beat follows the answer, the conversation's end closes the line, and a Stop keeps only the moments that streamed", async () => {
    const watch = { ...THROUGH, world: [{ what: "The phone on Dev's desk rings.", surface: "A phone rings on the desk.", said: null, by: [], perceived: [{ who: "sam", channel: "hearing", reach: "whole" }, { who: "Dev", channel: "hearing", reach: "whole" }, { who: "nobody", channel: "hearing", reach: "whole" }] }], end: "The phone call ends the conversation." };
    const run = await line({ watch });
    if (run.outcome.kind !== "exchange") throw new Error("not an exchange");
    const beats = beatsIn(run.outcome.events);
    const ring = beats.at(-1) as Beat;
    expect(ring.by).toEqual({ turn: "turn-1", decided: "author" });
    // Dev is named back to his id, and hears it next line; someone not here is left out, and the thinking block says so.
    // Each hears it alone, so each lives what could be heard of it, never what there was to see (LIVE3c L3c-4): here the plain fallback, the render unanswered.
    const rang = { channel: "hearing", reach: "whole", pov: blobHash("Something reached you by hearing.") } as const;
    expect(ring.exposure).toEqual([{ who: "sam", ...rang }, { who: "dev", ...rang, pending: true }]);
    expect(run.lines.some((l) => l.includes("“nobody”"))).toBe(true);
    expect(run.moments.map((m) => m.mark)).toEqual([0, 1]);
    const end = run.outcome.events.at(-1);
    expect(end?.type).toBe(STORY_TALK);
    expect(end && "data" in end ? talkOf(end.data) : null).toEqual({ with: "dev", state: "off", by: "author", scene: "s1", why: "The phone call ends the conversation." });
    expect(run.outcome.ended).toBe(true);
    expect(run.outcome.pollDeferred).toBeUndefined();

    // Stopped after the answer streamed: the line and its answer stay; the ring and the end go.
    const cut = await line({ watch, narration: { stopped: true, streamedThrough: 0 } });
    if (cut.outcome.kind !== "exchange") throw new Error("not an exchange");
    expect(beatsIn(cut.outcome.events)).toHaveLength(2);
    expect(cut.outcome.events.some((e) => e.type === STORY_TALK)).toBe(false);
    expect(cut.outcome.ended).toBeUndefined();
    // Stopped before anything streamed: nothing of the line stays.
    const none = await line({ watch, narration: { stopped: true, streamedThrough: null } });
    expect(none.outcome).toMatchObject({ kind: "exchange", events: [], blobs: {} });
  });

  test("a world beat someone acts in carries its deed, and its actor perceives and lives their own act as they did it (LIVE3 L3a-4)", async () => {
    const deed = "Dev thumbs his buzzing phone silent without looking at it.";
    const watch = {
      ...THROUGH,
      world: [
        { what: "Dev silences a call from the auditor.", surface: "A phone buzzes on the desk, then stops.", said: null, by: ["dev"], deed, perceived: [{ who: "sam", channel: "hearing", reach: "whole" }] },
        { what: "A truck goes by outside.", surface: "A truck rumbles past the window.", said: null, by: [], deed: "Someone drives by.", perceived: [{ who: "sam", channel: "hearing", reach: "whole" }] },
      ],
    };
    const run = await line({ watch });
    if (run.outcome.kind !== "exchange") throw new Error("not an exchange");
    const [silenced, truck] = beatsIn(run.outcome.events).slice(-2) as [Beat, Beat];
    expect(run.outcome.blobs[silenced.deed ?? ""]).toBe(deed);
    // Left out by the watch, Dev still perceives his own act, whole, pending for his next play, and lives it as he did it.
    expect(silenced.exposure).toEqual([{ who: "sam", channel: "hearing", reach: "whole", pov: blobHash("Something reached you by hearing.") }, { who: "dev", channel: "sight", reach: "whole", pending: true }]);
    expect(reachOf(silenced, "dev")).toMatchObject({ as: "deed", whole: true, text: silenced.deed });
    // A deed for a beat no one acts in is left out, and said.
    expect(truck.deed).toBeUndefined();
    expect(run.lines.some((l) => l.includes("gave a deed but no one acts in it"))).toBe(true);
    expect(run.calls.find((c) => c.role === "watch")?.content).toContain('"deed": "what they did and said, plainly, as they did it, never as anyone saw or heard it');
  });

  test("a line while a ceiling binds plays as a scene: no one answers as their own agent, nothing is written, and what it put off is kept for the scene's spend (§6.5)", async () => {
    const words = "today's depth work has spent 50K tokens, at its ceiling of 50K (Settings → Depth → Budget → Per day)";
    const run = await line({ watch: THROUGH, binds: () => ({ which: "day", limit: 50_000, spent: 50_000, words }) });
    const why = `The budget: ${words}, so Dev doesn't answer this line as their own agent: the author plays them in a scene, spending less.`;
    expect(run.outcome).toEqual({ kind: "takeover", why, put: `Dev's real-time line, played by the author in a scene rather than their own agent: ${words}` });
    // Neither the character nor the watch was asked, and nothing rendered.
    expect(run.calls).toEqual([]);
    expect(run.narrated).toBe(0);
    expect(run.lines).toContain(why);
    // Under the ceiling, the line goes through as ever.
    const under = await line({ watch: THROUGH, binds: () => null });
    expect(under.outcome.kind).toBe("exchange");
  });

  test("an answer that does something, or attempts something, is the author's to expose: one short call on the watch's row once the GM resolved it; only those it names perceive the answer and how it turned out", async () => {
    // Under the desk, out of Sam's sight: Dev's words reach him, the pocketing and how it went don't.
    const pocket: WorldDoc["actions"][string] = { id: "pocket", label: "Pocket something unseen", params: {}, requires: [], outcomes: { success: [{ type: "set", args: { entity: "self", field: "detail", value: "has the key" } }], failure: [{ type: "set", args: { entity: "self", field: "detail", value: "fumbled the key" } }] }, duration: "1", check: { id: "pocket", dice: "d20", dc: "11" } };
    const ATTEMPT = "pocket the ledger key without Sam noticing";
    const OUTCOME = "Dev's hand closes on the key and it goes into his jacket; Sam, eyes on the ledger, misses it.";
    const play = { do: "Dev slides a hand under the desk.", say: "Nothing much. The usual.", to: ["sam"], attempt: ATTEMPT, take: "He can't see under the desk.", now: "Tense." };
    const exposure = { answer: [{ who: "sam", channel: "hearing", reach: "whole" }, { who: "Dev", channel: "sight", reach: "whole" }], outcome: [{ who: "dev", channel: "touch", reach: "whole" }], reasoning: "Sam hears the words; the desk hides the hand." };
    const run = await line({ watch: THROUGH, play, exposure: [exposure], gm: [{ actions: [{ action: "pocket", params: {}, words: "pocket the ledger key" }] }, { what: OUTCOME, surface: "A soft clink under the desk.", about: ["dev"] }], actions: { pocket } });
    if (run.outcome.kind !== "exchange") throw new Error(`a ${run.outcome.kind}`);
    // The author read the answer as it happened, the attempt and the GM's outcome with it, after the play and the GM; Sam, who only hears it, then gets what could be heard of it (LIVE3c L3c-4), the render asked twice here.
    expect(run.calls.map((c) => c.role)).toEqual(["realtime", "watch", "gm", "gm", "watch", "pov", "pov"]);
    const asked = run.calls.filter((c) => c.role === "watch").at(-1)?.content ?? "";
    expect(asked).toContain(`What they tried to bring about: ${ATTEMPT}`);
    expect(asked).toContain(OUTCOME);
    expect(asked).toContain("Nothing much. The usual.");
    const [, answered, turned] = beatsIn(run.outcome.events) as [Beat, Beat, Beat];
    // Dev perceives his own act whole (named again, he is left out); Sam only what the author says reached him: the words, never the hand under the desk.
    expect(answered.exposure).toEqual([{ who: "dev", channel: "hearing", reach: "whole" }, { who: "sam", channel: "hearing", reach: "whole", pov: blobHash("You hear: “Nothing much. The usual.”") }]);
    expect(turned.by).toEqual({ turn: "turn-1", decided: "gm" });
    expect(turned.exposure).toEqual([{ who: "dev", channel: "touch", reach: "whole", pending: true }]);
    expect(run.lines.some((l) => /^The author wrote who perceived Dev's answer in \d+\.\d s\.$/.test(l))).toBe(true);
  });

  test("a phone answer reaches the player character by hearing alone: he hears the words, never the hand on the truck (LIVE3c L3c-4)", async () => {
    // The live case: Marcus answered down the line from the shop, his hand on the offside of the truck, and the reply showed the hand.
    const play = { do: "Dev keeps one hand on the truck's fender and tips the phone to his shoulder.", say: "Ring Ray now. Two bottles and the caliper.", to: ["sam"], take: "He'll manage.", now: "Busy." };
    const heard = "Dev's voice comes down the line, a clank of tools behind it.";
    const run = await line({ watch: THROUGH, play, pov: { povs: { [POV]: heard } }, apart: true });
    if (run.outcome.kind !== "exchange") throw new Error(`a ${run.outcome.kind}`);
    const [said, answered] = beatsIn(run.outcome.events) as [Beat, Beat];
    expect(run.outcome.blobs[answered.surface]).toContain("hand on the truck's fender");
    // Apart, he hears it alone, and his own point of view of it is written before the narrator renders it: the words and what could be heard.
    expect(answered.exposure.find((x) => x.who === POV)).toEqual({ who: POV, channel: "hearing", reach: "whole", pov: blobHash(heard) });
    const rendered = run.moments[0]?.beats.find((b) => b.beat.id === answered.id);
    expect(rendered?.pov).toBe(heard);
    expect(rendered?.quotes).toBe("Ring Ray now. Two bottles and the caliper.");
    // What he lives of it is his point of view, never what there was to see.
    expect(reachOf(answered, POV)).toMatchObject({ channel: "hearing", whole: true, text: blobHash(heard) });
    // Dev hears his line alone too: the words, never him at the doorframe (here the plain fallback, the render answered once).
    expect(said.exposure.find((x) => x.who === "dev")).toEqual({ who: "dev", channel: "hearing", reach: "whole", pov: blobHash("You hear: “So, Dev. What did the auditor want?”") });
  });

  test("a partner the state doesn't place is apart, never face to face: his phone answer reaches the player character by hearing alone (the last review, C-2)", async () => {
    const play = { do: "Dev keeps one hand on the truck's fender and tips the phone to his shoulder.", say: "Ring Ray now. Two bottles and the caliper.", to: ["sam"], take: "He'll manage.", now: "Busy." };
    const heard = "Dev's voice comes down the line, a clank of tools behind it.";
    const run = await line({ watch: THROUGH, play, pov: { povs: { [POV]: heard } }, apart: "unplaced" });
    if (run.outcome.kind !== "exchange") throw new Error(`a ${run.outcome.kind}`);
    const [said, answered] = beatsIn(run.outcome.events) as [Beat, Beat];
    expect(answered.exposure.find((x) => x.who === POV)).toEqual({ who: POV, channel: "hearing", reach: "whole", pov: blobHash(heard) });
    expect(run.moments[0]?.beats.find((b) => b.beat.id === answered.id)?.pov).toBe(heard);
    expect(said.exposure.find((x) => x.who === "dev")?.channel).toBe("hearing");
  });

  test("an act the player character sees only in part gets his point of view before the narrator renders it; an account unreadable twice takes the line into a scene, writing nothing", async () => {
    const did = { do: "Dev turns the March ledger face down.", take: "Not that page.", now: "Wary." };
    const run = await line({ watch: THROUGH, play: did, exposure: [{ answer: [{ who: "sam", channel: "sight", reach: "partial" }], outcome: [] }], pov: { povs: { sam: "Dev's hand moves on the desk; a book closes." } } });
    if (run.outcome.kind !== "exchange") throw new Error(`a ${run.outcome.kind}`);
    const answered = beatsIn(run.outcome.events)[1] as Beat;
    expect(answered.exposure).toMatchObject([{ who: "dev", channel: "sight", reach: "whole" }, { who: "sam", channel: "sight", reach: "partial", pov: expect.any(String) }]);
    expect(run.moments[0]?.beats.find((b) => b.beat.id === answered.id)?.pov).toBe("Dev's hand moves on the desk; a book closes.");

    const unread = await line({ watch: THROUGH, play: did, exposure: ["not an answer", "still not an answer"] });
    expect(unread.outcome).toEqual({ kind: "takeover", why: "The author's account of who perceived Dev's answer couldn't be read, so the author plays the line as a scene." });
    expect(unread.calls.filter((c) => c.role === "watch")).toHaveLength(3);
    expect(unread.narrated).toBe(0);
  });

  test("someone the watch names by their name spelled as an id is the one person here by that name (LIVE3c)", async () => {
    // The author's call on who perceived an answer wrote the player character as jordan_ellis for Jordan Ellis [pov]: he was left out, nothing of the exchange reached him, and the reply came back empty.
    const { at } = await office();
    const sam = at.state.entities[POV];
    if (!sam) throw new Error("no Sam");
    const state = { ...at.state, entities: { ...at.state.entities, [POV]: { ...sam, name: "Sam Ortiz" } } };
    const heard = (who: string) => ({ ...THROUGH, world: [{ what: "A truck goes by outside.", surface: "A truck rumbles past the window.", said: null, by: [], perceived: [{ who, channel: "hearing", reach: "whole" }] }] });
    for (const who of ["sam_ortiz", "Sam-Ortiz", "sam ortiz", "[sam]"]) {
      const read = readWatch(heard(who), { world: at.world, state, present: [POV, "dev"], pc: POV, with: "dev" });
      expect(read?.world[0]?.perceived).toEqual([{ who: POV, channel: "hearing", reach: "whole" }]);
      expect(read?.notes).toEqual([]);
    }
    // A name that is no one's here is still left out, and said.
    const nobody = readWatch(heard("sam_ortega"), { world: at.world, state, present: [POV, "dev"], pc: POV, with: "dev" });
    expect(nobody?.world[0]?.perceived).toEqual([]);
    expect(nobody?.notes).toEqual(["The watch named “sam_ortega” as perceiving it, who isn't here; left out."]);
  });
});
