// A secret track's own id never reaches the player (DESIGN §7): the quest log names it by a stand-in
// for as long as it lasts, through every stage and its reveal, and the player's requests about it
// (an answer, the hints it earns) work by that stand-in. The world's own content answers a puzzle by
// the puzzle's own id, and is told of it in no words that name it. Played through the starters' pushed state.

import { describe, expect, test } from "bun:test";
import { isRecord, type JsonObject } from "../../src/shared/json";
import type { WorldDoc } from "../../src/shared/world";
import { toChain } from "../../src/backend/ledger-io";
import { readEngineSlice } from "../../src/engine/engine-pack";
import { decodeQuestsView, type QuestTrack } from "../../src/packs/story/ui/panel";
import { STARTER_WORLDS } from "../../src/packs/index";
import { Rig } from "../support/rig";

const STARTERS = [
  ["modern_slice_of_life", "Port Alder"],
  ["fantasy_town", "Brindlemere"],
  ["mystery_manor", "Ashcombe Manor"],
] as const;

/** Everything the engine has pushed to the player's view of the chat so far, from message `from` on. */
function pushed(rig: Rig, from = 0): string {
  return JSON.stringify(rig.host.sent.slice(from).filter((m) => m.type === "lre.state.snapshot" || m.type === "lre.state.delta"));
}

/** Replies to Build's and the GM view's requests, which no player surface reads. */
const NOT_PLAYER = new Set(["lre.gm", "lre.editor", "lre.world", "lre.edit"]);

/** Everything sent to the frontend from message `from` on that a player surface may read: every push, and the replies to Play's requests. */
function playerTraffic(rig: Rig, from = 0): string {
  return JSON.stringify(rig.host.sent.slice(from).filter((m) => !(m.type === "lre.result" && NOT_PLAYER.has(m.request))));
}

/** The quest log's rows as the quest sheet reads them. */
async function questLog(rig: Rig, chatId: string): Promise<QuestTrack[]> {
  return decodeQuestsView((await rig.rt.view(chatId, rig.host.userId)).panels["story.quests"])?.tracks ?? [];
}

/** The answers the chat has recorded for a track, right or wrong (its hint ladder counts the wrong ones). */
async function attemptsOf(rig: Rig, chatId: string, track: string): Promise<number> {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  if (!core) throw new Error("no ledger");
  return readEngineSlice(core.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state).attempts[track] ?? 0;
}

/** A track's stage as the GM view has it. */
async function gmStage(rig: Rig, chatId: string, id: string): Promise<unknown> {
  const gm = rig.body(await rig.send({ type: "lre.gm", chatId }));
  const track = (Array.isArray(gm.tracks) ? gm.tracks : []).find((t) => isRecord(t) && t.id === id);
  return isRecord(track) ? track.stage : undefined;
}

/** A starter's chat, its world given `patch`'s tracks and `actions` first. */
async function starterChat(rig: Rig, starter: string, name: string, patch?: (draft: WorldDoc) => JsonObject[], actions: readonly JsonObject[] = []): Promise<string> {
  const worldId = await rig.newWorld(name, starter);
  if (patch || actions.length > 0) {
    const { draft } = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId, base: null })) as { draft: WorldDoc };
    for (const value of patch?.(draft) ?? []) rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "tracks", id: String(value.id), value }));
    for (const value of actions) rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "actions", id: String(value.id), value }));
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  }
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  return chatId;
}

/** Plays `action` with `params` from the palette; the turn's decline chips, as "label | detail". */
async function act(rig: Rig, chatId: string, action: string, params: JsonObject): Promise<string[]> {
  rig.body(await rig.send({ type: "lre.action", chatId, action, params, source: "palette" }));
  const g = await rig.host.start(chatId, { type: "normal" });
  await rig.host.finish(g, "You try it.");
  return (await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.kind === "decline").map((c) => `${c.label} | ${c.detail ?? ""}`);
}

