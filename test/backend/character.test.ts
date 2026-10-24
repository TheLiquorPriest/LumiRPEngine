// `lre.character get` (DESIGN §7, the Character model): Build's scope reads the world's draft, edits
// not yet committed included; the GM scope reads the chat's head, what they're doing now included,
// and is refused for a chat no world is attached to, as `lre.gm` is.

import { describe, expect, test } from "bun:test";
import type { CharacterResult } from "../../src/shared/character";
import type { JsonObject } from "../../src/shared/json";
import { Rig } from "../support/rig";

const MARCUS = "marcus_delgado";

async function alder(): Promise<{ rig: Rig; worldId: string }> {
  const rig = new Rig({ shipped: true });
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  return { rig, worldId };
}

describe("lre.character", () => {
  test("Build's scope reads the draft, a change not yet committed included", async () => {
    const { rig, worldId } = await alder();
    const { draft } = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId, base: null })) as { draft: { entities: Record<string, JsonObject> } };
    const marcus = draft.entities[MARCUS];
    if (!marcus) throw new Error("fixture");
    rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "entities", id: MARCUS, value: { ...marcus, fields: { ...(marcus.fields as JsonObject), role: "Harbor pilot" } } }));
    const got = rig.body(await rig.send({ type: "lre.character", op: "get", entity: MARCUS, scope: "build", worldId })) as unknown as CharacterResult;
    expect(got.character.sections.flatMap((s) => s.fields).find((f) => f.id === "role")?.value).toBe("Harbor pilot");
    expect(got.character.now).toBeUndefined();
    expect(got.places.find((p) => p.id === "birch_lane_12")?.path).toEqual(["Lakeshore County", "Port Alder"]);
    expect((await rig.send({ type: "lre.character", op: "get", entity: "pov_truck_bed", scope: "build", worldId })).type).toBe("lre.error");
  });

  test("the GM scope reads the chat as it stands, and is refused for a chat with no world", async () => {
    const { rig, worldId } = await alder();
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "move", entity: MARCUS, to: "alder_automotive" }] }));
    const got = rig.body(await rig.send({ type: "lre.character", op: "get", entity: MARCUS, scope: "gm", chatId })) as unknown as CharacterResult;
    expect(got.character.place?.id).toBe("alder_automotive");
    expect(got.character.now?.party).toBe(false);
    const bare = rig.host.createChat("No world here.");
    expect((await rig.send({ type: "lre.character", op: "get", entity: MARCUS, scope: "gm", chatId: bare })).type).toBe("lre.error");
  });
});
