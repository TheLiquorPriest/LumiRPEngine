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

/** Starts Describe a map on the rig and returns the job's final update. */
async function described(rig: Rig, worldId: string, input: Record<string, unknown>) {
  const jobId = rig.body(await rig.send({ type: "lre.job", op: "start", kind: "describe_map", worldId, input: JSON.parse(JSON.stringify(input)) })).jobId;
  await rig.host.settle();
  const end = rig.host.sent.findLast((m) => m.type === "lre.job.update" && m.jobId === jobId && m.status !== "running");
  if (end?.type !== "lre.job.update") throw new Error("the job didn't end");
  return { ...end, proposals: end.result && "proposals" in end.result ? end.result.proposals : [] };
}

const DESCRIBED = {
  title: "The shop",
  layout: ["#######", "#ff+bb#", "#######"],
  legend: { f: { place: "shop_front" }, b: { place: "shop_back" } },
  places: [
    { id: "shop_front", name: "Front" },
    { id: "shop_back", name: "Back room" },
  ],
};

describe("Describe a map", () => {
  test("the prose goes to the helper with the schema and an example; its map comes back as one proposal for the place, and applies to the draft", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    rig.host.quietReply = () => JSON.stringify({ ...DESCRIBED, id: "anything", scope: "elsewhere" });
    const end = await described(rig, worldId, { scope: "home", prose: "A small shop: the front room, a door, then the back room." });
    expect(end.status).toBe("done");
    expect(rig.host.quietCalls.length).toBe(1);
    const [system, user] = rig.host.quietCalls[0]?.messages ?? [];
    expect(system?.content).toContain('"title":"lre-map-v1"');
    expect(system?.content).toContain("Example, a two-room cottage");
    expect(user?.content).toContain("Map id: home_map");
    expect(user?.content).toContain("A small shop: the front room");
    expect(end.proposals).toHaveLength(1);
    expect(end.proposals[0]).toMatchObject({ collection: "maps", key: "home_map", confidence: 0.9, value: { id: "home_map", scope: "home" } });
    const put = rig.body(await rig.send({ type: "lre.editor", worldId, base: null, op: "put", collection: "maps", id: "home_map", value: end.proposals[0]?.value ?? null }));
    expect(draftOf(put).places.shop_back).toMatchObject({ name: "Back room", parent: "home", map: "home_map" });
    // Kept with the user's other jobs, so a reload or a restart shows it again.
    const kept = rig.body(await rig.send({ type: "lre.job", op: "list", worldId })).jobs;
    expect(Array.isArray(kept) && kept.some((j) => isRecord(j) && j.kind === "describe_map" && j.status === "done")).toBe(true);
  });

  test("a map with errors gets one repair call that lists them; the repaired map stands", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    const replies = [JSON.stringify({ ...DESCRIBED, layout: ["#######", "#ff+bbx#", "#######"] }), JSON.stringify(DESCRIBED)];
    rig.host.quietReply = () => replies.shift() ?? "";
    const end = await described(rig, worldId, { scope: "home", mapId: "shop", prose: "A shop with a back room." });
    expect(end.status).toBe("done");
    expect(rig.host.quietCalls.length).toBe(2);
    const repair = rig.host.quietCalls[1]?.messages[1]?.content ?? "";
    expect(repair).toContain(`"x" isn't in the legend`);
    expect(repair).toContain("row 1 is 7 wide");
    expect(repair).toContain('"#ff+bbx#"');
    expect(end.message).toContain("a repair call fixed them");
    expect(end.proposals[0]).toMatchObject({ key: "shop", confidence: 0.9, value: { layout: DESCRIBED.layout } });
  });

  test("still wrong after the repair, the map is offered unticked with its problems; an answer that's no map fails the job", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    rig.host.quietReply = () => JSON.stringify({ ...DESCRIBED, places: [{ id: "shop_front", name: "Front", at: [20, 1] }, { id: "shop_back" }] });
    const end = await described(rig, worldId, { scope: "home", prose: "A shop." });
    expect(end.status).toBe("done");
    expect(rig.host.quietCalls.length).toBe(2);
    expect(end.proposals[0]?.confidence).toBeLessThan(0.7);
    expect(end.proposals[0]?.note).toContain("[20, 1] is outside the 7 × 3 layout");
    rig.host.quietReply = () => "Sorry, I can't draw that.";
    const failed = await described(rig, worldId, { scope: "home", prose: "A shop." });
    expect(failed.status).toBe("failed");
    expect(failed.message).toContain("isn't a map");
    expect((await rig.send({ type: "lre.job", op: "start", kind: "describe_map", worldId, input: { scope: "nowhere", prose: "x" } })).type).toBe("lre.result");
    await rig.host.settle();
    expect(rig.host.sent.findLast((m) => m.type === "lre.job.update")).toMatchObject({ status: "failed", message: "choose the place the map draws" });
  });
});
