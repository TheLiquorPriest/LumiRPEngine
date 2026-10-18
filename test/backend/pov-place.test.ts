// The POV's place on the player's surfaces (DESIGN §7): a place it can't see, even the one it stands
// in, is "Somewhere" with no id wherever the player or the narrator reads it, while a `known_by`
// place it is anywhere inside keeps its name. Walk here takes its way and minutes from the backend,
// which walks the real ground where the page's map is fogged.

import { describe, expect, test } from "bun:test";
import { findPath, gridMinutes } from "../../src/shared/grid";
import type { JsonObject } from "../../src/shared/json";
import type { WorldDoc } from "../../src/shared/world";
import { blankWorld, migrateWorld } from "../../src/engine/authoring";
import { createRegistry } from "../../src/engine/registry-impl";
import { actionOdds, paramCandidates, resolveAction } from "../../src/engine/resolve";
import { createRng } from "../../src/engine/rng";
import { canSeePlace, HIDDEN_PLACE_NAME, povPlace } from "../../src/engine/visibility";
import { Working } from "../../src/engine/working";
import { initialState } from "../../src/engine/world-state";
import { ALL_PACKS } from "../../src/packs/index";
import { buildCastView } from "../../src/packs/castlife/core/index";
import { buildGarageView } from "../../src/packs/vehicles/core/view";
import { buildMapView } from "../../src/packs/space/core/view";
import { decodeMapView } from "../../src/packs/space/ui/view";
import { factLines } from "../../src/backend/turn-steps";
import { toChain } from "../../src/backend/ledger-io";
import { sceneType, tickMinutes } from "../../src/engine/time";
import { modernUsWorld } from "../packs/riverton";
import { startState } from "../packs/support";
import { Rig } from "../support/rig";
import { POV } from "../support/test-pack";

const reg = createRegistry(ALL_PACKS);

describe("a secret place the POV stands in", () => {
  test("is Somewhere, with no id, on the HUD pill, Scene, the place ✎ and the sheet", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    const { draft } = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId, base: null })) as { draft: { entities: Record<string, JsonObject & { fields: JsonObject }> } };
    const put = async (collection: string, id: string, value: JsonObject) => rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection, id, value }));
    await put("places", "vault", { id: "vault", name: "The Vault of Sorrows", fields: {}, visibility: "secret" });
    const pov = draft.entities[POV];
    if (!pov) throw new Error("no POV");
    await put("entities", POV, { ...pov, fields: { ...pov.fields, place: "vault" } });
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    const chatId = rig.host.createChat("Morning, Sam.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    const view = await rig.rt.view(chatId, rig.host.userId);
    expect(view.hud?.place).toEqual({ id: null, name: HIDDEN_PLACE_NAME });
    expect(view.scene?.placeId).toBeNull();
    // The ✎ can move the POV to a place it knows, but never names or offers the hidden one.
    expect(view.hud?.fixes.place?.value).toBeNull();
    expect(view.hud?.fixes.place?.options?.some((o) => o.value === "vault")).toBe(false);
    expect(JSON.stringify(view)).not.toContain("Vault of Sorrows");
  });

  test("is somewhere in the facts the narrator's helpers read, and a room inside it is as hidden", () => {
    const world = modernUsWorld("w", "R");
    world.places.safehouse = { id: "safehouse", name: "Resistance safehouse", parent: "riverton", fields: {}, visibility: "secret" };
    world.places.cellar_room = { id: "cellar_room", name: "Cellar room", parent: "safehouse", fields: {} };
    const state = startState(world);
    for (const place of ["safehouse", "cellar_room"]) {
      state.entities[world.pov]!.fields.place = place;
      const facts = factLines(reg, world, state, []).join("\n");
      expect(facts).toContain(" is somewhere;");
      expect(facts).not.toContain("safehouse");
      expect(facts).not.toContain("Cellar room");
    }
  });

  test("is Somewhere in Cast, the Garage and the narrator's vehicles line, where a place the POV sees keeps its name", () => {
    const world = modernUsWorld("w", "R");
    world.places.hideout = { id: "hideout", name: "The Smugglers' Hideout", parent: "riverton", fields: {}, visibility: "secret" };
    const state = startState(world);
    for (const id of [world.pov, "maya", "truck"]) state.entities[id]!.fields.place = "hideout";
    state.entities.truck!.fields.home = "hideout";
    const ctx = reg.context(world, state);
    const cast = buildCastView(ctx);
    const garage = buildGarageView(ctx);
    const facts = factLines(reg, world, state, []);
    expect(cast.people.find((p) => p.id === "maya")?.place).toBe(HIDDEN_PLACE_NAME);
    expect(garage.vehicles.find((v) => v.id === "truck")).toMatchObject({ place: HIDDEN_PLACE_NAME, home: HIDDEN_PLACE_NAME });
    expect(facts.some((l) => l.startsWith("Pickup truck: somewhere,"))).toBe(true);
    expect(JSON.stringify([cast, garage, facts])).not.toContain("Smugglers");
    // Back in the building's garage, the truck's place is named again; only its home base isn't.
    state.entities.truck!.fields.place = "garage";
    expect(buildGarageView(reg.context(world, state)).vehicles.find((v) => v.id === "truck")).toMatchObject({ place: "Building garage", home: HIDDEN_PLACE_NAME });
    expect(factLines(reg, world, state, []).some((l) => l.startsWith("Pickup truck: at Building garage,"))).toBe(true);
  });
});

