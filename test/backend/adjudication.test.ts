// The adjudication policy end to end (DESIGN §11): where a chat's policy comes from (the world's
// ruleset, the user's settings for new chats, the chat's own marker), the `judge` step before the
// plan (asked only when the policy needs it, never on Lean, and recorded with the turn), and how the
// narrator and the roll chip are told what the policy decided.

import { describe, expect, test } from "bun:test";
import type { DecideRequest } from "../../src/backend/host";
import type { Answers } from "../../src/engine/decide";
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
import { namesAny } from "../../src/engine/visibility";
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
async function climbChat(rig: Rig, policy: AdjudicationDef, judgement: JsonObject, lore: Record<string, JsonObject> = {}, entities: Record<string, JsonObject> = {}, places: Record<string, JsonObject> = {}): Promise<string> {
  const worldId = await rig.newWorld();
  const draft = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId, base: null }));
  const action: JsonObject = { id: "climb", label: "Climb the wall", lexicon: ["climb"], params: {}, requires: [], check: { id: "climb", dice: "d20", dc: "11" }, outcomes: { success: [], failure: [] }, duration: "5" };
  rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: draft.base, collection: "actions", id: "climb", value: action }));
  for (const [id, value] of Object.entries(lore)) rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: draft.base, collection: "lore", id, value }));
  for (const [id, value] of Object.entries(entities)) rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: draft.base, collection: "entities", id, value }));
  for (const [id, value] of Object.entries(places)) rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: draft.base, collection: "places", id, value }));
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

  test("isn't asked when the policy doesn't weigh words, and never on Lean, where the dice decide what the story would", async () => {
    const crunchy = new Rig();
    await climbTurn(crunchy, await climbChat(crunchy, presetAdjudication("crunchy"), { rating: 2, reason: "" }), "I climb carefully.");
    expect(judgeCalls(crunchy)).toBe(0);
    const lean = new Rig();
    const chatId = await climbChat(lean, presetAdjudication("narrative"), { rating: 2, reason: "", outcomes: { failure: 1 } });
    lean.body(await lean.send({ type: "lre.settings.set", patch: { modelUse: { preset: "lean" } } }));
    await climbTurn(lean, chatId, "I climb carefully.");
    expect(judgeCalls(lean)).toBe(0);
    // Under narrative authority nothing judged the coin flip, so it rolled rather than just succeeding.
    const roll = (await lean.rt.view(chatId, lean.host.userId)).chips.find((c) => c.kind === "roll");
    expect(roll?.label).toMatch(/^Climb the wall: (success|failure)$/);
    expect(roll?.detail).toMatch(/^Rolled d20 = \d+ against 11\. Odds: failure 50% · success 50%\. Nothing judged your approach, so the dice decided\.$/);
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

describe("the judge step's call", () => {
  /** Every Decision question answered with its first choice. */
  const firstChoice = (req: DecideRequest): Answers => {
    const out: Answers = {};
    for (const [key, q] of Object.entries(req.questions)) {
      const first = Object.keys(q.type === "choice" ? q.criteria : {})[0];
      if (first) out[key] = { type: "choice", choice: first, probabilities: { [first]: 1 }, confidence: 1 };
    }
    return out;
  };

  /** Standard's two calls before the reply: a climb typed under `policy`, with Jo, whose day plan is undecided (`tie`), in the room or not. */
  async function starve(policy: AdjudicationDef, tie: boolean): Promise<{ purposes: string[]; roll: string }> {
    const rig = new Rig();
    const judgement = { rating: 0, reason: "a reckless leap", outcomes: { success: 0.05, failure: 0.95 } };
    const chatId = await climbChat(rig, policy, judgement, {}, { jo: { id: "jo", kind: "person", name: "Jo Park", tier: "supporting", agent: true, fields: { place: "home", tie }, relations: [] } });
    rig.host.quietReply = (request) => {
      if (request.messages.some((m) => m.content.includes("Rate the approach"))) return JSON.stringify(judgement);
      if ((request.messages[0]?.content ?? "").includes("You map a player's typed input")) return JSON.stringify({ action: "climb", params: {}, confidence: 0.95 });
      return JSON.stringify({ proposals: [] });
    };
    rig.host.decideReply = firstChoice;
    const start = rig.rt.meter.log.length;
    await rig.turn(chatId, "I climb the wall in one reckless leap.", "You climb.");
    const roll = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "roll");
    return { purposes: rig.rt.meter.log.slice(start).map((c) => c.purpose), roll: `${roll?.label ?? ""} | ${roll?.detail ?? ""}` };
  }

  test("the player's own check is judged before an NPC's choice takes the last call", async () => {
    for (const tie of [false, true]) {
      const turn = await starve(presetAdjudication("narrative"), tie);
      expect(turn.purposes.filter((p) => p === "judge")).toHaveLength(1);
      expect(turn.purposes).not.toContain("npc.choose");
      expect(turn.roll).toMatch(/^Climb the wall: (success|failure) \| No roll: the story decides, judged from your approach/);
    }
  });

  test("an NPC's choice still gets the call the judge doesn't need", async () => {
    const turn = await starve(presetAdjudication("crunchy"), true);
    expect(turn.purposes).toContain("npc.choose");
    expect(turn.purposes).not.toContain("judge");
  });

  test("a palette tap with no words of its own isn't judged; words typed with it are", async () => {
    const rig = new Rig();
    // Retries are free, so the second climb asks the same as the first whatever it rolled.
    const chatId = await climbChat(rig, { ...presetAdjudication("balanced"), preset: "custom", retry: "free" }, { rating: 2, reason: "a rope and a grappling hook" });
    await climbTurn(rig, chatId, "");
    expect(judgeCalls(rig)).toBe(0);
    const roll = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "roll");
    expect(roll?.detail).not.toContain("Your approach");
    await climbTurn(rig, chatId, "I throw the grappling hook over and walk it up the rope.");
    expect(judgeCalls(rig)).toBe(1);
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
    const plan: EngineTurnPlan = { events: resolution.events, elapsedMinutes: 5, resolutions: [resolution], stopped: null, timelapse: null, montage: null, chips: [], outline: [], combat: [] };
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

describe("the judge step's lore", () => {
  const SECRET = "The north wall's mortar is rotten behind the ivy";
  const lore: Record<string, JsonObject> = {
    wall: { id: "wall", title: "The garden wall", content: "The garden wall is old brick, eight feet high.", keys: ["wall"], links: [] },
    rot: { id: "rot", title: "Rotten mortar", content: `${SECRET}.`, keys: ["wall"], links: [], secret: true, gate: "self.cash > 100000", audience: ["judge"] },
  };

  test("judge reads what its action and the player's words find, a secret listed for it included, and its reason can't carry the secret to the roll chip", async () => {
    const rig = new Rig();
    const chatId = await climbChat(rig, presetAdjudication("balanced"), { rating: 2, reason: `${SECRET.toLowerCase()}, so the climb is easy` }, lore);
    await climbTurn(rig, chatId, "I climb the wall where the ivy grows thickest.");
    expect(judgeCalls(rig)).toBe(1);
    const system = rig.host.quietCalls.find((r) => r.messages.some((m) => m.content.includes("Rate the approach")))?.messages[0]?.content ?? "";
    expect(system).toContain("The garden wall: The garden wall is old brick, eight feet high.");
    expect(system).toContain(SECRET);
    const roll = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "roll");
    expect(roll?.detail).toContain("Your approach: 2 of 2.");
    expect((roll?.detail ?? "").toLowerCase()).not.toContain(SECRET.toLowerCase());
    expect(JSON.stringify((await rig.rt.view(chatId, rig.host.userId)).panels["core.context"])).toContain('"step":"judge"');
  });
});

describe("the judge step and people the POV can't see", () => {
  const people: Record<string, JsonObject> = {
    vex: { id: "vex", kind: "person", name: "Vex Morrow", tier: "principal", visibility: "secret", agent: true, fields: { place: "home" }, relations: [] },
    jo: { id: "jo", kind: "person", name: "Jo Park", tier: "supporting", agent: true, fields: { place: "home" }, relations: [] },
  };

  test("a hidden person here is in neither the judge's scene nor the brief, and a reason naming them is dropped while the rating stands", async () => {
    const rig = new Rig();
    rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { preset: "full" } } }));
    const chatId = await climbChat(rig, presetAdjudication("balanced"), { rating: 1, reason: "Vex Morrow is watching from the corner, so it is risky" }, {}, people);
    await climbTurn(rig, chatId, "I climb carefully, keeping low.");
    const judged = rig.host.quietCalls.find((r) => r.messages.some((m) => m.content.includes("Rate the approach")));
    expect(judged?.messages.at(-1)?.content).toContain('"present":["Jo Park"]');
    const brief = rig.host.quietCalls.find((r) => r.messages[0]?.content.includes("You brief a roleplay narrator"));
    expect(brief?.messages.at(-1)?.content).toContain("Present:\nJo Park\n");
    for (const r of rig.host.quietCalls) expect(JSON.stringify(r.messages)).not.toContain("Vex Morrow");
    const roll = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "roll");
    expect(roll?.detail).toContain("Your approach: 1 of 2.");
    expect(roll?.detail ?? "").not.toContain("Vex");
    const chain = toChain(await rig.host.chats.messages(chatId, rig.host.userId));
    const adjudged = chain.flatMap((m) => Object.values(m.ledger?.swipes ?? {}).flatMap((r) => r.events)).find((e) => e.type === "engine.adjudged");
    expect(adjudged).toMatchObject({ data: { rating: 1, reason: "" } });
  });

  /** The reason a judged climb kept, with the hidden Vex and Dan (and `extra`'s people and places) where the POV is. */
  const keptReason = async (reason: string, extra: { lore?: Record<string, JsonObject>; people?: Record<string, JsonObject>; places?: Record<string, JsonObject> } = {}): Promise<unknown> => {
    const rig = new Rig();
    const dan: JsonObject = { id: "dan", kind: "person", name: "Dan", tier: "background", visibility: "secret", fields: { place: "home" }, relations: [] };
    const chatId = await climbChat(rig, presetAdjudication("balanced"), { rating: 1, reason }, extra.lore, { ...people, dan, ...extra.people }, extra.places);
    await climbTurn(rig, chatId, "I climb carefully, keeping low.");
    const chain = toChain(await rig.host.chats.messages(chatId, rig.host.userId));
    const adjudged = chain.flatMap((m) => Object.values(m.ledger?.swipes ?? {}).flatMap((r) => r.events)).find((e) => e.type === "engine.adjudged");
    return adjudged && "data" in adjudged ? adjudged.data.reason : undefined;
  };

  test("a reason is read word for word: a hidden person's first name drops it, a hidden Dan doesn't drop 'dangerous'", async () => {
    expect(await keptReason("Vex is watching from the corner, so it is risky")).toBe("");
    expect(await keptReason("The ledge looks dangerous, but it holds")).toBe("The ledge looks dangerous, but it holds");
  });

  test("a hidden name written without spaces or inflected drops the reason; a secret place counts only by all its words", async () => {
    const hidden = (id: string, name: string): JsonObject => ({ id, kind: "person", name, tier: "background", visibility: "secret", fields: { place: "home" }, relations: [] });
    const people = { li_lei: hidden("li_lei", "李雷"), veks: hidden("veks", "Векс") };
    expect(await keptReason("李雷在监视你", { people })).toBe("");
    expect(await keptReason("За Вексом наблюдают, лезь тише", { people })).toBe("");
    const places = { crypt: { id: "crypt", name: "Under the Chapel", fields: {}, visibility: "secret" } };
    expect(await keptReason("You slip under the guard's arm, quick and low", { places })).toBe("You slip under the guard's arm, quick and low");
    expect(await keptReason("Whoever waits under the chapel will hear you", { places })).toBe("");
  });

  test("a reason that names a secret lore entry by its title is dropped", async () => {
    const lore = { rot: { id: "rot", title: "Rotten mortar", content: "The east wall was never repointed after the flood, and it crumbles under any weight.", keys: ["wall"], links: [], secret: true, gate: "self.cash > 100000", audience: ["judge"] } };
    expect(await keptReason("Rotten mortar makes this climb risky", { lore })).toBe("");
  });

  test("a person is named by any word of their name; a place, a thing, a label or a title only by all its words in order", () => {
    expect(namesAny("Vex's knife glints", ["Vex Morrow"])).toBe(true);
    expect(namesAny("Morrow's men are near", ["Vex Morrow"])).toBe(true);
    expect(namesAny("It looks dangerous", ["Dan"])).toBe(false);
    // A word in another script counts anywhere in the text: no spaces, a vowel sign, an inflection.
    expect(namesAny("李雷在监视你", ["李雷"])).toBe(true);
    expect(namesAny("राम देख रहा है", ["राम"])).toBe(true);
    expect(namesAny("За Вексом наблюдают", ["Векс"])).toBe(true);
    expect(namesAny("Он смотрит на дверь", ["Векс"])).toBe(false);
    // Anything else: all its words in order, with words like "the" and "of" left aside.
    expect(namesAny("You slip under the guard's arm, quick and low", [], ["Under the Chapel"])).toBe(false);
    expect(namesAny("The chapel steps are slick", [], ["Under the Chapel"])).toBe(false);
    expect(namesAny("Someone waits under a chapel", [], ["Under the Chapel"])).toBe(true);
    expect(namesAny("The vault is dark", [], ["The Vault of Sorrows"])).toBe(false);
    expect(namesAny("Past the vault of the sorrows", [], ["The Vault of Sorrows"])).toBe(true);
    expect(namesAny("He means to poison the mayor", [], ["Poison the mayor"])).toBe(true);
    expect(namesAny("The mayor frowns", [], ["Poison the mayor"])).toBe(false);
    expect(namesAny("他在龙门客栈等你", [], ["龙门 客栈"])).toBe(true);
    expect(namesAny("The brass key glints", [], ["Silver Key"])).toBe(false);
  });
});
