// Today's panel taps, served by RPE on the typed taps route: a tap that manages is recorded as the player's own change,
// of no turn and kept with the chat (plan §6.3, §10.10), shows in the panels, is counted by the next turn's world state among what
// was changed before it, and its Undo, by the edit's own id, puts the state back whole or not at all; it records what the player
// did and what the world gave beside it as the player's own, and nothing code made up, the clock's ✎ included; what is not
// served says so in the words of `.prompts/play-answers.md`; and one user's chat is not another's to change.

import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calendarOf, formatStamp, placeOffset } from "../../src/engine/calendar";
import { placeOfEntity } from "../../src/engine/scope";
import type { WorldState } from "../../src/engine/state";
import type { TapAsk } from "../../src/play/service";
import type { JsonObject, JsonValue } from "../../src/shared/json";
import type { StateView } from "../../src/shared/state-view";
import type { WorldDoc } from "../../src/shared/world";
import { notional } from "../../src/packs/economy/core/model";
import { STARTER_WORLDS } from "../../src/packs/index";
import { hashJson } from "../../src/shared/hash";
import { type ChangeRow, worldState } from "../../src/store";
import { type Bed, CHAT, GUIDANCE, makeBed, OTHER, panel, USER, words } from "./bed";

const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === "object" && v !== null && !Array.isArray(v);

/** What the POV's bank accounts hold, as the money panel shows it. */
function banked(view: StateView): number {
  const overview = panel(view, "economy.money").overview;
  const line = isObject(overview) && Array.isArray(overview.breakdown) ? overview.breakdown.find((b) => isObject(b) && b.label === "Bank accounts") : undefined;
  if (!isObject(line) || typeof line.cents !== "number") throw new Error("no bank accounts in the money panel");
  return line.cents;
}

/** The money panel's lines in the POV's books, as its recent list shows them: what each was, how much, what kind, and with whom. */
function booked(view: StateView): { memo: JsonValue | undefined; cents: JsonValue | undefined; kind: JsonValue | undefined; counterparty: JsonValue | undefined }[] {
  const recent = panel(view, "economy.money").recent;
  return (Array.isArray(recent) ? recent : []).flatMap((l) => (isObject(l) ? [{ memo: l.memo, cents: l.cents, kind: l.kind, counterparty: l.counterparty }] : []));
}

/** A recorded change's event, as data. */
function eventOf(c: ChangeRow): JsonObject {
  if (!isObject(c.value)) throw new Error(`change ${c.id} holds no event`);
  return c.value;
}

/** A clock reading as the HUD's ✎ takes it: a date and time of day at the player character's place. */
function stamp(doc: WorldDoc, state: WorldState, clock: number): string {
  return formatStamp(calendarOf(doc), clock, placeOffset(doc, clock, placeOfEntity(state, doc.pov)));
}

/** A tap of the player's, made as the taps route takes it. */
const tap = (bed: Bed, ask: TapAsk, user = USER, chat = CHAT) => bed.service.tap(user, chat, ask);
const undo = (bed: Bed, edit: string | null, user = USER, chat = CHAT) => bed.service.undoEdit(user, chat, edit ?? "");

/** The edit's own changes: what the player did and what the world gave with it, kept with the chat and of no turn. */
const owned = (bed: Bed, chat = CHAT): ChangeRow[] => bed.store.user(USER).ownerChanges(chat);

const PAY: TapAsk = { kind: "action", action: "pay", params: { to: "marcus_delgado", amount: 1500 }, source: "palette" };

// A test that moved the clock on puts it back to the machine's.
afterEach(() => setSystemTime());

