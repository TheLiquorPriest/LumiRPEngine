// What an open draft holds, and what follows a draft through the ledger (DEPTH-PLAN §4.6, §4.7; A3):
// a catch-up lives nothing of someone's from the minute an open draft holds them until it settles or
// is dropped; what depth's work cost folds with that work, so a swipe gives back a turn's spend and
// never a draft's anchored before it; a routine moves no one a draft holds for its span, and a drop
// lets them go; and a branch lists the drafts it inherits from its parent as rebase candidates after a
// swipe there.

import { describe, expect, test } from "bun:test";
import { catchUpNow, type EngineRt } from "../../src/backend/character-engine";
import { DRAFT_TYPES, draftsOn } from "../../src/backend/depth/offscreen/drafts";
import { offscreenFacts, type JobsRt } from "../../src/backend/depth/offscreen/jobs";
import type { ModelPort } from "../../src/backend/depth/port";
import { SPEND_TYPES, spendsOn } from "../../src/backend/depth/spend";
import { defaultSettings } from "../../src/backend/settings-store";
import { spendEvent, type SpendData } from "../../src/shared/author";
import { mindV2At } from "../../src/shared/character-engine";
import { dropEvent, draftEvent, pinsOf, settleEvent, AUTHOR_DROP, STORY_DRAFT, type DraftData } from "../../src/shared/episodes";
import type { ChatId, MessageId } from "../../src/shared/ids";
import type { LayerDraft, Basis } from "../../src/shared/layer";
import type { LedgerEvent } from "../../src/shared/ledger";
import { beatEvent, beatId, type Beat } from "../../src/shared/story";
import { blobHash } from "../../src/shared/stores";
import type { TurnModel } from "../../src/engine/ledger/journal";
import authorPack from "../../src/packs/author/core/index";
import storyPack from "../../src/packs/story/core/index";
import { Harness } from "../support/harness";
import type { Working } from "../../src/engine/working";
import { at, fixed, foldBoth, lapse, pin, record, routine, town, whereabouts, withRoutines } from "../packs/castlife/town";

const TEXT = {
  pier: "Sam says the pier floods at eight.",
  pierWhat: "Sam warns Dev that the pier floods at eight.",
  dock: "Sam points at the boat tied up at the dock.",
  dockWhat: "Sam shows Dev the boat he means to sell.",
};

/** A beat that reached Dev whole at `at`, seen and heard (heard alone, with no words or point of view of his, nothing of it would be his to live yet: LIVE3c L3c-4). */
function devBeat(id: string, at: number, surface: string, what: string): Beat {
  return { id, at, order: 1, place: "home", actors: ["sam"], act: "said", about: [], what: blobHash(what), surface: blobHash(surface), exposure: [{ who: "dev", channel: "sight", also: ["hearing"], reach: "whole" }], by: { entry: "test" } };
}

/** A draft of `people`'s episode over `span`, holding each of them from its start. */
function draftOfSpan(id: string, people: string[], span: [number, number]): DraftData {
  return {
    id,
    episode: { id: `e-${id}`, span, places: ["home"], people, why: "The boat has to go before the bank calls.", parts: people.map((who) => ({ subject: { who }, treatment: "written" as const, rationale: "routine business off screen" })) },
    at: span[0],
    inputs: {},
    beats: [{ id: `${id}-sale`, at: span[0], order: 0, place: "home", actors: people, act: "did", about: [], what: blobHash(`what ${id}`), surface: blobHash(`surface ${id}`), exposure: [], by: { draft: id } }],
    effects: [],
    touches: people.map((who) => ({ ref: { entity: who }, from: span[0] })),
    summary: "The boat changes hands at the marina.",
  };
}

const draftEntry = (d: DraftData, basis: Basis, events: LedgerEvent[] = []): LayerDraft => ({ id: `draft-${d.id}`, basis, kind: STORY_DRAFT, events: [draftEvent(d), ...events] });
const dropEntry = (d: DraftData, basis: Basis): LayerDraft => ({ id: `drop-${d.id}`, basis, kind: AUTHOR_DROP, events: [dropEvent({ draft: d.id, why: "The player saw the boat at the marina since." })] });

/** What a piece of work cost, as its record carries it. */
function spend(work: SpendData["treatment"], what: string): LedgerEvent {
  const cost = { calls: 1, tokensIn: 100, tokensOut: 20 };
  return spendEvent({ treatment: work, interval: { unit: "day", from: 0 }, cost, roles: { narrator: cost }, day: "2026-11-07", for: what });
}

