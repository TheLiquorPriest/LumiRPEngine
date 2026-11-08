// The budget dial binds (DEPTH-PLAN §6.5, D-7): Settings → Depth → Budget's per-turn and per-day
// ceilings, in tokens. Today's spend is a UTC day's, kept in the user's storage across a restart and
// nothing once midnight UTC passes; a turn counts its scene's spend and each walk-on's; the step after
// the reply counts on from the turn's and, once a ceiling binds, starts nothing more: each put-off
// line is said and kept in the step's own `author.spend` at the reply, beside what it spent, and a
// swipe of the reply gives that back; with today's ceiling spent nothing runs at all. "Ask me": an
// episode past an allowance on a part the author judged major is held for the player, its chip under
// the reply; his tap lands his answer, and the episode drafts at the treatment he spent past the
// allowance for, whatever the ceilings, since his tap is his own decision. GM → Depth → Treatments
// reads all of it back off the chain: the ask waiting with its chip's buttons, the log newest first
// (the scene with each character's effort, the step after the reply, the ask and his answer, the
// episode at its treatment), the meter per lane, treatment and role, the allowances and the ceilings.

import { describe, expect, test } from "bun:test";
import { budgetWords, ceilingBinds, ceilingRoom, DAY_SPEND_PATH, DaySpend, dayOf, daySpendOf, recordedTokens, type TurnBudget } from "../../src/backend/depth/budget";
import { askAnswer, askChipsOn } from "../../src/backend/depth/offscreen/asks";
import { DRAFT_TYPES, draftsOn, draftWithTexts } from "../../src/backend/depth/offscreen/drafts";
import { draftAnswered, offscreenJobs } from "../../src/backend/depth/offscreen/jobs";
import type { ModelPort } from "../../src/backend/depth/port";
import { afterDepthReply, type AfterRt } from "../../src/backend/depth/scene/after";
import type { EpisodeAsk } from "../../src/backend/depth/scene/author";
import { spendData } from "../../src/backend/depth/spend";
import { treatmentsView } from "../../src/backend/depth/treatments-view";
import { defaultSettings } from "../../src/backend/settings-store";
import { AUTHOR_ASK, AUTHOR_SPEND, authorData, spendEvent, type AskData, type SpendData } from "../../src/shared/author";
import type { DepthBudget, DepthRole } from "../../src/shared/depth-settings";
import { episodeId } from "../../src/shared/episodes";
import type { ChatId } from "../../src/shared/ids";
import type { Chip } from "../../src/shared/state-view";
import { blobHash } from "../../src/shared/stores";
import { sceneEvent } from "../../src/shared/scene";
import { beatEvent, type Beat } from "../../src/shared/story";
import authorPack from "../../src/packs/author/core/index";
import storyPack from "../../src/packs/story/core/index";
import { FakeHost } from "../support/fake-host";
import { Harness } from "../support/harness";

const PIER = "Sam says the pier floods at eight.";
const PIER_WHAT = "Sam warns Dev that the pier floods at eight.";

function rtOf(h: Harness, budget: Partial<DepthBudget>): AfterRt {
  const stored = new Map<string, string>([PIER, PIER_WHAT].map((t) => [blobHash(t), t]));
  const settings = defaultSettings();
  settings.depth.budget = { ...settings.depth.budget, ...budget };
  return {
    host: h.host,
    registry: h.registry,
    blobs: { get: async (_u, hash) => stored.get(hash) ?? null, put: async (_u, text) => (stored.set(blobHash(text), text), blobHash(text)) },
    settings: { get: async () => settings },
    ledger: h.service,
  };
}

/** Each role answers in turn from its own list at what each call costs, and every call's text is kept by role. */
function port(answers: Partial<Record<DepthRole, unknown[]>>, usage = { tokensIn: 1, tokensOut: 1 }): ModelPort & { sent: Partial<Record<DepthRole, string[]>> } {
  const sent: Partial<Record<DepthRole, string[]>> = {};
  const fn = (async (role, messages) => {
    (sent[role] ??= []).push(messages.map((m) => m.content).join("\n"));
    return { text: JSON.stringify(answers[role]?.shift() ?? {}), usage };
  }) as ModelPort & { sent: Partial<Record<DepthRole, string[]>> };
  fn.sent = sent;
  return fn;
}