describe("a tap that manages", () => {
  test("is recorded as the player's own, shows in the panels, and its Undo puts the state back", async () => {
    const bed = makeBed();
    await bed.plays("modern_slice_of_life");
    const newest = await bed.turn();
    bed.listen();
    const before = banked(await bed.state());

    const paid = await tap(bed, PAY);
    expect({ applied: paid.applied, reports: paid.reports }).toEqual({ applied: true, reports: [] });
    if (paid.undo === null) throw new Error(`no Undo: ${JSON.stringify(paid)}`);
    expect(banked(await bed.state())).toBe(before - 1500);
    // Of no turn: the reply's turn holds nothing of it.
    expect(bed.store.user(USER).changes(newest.id)).toEqual([]);
    const own = owned(bed).filter((c) => c.source === "player" && c.op !== "materialize");
    expect(own.map((c) => c.op)).toEqual(["post", "economy.txn"]);
    expect(own.map((c) => ({ by: c.by, tapped: isObject(c.cite) && "tap" in c.cite && "request" in c.cite }))).toEqual(own.map(() => ({ by: "player", tapped: true })));
    expect(bed.heard.map((e) => ({ kind: e.kind, key: e.key, data: e.data }))).toEqual([{ kind: "state", key: "state", data: {} }]);

    expect(await undo(bed, paid.undo)).toMatchObject({ applied: true, words: "" });
    expect(banked(await bed.state())).toBe(before);
    expect(bed.heard.map((e) => e.kind)).toEqual(["state", "state"]);
    // Undone once, it is not undone again.
    expect(await undo(bed, paid.undo)).toMatchObject({ applied: false });
    expect(banked(await bed.state())).toBe(before);
  });

  test("makes nothing up: a payment opens the accounts the world gave, as the player's own and established, and its Undo takes the payment back in the books", async () => {
    const bed = makeBed();
    await bed.plays("modern_slice_of_life");
    await bed.turn();
    const s = bed.store.user(USER);
    const things = Object.keys(s.headState(CHAT).state.world.entities).sort();

    const paid = await tap(bed, PAY);
    if (paid.undo === null) throw new Error("no Undo");
    // No one has a thing, or an account, the world did not give them.
    expect(Object.keys(s.headState(CHAT).state.world.entities).sort()).toEqual(things);
    const recorded = owned(bed);
    // What the world gave opens first, as the player's own and established, citing only the edit; then what the player did.
    expect(recorded.filter((c) => c.op === "materialize").map((c) => ({ who: eventOf(c).entity, domain: eventOf(c).domain, by: c.by, source: c.source, standing: c.standing, precision: c.precision, tap: isObject(c.cite) && "tap" in c.cite && !("request" in c.cite) }))).toEqual(
      ["pov", "marcus_delgado"].map((who) => ({ who, domain: "money", by: "player", source: "player", standing: "established", precision: null, tap: true })),
    );
    expect(recorded.filter((c) => c.op !== "materialize").map((c) => c.op)).toEqual(["post", "economy.txn"]);

    await undo(bed, paid.undo);
    // The books keep the payment, and list it taken back as the economy lists a payment reversed.
    const lines = booked(await bed.state());
    expect(lines).toContainEqual({ memo: "Payment", cents: -1500, kind: "transfer", counterparty: "Marcus Delgado" });
    expect(lines).toContainEqual({ memo: "Payment reversed", cents: 1500, kind: "transfer", counterparty: "Marcus Delgado" });
    expect(Object.keys(s.headState(CHAT).state.world.entities).sort()).toEqual(things);
  });

  test("pays someone the world keeps no accounts for with nothing the player did not do: the economy's bookkeeping for them is the world's own and assumed, and the Undo is whole", async () => {
    const bed = makeBed();
    const { doc } = await bed.plays("fantasy_town");
    await bed.turn();
    const s = bed.store.user(USER);
    const before = s.headState(CHAT).state.world;
    const worth = notional(before, "hollis_garrow");

    const paid = await tap(bed, { kind: "action", action: "pay", params: { to: "hollis_garrow", amount: 3 }, source: "palette" });
    if (paid.undo === null) throw new Error("no Undo");
    const recorded = owned(bed);
    expect(recorded.filter((c) => c.source === "player").map((c) => c.op)).toEqual(["materialize", "post", "economy.txn"]);
    // What it takes the payee to be worth, which the payment moves, is the world's own and assumed.
    expect(recorded.filter((c) => c.source !== "player").map((c) => ({ op: c.op, who: eventOf(c).entity ?? (eventOf(c).data as JsonObject | undefined)?.entity, source: c.source, standing: c.standing, precision: c.precision }))).toEqual([
      { op: "economy.anchor", who: "hollis_garrow", source: "default", standing: "assumed", precision: null },
    ]);
    expect(Object.keys(s.headState(CHAT).state.world.entities).sort()).toEqual(Object.keys(before.entities).sort());
    expect(notional(s.headState(CHAT).state.world, "hollis_garrow")).toBe(worth + 3);

    // Whole: everything the player did is taken back, and what the world's defaults gave goes with it.
    expect(await undo(bed, paid.undo)).toMatchObject({ applied: true });
    const after = s.headState(CHAT).state.world;
    // What the world gave with it goes back too (the route takes back all of an edit, its defaults with it): the purse is as it was before the tap.
    expect(after.accounts.acct_pov_purse ?? 0).toBe(before.accounts.acct_pov_purse ?? 0);
    expect(notional(after, "hollis_garrow")).toBe(worth);
    expect(after.entities.hollis_garrow?.fields.wealth).toBe(before.entities.hollis_garrow?.fields.wealth);
  });

  test("as the clock's ✎ moves the clock and decides nothing the time between did: a later time is one change, an earlier one today's set-back, and each Undo puts the clock back", async () => {
    const bed = makeBed();
    const { doc } = await bed.plays("modern_slice_of_life");
    await bed.turn(async (apply) => {
      await apply([{ op: "pass_time", minutes: 180, source: { from: "prose", message: "msg-reply-hours" } }]);
    });
    const s = bed.store.user(USER);
    const start = s.headState(CHAT).state.world;
    const recorded = owned(bed).length;

    const later = await tap(bed, { kind: "fix", fix: { time: stamp(doc, start, start.clock + 2 * 24 * 60) } });
    expect(owned(bed).slice(recorded).map((c) => ({ op: c.op, value: c.value, source: c.source }))).toEqual([{ op: "clock", value: { type: "clock", minutes: 2 * 24 * 60, cause: "advance" }, source: "player" }]);
    if (later.undo === null) throw new Error("no Undo");
    expect(await undo(bed, later.undo)).toMatchObject({ applied: true });
    expect(s.headState(CHAT).state.world.clock).toBe(start.clock);

    const marked = owned(bed).length;
    const earlier = await tap(bed, { kind: "fix", fix: { time: stamp(doc, start, start.clock - 60) } });
    expect(owned(bed).slice(marked).map((c) => ({ op: c.op, minutes: (eventOf(c).data as JsonObject | undefined)?.minutes }))).toEqual([{ op: "engine.rewind", minutes: 60 }]);
    if (earlier.undo === null) throw new Error("no Undo");
    expect(await undo(bed, earlier.undo)).toMatchObject({ applied: true });
    expect(s.headState(CHAT).state.world.clock).toBe(start.clock);
  });

  test("is counted by the next turn's world state among what was changed before it", async () => {
    const bed = makeBed();
    await bed.plays("modern_slice_of_life");
    await bed.turn();
    await tap(bed, PAY);
    // His edit takes effect before the turn that begins after it (`placeOwner` compares their times): the clock is moved on, not waited for.
    setSystemTime(new Date(Date.now() + 1000));
    const s = bed.store.user(USER);
    const next = await bed.writes.run(() => s.beginTurn({ chat: CHAT, kind: "normal" }));
    const block = worldState(s, { chat: CHAT, turn: next.id, layout: readFileSync(join(GUIDANCE, ".prompts", "world-state.md"), "utf8"), charsPerToken: 3.2 });
    // His own edit, told apart as his (`changed_his`), on the engine's lane.
    const engine = (block.sections.changed ?? []).find((l) => l.kind === "changed_his" && l.fields.lane === "engine");
    expect(engine?.fields.ops).toEqual({ list: expect.arrayContaining(["post"]) });
    expect(block.text).toContain("of the player's own");
  });

  test("as a ✎ moves the player character, and its Undo moves them back", async () => {
    const bed = makeBed();
    const { doc } = await bed.plays("fantasy_town");
    await bed.turn();
    const view = await bed.state();
    const from = view.hud?.place?.id;
    const to = view.hud?.fixes.place?.options?.map((o) => o.value).find((p) => typeof p === "string" && p !== from);
    if (typeof from !== "string" || typeof to !== "string") throw new Error("no place to move to");

    const fixed = await tap(bed, { kind: "fix", fix: { entity: doc.pov, field: "place", value: to } });
    if (fixed.undo === null) throw new Error("no Undo");
    expect((await bed.state()).hud?.place?.id).toBe(to);
    expect(await undo(bed, fixed.undo)).toMatchObject({ applied: true });
    const back = await bed.state();
    expect({ hud: back.hud?.place?.id, scene: back.scene?.placeId }).toEqual({ hud: from, scene: from });
  });

  test("as a ✎ of cash, opens the accounts the world gave, and records the correction as the player's", async () => {
    const bed = makeBed();
    const { doc } = await bed.plays("mystery_manor");
    await bed.turn();
    const fixed = await tap(bed, { kind: "fix", fix: { entity: doc.pov, field: "cash", value: 5000 } });
    // What the world gave is opened first, and stands established, from the player, as the tools record what they open (e132c564f).
    const recorded = owned(bed).map((c) => ({ op: c.op, source: c.source, standing: c.standing }));
    expect(recorded[0]).toEqual({ op: "materialize", source: "player", standing: "established" });
    expect(recorded.slice(-2)).toEqual([
      { op: "post", source: "player", standing: null },
      { op: "economy.txn", source: "player", standing: null },
    ]);
    if (fixed.undo === null) throw new Error("no Undo");
    expect(await undo(bed, fixed.undo)).toMatchObject({ applied: true });
  });

  test("as a ✎ of cash for someone the world gave no accounts, changes the cash they keep as a field and makes nothing up, and its Undo is whole", async () => {
    const bed = makeBed();
    // The manor's guest, kept by a world made so that they hold no accounts and keep their cash as a field.
    const doc = STARTER_WORLDS.mystery_manor?.("mystery_manor", "mystery_manor");
    if (doc === undefined) throw new Error("no starter world mystery_manor");
    for (const [id, e] of Object.entries(doc.entities)) if (e.kind === "account") delete doc.entities[id];
    const guest = doc.entities[doc.pov];
    if (guest === undefined) throw new Error("no point-of-view character");
    guest.fields.cash = 4000;
    const s = bed.store.user(USER);
    const revision = hashJson(doc);
    await bed.writes.run(() => {
      s.putWorld(revision, doc);
      s.createChat({ id: CHAT, world: doc.id, revision });
    });
    await bed.turn();
    const before = s.headState(CHAT).state.world;

    const fixed = await tap(bed, { kind: "fix", fix: { entity: doc.pov, field: "cash", value: 5000 } });
    expect(owned(bed).map((c) => ({ op: c.op, source: c.source }))).toEqual([{ op: "set", source: "player" }]);
    const after = s.headState(CHAT).state.world;
    expect(after.entities[doc.pov]?.fields.cash).toBe(5000);
    // Nothing else: no account, no balance, no other field of anyone's.
    const was = after.entities[doc.pov];
    if (was === undefined) throw new Error("no point-of-view character");
    expect({ entities: { ...after.entities, [doc.pov]: { ...was, fields: { ...was.fields, cash: 4000 } } }, accounts: after.accounts }).toEqual({ entities: before.entities, accounts: before.accounts });

    if (fixed.undo === null) throw new Error("no Undo");
    expect(await undo(bed, fixed.undo)).toMatchObject({ applied: true });
    const undone = s.headState(CHAT).state.world;
    expect({ entities: undone.entities, accounts: undone.accounts }).toEqual({ entities: before.entities, accounts: before.accounts });
  });

  test("names no one the player character does not know, in the file's words, and records nothing", async () => {
    const bed = makeBed();
    await bed.plays("modern_slice_of_life");
    await bed.turn();
    expect(await tap(bed, { ...PAY, params: { to: "stranger_nobody_knows", amount: 1500 } } as TapAsk)).toMatchObject({ applied: false, undo: null, words: words("names_no_one", { action: "Pay" }) });
    expect(owned(bed)).toEqual([]);
  });

  test("on another user's chat is refused, and so is the Undo of another user's tap", async () => {
    const bed = makeBed();
    await bed.plays("modern_slice_of_life");
    await bed.turn();
    const paid = await tap(bed, PAY);
    const after = banked(await bed.state());
    expect(await tap(bed, PAY, OTHER)).toMatchObject({ applied: false, undo: null, words: words("not_world") });
    if (paid.undo === null) throw new Error("no Undo");
    expect(await undo(bed, paid.undo, OTHER)).toMatchObject({ applied: false, words: words("no_undo") });
    expect(banked(await bed.state())).toBe(after);
  });
});

