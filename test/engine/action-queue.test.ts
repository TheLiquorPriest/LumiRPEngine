// The action queue within a turn (DESIGN §11): a message's actions play in order in one turn, each
// against the state the one before it left, their times adding up, until the queue stops at a check,
// a failure or an interruption; the plan says how many were left and why.

import { describe, expect, test } from "bun:test";
import type { LedgerEvent } from "../../src/shared/ledger";
import type { WorldDoc } from "../../src/shared/world";
import { applyMarker } from "../../src/engine/events";
import type { WorldState } from "../../src/engine/state";
import { turnElapsed } from "../../src/engine/time";
import { planTurn } from "../../src/engine/turn";
import { baseWorld, fold, POV, registryOf, startState } from "../packs/support";

const reg = registryOf();

/** Sam at home: a 15-minute walk to the cafe, a 5-minute drink that steadies the hands (skill +1), a climb with a check on skill, a splurge Sam can't afford, alarms that raise an incident, one of them hidden, and a trap that leaves Sam dying. */
function queueWorld(): WorldDoc {
  const world = baseWorld();
  world.checks.climb = { id: "climb", dice: "d20", modifier: "self.skill", dc: "12" };
  world.actions.walk = { id: "walk", label: "Walk to the cafe", params: {}, requires: [], outcomes: { default: [{ type: "set", args: { entity: "self", field: "place", value: "cafe" } }] }, duration: "15" };
  world.actions.drink = { id: "drink", label: "Have a drink", params: {}, requires: [], outcomes: { default: [{ type: "add", args: { entity: "self", field: "skill", delta: 1 } }] }, duration: "5" };
  world.actions.climb = { id: "climb", label: "Climb the wall", params: {}, requires: [], check: "climb", outcomes: { success: [], failure: [] }, duration: "10" };
  world.actions.splurge = { id: "splurge", label: "Splurge", params: {}, requires: ["self.cash >= 1000000"], outcomes: { default: [] }, duration: "30" };
  world.actions.alarm = { id: "alarm", label: "Trip the alarm", params: {}, requires: [], outcomes: { default: [{ type: "signal", args: { class: "incident", text: "An alarm goes off." } }] }, duration: "1" };
  world.actions.silent = { id: "silent", label: "Trip a silent alarm", params: {}, requires: [], outcomes: { default: [{ type: "signal", args: { class: "incident", text: "A silent alarm calls the guards.", visibility: "secret" } }] }, duration: "1" };
  world.actions.trap = { id: "trap", label: "Spring the trap", params: {}, requires: [], outcomes: { default: [{ type: "life", args: { entity: "self", to: "dying" } }] }, duration: "1" };
  return world;
}

/** The turn that plays `first` and queues `more` after it, as `interpret` reads a message of several actions. */
function plan(world: WorldDoc, state: WorldState, first: string, ...more: string[]) {
  const intent = { action: first, params: {}, probabilities: { [first]: 1 }, queue: more.map((action) => ({ action, params: {}, text: `I ${action}` })) };
  return planTurn({ registry: reg, world, state, runSeed: "run", seed: "seed", kind: "normal", userTexts: ["typed"], intent });
}

/** Where `e` sits among the plan's pre-reply events. */
function indexIn(events: readonly LedgerEvent[], e: LedgerEvent | undefined): number {
  return events.findIndex((x) => JSON.stringify(x) === JSON.stringify(e));
}

describe("a message's actions in one turn", () => {
  test("play in order, each against the state the one before it left, their events in order and their times added up", () => {
    const world = queueWorld();
    const state = startState(world);
    const p = plan(world, state, "walk", "drink");
    expect(p.resolutions.map((r) => [r.action, r.ok])).toEqual([
      ["walk", true],
      ["drink", true],
    ]);
    expect(p.stopped).toBeNull();
    expect(p.elapsedMinutes).toBe(20);
    expect(fold(reg, world, state, p.events).entities[POV]?.fields.place).toBe("cafe");
    const [walk, drink] = p.resolutions;
    expect(indexIn(p.events, drink?.events[0])).toBeGreaterThan(indexIn(p.events, walk?.events.at(-1)));
    // The same queue on the same seed plans the same turn.
    expect(plan(world, state, "walk", "drink").events).toEqual(p.events);
  });

  test("stop at a check, once it is resolved against what came before: the rest is left", () => {
    const world = queueWorld();
    const state = startState(world);
    const p = plan(world, state, "drink", "climb", "walk");
    expect(p.resolutions.map((r) => r.action)).toEqual(["drink", "climb"]);
    // Sam's skill 2, steadied by the drink first.
    expect(p.resolutions[1]?.check?.modifier).toBe(3);
    expect(p.stopped).toEqual({ left: 1, cause: "check" });
    expect(p.elapsedMinutes).toBe(15);
    expect(fold(reg, world, state, p.events).entities[POV]?.fields.place).toBe("home");
  });

  test("stop at a failure, which adds no time; a first action that fails leaves the turn its scene tick", () => {
    const world = queueWorld();
    const state = startState(world);
    const p = plan(world, state, "walk", "splurge", "drink");
    expect(p.resolutions.map((r) => [r.action, r.ok])).toEqual([
      ["walk", true],
      ["splurge", false],
    ]);
    expect(p.stopped).toEqual({ left: 1, cause: "failure" });
    expect(p.elapsedMinutes).toBe(15);
    expect(fold(reg, world, state, p.events).entities[POV]?.fields.skill).toBe(2);

    const first = plan(world, state, "splurge", "walk");
    expect(first.stopped).toEqual({ left: 1, cause: "failure" });
    expect(first.elapsedMinutes).toBe(turnElapsed(world, state, null).minutes);
  });

  test("stop at an interruption: a signal the POV sees whose class stops a timelapse, never one it can't see", () => {
    const world = queueWorld();
    const stopping = startState(world);
    applyMarker(stopping, { kind: "time", control: "interrupt", scope: { interrupt: "incident" }, to: "stop" });
    const p = plan(world, stopping, "walk", "alarm", "drink");
    expect(p.resolutions.map((r) => r.action)).toEqual(["walk", "alarm"]);
    expect(p.stopped).toEqual({ left: 1, cause: "interruption" });
    expect(plan(world, stopping, "walk", "silent", "drink").stopped).toBeNull();

    const noting = startState(world);
    applyMarker(noting, { kind: "time", control: "interrupt", scope: { interrupt: "incident" }, to: "note" });
    expect(plan(world, noting, "walk", "alarm", "drink").resolutions.map((r) => r.action)).toEqual(["walk", "alarm", "drink"]);
  });

  test("stop when the POV can't act any more: what it does after going down never plays", () => {
    const world = queueWorld();
    const state = startState(world);
    const p = plan(world, state, "walk", "trap", "drink");
    expect(p.resolutions.map((r) => r.action)).toEqual(["walk", "trap"]);
    expect(p.stopped).toEqual({ left: 1, cause: "interruption" });
    expect(fold(reg, world, state, p.events).entities[POV]?.fields.skill).toBe(2);
  });
});