/** A runtime over the harness: its ledger, the shipped settings, the test's texts as blobs. */
function rtOf(h: Harness): EngineRt & JobsRt {
  const stored = new Map<string, string>(Object.values(TEXT).map((t) => [blobHash(t), t]));
  return {
    host: h.host,
    registry: h.registry,
    blobs: {
      get: async (_u, hash) => stored.get(hash) ?? null,
      put: async (_u, text) => (stored.set(blobHash(text), text), blobHash(text)),
    },
    settings: { get: async () => defaultSettings() },
    ledger: h.service,
  } as EngineRt & JobsRt;
}

/** A port answering each call with the next answer, keeping what it was sent. */
function port(...answers: unknown[]): ModelPort & { sent: string[] } {
  const sent: string[] = [];
  const fn = (async (_role, messages) => {
    sent.push(messages.map((m) => m.content).join("\n"));
    return { text: JSON.stringify(answers.shift() ?? {}), usage: { tokensIn: 1, tokensOut: 1 } };
  }) as ModelPort & { sent: string[] };
  fn.sent = sent;
  return fn;
}

async function basisOf(h: Harness, chat: ChatId, messageId?: MessageId): Promise<Basis> {
  const b = await h.service.basisFor(chat, h.host.userId, messageId);
  if (!b) throw new Error(`no basis for ${messageId ?? "the head"}`);
  return b;
}

async function land(h: Harness, chat: ChatId, d: LayerDraft): Promise<string> {
  const out = await h.service.landLayer(chat, h.host.userId, d);
  await h.host.settle();
  return out.status;
}

/** Both folds (warm and cold) agree, with no violation and no ledger error. */
async function agree(h: Harness, chat: ChatId): Promise<void> {
  const { reference, optimized, cold } = await h.folds(chat);
  expect(optimized.state).toEqual(reference.state);
  expect(cold.state).toEqual(reference.state);
  expect(reference.violations).toEqual([]);
  expect(h.service.errors).toEqual([]);
}

/** Riverton where Jordan's shift ends at half past five (his schedule), he has dinner at home, and he reads at the library at seven. */
const evening = (): Working =>
  town((wd) => {
    delete wd.schedules.you_work;
    withRoutines(wd, [routine("r_jordan", "jordan", [fixed("reading", "19:00", 120, { place: "library" }, { activity: "reading" })])]);
  });

/** Time running to each of `times` on the first day, with where Jordan is and what he does then. */
const walk = (w: Working, times: string[]): string[] =>
  times.map((t) => {
    lapse(w, at(w, 0, t));
    return `${t} ${whereabouts(w, "jordan").join("/")}`;
  });

/** That evening with a draft holding Jordan from noon until `until`. */
const heldUntil = (until: string): { w: Working; d: DraftData } => {
  const w = evening();
  const d = draftOfSpan("d-jordan", ["jordan"], [at(w, 0, "12:00"), at(w, 0, until)]);
  record(w, [pin("maya", "live"), draftEvent(d)]);
  return { w, d };
};

