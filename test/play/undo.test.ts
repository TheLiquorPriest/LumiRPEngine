// A tap of the play views and its Undo, through the play service on a chat that plays a starter world: what a press changes is taken
// back by its Undo, the answer says when part of it stays, and a second organization of a name there is already is refused.

import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { LiveHub, WriteQueue } from "../../src/app";
import { shippedTexts } from "../../src/iface/index";
import { STARTER_WORLDS } from "../../src/packs/index";
import { PlayService, type TapAsk } from "../../src/play";
import { TAP_DEFAULTS } from "../../src/play/settings";
import { hashJson } from "../../src/shared/hash";
import { MAP_DEFAULTS } from "../../src/shared/map-config";
import { migrateStore, openStore, storedWorlds } from "../../src/store";
import { Requests } from "../../src/turn/requests";
import { HARNESS_MIGRATIONS } from "../../src/turn/tables";
import { CHAT, GUIDANCE, registry, USER } from "./bed";

/** A chat on the starter world, one turn played, and the play service over its store. */
async function rig(pov?: string, template = "modern_slice_of_life") {
  const db = new Database(":memory:");
  migrateStore(db);
  for (const step of HARNESS_MIGRATIONS) db.run(step.sql);
  const store = openStore({ db, registry: registry(), worlds: storedWorlds(db) });
  const writes = new WriteQueue(db, 10);
  const live = new LiveHub({ queueEvents: 64, now: () => 0 });
  const requests = new Requests(db, writes, () => undefined);
  const lumiverse = () => {
    throw new Error("The rig has no Lumiverse to put a message in.");
  };
  const log = () => undefined;
  const service = new PlayService({ store, writes, live, db, guidance: GUIDANCE, texts: () => shippedTexts(), turning: () => false, settings: async () => ({ dueItems: 50, editOps: 64, taps: TAP_DEFAULTS, map: MAP_DEFAULTS }), requests, lumiverse, writeChatSetting: async () => {}, log: { debug: log, info: log, warn: log, error: log } });
  const make = STARTER_WORLDS[template];
  if (make === undefined) throw new Error(`no starter world ${template}`);
  const doc = make(template, template);
  if (pov !== undefined) doc.pov = pov;
  const revision = hashJson(doc);
  const s = store.user(USER);
  await writes.run(() => {
    s.putWorld(revision, doc);
    s.createChat({ id: CHAT, world: doc.id, revision });
  });
  const begun = await writes.run(() => s.beginTurn({ chat: CHAT, kind: "normal" }), "a turn");
  await writes.run(() => s.tieTurn(begun.id, { message: "msg-1", hash: "hash-1" }), "tying the turn");
  const world = () => s.headState(CHAT).state.world;
  return {
    world,
    books: () => s.headState(CHAT).state.world.packs.economy ?? {},
    tap: (ask: TapAsk) => service.tap(USER, CHAT, ask),
    undo: async (id: string | null) => {
      if (id === null) throw new Error("the tap gave no Undo");
      return await service.undoEdit(USER, CHAT, id);
    },
  };
}

const found = (name: string): TapAsk => ({ kind: "action", action: "org_found", params: { type: "group", name, kind: "faction" }, source: "panel" });
const named = (name: string): TapAsk => ({ kind: "action", action: "party_name", params: { name }, source: "panel" });

test("a group started is taken back whole by its Undo, and a second of its name is refused", async () => {
  const { world, tap, undo } = await rig();
  const started = await tap(found("Weavers"));
  expect(started.applied).toBe(true);
  expect(world().entities.weavers?.fields.gone).toBeUndefined();
  expect(world().entities.pov?.relations.some((r) => r.type === "member_of" && r.to === "weavers")).toBe(true);

  // The same name is refused, with its reason, and nothing is made.
  expect(await tap(found("weavers"))).toMatchObject({ applied: false, undo: null, words: "Weavers is there already" });
  expect(Object.keys(world().entities).filter((id) => id.startsWith("weavers"))).toEqual(["weavers"]);

  expect(await undo(started.undo)).toMatchObject({ applied: true, words: "" });
  expect(world().entities.weavers?.fields.gone).toBe(true);
  expect(world().entities.pov?.relations.some((r) => r.to === "weavers")).toBe(false);
  expect(world().packs.orgs?.log).toEqual({});
  // Gone, it is a name free again.
  expect((await tap(found("Weavers"))).applied).toBe(true);
});

