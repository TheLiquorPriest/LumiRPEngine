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
import { CHAT, CONNECTION, openTurnBed, PRESET, replying, settledTurn, type TurnBed, type TurnBedOptions, USER } from "./bed";

const beds: TurnBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

/** A bed whose chat plays `doc`: the store keeps the world's revision, and the chat plays it from before its first turn. */
async function worldBed(doc: WorldDoc, options: TurnBedOptions): Promise<TurnBed> {
  const b = await openTurnBed(options);
  beds.push(b);
  const revision = hashJson(doc);
  const store = b.turns.store.user(USER);
  await b.app.writes.run(() => {
    store.putWorld(revision, doc);
    store.createChat({ id: CHAT, world: doc.id, revision });
  });
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

test("a search pattern that could run without end is refused before it runs, in the harness's own words; a plain one is searched for", async () => {
  const b = await openTurnBed({
    answers: [
      { pieces: [{ text: "<intent>Look through the notes.</intent>" }, { call: "file_find", args: { by: "grep", pattern: "(a+)+$" } }] },
      { pieces: [{ call: "file_find", args: { by: "grep", pattern: "Author" } }] },
      { pieces: [{ text: "<reply>Wren shrugs.</reply>" }] },
    ],
  });
  beds.push(b);
  await play(b, "I ask about the notes.");

  const sent = b.model.requests.map((r) => JSON.stringify(r.messages));
  expect(sent[1]).toContain("(a+)+$ is not a pattern that can be searched for.");
  expect(sent[2]).not.toContain("Author is not a pattern");
});