describe("a tap that needs no turn", () => {
  test("on a chat with no turn yet is recorded all the same, kept with the chat, and shows at once (22172d938: no turn, run or branch refuses an edit of his)", async () => {
    const bed = makeBed();
    await bed.plays("modern_slice_of_life");
    const before = banked(await bed.state());
    const paid = await tap(bed, PAY);
    expect(paid).toMatchObject({ applied: true });
    expect(banked(await bed.state())).toBe(before - 1500);
    if (paid.undo === null) throw new Error("no Undo");
    expect(await undo(bed, paid.undo)).toMatchObject({ applied: true });
    expect(banked(await bed.state())).toBe(before);
  });

  test("while a turn of the chat runs is recorded all the same, shown now and marked pending until the run ends, and its Undo is pressed at once", async () => {
    const bed = makeBed();
    await bed.plays("modern_slice_of_life");
    const newest = await bed.turn();
    const before = banked(await bed.state());
    // A run of the chat going on: its record, not yet ended, as the turn lane keeps it.
    const received = Date.now();
    bed.running.add(CHAT);
    await bed.writes.run(() => bed.store.db.run("INSERT INTO turn_run (user, id, turn, chat, session, kind, status, received) VALUES (?, 'run-1', ?, ?, 'session-1', 'normal', 'running', ?)", [USER, newest.id, CHAT, received]));
    setSystemTime(new Date(received + 1000));

    const paid = await tap(bed, PAY);
    expect(paid).toMatchObject({ applied: true });
    const during = await bed.state();
    expect(banked(during)).toBe(before - 1500);
    expect(during.pending).toEqual([{ panel: "*", entity: null }]);
    // Of no turn: the running turn's own changes are not under it.
    expect(bed.store.user(USER).changes(newest.id)).toEqual([]);
    if (paid.undo === null) throw new Error("no Undo");
    expect(await undo(bed, paid.undo)).toMatchObject({ applied: true });
    expect(banked(await bed.state())).toBe(before);
  });

  test("in a branch with no turn of its own is recorded on the branch's own line: the chat it was branched from keeps its state, and the branch's Undo puts the branch back", async () => {
    const bed = makeBed();
    const BRANCH = "chat-foxglove";
    await bed.plays("modern_slice_of_life");
    const shared = await bed.turn();
    const s = bed.store.user(USER);
    const reply = shared.message ?? "";
    await bed.writes.run(() => {
      s.branchChat({ id: BRANCH, from: CHAT, map: { [reply]: `b-${reply}` }, at: reply });
      s.sync(BRANCH, [{ id: `b-${reply}`, user: false, hash: shared.hash ?? "", hidden: false }]);
    });
    const before = banked(await bed.state());

    const paid = await tap(bed, PAY, USER, BRANCH);
    expect(paid).toMatchObject({ applied: true });
    expect(s.changes(shared.id)).toEqual([]);
    expect({ source: banked(await bed.state()), branch: banked(await bed.state({}, USER, BRANCH)) }).toEqual({ source: before, branch: before - 1500 });
    if (paid.undo === null) throw new Error("no Undo");
    expect(await undo(bed, paid.undo, USER, BRANCH)).toMatchObject({ applied: true });
    expect(banked(await bed.state({}, USER, BRANCH))).toBe(before);
  });
});
