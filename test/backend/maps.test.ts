// Maps in Build (`lre-map-v1`): a map written to the draft compiles there at once, what it draws is
// read-only outside the map, and a committed revision carries the map and what it made.

import { describe, expect, test } from "bun:test";
import { isRecord } from "../../src/shared/json";
import type { MapDoc, WorldDoc } from "../../src/shared/world";
import { Rig } from "../support/rig";

const SHOP: MapDoc = {
  id: "shop",
  scope: "home",
  layout: ["#######", "#ff+bb#", "#######"],
  legend: { f: { place: "front" }, b: { place: "back" } },
  places: [{ id: "front", name: "Shop front" }, { id: "back" }],
  links: [{ from: "front", to: "back", minutes: 1 }],
};

/** The draft an editor reply carries (the backend's own document). */
function draftOf(body: Record<string, unknown>): WorldDoc {
  if (!isRecord(body.draft)) throw new Error("no draft");
  return body.draft as unknown as WorldDoc;
}

describe("maps in the draft", () => {
  test("a map put in the draft compiles at once; what it draws can't be edited or removed outside it; the revision keeps both", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    const put = rig.body(await rig.send({ type: "lre.editor", worldId, base: null, op: "put", collection: "maps", id: "shop", value: SHOP }));
    const draft = draftOf(put);
    expect(draft.places?.front).toMatchObject({ name: "Shop front", parent: "home", map: "shop", cell: { x: 1, y: 1 } });
    expect(draft.places?.home).toMatchObject({ grid: "shop" });
    expect(Object.keys(draft.routes ?? {})).toEqual(["shop:front:back"]);
    const edit = await rig.send({ type: "lre.editor", worldId, base: null, op: "put", collection: "places", id: "front", value: { id: "front", name: "Renamed", fields: {} } });
    expect(edit.type === "lre.error" && edit.message).toBe("places front is drawn by the map shop; edit it there");
    const remove = await rig.send({ type: "lre.editor", worldId, base: null, op: "remove", collection: "routes", id: "shop:front:back" });
    expect(remove.type).toBe("lre.error");
    const forged = await rig.send({ type: "lre.editor", worldId, base: null, op: "put", collection: "places", id: "cellar", value: { id: "cellar", name: "Cellar", fields: {}, map: "shop" } });
    expect(forged.type).toBe("lre.error");
    // Renaming in the map renames the place.
    const renamed = draftOf(rig.body(await rig.send({ type: "lre.editor", worldId, base: null, op: "put", collection: "maps", id: "shop", value: { ...SHOP, places: [{ id: "front", name: "Counter" }, { id: "back" }] } })));
    expect(renamed.places?.front).toMatchObject({ name: "Counter" });
    const committed = rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    expect(typeof committed.revision).toBe("string");
    const head = rig.body(await rig.send({ type: "lre.world", op: "get", worldId }));
    const world = head.world as Record<string, Record<string, unknown>>;
    expect(world.maps?.shop).toBeDefined();
    expect(world.places?.back).toMatchObject({ parent: "home", map: "shop" });
    // Taking the map out takes what it drew.
    const gone = draftOf(rig.body(await rig.send({ type: "lre.editor", worldId, base: null, op: "remove", collection: "maps", id: "shop" })));
    expect(Object.keys(gone.places ?? {})).toEqual(["home"]);
    expect(gone.places?.home?.grid).toBeUndefined();
    expect(gone.routes).toEqual({});
  });
});
