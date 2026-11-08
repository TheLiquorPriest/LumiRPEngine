// The world beyond view runs off screen (DEPTH-PLAN §4.6, §6.4, §6.5), through the after-reply step and
// the ledger: the poll opens an episode with each part's treatment; the episode runs at them (the
// author stages it and writes the world's beats, Dev plays his part live from his own mind, the GM
// resolves what he attempts) and lands as a draft, not canon; the next poll reads it among its open
// drafts with what has happened since its story time and settles it; the settlement makes its beats
// canon at the episode's own minute and its world changes now, and Dev catches up on what reached
// him; a swipe of the reply it settled at leaves the draft open again. The budget dial's allowances
// slide a part down the ladder once spent.

import { describe, expect, test } from "bun:test";
import type { ModelPort } from "../../src/backend/depth/port";
import { afterDepthReply, type AfterRt } from "../../src/backend/depth/scene/after";
import type { OffscreenPlugs } from "../../src/backend/depth/offscreen/episode";
import { effectTouches, OFFSCREEN_PLUGS } from "../../src/backend/depth/offscreen/episode";
import { DRAFT_TYPES, draftsOn, settledChipsOn } from "../../src/backend/depth/offscreen/drafts";
import { eventsOf } from "../../src/backend/ledger-io";
import { offscreenJobs, withinAllowances } from "../../src/backend/depth/offscreen/jobs";
import { seedCore } from "../../src/backend/character-agent";
import { defaultSettings } from "../../src/backend/settings-store";
import { AUTHOR_POLL, authorData, type PollData } from "../../src/shared/author";
import { mindV2At } from "../../src/shared/character-engine";
import type { DepthRole } from "../../src/shared/depth-settings";
import { STORY_DRAFT, STORY_SETTLE } from "../../src/shared/episodes";
import type { ChatId } from "../../src/shared/ids";
import type { Chip } from "../../src/shared/state-view";
import { blobHash } from "../../src/shared/stores";
import { beatEvent, beatId, type Beat } from "../../src/shared/story";
import type { TurnModel } from "../../src/engine/ledger/journal";
import { objOf, sliceOf } from "../../src/engine/pack-kit";
import authorPack from "../../src/packs/author/core/index";
import storyPack from "../../src/packs/story/core/index";
import { readKnowledge } from "../../src/packs/minds/core/state";
import { Harness } from "../support/harness";

const said = (who: string, line: string): Beat => ({ id: beatId(who, line), at: 0, order: 0, place: "home", actors: [who], act: "said", about: [], what: blobHash(line), surface: blobHash(line), exposure: [{ who: "sam", channel: "hearing", reach: "whole" }], by: { turn: line, decided: "player" } });

/** Each turn decides one beat at the clock, named by its seed: what the settlement reads as a pin. */
const model: TurnModel = {
  plan: ({ seed, state }) => [beatEvent({ ...said("sam", `turn ${seed}`), id: beatId(seed), at: state.clock })],
  read: () => [],
};

function rtOf(h: Harness): AfterRt {
  const stored = new Map<string, string>();
  const settings = defaultSettings();
  return {
    host: h.host,
    registry: h.registry,
    blobs: { get: async (_u, hash) => stored.get(hash) ?? null, put: async (_u, text) => (stored.set(blobHash(text), text), blobHash(text)) },
    settings: { get: async () => settings },
    ledger: h.service,
  };
}

/** Each role answers in turn from its own list, and every call's text is kept by role. */
function port(answers: Partial<Record<DepthRole, unknown[]>>): ModelPort & { sent: Partial<Record<DepthRole, string[]>> } {
  const sent: Partial<Record<DepthRole, string[]>> = {};
  const fn = (async (role, messages) => {
    (sent[role] ??= []).push(messages.map((m) => m.content).join("\n"));
    return { text: JSON.stringify(answers[role]?.shift() ?? {}), usage: { tokensIn: 1, tokensOut: 1 } };
  }) as ModelPort & { sent: Partial<Record<DepthRole, string[]>> };
  fn.sent = sent;
  return fn;
}

