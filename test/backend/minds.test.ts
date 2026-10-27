// Character minds around real turns on the fake host (DESIGN §24): one call per mind, blind to the
// others; the Minds section in the prompt under each secrecy; memory written after the reply; recall
// holding only the turns a character was there for; Re-narrate reusing the pre phase's minds and
// Re-run asking again; the inspector's traces; and a mind's secret kept from every player surface.

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../../src/shared/json";
import type { LedgerEvent } from "../../src/shared/ledger";
import { DEFAULT_MIND_READS, DEFAULT_MINDS_MEMORY, MINDS_PRESETS, type MindMoment, type MindsReads } from "../../src/shared/minds";
import type { UserSettings } from "../../src/shared/settings";
import { sectionTokens } from "../../src/backend/book";
import type { WorldDoc } from "../../src/shared/world";
import { toChain } from "../../src/backend/ledger-io";
import type { QuietRequest } from "../../src/backend/host";
import { localTime } from "../../src/backend/minds";
import { defaultSettings, SettingsStore } from "../../src/backend/settings-store";
import { FakeHost } from "../support/fake-host";
import { mindContext, presentTurns, recallFor } from "../../src/backend/minds-context";
import { calendarOf, clockOfStamp } from "../../src/engine/calendar";
import { modernUsWorld } from "../packs/riverton";
import { playtestStart, playtestTurn } from "../../src/engine/authoring";
import type { WorldState } from "../../src/engine/state";
import { planTurn, postTurn } from "../../src/engine/turn";
import { unrevealedSecrets } from "../../src/engine/visibility";
import { intentLines } from "../../src/packs/minds/core/intent";
import { readCharacter, readSlice } from "../../src/packs/minds/core/state";
import { STARTER_WORLDS } from "../../src/packs/index";
import { placeOfEntity } from "../../src/engine/scope";
import { Rig } from "../support/rig";
import { editRequest } from "../../src/frontend/requests";
import type { ResultBodies } from "../../src/shared/protocol";

const PEOPLE = ["danny_okafor", "priya_nair"] as const;
const MIND = /You are the private mind of (.+?) in the roleplay world/;
const MEMORY = /You keep the memory of (.+?) in the roleplay world/;

/** Fake steps: a mind per character naming them, a note per memory, and nothing for every other step. */
function fakeModels(rig: Rig, extra: { monologue?: string; depiction?: string } = {}): void {
  rig.host.quietReply = (req: QuietRequest) => {
    const system = req.messages[0]?.content ?? "";
    const mind = MIND.exec(system)?.[1];
    if (mind) return JSON.stringify({ monologue: `PRIVATE thoughts of ${mind}. ${extra.monologue ?? ""}`, depiction: extra.depiction && mind.startsWith("Danny") ? extra.depiction : `${mind} leans on the counter, watchful`, intent: `${mind} means to ask about the weekend`, reactions: [], plans: [], mood: "curious" });
    const memory = MEMORY.exec(system)?.[1];
    if (memory) return JSON.stringify({ notes: [{ text: `${memory} remembers this morning`, salience: 4 }], commitments: [], resolved: [], plans: [], told: [] });
    return JSON.stringify({ proposals: [] });
  };
}

const mindCalls = (rig: Rig): QuietRequest[] => rig.host.quietCalls.filter((c) => MIND.test(c.messages[0]?.content ?? ""));

async function stateOf(rig: Rig, chatId: string): Promise<{ state: WorldState; world: WorldDoc }> {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  if (!core) throw new Error("no ledger");
  const state = core.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state;
  const world = core.worldAt(state.revision);
  if (!world) throw new Error("no world");
  return { state, world };
}

/**
 * A Port Alder chat with Danny and Priya (or `people`) with the POV, the only Live minds: the author's
 * `always` pins them, the thresholds keep everyone else Background, and Near refreshes are off.
 */
async function alderChat(rig: Rig, minds: JsonObject = {}, people: readonly string[] = PEOPLE): Promise<string> {
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  rig.body(await rig.send({ type: "lre.editor", op: "set", worldId, base: null, part: "minds", value: { thresholds: { live: 900, near: 900, far: 900 }, always: { ids: [...people] }, ...minds } }));
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  rig.body(await rig.send({ type: "lre.settings.set", patch: { minds: { refreshLimit: 0 } } }));
  const { state } = await stateOf(rig, chatId);
  const here = placeOfEntity(state, "pov");
  if (!here) throw new Error("the POV is nowhere");
  rig.body(await rig.send({ type: "lre.edit", chatId, ops: people.map((entity) => ({ op: "move", entity, to: here })) }));
  return chatId;
}

/** The section the last reply's prompt held under `label`, or "". */
function section(rig: Rig, label: string): string {
  return rig.host.section(label);
}

async function headRecord(rig: Rig, chatId: string, swipe = 0): Promise<LedgerEvent[]> {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  const messages = await rig.host.chats.messages(chatId, rig.host.userId);
  const head = messages.findLast((m) => !m.isUser);
  const rec = head ? core?.journal.messages[head.id]?.ledger.swipes[String(swipe)] : undefined;
  return rec ? rec.events.slice(0, rec.pre) : [];
}

