// Character minds around real turns on the fake host (DESIGN §24): one call per mind, blind to the
// others; the Minds section in the prompt under each secrecy; memory written after the reply; recall
// holding only the turns a character was there for; Re-narrate reusing the pre phase's minds and
// Re-run asking again; the inspector's traces; and a mind's secret kept from every player surface.

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../../src/shared/json";
import type { LedgerEvent } from "../../src/shared/ledger";
import { DEFAULT_MINDS_MEMORY } from "../../src/shared/minds";
import type { WorldDoc } from "../../src/shared/world";
import { toChain } from "../../src/backend/ledger-io";
import type { QuietRequest } from "../../src/backend/host";
import { presentTurns, recallFor } from "../../src/backend/minds-context";
import { playtestStart, playtestTurn } from "../../src/engine/authoring";
import type { WorldState } from "../../src/engine/state";
import { planTurn, postTurn } from "../../src/engine/turn";
import { unrevealedSecrets } from "../../src/engine/visibility";
import { readCharacter, readSlice } from "../../src/packs/minds/core/state";
import { placeOfEntity } from "../../src/engine/scope";
import { Rig } from "../support/rig";

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
 * A Port Alder chat with Danny and Priya with the POV, the only Live minds: the author's `always`
 * pins them, the thresholds keep everyone else Background, and Near refreshes are off.
 */
async function alderChat(rig: Rig, minds: JsonObject = {}): Promise<string> {
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  rig.body(await rig.send({ type: "lre.editor", op: "set", worldId, base: null, part: "minds", value: { thresholds: { live: 900, near: 900, far: 900 }, always: { ids: [...PEOPLE] }, ...minds } }));
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  rig.body(await rig.send({ type: "lre.settings.set", patch: { minds: { refreshLimit: 0 } } }));
  const { state } = await stateOf(rig, chatId);
  const here = placeOfEntity(state, "pov");
  if (!here) throw new Error("the POV is nowhere");
  rig.body(await rig.send({ type: "lre.edit", chatId, ops: PEOPLE.map((entity) => ({ op: "move", entity, to: here })) }));
  return chatId;
}

