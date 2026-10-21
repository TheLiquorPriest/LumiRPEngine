// A character's plan to pay or lend someone, carried out by the economy (DESIGN §24.8, §25.5): the
// plan comes from what the turn states (the memory step) or the GM, never from a mind's own guess;
// the amount goes from the planner to the person the plan is with at its time; the plan is done once
// paid, and dropped with the reason when the money isn't there; and the plan's own words never reach
// anyone's books. Real turns on the fake host, with fake minds and memory.

import { describe, expect, test } from "bun:test";
import type { QuietRequest } from "../../src/backend/host";
import { toChain } from "../../src/backend/ledger-io";
import { timelapseRequest } from "../../src/frontend/requests";
import { mindsReadPatch } from "../../src/frontend/settings/minds-patch";
import { placeOfEntity } from "../../src/engine/scope";
import type { WorldState } from "../../src/engine/state";
import { journalOf } from "../../src/packs/economy/core/journal";
import { readCharacter } from "../../src/packs/minds/core/state";
import type { JsonObject } from "../../src/shared/json";
import type { LedgerEvent } from "../../src/shared/ledger";
import type { MindPlan } from "../../src/shared/minds";
import type { WorldDoc } from "../../src/shared/world";
import { createRegistry } from "../../src/engine/registry-impl";
import { ALL_NOTE } from "../../src/engine/simulate";
import { runTimelapse } from "../../src/engine/time";
import { Working } from "../../src/engine/working";
import { materializeAll } from "../../src/engine/materialize";
import { ALL_PACKS, STARTER_WORLDS } from "../../src/packs/index";
import { startState } from "../packs/support";
import { expectMatch } from "../support/match";
import { Rig } from "../support/rig";

const MIND = /You are the private mind of (.+?) in the roleplay world/;
const MEMORY = /You keep the memory of (.+?) in the roleplay world/;

/**
 * Port Alder with Danny and Priya the only Live minds, both with the POV. Each one's memory gives
 * `plans.memory` on its first call; each mind proposes `plans.mind` on every call, as a mind's answer
 * did before minds stopped making plans.
 */
async function alderChat(rig: Rig, plans: { memory?: Record<string, JsonObject[]>; mind?: Record<string, JsonObject[]> }, money: number | null = null): Promise<string> {
  const remembered = new Set<string>();
  rig.host.quietReply = (req: QuietRequest) => {
    const system = req.messages[0]?.content ?? "";
    const mind = MIND.exec(system)?.[1];
    if (mind) return JSON.stringify({ monologue: `${mind} thinks it over.`, depiction: `${mind} looks up`, intent: "settle up", reactions: [], plans: plans.mind?.[mind] ?? [], mood: "calm" });
    const memory = MEMORY.exec(system)?.[1];
    if (memory) {
      const first = !remembered.has(memory);
      remembered.add(memory);
      return JSON.stringify({ notes: [], commitments: [], resolved: [], plans: first ? (plans.memory?.[memory] ?? []) : [], told: [] });
    }
    return JSON.stringify({ proposals: [] });
  };
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  rig.body(await rig.send({ type: "lre.editor", op: "set", worldId, base: null, part: "minds", value: { thresholds: { live: 900, near: 900, far: 900 }, always: { ids: ["danny_okafor", "priya_nair"] } } }));
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  rig.body(await rig.send({ type: "lre.settings.set", patch: { minds: { refreshLimit: 0 } } }));
  if (money !== null) rig.body(await rig.send({ type: "lre.marker", chatId, kind: "resolve", domain: "money", scope: { all: true }, to: money }));
  const here = placeOfEntity((await stateOf(rig, chatId)).state, "pov");
  if (!here) throw new Error("the POV is nowhere");
  rig.body(await rig.send({ type: "lre.edit", chatId, ops: ["danny_okafor", "priya_nair"].map((entity) => ({ op: "move", entity, to: here })) }));
  return chatId;
}

async function stateOf(rig: Rig, chatId: string): Promise<{ state: WorldState; world: WorldDoc }> {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  if (!core) throw new Error("no ledger");
  const state = core.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state;
  const world = core.worldAt(state.revision);
  if (!world) throw new Error("no world");
  return { state, world };
}

/**
 * Time passing, as the palette's Timelapse sends it. Arrivals only note: Danny and Priya, Live or Near
 * but not with the POV, follow their routine off screen in a skip (§24.1) and come where it is.
 */
async function timelapse(rig: Rig, chatId: string, minutes: number): Promise<void> {
  const palette = (await rig.rt.view(chatId, rig.host.userId)).palette?.timelapse;
  if (!palette) throw new Error("no Timelapse");
  rig.body(await rig.send(timelapseRequest(palette, { type: "duration", minutes }, { arrival: "note" }, chatId)));
  await rig.host.settle();
  const generation = await rig.host.start(chatId, { type: "normal" });
  await rig.host.finish(generation, "Time passes.");
}