/** A public puzzle open from the start, with a hint for a wrong answer. */
const DOOR: JsonObject = { id: "p_door", kind: "puzzle", label: "The cellar door", start: "riddle", visibility: "public", stages: { riddle: { label: "The riddle", cue: "Words cut in the lintel ask what answers without a mouth.", answer: { expect: ["echo"] }, hints: ["Shout into a cave."], next: [{ to: "open", when: "false" }] }, open: { label: "Open", cue: "The cellar door swings in.", next: [] } } };

describe("a secret track on the player layer", () => {
  test.each(STARTERS)("%s: no secret track's own id is pushed, at the start or at any stage, and its row keeps one stand-in", async (starter, name) => {
    const rig = new Rig({ shipped: true });
    const chatId = await starterChat(rig, starter, name);
    const secrets = Object.values((STARTER_WORLDS[starter] as (id: string, name: string) => WorldDoc)("w", name).tracks).filter((t) => t.visibility === "secret");
    expect(secrets.length).toBeGreaterThan(0);
    for (const t of secrets) expect(pushed(rig), `${t.id} at the start`).not.toContain(t.id);
    for (const t of secrets.filter((x) => x.kind !== "agenda")) {
      const shown = new Set<string>();
      for (const stage of Object.keys(t.stages)) {
        const from = rig.host.sent.length;
        rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "stage", track: t.id, to: stage }] }));
        await rig.turn(chatId, "I look around.", "Nothing much happens.");
        for (const s of secrets) expect(pushed(rig, from), `${s.id} once ${t.id} is at ${stage}`).not.toContain(s.id);
        // The row the quest sheet finds it by: its cue, under one stand-in from first to last.
        const cue = t.stages[stage]?.cue;
        const row = (await questLog(rig, chatId)).find((q) => cue !== undefined && q.cue === cue);
        if (row) shown.add(row.id);
      }
      expect([...shown]).toEqual([expect.stringMatching(/^~/)]);
    }
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("revealed in play, a secret shows its own label but keeps its stand-in, so its open quest sheet still finds it", async () => {
    const rig = new Rig({ shipped: true });
    // Port Alder's secret, its last step taken as soon as the track stands before it.
    const chatId = await starterChat(rig, "modern_slice_of_life", "Port Alder", (draft) => {
      const t = draft.tracks.s_shop_trouble;
      if (!t?.stages.statement) throw new Error("no s_shop_trouble");
      return [{ ...t, stages: { ...t.stages, statement: { ...t.stages.statement, next: [{ to: "truth", when: "true" }] } } } as unknown as JsonObject];
    });
    const before = (await questLog(rig, chatId)).find((q) => q.label === "Something is going on");
    if (!before) throw new Error("the masked secret isn't in the quest log");
    rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "stage", track: "s_shop_trouble", to: "statement" }] }));
    await rig.turn(chatId, "I look around.", "Nothing much happens.");
    const after = (await questLog(rig, chatId)).find((q) => q.id === before.id);
    expect(after?.label).toBe("What Marcus isn't saying");
    expect(after?.truths.length).toBe(1);
    expect(pushed(rig)).not.toContain("s_shop_trouble");
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a secret puzzle is answered and hinted by its stand-in, and the quest sheet keeps finding it", async () => {
    const rig = new Rig({ shipped: true });
    // Port Alder's truck puzzle, kept secret: the quest log shows it masked.
    const chatId = await starterChat(rig, "modern_slice_of_life", "Port Alder", (draft) => [{ ...(draft.tracks.p_township_truck as unknown as JsonObject), visibility: "secret" }]);
    expect(pushed(rig)).not.toContain("p_township_truck");
    const masked = (await questLog(rig, chatId)).find((q) => q.cue?.startsWith("The township pickup turns over fine"));
    if (!masked) throw new Error("the masked puzzle isn't in the quest log");
    expect([masked.label, masked.stage, masked.hints]).toEqual(["Something is going on", "", []]);
    const sheet = async () => (await questLog(rig, chatId)).find((q) => q.id === masked.id);
    const answer = async (text: string) => {
      rig.body(await rig.send({ type: "lre.action", chatId, action: "answer", params: { puzzle: masked.id, answer: text }, source: "palette" }));
      const g = await rig.host.start(chatId, { type: "normal" });
      await rig.host.finish(g, "You try it.");
    };
    // A wrong answer earns its first hint, on the same row.
    await answer("the battery");
    expect((await sheet())?.hints).toEqual(["No priming hum from the tank: the pump isn't getting power."]);
    // The right one solves it: the row is done, under the same id.
    await answer("fuel pump relay");
    const done = await sheet();
    expect([done?.status, done?.cue]).toEqual(["done", "The pump hums, the engine catches, and the exhaust note settles into a steady idle."]);
    expect(pushed(rig)).not.toContain("p_township_truck");
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("answering a puzzle as the player sees it", () => {
  /** Sends Answer with `params` and plays the turn; the turn's decline, if any. */
  async function answer(rig: Rig, chatId: string, params: JsonObject): Promise<{ decline: string; outcome: string }> {
    rig.body(await rig.send({ type: "lre.action", chatId, action: "answer", params, source: "palette" }));
    const g = await rig.host.start(chatId, { type: "normal" });
    const outcome = rig.host.lastInterceptor?.mutated.find((m) => m.content?.startsWith("[Outcome]"))?.content ?? "";
    await rig.host.finish(g, "You try it.");
    const decline = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "decline");
    return { decline: `${decline?.label ?? ""} ${decline?.detail ?? ""}`, outcome };
  }

  test("a refusal names it in the player's words or by what they see, never by the secret's own label or id", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await starterChat(rig, "modern_slice_of_life", "Port Alder");
    const { decline, outcome } = await answer(rig, chatId, { puzzle: "s_shop_trouble", answer: "42" });
    expect(decline).toBe("Answer: declined no open puzzle by that name");
    for (const said of ["What Marcus isn't saying", "s_shop_trouble", "s shop trouble"]) expect(`${decline}\n${outcome}`).not.toContain(said);
    // The player's own words come back as they gave them.
    expect((await answer(rig, chatId, { puzzle: "the till", answer: "42" })).decline).toBe("Answer: declined no open puzzle the till");
  });

  test("a puzzle not in the quest log is never answered by its own id: the refusal reads as one for an id nothing has", async () => {
    const rig = new Rig({ shipped: true });
    // The truck puzzle known only to its owner, whom the POV doesn't know, and a puzzle still dormant: neither is listed.
    const chatId = await starterChat(rig, "modern_slice_of_life", "Port Alder", (draft): JsonObject[] => [
      { ...(draft.tracks.p_township_truck as unknown as JsonObject), owner: "dale_whitcomb" },
      { id: "p_cellar", kind: "puzzle", label: "The cellar door", start: "waiting", visibility: "public", stages: { waiting: { label: "Waiting", next: [{ to: "riddle", when: "flag('cellar_found')" }] }, riddle: { label: "The riddle", answer: { expect: ["echo"] }, next: [] } } },
    ]);
    expect((await questLog(rig, chatId)).filter((q) => q.kind === "puzzle")).toEqual([]);
    // Their ids, the truck's id as a slug, and the id of the pickup it is about, which the POV can see: none reaches either.
    for (const puzzle of ["p_township_truck", "p_cellar", "p_no_such_thing", "township_truck", "township_pickup"]) expect((await answer(rig, chatId, { puzzle, answer: "echo" })).decline).toBe("Answer: declined no open puzzle by that name");
    expect([await gmStage(rig, chatId, "p_township_truck"), await gmStage(rig, chatId, "p_cellar")]).toEqual(["stuck", "waiting"]);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("beside an open puzzle, a hidden puzzle's id is refused as one nothing has and the open one isn't tried; an id whose parts fit the open one reaches it, as naming nothing does", async () => {
    const rig = new Rig({ shipped: true });
    // The truck puzzle known only to its owner, whom the POV doesn't know, beside the cellar door, open and listed.
    const chatId = await starterChat(rig, "modern_slice_of_life", "Port Alder", (draft): JsonObject[] => [{ ...(draft.tracks.p_township_truck as unknown as JsonObject), owner: "dale_whitcomb" }, DOOR]);
    const door = async () => (await questLog(rig, chatId)).find((q) => q.id === "p_door");
    expect((await questLog(rig, chatId)).filter((q) => q.kind === "puzzle").map((q) => q.id)).toEqual(["p_door"]);
    // The hidden truck's id, an id nothing has, and a stand-in nothing goes by: read for their parts, which fit no row,
    // and never taken for the only one open.
    for (const puzzle of ["p_township_truck", "p_no_such_thing", "~0123456789ab"]) {
      expect(await act(rig, chatId, "answer", { puzzle, answer: "fuel pump relay" })).toEqual(["Answer: declined | no open puzzle by that name"]);
      expect([(await door())?.hints, await attemptsOf(rig, chatId, "p_door")]).toEqual([[], 0]);
    }
    expect([await gmStage(rig, chatId, "p_township_truck"), await attemptsOf(rig, chatId, "p_township_truck")]).toEqual(["stuck", 0]);
    // An id whose parts are the door's own words reads as those words: a wrong answer is the door's try, and earns its hint.
    expect(await act(rig, chatId, "answer", { puzzle: "p_cellar_door", answer: "fuel pump relay" })).toEqual([]);
    expect([(await door())?.hints, await attemptsOf(rig, chatId, "p_door")]).toEqual([["Shout into a cave."], 1]);
    // Named by nothing, the only open puzzle is answered.
    expect(await act(rig, chatId, "answer", { answer: "echo" })).toEqual([]);
    expect((await door())?.status).toBe("done");
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("an id of an entity or place the POV can see reads as its name, and a hidden one's id fares as an id nothing has", async () => {
    const rig = new Rig({ shipped: true });
    // The truck puzzle known only to Dale, whom the POV doesn't know yet, beside the cellar door, open and listed.
    const chatId = await starterChat(rig, "modern_slice_of_life", "Port Alder", (draft): JsonObject[] => [{ ...(draft.tracks.p_township_truck as unknown as JsonObject), owner: "dale_whitcomb" }, DOOR]);
    const tries = async () => [await attemptsOf(rig, chatId, "p_door"), await attemptsOf(rig, chatId, "p_township_truck")];
    // A secret item's id, a secret place's id and an id nothing has: each refused alike, and the door isn't tried.
    for (const puzzle of ["past_due_notice", "birch_lane_12", "no_such_notice"]) expect(await act(rig, chatId, "answer", { puzzle, answer: "a sponge" })).toEqual(["Answer: declined | no open puzzle by that name"]);
    expect(await tries()).toEqual([0, 0]);
    // A person's and a place's id the POV can see read as their names: words that fit no row, so the only one open is tried.
    for (const puzzle of ["marcus_delgado", "rusty_anchor"]) expect(await act(rig, chatId, "answer", { puzzle, answer: "a sponge" })).toEqual([]);
    expect(await tries()).toEqual([2, 0]);
    // With the truck open too, the pickup's id reaches the truck, whose cue names it; a name that fits neither is refused.
    rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "link", rel: "knows", from: "pov", to: "dale_whitcomb" }] }));
    expect(await act(rig, chatId, "answer", { puzzle: "township_pickup", answer: "the battery" })).toEqual([]);
    expect(await act(rig, chatId, "answer", { puzzle: "marcus_delgado", answer: "the battery" })).toEqual(["Answer: declined | no open puzzle by that name"]);
    expect(await tries()).toEqual([2, 1]);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("its own label finds nothing, and interpret is told it by the stand-in and the label the quest log shows", async () => {
    const rig = new Rig({ shipped: true });
    // The truck puzzle kept secret, beside a public one: two open, so neither is answered as the only one.
    const chatId = await starterChat(rig, "modern_slice_of_life", "Port Alder", (draft): JsonObject[] => [
      { ...(draft.tracks.p_township_truck as unknown as JsonObject), visibility: "secret" },
      { id: "p_lockbox", kind: "puzzle", label: "The lockbox", start: "shut", visibility: "public", stages: { shut: { label: "Three dials", cue: "A lockbox with three brass dials.", answer: { expect: ["317"] }, next: [{ to: "open", when: "false" }] }, open: { label: "Open", next: [] } } },
    ]);
    const masked = async () => (await questLog(rig, chatId)).find((q) => q.cue?.startsWith("The township pickup turns over fine"));
    expect((await masked())?.label).toBe("Something is going on");
    await rig.turn(chatId, "The answer is the relay.", "You think it over.");
    const interpret = rig.host.quietCalls.map((c) => c.messages.map((m) => m.content).join("\n")).find((p) => p.includes("answer — Answer (open:")) ?? "";
    // Each open puzzle by the id its row goes by: the masked one by its stand-in, never by its own id or label.
    expect(interpret).toContain(`${(await masked())?.id ?? "no stand-in"}: Something is going on — The township pickup turns over fine`);
    expect(interpret).toContain("p_lockbox: The lockbox — Three dials");
    for (const own of ["p_township_truck", "The truck that won't start"]) expect(interpret).not.toContain(own);
    // A word only its hidden label holds doesn't reach it: it stays unanswered.
    const { decline } = await answer(rig, chatId, { puzzle: "truck", answer: "fuel pump relay" });
    expect(decline).toContain("no open puzzle truck");
    expect([(await masked())?.status, (await masked())?.hints]).toEqual(["active", []]);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a judged answer to a masked puzzle is retried by its stand-in, and opens it", async () => {
    const rig = new Rig({ shipped: true });
    // A lockbox whose id says nothing its row shows, judged by `puzzle.answer`, beside the truck kept secret: two open.
    const lockbox: JsonObject = { id: "p_x1", kind: "puzzle", label: "The lockbox", start: "shut", visibility: "secret", stages: { shut: { label: "Three dials", cue: "A lockbox with three brass dials.", answer: { expect: ["317"], decision: { threshold: 0.7 } }, next: [{ to: "open", when: "false" }] }, open: { label: "Open", cue: "The lockbox clicks open.", next: [] } } };
    const chatId = await starterChat(rig, "modern_slice_of_life", "Port Alder", (draft): JsonObject[] => [{ ...(draft.tracks.p_township_truck as unknown as JsonObject), visibility: "secret" }, lockbox]);
    // Room before the reply for the judgement beside interpret and the NPC choices.
    rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { preset: "custom", budgets: { pre: { calls: 4 } } } } }));
    rig.host.quietReply = (req) => {
      const content = req.messages.map((m) => m.content).join("\n");
      if (content.includes("You map a player's typed input")) return JSON.stringify({ action: "answer", params: { puzzle: "the brass dials", answer: "three, one, seven" }, confidence: 0.9 });
      if (content.includes('"correct": probability')) return JSON.stringify({ correct: { p: 0.9 } });
      return "{}";
    };
    await rig.turn(chatId, "The combination is three, one, seven.", "The dials turn.");
    expect((await questLog(rig, chatId)).find((q) => q.cue === "The lockbox clicks open.")?.status).toBe("done");
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("with two open, interpret is told each by its stand-in and cue, the cue's words reach the right one, and an answer that fits both is refused with no attempt and no hint", async () => {
    const rig = new Rig({ shipped: true });
    // Port Alder's truck puzzle and a lockbox, both kept secret: the quest log shows each as "Something is going on".
    const lockbox: JsonObject = { id: "p_lockbox", kind: "puzzle", label: "The lockbox", start: "shut", visibility: "secret", stages: { shut: { label: "Three dials", cue: "A lockbox with three brass dials.", answer: { expect: ["317"] }, hints: ["The dials only go to 3, 1 and 7 here."], next: [{ to: "open", when: "false" }] }, open: { label: "Open", cue: "The lockbox clicks open.", next: [] } } };
    const chatId = await starterChat(rig, "modern_slice_of_life", "Port Alder", (draft): JsonObject[] => [{ ...(draft.tracks.p_township_truck as unknown as JsonObject), visibility: "secret" }, lockbox]);
    const log = await questLog(rig, chatId);
    const truckId = log.find((q) => q.cue?.startsWith("The township pickup turns over fine"))?.id ?? "no truck";
    const boxId = log.find((q) => q.cue === "A lockbox with three brass dials.")?.id ?? "no lockbox";
    expect(log.filter((q) => q.id === truckId || q.id === boxId).map((q) => q.label)).toEqual(["Something is going on", "Something is going on"]);
    const row = async (id: string) => (await questLog(rig, chatId)).find((q) => q.id === id);
    const hints = async () => [(await row(truckId))?.hints.length, (await row(boxId))?.hints.length];
    let prompt = "";
    /** A typed turn interpret reads as Answer with `params` (each text its own: a text keeps its reading); the turn's decline chip, or "". */
    const typed = async (text: string, params: JsonObject): Promise<string> => {
      rig.host.quietReply = (req) => {
        const content = req.messages.map((m) => m.content).join("\n");
        if (!content.includes("You map a player's typed input")) return "{}";
        prompt = content;
        return JSON.stringify({ action: "answer", params, confidence: 0.9 });
      };
      await rig.turn(chatId, text, "You try it.");
      const decline = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "decline");
      return decline ? `${decline.label} | ${decline.detail ?? ""}` : "";
    };
    // By the label both rows show: refused, and neither is tried.
    expect(await typed("The answer is 317.", { puzzle: "Something is going on", answer: "317" })).toBe("Answer: declined | more than one open puzzle fits Something is going on");
    expect(await hints()).toEqual([0, 0]);
    // Interpret was told each by its stand-in and the cue the quest log shows, never by its own id or label.
    expect(prompt).toContain(`${boxId}: Something is going on — A lockbox with three brass dials.`);
    expect(prompt).toContain(`${truckId}: Something is going on — The township pickup turns over fine`);
    for (const own of ["p_lockbox", "p_township_truck", "The lockbox", "The truck that won't start"]) expect(prompt).not.toContain(own);
    // Naming neither, with both open, is refused the same way.
    expect(await typed("The code is 317.", { answer: "317" })).toBe("Answer: declined | more than one puzzle is open, and the answer doesn't say which");
    expect(await hints()).toEqual([0, 0]);
    // The cue's words reach the one they describe: a wrong guess at the pickup earns its hint alone...
    expect(await typed("The answer is the battery.", { puzzle: "the township pickup", answer: "the battery" })).toBe("");
    expect(await hints()).toEqual([1, 0]);
    // ...and the brass dials open the lockbox.
    expect(await typed("I dial 317 on the brass dials.", { puzzle: "the brass dials", answer: "317" })).toBe("");
    expect([(await row(boxId))?.status, (await row(boxId))?.cue, (await row(truckId))?.status]).toEqual(["done", "The lockbox clicks open.", "active"]);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  /** Each starter's puzzle once the POV knows its item: the item's id and a slug the model might give for the puzzle, its row as interpret's Answer label lists it, what the player types, and the stage it opens to. */
  const STARTER_PUZZLES = [
    ["Port Alder", "modern_slice_of_life", "township_pickup", "township_truck", "p_township_truck: The truck that won't start — Cranks, doesn't catch", "The answer is the fuel pump relay.", "fuel pump relay", "fixed"],
    ["Ashcombe Manor", "mystery_manor", "study_safe", "the_study_safe", "p_study_safe: The study safe — Four digits", "The code is 1887.", "1887", "open"],
    ["Brindlemere", "fantasy_town", "tile_ford", "vestry_tiles", "p_vestry_tiles: The Vestry Tiles — Three tiles and a rhyme", "The answer is ford, ferry, bridge.", "ford ferry bridge", "solved"],
  ] as const;

  test.each(STARTER_PUZZLES.flatMap(([name, starter, item, slug, row, text, said, opens]) => [item, slug].map((puzzle) => [name, puzzle, starter, item, row, text, said, opens] as const)))(
    "%s: the only open puzzle, given as %s, takes the right answer, and interpret is told it by its row's id",
    async (name, puzzle, starter, item, row, text, said, opens) => {
      const rig = new Rig({ shipped: true });
      const chatId = await starterChat(rig, starter, name);
      rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "link", rel: "knows", from: "pov", to: item }] }));
      const track = row.slice(0, row.indexOf(":"));
      let prompt = "";
      rig.host.quietReply = (req) => {
        const content = req.messages.map((m) => m.content).join("\n");
        if (!content.includes("You map a player's typed input")) return "{}";
        prompt = content;
        return JSON.stringify({ action: "answer", params: { puzzle, answer: said }, confidence: 0.9 });
      };
      await rig.turn(chatId, text, "You try it.");
      expect(prompt).toContain(`answer — Answer (open: ${row})`);
      expect((await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.kind === "decline")).toEqual([]);
      expect(await gmStage(rig, chatId, track)).toBe(opens);
      expect(rig.rt.ledger.errors).toEqual([]);
    },
  );
});