describe("a place the POV is inside", () => {
  /** Riverton with a kitchen and a bedroom in Maya's flat, which the POV knows of only by being there. */
  function mayaFlat(): WorldDoc {
    const world = modernUsWorld("w", "R");
    world.places.maya_kitchen = { id: "maya_kitchen", name: "Maya's kitchen", parent: "maya_flat", fields: {} };
    world.places.maya_bedroom = { id: "maya_bedroom", name: "Maya's bedroom", parent: "maya_flat", fields: {} };
    world.entities[world.pov]!.fields.place = "maya_flat";
    return world;
  }

  test("walking from Maya's flat into its kitchen keeps the kitchen and the flat named, and the bedroom offered", () => {
    const world = mayaFlat();
    const w = new Working(reg, world, startState(world));
    const go = reg.actions.get("go");
    if (!go) throw new Error("no go action");
    expect(paramCandidates(reg, w.world, w.state, go, "to")).toContain("maya_kitchen");
    expect(resolveAction(reg, w, { action: "go", params: { to: "maya_kitchen" } }, createRng("go")).ok).toBe(true);
    // The HUD pill, Scene, the sheet and the narrator's facts all name it through `povPlace`.
    expect(povPlace(reg, w.world, w.state)).toEqual({ id: "maya_kitchen", name: "Maya's kitchen" });
    expect(factLines(reg, w.world, w.state, [])).toContain("Place: Maya's kitchen (in Maya's flat).");
    const map = buildMapView(w.ctx);
    expect([map.here, map.path, map.scope]).toEqual(["maya_kitchen", ["riverton", "maya_flat", "maya_kitchen"], "maya_flat"]);
    expect(JSON.stringify(map)).not.toContain(HIDDEN_PLACE_NAME);
    expect(map.travel.some((t) => t.to === "maya_bedroom")).toBe(true);
    expect(paramCandidates(reg, w.world, w.state, go, "to")).toContain("maya_bedroom");
    // Out of the flat again, it is someone else's home the POV doesn't know.
    expect(resolveAction(reg, w, { action: "go", params: { to: "cafe" } }, createRng("go:cafe")).ok).toBe(true);
    expect(["maya_flat", "maya_kitchen", "maya_bedroom"].some((id) => canSeePlace(reg, w.world, w.state, w.world.pov, id))).toBe(false);
  });

  test("a secret room in it is still Somewhere: being inside names only what isn't secret", () => {
    const world = mayaFlat();
    world.places.maya_safe_room = { id: "maya_safe_room", name: "Maya's safe room", parent: "maya_flat", fields: {}, visibility: "secret" };
    world.places.maya_closet = { id: "maya_closet", name: "Maya's closet", parent: "maya_safe_room", fields: {} };
    const state = startState(world);
    for (const place of ["maya_safe_room", "maya_closet"]) {
      state.entities[world.pov]!.fields.place = place;
      expect(povPlace(reg, world, state)).toEqual({ id: null, name: HIDDEN_PLACE_NAME });
      expect(["maya_flat", "maya_safe_room", "maya_closet"].map((id) => canSeePlace(reg, world, state, world.pov, id))).toEqual([true, false, false]);
      expect(JSON.stringify(buildMapView(reg.context(world, state)))).not.toContain("safe room");
    }
  });
});