/** The GM resolves Dev's attempt to sell the boat by the rules: the sale's change, and the outcome as a beat. */
const plugs: OffscreenPlugs = {
  ...OFFSCREEN_PLUGS,
  resolveAttempt: async (_model, input) => ({
    read: { actions: [], dropped: [] },
    resolutions: [],
    events: [{ type: "story.flag", data: { name: "boat_sold", value: true } }],
    state: input.state as never,
    minutes: 5,
    outcome: { what: "The buyer pays Dev and takes the boat's keys.", surface: "Cash changes hands; the keys go with it.", about: [{ entity: input.act.actor }] },
    usage: { tokensIn: 1, tokensOut: 1 },
  }),
};

async function head(h: Harness, chat: ChatId) {
  const b = await h.service.basisFor(chat, h.host.userId);
  if (!b) throw new Error("no head");
  return b;
}

/** The Settled off screen chips the view shows, read as the view reads them: the chain's live draft events. */
async function settledChips(h: Harness, chat: ChatId): Promise<Chip[]> {
  let chips: Chip[] = [];
  await h.service.with(chat, h.host.userId, (core, observed) => {
    chips = settledChipsOn(core, observed, eventsOf(core, observed, DRAFT_TYPES));
  });
  return chips;
}

describe("the world beyond view, off screen", () => {
  test("the poll opens an episode, it runs at its treatments into a draft, the next poll settles it against what came since, and its people catch up", async () => {
    const h = new Harness("fresh", { packs: [storyPack, authorPack], model });
    const rt = rtOf(h);
    const userId = h.host.userId;
    const chat = await h.newChat();
    // Dev has a mind of his own: he can play live.
    const greeting = await head(h, chat);
    const core = seedCore({ who: "dev", at: 0, source: "card", text: "Dev runs the marina cafe and owes the bank." });
    for (const text of Object.values(core.blobs)) await rt.blobs.put(userId, text);
    expect((await h.service.landLayer(chat, userId, { id: "dev-core", basis: greeting, kind: "minds.v2.write", events: core.events })).status).toBe("landed");
    await h.send(chat, "I head home for the night.", "Sam walks home.");
    const first = await head(h, chat);

    const one = port({
      author: [
        // The poll: off screen, Dev sells his boat tonight; he plays it live, the buyer is written.
        { episodes: [{ why: "The bank calls in Dev's loan on Friday.", in: 0, minutes: 45, places: ["home"], people: ["dev"], parts: [{ who: "dev", treatment: "live", rationale: "his choice decides what he owes" }, { event: "the buyer", treatment: "written", rationale: "a walk-on" }] }], considered: [{ what: "Dev's debt", raised: true, why: "it comes due this week" }] },
        // The episode opens: a buyer comes; Dev acts first.
        { staging: [{ who: "dev", where: "on the dock by his boat", doing: "coiling a line" }], beats: [{ ref: "o1", by: "author", actors: [], act: "happened", what: "A buyer from the next town walks down the dock.", surface: "A stranger in a rain jacket walks down the dock.", exposure: [{ who: "dev", channel: "sight", reach: "whole" }] }], next: ["dev"], end: null, touches: [{ thing: "Dev's boat", after: 0 }], summary: "Dev sells his boat to a buyer." },
        // The step after Dev's play: it's done.
        { exposure: [], beats: [], next: [], end: "The sale is made.", summary: "Dev sold his boat to a buyer from the next town." },
      ],
      character: [{ say: "Ten thousand, and she's yours.", attempt: "sell the boat to the buyer", take: "I hate this. The bank leaves me nothing." }],
    });
    const after1 = await afterDepthReply(rt, chat, userId, first, { scene: null, ended: false, remember: [], poll: true, beats: [] }, { model: one, plugs });
    expect(after1.failed).toEqual([]);
    expect(after1.offscreen?.drafted).toHaveLength(1);
    const id = after1.offscreen?.drafted[0] ?? "";
    // The poll's record lists the episode it opened.
    const polled = (await h.service.readEvents(chat, userId, [AUTHOR_POLL])).map((e) => authorData<PollData>(e.event, AUTHOR_POLL));
    expect(polled.at(-1)?.jobs.map((j) => j.kind)).toEqual(["episode"]);
    // Dev played from his own mind; the GM resolved what he tried.
    expect(one.sent.character?.[0]).toContain("Dev runs the marina cafe");
    let drafts = draftsOn(await h.service.readEvents(chat, userId, DRAFT_TYPES));
    expect(drafts.map((d) => [d.draft.id, d.state])).toEqual([[id, "open"]]);
    const draft = drafts[0]?.draft;
    if (!draft) throw new Error("no draft");
    expect(draft.episode.parts.map((p) => p.treatment)).toEqual(["live", "written"]);
    expect(draft.beats.map((b) => [b.actors.join(","), b.by])).toEqual([
      ["", { draft: id }],
      ["dev", { draft: id }],
      ["", { draft: id }],
    ]);
    expect(draft.effects).toEqual([{ type: "story.flag", data: { name: "boat_sold", value: true } }]);
    expect(draft.touches.map((t) => t.ref)).toEqual([{ entity: "dev" }, { place: "home" }, { thing: "Dev's boat" }]);
    // Not canon: no beat of it is read, its change isn't made, and Dev's mind holds nothing of it.
    let story = await h.service.readStory(chat, userId);
    expect(story.beats.some((b) => "draft" in b.beat.by)).toBe(false);
    expect(objOf(sliceOf((await h.folds(chat)).reference.state, "story").flags)).toEqual({});
    expect(Object.keys(mindV2At((await h.folds(chat)).reference.state, "dev").files)).toEqual(["core.md"]);
    // Nothing settled yet: no chip says so.
    expect(await settledChips(h, chat)).toEqual([]);

    // The next turn, and its poll: the draft is open with one beat since its time, and the author settles it.
    await h.send(chat, "Morning. I walk down to the marina.", "Sam walks to the marina.");
    const second = await head(h, chat);
    const two = port({
      author: [
        { settle: [{ draft: id, why: "Sam is about to reach the dock." }] },
        { verdict: "settle", why: "Nothing Sam saw says otherwise.", beats: [{ ref: "d2", keep: true, deed: "I tell the buyer my price: ten thousand, and she's his." }, { ref: "d3", keep: true, surface: "Cash changes hands on the dock; the keys go with it." }] },
      ],
      character: [{ memories: [{ lived: [], about: [], text: "I sold her. Ten thousand. It still feels like losing a limb." }] }],
      gm: [{ facts: [{ ref: "f1", claim: "Dev sold his boat to a buyer from the next town.", matters: "Dev has no boat to work from now.", about: ["dev"] }], links: [] }],
    });
    const after2 = await afterDepthReply(rt, chat, userId, second, { scene: null, ended: false, remember: [], poll: true, beats: [] }, { model: two, plugs });
    expect(after2.failed).toEqual([]);
    const poll = two.sent.author?.[0] ?? "";
    expect(poll).toContain(`[${id}]`);
    // Its pins: both turns' beats, at or after the minute it starts (the episode began as the first reply ended).
    expect(poll).toContain("2 beats since its time");
    expect(poll).toContain("Live: 1 of 2 left this story week");
    // The settlement read the draft's beats against every beat since its time: the second turn's is one of them.
    expect(two.sent.author?.[1]).toContain("Its pins, every beat since its story time");
    expect(two.sent.author?.[1]).toContain("Dev sold his boat to a buyer from the next town.");
    expect(after2.offscreen).toMatchObject({ settled: [id], drafted: [], dropped: [] });
    drafts = draftsOn(await h.service.readEvents(chat, userId, DRAFT_TYPES));
    expect(drafts.map((d) => [d.draft.id, d.state])).toEqual([[id, "settled"]]);
    // The reply it settled at says so, with the summary, the day its beats happened, the author's reading, and Read, which opens the draft.
    const [chip, ...others] = await settledChips(h, chat);
    expect(others).toEqual([]);
    expect(chip).toMatchObject({ id: `settled:${second.message}:0:${id}`, kind: "settled", messageId: second.message, swipeId: 0, detail: "Nothing Sam saw says otherwise.", actions: [{ id: "read", label: "Read", input: { type: "draft", label: "Read", draft: id } }], expires: "next_send" });
    expect(chip?.label).toBe("Settled off screen: Dev sold his boat to a buyer from the next town. (Friday)");
    story = await h.service.readStory(chat, userId);
    const settled = story.beats.filter((b) => "draft" in b.beat.by);
    expect(settled).toHaveLength(3);
    // Backdated to the episode's own minute, though landed at the second reply.
    expect(Math.min(...settled.map((b) => b.beat.at))).toBe(draft.at);
    expect(settled.every((b) => b.from.messageId === second.message)).toBe(true);
    // The adjusted beats are new ones; the other is the draft's own. A rewritten beat with actors keeps the deed the settlement restated (L-9).
    expect(settled.map((b) => draft.beats.some((d) => d.id === b.beat.id))).toEqual([true, false, false]);
    const restated = settled[1]?.beat;
    expect(restated?.actors.length).toBeGreaterThan(0);
    expect(restated?.deed).toBe(blobHash("I tell the buyer my price: ten thousand, and she's his."));
    const out = (await h.folds(chat)).reference;
    expect(objOf(sliceOf(out.state, "story").flags)).toEqual({ boat_sold: true });
    expect(out.violations).toEqual([]);
    // Dev lived what reached him: his catch-up wrote it in his own words.
    expect(after2.offscreen?.said ?? []).toEqual([]);
    expect(two.sent.character?.[0]).toContain("Ten thousand, and she's yours.");
    expect(Object.keys(mindV2At(out.state, "dev").files).filter((p) => p.startsWith("memories/"))).toHaveLength(1);
    // The GM linked what the settlement made canon and what Dev's catch-up wrote (conformance finding 6).
    expect(two.sent.gm?.some((t) => t.includes("Cash changes hands on the dock; the keys go with it."))).toBe(true);
    expect(Object.values(readKnowledge(out.state).facts).map((f) => f.claim)).toEqual(["Dev sold his boat to a buyer from the next town."]);

    // A swipe of the reply it settled at: the draft is open again there, its change undone; a switch back settles it again.
    await h.host.finish(await h.host.start(chat, { type: "swipe" }), "Sam stays home instead.");
    await h.host.settle();
    expect(draftsOn(await h.service.readEvents(chat, userId, DRAFT_TYPES)).map((d) => d.state)).toEqual(["open"]);
    expect(await settledChips(h, chat)).toEqual([]);
    expect(objOf(sliceOf((await h.folds(chat)).reference.state, "story").flags)).toEqual({});
    h.host.navigate(chat, second.message, 0);
    await h.host.settle();
    expect(draftsOn(await h.service.readEvents(chat, userId, DRAFT_TYPES)).map((d) => d.state)).toEqual(["settled"]);
    expect((await settledChips(h, chat)).map((c) => c.id)).toEqual([`settled:${second.message}:0:${id}`]);
    expect((await h.service.layerSummaries(chat, userId)).map((s) => s.kind).filter((k) => k === STORY_DRAFT || k === STORY_SETTLE)).toEqual([STORY_DRAFT, STORY_SETTLE]);
  });

  test("a draft a swipe took off the chain comes back to rebase and lands again; a settlement keeps or refuses its changes; a pin that contradicts it drops it", async () => {
    const h = new Harness("fresh", { packs: [storyPack, authorPack], model });
    const rt = rtOf(h);
    const userId = h.host.userId;
    const chat = await h.newChat();
    const greeting = await head(h, chat);
    const core = seedCore({ who: "dev", at: 0, source: "card", text: "Dev runs the marina cafe and owes the bank." });
    for (const text of Object.values(core.blobs)) await rt.blobs.put(userId, text);
    expect((await h.service.landLayer(chat, userId, { id: "dev-core", basis: greeting, kind: "minds.v2.write", events: core.events })).status).toBe("landed");
    await h.send(chat, "I head home for the night.", "Sam walks home.");
    const first = await head(h, chat);
    const one = port({
      author: [
        { episodes: [{ why: "The bank calls in Dev's loan on Friday.", in: 0, minutes: 45, places: ["home"], people: ["dev"], parts: [{ who: "dev", treatment: "live", rationale: "his choice decides what he owes" }, { event: "the buyer", treatment: "written", rationale: "a walk-on" }] }] },
        { staging: [{ who: "dev", where: "on the dock by his boat", doing: "coiling a line" }], beats: [{ ref: "o1", by: "author", actors: [], act: "happened", what: "A buyer from the next town walks down the dock.", surface: "A stranger in a rain jacket walks down the dock.", exposure: [{ who: "dev", channel: "sight", reach: "whole" }] }], next: ["dev"], end: null, summary: "Dev sells his boat to a buyer." },
        { exposure: [], beats: [], next: [], end: "The sale is made.", summary: "Dev sold his boat to a buyer from the next town." },
      ],
      character: [{ say: "Ten thousand, and she's yours.", attempt: "sell the boat to the buyer", take: "I hate this." }],
    });
    const after1 = await afterDepthReply(rt, chat, userId, first, { scene: null, ended: false, remember: [], poll: true, beats: [] }, { model: one, plugs });
    expect(after1.failed).toEqual([]);
    const id = after1.offscreen?.drafted[0] ?? "";
    expect(id).not.toBe("");

    // A swipe of the reply it was drafted at takes it off the chain; the next poll is offered it to rebase, and it lands again at the new telling.
    await h.host.finish(await h.host.start(chat, { type: "swipe" }), "Sam lingers at the gate, then walks home.");
    await h.host.settle();
    expect(draftsOn(await h.service.readEvents(chat, userId, DRAFT_TYPES))).toEqual([]);
    const swiped = await head(h, chat);
    expect(swiped.message).toBe(first.message);
    expect(swiped.swipe).not.toBe(first.swipe);
    const rebase = port({ author: [{ rebase: [{ draft: id, why: "Nothing in this telling stops the sale." }] }] });
    const after2 = await afterDepthReply(rt, chat, userId, swiped, { scene: null, ended: false, remember: [], poll: true, beats: [] }, { model: rebase, plugs });
    expect(after2.failed).toEqual([]);
    expect(rebase.sent.author?.[0]).toContain("Drafts a swipe took off the chain");
    expect(rebase.sent.author?.[0]).toContain(`[${id}]`);
    expect(after2.offscreen).toMatchObject({ rebased: [id], said: [] });
    expect(draftsOn(await h.service.readEvents(chat, userId, DRAFT_TYPES)).map((d) => [d.draft.id, d.state])).toEqual([[id, "open"]]);

    // The settlement keeps its beats but refuses its world change: the boat isn't sold.
    await h.send(chat, "Morning. I walk down to the marina.", "Sam walks to the marina.");
    const second = await head(h, chat);
    const settle = port({
      author: [
        { settle: [{ draft: id, why: "Sam is about to reach the dock." }] },
        { verdict: "settle", why: "The talk happened, but the sale fell through.", beats: [], effects: [{ index: 1, keep: false }] },
      ],
      character: [{ memories: [] }],
      gm: [{ facts: [], links: [] }],
    });
    const after3 = await afterDepthReply(rt, chat, userId, second, { scene: null, ended: false, remember: [], poll: true, beats: [] }, { model: settle, plugs });
    expect(after3.failed).toEqual([]);
    expect(settle.sent.author?.[1]).toContain("The world changes it would make:\n1. ");
    expect(after3.offscreen?.settled).toEqual([id]);
    expect(objOf(sliceOf((await h.folds(chat)).reference.state, "story").flags)).toEqual({});

    // A swipe of that reply leaves it open again; this time a pin contradicts it (the boat is still at the dock), and the author drops it.
    await h.host.finish(await h.host.start(chat, { type: "swipe" }), "Sam walks to the marina; Dev's boat is tied at the dock as ever.");
    await h.host.settle();
    expect(draftsOn(await h.service.readEvents(chat, userId, DRAFT_TYPES)).map((d) => d.state)).toEqual(["open"]);
    const again = await head(h, chat);
    const contradicted = port({
      author: [
        { settle: [{ draft: id, why: "Sam is at the dock." }] },
        { verdict: "drop", why: "Pin p2: Sam sees Dev's boat tied at the dock this morning, so it was never sold." },
      ],
    });
    const after4 = await afterDepthReply(rt, chat, userId, again, { scene: null, ended: false, remember: [], poll: true, beats: [] }, { model: contradicted, plugs });
    expect(after4.failed).toEqual([]);
    expect(contradicted.sent.author?.[1]).toContain("Its pins, every beat since its story time");
    expect(after4.offscreen).toMatchObject({ dropped: [id], settled: [] });
    const last = draftsOn(await h.service.readEvents(chat, userId, DRAFT_TYPES));
    expect(last.map((d) => [d.draft.id, d.state])).toEqual([[id, "dropped"]]);
    expect(last[0]?.drop?.data.why).toContain("never sold");
    expect(objOf(sliceOf((await h.folds(chat)).reference.state, "story").flags)).toEqual({});
  });

  test("an episode part left unwritten past written goes in the treatment log's put-off lines", async () => {
    const h = new Harness("fresh", { packs: [storyPack, authorPack], model });
    const rt = rtOf(h);
    const settings = await rt.settings.get(h.host.userId);
    settings.depth.budget = { ...settings.depth.budget, allowances: { live: 0, campfire: 0, room: 0, written: 0 } };
    const userId = h.host.userId;
    const chat = await h.newChat();
    await h.send(chat, "I head home for the night.", "Sam walks home.");
    const first = await head(h, chat);
    const ask = { why: "A storm rolls in.", in: 0, minutes: 30, places: ["home"], people: ["sam"], parts: [{ subject: { event: "the radio" }, treatment: "written" as const, rationale: "a forecast" }] };
    const out = await offscreenJobs(rt, chat, userId, first, { episodes: [ask], settle: [], drop: [], rebase: [] }, { budget: settings.depth.budget, model: port({}) });
    expect(out.put).toEqual(["Episode 1: the radio: this story week's allowances are spent down to written, so it is left unwritten until it matters"]);
    expect(out.said).toEqual([]);
    expect(out.drafted).toEqual([]);
  });

  test("what a draft's world changes write becomes its touches: the thing and the places it moved between, never the player character's", () => {
    const e = (place: string) => ({ fields: { place }, relations: [] }) as never;
    const was = { entities: { dev: e("home"), boat: e("dock"), pc: e("cafe") } };
    const now = { entities: { dev: e("home"), boat: e("harbour"), pc: e("dock"), keys: e("cafe") } };
    expect(effectTouches(was, now, "pc")).toEqual([{ entity: "boat" }, { entity: "keys" }, { place: "harbour" }]);
  });

  test("a part past this interval's allowance slides down the ladder, said; one past written too is left unwritten", () => {
    const budget = { ...defaultSettings().depth.budget, allowances: { live: 1, campfire: 0, room: 1, written: 0 } as const };
    const lines: string[] = [];
    const ask = { why: "A storm.", in: 0, minutes: 30, places: ["home"], people: ["dev"], parts: [
      { subject: { who: "dev" }, treatment: "live" as const, rationale: "it matters" },
      { subject: { event: "the storm" }, treatment: "live" as const, rationale: "the town sees it" },
      { subject: { event: "the radio" }, treatment: "room" as const, rationale: "background" },
    ] };
    const out = withinAllowances(ask, budget, { live: 0, campfire: 0, room: 0, written: 0 }, lines);
    expect(out.parts.map((p) => p.treatment)).toEqual(["live", "room"]);
    expect(out.parts[1]?.rationale).toContain("live allowance is spent: room instead");
    expect(lines).toEqual(["the radio: this story week's allowances are spent down to written, so it is left unwritten until it matters"]);
  });
});