test("the party named is taken back by its Undo, and named again", async () => {
  const { world, tap, undo } = await rig();
  const first = await tap(named("Brindlemere"));
  expect(first.applied).toBe(true);
  expect(world().entities.party_pov?.name).toBe("Brindlemere");
  expect(await undo(first.undo)).toMatchObject({ applied: true, words: "" });
  expect(world().entities.party_pov?.fields.gone).toBe(true);
  const again = await tap(named("Brindlemere"));
  expect(again.applied).toBe(true);
  // A second naming renames the party there is, and its Undo gives the first name back.
  const renamed = await tap(named("Harbour Crew"));
  expect(renamed.applied).toBe(true);
  expect(await undo(renamed.undo)).toMatchObject({ applied: true, words: "" });
  expect(world().entities.party_pov_2?.name).toBe("Brindlemere");
});

const label = (item: string, name: string) => ({ do: "label", item, name });

test("a thing renamed is taken back by its Undo, and a change of several things names what stays", async () => {
  const { world, tap, undo } = await rig();
  const renamed = await tap({ kind: "fix", fix: { thing: label("pov_keys", "House keys") } });
  expect(renamed.applied).toBe(true);
  expect(world().entities.pov_keys?.name).toBe("House keys");
  expect(await undo(renamed.undo)).toMatchObject({ applied: true, words: "" });
  expect(world().entities.pov_keys?.name).toBe("Keys");

  // Two things in one change, one renamed again since: that one stays, the other is taken back, and the answer says which stayed.
  const both = await tap({ kind: "fix", fix: { things: [label("pov_keys", "Ring"), label("pov_phone", "Burner")], label: "Rename two" } });
  expect(both.applied).toBe(true);
  expect((await tap({ kind: "fix", fix: { thing: label("pov_keys", "Fob") } })).applied).toBe(true);
  const half = await undo(both.undo);
  expect(half.applied).toBe(true);
  expect(half.words).toBe("Undone, but not all of it. A name of Fob stays as it is, because something has changed it since.");
  expect([world().entities.pov_keys?.name, world().entities.pov_phone?.name]).toEqual(["Fob", "Phone"]);
  // With nothing left to take back, nothing is undone and it says why.
  const none = await tap({ kind: "fix", fix: { thing: label("pov_watch", "Old watch") } });
  expect((await tap({ kind: "fix", fix: { thing: label("pov_watch", "Timepiece") } })).applied).toBe(true);
  expect(await undo(none.undo)).toMatchObject({ applied: false, words: "Nothing was undone. A name of Timepiece stays as it is, because something has changed it since." });
});

test("what the money presses and the plan keep in their books is taken back with the press", async () => {
  const { tap, undo, books } = await rig("marcus_delgado");
  const books0 = JSON.stringify(books().books ?? null);
  for (const ask of [
    { action: "owner_draw", params: { business: "alder_automotive_co", amount: 5000 } },
    { action: "distribute_profit", params: { business: "alder_automotive_co", amount: 5000 } },
    { action: "property_sell", params: { property: "prop_marcus_home", price: 5000, buyer: "danny_okafor" } },
    { action: "shares_issue", params: { business: "alder_automotive_co", to: "danny_okafor", units: 1, price: 5000 } },
    { action: "pay_card", params: { card: "acct_marcus_mortgage", from: "acct_marcus_shop", amount: 5000 } },
    { action: "apply_credit", params: { product: "credit_card", amount: 5000, term: 1 } },
    { action: "org_goal", params: { org: "alder_automotive_co", text: "Do a thing" } },
  ]) {
    const pressed = await tap({ kind: "action", ...ask, source: "panel" });
    expect(pressed.applied, ask.action).toBe(true);
    expect(await undo(pressed.undo), ask.action).toMatchObject({ applied: true, words: "" });
  }
  // What was booked came off the books again: every month's draws, payouts and invoices read nothing.
  const booked = Object.values(books().books ?? {}).flatMap((months) => Object.values(months as Record<string, Record<string, number>>).flatMap((m) => Object.values(m)));
  expect(booked.every((n) => n === 0)).toBe(true);
  expect(books().holdings).toMatchObject({ realised: { marcus_delgado: [] } });
  expect(books0).toBe("null");
});
