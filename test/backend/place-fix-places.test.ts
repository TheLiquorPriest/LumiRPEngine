// The place ✎ fixes' places (DESIGN §12, §7): the place sheet on Play gets exactly the places the
// POV may know, each with its path and parent through known places only, cut at the first it may
// not know, and none says how hidden it really is.

import { describe, expect, test } from "bun:test";
import { knownPlaceRefs } from "../../src/engine/character";
import type { JsonObject } from "../../src/shared/json";
import type { WorldDoc } from "../../src/shared/world";
import { Rig } from "../support/rig";

describe("the place fix's places", () => {
  test("Play's place sheet never names a place the POV may not know, in a path, a parent or a row", async () => {
    const rig = new Rig({ shipped: true });
    const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
    const put = async (id: string, value: JsonObject): Promise<void> => void rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "places", id, value }));
    // A secret den with a public back room inside it, and a public cellar under the den's room.
    await put("smugglers_den", { id: "smugglers_den", name: "Smugglers' Den", parent: "port_alder", visibility: "secret", fields: {} });
    await put("den_back_room", { id: "den_back_room", name: "Back room", parent: "smugglers_den", fields: {} });
    await put("den_cellar", { id: "den_cellar", name: "Cellar", parent: "den_back_room", fields: {} });
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "move", entity: "pov", to: "alder_automotive" }] }));
    const view = await rig.rt.view(chatId, rig.host.userId);
    const fix = view.hud?.fixes.place;
    const places = fix?.places ?? [];
    expect(places.length).toBeGreaterThan(0);
    // Exactly the places the fix offers.
    expect(places.map((p) => p.id).sort()).toEqual((fix?.options ?? []).map((o) => String(o.value)).sort());
    const offered = new Set(places.map((p) => p.id));
    const hidden = ["smugglers_den", "den_back_room", "den_cellar"];
    const hiddenNames = ["Smugglers' Den", "Back room", "Cellar"];
    for (const p of places) {
      expect(hidden).not.toContain(p.id);
      expect(p.path.filter((name) => hiddenNames.includes(name))).toEqual([]);
      if (p.parent !== null) expect(offered.has(p.parent)).toBe(true);
      // Play never says how hidden a place is.
      expect(p.visibility).toBe("public");
    }
    // A known place's path reads through the known places around it, outermost first.
    expect(places.find((p) => p.id === "alder_automotive")?.path).toEqual(["Lakeshore County", "Port Alder"]);
  });

  test("a path stops at the first place around it the POV may not know, and its parent goes with it", () => {
    const world = { places: { town: { id: "town", name: "Town", fields: {} }, manor: { id: "manor", name: "The Manor", parent: "town", fields: {} }, vault: { id: "vault", name: "Vault", parent: "manor", fields: {} }, square: { id: "square", name: "Square", parent: "town", fields: {} } } } as unknown as Pick<WorldDoc, "places">;
    const refs = knownPlaceRefs(world, (id) => id !== "manor");
    expect(refs.map((r) => r.id)).toEqual(["square", "town", "vault"]);
    expect(refs.find((r) => r.id === "vault")).toMatchObject({ path: [], parent: null });
    expect(refs.find((r) => r.id === "square")).toMatchObject({ path: ["Town"], parent: "town" });
  });
});