/** The turn's one beat, Sam's warning, as its record holds it. */
const pier: Beat = { id: "pier", at: 600, order: 600, scene: "s1", place: "home", actors: ["sam"], act: "said", about: [], what: blobHash(PIER_WHAT), surface: blobHash(PIER), exposure: [{ who: "dev", channel: "hearing", reach: "whole" }], by: { turn: "gen-1", decided: "player" } };

/** A chat with one reply, its turn's beat landed at it. */
async function replied(h: Harness) {
  const userId = h.host.userId;
  const chat = await h.newChat();
  await h.send(chat, "The pier floods at eight, Dev.");
  const basis = await h.service.basisFor(chat, userId);
  if (!basis) throw new Error("no basis");
  expect((await h.service.landLayer(chat, userId, { id: "turn", basis, kind: "story.beat", events: [beatEvent(pier)] })).status).toBe("landed");
  return { chat, basis, userId };
}

/** The `author.spend` records live on the chat's chain. */
async function spends(h: Harness, chat: ChatId): Promise<SpendData[]> {
  return (await h.service.readEvents(chat, h.host.userId, [AUTHOR_SPEND])).flatMap((e) => authorData<SpendData>(e.event, AUTHOR_SPEND) ?? []);
}

/** The poll opens an episode whose one part wants a room treatment, judged major. */
const STORM_POLL = { episodes: [{ why: "The storm reaches the town tonight.", in: 0, minutes: 30, places: ["home"], people: ["dev"], parts: [{ event: "the storm", treatment: "room", rationale: "the town will talk of nothing else", major: true }] }], considered: [{ what: "The storm", raised: true, why: "it will matter tomorrow" }] };

/** The author drafts the storm off screen. */
const STORM_DRAFT = { staging: [], beats: [{ ref: "o1", by: "author", actors: [], act: "happened", what: "The storm tears the awning off the cafe.", surface: "Wind rips the awning loose; it cartwheels down the street.", exposure: [{ who: "dev", channel: "sight", reach: "whole" }] }], next: [], end: "The storm passes.", touches: [], summary: "A storm tears the cafe's awning off." };

/** Room off screen is none this story week, and Ask me is on. */
const ROOMLESS: Partial<DepthBudget> = { allowances: { live: 2, campfire: 4, room: 0, written: "none" }, ask: true, perTurn: 10_000, perDay: 50_000 };

