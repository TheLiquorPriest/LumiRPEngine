// The adjudication policy end to end (DESIGN §11): where a chat's policy comes from (the world's
// ruleset, the user's settings for new chats, the chat's own marker), the `judge` step before the
// plan (asked only when the policy needs it, never on Lean, and recorded with the turn), and how the
// narrator and the roll chip are told what the policy decided.

import { describe, expect, test } from "bun:test";
import { presetAdjudication } from "../../src/shared/adjudication";
import type { JsonObject } from "../../src/shared/json";
import type { AdjudicationDef, WorldDoc } from "../../src/shared/world";
import { toChain } from "../../src/backend/ledger-io";
import { planLines, rollChip } from "../../src/backend/runtime";
import { defaultSettings } from "../../src/backend/settings-store";
import { startMarkersFrom } from "../../src/backend/start-markers";
import { resolveOn } from "../../src/engine/resolve";
import { createRng } from "../../src/engine/rng";
import type { EngineTurnPlan } from "../../src/engine/turn";
import { baseWorld, registryOf, startState } from "../packs/support";
import { Rig } from "../support/rig";

const adjudicateOf = (world: WorldDoc, settings = defaultSettings()): AdjudicationDef | undefined => {
  const m = startMarkersFrom(settings, world, "rev").find((b) => b.kind === "adjudicate");
  return m?.kind === "adjudicate" ? m.to : undefined;
};

describe("a new chat's policy", () => {
  test("the world's ruleset, the user's filling in where it sets none, or the user's replacing it", () => {
    const plain = baseWorld();
    const balanced = baseWorld({ ruleset: { adjudication: presetAdjudication("balanced") } });
    expect(adjudicateOf(plain)).toEqual(presetAdjudication("crunchy"));
    expect(adjudicateOf(balanced)).toEqual(presetAdjudication("balanced"));
    const mine = { ...defaultSettings(), adjudication: presetAdjudication("narrative") };
    expect(adjudicateOf(plain, mine)).toEqual(presetAdjudication("narrative"));
    expect(adjudicateOf(balanced, mine)).toEqual(presetAdjudication("balanced"));
    expect(adjudicateOf(balanced, { ...mine, overrideWorldAdjudication: true })).toEqual(presetAdjudication("narrative"));
  });
});

/** A test-world chat with a coin-flip check (d20 against 11) under `policy`; the helper answers `judge` with `judgement` and reads nothing from replies. */
async function climbChat(rig: Rig, policy: AdjudicationDef, judgement: JsonObject): Promise<string> {
  const worldId = await rig.newWorld();
  const draft = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId, base: null }));
  const action: JsonObject = { id: "climb", label: "Climb the wall", params: {}, requires: [], check: { id: "climb", dice: "d20", dc: "11" }, outcomes: { success: [], failure: [] }, duration: "5" };
  rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: draft.base, collection: "actions", id: "climb", value: action }));
  rig.body(await rig.send({ type: "lre.editor", op: "set", worldId, base: draft.base, part: "ruleset", value: { adjudication: policy as unknown as JsonObject } }));
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: draft.base }));
  rig.host.quietReply = (request) => (request.messages.some((m) => m.content.includes("Rate the approach")) ? JSON.stringify(judgement) : JSON.stringify({ proposals: [] }));
  const chatId = rig.host.createChat("Morning, Sam.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  return chatId;
}

async function climbTurn(rig: Rig, chatId: string, text: string): Promise<void> {
  rig.body(await rig.send({ type: "lre.action", chatId, action: "climb", params: {}, text }));
  await rig.host.settle();
  const g = await rig.host.start(chatId, { type: "normal" });
  await rig.host.finish(g, "You climb.");
}

const judgeCalls = (rig: Rig): number => rig.host.quietCalls.filter((r) => r.messages.some((m) => m.content.includes("Rate the approach"))).length;

