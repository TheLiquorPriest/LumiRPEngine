import { describe, expect, test } from "bun:test";
import type { WorldDoc } from "../../src/shared/world";
import { playtestStart, playtestTurn } from "../../src/engine/authoring";
import { createRegistry } from "../../src/engine/registry-impl";
import { placeOfEntity, kindIs } from "../../src/engine/scope";
import { playerKnows } from "../../src/engine/player-events";
import { planTurn, postTurn } from "../../src/engine/turn";
import { typedIntent } from "../../src/engine/typed-intent";
import { initialState } from "../../src/engine/world-state";
import { ALL_PACKS, STARTER_WORLDS } from "../../src/packs/index";
import { checkWorld, playtest } from "../../src/studio-api";

const reg = createRegistry(ALL_PACKS);
const portAlder = (): WorldDoc => (STARTER_WORLDS.modern_slice_of_life as (id: string, name: string) => WorldDoc)("w", "Port Alder");

describe("typed intent (Playtest, no model)", () => {
  test("the longest lexicon phrase picks the action; names fill its refs, the rest its text", () => {
    const world = portAlder();
    const state = initialState(world, "r", reg);
    expect(typedIntent(reg, world, state, "I walk to the marina")).toMatchObject({ action: "go", params: { to: "alder_harbor_marina" } });
    expect(typedIntent(reg, world, state, "I buy a coffee")?.params).toMatchObject({ item: "coffee" });
    expect(typedIntent(reg, world, state, "Hmm.")).toBeNull();
  });

  test("Playtest turns act on the typed text and read as the player sees them", () => {
    const run = playtest(portAlder(), ["I walk to the marina"]);
    const turn = run.turns[0];
    expect(turn?.notes).toContain("read as Go to");
    expect(turn?.reply).toContain("You → Alder Harbor Marina");
    expect(turn?.reply).not.toMatch(/alder_harbor_marina|pov money detail/);
  });

  test("a lexicon phrase said with filler words inside it ('walk down to') still picks the action", () => {
    const world = portAlder();
    const state = initialState(world, "r", reg);
    expect(typedIntent(reg, world, state, "I walk down to Bluebird Coffee")).toMatchObject({ action: "go", params: { to: "bluebird_coffee" } });
    expect(typedIntent(reg, world, state, "I head back over to the marina")).toMatchObject({ action: "go", params: { to: "alder_harbor_marina" } });
    // 'walk over to' is also the grid step's phrase, but no square is said: the move whose place is named wins.
    expect(typedIntent(reg, world, state, "I walk over to Bluebird Coffee")).toMatchObject({ action: "go", params: { to: "bluebird_coffee" } });
    expect(typedIntent(reg, world, state, "I sit down to think")).toBeNull();
  });

  test("a phrase only counts when the player does it: no negation, other subject, hypothetical or idiom", () => {
    const world = portAlder();
    const state = initialState(world, "r", reg);
    for (const line of [
      "I don't want to walk to the market",
      "Danny says he'll walk over to the marina",
      "I pay attention",
      "I wonder whether to buy a boat",
      "I never walk to the marina",
      "Danny will walk to the marina",
      "I ask Danny to walk to the marina",
      "I tell her to buy a coffee",
      "I might buy a boat",
      "I'm thinking about whether I should buy a boat",
      "If I had the money, I'd buy a boat",
      "I take a deep breath",
    ])
      expect({ line, intent: typedIntent(reg, world, state, line) }).toEqual({ line, intent: null });
  });

  test("first person and bare commands still act, around negations and other people in other clauses", () => {
    const world = portAlder();
    const state = initialState(world, "r", reg);
    const go = { action: "go", params: { to: "alder_harbor_marina" } };
    for (const line of ["Walk to the marina", "Then I walk to the marina", "Let's walk to the marina", "I want to walk to the marina", "Danny and I walk to the marina", "I meet Danny and walk to the marina", "I'm not hungry, so I walk to the marina", "Danny stays. I walk to the marina"])
      expect({ line, intent: typedIntent(reg, world, state, line) }).toMatchObject({ line, intent: go });
    expect(typedIntent(reg, world, state, "I'd like to buy a coffee")).toMatchObject({ action: "buy", params: { item: "coffee" } });
    expect(typedIntent(reg, world, state, "I pay Danny 20")).toMatchObject({ action: "pay", params: { to: "danny_okafor" } });
    // A phrase that names its own subject or negation still reads.
    expect(typedIntent(reg, world, state, "I can't find my wallet")?.action).toBe("lose");
  });

  test("Playtest leaves the player where they are for a negated move", () => {
    const world = portAlder();
    const start = playtestStart(reg, world, "r");
    const before = placeOfEntity(start, world.pov);
    const turn = playtestTurn(reg, { plan: planTurn, post: postTurn }, world, start, "I don't want to walk to the market.", "run", 0);
    expect(placeOfEntity(turn.state, world.pov)).toBe(before);
    expect(turn.turn.notes).not.toContain("read as Go to");
  });

  test("typed moves in Playtest move the player: 'walk down to Bluebird Coffee', then 'walk over to Alder Market'", () => {
    const world = portAlder();
    const start = playtestStart(reg, world, "r");
    expect(placeOfEntity(start, world.pov)).not.toBe("bluebird_coffee");
    const first = playtestTurn(reg, { plan: planTurn, post: postTurn }, world, start, "I walk down to Bluebird Coffee.", "run", 0);
    expect(placeOfEntity(first.state, world.pov)).toBe("bluebird_coffee");
    expect(first.turn.notes).toContain("read as Go to");
    expect(first.turn.reply).toContain("You → Bluebird Coffee");
    const second = playtestTurn(reg, { plan: planTurn, post: postTurn }, world, first.state, "I walk over to Alder Market.", "run", 1);
    expect(placeOfEntity(second.state, world.pov)).toBe("alder_market");
    expect(second.turn.notes).toContain("read as Go to");
  });

  test("Check world's transcript is the author's view: every event worded with names, an unmet person's included, no ids or bookkeeping", () => {
    const world = portAlder();
    // Priya Nair goes about her day off-screen; here the player has never met her.
    const pov = world.entities[world.pov];
    const priya = world.entities.priya_nair;
    if (!pov || !priya) throw new Error("no POV or Priya");
    pov.relations = pov.relations.filter((r) => r.to !== "priya_nair");
    priya.relations = priya.relations.filter((r) => r.to !== world.pov);
    const ids = [...Object.keys(world.places), ...Object.keys(world.entities)].filter((id) => id.includes("_"));
    const start = playtestStart(reg, world, "r");
    const unmet = Object.entries(start.entities).filter(([id, e]) => id !== world.pov && kindIs(reg, world, e.kind, "person") && !playerKnows(world, start, world.pov, id)).map(([, e]) => e.name);
    expect(unmet).toContain("Priya Nair");
    const turns = checkWorld(world, 2).turns;
    for (const turn of turns) {
      expect(turn.reply.length).toBeGreaterThan(0);
      for (const id of ids) expect(turn.reply).not.toContain(id);
      expect(turn.reply).not.toMatch(/pov money detail|is now [a-z]+_[a-z_]+/);
    }
    expect(unmet.some((name) => turns.some((t) => t.reply.includes(name)))).toBe(true);
  });
});