describe("the budget dial's ceilings", () => {
  test("today's spend is a UTC day's: kept in the user's storage across a restart, and nothing once midnight UTC passes", async () => {
    const host = new FakeHost();
    const user = host.userId;
    let now = Date.UTC(2026, 10, 7, 23, 50);
    const day = new DaySpend(host, () => now);
    await day.load(user);
    day.add(user, 1200);
    day.add(user, 300);
    day.add(user, 0);
    expect(day.tokens(user)).toBe(1500);
    await day.settled(user);
    expect(JSON.parse((await host.storage.read(DAY_SPEND_PATH, user)) ?? "null")).toEqual({ v: 1, day: "2026-11-07", tokens: 1500 });
    // A restart reads the day back.
    const restarted = new DaySpend(host, () => now);
    await restarted.load(user);
    expect(restarted.tokens(user)).toBe(1500);
    // Ten minutes later it is the 8th in UTC: a new day, whatever the local clock says.
    now = Date.UTC(2026, 10, 8, 0, 0);
    expect(dayOf(now - 1)).toBe("2026-11-07");
    expect(dayOf(now)).toBe("2026-11-08");
    expect(restarted.tokens(user)).toBe(0);
    restarted.add(user, 40);
    await restarted.settled(user);
    const nextDay = new DaySpend(host, () => now);
    await nextDay.load(user);
    expect(nextDay.tokens(user)).toBe(40);
  });

  test("today's ceiling is said first; a turn counts its scene's spend and each walk-on's", () => {
    const budget = { perTurn: 10_000, perDay: 50_000 } as const;
    expect(ceilingBinds(budget, 9_999, 49_999)).toBeNull();
    expect(ceilingBinds(budget, 10_000, 0)).toEqual({ which: "turn", limit: 10_000, spent: 10_000, words: "this turn has spent 10K tokens, at its ceiling of 10K (Settings → Depth → Budget → Per turn)" });
    expect(ceilingBinds(budget, 10_000, 50_000)).toMatchObject({ which: "day", limit: 50_000, spent: 50_000 });
    expect(ceilingBinds(budget, 0, 50_000)?.words).toBe("today's depth work has spent 50K tokens, at its ceiling of 50K (Settings → Depth → Budget → Per day)");
    expect(ceilingBinds({ perTurn: "none", perDay: "none" }, 1e12, 1e12)).toBeNull();
    // A walk-on's spend is for its draft, the scene's for the turn: the turn's record holds both.
    const walkOn = spendData({ cost: { calls: 1, tokensIn: 900, tokensOut: 100 }, roles: { author: { calls: 1, tokensIn: 900, tokensOut: 100 } } }, { treatment: "walk-on", interval: "week", at: 600, for: "d1" });
    const scene = spendData({ cost: { calls: 1, tokensIn: 4000, tokensOut: 1000 }, roles: { character: { calls: 1, tokensIn: 4000, tokensOut: 1000 } } }, { treatment: "scene", interval: "week", at: 600, for: "gen-1" });
    if (!walkOn || !scene) throw new Error("no spend");
    expect(recordedTokens([spendEvent(walkOn), beatEvent(pier), spendEvent(scene)])).toBe(6000);
  });

  test("a turn's author reads what the ceilings leave it, or the one that binds and what follows; nothing when neither is set", () => {
    const of = (budget: Pick<DepthBudget, "perTurn" | "perDay">, day: number): TurnBudget => ({ binds: (t) => ceilingBinds(budget, t, day), left: (t) => ceilingRoom(budget, t, day) });
    expect(ceilingRoom({ perTurn: 10_000, perDay: "none" }, 12_000, 0)).toEqual({ turn: 0, day: null });
    expect(budgetWords(of({ perTurn: 10_000, perDay: 50_000 }, 20_000), 4_000)).toBe(
      "The budget: this turn has spent 4K tokens, with about 6K left under its ceiling (Settings → Depth → Budget → Per turn); today's depth work has about 30K tokens left under its ceiling (Per day). Spend by it: once a ceiling binds, you are asked who slides down the ladder.",
    );
    expect(budgetWords(of({ perTurn: 10_000, perDay: "none" }, 0), 10_000)).toBe(
      "The budget binds: this turn has spent 10K tokens, at its ceiling of 10K (Settings → Depth → Budget → Per turn). Spend less from here: anyone you would give their own agent (a call each time they act) you play yourself (one call for several) or handle as part of the world. Who of those still playing as their own agent slides down the ladder, and how far, is yours to say; anyone still due as their own agent ends the scene at the next beat. How far the scene goes this turn is yours to judge.",
    );
    expect(budgetWords(of({ perTurn: "none", perDay: "none" }, 1e9), 1e9)).toBeNull();
  });

  test("the step after the reply counts on from the turn's spend: once the turn's ceiling binds it starts nothing more, and keeps what it put off with what it spent", async () => {
    const h = new Harness("fresh", { packs: [storyPack, authorPack] });
    const rt = rtOf(h, { perTurn: 10_000, perDay: "none" });
    const { chat, basis } = await replied(h);
    // The scene spent 8K; the GM's truth-link starts under the ceiling and takes the turn to 11K.
    const model = port({ gm: [{ facts: [], links: [] }] }, { tokensIn: 2500, tokensOut: 500 });
    const out = await afterDepthReply(rt, chat, h.host.userId, basis, { scene: "s1", ended: false, remember: [], poll: true, beats: ["pier"], spent: 8000, turn: "gen-1" }, { model });
    expect(model.sent.gm).toHaveLength(1);
    expect(model.sent.gm?.[0]).toContain(PIER_WHAT);
    // The poll never asked the author: put off, and said.
    expect(model.sent.author).toBeUndefined();
    const poll = "The author's poll: who catches up and reflects, and what happens off screen: this turn has spent 11K tokens, at its ceiling of 10K (Settings → Depth → Budget → Per turn)";
    expect(out).toMatchObject({ jobs: null, failed: [], offscreen: null, put: [poll] });
    // Its own spend lands at the reply: the truth-link's call, for the turn, with the line it put off.
    expect(await spends(h, chat)).toEqual([{ treatment: "after", interval: { unit: "week", from: 0 }, cost: { calls: 1, tokensIn: 2500, tokensOut: 500 }, roles: { gm: { calls: 1, tokensIn: 2500, tokensOut: 500 } }, day: dayOf(Date.now()), for: "gen-1", put: [poll] }]);
    // Spend folds with the work it paid for: a swipe of the reply gives it back.
    await h.host.finish(await h.host.start(chat, { type: "swipe", messageId: basis.message }), "Okay, at eight.");
    expect(await spends(h, chat)).toEqual([]);
  });

  test("with today's ceiling spent, the step after the reply makes no call and says what it put off", async () => {
    const h = new Harness("fresh", { packs: [storyPack, authorPack] });
    const rt = rtOf(h, { perTurn: 10_000, perDay: 50_000 });
    const { chat, basis, userId } = await replied(h);
    const day = daySpendOf(h.host);
    day.add(userId, 50_000);
    await day.settled(userId);
    const model = port({});
    const out = await afterDepthReply(rt, chat, userId, basis, { scene: "s1", ended: false, remember: [], poll: true, beats: ["pier"], turn: "gen-1" }, { model });
    expect(model.sent).toEqual({});
    const why = "today's depth work has spent 50K tokens, at its ceiling of 50K (Settings → Depth → Budget → Per day)";
    expect(out.put).toEqual([`The GM's truth-link of the turn's beats: ${why}`, `The author's poll: who catches up and reflects, and what happens off screen: ${why}`]);
    expect(out).toMatchObject({ linked: false, jobs: null, failed: [] });
    // Nothing spent, and the record still says what waited, never skipped silently.
    expect(await spends(h, chat)).toEqual([{ treatment: "after", interval: { unit: "week", from: 0 }, cost: { calls: 0, tokensIn: 0, tokensOut: 0 }, roles: {}, day: dayOf(Date.now()), for: "gen-1", put: out.put }]);
  });

  test("Ask me: an episode past its allowance on a major part is held for the player; his tap drafts it at the treatment he spent for, whatever the ceilings", async () => {
    const h = new Harness("fresh", { packs: [storyPack, authorPack] });
    const rt = rtOf(h, ROOMLESS);
    const userId = h.host.userId;
    const chat = await h.newChat();
    await h.send(chat, "I close up and watch the sky.", "The wind picks up over the bay.");
    const basis = await h.service.basisFor(chat, userId);
    if (!basis) throw new Error("no basis");
    // The poll opens an episode whose one part wants a room treatment, judged major; this story week's room allowance is none.
    const one = port({ author: [STORM_POLL] });
    const after = await afterDepthReply(rt, chat, userId, basis, { scene: null, ended: false, remember: [], poll: true, beats: [] }, { model: one });
    expect(after.failed).toEqual([]);
    const asked = after.offscreen?.asked[0] ?? "";
    expect(after.offscreen).toMatchObject({ asked: [asked], drafted: [], put: [] });
    expect(asked).not.toBe("");
    // Nothing drafted: the chip under the reply asks him.
    expect(draftsOn(await h.service.readEvents(chat, userId, DRAFT_TYPES))).toEqual([]);
    const chipsNow = async (): Promise<Chip[]> => {
      let chips: Chip[] = [];
      await h.service.with(chat, userId, (core, observed) => {
        chips = askChipsOn(core, observed);
      });
      return chips;
    };
    const [chip] = await chipsNow();
    if (!chip) throw new Error("no chip");
    expect(chip).toMatchObject({ kind: "allowance", messageId: basis.message, label: "The storm wants a room treatment; this story week's allowance is none. Spend one more?", expires: "never" });
    expect(chip.id).toBe(`allowance:${basis.message}:0:${asked}`);
    expect(chip.detail).toContain("The storm: the town will talk of nothing else");
    expect(chip.actions.map((a) => [a.id, a.label])).toEqual([
      ["spend", "Spend one more"],
      ["keep", "Keep to the allowance"],
    ]);

    // His tap lands his answer; the chip goes, and a second tap has lapsed.
    const tap = await askAnswer(rt, chat, userId, chip.id, "spend");
    if ("lapsed" in tap) throw new Error(tap.lapsed);
    expect(tap).toMatchObject({ applied: true, pending: false, spend: true });
    expect(await chipsNow()).toEqual([]);
    expect(await askAnswer(rt, chat, userId, chip.id, "keep")).toEqual({ lapsed: "the chip has lapsed: it was answered" });

    // Today's ceiling is spent, yet the episode he paid for drafts: the ceilings bind the author's own work.
    const day = daySpendOf(h.host);
    day.add(userId, 50_000);
    await day.settled(userId);
    const two = port({ author: [STORM_DRAFT] });
    const settings = await rt.settings.get(userId);
    const drafted = await draftAnswered(rt, chat, userId, tap, { budget: settings.depth.budget, model: two });
    expect(drafted.said).toEqual([]);
    expect(drafted.landed?.status).toBe("landed");
    expect(drafted.draft?.episode.parts).toEqual([{ subject: { event: "the storm" }, treatment: "room", rationale: "the town will talk of nothing else (you spent one more past this story week's room allowance)" }]);
    const drafts = draftsOn(await h.service.readEvents(chat, userId, DRAFT_TYPES));
    expect(await Promise.all(drafts.map(async (d) => [(await draftWithTexts(rt.blobs, userId, d.draft)).summary, d.state]))).toEqual([["A storm tears the cafe's awning off.", "open"]]);
    // What drafting it cost counts at its treatment, for the draft.
    expect((await spends(h, chat)).map((s) => [s.treatment, s.for, s.cost.calls])).toEqual([
      ["after", basis.message, 1],
      ["room", drafted.draft?.id ?? "", 1],
    ]);
  });

  test("offscreenJobs' `first`: a poll at a reply where one already ran opens its episodes after that one's, each held at its own place, so no episode id meets another", async () => {
    const h = new Harness("fresh", { packs: [storyPack, authorPack] });
    const rt = rtOf(h, ROOMLESS);
    const userId = h.host.userId;
    const chat = await h.newChat();
    await h.send(chat, "I close up and watch the sky.", "The wind picks up over the bay.");
    const basis = await h.service.basisFor(chat, userId);
    if (!basis) throw new Error("no basis");
    const { budget } = (await rt.settings.get(userId)).depth;
    // Each episode's one part wants a room treatment, judged major; with this story week's room allowance none, each is held for the player at its place.
    const storm = (why: string): EpisodeAsk => ({ why, in: 0, minutes: 30, places: ["home"], people: ["dev"], parts: [{ subject: { event: "the storm" }, treatment: "room", rationale: "the town will talk of nothing else", major: true }] });
    const none = { settle: [], drop: [], rebase: [] };
    const id = (index: number): string => episodeId(chat, basis.message, basis.swipe, String(index));
    // The first poll at the reply opens one, from the start.
    expect((await offscreenJobs(rt, chat, userId, basis, { ...none, episodes: [storm("The storm reaches the town tonight.")] }, { budget })).asked).toEqual([id(0)]);
    // A poll there again (the clock moved on since), told the one already opened, opens its two after it.
    const again = await offscreenJobs(rt, chat, userId, basis, { ...none, episodes: [storm("The harbor floods."), storm("The power goes out.")] }, { budget, first: 1 });
    expect(again).toMatchObject({ asked: [id(1), id(2)], said: [], put: [] });
    const asks = (await h.service.readEvents(chat, userId, [AUTHOR_ASK])).flatMap((e) => authorData<AskData>(e.event, AUTHOR_ASK) ?? []);
    expect(asks.map((a) => [a.index, a.id, a.why])).toEqual([
      [0, id(0), "The storm reaches the town tonight."],
      [1, id(1), "The harbor floods."],
      [2, id(2), "The power goes out."],
    ]);
  });

  test("GM → Depth → Treatments reads the ask waiting, the log, the meter, this interval's allowances and the ceilings back off the chain", async () => {
    const h = new Harness("fresh", { packs: [storyPack, authorPack] });
    const rt = rtOf(h, ROOMLESS);
    const userId = h.host.userId;
    const chat = await h.newChat();
    await h.send(chat, "I close up and watch the sky.", "The wind picks up over the bay.");
    const basis = await h.service.basisFor(chat, userId);
    if (!basis) throw new Error("no basis");
    const view = () => treatmentsView({ host: h.host, settings: rt.settings, ledger: h.service, blobs: rt.blobs }, chat, userId);
    const { state } = (await h.folds(chat)).reference;
    const dev = state.entities.dev?.name ?? "dev";
    // The turn's record: the author played Dev, and the scene's beats stopped at the per-turn ceiling; what it spent.
    const ceiling = "The scene's beats after this moment, to the next turn: this turn has spent 10K tokens, at its ceiling of 10K (Settings → Depth → Budget → Per turn)";
    const scene = spendData({ cost: { calls: 3, tokensIn: 6000, tokensOut: 1500, reasoningOut: 500 }, roles: { author: { calls: 2, tokensIn: 5000, tokensOut: 1000 }, narrator: { calls: 1, tokensIn: 1000, tokensOut: 500 } } }, { treatment: "scene", interval: "week", at: state.clock, for: "gen-1", put: [ceiling] });
    if (!scene) throw new Error("no spend");
    expect((await h.service.landLayer(chat, userId, { id: "turn", basis, kind: "story.beat", events: [sceneEvent({ scene: "s1", place: "home", at: state.clock, cast: [{ who: "dev", effort: "author", why: "a quiet evening" }], opens: true }), spendEvent(scene)] })).status).toBe("landed");
    // The step after the reply: the poll holds the storm for the player.
    const after = await afterDepthReply(rt, chat, userId, basis, { scene: "s1", ended: false, remember: [], poll: true, beats: [], spent: 7500, turn: "gen-1" }, { model: port({ author: [STORM_POLL] }, { tokensIn: 1000, tokensOut: 200 }) });
    const asked = after.offscreen?.asked[0] ?? "";
    expect(asked).not.toBe("");

    const first = await view();
    expect(first.on).toBe(true);
    expect(first.asks.map((a) => [a.chip, a.label, a.at.index, a.actions])).toEqual([
      [
        `allowance:${basis.message}:0:${asked}`,
        "The storm wants a room treatment; this story week's allowance is none. Spend one more?",
        2,
        [
          { id: "spend", label: "Spend one more", primary: true },
          { id: "keep", label: "Keep to the allowance" },
        ],
      ],
    ]);
    expect(first.asks[0]?.detail).toContain("The storm: the town will talk of nothing else");
    // The log, newest first: the step after the reply, the ask held for him, the turn's scene.
    expect(first.log.map((e) => [e.kind, e.state ?? null, e.at.index])).toEqual([
      ["after", null, 2],
      ["ask", "waiting", 2],
      ["scene", null, 2],
    ]);
    expect(first.log[0]).toEqual({ kind: "after", title: "After the reply", when: null, at: { messageId: basis.message, index: 2 }, lines: [], cost: { calls: 1, tokens: 1200 }, put: [] });
    expect(first.log[1]).toMatchObject({ title: "The storm wants a room treatment; this story week's allowance is none.", lines: [{ subject: "the storm", depth: "Room", why: "the town will talk of nothing else (judged major)" }], put: [] });
    expect(first.log[2]).toMatchObject({ title: "Scene at Home", lines: [{ subject: dev, depth: "Played by the author", why: "a quiet evening" }], cost: { calls: 3, tokens: 7500, reasoning: 500 }, put: [ceiling] });
    // The meter: one story week, now, per lane and per role.
    expect(first.meter.map((m) => [m.label.startsWith("Story week: "), m.now])).toEqual([[true, true]]);
    expect(first.meter[0]?.total).toEqual({ calls: 4, tokens: 8700, reasoning: 500 });
    expect(first.meter[0]?.lanes).toEqual([
      { lane: "scene", cost: { calls: 3, tokens: 7500, reasoning: 500 } },
      { lane: "after", cost: { calls: 1, tokens: 1200 } },
      { lane: "offscreen", cost: { calls: 0, tokens: 0 } },
    ]);
    expect(first.meter[0]?.roles).toEqual([
      { role: "author", cost: { calls: 3, tokens: 7200 } },
      { role: "narrator", cost: { calls: 1, tokens: 1500 } },
    ]);
    expect(first.meter[0]?.treatments).toEqual([]);
    // The budget dial as it stands: nothing drafted yet, the latest turn's spend everything at its reply, today's a UTC day's.
    expect(first.allowances).toEqual([
      { treatment: "live", allowance: 2, spent: 0 },
      { treatment: "campfire", allowance: 4, spent: 0 },
      { treatment: "room", allowance: 0, spent: 0 },
      { treatment: "written", allowance: null, spent: 0 },
    ]);
    expect(first.ceilings.map((c) => [c.which, c.limit, c.spent, c.reached])).toEqual([
      ["turn", 10_000, 8700, false],
      ["day", 50_000, 0, false],
    ]);
    expect(first.ceilings[0]?.of).toBe("The latest turn, at message 2: its scene, the step after its reply and the work off screen that step started");
    expect(first.ceilings[1]?.of).toContain(`Today, ${dayOf(Date.now())}, a UTC day`);
    expect(first.interval).toBe(first.meter[0]?.label ?? "");
    expect([first.ask, first.threshold]).toEqual([true, defaultSettings().depth.budget.threshold]);

    // He spends one more, with today's ceiling spent; the episode drafts at its room treatment.
    const tap = await askAnswer(rt, chat, userId, first.asks[0]?.chip ?? "", "spend");
    if ("lapsed" in tap) throw new Error(tap.lapsed);
    const day = daySpendOf(h.host);
    day.add(userId, 50_000);
    await day.settled(userId);
    expect((await draftAnswered(rt, chat, userId, tap, { budget: (await rt.settings.get(userId)).depth.budget, model: port({ author: [STORM_DRAFT] }) })).landed?.status).toBe("landed");
    const second = await view();
    expect(second.asks).toEqual([]);
    expect(second.log.map((e) => [e.kind, e.state ?? null])).toEqual([
      ["episode", "open"],
      ["after", null],
      ["ask", "spent"],
      ["scene", null],
    ]);
    expect(second.log[0]).toMatchObject({ title: "A storm tears the cafe's awning off.", lines: [{ subject: "the storm", depth: "Room", why: "the town will talk of nothing else (you spent one more past this story week's room allowance)" }], cost: { calls: 1, tokens: 2 }, put: [] });
    expect(second.meter[0]?.treatments).toEqual([{ treatment: "room", episodes: 1, cost: { calls: 1, tokens: 2 } }]);
    expect(second.meter[0]?.lanes[2]).toEqual({ lane: "offscreen", cost: { calls: 1, tokens: 2 } });
    expect(second.allowances[2]).toEqual({ treatment: "room", allowance: 0, spent: 1 });
    expect(second.ceilings.map((c) => [c.which, c.spent, c.reached])).toEqual([
      ["turn", 8702, false],
      ["day", 50_000, true],
    ]);
  });
});
