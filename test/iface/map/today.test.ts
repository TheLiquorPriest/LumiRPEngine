// Today's map tools through their own `run` (plan §8.2 l.1017): a place put on a map, a link between two
// of its places, the map settings, a map taken out, and what a chat changed kept into its world's draft,
// the draft's other changes standing beside it.

import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import type { HostTool, JsonObject, ToolCtx, ToolResult } from "rp-harness/contract";
import { isRecord } from "../../../src/shared/json";
import { WriteQueue } from "../../../src/app/database";
import { hashJson } from "../../../src/shared/hash";
import type { WorldDoc } from "../../../src/shared/world";
import { migrateStore } from "../../../src/store/schema";
import { openStore, type UserStore } from "../../../src/store/store";
import { type EngineDeps, engineTools, shippedTexts, stateScan } from "../../../src/iface/index";
import { PORTS } from "../rig";
import { Working } from "../../../src/engine/working";
import { initialState } from "../../../src/engine/world-state";
import { carrySpace, squareEditsOf } from "../../../src/packs/space/core/grid-play";
import { doorEvent, squaresEvent } from "../../../src/iface/map/record";
import type { LedgerEvent } from "../../../src/shared/ledger";
import { INN, registry, worldWith } from "./fixtures";

const USER = "user-a";
const CHAT = "chat-a";
const SRC = { source: { from: "prose", message: "m-1" } } as const;

/** A store over `world`, kept as a world with a draft of its own, with one chat and a first turn, and the engine's tools. */
async function rig(world: WorldDoc) {
  const revision = hashJson(world);
  const db = new Database(":memory:");
  migrateStore(db);
  const env = { registry: registry(), worlds: (r: string) => (r === revision ? world : undefined) };
  const store = openStore({ db, ...env });
  const writes = new WriteQueue(db, 10);
  const s: UserStore = store.user(USER);
  await writes.run(() => {
    s.worlds.putRevision(world.id, JSON.stringify(world), revision);
    s.worlds.putIndex(world.id, JSON.stringify({ id: world.id, name: world.name, head: revision, loreBookId: null, revisions: [revision] }));
  });
  await writes.run(() => s.createChat({ id: CHAT, world: world.id, revision }));
  const first = await writes.run(() => s.beginTurn({ chat: CHAT, kind: "new" }));
  const deps: EngineDeps = { store: s, env, writes, files: shippedTexts(), search: stateScan, ...PORTS };
  const tools = new Map<string, HostTool>((await engineTools(deps)).map((t) => [t.name, t]));
  const call = async (name: string, args: JsonObject): Promise<ToolResult> => {
    const tool = tools.get(name);
    if (!tool) throw new Error(`no tool ${name}`);
    const ctx: ToolCtx = { scope: { user: USER, chat: CHAT, session: "s-1", turn: first.id }, agent: { id: "gm-1", definition: "gm", parent: "author-1" }, run: "run-1", callId: `call-${Math.random()}`, signal: new AbortController().signal, onUpdate: () => undefined };
    return tool.run(args, ctx);
  };
  return { s, call, tools, world, first, writes };
}

const texts = (r: ToolResult): string[] => r.content.flatMap((p) => (p.type === "text" ? [p.text] : []));

/** The world's draft as the store keeps it. */
function draftOf(s: UserStore, world: WorldDoc): { doc: WorldDoc; version: number } | null {
  const read = s.worlds.draft(world.id);
  if (read.bytes === null) return null;
  const raw: unknown = JSON.parse(new TextDecoder().decode(read.bytes));
  return isRecord(raw) ? { doc: raw.doc as WorldDoc, version: read.version } : null;
}