describe("the scene type", () => {
  /** A chat whose POV has these fields, in a world with a secret vault ("ritual"), a cellar inside it ("smuggling") and a public market ("haggling"). */
  async function sceneChat(fields: JsonObject): Promise<{ rig: Rig; chatId: string }> {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    const { draft } = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId, base: null })) as { draft: { entities: Record<string, JsonObject & { fields: JsonObject }> } };
    const put = async (collection: string, id: string, value: JsonObject) => rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection, id, value }));
    await put("places", "vault", { id: "vault", name: "The Vault of Sorrows", fields: {}, visibility: "secret", sceneType: "ritual" });
    await put("places", "cellar", { id: "cellar", name: "Cellar", parent: "vault", fields: {}, sceneType: "smuggling" });
    await put("places", "market", { id: "market", name: "Market", fields: {}, sceneType: "haggling" });
    const pov = draft.entities[POV];
    if (!pov) throw new Error("no POV");
    await put("entities", POV, { ...pov, fields: { ...pov.fields, ...fields } });
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    const chatId = rig.host.createChat("Morning, Sam.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    return { rig, chatId };
  }
  async function sceneFix(fields: JsonObject) {
    const { rig, chatId } = await sceneChat(fields);
    const fix = (await rig.rt.view(chatId, rig.host.userId)).hud?.fixes.scene;
    if (!fix) throw new Error("no scene ✎");
    return fix;
  }
  const offered = (fix: { options?: { value: unknown }[] }): unknown[] => (fix.options ?? []).map((o) => o.value);

  test("the ✎ offers the world's scene types and the visible places' ones, never one only a hidden place has", async () => {
    const fix = await sceneFix({});
    expect(offered(fix)).toEqual(["", "conversation", "action", "exploration", "downtime", "haggling"]);
    expect(fix.options?.[0]?.label).toBe("Place default (Conversation)");
  });

  test("standing in the hidden place, or pinned to its type, the ✎ names that type nowhere", async () => {
    const cases: { fields: JsonObject; placeDefault: string; value: string | null }[] = [
      { fields: { place: "vault" }, placeDefault: "Place default", value: "" },
      { fields: { place: "cellar" }, placeDefault: "Place default", value: "" },
      { fields: { scene: "ritual" }, placeDefault: "Place default (Conversation)", value: null },
    ];
    for (const c of cases) {
      const fix = await sceneFix(c.fields);
      expect(offered(fix)).toEqual(["", "conversation", "action", "exploration", "downtime", "haggling"]);
      expect(fix.options?.[0]?.label).toBe(c.placeDefault);
      // A pinned type the ✎ doesn't offer isn't marked as the current one either.
      expect(fix.value).toBe(c.value);
      expect(JSON.stringify(fix).toLowerCase()).not.toMatch(/ritual|smuggling/);
    }
  });

  test("the Scene row names it only when the POV may know it, else the engine's default scene; the clock still paces by the type in force", async () => {
    const cases: { fields: JsonObject; shown: string; inForce: string }[] = [
      { fields: { place: "market" }, shown: "haggling", inForce: "haggling" },
      { fields: { place: "vault" }, shown: "conversation", inForce: "ritual" },
      { fields: { place: "cellar" }, shown: "conversation", inForce: "smuggling" },
      { fields: { scene: "ritual" }, shown: "conversation", inForce: "ritual" },
      { fields: { place: "vault", scene: "action" }, shown: "action", inForce: "action" },
    ];
    for (const c of cases) {
      const { rig, chatId } = await sceneChat(c.fields);
      const view = await rig.rt.view(chatId, rig.host.userId);
      // The HUD details and Play → Scene read `scene.sceneType`; the time controls mark the tick in force by `controls.time.sceneType`.
      expect([view.scene?.sceneType, view.controls?.time.sceneType]).toEqual([c.shown, c.shown]);
      expect(JSON.stringify({ scene: view.scene, controls: view.controls }).toLowerCase()).not.toMatch(/ritual|smuggling/);
      // Display only: the engine still reads the type in force, and one with no tick of its own paces as the default scene shown.
      const render = (await rig.rt.ledger.core(chatId, rig.host.userId))?.renderState(toChain(await rig.host.chats.messages(chatId, rig.host.userId)));
      if (!render) throw new Error("no head state");
      expect(sceneType(render.world, render.state)).toBe(c.inForce);
      if (c.shown !== c.inForce) {
        const asShown = structuredClone(render.state);
        asShown.entities[POV]!.fields.scene = c.shown;
        expect(tickMinutes(render.world, render.state)).toBe(tickMinutes(render.world, asShown));
      }
    }
  });
});

