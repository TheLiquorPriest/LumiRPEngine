// The engine as the Author reaches it through the harness (plan §6.8, §6.9, §8.2): its list holds the
// tools it uses every turn, and any other engine tool is found with `tool_search` and called with
// `tool_use`, then recorded in the store as a call of its own would be; and the world state in its
// briefing shows the map of a place the scene needs. Played through the stand-in Lumiverse on the
// scripted model, on a chat that plays an invented world whose revision the store keeps (`putWorld`),
// as the composed application opens it. Every name is invented.

import { afterEach, expect, test } from "bun:test";
import { hashJson } from "../../src/shared/hash";
import type { WorldDoc } from "../../src/shared/world";
import { INN, worldWith } from "../iface/map/fixtures";
import { world } from "../iface/rig";
import { CHAT, CONNECTION, openTurnBed, playsWorld, PRESET, replying, settledTurn, type TurnBed, type TurnBedOptions, USER } from "./bed";

const beds: TurnBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

/** A bed whose chat plays `doc`, kept by the store, from before its first turn. */
async function worldBed(doc: WorldDoc, options: TurnBedOptions): Promise<TurnBed> {
  // The reminder of writes that name no source would ask for calls these tests do not script.
  const b = await openTurnBed({ off: ["rules/unsourced"], ...options });
  beds.push(b);
  await playsWorld(b, doc);
  return b;
}

/** The player says something and asks for a reply; gives the turn once it is settled. */
async function play(b: TurnBed, said: string) {
  b.host.send(CHAT, said);
  const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
  expect(out.error).toBeNull();
  return await settledTurn(b, out.generationId!);
}

test("the Author finds an engine tool outside its list with tool_search, calls it with tool_use, and the store records the change", async () => {
  const b = await worldBed(world(), {
    answers: [
      { pieces: [{ text: "<intent>Tam does not live through the night.</intent>" }, { call: "tool_search", args: { words: "someone's life state" } }] },
      { pieces: [{ call: "tool_use", args: { name: "gm_set_life", args: { person: "Tam", state: "dead", source: { from: "author" } } } }] },
      { pieces: [{ text: "<reply>The market bell tolls for Tam.</reply>" }] },
    ],
  });
  const turn = await play(b, "I ask after Tam.");

  expect(b.model.requests[0]!.tools.map((t) => t.name)).not.toContain("gm_set_life");
  expect(JSON.stringify(b.model.requests[1]!.messages)).toContain("gm_set_life");
  expect(b.turns.store.user(USER).stateAt(turn.id).state.world.entities.tam?.life).toBe("dead");
});

test("a chat on a world revision the store keeps still takes an engine change once RPE has started again on the same data", async () => {
  const b = await worldBed(world(), {
    answers: [
      { pieces: [{ text: "<intent>Bram does not live through the night.</intent>" }, { call: "tool_search", args: { words: "someone's life state" } }] },
      { pieces: [{ call: "tool_use", args: { name: "gm_set_life", args: { person: "Bram", state: "dead", source: { from: "author" } } } }] },
      { pieces: [{ text: "<reply>The bar stands empty tonight.</reply>" }] },
    ],
  });
  await b.restart();
  const turn = await play(b, "I ask after Bram.");

  const state = b.turns.store.user(USER).stateAt(turn.id).state.world;
  expect(state.revision).toBe(hashJson(world()));
  expect(state.entities.bram?.life).toBe("dead");
});

test("once the scene needs a place that has a map, the next turn's world state shows that map", async () => {
  const b = await worldBed(worldWith(INN), {
    answers: [
      { pieces: [{ text: "<intent>The scene is the common room.</intent>" }, { call: "world_apply", args: { operations: [{ op: "horizon", list: ["common_room"], source: { from: "author" } }] } }] },
      { pieces: [{ text: "<reply>The common room is warm and loud.</reply>" }] },
      replying("Bram wipes down the bar."),
    ],
  });
  await play(b, "I step into the inn.");
  await play(b, "I look for a seat.");

  // A row of the room as the map prints it, under the room in the world state.
  const briefing = JSON.stringify(b.model.requests[2]!.messages);
  expect(briefing).toContain("## World state");
  expect(briefing).toContain("# . . B B B . . . .  .  #");
});

/** The invented world, where Tam keeps the market from nine and the common room from five. */
function scheduledWorld(): WorldDoc {
  const doc = world();
  doc.schedules = {
    tam_day: { id: "tam_day", owner: "tam", target: "place", recurrence: { every: "day" }, slots: [{ start: "09:00", end: "17:00", value: "market_square" }, { start: "17:00", end: "22:00", value: "common_room" }] },
  };
  return doc;
}

test("what time brings due is listed in the world state the Author is given, and in the answer of a query that asks for it", async () => {
  const b = await worldBed(scheduledWorld(), {
    answers: [
      { pieces: [{ text: "<intent>See what the day holds.</intent>" }, { call: "world_query", args: { at: "thornbury", depth: 1, due: "six hours" } }] },
      { pieces: [{ text: "<reply>Tam packs his stall.</reply>" }] },
    ],
  });
  await play(b, "I ask Tam about his day.");

  expect(JSON.stringify(b.model.requests[0]!.messages)).toContain("9:00 AM: place at Market Square, Tam (tam_day)");
  const answered = JSON.stringify(b.model.requests[1]!.messages.at(-1));
  expect(answered).toContain("tam_day");
  expect(answered).toContain("market_square");
});
