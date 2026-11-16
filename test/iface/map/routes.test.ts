// The owner's routes on a chat's maps (plan §14 l.1554), called as the server calls them: the grids listed
// and one read whole; a token dragged, squares edited and a grid laid as his own changes, each with an
// Undo; and a chat's map kept in the world's draft.

import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { WriteQueue } from "../../../src/app/database";
import { hashJson } from "../../../src/shared/hash";
import { MAP_DEFAULTS } from "../../../src/shared/map-config";
import { mapRoutes } from "../../../src/iface/map/routes";
import { migrateStore } from "../../../src/store/schema";
import { openStore } from "../../../src/store/store";
import { INN, registry, worldWith } from "./fixtures";

const USER = "user-a";
const CHAT = "chat-a";

type Handler = (call: unknown) => Promise<unknown> | unknown;

/** The routes over a store with one chat on the inn's world, the world kept with a draft of its own; each called by its method and the end of its path. */
async function rig() {
  const world = worldWith(INN);
  const revision = hashJson(world);
  const db = new Database(":memory:");
  migrateStore(db);
  const store = openStore({ db, registry: registry(), worlds: (r: string) => (r === revision ? world : undefined) });
  const writes = new WriteQueue(db, 10);
  const s = store.user(USER);
  await writes.run(() => {
    s.worlds.putRevision(world.id, JSON.stringify(world), revision);
    s.worlds.putIndex(world.id, JSON.stringify({ id: world.id, name: world.name, head: revision, loreBookId: null, revisions: [revision] }));
    s.createChat({ id: CHAT, world: world.id, revision });
  });
  const routes = mapRoutes({ store, writes, live: { publish: () => ({}) as never }, config: async () => MAP_DEFAULTS });
  const call = async (method: string, tail: string, input: { params?: Record<string, string>; query?: Record<string, string>; body?: unknown } = {}): Promise<unknown> => {
    const found = routes.find((r) => r.method === method && r.path.endsWith(tail));
    if (!found) throw new Error(`no route ${method} ${tail}`);
    return (found.handle as Handler)({ user: USER, params: { chat: CHAT, ...(input.params ?? {}) }, query: input.query ?? {}, body: input.body, auth: {}, signal: new AbortController().signal });
  };
  return { s, call, world };
}

describe("the owner's routes on a chat's maps", () => {
  test("the grids are listed, one comes back whole, a token dragged and squares edited are his changes with an Undo, and the map is kept in the world's draft", async () => {
    const t = await rig();
    const listed = (await t.call("GET", "/maps")) as { maps: { place: string; from: string; width: number; feet: number }[] };
    expect(listed.maps.find((m) => m.place === "common_room")).toMatchObject({ from: "world", width: 12, feet: 5 });
    const before = (await t.call("GET", "/maps/:place", { params: { place: "common_room" } })) as { pieces: { id: string; square: number[] }[]; unplaced: { id: string }[]; doors: { square: number[]; state: string }[]; scale: { feet: number }; rows: string[] };
    expect(before.scale.feet).toBe(5);
    expect(before.doors.length).toBeGreaterThan(0);
    expect(before.rows).toHaveLength(8);
    // A token dragged to (5,3) is a change of his on the chat's line, with its Undo.
    const dragged = (await t.call("POST", "/moves", { params: { place: "common_room" }, body: { who: "bram", square: [5, 3] } })) as { undo: string | null };
    expect(dragged.undo).not.toBeNull();
    const after = (await t.call("GET", "/maps/:place", { params: { place: "common_room" } })) as { pieces: { id: string; square: number[] }[] };
    expect(after.pieces.find((p) => p.id === "bram")?.square).toEqual([5, 3]);
    expect(t.s.ownerChanges(CHAT).some((c) => c.by === "player")).toBe(true);
    // Squares edited from the page are his changes too.
    const edited = (await t.call("POST", "/squares", { params: { place: "common_room" }, body: { strokes: [{ symbol: "#", squares: [[3, 5]] }] } })) as { undo: string | null };
    expect(edited.undo).not.toBeNull();
    const drawn = (await t.call("GET", "/maps/:place", { params: { place: "common_room" } })) as { rows: string[]; edits: { squares: number } };
    expect(drawn.rows[4]?.[2]).toBe("#");
    expect(drawn.edits.squares).toBe(1);
    // Kept in the world: the map with its edited square is in the world's draft.
    const kept = (await t.call("POST", "/keep", { params: { place: "common_room" }, body: {} })) as { kept: { maps: string[] }; draft: { written: boolean; version: number } };
    expect(kept.kept.maps).toEqual(["inn_room"]);
    expect(kept.draft).toEqual({ version: 1, written: true });
    const draft = JSON.parse(new TextDecoder().decode(t.s.worlds.draft(t.world.id).bytes ?? new Uint8Array())) as { doc: { maps: Record<string, { layout?: string[] }> } };
    expect(draft.doc.maps.inn_room?.layout?.[4]?.[2]).toBe("#");
  });

  test("a grid is laid for a place that has none, and a place with none is refused with what there is", async () => {
    const t = await rig();
    const laid = (await t.call("POST", "/maps", { body: { place: "The Far Road", width: 6, height: 4 } })) as { undo: string | null };
    expect(laid.undo).not.toBeNull();
    const listed = (await t.call("GET", "/maps")) as { maps: { place: string; from: string }[] };
    expect(listed.maps.find((m) => m.place === "far_road")?.from).toBe("laid");
    await expect(t.call("GET", "/maps/:place", { params: { place: "the_moon" } })).rejects.toThrow("has no grid");
  });
});