// A 12 × 7 inn under fog, the grid system on: the taproom the POV starts in, a kitchen through a
// door, and a back hall below a wall the POV hasn't seen yet.
const LAYOUT = ["############", "#ttttt#kkkk#", "#ttttt+kkkk#", "#ttttt#kkkk#", "##+#########", "#hhhhhhhhhh#", "#####+######"];

function inn(): WorldDoc {
  const w = blankWorld("w_inn", "Inn");
  // A chat runs only the packs its world turns on: Riverton's, the space pack among them.
  w.packs = structuredClone(modernUsWorld("w", "R").packs);
  w.mapSettings = { display: "fog", grid: { movement: true, sightRadius: 2 } };
  w.places = { town: { id: "town", name: "Saltmarsh", fields: {} }, inn: { id: "inn", name: "The Gull", parent: "town", fields: {} } };
  w.maps = {
    inn_ground: {
      id: "inn_ground",
      scope: "inn",
      layout: LAYOUT,
      legend: { t: { place: "taproom" }, k: { place: "kitchen" }, h: { place: "hall" } },
      places: [{ id: "taproom", name: "Taproom" }, { id: "kitchen", name: "Kitchen" }, { id: "hall", name: "Back hall" }],
    },
  };
  w.start = { ...w.start, place: "taproom" };
  w.entities.you!.fields.place = "taproom";
  return migrateWorld(w);
}

describe("Walk here", () => {
  test("is judged on the real ground as the step will be, never on the fogged grid the page has", async () => {
    const world = inn();
    const rig = new Rig({ shipped: true });
    const imported = rig.body(await rig.send({ type: "lre.world", op: "import", file: { format: "lre-world-export-v1", world } })) as { world: { id: string } };
    const chatId = rig.host.createChat("Evening.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId: imported.world.id, chatId }));
    const grid = decodeMapView((await rig.rt.view(chatId, rig.host.userId)).panels["space.map"])?.scopes.find((s) => s.grid?.pov)?.grid;
    if (!grid?.pov) throw new Error("no grid with the POV on it");
    // The engine's own judgement of each step, from the same start.
    const state = initialState(world, "seed", reg);
    let fogDiffers = false;
    for (const target of [{ x: 9, y: 2 }, { x: 8, y: 5 }, { x: 10, y: 3 }, { x: 4, y: 4 }]) {
      const odds = actionOdds(reg, world, state, { action: "step", params: target });
      const reply = rig.body(await rig.send({ type: "lre.map", op: "walk", chatId, ...target })) as { walk?: unknown };
      expect(reply.walk).toEqual(odds.available ? { minutes: odds.duration } : { minutes: 0, disabled: "No way there from here." });
      const fogged = findPath(grid, grid.pov, target);
      if (odds.available && (!fogged || gridMinutes(grid, fogged) !== odds.duration)) fogDiffers = true;
    }
    // Under fog the page's grid lacks the walls the POV hasn't seen: it would have said otherwise.
    expect(fogDiffers).toBe(true);
  });

  test("of a cell that isn't a whole number is refused", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    expect((await rig.send({ type: "lre.map", op: "walk", chatId, x: 1.5, y: 2 })).type).toBe("lre.error");
  });
});