describe("what an open draft holds, through the ledger", () => {
  test("a catch-up lives what reached someone before an open draft holds them, nothing from then on, and the rest once the draft is dropped", async () => {
    const h = new Harness("fresh", { packs: [storyPack, authorPack] });
    const rt = rtOf(h);
    const userId = h.host.userId;
    const chat = await h.newChat();
    await h.send(chat, "hello");
    const b1 = await basisOf(h, chat);
    expect(await land(h, chat, { id: "beats", basis: b1, kind: "story.beat", events: [devBeat("pier", 600, TEXT.pier, TEXT.pierWhat), devBeat("dock", 700, TEXT.dock, TEXT.dockWhat)].map(beatEvent) })).toBe("landed");
    // The draft holds Dev from 650: the pier came before it, the dock after.
    const d = draftOfSpan("d-boat", ["dev"], [650, 760]);
    expect(await land(h, chat, draftEntry(d, b1))).toBe("landed");

    const model = port({ memories: [{ lived: ["pier"], about: ["sam"], text: "Sam warned me about the pier." }] });
    const first = await catchUpNow(rt, chat, userId, "dev", { model });
    expect(first).toMatchObject({ lived: 1, held: ["d-boat"] });
    expect(model.sent).toHaveLength(1);
    expect(model.sent[0]).toContain(TEXT.pier);
    expect(model.sent[0]).not.toContain(TEXT.dock);
    // Asked again while the draft is open, nothing more is lived and no call is made.
    const idle = port();
    expect(await catchUpNow(rt, chat, userId, "dev", { model: idle })).toMatchObject({ lived: 0, held: ["d-boat"] });
    expect(idle.sent).toEqual([]);
    const mid = await h.service.foldAtBasis(chat, userId, await basisOf(h, chat));
    expect(Object.keys(mid ? mindV2At(mid.state, "dev").lived : {}).sort()).toEqual(["pier"]);

    // Dropped, it holds no one: the dock is lived.
    expect(await land(h, chat, dropEntry(d, await basisOf(h, chat)))).toBe("landed");
    const after = port({ memories: [{ lived: ["dock"], about: ["sam"], text: "Sam showed me the boat." }] });
    expect(await catchUpNow(rt, chat, userId, "dev", { model: after })).toMatchObject({ lived: 1, held: [] });
    expect(after.sent[0]).toContain(TEXT.dock);
    const end = await h.service.foldAtBasis(chat, userId, await basisOf(h, chat));
    expect(Object.keys(end ? mindV2At(end.state, "dev").lived : {}).sort()).toEqual(["dock", "pier"]);
    await agree(h, chat);
  });

  test("a swipe gives back the turn's spend, a switch back restores it, and a draft's spend anchored at an earlier reply stays throughout", async () => {
    // Each turn spends on its scene, in its own record.
    const model: TurnModel = {
      plan: ({ seed, state, userTexts }) => [beatEvent({ ...devBeat(beatId(seed), state.clock, TEXT.pier, TEXT.pierWhat), by: { turn: seed, decided: "player" } }), spend("scene", `turn ${userTexts.at(-1) ?? ""} ${seed}`)],
      read: () => [],
    };
    const h = new Harness("fresh", { packs: [storyPack, authorPack], model });
    const chat = await h.newChat();
    await h.send(chat, "Hello.", "First reply.");
    const a1 = (await h.chain(chat)).at(-1)?.id ?? "";
    const d = draftOfSpan("d-boat", ["dev"], [650, 760]);
    expect(await land(h, chat, draftEntry(d, await basisOf(h, chat, a1), [spend("written", d.id)]))).toBe("landed");
    await h.send(chat, "Again.", "Second reply.");
    const a2 = (await h.chain(chat)).at(-1)?.id ?? "";

    const spent = async (): Promise<string[]> => {
      await agree(h, chat);
      return spendsOn(await h.service.readEvents(chat, h.host.userId, SPEND_TYPES)).map((s) => `${s.data.treatment}: ${s.data.for}`);
    };
    const made = await spent();
    expect(made).toHaveLength(3);
    const [turn1, draft, turn2] = made as [string, string, string];
    expect(turn1).toStartWith("scene: turn Hello.");
    expect(draft).toBe("written: d-boat");
    expect(turn2).toStartWith("scene: turn Again.");

    // The swipe's new turn spends its own; the old one's is given back, the draft's stays.
    const g = await h.host.start(chat, { type: "swipe" });
    await h.host.finish(g, "Second reply, again.");
    await h.host.settle();
    const swiped = await spent();
    expect(swiped.slice(0, 2)).toEqual([turn1, draft]);
    expect(swiped).toHaveLength(3);
    expect(swiped).not.toContain(turn2);
    expect(swiped[2]).toStartWith("scene: turn Again.");

    h.host.navigate(chat, a2, 0);
    await h.host.settle();
    expect(await spent()).toEqual([turn1, draft, turn2]);
  });

  test("a routine moves no one an open draft holds for its span; a drop lets them go", () => {
    // Unheld, his schedule takes him home at five and his routine to the library at seven.
    const free = evening();
    record(free, [pin("maya", "live")]);
    expect(walk(free, ["12:00", "17:45", "18:00"])).toEqual(["12:00 office/work_shift", "17:45 jordan_house/idle", "18:00 jordan_house/dinner"]);

    // A draft holds him from noon until half past seven: neither his schedule's edge nor his routine's slot step moves him then.
    const kept = heldUntil("19:30");
    expect(walk(kept.w, ["12:00", "17:45", "18:00"])).toEqual(["12:00 office/work_shift", "17:45 office/work_shift", "18:00 office/work_shift"]);

    // Dropped within the span, before either edge, it holds him no longer: both move him as if it never was.
    const dropped = heldUntil("19:30");
    expect(walk(dropped.w, ["12:00", "13:00"])).toEqual(["12:00 office/work_shift", "13:00 office/work_shift"]);
    record(dropped.w, [dropEvent({ draft: dropped.d.id, why: "The author let it go." })]);
    expect(walk(dropped.w, ["17:45", "18:00"])).toEqual(["17:45 jordan_house/idle", "18:00 jordan_house/dinner"]);
  });

  test("a drop while its draft still holds him gives him back where the latest routine moment due under the hold puts him, as the next run opens, in both folds; a settled draft's hold stays", () => {
    // Never held, his schedule's edge takes him home at half past five, and the slot step at six to dinner, where eight still finds him.
    const free = evening();
    record(free, [pin("maya", "live")]);
    expect(walk(free, ["12:00", "17:45", "18:00", "20:00"])).toEqual(["12:00 office/work_shift", "17:45 jordan_house/idle", "18:00 jordan_house/dinner", "20:00 jordan_house/dinner"]);

    // Held from noon until ten, he is still at the office at eight, past both.
    const office = ["12:00 office/work_shift", "17:45 office/work_shift", "18:00 office/work_shift", "20:00 office/work_shift"];
    const dropped = heldUntil("22:00");
    expect(walk(dropped.w, ["12:00", "17:45", "18:00", "20:00"])).toEqual(office);
    // Dropped at eight, it never happened: the run opening there puts him where six's slot step does, before its clock moves on.
    record(dropped.w, [dropEvent({ draft: dropped.d.id, why: "The author let it go." })]);
    const before = dropped.w.events.length;
    expect(walk(dropped.w, ["20:01"])).toEqual(["20:01 jordan_house/dinner"]);
    const opened = dropped.w.events.slice(before);
    expect(opened.slice(0, opened.findIndex((e) => e.type === "clock"))).toEqual([
      { type: "set", entity: "jordan", field: "place", value: "jordan_house" },
      { type: "set", entity: "jordan", field: "activity", value: "dinner" },
    ]);
    // Given back once: a later run leaves him to the story and his routine.
    expect(walk(dropped.w, ["20:30"])).toEqual(["20:30 jordan_house/dinner"]);
    const folded = foldBoth(dropped.w.world, dropped.w.events);
    expect(folded.state.entities).toEqual(dropped.w.state.entities);
    expect(folded.state.packs).toEqual(dropped.w.state.packs);

    // Settled at eight, its episode is canon for its span: he stays as it holds him.
    const settled = heldUntil("22:00");
    expect(walk(settled.w, ["12:00", "17:45", "18:00", "20:00"])).toEqual(office);
    record(settled.w, [settleEvent({ draft: settled.d.id, at: settled.d.at, pins: pinsOf({ beats: [] }, settled.d.at), why: "It stands.", beats: [] })]);
    expect(walk(settled.w, ["20:01", "20:30"])).toEqual(["20:01 office/work_shift", "20:30 office/work_shift"]);
    const canon = foldBoth(settled.w.world, settled.w.events);
    expect(canon.state.entities).toEqual(settled.w.state.entities);
  });

  test("a branch lists a draft it inherits from its parent as a rebase candidate after a swipe of the reply it read", async () => {
    const h = new Harness("fresh", { packs: [storyPack, authorPack] });
    const rt = rtOf(h);
    const userId = h.host.userId;
    const chat = await h.newChat();
    await h.send(chat, "Hello.", "First reply.");
    await h.send(chat, "Again.", "Second reply.");
    const a2 = (await h.chain(chat)).at(-1)?.id ?? "";
    const d = draftOfSpan("d-boat", ["dev"], [650, 760]);
    expect(await land(h, chat, draftEntry(d, await basisOf(h, chat, a2)))).toBe("landed");

    const facts = async (c: ChatId) => {
      const read = await h.service.foldAtBasis(c, userId, await basisOf(h, c), DRAFT_TYPES);
      if (!read) throw new Error("off chain");
      const out = await offscreenFacts(rt, c, userId, read, defaultSettings().depth.budget);
      return { open: out.drafts.map((x) => x.id), rebase: out.rebase.map((x) => x.id), states: draftsOn(read.events).map((x) => `${x.draft.id}: ${x.state}`) };
    };
    const branch = h.host.branch(chat, a2);
    await h.host.chats.mergeChatMetadata(branch, { branched_from: chat, branch_at_message: a2 }, userId);
    await h.service.open(branch, userId);
    expect(await facts(branch)).toEqual({ open: ["d-boat"], rebase: [], states: ["d-boat: open"] });

    // A swipe of the branch's copy of the reply the draft read takes it off the branch's chain: a rebase candidate there.
    const g = await h.host.start(branch, { type: "swipe" });
    await h.host.finish(g, "Second reply, in the branch.");
    await h.host.settle();
    expect(await facts(branch)).toEqual({ open: [], rebase: ["d-boat"], states: [] });
    // The parent, unswiped, still reads it open.
    expect(await facts(chat)).toEqual({ open: ["d-boat"], rebase: [], states: ["d-boat: open"] });
    await agree(h, branch);
  });
});