describe("minds around a turn", () => {
  test("two characters with the POV: two separate mind calls, a brief Minds section, notes after the reply, recall by presence", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    fakeModels(rig);
    const chatId = await alderChat(rig);
    await rig.turn(chatId, "Hello.", "Danny nods. Priya smiles at you.");
    const calls = mindCalls(rig);
    expect(calls.map((c) => MIND.exec(c.messages[0]?.content ?? "")?.[1]).sort()).toEqual(["Danny Okafor", "Priya Nair"]);
    // Blind to each other: neither call carries the other's mind.
    for (const c of calls) {
      const me = MIND.exec(c.messages[0]?.content ?? "")?.[1] ?? "";
      expect(c.messages[1]?.content ?? "").not.toContain("PRIVATE thoughts of");
      expect(c.messages[1]?.content ?? "").toContain(`You are ${me}.`);
    }
    // Brief (the default): the narrator gets the depictions, never a monologue.
    const minds = section(rig, "Minds");
    expect(minds).toContain("Danny Okafor: Danny Okafor leans on the counter, watchful.");
    expect(minds).toContain("Priya Nair: Priya Nair leans on the counter, watchful.");
    expect(minds).not.toContain("PRIVATE");
    // After the reply: who was there, and each one's memory of it.
    const first = await stateOf(rig, chatId);
    for (const id of PEOPLE) expect(readCharacter(first.state, id).notes.map((n) => n.text)).toEqual([expect.stringContaining("remembers this morning")]);
    // Priya leaves before the next turn; whoever stays with the POV is there for both.
    const elsewhere = Object.keys(first.world.places).find((p) => p !== placeOfEntity(first.state, "pov") && first.world.places[p]?.parent === undefined) ?? "";
    rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "move", entity: "priya_nair", to: elsewhere }] }));
    await rig.turn(chatId, "Just us now.", "SECOND-MARK: the room goes quiet.");
    const { state } = await stateOf(rig, chatId);
    const [one, two] = readSlice(state).presence;
    expect(one?.who).toContain("priya_nair");
    expect(two?.who).not.toContain("priya_nair");
    const stayed = two?.who.find((id) => one?.who.includes(id)) ?? "";
    expect(stayed).not.toBe("");
    expect(presentTurns(state, stayed).length).toBe(2);
    expect(presentTurns(state, "priya_nair").length).toBe(1);
    const messages = await rig.host.chats.messages(chatId, rig.host.userId);
    const memory = { ...DEFAULT_MINDS_MEMORY, recall: { ...DEFAULT_MINDS_MEMORY.recall, tokens: 4000 } };
    const recall = (who: string) => recallFor({ state, who, memory, messages, hideJson: true }, "").map((t) => t.text).join("\n");
    expect(recall(stayed)).toContain("SECOND-MARK");
    expect(recall("priya_nair")).not.toContain("SECOND-MARK");
    expect(recall("priya_nair")).toContain("Priya smiles at you");
  });

  test("a reply sent after a reply with nothing typed is recalled as the story alone: the message before it is recalled once, with its own reply", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    fakeModels(rig);
    const chatId = await alderChat(rig, {}, ["danny_okafor"]);
    await rig.turn(chatId, "TIDE-MARK: I ask Danny about the tide.", "Danny squints at the water.");
    const reply = await rig.host.start(chatId, { type: "normal" });
    expect(reply.halted).toBeUndefined();
    await rig.host.finish(reply, "GULLS-MARK: the gulls circle the pier.");
    const { state } = await stateOf(rig, chatId);
    const messages = await rig.host.chats.messages(chatId, rig.host.userId);
    const turns = recallFor({ state, who: "danny_okafor", memory: DEFAULT_MINDS_MEMORY, messages, hideJson: true }, "").map((t) => t.text);
    expect(turns.filter((t) => t.includes("GULLS-MARK"))).toHaveLength(1);
    expect(turns.filter((t) => t.includes("TIDE-MARK"))).toHaveLength(1);
  });

  test("a travel turn: who heard the message remembers it, and whoever the POV met at its destination never recalls or notes it", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const LINE = "I'll take Helen's recipe book tonight";
    const memories: Record<string, string> = {};
    const minds: string[] = [];
    rig.host.quietReply = (req) => {
      const system = req.messages[0]?.content ?? "";
      const user = req.messages[1]?.content ?? "";
      if (system.includes("You map a player's typed input")) return JSON.stringify(user.includes("recipe book") ? { action: "go", params: { to: "harbor_street_114" }, confidence: 0.9 } : { action: null, params: {}, confidence: 0.9 });
      const mind = MIND.exec(system)?.[1];
      if (mind) {
        minds.push(`${mind}\n${user}`);
        return JSON.stringify({ monologue: "Thinking it over.", depiction: `${mind} looks up`, intent: "", reactions: [], plans: [], mood: "calm" });
      }
      const memory = MEMORY.exec(system)?.[1];
      if (memory) {
        memories[memory] = user;
        return JSON.stringify({ notes: [{ text: `${memory} remembers the turn`, salience: 3 }], commitments: [], resolved: [], plans: [], told: [] });
      }
      return JSON.stringify({ proposals: [] });
    };
    const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
    rig.body(await rig.send({ type: "lre.editor", op: "set", worldId, base: null, part: "minds", value: { thresholds: { live: 900, near: 900, far: 900 }, always: { ids: ["marcus_delgado", "helen_kowalczyk"] } } }));
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    rig.body(await rig.send({ type: "lre.settings.set", patch: { minds: { refreshLimit: 0 } } }));
    rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "move", entity: "pov", to: "birch_lane_12" }, { op: "move", entity: "marcus_delgado", to: "birch_lane_12" }, { op: "move", entity: "helen_kowalczyk", to: "harbor_street_114" }] }));
    await rig.turn(chatId, `I tell Marcus ${LINE}, then head to Helen's.`, `You tell Marcus ${LINE}, then drive over to Helen's, where she waves you in.`);
    const { state } = await stateOf(rig, chatId);
    expect(placeOfEntity(state, "pov")).toBe("harbor_street_114");
    // Marcus heard it, and remembers it, knowing he was left behind; Helen didn't, and has no memory of it.
    expect(memories["Marcus Delgado"]).toContain(LINE);
    expect(memories["Marcus Delgado"]).toContain("left you partway through");
    // He saw the POV go, worded for an onlooker: never as "you".
    expect(memories["Marcus Delgado"]).toMatch(/saw: the player character is now at /);
    expect(memories["Marcus Delgado"]).not.toMatch(/saw: You\b/);
    expect(memories["Helen Kowalczyk"]).toBeUndefined();
    const presence = readSlice(state).presence;
    const said = presence.find((p) => p.msg !== null);
    expect(said?.place).toBe("birch_lane_12");
    expect(said?.who).toContain("marcus_delgado");
    expect(said?.who).not.toContain("helen_kowalczyk");
    expect(presence.find((p) => p.msg === null && p.place === "harbor_street_114")?.who).toContain("helen_kowalczyk");
    // Recall: the turn is Marcus's, never Helen's.
    const messages = await rig.host.chats.messages(chatId, rig.host.userId);
    const recall = (who: string) => recallFor({ state, who, memory: DEFAULT_MINDS_MEMORY, messages, hideJson: true }, "").map((t) => t.text).join("\n");
    expect(recall("marcus_delgado")).toContain(LINE);
    expect(presentTurns(state, "helen_kowalczyk")).toEqual([]);
    // Her next mind, with the POV at her place, isn't told how that turn went either.
    minds.length = 0;
    await rig.turn(chatId, "Hello, Helen.", "She smiles.");
    const helen = minds.find((m) => m.startsWith("Helen Kowalczyk\n")) ?? "";
    expect(helen).toContain("Now Jordan Ellis says or does: Hello, Helen.");
    expect(helen).not.toContain("recipe book");
  });

  test("what a memory says they told reaches only someone who was with them for the turn", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    fakeModels(rig);
    const minds = rig.host.quietReply;
    rig.host.quietReply = (req) => (MEMORY.exec(req.messages[0]?.content ?? "")?.[1] === "Danny Okafor" ? JSON.stringify({ notes: [], commitments: [], resolved: [], plans: [], told: [{ to: ["Priya Nair", "Dale Whitcomb", "Jordan Ellis"], what: "DANNY-TOLD the boat is sold" }] }) : (minds?.(req) ?? "{}"));
    const chatId = await alderChat(rig);
    await rig.turn(chatId, "Hello.", "They look up.");
    const { state } = await stateOf(rig, chatId);
    expect(readCharacter(state, "priya_nair").witness.filter((w) => w.how === "told").map((w) => [w.by, w.what])).toEqual([["danny_okafor", "DANNY-TOLD the boat is sold"]]);
    // Dale is at the marina, and the POV has no mind: neither hears it from Danny's memory.
    expect(placeOfEntity(state, "dale_whitcomb")).not.toBe(placeOfEntity(state, "pov"));
    expect(readCharacter(state, "dale_whitcomb").witness).toEqual([]);
    expect(readCharacter(state, "pov").witness).toEqual([]);
  });

  test("full secrecy gives the narrator each monologue and intent", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    fakeModels(rig);
    const chatId = await alderChat(rig, { secrecy: "full" });
    await rig.turn(chatId, "Hello.", "They look up.");
    const minds = section(rig, "Minds");
    expect(minds).toContain("Danny Okafor's mind: PRIVATE thoughts of Danny Okafor");
    expect(minds).toContain("Intends: Danny Okafor means to ask about the weekend.");
  });

  test("with the Minds section off for the chat, Stance tells of the people it would have left to Minds, in the turn and in its preview", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    fakeModels(rig);
    const chatId = await alderChat(rig, { secrecy: "full" });
    // On, Danny's mind goes to Minds, and Stance leaves him to it.
    await rig.turn(chatId, "Hello.", "They look up.");
    expect(section(rig, "Minds")).toContain("Danny Okafor");
    expect(section(rig, "Stance")).not.toContain("Danny Okafor");
    // Off: his mind is still read, but nothing tells of it, so Stance does, as the GM's preview shows.
    rig.body(await rig.send(editRequest(chatId, [{ op: "feed", section: "minds", to: { enabled: false } }]) as unknown as Record<string, unknown>));
    const preview = rig.body(await rig.send({ type: "lre.sections", chatId })) as unknown as ResultBodies["lre.sections"];
    expect(preview.sections.find((s) => s.slot === "minds")?.status).toBe("off");
    expect(preview.sections.find((s) => s.slot === "stance")?.content ?? "").toContain("Danny Okafor");
    await rig.turn(chatId, "Hello again.", "They nod.");
    expect(section(rig, "Minds")).toBe("");
    expect(section(rig, "Stance")).toContain("Danny Okafor");
  });

  test("over its own budget the Minds section keeps the best on the ladder, and Stance tells of whoever it leaves out", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    fakeModels(rig, { monologue: "word ".repeat(100).trim() });
    // Only being named scores, so the two named lead the ladder and Maddie comes last.
    const weights = { here: 0, nearby: 0, mentioned: 100, regard: 0, knows: 0, owner: 0, track: 0, roles: {}, rule: 0, pending: 0, band: { principal: 0, supporting: 0, background: 0 }, recent: 0 };
    const chatId = await alderChat(rig, { secrecy: "full", weights }, [...PEOPLE, "maddie_kowalczyk"]);
    // A Minds budget the three minds overrun (Standard's before it rose); the shared section budget roomy enough that Stance goes in.
    rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { tokens: { sections: 4000 } }, minds: { tokens: 600 } } }));
    expect((await rig.rt.settings.get(rig.host.userId)).minds.tokens).toBe(600);
    await rig.turn(chatId, "Morning, Danny. Morning, Priya.", "They look up.");
    expect(mindCalls(rig).length).toBe(3);
    const minds = section(rig, "Minds");
    expect(minds).toContain("Danny Okafor's mind:");
    expect(minds).toContain("Priya Nair's mind:");
    expect(minds).not.toContain("Maddie Kowalczyk");
    // Stance tells of the one left out, and of no one the Minds section tells of.
    const stance = section(rig, "Stance");
    expect(stance).toContain("Maddie Kowalczyk");
    expect(stance).not.toContain("Danny Okafor");
    expect(stance).not.toContain("Priya Nair");
    const record = rig.rt.inspectorRecords(chatId)?.at(-1)?.sections.find((s) => s.slot === "minds");
    expect(record).toMatchObject({ clipped: false, cut: 1 });
    expect(record?.tokens).toBeLessThanOrEqual(600);
  });

  test("under full secrecy a mind reaches no helper step and no choice", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    // Every step on, every turn: brief, outline, choices, extract and the rest.
    const steps = Object.fromEntries(["interpret", "npc.choose", "puzzle.answer", "brief", "outline", "extract", "choices"].map((p) => [p, { enabled: true, signals: ["always"] }]));
    rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { preset: "full" } } }));
    rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { preset: "custom", steps } } }));
    fakeModels(rig);
    const minds = rig.host.quietReply;
    // A choices helper that suggests whatever intent it is shown would carry the mind onto a chip.
    rig.host.quietReply = (req) => {
      const system = req.messages[0]?.content ?? "";
      const user = req.messages[1]?.content ?? "";
      if (system.includes("Suggest three short")) return JSON.stringify({ choices: [/Intends: ([^.\n]+)/.exec(user)?.[1] ?? "I wave back"] });
      return minds?.(req) ?? "{}";
    };
    const chatId = await alderChat(rig, { secrecy: "full" });
    await rig.turn(chatId, "Hello.", "They look up.");
    // The narrator has the minds whole; nothing else does.
    expect(section(rig, "Minds")).toContain("PRIVATE thoughts of Danny Okafor");
    const leaks = /PRIVATE|means to ask about the weekend/;
    const helpers = rig.host.quietCalls.filter((c) => !MIND.test(c.messages[0]?.content ?? "") && !MEMORY.test(c.messages[0]?.content ?? ""));
    const asked = helpers.map((c) => /You brief|You outline|Suggest three short|propose concrete state changes/.exec(`${c.messages[0]?.content ?? ""} ${c.messages[1]?.content ?? ""}`)?.[0]);
    for (const step of ["You brief", "You outline", "Suggest three short", "propose concrete state changes"]) expect(asked).toContain(step);
    for (const c of helpers) expect(JSON.stringify(c.messages)).not.toMatch(leaks);
    const chips = (await rig.rt.view(chatId, rig.host.userId)).chips;
    expect(chips.some((c) => c.kind === "choice")).toBe(true);
    expect(JSON.stringify(chips)).not.toMatch(leaks);
  });

  test("Re-narrate reuses the pre phase's minds; Re-run asks again", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    fakeModels(rig);
    const chatId = await alderChat(rig);
    await rig.turn(chatId, "Hello.", "They look up.");
    const asked = mindCalls(rig).length;
    const source = (await headRecord(rig, chatId, 0)).filter((e) => e.type.startsWith("minds."));
    expect(source.filter((e) => e.type === "minds.mind").length).toBe(2);
    rig.rt.setSwipeChoice(chatId, "renarrate");
    await rig.host.finish(await rig.host.start(chatId, { type: "swipe" }), "They glance up again.");
    expect(mindCalls(rig).length).toBe(asked);
    expect((await headRecord(rig, chatId, 1)).filter((e) => e.type.startsWith("minds."))).toEqual(source);
    rig.rt.setSwipeChoice(chatId, "rerun");
    await rig.host.finish(await rig.host.start(chatId, { type: "swipe" }), "A third telling.");
    expect(mindCalls(rig).length).toBe(asked + 2);
  });

  test("the player's own prompt wins over the world's template, which wins over the built-in", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const systems: string[] = [];
    rig.host.quietReply = (req) => {
      const system = req.messages[0]?.content ?? "";
      if (!system.includes('{"monologue": "...", "depiction"')) return JSON.stringify({ proposals: [] });
      systems.push(system);
      return JSON.stringify({ monologue: "Thinking.", depiction: "Looks up", intent: "", reactions: [], plans: [], mood: "calm" });
    };
    const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
    // A blank template sorts first and is skipped.
    for (const [id, template] of [["a_blank", "  "], ["mind_world", "WORLD-PROMPT for {{character}}."]] as const) rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "steps", id, value: { id, purpose: "mind", template, output: "text", signals: [] } }));
    rig.body(await rig.send({ type: "lre.editor", op: "set", worldId, base: null, part: "minds", value: { thresholds: { live: 900, near: 900, far: 900 }, always: { ids: ["danny_okafor"] } } }));
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    const here = placeOfEntity((await stateOf(rig, chatId)).state, "pov") ?? "";
    const stay = async () => rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "move", entity: "danny_okafor", to: here }, { op: "move", entity: "pov", to: here }] }));
    const prompts = () => (rig.rt.inspectorRecords(chatId)?.at(-1)?.minds ?? []).filter((t) => t.purpose === "mind").map((t) => t.prompt);
    await stay();
    await rig.turn(chatId, "Hello.", "He looks up.");
    expect(systems.at(-1)?.startsWith("WORLD-PROMPT for Danny Okafor.")).toBe(true);
    expect(prompts()).toEqual(["world"]);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { minds: { prompts: { mind: "USER-PROMPT for {{character}}." } } } }));
    await stay();
    await rig.turn(chatId, "Again.", "He nods.");
    expect(systems.at(-1)?.startsWith("USER-PROMPT for Danny Okafor.")).toBe(true);
    expect(systems.at(-1)).not.toContain("WORLD-PROMPT");
    expect(systems.at(-1)).toContain('{"monologue": "...", "depiction"');
    expect(prompts()).toEqual(["override"]);
  });

  test("the inspector lists only the minds calls of people the POV can see and has met, by name and with no text", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    fakeModels(rig);
    const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
    const here = STARTER_WORLDS.modern_slice_of_life?.("a", "Alder").entities.pov?.fields.place;
    // One hidden in the POV's room, one public but never met, away at the marina: both Live, by `always`. The GM's intent for the one away keeps her thinking off scene.
    for (const [id, name, place, extra] of [["lurker", "The Lurker", here, { visibility: "secret" }], ["drifter", "Vera Drift", "alder_harbor_marina", {}]] as const) rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "entities", id, value: { id, kind: "person", name, tier: "background", fields: { place }, relations: [], ...extra } }));
    rig.body(await rig.send({ type: "lre.editor", op: "set", worldId, base: null, part: "minds", value: { thresholds: { live: 900, near: 900, far: 900 }, always: { ids: ["danny_okafor", "lurker", "drifter"] } } }));
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    rig.body(await rig.send({ type: "lre.settings.set", patch: { minds: { refreshLimit: 0 } } }));
    rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "move", entity: "danny_okafor", to: here ?? "" }, { op: "mind_intent", entity: "drifter", text: "Find out who keeps asking about the marina." }] }));
    await rig.turn(chatId, "Hello.", "They look up.");
    // Each of them thought, and the two in the room remembered.
    expect(mindCalls(rig).map((c) => MIND.exec(c.messages[0]?.content ?? "")?.[1]).sort()).toEqual(["Danny Okafor", "The Lurker", "Vera Drift"]);
    expect(rig.host.quietCalls.map((c) => MEMORY.exec(c.messages[0]?.content ?? "")?.[1]).filter(Boolean).sort()).toEqual(["Danny Okafor", "The Lurker"]);
    const traces = rig.rt.inspectorRecords(chatId)?.at(-1)?.minds ?? [];
    expect(traces.map((t) => [t.who, t.purpose, t.phase, t.outcome, t.prompt])).toEqual([
      ["Danny Okafor", "mind", "pre", "recorded", "default"],
      ["Danny Okafor", "memory", "post", "recorded", "default"],
    ]);
    for (const word of ["Someone", "Lurker", "Drift", "PRIVATE"]) expect(JSON.stringify(traces)).not.toContain(word);
  });

  test("a mind's secret never reaches the narrator under brief, nor the Journal, Cast or chips", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const probe = new Rig({ shipped: true, minds: true });
    fakeModels(probe);
    const probeChat = await alderChat(probe);
    const { state, world } = await stateOf(probe, probeChat);
    const secret = unrevealedSecrets(probe.rt.registry, world, state)[0] ?? "";
    expect(secret).not.toBe("");
    fakeModels(rig, { monologue: secret, depiction: `lets slip that ${secret}` });
    const chatId = await alderChat(rig);
    await rig.turn(chatId, "Hello.", "They look up.");
    expect(section(rig, "Minds")).not.toContain(secret);
    expect(section(rig, "Minds")).toContain("Priya Nair:");
    const danny = (await headRecord(rig, chatId)).find((e) => e.type === "minds.mind" && "data" in e && e.data.entity === "danny_okafor");
    expect(danny && "data" in danny ? danny.data.withheld : null).toBe(true);
    expect(rig.rt.inspectorRecords(chatId)?.at(-1)?.minds?.filter((t) => t.purpose === "mind").map((t) => t.outcome)).toEqual(["recorded", "recorded"]);
    // Every player surface: the state view (Journal, Cast, chips and the rest) never carries it.
    expect(JSON.stringify(rig.latestView(chatId))).not.toContain(secret);
    expect(JSON.stringify(rig.host.sent.filter((m) => m.type !== "lre.result"))).not.toContain(secret);
  });

  test("minds switched off: no mind calls, and the chat's round says so once", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    fakeModels(rig);
    const chatId = await alderChat(rig);
    await rig.turn(chatId, "Hello.", "They look up.");
    rig.body(await rig.send({ type: "lre.settings.set", patch: { minds: { enabled: false } } }));
    const asked = mindCalls(rig).length;
    await rig.turn(chatId, "Again.", "Nothing much.");
    await rig.turn(chatId, "Once more.", "Still nothing.");
    expect(mindCalls(rig).length).toBe(asked);
    const rounds = (await headRecord(rig, chatId)).filter((e) => e.type === "minds.round");
    expect(rounds).toEqual([]);
    const { state } = await stateOf(rig, chatId);
    expect(rig.rt.registry.context((await stateOf(rig, chatId)).world, state).query("minds.on")(rig.rt.registry.context((await stateOf(rig, chatId)).world, state))).toBe(false);
  });
});