describe("a puzzle the world's own content answers", () => {
  /** A secret strongroom; with no `cue`, its keypad stays out of the quest log until it opens. */
  const strongroom = (cue: boolean): JsonObject => ({ id: "p_strongroom", kind: "puzzle", label: "The strongroom", start: "locked", visibility: "secret", stages: { locked: { label: "Keypad", ...(cue ? { cue: "A steel door with a keypad." } : {}), answer: { expect: ["4512"] }, hints: ["The year the bank opened."], next: [{ to: "open", when: "false" }] }, open: { label: "Open", cue: "The steel door sighs open.", next: [] } } });
  /** The author's own way in: `story.answer` names the strongroom by its own id. */
  const KEY_IN: JsonObject = { id: "key_in_code", label: "Key in the code", params: { code: { type: "text" } }, requires: [], outcomes: { default: [{ type: "story.answer", args: { track: "p_strongroom", answer: "=params.code" } }] }, duration: "1", lexicon: ["key in the code"] };
  const NAMES = ["p_strongroom", "p strongroom", "strongroom", "Strongroom"];

  test("shown masked beside another open puzzle, an author's action answers it by its own id, and nothing the player reads names it", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await starterChat(rig, "modern_slice_of_life", "Port Alder", () => [strongroom(true)], [KEY_IN]);
    // The POV comes to know the township pickup, so its truck puzzle is open too.
    rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "link", rel: "knows", from: "pov", to: "township_pickup" }] }));
    const masked = (await questLog(rig, chatId)).find((q) => q.cue === "A steel door with a keypad.");
    expect(masked?.label).toBe("Something is going on");
    expect((await questLog(rig, chatId)).some((q) => q.id === "p_township_truck")).toBe(true);
    const from = rig.host.sent.length;
    // A wrong code is the strongroom's attempt, and earns its hint; the truck isn't tried.
    expect(await act(rig, chatId, "key_in_code", { code: "1111" })).toEqual([]);
    expect([await attemptsOf(rig, chatId, "p_strongroom"), await attemptsOf(rig, chatId, "p_township_truck")]).toEqual([1, 0]);
    expect((await questLog(rig, chatId)).find((q) => q.id === masked?.id)?.hints).toEqual(["The year the bank opened."]);
    // The right one opens it.
    expect(await act(rig, chatId, "key_in_code", { code: "4512" })).toEqual([]);
    expect(await gmStage(rig, chatId, "p_strongroom")).toBe("open");
    expect((await questLog(rig, chatId)).find((q) => q.id === masked?.id)?.status).toBe("done");
    // Open, it takes no code, and the refusal names nothing.
    expect(await act(rig, chatId, "key_in_code", { code: "4512" })).toEqual(["Key in the code: declined | there is nothing to answer here"]);
    for (const name of NAMES) expect(playerTraffic(rig, from)).not.toContain(name);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("not in the quest log yet, it is answered by its own id, and the one open puzzle isn't tried", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await starterChat(rig, "modern_slice_of_life", "Port Alder", () => [strongroom(false), DOOR], [KEY_IN]);
    expect((await questLog(rig, chatId)).filter((q) => q.kind === "puzzle").map((q) => q.id)).toEqual(["p_door"]);
    const from = rig.host.sent.length;
    expect(await act(rig, chatId, "key_in_code", { code: "1111" })).toEqual([]);
    expect([await attemptsOf(rig, chatId, "p_strongroom"), await attemptsOf(rig, chatId, "p_door")]).toEqual([1, 0]);
    expect(await act(rig, chatId, "key_in_code", { code: "4512" })).toEqual([]);
    expect(await gmStage(rig, chatId, "p_strongroom")).toBe("open");
    const log = await questLog(rig, chatId);
    expect(log.find((q) => q.id === "p_door")).toMatchObject({ status: "active", hints: [] });
    // Open, it shows in the quest log, still masked.
    expect(log.find((q) => q.cue === "The steel door sighs open.")).toMatchObject({ label: "Something is going on", status: "done" });
    for (const name of NAMES) expect(playerTraffic(rig, from)).not.toContain(name);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("Build warns of an action whose story.answer takes its track from a formula, and not of one that names the puzzle", async () => {
    const rig = new Rig({ shipped: true });
    const worldId = await rig.newWorld("Port Alder", "modern_slice_of_life");
    /** Puts an action in the draft; Build's warnings about the track its story.answer is given, as "severity path". */
    const put = async (value: JsonObject): Promise<string[]> => {
      const { lint } = rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "actions", id: String(value.id), value }));
      return (Array.isArray(lint) ? lint : []).flatMap((i) => (isRecord(i) && i.code === "story.answer_track" ? [`${String(i.severity)} ${String(i.path)}`] : []));
    };
    // The player's words passed as a puzzle's own id: one a hidden puzzle has would reach it.
    const TRY: JsonObject = { id: "try_combination", label: "Try a combination", params: { lock: { type: "text" }, code: { type: "text" } }, requires: [], outcomes: { default: [{ type: "story.answer", args: { track: "=params.lock", answer: "=params.code" } }] }, duration: "1", lexicon: ["try the combination on"] };
    expect(await put(KEY_IN)).toEqual([]);
    expect(await put(TRY)).toEqual(["warning actions.try_combination.outcomes.default.0.args.track"]);
    // Their words passed as the puzzle they name instead: nothing to warn of.
    expect(await put({ ...TRY, outcomes: { default: [{ type: "story.answer", args: { puzzle: "=params.lock", answer: "=params.code" } }] } })).toEqual([]);
  });
});

describe("the narrator's sections", () => {
  test("an action a secret gates, tried before its stage, is told as the player reads it, never by the secret's id", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await starterChat(rig, "modern_slice_of_life", "Port Alder");
    // Read the past-due notice needs Port Alder's secret at its notice stage; the chat starts on its cue.
    rig.body(await rig.send({ type: "lre.action", chatId, action: "read_past_due_notice", params: {}, source: "palette" }));
    const g = await rig.host.start(chatId, { type: "normal" });
    const sections = (rig.host.lastInterceptor?.mutated ?? []).map((m) => m.content ?? "").join("\n");
    await rig.host.finish(g, "The desk is bare.");
    expect(sections).toContain("Read the past-due notice: it didn't happen (Not possible here and now)");
    for (const said of ["s_shop_trouble", "stage("]) expect(sections).not.toContain(said);
  });
});
