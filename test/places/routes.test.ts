// The places' routes on an invented chat: the list pages the chat's places, the record answers its nine parts at the head, and the owner's
// base is a player's change drawn against the bound entries. Every name here is made up.

import { describe, expect, test } from "bun:test";
import { baseWorld } from "../../src/engine/places-in-play";
import { DRAFT_EVENT, draftEvent, NO_DRAFT } from "../../src/engine/world-draft";
import { shippedTexts } from "../../src/iface/texts";
import type { CastItem } from "../../src/cast/record";
import { PLACE_STORE_AREA } from "../../src/places/fold";
import type { CastKnowledge } from "../../src/places/known";
import { placesRoutes } from "../../src/places/routes";
import type { PlaceBaseWritten, PlaceRecordAnswer, PlacesPage } from "../../src/places/shapes";
import { factStore } from "../../src/store/facts";
import type { ChangeInput } from "../../src/store";
import { callRoute } from "../app/call";
import { CHAT, openTable, USER } from "../story/rig";
import { inventedLore } from "./rig";

const INN = "lamp_ladle";

function fact(about: string, key: string, value: string, more: { part?: string; beat?: string } = {}): ChangeInput {
  const { op, value: v } = factStore.change({ about, key, value, ...more });
  return { lane: "engine", op, value: v, by: "gm", source: "prose" };
}

async function open() {
  const t = await openTable({ areas: [PLACE_STORE_AREA] });
  const lore = inventedLore();
  // The cast as the lane gives it: Odile came to know of the inn from a perception she was told it in, by Bram.
  const item = (character: string, part: "knowledge" | "perception", id: string, fields: Record<string, unknown>) => ({ part, id, character, fields, opened: "t", touched: "t", at: null, dropped: false, rows: [] }) as unknown as CastItem;
  const cast: CastKnowledge = { items: [item("c-2", "perception", "p-1", { reach: "told", told_by: "Bram" }), item("c-2", "knowledge", "k-1", { text: "A crooked inn at the crossroads.", about_refs: [`place:${INN}`], from: "p-1" })], nameOf: (c) => ({ "c-2": "Odile" })[c] };
  const [listRoute, oneRoute, baseRoute] = placesRoutes({ store: t.store, writes: t.writes, files: () => shippedTexts(), settings: async () => ({}), sources: lore, cast: () => cast });
  const list = listRoute.handle as unknown as (call: { params: { chat: string }; query: Record<string, string | number>; user: string }) => Promise<PlacesPage>;
  return { t, lore, list, oneRoute, baseRoute };
}

describe("the places' routes", () => {
  test("the list pages the chat's places, the record carries its parts at the head and the owner's base is his own change drawn against the bound entries", async () => {
    const { t, lore, list, oneRoute, baseRoute } = await open();
    const turn = await t.begin();
    await t.write(turn, [{ part: "beat", item: null, value: { text: "The east wing burned down.", place: "the inn", place_ref: `place:${INN}` } }]);
    const beat = t.record(turn).of("beat")[0]?.id ?? "";
    const doc = t.store.env.worlds(t.s.chat(CHAT)?.revision ?? "");
    if (doc === undefined) throw new Error("the invented world is held");
    const way = draftEvent(baseWorld(doc), NO_DRAFT, { collection: "routes", id: "rt_inn_market", value: { id: "rt_inn_market", from: INN, to: "market_square", modes: { walk: { minutes: 3 } }, bidirectional: true } });
    await t.writes.run(() => t.s.addChanges(turn.id, [fact(`place:${INN}`, "east_wing", "burned down", { part: "since", beat }), { lane: "engine", op: DRAFT_EVENT, value: way as unknown as ChangeInput["value"], by: "gm" }]));
    await t.tie(turn);
    lore.bound.set(INN, [{ entry: "e-layout", aspect: "layout", by: "owner" }]);
    lore.entries.set("e-layout", { title: "The Lamp and Ladle", revision: "r1" });

    // The list is a page at a time, the places inside a place after it.
    const first = await list({ params: { chat: CHAT }, query: { limit: 3 }, user: USER });
    expect(first.items.map((p) => p.place)).toEqual(["vale", "thornbury", INN]);
    expect(first.next).toBe(INN);
    const second = await list({ params: { chat: CHAT }, query: { limit: 3, after: first.next ?? "" }, user: USER });
    expect(second.items.map((p) => p.place)).toEqual(["common_room", "cellar", "market_square"]);

    // The record: the burn under since with its beat, the way with its turn, the beat in the history, the source read live.
    const record: PlaceRecordAnswer = await callRoute(oneRoute, { params: { chat: CHAT, place: INN }, user: USER });
    expect(record.since.items.map((r) => [r.key, r.beat?.text])).toEqual([["east_wing", "The east wing burned down."]]);
    expect(record.ways.ways.map((w) => [w.to.id, w.turn])).toEqual([["market_square", turn.id]]);
    expect(record.history.items.map((h) => h.text)).toEqual(["The east wing burned down."]);
    expect(record.sources.map((s) => [s.entry, s.aspect, s.title])).toEqual([["e-layout", "layout", "The Lamp and Ladle"]]);
    expect(record.base).toMatchObject({ text: "A crooked inn.", world: true });
    expect(record.known).toEqual([{ who: "c-2", name: "Odile", by: "knowledge", how: "told by Bram", reach: "told", precision: null, standing: null }]);

    // The owner writes a base: his own change, drawn against the entry as it stands, so nothing is older than it.
    const written: PlaceBaseWritten = await callRoute(baseRoute, { params: { chat: CHAT, place: INN }, body: { text: "A crooked inn with a wide hearth." }, user: USER });
    expect(written.base).toMatchObject({ text: "A crooked inn with a wide hearth.", world: false, by: "player", older: false });
    lore.entries.set("e-layout", { title: "The Lamp and Ladle", revision: "r2" });
    const after: PlaceRecordAnswer = await callRoute(oneRoute, { params: { chat: CHAT, place: INN }, user: USER });
    expect(after.base).toMatchObject({ older: true });
    expect(after.sources[0]).toMatchObject({ newer: true, drawn: "r1" });
    // A place the chat does not play is not there.
    await expect(callRoute(oneRoute, { params: { chat: CHAT, place: "nowhere" }, user: USER })).rejects.toThrow();
  });
});