describe("plan times a mind writes", () => {
  test("read strictly: a day the calendar lacks, or a time past 23:59, is no time at all", () => {
    const world = modernUsWorld("t", "R");
    const cal = calendarOf(world);
    const now = clockOfStamp(cal, "2026-10-19 09:00") ?? 0;
    expect(localTime(world, now, "2026-10-19 18:30")).toBe(clockOfStamp(cal, "2026-10-19 18:30"));
    expect(localTime(world, now, "2026-10-20")).toBe(clockOfStamp(cal, "2026-10-20 00:00"));
    expect(localTime(world, now, "18:30")).toBe(clockOfStamp(cal, "2026-10-19 18:30"));
    expect(localTime(world, now, "08:30")).toBe(clockOfStamp(cal, "2026-10-20 08:30"));
    for (const bad of ["2026-13-01 10:00", "2026-02-30 10:00", "2026-10-19 25:30", "2026-02-30", "25:30", "24:00", "18:75", "tomorrow"]) expect(localTime(world, now, bad)).toBeNull();
  });
});

describe("the model-use presets' minds", () => {
  test("a preset is a whole minds policy: Lean runs none, Full has no limits, and what a mind reads, the player's own prompts and memory stay", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    fakeModels(rig);
    const chatId = await alderChat(rig);
    const mine = { prompts: { consolidate: "Fold as {{character}}." }, memory: { notes: { show: 3 } }, reads: { reply: { tokens: 300 }, summary: { on: true } } };
    rig.body(await rig.send({ type: "lre.settings.set", patch: { minds: mine } }));
    const reads: MindsReads = { ...DEFAULT_MIND_READS, reply: { on: true, tokens: 300 }, summary: { on: true, tokens: "none" } };
    const minds = async () => (await rig.rt.settings.get(rig.host.userId)).minds;

    rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { preset: "lean" } } }));
    let s = await minds();
    expect([s.enabled, s.memoryLevels, s.prompts, s.memory, s.reads]).toEqual([false, [], mine.prompts, mine.memory, reads]);
    const before = rig.host.quietCalls.length;
    await rig.turn(chatId, "Hello.", "They look up.");
    expect(mindCalls(rig).length).toBe(0);
    expect(rig.host.quietCalls.slice(before).some((c) => MEMORY.test(c.messages[0]?.content ?? ""))).toBe(false);

    rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { preset: "full" } } }));
    s = await minds();
    expect([s.enabled, s.liveLimit, s.refreshLimit, s.memoryLevels, s.skip, s.prompts, s.memory, s.reads]).toEqual([true, "none", "none", ["live", "near"], { maxBeats: "none", maxMindsPerBeat: "none" }, mine.prompts, mine.memory, reads]);
    await rig.turn(chatId, "Hello again.", "They nod.");
    expect(mindCalls(rig).map((c) => MIND.exec(c.messages[0]?.content ?? "")?.[1]).sort()).toEqual(["Danny Okafor", "Priya Nair"]);

    // Standard again: its limits and memory for Live alone, and still the player's own.
    rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { preset: "standard" } } }));
    s = await minds();
    expect([s.enabled, s.liveLimit, s.refreshLimit, s.memoryLevels, s.tokens, s.prompts, s.memory, s.reads]).toEqual([true, 3, 2, ["live"], MINDS_PRESETS.standard.tokens, mine.prompts, mine.memory, reads]);
  });

  test("settings saved before what a mind reads keep their reply allowance and, under Custom, their mind card's lore as limits, and take the new switches", async () => {
    const host = new FakeHost();
    const read = async (minds: Record<string, unknown>, lore?: JsonObject, preset = "custom"): Promise<UserSettings> => {
      const fresh = defaultSettings();
      const steps = { ...fresh.modelUse.steps, mind: { ...fresh.modelUse.steps.mind, enabled: true, signals: ["always"], ...(lore ? { lore } : {}) } };
      await host.storage.write("settings.json", JSON.stringify({ ...fresh, modelUse: { ...fresh.modelUse, preset, steps }, minds }), host.userId);
      return new SettingsStore(host).get(host.userId);
    };
    const before: Record<string, unknown> = { ...defaultSettings().minds };
    delete before.reads;
    // The allowance it had is the latest reply's limit; none, or a malformed one, is the whole reply.
    expect((await read(before)).minds.reads).toEqual(DEFAULT_MIND_READS);
    expect((await read({ ...before, replyTokens: 2500 })).minds.reads.reply).toEqual({ on: true, tokens: 2500 });
    for (const bad of [0, -5, 1.5, "lots"]) expect((await read({ ...before, replyTokens: bad })).minds.reads.reply).toEqual({ on: true, tokens: "none" });
    // The Character minds card's lore tokens are each lore source's limit, however high; its lore off turns both off.
    const high = await read(before, { policy: "prefetch", tokens: 90_000 });
    expect([high.minds.reads.pinned, high.minds.reads.activated]).toEqual([
      { on: true, tokens: 90_000 },
      { on: true, tokens: 90_000 },
    ]);
    // The card keeps no lore of its own once read: what a mind reads is Settings → Minds'.
    expect(high.modelUse.steps.mind?.lore).toBeUndefined();
    const off = await read(before, { policy: "none", tokens: 0 });
    expect([off.minds.reads.pinned.on, off.minds.reads.activated.on]).toEqual([false, false]);
    // Every other source takes the new defaults: none of their own memory or life.
    for (const source of ["summary", "memory", "thoughts", "recall", "life"] as const) expect(high.minds.reads[source].on).toBe(false);
    // Under a preset the card's lore was the preset's, whose cap cut pinned lore: the sources take their defaults.
    expect((await read(before, { policy: "prefetch", tokens: 1600 }, "standard")).minds.reads).toEqual(DEFAULT_MIND_READS);
  });
});