describe("today's map tools", () => {
  test("a place put on a map, a link, the settings, and a map taken out again: each is found, applies and reports", async () => {
    const t = await rig(worldWith(INN));
    for (const name of ["world_map_place", "world_map_link", "world_map_settings", "world_keep"]) expect(t.tools.has(name)).toBe(true);
    const placed = await t.call("world_map_place", { map: "inn_room", name: "Cellar hatch", x: 9, y: 6, ...SRC });
    expect(placed.error).toBeUndefined();
    expect(texts(placed)).toContain("Made the place Cellar hatch (cellar_hatch) on the map inn_room.");
    const linked = await t.call("world_map_link", { map: "inn_room", from: "Cellar hatch", to: "The Common Room", minutes: 1, ...SRC });
    expect(linked.error).toBeUndefined();
    const set = await t.call("world_map_settings", { display: "fog", ...SRC });
    expect(set.error).toBeUndefined();
    expect(texts(set)).toContain("Changed the map settings: display.");
    // The map as the chat plays it has the place and the link; the world's own does not.
    const maps = (await t.call("world_keep", {})).content;
    expect(JSON.stringify(maps)).toContain("map The common room");
    // A map laid in play is taken out of the chat's world, and whoever stood on it stands on no square.
    const laid = await t.call("map_lay", { place: "The Far Road", width: 6, height: 5, ...SRC });
    expect(laid.error).toBeUndefined();
    const gone = await t.call("map_lay", { place: "The Far Road", remove: true, ...SRC });
    expect(gone.error).toBeUndefined();
    expect(texts(gone).some((x) => x.startsWith("Took the map "))).toBe(true);
    const none = await t.call("map_lay", { place: "The Far Road", remove: true, ...SRC });
    expect(none.error).toBe(true);
  });

  test("a map laid and edited in play, kept, is in the world's draft with its edited squares; kept after the draft changed elsewhere, both changes stand", async () => {
    const t = await rig(worldWith(INN));
    await t.call("map_lay", { place: "The Far Road", rows: ["####", "#..#", "####"], title: "Road", ...SRC });
    const edited = await t.call("map_edit", { at: "The Far Road", strokes: [{ symbol: "#", squares: [[3, 2]] }], ...SRC });
    expect(edited.error).toBeUndefined();
    const squares = await t.call("map_edit", { at: "The Common Room", strokes: [{ symbol: "#", squares: [[3, 3]] }], ...SRC });
    expect(squares.error).toBeUndefined();
    // The draft changed elsewhere meanwhile: a place of the world's own was renamed there.
    const base = t.s.worlds.draft(t.world.id);
    const elsewhere = { ...t.world, name: "Renamed in Build" };
    const wrote = await t.writes.run(() => t.s.worlds.writeDraft(t.world.id, JSON.stringify({ base: hashJson(t.world), doc: elsewhere, version: base.version + 1 }), base.version));
    expect(wrote).toEqual({ done: true, version: base.version + 1 });
    const kept = await t.call("world_keep", { maps: ["inn_room", "Road"] });
    expect(kept.error).toBeUndefined();
    expect(texts(kept).some((x) => x.startsWith("Kept in the world's draft, now at version 2"))).toBe(true);
    const draft = draftOf(t.s, t.world);
    expect(draft?.version).toBe(2);
    expect(draft?.doc.name).toBe("Renamed in Build");
    expect(draft?.doc.maps.inn_room?.layout?.[2]?.[2]).toBe("#");
    expect(Object.values(draft?.doc.maps ?? {}).some((m) => m.title === "Road" && m.layout?.[1]?.[2] === "#")).toBe(true);
    // Kept again: nothing new, nothing written.
    const again = await t.call("world_keep", { maps: ["inn_room"] });
    expect(texts(again)).toContain("Nothing was written to the world's draft.");
  });
});

describe("an Upgrade carries the chat's records on grids", () => {
  test("a square the revision took in leaves the chat's record; one it left alone stays; a record whose map is gone is kept, named, and shown again when the map returns", () => {
    const world = worldWith(INN);
    const reg = registry();
    const w = new Working(reg, world, initialState(world, "r", reg));
    const apply = (e: unknown): void => expect(w.apply(e as LedgerEvent)).toBeNull();
    apply(squaresEvent("inn_room", [{ at: [3, 3], symbol: "#" }, { at: [4, 3], symbol: "#" }], {}));
    apply(doorEvent({ scope: "common_room" }, [6, 1], "locked"));
    // A revision that draws the square at (3, 3) as the chat did takes that one in; the other stays.
    const rows = [...(INN.layout ?? [])];
    rows[2] = [...(rows[2] ?? "")].map((c, i) => (i === 2 ? "#" : c)).join("");
    const took = { ...world, maps: { ...world.maps, inn_room: { ...INN, layout: rows } } };
    expect(carrySpace(w.state, took)).toEqual([]);
    expect(Object.keys(squareEditsOf(w.state, "inn_room")?.cells ?? {})).toEqual(["3,2"]);
    // A revision without the map keeps both records and names them.
    const without = { ...world, maps: {}, grids: {} };
    const notes = carrySpace(w.state, without);
    expect(notes.length).toBe(2);
    expect(notes.join(" ")).toContain("inn_room");
    expect(Object.keys(squareEditsOf(w.state, "inn_room")?.cells ?? {})).toEqual(["3,2"]);
    // The map back, the records show again and name nothing.
    expect(carrySpace(w.state, world)).toEqual([]);
  });
});