describe("the judge step", () => {
  test("rates the described approach before the plan; the rating shifts the roll and is recorded with the turn", async () => {
    const rig = new Rig();
    const chatId = await climbChat(rig, presetAdjudication("balanced"), { rating: 2, reason: "a rope and a grappling hook" });
    await climbTurn(rig, chatId, "I throw the grappling hook over and walk it up the rope.");
    expect(judgeCalls(rig)).toBe(1);
    const core = await rig.rt.ledger.core(chatId, rig.host.userId);
    const chain = toChain(await rig.host.chats.messages(chatId, rig.host.userId));
    const events = chain.flatMap((m) => Object.values(m.ledger?.swipes ?? {}).flatMap((r) => r.events));
    expect(events.find((e) => e.type === "engine.adjudged")).toMatchObject({ data: { rolled: true, rating: 2, max: 2, reason: "a rope and a grappling hook" } });
    expect(core).not.toBeNull();
    const roll = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "roll");
    expect(roll?.detail).toContain("a rope and a grappling hook");
  });

  test("isn't asked when the policy doesn't weigh words, and never on Lean", async () => {
    const crunchy = new Rig();
    await climbTurn(crunchy, await climbChat(crunchy, presetAdjudication("crunchy"), { rating: 2, reason: "" }), "I climb carefully.");
    expect(judgeCalls(crunchy)).toBe(0);
    const lean = new Rig();
    const chatId = await climbChat(lean, presetAdjudication("narrative"), { rating: 2, reason: "", outcomes: { failure: 1 } });
    lean.body(await lean.send({ type: "lre.settings.set", patch: { modelUse: { preset: "lean" } } }));
    await climbTurn(lean, chatId, "I climb carefully.");
    expect(judgeCalls(lean)).toBe(0);
    // Under narrative authority with no judgement, the unrolled rule passes it.
    const roll = (await lean.rt.view(chatId, lean.host.userId)).chips.find((c) => c.kind === "roll");
    expect(roll?.label).toBe("Climb the wall: success");
    expect(roll?.detail).toStartWith("No roll");
  });

  test("under narrative authority the judge's odds decide, and the chip says no roll was made", async () => {
    const rig = new Rig();
    const chatId = await climbChat(rig, presetAdjudication("narrative"), { rating: 1, reason: "rushed", outcomes: { success: 0, failure: 1 } });
    // Narrative-first rolls only risky checks (below 75%); a coin flip is risky.
    await climbTurn(rig, chatId, "I scramble up without looking.");
    expect(judgeCalls(rig)).toBe(1);
    const roll = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "roll");
    expect(roll?.label).toBe("Climb the wall: failure");
    expect(roll?.detail).toMatch(/^No roll: the story decides/);
  });
});

describe("Settings → This chat", () => {
  test("a marker sets the chat's policy, over the world's and the user's", async () => {
    const rig = new Rig();
    const chatId = await climbChat(rig, presetAdjudication("balanced"), { rating: 0, reason: "" });
    const policy = async () => (await rig.rt.view(chatId, rig.host.userId)).controls?.adjudication;
    expect(await policy()).toEqual(presetAdjudication("balanced"));
    await climbTurn(rig, chatId, "I climb.");
    rig.body(await rig.send({ type: "lre.marker", chatId, kind: "adjudicate", to: presetAdjudication("narrative") as unknown as JsonObject }));
    expect(await policy()).toEqual(presetAdjudication("narrative"));
    rig.body(await rig.send({ type: "lre.settings.set", patch: { adjudication: { preset: "crunchy" }, overrideWorldAdjudication: true } }));
    expect(await policy()).toEqual(presetAdjudication("narrative"));
    const custom = { ...presetAdjudication("crunchy"), preset: "custom", checks: "never" };
    rig.body(await rig.send({ type: "lre.marker", chatId, kind: "adjudicate", to: custom }));
    expect((await policy())?.checks).toBe("never");
  });
});

describe("what the narrator is told", () => {
  /** The Outcome slot's line for one climb resolved under `policy` with `seed`. */
  function line(policy: AdjudicationDef, seed: string): { text: string; close: boolean } {
    const world = baseWorld({ ruleset: { adjudication: policy } });
    world.actions.climb = { id: "climb", label: "Climb", params: {}, requires: [], check: { id: "climb", dice: "d20", dc: "11" }, outcomes: { success: [], failure: [] }, duration: "5" };
    const reg = registryOf();
    const resolution = resolveOn(reg, world, startState(world), { action: "climb" }, createRng(seed)).resolution;
    const plan: EngineTurnPlan = { events: resolution.events, elapsedMinutes: 5, resolution, timelapse: null, montage: null, chips: [], outline: [] };
    return { text: planLines(plan, world, reg).outcome[0] ?? "", close: resolution.adjudged?.close != null };
  }

  test("hybrid: a close call may come at a cost or leave partial progress; a clear one is narrated as it fell", () => {
    const hybrid = { ...presetAdjudication("crunchy"), preset: "custom" as const, authority: "hybrid" as const, closeBy: 2 };
    let close = 0;
    let clear = 0;
    for (let i = 0; i < 60; i++) {
      const { text, close: isClose } = line(hybrid, `w${i}`);
      if (isClose) {
        close++;
        expect(text).toMatch(/only just.*(cost|partial progress)/);
      } else {
        clear++;
        expect(text).toEndWith("Narrate this result.");
      }
    }
    expect(close).toBeGreaterThan(0);
    expect(clear).toBeGreaterThan(0);
  });

  test("a check nothing rolled says so, and a plain-rolling policy keeps the roll's own line and chip", () => {
    const never = line({ ...presetAdjudication("crunchy"), preset: "custom", checks: "never" }, "n").text;
    expect(never).toBe("Climb: success (no roll needed). Narrate this result.");
    const plain = line(presetAdjudication("crunchy"), "p").text;
    expect(plain).toMatch(/^Climb: (success|failure) \(rolled \d+ on .+\)\. Narrate this result\.$/);
    const world = baseWorld();
    world.actions.climb = { id: "climb", label: "Climb", params: {}, requires: [], check: { id: "climb", dice: "d20", dc: "11" }, outcomes: { success: [], failure: [] }, duration: "5" };
    const resolution = resolveOn(registryOf(), world, startState(world), { action: "climb" }, createRng("p")).resolution;
    expect(rollChip("Climb", resolution)?.detail).toMatch(/^Rolled d20 = \d+ against 11\. Odds: failure 50% · success 50%\.$/);
  });
});