describe("a mind's context", () => {
  test("a moment the player says nothing in tells them why they think now, with the POV or away", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const chatId = await alderChat(rig);
    const { state, world } = await stateOf(rig, chatId);
    const ended = "The time skip ends; it is now Mon 14 Sep 2026, 18:00 (evening).";
    const now = (who: string, moment: MindMoment): string => {
      const text = mindContext({ reg: rig.rt.registry, world, state, who, memory: DEFAULT_MINDS_MEMORY, messages: [], hideJson: true, reads: DEFAULT_MIND_READS, moment });
      return text.slice(text.indexOf("## Now"));
    };
    const turn = (reason: string, user = ""): MindMoment => ({ kind: "turn", at: state.clock, reason, user, reply: "" });
    // Danny is with the POV; Dale is away at the marina.
    expect(placeOfEntity(state, "dale_whitcomb")).not.toBe(placeOfEntity(state, "pov"));
    for (const who of ["danny_okafor", "dale_whitcomb"]) expect(now(who, turn(ended))).toContain(ended);
    // The player's words are the moment, and a plain turn tells no reason.
    expect(now("danny_okafor", turn(ended, "Hello."))).not.toContain(ended);
    expect(now("danny_okafor", turn(""))).toMatch(/is here with you\.$/);
    // A beat's reason reads as one sentence.
    expect(now("danny_okafor", { kind: "beat", at: state.clock, reason: "Marcus's appointment", user: "", reply: "" })).toMatch(/\. Marcus's appointment\.$/);
    expect(now("danny_okafor", { kind: "beat", at: state.clock, reason: ended, user: "", reply: "" })).not.toContain("..");
  });

  test("inside a time skip the player's message fills, someone with the player character is told it in the player's words; someone away isn't", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const chatId = await alderChat(rig);
    const { state, world } = await stateOf(rig, chatId);
    const fill = "I sort the stock and price the new crates";
    const now = (who: string, moment: MindMoment, reads = DEFAULT_MIND_READS): string => {
      const text = mindContext({ reg: rig.rt.registry, world, state, who, memory: DEFAULT_MINDS_MEMORY, messages: [], hideJson: true, reads, moment });
      return text.slice(text.indexOf("## Now"));
    };
    const beat: MindMoment = { kind: "beat", at: state.clock, reason: "Marcus's appointment", user: "", reply: "", skip: fill };
    const end: MindMoment = { kind: "turn", at: state.clock, reason: "The time skip ends.", user: "", reply: "", skip: fill };
    expect(placeOfEntity(state, "dale_whitcomb")).not.toBe(placeOfEntity(state, "pov"));
    // With The player's message off (Settings → Minds), no mind is given the words.
    const unread = { ...DEFAULT_MIND_READS, message: { ...DEFAULT_MIND_READS.message, on: false } };
    for (const moment of [beat, end]) {
      expect(now("danny_okafor", moment)).toContain(fill);
      expect(now("dale_whitcomb", moment)).not.toContain(fill);
      expect(now("danny_okafor", moment, unread)).not.toContain(fill);
    }
  });

  test("a character's own secrets are in their context: the tracks they own, and the secret a cue of theirs stands for", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    fakeModels(rig);
    const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
    const put = async (collection: string, id: string, value: JsonObject) => rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection, id, value }));
    await put("tracks", "s_till", { id: "s_till", kind: "secret", label: "The till", owner: "danny_okafor", start: "hidden", visibility: "secret", stages: { hidden: { label: "Hidden", next: [], truth: "TILL-TRUTH: Danny skims the till every Friday." } } });
    await put("tracks", "s_boat", { id: "s_boat", kind: "secret", label: "The boat", start: "hidden", visibility: "secret", stages: { hidden: { label: "Hidden", next: [], truth: "BOAT-TRUTH: Priya sold the club's boat." } } });
    const { draft } = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId })) as { draft: { entities: Record<string, JsonObject> } };
    await put("entities", "priya_nair", { ...draft.entities.priya_nair, cues: [{ text: "Changes the subject when boats come up", track: "s_boat" }] });
    rig.body(await rig.send({ type: "lre.editor", op: "set", worldId, base: null, part: "minds", value: { thresholds: { live: 900, near: 900, far: 900 }, always: { ids: [...PEOPLE] } } }));
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    const here = placeOfEntity((await stateOf(rig, chatId)).state, "pov") ?? "";
    rig.body(await rig.send({ type: "lre.edit", chatId, ops: PEOPLE.map((entity) => ({ op: "move", entity, to: here })) }));
    await rig.turn(chatId, "Hello.", "They look up.");
    const contextOf = (name: string) => mindCalls(rig).find((c) => MIND.exec(c.messages[0]?.content ?? "")?.[1] === name)?.messages[1]?.content ?? "";
    expect(contextOf("Danny Okafor")).toContain("- Your secret, The till: TILL-TRUTH: Danny skims the till every Friday.");
    expect(contextOf("Danny Okafor")).not.toContain("BOAT-TRUTH");
    expect(contextOf("Priya Nair")).toContain("- Your secret, The boat: BOAT-TRUTH: Priya sold the club's boat.");
    expect(contextOf("Priya Nair")).not.toContain("TILL-TRUTH");
  });

  test("the Mystery Manor's culprit thinks as the culprit", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    fakeModels(rig);
    const worldId = await rig.newWorld("Manor", "mystery_manor");
    rig.body(await rig.send({ type: "lre.editor", op: "set", worldId, base: null, part: "minds", value: { thresholds: { live: 900, near: 900, far: 900 }, always: { ids: ["julian_ashcombe"] } } }));
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    const here = placeOfEntity((await stateOf(rig, chatId)).state, "pov") ?? "";
    rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "move", entity: "julian_ashcombe", to: here }] }));
    await rig.turn(chatId, "Good morning.", "He nods.");
    const julian = mindCalls(rig).find((c) => MIND.exec(c.messages[0]?.content ?? "")?.[1] === "Julian Ashcombe")?.messages[1]?.content ?? "";
    expect(julian).toContain("- Your secret, Julian's agenda: Julian has taken");
    expect(julian).toContain("a lethal dose of digitalis tincture");
  });

  test("away from the POV, a mind's lore and recall aren't chosen by what the POV says", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    fakeModels(rig);
    const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
    rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "lore", id: "lighthouse_tale", value: { id: "lighthouse_tale", title: "The lighthouse tale", content: "LORE-MARK: the lighthouse keeper still walks the pier on foggy nights.", keys: ["lighthouse"], links: [] } }));
    rig.body(await rig.send({ type: "lre.editor", op: "set", worldId, base: null, part: "minds", value: { thresholds: { live: 900, near: 900, far: 900 }, always: { ids: [...PEOPLE] } } }));
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    rig.body(await rig.send({ type: "lre.settings.set", patch: { minds: { refreshLimit: 0, reads: { recall: { on: true } }, memory: { recall: { recent: 0, relevant: 1, tokens: 4000 } } } } }));
    const here = placeOfEntity((await stateOf(rig, chatId)).state, "pov") ?? "";
    rig.body(await rig.send({ type: "lre.edit", chatId, ops: PEOPLE.map((entity) => ({ op: "move", entity, to: here })) }));
    await rig.turn(chatId, "Tell me about the lighthouse.", "ZEPHYRMARK: they talk about the lighthouse keeper.");
    // Danny goes off; the GM asks for his mind, and the POV talks of the lighthouse without him.
    const marina = "alder_harbor_marina";
    rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "move", entity: "danny_okafor", to: marina }, { op: "mind_refresh", entity: "danny_okafor" }] }));
    const before = mindCalls(rig).length;
    await rig.turn(chatId, "What about the lighthouse?", "Priya shrugs.");
    const danny = mindCalls(rig).slice(before).find((c) => MIND.exec(c.messages[0]?.content ?? "")?.[1] === "Danny Okafor")?.messages[1]?.content ?? "";
    expect(danny).toContain("You aren't with");
    expect(danny).not.toContain("LORE-MARK");
    expect(danny).not.toContain("ZEPHYRMARK");
    // With the POV, the same words find both.
    const priya = mindCalls(rig).slice(before).find((c) => MIND.exec(c.messages[0]?.content ?? "")?.[1] === "Priya Nair")?.messages[1]?.content ?? "";
    expect(priya).toContain("LORE-MARK");
    expect(priya).toContain("ZEPHYRMARK");
  });

  test("their money reads in their own sentences, under no second label, when they read their life", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    fakeModels(rig);
    const chatId = await alderChat(rig);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { minds: { reads: { life: { on: true } } } } }));
    await rig.turn(chatId, "Hello.", "They look up.");
    const danny = mindCalls(rig).find((c) => MIND.exec(c.messages[0]?.content ?? "")?.[1] === "Danny Okafor")?.messages[1]?.content ?? "";
    expect(danny).toMatch(/\n- You have \$[\d,.]+ in cash and \$[\d,.]+ in the bank\.\n/);
    expect(danny).not.toContain("- Money: ");
  });

  test("who they are includes their list fields, such as traits, as words", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    fakeModels(rig);
    const chatId = await alderChat(rig);
    await rig.turn(chatId, "Hello.", "They look up.");
    const danny = mindCalls(rig).find((c) => MIND.exec(c.messages[0]?.content ?? "")?.[1] === "Danny Okafor")?.messages[1]?.content ?? "";
    expect(danny).toMatch(/\n- Traits: funny, competitive, loyal\n/i);
  });

  test("the intent the GM sets for them comes first after who they are, in their own mind only: no other mind, step, narrator's section or player surface gets it", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    fakeModels(rig);
    const chatId = await alderChat(rig);
    const AIM = "AIM-MARK: talk Priya into selling him the boat before the auction";
    rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "mind_intent", entity: "danny_okafor", text: AIM, approach: "proactive" }] }));
    await rig.turn(chatId, "Hello.", "They look up.");
    const isMind = (c: QuietRequest, name: string) => MIND.exec(c.messages[0]?.content ?? "")?.[1] === name;
    const danny = mindCalls(rig).find((c) => isMind(c, "Danny Okafor"))?.messages[1]?.content ?? "";
    // Their aim in the GM's words, and how they go about it, in a block right after who they are.
    const who = danny.indexOf("## Who you are\n");
    const aim = danny.indexOf("## What you mean to do\n");
    expect(who).toBeGreaterThan(-1);
    expect(aim).toBeGreaterThan(who);
    expect(danny.slice(who + 1, aim)).not.toContain("## ");
    // The block is their intent as rendered for them, whole.
    expect(danny.slice(aim).split("\n")[1]).toBe(AIM);
    expect(danny).toContain(["## What you mean to do", ...intentLines({ text: AIM, approach: "proactive" })].join("\n"));
    // Ahead of everything else they know, and of the moment.
    for (const title of ["## Your story so far", "## Where you are", "## Your own life", "## What you remember", "## What you know of the world", "## Turns you were there for", "## Now"]) {
      const at = danny.indexOf(title);
      if (at >= 0) expect([title, at > aim]).toEqual([title, true]);
    }
    // Nobody else's mind, no memory or helper step, no narrator's section, no player surface.
    const others = rig.host.quietCalls.filter((c) => !isMind(c, "Danny Okafor"));
    expect(others.some((c) => isMind(c, "Priya Nair"))).toBe(true);
    expect(others.some((c) => MEMORY.test(c.messages[0]?.content ?? ""))).toBe(true);
    expect(JSON.stringify(others)).not.toContain("AIM-MARK");
    expect(rig.host.assembled.length).toBeGreaterThan(0);
    expect(JSON.stringify(rig.host.assembled)).not.toContain("AIM-MARK");
    expect(JSON.stringify(rig.latestView(chatId))).not.toContain("AIM-MARK");
    expect(JSON.stringify(rig.host.sent.filter((m) => m.type !== "lre.result"))).not.toContain("AIM-MARK");
    // Their next mind still works from it.
    await rig.turn(chatId, "Anything new?", "They shrug.");
    expect(mindCalls(rig).filter((c) => isMind(c, "Danny Okafor")).at(-1)?.messages[1]?.content).toContain(AIM);
  });

  test("their intent is never cut: however long who they are runs, it comes whole after it", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    fakeModels(rig);
    const contexts: string[] = [];
    const minds = rig.host.quietReply;
    rig.host.quietReply = (req) => {
      if (MIND.exec(req.messages[0]?.content ?? "")?.[1] === "Danny Okafor") contexts.push(req.messages[1]?.content ?? "");
      return minds?.(req) ?? "{}";
    };
    const chatId = await alderChat(rig);
    const AIM = `AIM-MARK ${"keep the shop open through the winter whatever it takes ".repeat(10).trim()} AIM-END`;
    const description = "He has fixed every engine on Harbor Street twice. ".repeat(400).trim();
    rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "set", entity: "danny_okafor", field: "description", value: description }, { op: "mind_intent", entity: "danny_okafor", text: AIM }] }));
    await rig.turn(chatId, "Hello.", "They look up.");
    const context = contexts.at(-1) ?? "";
    const block = ["## What you mean to do", ...intentLines({ text: AIM, approach: null })].join("\n");
    expect(context).toContain(block);
    // No overall limit cuts a mind's context (DESIGN §24.5): who they are comes whole, and their intent right after it.
    expect(context).toContain(description);
    expect(context.indexOf(block)).toBeGreaterThan(context.indexOf(description));
  });

  test("by default the latest reply is read whole, however long, by the next mind and by the memory step; only who was there for it reads it", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    fakeModels(rig);
    const minds: Record<string, string> = {};
    const memories: Record<string, string> = {};
    const fake = rig.host.quietReply;
    rig.host.quietReply = (req) => {
      const system = req.messages[0]?.content ?? "";
      const mind = MIND.exec(system)?.[1];
      const memory = MEMORY.exec(system)?.[1];
      if (mind) minds[mind] = req.messages[1]?.content ?? "";
      if (memory) memories[memory] = req.messages[1]?.content ?? "";
      return fake?.(req) ?? "{}";
    };
    const chatId = await alderChat(rig);
    const { state, world } = await stateOf(rig, chatId);
    const here = placeOfEntity(state, "pov") ?? "";
    const elsewhere = Object.keys(world.places).find((p) => p !== here && world.places[p]?.parent === undefined) ?? "";
    // Priya is away for the long reply, and back for the next turn.
    rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "move", entity: "priya_nair", to: elsewhere }] }));
    const long = `START-MARK ${"the gulls wheel over the breakwater and the tide comes in ".repeat(140).trim()} END-MARK`;
    expect(long.length).toBeGreaterThan(8000);
    await rig.turn(chatId, "Hello.", long);
    expect(memories["Danny Okafor"]).toContain(`Story: ${long}`);
    expect(memories["Priya Nair"]).toBeUndefined();
    rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "move", entity: "priya_nair", to: here }] }));
    await rig.turn(chatId, "And then?", "They shrug.");
    expect(minds["Danny Okafor"]?.split("## Now\n")[1]).toContain(`The story so far ended: ${long}`);
    const priya = minds["Priya Nair"] ?? "";
    expect(priya).toContain("Now Jordan Ellis says or does: And then?");
    expect(priya).not.toContain("the gulls wheel");
  });

  test("with a token allowance the latest reply is read by its end, cut to about that size", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    fakeModels(rig);
    const minds: string[] = [];
    const memories: string[] = [];
    const fake = rig.host.quietReply;
    rig.host.quietReply = (req) => {
      const system = req.messages[0]?.content ?? "";
      if (MIND.exec(system)?.[1] === "Danny Okafor") minds.push(req.messages[1]?.content ?? "");
      if (MEMORY.exec(system)?.[1] === "Danny Okafor") memories.push(req.messages[1]?.content ?? "");
      return fake?.(req) ?? "{}";
    };
    const chatId = await alderChat(rig);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { minds: { reads: { reply: { tokens: 200 } } } } }));
    const long = `START-MARK ${"the gulls wheel over the breakwater and the tide comes in ".repeat(70).trim()} END-MARK`;
    await rig.turn(chatId, "Hello.", long);
    await rig.turn(chatId, "And then?", "They shrug.");
    const story = /\nStory: (.*)$/.exec(memories[0] ?? "")?.[1] ?? "";
    const ended = /The story so far ended: (.*)\n/.exec(minds.at(-1) ?? "")?.[1] ?? "";
    // 200 tokens at the estimate's 3.2 characters a token: about 640 characters, from a word.
    for (const read of [story, ended]) {
      expect(read).toMatch(/^….+ END-MARK$/);
      expect(read).not.toContain("START-MARK");
      expect(read.length).toBeGreaterThan(560);
      expect(read.length).toBeLessThanOrEqual(640);
    }
  });

  test("recall takes what its own limit allows, whole turns, the latest first; the moment is never cut, and nothing else cuts either", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    fakeModels(rig);
    const contexts: string[] = [];
    const minds = rig.host.quietReply;
    rig.host.quietReply = (req) => {
      if (MIND.exec(req.messages[0]?.content ?? "")?.[1] === "Danny Okafor") contexts.push(req.messages[1]?.content ?? "");
      return minds?.(req) ?? "{}";
    };
    const chatId = await alderChat(rig);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { minds: { reads: { recall: { on: true } }, memory: { recall: { recent: 8, relevant: 0, tokens: "none" } } } } }));
    const here = placeOfEntity((await stateOf(rig, chatId)).state, "pov") ?? "";
    // Danny stays with the POV for every turn, so every one is his to recall.
    const stay = async () => rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "move", entity: "danny_okafor", to: here }, { op: "move", entity: "pov", to: here }] }));
    for (let k = 1; k <= 8; k++) {
      await stay();
      await rig.turn(chatId, `Turn ${k}.`, `REPLY-${k} ${"and the harbor wind keeps on blowing ".repeat(41).trim()} END-${k}`);
    }
    await stay();
    await rig.turn(chatId, "NOW-MARK: what do you think?", "They think.");
    const context = contexts.at(-1) ?? "";
    const ended = /The story so far ended: (.*)\n/.exec(context)?.[1] ?? "";
    expect(ended).toMatch(/^REPLY-8 .* END-8$/);
    expect(context).toContain("## Now\n");
    expect(context).toContain("Now Jordan Ellis says or does: NOW-MARK: what do you think?");
    expect(context.split("\n").length).toBeGreaterThan(20);
    // With no limit every turn they were there for comes, each whole: no room left by the rest cuts one.
    const recall = context.slice(context.indexOf("## Turns you were there for"), context.indexOf("## Now"));
    const recalled = [...recall.matchAll(/REPLY-(\d+)/g)].map((m) => Number(m[1]));
    expect(recalled).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const k of recalled) expect(recall).toContain(`END-${k}`);
    // Within a limit, the latest turns whole, as many as it holds.
    const { state } = await stateOf(rig, chatId);
    const messages = await rig.host.chats.messages(chatId, rig.host.userId);
    const limited = recallFor({ state, who: "danny_okafor", memory: { ...DEFAULT_MINDS_MEMORY, recall: { recent: 8, relevant: 0, tokens: 1200 } }, messages, hideJson: true }, "");
    expect(limited.length).toBeGreaterThan(1);
    expect(limited.length).toBeLessThan(8);
    expect(limited.at(-1)?.text).toContain("They think.");
    expect(limited.reduce((sum, t) => sum + sectionTokens(t.text), 0)).toBeLessThanOrEqual(1200);
    for (const t of limited) if (t.text.includes("REPLY-")) expect(t.text).toMatch(/REPLY-(\d+) .* END-\1$/s);
  });
});

describe("determinism", () => {
  test("the background lane runs no model and records no mind; replay folds the same", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    fakeModels(rig);
    const chatId = await alderChat(rig);
    await rig.turn(chatId, "Hello.", "They look up.");
    const world = (await stateOf(rig, chatId)).world;
    const start = playtestStart(rig.rt.registry, world, "r");
    const step = playtestTurn(rig.rt.registry, { plan: planTurn, post: postTurn }, world, start, "Hello.", "seed", 0);
    expect(JSON.stringify(step)).not.toContain("minds.mind");
    // Replay: a restarted backend folds the same chat to the same minds state.
    const before = (await stateOf(rig, chatId)).state.packs.minds;
    const again = rig.restart();
    expect((await stateOf(again, chatId)).state.packs.minds).toEqual(before);
  });
});

