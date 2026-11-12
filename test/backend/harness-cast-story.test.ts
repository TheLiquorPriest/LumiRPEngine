// The two moves of the game master's that had no tool, a thing put away (`item_away`) and something
// taken out of what holds it (`gm_take_out`); and the map's Walk here, played through the bridge's
// own turn.

import { describe, expect, test } from "bun:test";
import { renderPrompt } from "../../src/backend/prompts";
import { HARNESS_AGENT } from "../../src/shared/harness-texts";
import { STORY_NOTE, STORY_TOOL } from "../../src/shared/harness-texts-story";
import type { WorldDoc } from "../../src/shared/world";
import { blankWorld, migrateWorld } from "../../src/engine/authoring";
import { placeOfEntity } from "../../src/engine/scope";
import { decodeMapView } from "../../src/packs/space/ui/view";
import { modernUsWorld } from "../packs/riverton";
import { Rig } from "../support/rig";
import { HOME } from "../support/tools";
import { guardModel, MARA, noModelCalls, turnChat } from "./harness-cast-kit";
import { type Agent, AUTHOR, beginTurn, mount, playOn, stateOf } from "./harness-driver";

const GM: Agent = { id: "gm-1", role: HARNESS_AGENT.gm };

/** The garage across town. */
const GARAGE = "alder_automotive";

const note = (id: string, vars: Record<string, string> = {}): string => renderPrompt(id, {}, vars);

describe("a thing put away, and something taken out of what holds it", () => {
  test("in a turn the author takes a thing out of someone's hands and puts it back where it is kept, each landing with its commit", async () => {
    const { rig, chatId } = await turnChat();
    const turn = await beginTurn(rig, chatId, "I ask Mara where the tin whistle went.");
    await turn.answer(AUTHOR, "time_clock");
    /** Where the whistle is: the place it lies at, and who or what holds it. */
    const whistle = async (): Promise<{ place: string | null; held: string | null }> => {
      const state = await stateOf(rig, chatId);
      const [id, thing] = Object.entries(state.entities).find(([, e]) => e.name === "tin whistle") ?? [];
      return { place: id === undefined ? null : placeOfEntity(state, id), held: thing?.relations.find((r) => r.type === "in")?.to ?? null };
    };
    // Made at the garage, so that is where it is kept; then Mara pockets it at home.
    await turn.answer(AUTHOR, "item_make", { name: "tin whistle", at: GARAGE, why: "It hangs by the garage door." });
    await turn.answer(AUTHOR, "item_move", { item: "tin whistle", in: "Mara", why: "Mara pockets it." });
    await turn.answer(AUTHOR, "commit");
    await turn.finish("Mara turns out her pockets.");
    expect(await whistle()).toEqual({ place: HOME, held: MARA });
    const next = await beginTurn(rig, chatId, "I hold out my hand for it.");
    await next.answer(AUTHOR, "time_clock");
    // Taken out, it lies where she stands.
    await next.answer(AUTHOR, STORY_TOOL.takeOut, { entity: "tin whistle" });
    expect(await next.answer(AUTHOR, "commit")).toMatchObject({ committed: { refused: [], review: [] } });
    // Nothing holds it now, and the engine says so.
    expect(JSON.parse(await next.refusal(AUTHOR, STORY_TOOL.takeOut, { entity: "tin whistle" }))).toMatchObject({ refused: { code: "not_inside" } });
    // Put away, it is back where it is kept; there already, there is nothing to move.
    expect(await next.answer(AUTHOR, STORY_TOOL.away, { item: "tin whistle", why: "Back on its hook." })).toMatchObject({ staged: { changeType: "item_move" } });
    expect(await next.answer(AUTHOR, "commit")).toMatchObject({ committed: { refused: [], review: [] } });
    expect(await next.refusal(AUTHOR, STORY_TOOL.away, { item: "tin whistle", why: "Back on its hook." })).toBe(note(STORY_NOTE.awayNowhere, { name: "tin whistle" }));
    await next.finish("It goes back on its hook.");
    expect(await whistle()).toEqual({ place: GARAGE, held: null });
    noModelCalls(rig);
  });
});

/** A small inn with the grid system on: a taproom the player character starts in, a kitchen through a door, and walls no one walks. */
function inn(): WorldDoc {
  const w = blankWorld("w_inn", "Inn");
  // A chat runs only the packs its world turns on: Riverton's, the space pack among them.
  w.packs = structuredClone(modernUsWorld("w", "R").packs);
  w.mapSettings = { display: "fog", grid: { movement: true, sightRadius: 2 } };
  w.places = { town: { id: "town", name: "Saltmarsh", fields: {} }, inn: { id: "inn", name: "The Gull", parent: "town", fields: {} } };
  w.maps = { inn_ground: { id: "inn_ground", scope: "inn", layout: ["#########", "#ttt#kkk#", "#ttt+kkk#", "#########"], legend: { t: { place: "taproom" }, k: { place: "kitchen" } }, places: [{ id: "taproom", name: "Taproom" }, { id: "kitchen", name: "Kitchen" }] } };
  w.start = { ...w.start, place: "taproom" };
  const you = w.entities[w.pov];
  if (you) you.fields.place = "taproom";
  return migrateWorld(w);
}

describe("Walk here", () => {
  test("checks_odds answers what the map's Walk here asks, cell for cell, and action_play walks there", async () => {
    const rig = guardModel(new Rig({ shipped: true }));
    const imported = rig.body(await rig.send({ type: "lre.world", op: "import", file: { format: "lre-world-export-v1", world: inn() } })) as { world: { id: string } };
    const chatId = rig.host.createChat("Evening.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId: imported.world.id, chatId }));
    mount(rig);
    await playOn(rig, chatId, "harness");
    const turn = await beginTurn(rig, chatId, "I cross to the kitchen.");
    await turn.answer(AUTHOR, "time_clock");
    // A cell of the kitchen through the door, one of the taproom, and a wall.
    const kitchen = { x: 6, y: 1 };
    let walkable = 0;
    for (const cell of [kitchen, { x: 1, y: 2 }, { x: 4, y: 1 }]) {
      const walk = (rig.body(await rig.send({ type: "lre.map", op: "walk", chatId, ...cell })) as { walk?: { minutes: number; disabled?: string } }).walk;
      const odds = await turn.answer(GM, "checks_odds", { action: "step", params: JSON.stringify(cell) });
      expect({ cell, walk: odds.available === true ? { minutes: odds.minutes } : "no" }).toEqual({ cell, walk: walk?.disabled === undefined ? { minutes: walk?.minutes } : "no" });
      if (odds.available === true) walkable += 1;
    }
    expect(walkable).toBe(2);
    await turn.answer(AUTHOR, "action_play", { action: "step", params: JSON.stringify(kitchen) });
    await turn.answer(AUTHOR, "commit");
    await turn.finish("The kitchen is warm.");
    expect(decodeMapView((await rig.rt.view(chatId, rig.host.userId)).panels["space.map"])?.scopes.find((s) => s.grid?.pov)?.grid?.pov).toEqual(kitchen);
    noModelCalls(rig);
  });
});