/** The section the last interceptor run sent under `label`, or "". */
function section(rig: Rig, label: string): string {
  return (rig.host.lastInterceptor?.mutated ?? []).map((m) => m.content ?? "").find((c) => c.startsWith(`[${label}]\n`)) ?? "";
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
    const rig = new Rig({ shipped: true });
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
    const recall = (who: string) => recallFor({ state, who, memory, messages, hideJson: true, moment: { kind: "turn", at: state.clock, reason: "a turn", user: "", reply: "" } }).map((t) => t.text).join("\n");
    expect(recall(stayed)).toContain("SECOND-MARK");
    expect(recall("priya_nair")).not.toContain("SECOND-MARK");
    expect(recall("priya_nair")).toContain("Priya smiles at you");
  });

  test("a travel turn: who heard the message remembers it, and whoever the POV met at its destination never recalls or notes it", async () => {
    const rig = new Rig({ shipped: true });
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
    expect(memories["Helen Kowalczyk"]).toBeUndefined();
    const presence = readSlice(state).presence;
    const said = presence.find((p) => p.msg !== null);
    expect(said?.place).toBe("birch_lane_12");
    expect(said?.who).toContain("marcus_delgado");
    expect(said?.who).not.toContain("helen_kowalczyk");
    expect(presence.find((p) => p.msg === null && p.place === "harbor_street_114")?.who).toContain("helen_kowalczyk");
    // Recall: the turn is Marcus's, never Helen's.
    const messages = await rig.host.chats.messages(chatId, rig.host.userId);
    const recall = (who: string) => recallFor({ state, who, memory: DEFAULT_MINDS_MEMORY, messages, hideJson: true, moment: { kind: "turn", at: state.clock, reason: "a turn", user: "", reply: "" } }).map((t) => t.text).join("\n");
    expect(recall("marcus_delgado")).toContain(LINE);
    expect(presentTurns(state, "helen_kowalczyk")).toEqual([]);
    // Her next mind, with the POV at her place, isn't told how that turn went either.
    minds.length = 0;
    await rig.turn(chatId, "Hello, Helen.", "She smiles.");
    const helen = minds.find((m) => m.startsWith("Helen Kowalczyk\n")) ?? "";
    expect(helen).toContain("Now Jordan Ellis says or does: Hello, Helen.");
    expect(helen).not.toContain("recipe book");
  });

  test("full secrecy gives the narrator each monologue and intent", async () => {
    const rig = new Rig({ shipped: true });
    fakeModels(rig);
    const chatId = await alderChat(rig, { secrecy: "full" });
    await rig.turn(chatId, "Hello.", "They look up.");
    const minds = section(rig, "Minds");
    expect(minds).toContain("Danny Okafor's mind: PRIVATE thoughts of Danny Okafor");
    expect(minds).toContain("Intends: Danny Okafor means to ask about the weekend.");
  });

  test("under full secrecy a mind reaches no helper step, no contradiction chip and no choice", async () => {
    const rig = new Rig({ shipped: true });
    // Every step on, every turn: brief, outline, choices, contradiction, extract and the rest.
    const steps = Object.fromEntries(["interpret", "npc.choose", "contradiction", "puzzle.answer", "brief", "outline", "extract", "choices"].map((p) => [p, { enabled: true, signals: ["always"] }]));
    rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { preset: "full" } } }));
    rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { preset: "custom", steps } } }));
    fakeModels(rig);
    const minds = rig.host.quietReply;
    // A choices helper that suggests whatever intent it is shown, and a contradiction helper that calls
    // any mind among the facts contradicted: either would carry the mind onto a chip.
    rig.host.quietReply = (req) => {
      const system = req.messages[0]?.content ?? "";
      const user = req.messages[1]?.content ?? "";
      if (system.includes("Suggest three short")) return JSON.stringify({ choices: [/Intends: ([^.\n]+)/.exec(user)?.[1] ?? "I wave back"] });
      const asked = /^"contradicts": .* Criteria: (\{.*\})$/m.exec(user)?.[1];
      if (system.startsWith("Answer each question about the state") && asked) {
        const criteria: Record<string, string> = JSON.parse(asked);
        const pick = Object.keys(criteria).find((k) => criteria[k]?.includes("PRIVATE")) ?? "none";
        return JSON.stringify({ contradicts: { probabilities: { [pick]: 1 } } });
      }
      return minds?.(req) ?? "{}";
    };
    const chatId = await alderChat(rig, { secrecy: "full" });
    await rig.turn(chatId, "Hello.", "They look up.");
    // The narrator has the minds whole; nothing else does.
    expect(section(rig, "Minds")).toContain("PRIVATE thoughts of Danny Okafor");
    const leaks = /PRIVATE|means to ask about the weekend/;
    const helpers = rig.host.quietCalls.filter((c) => !MIND.test(c.messages[0]?.content ?? "") && !MEMORY.test(c.messages[0]?.content ?? ""));
    const asked = helpers.map((c) => /You brief|You outline|Suggest three short|propose concrete state changes|"contradicts"/.exec(`${c.messages[0]?.content ?? ""} ${c.messages[1]?.content ?? ""}`)?.[0]);
    for (const step of ["You brief", "You outline", "Suggest three short", "propose concrete state changes", '"contradicts"']) expect(asked).toContain(step);
    for (const c of helpers) expect(JSON.stringify(c.messages)).not.toMatch(leaks);
    const chips = (await rig.rt.view(chatId, rig.host.userId)).chips;
    expect(chips.some((c) => c.kind === "choice")).toBe(true);
    expect(JSON.stringify(chips)).not.toMatch(leaks);
  });

  test("Re-narrate reuses the pre phase's minds; Re-run asks again", async () => {
    const rig = new Rig({ shipped: true });
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

  test("the inspector lists each minds call, with no text and strangers unnamed", async () => {
    const rig = new Rig({ shipped: true });
    fakeModels(rig);
    const chatId = await alderChat(rig);
    await rig.turn(chatId, "Hello.", "They look up.");
    const record = rig.rt.inspectorRecords(chatId)?.at(-1);
    const traces = record?.minds ?? [];
    expect(traces.filter((t) => t.purpose === "mind").map((t) => [t.phase, t.outcome, t.prompt])).toEqual([
      ["pre", "recorded", "default"],
      ["pre", "recorded", "default"],
    ]);
    expect(traces.filter((t) => t.purpose === "memory").length).toBe(2);
    expect(JSON.stringify(traces)).not.toContain("PRIVATE");
  });

  test("a mind's secret never reaches the narrator under brief, nor the Journal, Cast or chips", async () => {
    const rig = new Rig({ shipped: true });
    const probe = new Rig({ shipped: true });
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
    expect(rig.rt.inspectorRecords(chatId)?.at(-1)?.minds?.some((t) => t.outcome === "leak_blocked")).toBe(true);
    // Every player surface: the state view (Journal, Cast, chips and the rest) never carries it.
    expect(JSON.stringify(rig.latestView(chatId))).not.toContain(secret);
    expect(JSON.stringify(rig.host.sent.filter((m) => m.type !== "lre.result"))).not.toContain(secret);
  });

  test("minds switched off: no mind calls, and the chat's round says so once", async () => {
    const rig = new Rig({ shipped: true });
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

describe("determinism", () => {
  test("the background lane runs no model and records no mind; replay folds the same", async () => {
    const rig = new Rig({ shipped: true });
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