const planOf = (state: WorldState, who: string, kind: MindPlan["kind"]): MindPlan | undefined => readCharacter(state, who).plans.find((p) => p.kind === kind);
const linesOf = (state: WorldState, account: string, flow: string) => journalOf(state, account).filter((j) => j.flow === flow);

describe("a character's plan to pay or lend someone", () => {
  test("from what the turn states: paid at its time from the planner to the person it's with, then done; one the money can't cover is dropped with why", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const chatId = await alderChat(rig, {
      memory: {
        "Danny Okafor": [
          { what: "Pay Priya back for the ferry tickets she covered", kind: "pay", when: { from: "2026-09-14 08:00", to: "2026-09-14 08:30" }, with: ["Priya Nair"], amount: 20 },
          // No amount, or no one to hand it to: no plan at all.
          { what: "Pay for something", kind: "pay", when: { from: "2026-09-14 08:00", to: "2026-09-14 08:30" }, with: ["Priya Nair"] },
          { what: "Lend someone money", kind: "lend", when: { from: "2026-09-14 08:00", to: "2026-09-14 08:30" }, with: [], amount: 50 },
        ],
        "Priya Nair": [{ what: "Lend Danny enough to buy the garage outright", kind: "lend", when: { from: "2026-09-14 09:00", to: "2026-09-14 10:00" }, with: ["Danny Okafor"], amount: "$1,000,000" }],
      },
    });
    await rig.turn(chatId, "Morning, both of you.", "Danny nods. Priya waves.");
    const before = (await stateOf(rig, chatId)).state;
    const pay = planOf(before, "danny_okafor", "pay");
    const lend = planOf(before, "priya_nair", "lend");
    expect(readCharacter(before, "danny_okafor").plans.map((p) => [p.kind, p.cents, p.with, p.source])).toEqual([["pay", 2000, ["priya_nair"], "memory"]]);
    expect(lend).toMatchObject({ cents: 100_000_000, with: ["danny_okafor"], status: "open" });
    if (!pay || !lend) throw new Error("no plans");
    // His memory is told what he means to hand over on the next turn; his mind only once the user has
    // it read his life (Settings → Minds → What a mind reads; off by default, DESIGN §24.5).
    const toldOf = (pattern: RegExp): string => rig.host.quietCalls.filter((c) => pattern.exec(c.messages[0]?.content ?? "")?.[1] === "Danny Okafor").map((c) => c.messages[1]?.content ?? "").join("\n");
    const life = mindsReadPatch("life", { on: true, tokens: "none" });
    if (!life) throw new Error("no patch");
    rig.body(await rig.send({ type: "lre.settings.set", patch: life }));
    await rig.turn(chatId, "Anything else?", "Danny shrugs.");
    expect(toldOf(MIND)).toContain("- Plan (pay): Pay Priya back for the ferry tickets she covered, $20.00, ");
    expect(toldOf(MEMORY)).toContain("- Pay Priya back for the ferry tickets she covered, $20.00 (");

    await timelapse(rig, chatId, 8 * 60);
    const { state } = await stateOf(rig, chatId);
    const paid = `plan:danny_okafor:${pay.id}`;
    // Danny's checking pays Priya's, once, as a payment; the books never carry the plan's words.
    expect(linesOf(state, "acct_danny_checking", paid).map((j) => [j.cents, j.memo])).toEqual([[-2000, "Payment"]]);
    expect(linesOf(state, "acct_priya_checking", paid).map((j) => [j.cents, j.memo])).toEqual([[2000, "Payment"]]);
    expect(JSON.stringify(state.entities)).not.toContain("ferry tickets");
    expect(planOf(state, "danny_okafor", "pay")).toMatchObject({ status: "done", reason: null });
    // Priya can't cover a million: nothing moves, and the plan is dropped with the decline's reason.
    const loan = `plan:priya_nair:${lend.id}`;
    expect([...journalOf(state, "acct_priya_checking"), ...journalOf(state, "acct_danny_checking")].filter((j) => j.flow === loan)).toEqual([]);
    expectMatch(planOf(state, "priya_nair", "lend"), { status: "dropped", reason: expect.stringContaining("1,000,000") });
  });

  test("a mind's answer that proposes plans records none, and no money moves", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const chatId = await alderChat(rig, { mind: { "Danny Okafor": [{ what: "Pay Priya back for the ferry tickets", kind: "pay", when: { from: "2026-09-14 08:00", to: "2026-09-14 08:30" }, with: ["Priya Nair"], priority: 5, amount: 20 }] } });
    await rig.turn(chatId, "Morning, both of you.", "Danny nods. Priya waves.");
    await rig.turn(chatId, "Anything else?", "Danny shrugs.");
    expect(rig.host.quietCalls.some((c) => MIND.exec(c.messages[0]?.content ?? "")?.[1] === "Danny Okafor")).toBe(true);
    await timelapse(rig, chatId, 8 * 60);
    const { state } = await stateOf(rig, chatId);
    expect(readCharacter(state, "danny_okafor").plans).toEqual([]);
    expect(journalOf(state, "acct_priya_checking").filter((j) => j.flow?.startsWith("plan:"))).toEqual([]);
  });

  test("from what the turn states, a plan to be somewhere is laid into their day as before", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const chatId = await alderChat(rig, { memory: { "Danny Okafor": [{ what: "Pick up the boat parts", kind: "errand", when: { from: "2026-09-15 10:00", to: "2026-09-15 11:00" }, where: "harbor_street_114", priority: 4 }] } });
    await rig.turn(chatId, "See you tomorrow?", "Danny says he'll be picking up the boat parts at ten tomorrow.");
    const { state, world } = await stateOf(rig, chatId);
    const plan = planOf(state, "danny_okafor", "errand");
    expect(plan).toMatchObject({ source: "memory", where: "harbor_street_114", status: "open" });
    const ctx = rig.rt.registry.context(world, state);
    expect(ctx.query("castlife.commitments")(ctx, "danny_okafor", plan?.when.from ?? 0, plan?.when.to ?? 0)).toEqual([expect.objectContaining({ start: plan?.when.from, place: "harbor_street_114", kind: "plan", plan: plan?.id })]);
  });

  test("a GM's pay plan for the POV pays the POV, and Money below the money step still carries a plan out", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const chatId = await alderChat(rig, {}, 1);
    const at = (await stateOf(rig, chatId)).state.clock;
    rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "mind_memory", entity: "danny_okafor", part: "plan", id: null, value: { what: "Pay the POV for the shift", kind: "pay", when: { from: at + 60, to: at + 90 }, with: ["pov"], cents: 1500 } }] }));
    // A pay plan with no amount isn't one the GM can make.
    expect((await rig.send({ type: "lre.edit", chatId, ops: [{ op: "mind_memory", entity: "danny_okafor", part: "plan", id: null, value: { what: "Pay someone", kind: "pay", when: { from: at + 60, to: at + 90 }, with: ["pov"] } }] })).type).toBe("lre.error");
    await timelapse(rig, chatId, 8 * 60);
    const { state } = await stateOf(rig, chatId);
    // Below the money step the plan is still paid, as a payment at Money 1 is, and settled.
    const plan = planOf(state, "danny_okafor", "pay");
    expect(plan).toMatchObject({ status: "done", cents: 1500 });
    expect(linesOf(state, "acct_pov_checking", `plan:danny_okafor:${plan?.id}`).map((j) => [j.cents, j.memo])).toEqual([[1500, "Payment"]]);
  });

  test("a pay plan a mind made in an older chat moves no money; the GM's beside it still pays", () => {
    const reg = createRegistry(ALL_PACKS);
    const make = STARTER_WORLDS.modern_slice_of_life;
    if (!make) throw new Error("no Port Alder starter");
    const world = make("pa", "Port Alder");
    const w = new Working(reg, world, startState(world));
    materializeAll(reg, w, world.pov, "run");
    const now = w.state.clock;
    const pay = (id: string, source: MindPlan["source"], cents: number): MindPlan => ({ id, what: "Pay Priya back", kind: "pay", when: { from: now + 60, to: now + 90 }, where: null, with: ["priya_nair"], priority: 5, status: "open", made: now, source, closed: null, reason: null, cents });
    const events: LedgerEvent[] = [
      { type: "minds.round", data: { at: now, on: true } },
      // As an older chat's ledger holds it: the mind's answer carried its own plan.
      { type: "minds.mind", data: { entity: "danny_okafor", at: now, place: null, level: "live", moment: "turn", reason: "live", monologue: "m", depiction: "d", intent: "i", reactions: [], plans: [JSON.parse(JSON.stringify(pay("p_mind", "mind", 2000)))], mood: null, interrupt: null, withheld: false } },
      { type: "minds.plan_edit", data: { entity: "danny_okafor", plan: "p_gm", value: JSON.parse(JSON.stringify(pay("p_gm", "gm", 1500))) } },
    ];
    w.applyAll(events);
    expect(w.dropped).toEqual([]);
    const out = runTimelapse(reg, w, { type: "duration", minutes: 8 * 60 }, { runSeed: "run", overrides: ALL_NOTE });
    if ("code" in out) throw new Error(out.reason);
    expect(linesOf(w.state, "acct_priya_checking", "plan:danny_okafor:p_gm").map((j) => j.cents)).toEqual([1500]);
    expect(linesOf(w.state, "acct_priya_checking", "plan:danny_okafor:p_mind")).toEqual([]);
    // The GM still sees the mind's, as it was: open, settled by nothing.
    expect(readCharacter(w.state, "danny_okafor").plans.map((p) => [p.id, p.status])).toEqual([
      ["p_mind", "open"],
      ["p_gm", "done"],
    ]);
  });
});
