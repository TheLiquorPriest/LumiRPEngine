// A mind's plan to pay or lend someone, carried out by the economy (DESIGN §24.8, §25.5): the
// amount goes from the planner to the person the plan is with at its time; the plan is done once
// paid, and dropped with the reason when the money isn't there; and the plan's own words never
// reach anyone's books. Real turns on the fake host, with a fake mind.

import { describe, expect, test } from "bun:test";
import type { QuietRequest } from "../../src/backend/host";
import { toChain } from "../../src/backend/ledger-io";
import { timelapseRequest } from "../../src/frontend/requests";
import { placeOfEntity } from "../../src/engine/scope";
import type { WorldState } from "../../src/engine/state";
import { journalOf } from "../../src/packs/economy/core/journal";
import { readCharacter } from "../../src/packs/minds/core/state";
import type { JsonObject } from "../../src/shared/json";
import type { MindPlan } from "../../src/shared/minds";
import { Rig } from "../support/rig";

const MIND = /You are the private mind of (.+?) in the roleplay world/;
const MEMORY = /You keep the memory of (.+?) in the roleplay world/;

/** Port Alder with Danny and Priya the only Live minds, both with the POV, each mind giving its own plans on its first call. */
async function alderChat(rig: Rig, plans: Record<string, JsonObject[]>, money: number | null = null): Promise<string> {
  const asked = new Set<string>();
  rig.host.quietReply = (req: QuietRequest) => {
    const system = req.messages[0]?.content ?? "";
    const mind = MIND.exec(system)?.[1];
    if (mind) {
      const first = !asked.has(mind);
      asked.add(mind);
      return JSON.stringify({ monologue: `${mind} thinks it over.`, depiction: `${mind} looks up`, intent: "settle up", reactions: [], plans: first ? (plans[mind] ?? []) : [], mood: "calm" });
    }
    if (MEMORY.test(system)) return JSON.stringify({ notes: [], commitments: [], resolved: [], plans: [], told: [] });
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

async function stateOf(rig: Rig, chatId: string): Promise<{ state: WorldState }> {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  if (!core) throw new Error("no ledger");
  return { state: core.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state };
}

/** Time passing, as the palette's Timelapse sends it. */
async function timelapse(rig: Rig, chatId: string, minutes: number): Promise<void> {
  const palette = (await rig.rt.view(chatId, rig.host.userId)).palette?.timelapse;
  if (!palette) throw new Error("no Timelapse");
  rig.body(await rig.send(timelapseRequest(palette, { type: "duration", minutes }, {}, chatId)));
  await rig.host.settle();
  const generation = await rig.host.start(chatId, { type: "normal" });
  await rig.host.finish(generation, "Time passes.");
}

const planOf = (state: WorldState, who: string, kind: MindPlan["kind"]): MindPlan | undefined => readCharacter(state, who).plans.find((p) => p.kind === kind);
const linesOf = (state: WorldState, account: string, flow: string) => journalOf(state, account).filter((j) => j.flow === flow);

describe("a mind's plan to pay or lend someone", () => {
  test("is paid at its time from the planner to the person it's with, then done; one the money can't cover is dropped with why", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await alderChat(rig, {
      "Danny Okafor": [
        { what: "Pay Priya back for the ferry tickets she covered", kind: "pay", when: { from: "2026-09-14 08:00", to: "2026-09-14 08:30" }, with: ["Priya Nair"], amount: 20 },
        // No amount, or no one to hand it to: no plan at all.
        { what: "Pay for something", kind: "pay", when: { from: "2026-09-14 08:00", to: "2026-09-14 08:30" }, with: ["Priya Nair"] },
        { what: "Lend someone money", kind: "lend", when: { from: "2026-09-14 08:00", to: "2026-09-14 08:30" }, with: [], amount: 50 },
      ],
      "Priya Nair": [{ what: "Lend Danny enough to buy the garage outright", kind: "lend", when: { from: "2026-09-14 09:00", to: "2026-09-14 10:00" }, with: ["Danny Okafor"], amount: "$1,000,000" }],
    });
    await rig.turn(chatId, "Morning, both of you.", "Danny nods. Priya waves.");
    const before = (await stateOf(rig, chatId)).state;
    const pay = planOf(before, "danny_okafor", "pay");
    const lend = planOf(before, "priya_nair", "lend");
    expect(readCharacter(before, "danny_okafor").plans.map((p) => [p.kind, p.cents, p.with])).toEqual([["pay", 2000, ["priya_nair"]]]);
    expect(lend).toMatchObject({ cents: 100_000_000, with: ["danny_okafor"], status: "open" });
    if (!pay || !lend) throw new Error("no plans");
    // Danny's memory, and his mind on the next turn, are told what he means to hand over.
    const toldOf = (pattern: RegExp): string => rig.host.quietCalls.filter((c) => pattern.exec(c.messages[0]?.content ?? "")?.[1] === "Danny Okafor").map((c) => c.messages[1]?.content ?? "").join("\n");
    expect(toldOf(MEMORY)).toContain("- Pay Priya back for the ferry tickets she covered, $20.00 (");
    await rig.turn(chatId, "Anything else?", "Danny shrugs.");
    expect(toldOf(MIND)).toContain("- Plan (pay): Pay Priya back for the ferry tickets she covered, $20.00, ");

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
    expect(planOf(state, "priya_nair", "lend")).toMatchObject({ status: "dropped", reason: expect.stringContaining("1,000,000") });
  });

  test("a GM's pay plan for the POV pays the POV, and Money below the money step still carries a plan out", async () => {
    const rig = new Rig({ shipped: true });
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
});
