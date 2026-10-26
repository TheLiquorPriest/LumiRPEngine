// Quests as they play (DESIGN §10, §11): an end stage pays out, a stage this turn's action reaches is
// told to this turn's narrator, hints wait behind Show a hint and only opened ones are told, the GM's
// Stage enters a stage as play does and is never made twice when its reply is read again, a person's
// secret cue is told once, by Stance, the lists of actions name no step the story hasn't come to, and
// the lint names a flag nothing sets. Played through the starters, as the player and the GM would.

import { describe, expect, test } from "bun:test";
import type { QuietRequest } from "../../src/backend/host";
import { interpretCatalog } from "../../src/backend/interpret-context";
import { toChain } from "../../src/backend/ledger-io";
import { createRegistry } from "../../src/engine/registry-impl";
import { initialState } from "../../src/engine/world-state";
import { ALL_PACKS, STARTER_WORLDS } from "../../src/packs/index";
import { regardAxes } from "../../src/packs/relationships/core/index";
import { decodeQuestsView, type QuestTrack } from "../../src/packs/story/ui/panel";
import { isRecord, type JsonObject } from "../../src/shared/json";
import type { EditOp, ResultBodies } from "../../src/shared/protocol";
import type { WorldDoc } from "../../src/shared/world";
import { Rig } from "../support/rig";

const STARTERS = [
  ["modern_slice_of_life", "Port Alder"],
  ["fantasy_town", "Brindlemere"],
  ["mystery_manor", "Ashcombe Manor"],
] as const;

function starter(id: string, name: string): WorldDoc {
  return (STARTER_WORLDS[id] as (id: string, name: string) => WorldDoc)("w", name);
}

/** A starter's chat, with `tracks`, `entities`, and any `actions` and `checks` put into its world first. */
async function chatOf(rig: Rig, template: string, name: string, tracks: readonly JsonObject[] = [], entities: readonly JsonObject[] = [], more: { actions?: readonly JsonObject[]; checks?: readonly JsonObject[] } = {}): Promise<string> {
  const worldId = await rig.newWorld(name, template);
  const actions = more.actions ?? [];
  const checks = more.checks ?? [];
  if (tracks.length + entities.length + actions.length + checks.length > 0) {
    for (const value of tracks) rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "tracks", id: String(value.id), value }));
    for (const value of entities) rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "entities", id: String(value.id), value }));
    for (const value of actions) rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "actions", id: String(value.id), value }));
    for (const value of checks) rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "checks", id: String(value.id), value }));
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  }
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  return chatId;
}

/** A GM edit of these operations. */
async function gm(rig: Rig, chatId: string, ...ops: EditOp[]): Promise<void> {
  rig.body(await rig.send({ type: "lre.edit", chatId, ops }));
}

/** The quest log's rows as the quest sheet reads them. */
async function questLog(rig: Rig, chatId: string): Promise<QuestTrack[]> {
  return decodeQuestsView((await rig.rt.view(chatId, rig.host.userId)).panels["story.quests"])?.tracks ?? [];
}

/** Each section's text as GM → Sections previews it for the next turn, by slot ("" when not sent). */
async function sections(rig: Rig, chatId: string): Promise<Record<string, string>> {
  const body = rig.body(await rig.send({ type: "lre.sections", chatId })) as unknown as ResultBodies["lre.sections"];
  return Object.fromEntries(body.sections.map((s) => [s.slot, s.status === "sent" ? (s.content ?? "") : ""]));
}

/** The chat's head: its state and the world it plays. */
async function head(rig: Rig, chatId: string) {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  const state = core?.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state;
  const world = state ? core?.worldAt(state.revision) : undefined;
  if (!state || !world) throw new Error("no head");
  return { state, world };
}

/** `from`'s regard for the player character on `axis`, as the relationships pack reads it, and the reasons it has changed for, oldest first. */
async function regardOf(rig: Rig, chatId: string, from: string, axis: string): Promise<{ value: number; why: string[] }> {
  const { state, world } = await head(rig, chatId);
  const history = state.entities[from]?.relations.find((r) => r.type === "regard" && r.to === world.pov)?.fields?.history;
  const why = (Array.isArray(history) ? history : []).flatMap((h) => (isRecord(h) && typeof h.why === "string" ? [h.why] : []));
  return { value: regardAxes(rig.rt.registry.context(world, state), from, world.pov)[axis] ?? 0, why };
}

/** The last ✎ fix or GM edit chip on the head, with its Undo. */
async function lastFix(rig: Rig, chatId: string) {
  const chip = (await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.kind === "fix").at(-1);
  if (!chip) throw new Error("no fix chip");
  return chip;
}

/** Answers a puzzle from the Actions sheet, as a turn of its own. */
async function answer(rig: Rig, chatId: string, puzzle: string, text: string): Promise<void> {
  rig.body(await rig.send({ type: "lre.action", chatId, action: "answer", params: { puzzle, answer: text }, source: "palette", now: true }));
  await rig.host.finish(await rig.host.start(chatId, { type: "normal" }), "Nothing comes of it.");
}

/** Each starter quest, the stage before its end, the end, and the regard its end rewards. */
const ENDS = [
  ["fantasy_town", "Brindlemere", "q_far_bank_fever", "deliver", "done", "wren_aldous", "warmth"],
  ["fantasy_town", "Brindlemere", "q_idle_millstone", "fit", "done", "joss_tamber", "warmth"],
  ["modern_slice_of_life", "Port Alder", "q_fleet_contract", "service_run", "done", "marcus_delgado", "respect"],
  ["modern_slice_of_life", "Port Alder", "q_pontoon_weekend", "loan", "done", "dale_whitcomb", "respect"],
  ["mystery_manor", "Ashcombe Manor", "q_find_the_truth", "accuse", "solved", "lady_honoria", "warmth"],
  ["mystery_manor", "Ashcombe Manor", "q_call_for_help", "call", "done", "gideon_pell", "trust"],
] as const;

describe("a quest's end", () => {
  test.each(ENDS)("%s (%s): %s, from %s to its end %s, pays out what the end rewards", async (template, name, track, before, end, from, axis) => {
    const rig = new Rig({ shipped: true });
    const chatId = await chatOf(rig, template, name);
    const reward = starter(template, name).tracks[track]?.stages[end]?.rewards?.find((r) => r.type === "relationships.adjust" && r.args.from === from && r.args.axis === axis);
    expect(typeof reward?.args.why).toBe("string");
    await gm(rig, chatId, { op: "stage", track, to: before });
    const was = await regardOf(rig, chatId, from, axis);
    await gm(rig, chatId, { op: "stage", track, to: end });
    // The end's own reward, for the reason it gives, and the regard is up.
    const now = await regardOf(rig, chatId, from, axis);
    expect(now.why.slice(was.why.length)).toContain(String(reward?.args.why));
    expect(now.value).toBeGreaterThan(was.value);
    expect((await questLog(rig, chatId)).find((q) => q.id === track)?.status).toBe("done");
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("a stage this turn reaches", () => {
  test("Port Alder: taking the fleet job tells this turn's narrator the quest's next step, in the Quest section and the Outline", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await chatOf(rig, "modern_slice_of_life", "Port Alder");
    await gm(rig, chatId, { op: "move", entity: "pov", to: "alder_automotive" }, { op: "move", entity: "marcus_delgado", to: "alder_automotive" });
    const told: string[][] = [];
    const deliver = rig.rt.deliver.bind(rig.rt);
    rig.rt.deliver = async (input) => {
      const delivered = await deliver(input);
      told.push([...delivered.fills.values()]);
      return delivered;
    };
    rig.body(await rig.send({ type: "lre.action", chatId, action: "accept_fleet_job", params: {}, source: "palette", now: true }));
    const g = await rig.host.start(chatId, { type: "normal" });
    await rig.host.finish(g, "Marcus slides the work order across the counter.");
    const fills = told.at(-1) ?? [];
    expect(fills.find((c) => c.startsWith("[Quest]")) ?? "").toContain("The Fleet Contract: Fix the township pickup");
    expect(fills.find((c) => c.startsWith("[Outline]")) ?? "").toContain("Fix the township pickup");
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("hints", () => {
  test("a stage's hints wait behind Show a hint, open one at a time with an Undo, and only opened ones reach the narrator", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await chatOf(rig, "modern_slice_of_life", "Port Alder");
    const quest = starter("modern_slice_of_life", "Port Alder").tracks.q_pontoon_weekend;
    const [first = "", second = ""] = quest?.stages.diagnose?.hints ?? [];
    await gm(rig, chatId, { op: "stage", track: "q_pontoon_weekend", to: "diagnose" });
    const row = async () => (await questLog(rig, chatId)).find((q) => q.id === "q_pontoon_weekend");
    expect([(await row())?.hints, (await row())?.opened]).toEqual([[first, second], 0]);
    expect((await sections(rig, chatId)).quest).not.toContain(first);
    const open = () => rig.send({ type: "lre.fix", chatId, hint: "q_pontoon_weekend" });
    rig.body(await open());
    expect((await row())?.opened).toBe(1);
    const told = (await sections(rig, chatId)).quest;
    expect([told.includes(`${quest?.label}, a hint your character has: ${first}`), told.includes(second)]).toEqual([true, false]);
    // The player's own doing, named as theirs, with its Undo.
    const chip = await lastFix(rig, chatId);
    expect([chip.label, chip.detail]).toEqual([`Opened a hint: ${quest?.label}`, undefined]);
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: chip.id, choice: "undo" }));
    expect((await row())?.opened).toBe(0);
    rig.body(await open());
    rig.body(await open());
    expect((await row())?.opened).toBe(2);
    // Every one earned is open: there is no other to show.
    const refused = await open();
    expect(refused.type === "lre.error" ? refused.message : "").toContain("No hint to show");
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("undoing the first of two hints opened leaves one open: each Undo closes one", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await chatOf(rig, "modern_slice_of_life", "Port Alder");
    const quest = starter("modern_slice_of_life", "Port Alder").tracks.q_pontoon_weekend;
    const [first = "", second = ""] = quest?.stages.diagnose?.hints ?? [];
    await gm(rig, chatId, { op: "stage", track: "q_pontoon_weekend", to: "diagnose" });
    const row = async () => (await questLog(rig, chatId)).find((q) => q.id === "q_pontoon_weekend");
    for (let tap = 0; tap < 2; tap++) rig.body(await rig.send({ type: "lre.fix", chatId, hint: "q_pontoon_weekend" }));
    expect((await row())?.opened).toBe(2);
    const opened = (await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.kind === "fix" && c.label === `Opened a hint: ${quest?.label}`);
    expect(opened.length).toBe(2);
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: opened[0]?.id, choice: "undo" }));
    expect((await row())?.opened).toBe(1);
    const told = (await sections(rig, chatId)).quest;
    expect([told.includes(first), told.includes(second)]).toEqual([true, false]);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a second tap on Show a hint before the first has shown opens that same hint, so the narrator is never told one the player didn't open", async () => {
    const rig = new Rig({ shipped: true });
    const [first, second] = ["It moves the trees.", "You never see it."];
    const riddle: JsonObject = { id: "p_riddle", kind: "puzzle", label: "The chalked riddle", start: "ask", visibility: "public", stages: { ask: { label: "The riddle", cue: "A riddle is chalked on the board: what rings the bells with no hand?", answer: { expect: ["the wind"], normalize: true }, hints: [first, second], next: [{ to: "answered", when: "false" }] }, answered: { label: "Answered", next: [] } } };
    const chatId = await chatOf(rig, "modern_slice_of_life", "Port Alder", [riddle]);
    rig.host.quietReply = () => "{}";
    const row = async () => (await questLog(rig, chatId)).find((q) => q.id === "p_riddle");
    // One wrong answer earns one hint.
    await answer(rig, chatId, "p_riddle", "a ghost");
    expect([(await row())?.hints, (await row())?.opened]).toEqual([[first], 0]);
    // While the next reply is written, both taps are held: the sheet still says Show a hint.
    rig.host.sendUser(chatId, "I think it over.");
    await rig.host.settle();
    const reply = await rig.host.start(chatId, { type: "normal" });
    for (let tap = 0; tap < 2; tap++) expect(rig.body(await rig.send({ type: "lre.fix", chatId, hint: "p_riddle" })).pending).toBe(true);
    await rig.host.finish(reply, "You turn it over in your head.");
    expect((await row())?.opened).toBe(1);
    // A second wrong answer earns the second hint, which stays closed until the player opens it.
    await answer(rig, chatId, "p_riddle", "a priest");
    expect([(await row())?.hints, (await row())?.opened]).toEqual([[first, second], 1]);
    const told = (await sections(rig, chatId)).quest;
    expect([told.includes(first), told.includes(second)]).toEqual([true, false]);
    rig.body(await rig.send({ type: "lre.fix", chatId, hint: "p_riddle" }));
    expect((await sections(rig, chatId)).quest).toContain(second);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("a typed answer", () => {
  /** A typed turn interpret reads as Answer to `puzzle` with `answer`; the turn's decline chips, as "label | detail". */
  const typedAnswer = async (rig: Rig, chatId: string, puzzle: string, text: string, answer: string): Promise<string[]> => {
    rig.host.quietReply = (req) => (req.messages.map((m) => m.content).join("\n").includes("You map a player's typed input") ? JSON.stringify({ action: "answer", params: { puzzle, answer }, confidence: 0.9 }) : "{}");
    await rig.turn(chatId, text, "You give it some thought.");
    return (await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.kind === "decline").map((c) => `${c.label} | ${c.detail ?? ""}`);
  };
  const DECLINED = /^Answer: couldn't \| The message doesn't say the answer itself, so it isn't a try at the puzzle\./;
  /** Who came into the shop last night: `culprit`, by name, with a hint for a wrong answer. */
  const visitorOf = (culprit: string): JsonObject => ({ id: "p_visitor", kind: "puzzle", label: "The night visitor", start: "ask", visibility: "public", stages: { ask: { label: "Who came in?", cue: "Someone was in the shop last night, and the till is short.", answer: { expect: [culprit], normalize: true }, hints: ["The back door's lock is scratched."], next: [{ to: "named", when: "false" }] }, named: { label: "Named", next: [] } } });
  /** A Port Alder townsperson at `place` (the player character starts at harbor_street_114). */
  const person = (id: string, name: string, place: string): JsonObject => ({ id, kind: "character", name, tier: "background", fields: { place }, relations: [] });
  const visitorRow = async (rig: Rig, chatId: string) => (await questLog(rig, chatId)).find((q) => q.id === "p_visitor");

  test("counts only in the player's own words: one the read gives that the message doesn't is no try at all, and its decline names none of it", async () => {
    const rig = new Rig({ shipped: true });
    const cellar: JsonObject = { id: "p_cellar", kind: "puzzle", label: "The cellar riddle", start: "ask", visibility: "public", stages: { ask: { label: "The riddle", cue: "Chalked on the cellar door: what answers without a mouth?", answer: { expect: ["echo"], normalize: true }, next: [{ to: "open", when: "false" }] }, open: { label: "Open", next: [] } } };
    const chatId = await chatOf(rig, "modern_slice_of_life", "Port Alder", [visitorOf("Avery Holt"), cellar]);
    const row = async (id: string) => (await questLog(rig, chatId)).find((q) => q.id === id);
    const typed = (text: string, answer: string): Promise<string[]> => typedAnswer(rig, chatId, "p_visitor", text, answer);
    // The read answers with a name the player never typed: nothing is solved, it isn't even a try, and the chip says why without the name.
    const declined = await typed("I give my answer: whoever was in the shop last night.", "Avery Holt");
    expect(declined).toEqual([expect.stringMatching(DECLINED)]);
    expect(declined.join("\n")).not.toContain("Avery");
    expect([(await row("p_visitor"))?.status, (await row("p_visitor"))?.hints]).toEqual(["active", []]);
    // Typed, it is the player's own, case and spacing aside.
    expect(await typed("My answer is   avery   HOLT.", "Avery Holt")).toEqual([]);
    expect((await row("p_visitor"))?.status).toBe("done");
    // An Answer picked on the Actions sheet keeps its own answer, whatever words go with it.
    rig.host.quietReply = () => "{}";
    expect(rig.body(await rig.send({ type: "lre.action", chatId, action: "answer", params: { puzzle: "p_cellar", answer: "echo" }, source: "palette" })).staged).toBe(true);
    await rig.turn(chatId, "I say it out loud, once.", "The word comes back off the stones.");
    expect((await row("p_cellar"))?.status).toBe("done");
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a word of the name of someone the player character knows, that no one else they know has, names them", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await chatOf(rig, "modern_slice_of_life", "Port Alder", [visitorOf("Avery Holt")], [person("avery_holt", "Avery Holt", "harbor_street_114")]);
    expect(await typedAnswer(rig, chatId, "p_visitor", "It was Avery.", "avery_holt")).toEqual([]);
    expect((await visitorRow(rig, chatId))?.status).toBe("done");
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("with two people of that name the player character knows, the shared word names neither and isn't a try, and a word only one has names them", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await chatOf(rig, "modern_slice_of_life", "Port Alder", [visitorOf("Avery Holt")], [person("avery_holt", "Avery Holt", "harbor_street_114"), person("avery_lane", "Avery Lane", "harbor_street_114")]);
    expect(await typedAnswer(rig, chatId, "p_visitor", "It was Avery.", "avery_holt")).toEqual([expect.stringMatching(DECLINED)]);
    expect([(await visitorRow(rig, chatId))?.status, (await visitorRow(rig, chatId))?.hints]).toEqual(["active", []]);
    expect(await typedAnswer(rig, chatId, "p_visitor", "No, it was Holt.", "avery_holt")).toEqual([]);
    expect((await visitorRow(rig, chatId))?.status).toBe("done");
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("someone the player character can't know isn't named by a word of their name, and the decline never names them; once known, the same words name them", async () => {
    const rig = new Rig({ shipped: true });
    // Corin Vale is across town at the marina, and the player character has never met them.
    const chatId = await chatOf(rig, "modern_slice_of_life", "Port Alder", [visitorOf("Corin Vale")], [person("corin_vale", "Corin Vale", "alder_harbor_marina")]);
    const declined = await typedAnswer(rig, chatId, "p_visitor", "It was Corin.", "corin_vale");
    expect(declined).toEqual([expect.stringMatching(DECLINED)]);
    expect(declined.join("\n")).not.toMatch(/Vale|corin_vale/i);
    expect([(await visitorRow(rig, chatId))?.status, (await visitorRow(rig, chatId))?.hints]).toEqual(["active", []]);
    await gm(rig, chatId, { op: "link", rel: "knows", from: "pov", to: "corin_vale" });
    expect(await typedAnswer(rig, chatId, "p_visitor", "It was Corin.", "corin_vale")).toEqual([]);
    expect((await visitorRow(rig, chatId))?.status).toBe("done");
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  /** A Port Alder chat with a lockbox whose code is 4512, and the reply's chips once `read` is interpret's reading of `text`. */
  const lockboxTurn = async (text: string, read: JsonObject) => {
    const rig = new Rig({ shipped: true });
    const lockbox: JsonObject = { id: "p_lockbox", kind: "puzzle", label: "The lockbox", start: "shut", visibility: "public", stages: { shut: { label: "Four dials", cue: "A lockbox with four brass dials.", answer: { expect: ["4512"], normalize: true }, next: [{ to: "open", when: "false" }] }, open: { label: "Open", next: [] } } };
    const chatId = await chatOf(rig, "modern_slice_of_life", "Port Alder", [lockbox]);
    rig.host.quietReply = (req) => (req.messages.map((m) => m.content).join("\n").includes("You map a player's typed input") ? JSON.stringify(read) : "{}");
    await rig.turn(chatId, text, "You wake an hour later.");
    const chips = (await rig.rt.view(chatId, rig.host.userId)).chips;
    expect((await questLog(rig, chatId)).find((q) => q.id === "p_lockbox")?.status).toBe("active");
    expect(rig.rt.ledger.errors).toEqual([]);
    return { rest: chips.filter((c) => c.kind === "choice").map((c) => c.label), declines: chips.filter((c) => c.kind === "decline").map((c) => c.label), all: JSON.stringify(chips) };
  };
  const NAP = { action: "timelapse", params: { span: "for the next hour" }, text: "I nap for an hour", confidence: 0.9 };

  test("one the read queues after a time skip, with a code the message doesn't give, is no try either, and the chip never offers it to send", async () => {
    const turn = await lockboxTurn("I nap for an hour, then I punch in the code.", { ...NAP, more: [{ action: "answer", params: { puzzle: "p_lockbox", answer: "4512" }, text: "I key in 4512" }] });
    expect([turn.rest, turn.declines]).toEqual([[], ["Answer: couldn't"]]);
    expect(turn.all).not.toContain("4512");
  });

  test("words the read leaves for after the queue that give a code the message doesn't are never offered to send", async () => {
    const turn = await lockboxTurn("I nap for an hour, dance a little, then punch in the code.", { ...NAP, more: [{ action: "dance", params: {}, text: "I dance a little" }, { action: "answer", params: { puzzle: "p_lockbox", answer: "4512" }, text: "I key in 4512" }] });
    expect(turn.rest).toEqual(["I dance a little"]);
    expect(turn.all).not.toContain("4512");
  });

  /** A public puzzle `id` that takes any of `expect` as its answer. */
  const puzzleOf = (id: string, ...expect: string[]): JsonObject => ({ id, kind: "puzzle", label: `The puzzle ${id}`, start: "ask", visibility: "public", stages: { ask: { label: "Unsolved", cue: `A puzzle waits (${id}).`, answer: { expect, normalize: true }, next: [{ to: "solved", when: "false" }] }, solved: { label: "Solved", next: [] } } });
  const statusOf = async (rig: Rig, chatId: string, id: string) => (await questLog(rig, chatId)).find((q) => q.id === id)?.status;

  test("a one-letter answer counts only set apart, typed alone, quoted or a capital other than I and A, never as the word a sentence holds", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await chatOf(rig, "modern_slice_of_life", "Port Alder", [puzzleOf("p_door", "A"), puzzleOf("p_gate", "B")]);
    expect(await typedAnswer(rig, chatId, "p_door", "I take a moment to think.", "A")).toEqual([expect.stringMatching(DECLINED)]);
    expect(await statusOf(rig, chatId, "p_door")).toBe("active");
    expect(await typedAnswer(rig, chatId, "p_door", "My answer is “A”.", "A")).toEqual([]);
    expect(await typedAnswer(rig, chatId, "p_gate", "I try door B.", "B")).toEqual([]);
    expect([await statusOf(rig, chatId, "p_door"), await statusOf(rig, chatId, "p_gate")]).toEqual(["done", "done"]);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a possessive names someone else's, so “Holt's daughter” gives no answer Holt", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await chatOf(rig, "modern_slice_of_life", "Port Alder", [visitorOf("Holt")]);
    expect(await typedAnswer(rig, chatId, "p_visitor", "I ask Holt's daughter about the night.", "Holt")).toEqual([expect.stringMatching(DECLINED)]);
    expect([(await visitorRow(rig, chatId))?.status, (await visitorRow(rig, chatId))?.hints]).toEqual(["active", []]);
    expect(await typedAnswer(rig, chatId, "p_visitor", "It was Holt.", "Holt")).toEqual([]);
    expect((await visitorRow(rig, chatId))?.status).toBe("done");
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test.each([
    ["a script written without spaces", "答えは東京です。", "東京", "東京"],
    ["a letter people write plain (ø)", "It was Søren.", "Soren", "Soren"],
    ["a letter people write plain (ß)", "It's the Hauptstraße.", "Hauptstrasse", "Hauptstrasse"],
    ["another script's digits", "The year was ١٨٨٧.", "1887", "1887"],
    ["a number the read gave words the message doesn't have", "The year was 1887.", "1887 AD", "1887"],
    ["a number the read named a room", "It's 12.", "Room 12", "12"],
  ])("%s still gives the answer typed: “%s”", async (_, text, read, answer) => {
    const rig = new Rig({ shipped: true });
    const chatId = await chatOf(rig, "modern_slice_of_life", "Port Alder", [puzzleOf("p_riddle", answer)]);
    expect(await typedAnswer(rig, chatId, "p_riddle", text, read)).toEqual([]);
    expect(await statusOf(rig, chatId, "p_riddle")).toBe("done");
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  /** A typed turn interpret reads as `read`; the turn's decline chips' labels. */
  const readAs = async (rig: Rig, chatId: string, text: string, read: JsonObject): Promise<string[]> => {
    rig.host.quietReply = (req) => (req.messages.map((m) => m.content).join("\n").includes("You map a player's typed input") ? JSON.stringify(read) : "{}");
    await rig.turn(chatId, text, "Something happens.");
    return (await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.kind === "decline").map((c) => c.label);
  };

  test("a money answer is the player's own by its amount: “$12” is the twelve the read gives", async () => {
    const rig = new Rig({ shipped: true });
    const pay: JsonObject = { id: "pay_toll", label: "Pay the toll", params: { amount: { type: "money" } }, requires: [], outcomes: { default: [{ type: "story.answer", args: { track: "p_toll", answer: "=params.amount" } }] }, duration: "1", lexicon: ["pay the toll"] };
    // The answer an authored action passes on is the amount in cents.
    const chatId = await chatOf(rig, "modern_slice_of_life", "Port Alder", [puzzleOf("p_toll", "1200")], [], { actions: [pay] });
    expect(await readAs(rig, chatId, "I pay $12 at the gate.", { action: "pay_toll", params: { amount: 12 }, confidence: 0.9 })).toEqual([]);
    expect(await statusOf(rig, chatId, "p_toll")).toBe("done");
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("an answer in a check's outcome is the player's own too: a code the message doesn't give is no try", async () => {
    const rig = new Rig({ shipped: true });
    const steady: JsonObject = { id: "steady", dice: "1d2", bands: [{ outcome: "fail", max: 1 }, { outcome: "success", min: 2 }] };
    const work: JsonObject = { id: "work_dial", label: "Work the dial", params: { combo: { type: "text" } }, requires: [], outcomes: { default: [{ type: "check", args: { check: "steady", actor: "self", outcomes: { success: [{ type: "story.answer", args: { track: "p_dial", answer: "=params.combo" } }] } } }] }, duration: "1", lexicon: ["work the dial"] };
    const chatId = await chatOf(rig, "modern_slice_of_life", "Port Alder", [puzzleOf("p_dial", "4512")], [], { actions: [work], checks: [steady] });
    expect(await readAs(rig, chatId, "I work the dial by feel.", { action: "work_dial", params: { combo: "4512" }, confidence: 0.9 })).toEqual(["Work the dial: couldn't"]);
    expect(await statusOf(rig, chatId, "p_dial")).toBe("active");
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("the GM's Stage", () => {
  test("on to a stage, it plays the entry, its effects and its reveal, as a GM edit with its Undo; back, it only sets the stage", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await chatOf(rig, "modern_slice_of_life", "Port Alder");
    const masked = (await questLog(rig, chatId)).find((q) => q.label === "Something is going on");
    if (!masked) throw new Error("the masked secret isn't in the quest log");
    await gm(rig, chatId, { op: "stage", track: "s_shop_trouble", to: "truth" });
    const revealed = (await questLog(rig, chatId)).find((q) => q.id === masked.id);
    expect([revealed?.label, revealed?.truths.length]).toEqual(["What Marcus isn't saying", 1]);
    const chip = await lastFix(rig, chatId);
    expect(chip.label).toBe("GM edit");
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: chip.id, choice: "undo" }));
    expect((await questLog(rig, chatId)).find((q) => q.id === masked.id)?.truths).toEqual([]);
    // On to the trial: its entry tells the player character of the pickup.
    const knows = async () => (await head(rig, chatId)).state.entities.pov?.relations.some((r) => r.type === "knows" && r.to === "township_pickup") ?? false;
    expect(await knows()).toBe(false);
    await gm(rig, chatId, { op: "stage", track: "q_fleet_contract", to: "trial" });
    expect(await knows()).toBe(true);
    // Back to the start: the stage only, and what the trial's entry did stays.
    await gm(rig, chatId, { op: "stage", track: "q_fleet_contract", to: "kickoff" });
    expect([(await head(rig, chatId)).state.tracks.q_fleet_contract?.stage, await knows()]).toEqual(["kickoff", true]);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("the GM's Stage, its reply read again", () => {
  const EXTRACT_MARK = "propose concrete state changes";
  /** An errand that moves on once Danny trusts the player character a good deal more, paying (in Priya's respect) as it leaves its start and at its end. */
  const ERRAND: JsonObject = {
    id: "q_errand",
    kind: "quest",
    label: "The errand",
    start: "asked",
    visibility: "public",
    stages: {
      asked: { label: "Asked to help", next: [{ to: "done", when: "regard('danny_okafor', 'pov', 'trust') >= 30" }], rewards: [{ type: "relationships.adjust", args: { from: "priya_nair", to: "pov", axis: "respect", delta: 5, why: "Priya hears the errand is under way." } }] },
      done: { label: "Done", next: [], rewards: [{ type: "relationships.adjust", args: { from: "priya_nair", to: "pov", axis: "respect", delta: 5, why: "Priya hears the errand is done." } }] },
    },
  };
  /** How many times each of the errand's payouts is in Priya's regard for the player character. */
  const paid = async (rig: Rig, chatId: string): Promise<number[]> => {
    const { why } = await regardOf(rig, chatId, "priya_nair", "respect");
    return ["Priya hears the errand is under way.", "Priya hears the errand is done."].map((reason) => why.filter((w) => w === reason).length);
  };
  const stage = async (rig: Rig, chatId: string): Promise<string> => (await head(rig, chatId)).state.tracks.q_errand?.stage ?? "asked";
  /** The errand's quest signals the latest reply holds, in its own events and in the entries kept on it. */
  const signals = async (rig: Rig, chatId: string): Promise<number> => {
    const m = toChain(await rig.host.chats.messages(chatId, rig.host.userId)).at(-1);
    const rec = m?.ledger?.swipes[String(m.swipeId)];
    return [...(rec?.events ?? []), ...(rec?.post ?? []).flatMap((p) => p.events)].filter((e) => e.type === "engine.signal" && "data" in e && e.data.class === "quest" && String(e.data.text).startsWith("The errand")).length;
  };
  /** A reply read as Danny trusting the player character more: on its own, it takes the errand to its end. */
  const trusting = (req: QuietRequest): string => ((req.messages[0]?.content ?? "").includes(EXTRACT_MARK) ? JSON.stringify({ proposals: [{ type: "regard", from: "danny_okafor", to: "pov", axis: "trust", delta: 8, why: "Danny trusts you now." }] }) : "{}");
  /** A Port Alder chat with the errand, whose replies' regard is applied as read. */
  const errandChat = async (rig: Rig): Promise<string> => {
    const chatId = await chatOf(rig, "modern_slice_of_life", "Port Alder", [ERRAND]);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { regard: { mode: "auto" } } } }));
    rig.host.quietReply = () => "{}";
    return chatId;
  };
  /** A first reply that reads as nothing, then the GM moving the errand to its end on it. */
  const movedOnReply = async (rig: Rig, chatId: string): Promise<void> => {
    await rig.turn(chatId, "I look around.", "The shop is quiet.");
    expect([await stage(rig, chatId), await paid(rig, chatId)]).toEqual(["asked", [0, 0]]);
    await gm(rig, chatId, { op: "stage", track: "q_errand", to: "done" });
    expect([await stage(rig, chatId), await paid(rig, chatId)]).toEqual(["done", [1, 1]]);
  };

  test("a Re-run carries the GM's move while its reply leaves the quest where it was, and drops it whole once its own reply takes the quest to the same end: each reward is paid once, and the quest is told of once", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await errandChat(rig);
    await movedOnReply(rig, chatId);
    rig.rt.setSwipeChoice(chatId, "rerun");
    // A reply that reads as nothing: the move is carried onto it as it was made.
    await rig.host.finish(await rig.host.start(chatId, { type: "swipe" }), "The shop is quiet again.");
    expect([await stage(rig, chatId), await paid(rig, chatId), await signals(rig, chatId)]).toEqual(["done", [1, 1], 1]);
    // One read as taking the errand to its end itself: the move the swipe before carried is dropped with what it paid.
    rig.host.quietReply = trusting;
    await rig.host.finish(await rig.host.start(chatId, { type: "swipe" }), "Danny claps you on the shoulder. He trusts you now.");
    expect([await stage(rig, chatId), await paid(rig, chatId), await signals(rig, chatId)]).toEqual(["done", [1, 1], 1]);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("so does a Re-read of the reply, edited so that it takes the quest there", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await errandChat(rig);
    await movedOnReply(rig, chatId);
    const reply = rig.host.head(chatId);
    if (!reply) throw new Error("no reply");
    rig.host.quietReply = trusting;
    rig.host.editMessage(chatId, reply.id, "Danny claps you on the shoulder. He trusts you now.");
    await rig.host.settle();
    const reread = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "reread");
    if (!reread) throw new Error("no Re-read chip");
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: reread.id, choice: "reread" }));
    expect([await stage(rig, chatId), await paid(rig, chatId), await signals(rig, chatId)]).toEqual(["done", [1, 1], 1]);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("made while a reply streams that takes the quest there itself, it is refused with a notice", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await errandChat(rig);
    rig.host.sendUser(chatId, "I look around.");
    await rig.host.settle();
    const reply = await rig.host.start(chatId, { type: "normal" });
    expect(rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "stage", track: "q_errand", to: "done" }] })).pending).toBe(true);
    rig.host.quietReply = trusting;
    await rig.host.finish(reply, "Danny claps you on the shoulder. He trusts you now.");
    expect([await stage(rig, chatId), await paid(rig, chatId), await signals(rig, chatId)]).toEqual(["done", [1, 1], 1]);
    expect((await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.kind === "refused").map((c) => c.label)).toEqual(["Your correction didn't apply after the reply"]);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a Re-narrate carries the GM's move on from the stage its reply's read took the quest to: the new reply is read first, so the end stands, each reward paid once", async () => {
    const rig = new Rig({ shipped: true });
    // A trusting reply's read takes the errand under way; only the GM takes it on to its end.
    const errand: JsonObject = {
      id: "q_errand",
      kind: "quest",
      label: "The errand",
      start: "asked",
      visibility: "public",
      stages: {
        asked: { label: "Asked to help", next: [{ to: "working", when: "regard('danny_okafor', 'pov', 'trust') >= 30" }], rewards: [{ type: "relationships.adjust", args: { from: "priya_nair", to: "pov", axis: "respect", delta: 5, why: "Priya hears the errand is under way." } }] },
        working: { label: "Under way", next: [{ to: "done", when: "false" }] },
        done: { label: "Done", next: [], rewards: [{ type: "relationships.adjust", args: { from: "priya_nair", to: "pov", axis: "respect", delta: 5, why: "Priya hears the errand is done." } }] },
      },
    };
    const chatId = await chatOf(rig, "modern_slice_of_life", "Port Alder", [errand]);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { regard: { mode: "auto" } } } }));
    rig.host.quietReply = trusting;
    await rig.turn(chatId, "I help Danny with the truck.", "Danny claps you on the shoulder. He trusts you now.");
    expect([await stage(rig, chatId), await paid(rig, chatId)]).toEqual(["working", [1, 0]]);
    await gm(rig, chatId, { op: "stage", track: "q_errand", to: "done" });
    expect([await stage(rig, chatId), await paid(rig, chatId)]).toEqual(["done", [1, 1]]);
    // Re-narrated, the same turn's new reply is read as taking the errand under way again, and the move stands on it.
    const reply = rig.host.head(chatId);
    if (!reply) throw new Error("no reply");
    rig.rt.setSwipeChoice(chatId, "renarrate");
    await rig.host.finish(await rig.host.start(chatId, { type: "swipe" }), "Danny grins and shakes your hand. He trusts you now.");
    const swipes = (await rig.rt.ledger.core(chatId, rig.host.userId))?.journal.messages[reply.id]?.ledger.swipes;
    expect(swipes?.["1"]?.seed).toBe(swipes?.["0"]?.seed);
    expect([await stage(rig, chatId), await paid(rig, chatId)]).toEqual(["done", [1, 1]]);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("a stage the story enters, its turn replayed on another swipe of the reply before", () => {
  test("is entered once: replaying a turn whose tracks took a quest to an end the new swipe already reached drops that entry whole, with what it paid, its record coarsened or not", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    const pay = (delta: number): JsonObject[] => [{ type: "add", args: { entity: "sam", field: "cash", delta } }];
    const errand: JsonObject = { id: "q_errand", kind: "quest", label: "The errand", start: "asked", visibility: "public", stages: { asked: { label: "Asked", next: [{ to: "done", when: "sam.cash >= 500" }], rewards: pay(100) }, done: { label: "Done", next: [], rewards: pay(250) } } };
    // A dollar every turn, into the field the errand pays into: a turn's coarsened record merges what it may.
    const tip: JsonObject = { id: "r_tip", on: { tick: "turn" }, do: pay(1) };
    rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "tracks", id: "q_errand", value: errand }));
    rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "rules", id: "r_tip", value: tip }));
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    const chatId = rig.host.createChat("Morning, Sam.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    // A reply that finds a wallet reads as $900 more, which takes the errand to its end.
    rig.host.quietReply = (req) => (req.messages[0]?.content.includes("propose concrete state changes") && (req.messages[1]?.content.split("Narration:\n")[1] ?? "").includes("wallet") ? JSON.stringify({ proposals: [{ type: "condition", entity: "sam", field: "cash", delta: 900 }] }) : "{}");
    const cash = async (): Promise<number> => Number(await rig.cashOf(chatId));
    await rig.turn(chatId, "I look around.", "Quiet.");
    const first = rig.host.head(chatId);
    if (!first) throw new Error("no reply");
    expect(await cash()).toBe(101);
    // Its Re-run finds the wallet: on that swipe the errand pays out.
    rig.rt.setSwipeChoice(chatId, "rerun");
    await rig.host.finish(await rig.host.start(chatId, { type: "swipe" }), "You find a wallet.");
    expect(await cash()).toBe(1351);
    // Back on the first swipe, the next reply finds it instead, and the errand pays out there.
    rig.host.navigate(chatId, first.id, 0);
    await rig.host.settle();
    expect(await cash()).toBe(101);
    await rig.turn(chatId, "I check my pockets.", "You find a wallet.");
    expect(await cash()).toBe(1352);
    // On the Re-run's swipe again, that later turn is replayed: its wallet and its dollar count, its payout doesn't.
    rig.host.navigate(chatId, first.id, 1);
    await rig.host.settle();
    expect(await cash()).toBe(2252);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("a person's secret cue", () => {
  test("is told once, by Stance while they are here, and never as a quest log row of someone's behaviour", async () => {
    const rig = new Rig({ shipped: true });
    const CUE = "Marcus keeps glancing at the office door.";
    const chatId = await chatOf(rig, "modern_slice_of_life", "Port Alder", [
      { id: "s_drawer", kind: "secret", label: "Unpaid letters", owner: "marcus_delgado", start: "watch", visibility: "secret", stages: { watch: { label: "Watching", cue: CUE, next: [{ to: "known", when: "false" }] }, known: { label: "Known", truth: "The bank's letters are hidden in a drawer.", next: [] } } },
    ]);
    await gm(rig, chatId, { op: "move", entity: "pov", to: "alder_automotive" }, { op: "move", entity: "marcus_delgado", to: "alder_automotive" });
    expect(JSON.stringify(await questLog(rig, chatId))).not.toContain(CUE);
    const told = await sections(rig, chatId);
    expect([told.quest?.includes(CUE), told.stance?.includes(CUE)]).toEqual([false, true]);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("the lists of actions", () => {
  test("Port Alder: neither the Actions sheet nor interpret's catalog names a step the story hasn't come to; one it has stays, locked where it can't be taken", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await chatOf(rig, "modern_slice_of_life", "Port Alder");
    const AHEAD = ["read_past_due_notice", "read_bank_statement", "talk_to_marcus", "diagnose_pontoon"];
    const palette = async () => (await rig.rt.view(chatId, rig.host.userId)).palette?.entries ?? [];
    const listed = async () => (await palette()).map((e) => e.action);
    expect((await listed()).filter((id) => AHEAD.includes(id))).toEqual([]);
    expect((await palette()).find((e) => e.action === "accept_fleet_job")?.options[0]?.disabled).toBe("Not possible here and now");
    expect(await listed()).toEqual(expect.arrayContaining(["look_at_pontoon", "ask_about_marcus"]));
    const reg = createRegistry(ALL_PACKS);
    const world = starter("modern_slice_of_life", "Port Alder");
    const catalog = interpretCatalog(reg, world, initialState(world, "r", reg), [...reg.actions.values(), ...Object.values(world.actions)], () => true).entries.map((e) => e.action.id);
    expect(catalog.filter((id) => AHEAD.includes(id))).toEqual([]);
    expect(catalog).toEqual(expect.arrayContaining(["accept_fleet_job", "look_at_pontoon", "ask_about_marcus"]));
    // Once the story comes to a step, it is listed.
    await gm(rig, chatId, { op: "stage", track: "s_shop_trouble", to: "notice" });
    expect(await listed()).toContain("read_past_due_notice");
  });
});

describe("the unset-flag lint", () => {
  test("names a flag a quest or a secret's gate waits on that nothing sets, and no starter has one", () => {
    const reg = createRegistry(ALL_PACKS);
    const issues = (world: WorldDoc) => reg.lints.flatMap((l) => l.check(world, reg)).filter((i) => i.code === "story.unset_flag");
    for (const [template, name] of STARTERS) expect(issues(starter(template, name)), name).toEqual([]);
    const world = starter("modern_slice_of_life", "Port Alder");
    const trial = world.tracks.q_fleet_contract?.stages.trial;
    if (!trial) throw new Error("no trial stage");
    trial.next = [{ to: "inspection", when: "flag('township_truck_fixed') and flag('priya_called_back')" }];
    world.lore.ledger = { id: "ledger", title: "The second ledger", content: "Marcus keeps a second ledger.", keys: [], links: [], secret: true, gate: "flag('ledger_found')" };
    expect(issues(world).map((i) => [i.severity, i.path, i.message.includes('"priya_called_back"') || i.message.includes('"ledger_found"')])).toEqual([
      ["warning", "tracks.q_fleet_contract", true],
      ["warning", "lore.ledger.gate", true],
    ]);
    // An action that sets it, and the warning goes.
    const accept = world.actions.accept_fleet_job;
    if (!accept) throw new Error("no accept_fleet_job");
    world.actions.call_priya = { ...accept, id: "call_priya", label: "Call Priya back", outcomes: { default: [{ type: "story.flag", args: { name: "priya_called_back", value: true } }] } };
    expect(issues(world).map((i) => i.path)).toEqual(["lore.ledger.gate"]);
  });
});
