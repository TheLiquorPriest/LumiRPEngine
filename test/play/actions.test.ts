// Today's panel actions, served by RPE: a tap that manages is recorded as the player's own change on the
// chat's newest turn, shows in the panels, is counted by the next turn's world state among what the
// turn before changed, and its Undo puts the state back; it records what the player did and nothing
// code made up, the clock's ✎ included; while a turn of the chat runs, a tap and an Undo change
// nothing; an Undo puts back all of a tap or none of it; what is not served says so in the words of
// `.prompts/play-answers.md`; and one user's chat is not another's to change.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calendarOf, formatStamp, placeOffset } from "../../src/engine/calendar";
import { placeOfEntity } from "../../src/engine/scope";
import type { WorldState } from "../../src/engine/state";
import type { JsonObject, JsonValue } from "../../src/shared/json";
import { FIX_THINGS_MAX } from "../../src/shared/protocol";
import type { StateView } from "../../src/shared/state-view";
import type { WorldDoc } from "../../src/shared/world";
import { notional } from "../../src/packs/economy/core/model";
import { STARTER_WORLDS } from "../../src/packs/index";
import { hashJson } from "../../src/shared/hash";
import { type ChangeRow, worldState } from "../../src/store";
import { body, CHAT, GUIDANCE, keyed, makeBed, OTHER, panel, refusal, USER, words } from "./bed";

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

const PAY = { type: "lre.action", action: "pay", params: { to: "marcus_delgado", amount: 1500 }, source: "palette" };

describe("a tap that manages", () => {
  test("is recorded as the player's own on the chat's newest turn, shows in the panels, and its Undo puts the state back", async () => {
    const bed = makeBed();
    await bed.plays("modern_slice_of_life");
    const newest = await bed.turn();
    bed.listen();
    const before = banked(await bed.state());

    const paid = body(await bed.send(PAY), "lre.action");
    if (!("undo" in paid) || typeof paid.undo !== "string") throw new Error(`no Undo: ${JSON.stringify(paid)}`);
    expect({ applied: paid.applied, pending: paid.pending }).toEqual({ applied: true, pending: false });
    expect(banked(await bed.state())).toBe(before - 1500);
    const own = bed.store.user(USER).changes(newest.id).filter((c) => c.source === "player");
    expect(own.map((c) => c.op)).toEqual(["post", "economy.txn"]);
    expect(own.map((c) => ({ by: c.by, tapped: isObject(c.cite) && "tap" in c.cite && "request" in c.cite }))).toEqual(own.map(() => ({ by: "player", tapped: true })));
    expect(bed.heard.map((e) => ({ kind: e.kind, key: e.key, data: e.data }))).toEqual([{ kind: "state", key: "state", data: {} }]);

    expect(body(await bed.undo(paid.undo), "lre.chip")).toEqual({ applied: true, pending: false });
    expect(banked(await bed.state())).toBe(before);
    expect(bed.heard.map((e) => e.kind)).toEqual(["state", "state"]);
    // Undone once, it is not undone again.
    expect(body(await bed.undo(paid.undo), "lre.chip")).toEqual({ applied: false, pending: false });
    expect(banked(await bed.state())).toBe(before);
  });

  test("makes nothing up: a payment opens the accounts the world gave as the world's own and assumed, and its Undo takes the payment back in the books", async () => {
    const bed = makeBed();
    await bed.plays("modern_slice_of_life");
    const newest = await bed.turn();
    const s = bed.store.user(USER);
    const things = Object.keys(s.headState(CHAT).state.world.entities).sort();

    const paid = body(await bed.send(PAY), "lre.action");
    if (!("undo" in paid) || typeof paid.undo !== "string") throw new Error("no Undo");
    // No one has a thing, or an account, the world did not give them.
    expect(Object.keys(s.headState(CHAT).state.world.entities).sort()).toEqual(things);
    const recorded = s.changes(newest.id);
    expect(recorded.filter((c) => c.source !== "player").map((c) => ({ op: c.op, who: eventOf(c).entity, domain: eventOf(c).domain, by: c.by, source: c.source, standing: c.standing, precision: c.precision }))).toEqual(
      ["pov", "marcus_delgado"].map((who) => ({ op: "materialize", who, domain: "money", by: "player", source: "default", standing: "assumed", precision: null })),
    );
    // What the world gave opens apart from the payment: the payment's unit holds what the player did, and nothing else.
    expect(recorded.filter((c) => c.source === "player").map((c) => c.op)).toEqual(["post", "economy.txn"]);

    body(await bed.undo(paid.undo), "lre.chip");
    // The books keep the payment, and list it taken back as the economy lists a payment reversed.
    const lines = booked(await bed.state());
    expect(lines).toContainEqual({ memo: "Payment", cents: -1500, kind: "transfer", counterparty: "Marcus Delgado" });
    expect(lines).toContainEqual({ memo: "Payment reversed", cents: 1500, kind: "transfer", counterparty: "Marcus Delgado" });
    expect(Object.keys(s.headState(CHAT).state.world.entities).sort()).toEqual(things);
  });

  test("pays someone the world keeps no accounts for with nothing the player did not do: the economy's bookkeeping for them is the world's own and assumed, and the Undo is whole", async () => {
    const bed = makeBed();
    const { doc } = await bed.plays("fantasy_town");
    const newest = await bed.turn();
    const s = bed.store.user(USER);
    const before = s.headState(CHAT).state.world;
    const worth = notional(before, "hollis_garrow");

    const paid = body(await bed.send({ type: "lre.action", action: "pay", params: { to: "hollis_garrow", amount: 3 }, source: "palette" }), "lre.action");
    if (!("undo" in paid) || typeof paid.undo !== "string") throw new Error("no Undo");
    const recorded = s.changes(newest.id);
    expect(recorded.filter((c) => c.source === "player").map((c) => c.op)).toEqual(["post", "economy.txn"]);
    // What the world gave the payer, and what it takes the payee to be worth, which the payment moves.
    expect(recorded.filter((c) => c.source !== "player").map((c) => ({ op: c.op, who: eventOf(c).entity ?? (eventOf(c).data as JsonObject | undefined)?.entity, source: c.source, standing: c.standing, precision: c.precision }))).toEqual([
      { op: "materialize", who: doc.pov, source: "default", standing: "assumed", precision: null },
      { op: "economy.anchor", who: "hollis_garrow", source: "default", standing: "assumed", precision: null },
    ]);
    expect(Object.keys(s.headState(CHAT).state.world.entities).sort()).toEqual(Object.keys(before.entities).sort());
    expect(notional(s.headState(CHAT).state.world, "hollis_garrow")).toBe(worth + 3);

    // Whole: everything the player did is taken back, and what the world's defaults gave stays, as the answer says.
    expect(body(await bed.undo(paid.undo), "lre.chip")).toEqual({ applied: true, pending: false });
    const after = s.headState(CHAT).state.world;
    const opening = doc.entities.acct_pov_purse?.fields.opening;
    if (typeof opening !== "number") throw new Error("the purse has no opening");
    expect(after.accounts.acct_pov_purse).toBe(opening);
    expect(notional(after, "hollis_garrow")).toBe(worth);
    expect(after.entities.hollis_garrow?.fields.wealth).toBe(before.entities.hollis_garrow?.fields.wealth);
  });

  test("as the clock's ✎ moves the clock and decides nothing the time between did: a later time is one change, an earlier one today's set-back, and each Undo puts the clock back", async () => {
    const bed = makeBed();
    const { doc } = await bed.plays("modern_slice_of_life");
    const newest = await bed.turn(async (apply) => {
      await apply([{ op: "pass_time", minutes: 180, source: { from: "prose", message: "msg-reply-hours" } }]);
    });
    const s = bed.store.user(USER);
    const start = s.headState(CHAT).state.world;
    const recorded = s.changes(newest.id).length;

    const later = body(await bed.send({ type: "lre.fix", time: stamp(doc, start, start.clock + 2 * 24 * 60) }), "lre.fix");
    expect(s.changes(newest.id).slice(recorded).map((c) => ({ op: c.op, value: c.value, source: c.source }))).toEqual([{ op: "clock", value: { type: "clock", minutes: 2 * 24 * 60, cause: "advance" }, source: "player" }]);
    if (typeof later.undo !== "string") throw new Error("no Undo");
    expect(body(await bed.undo(later.undo), "lre.chip")).toEqual({ applied: true, pending: false });
    expect(s.headState(CHAT).state.world.clock).toBe(start.clock);

    const marked = s.changes(newest.id).length;
    const earlier = body(await bed.send({ type: "lre.fix", time: stamp(doc, start, start.clock - 60) }), "lre.fix");
    expect(s.changes(newest.id).slice(marked).map((c) => ({ op: c.op, minutes: (eventOf(c).data as JsonObject | undefined)?.minutes }))).toEqual([{ op: "engine.rewind", minutes: 60 }]);
    if (typeof earlier.undo !== "string") throw new Error("no Undo");
    expect(body(await bed.undo(earlier.undo), "lre.chip")).toEqual({ applied: true, pending: false });
    expect(s.headState(CHAT).state.world.clock).toBe(start.clock);
  });

  test("while a turn of the chat runs, changes nothing and says so, nor does an Undo; once it is over, each does", async () => {
    const bed = makeBed();
    await bed.plays("modern_slice_of_life");
    const newest = await bed.turn();
    const before = banked(await bed.state());
    const paid = body(await bed.send(PAY), "lre.action");
    if (!("undo" in paid) || typeof paid.undo !== "string") throw new Error("no Undo");
    const recorded = bed.store.user(USER).changes(newest.id).length;

    bed.running.add(CHAT);
    expect(refusal(await bed.send(PAY))).toEqual({ code: "conflict", message: words("turn_running") });
    expect(refusal(await bed.undo(paid.undo))).toEqual({ code: "conflict", message: words("turn_running") });
    expect(bed.store.user(USER).changes(newest.id)).toHaveLength(recorded);
    expect(banked(await bed.state())).toBe(before - 1500);

    bed.running.delete(CHAT);
    expect(body(await bed.undo(paid.undo), "lre.chip").applied).toBe(true);
    expect(banked(await bed.state())).toBe(before);
  });

  test("is undone whole or not at all: one the store keeps no undo for is left as it is, and the answer names it", async () => {
    const bed = makeBed();
    await bed.plays("fantasy_town");
    const newest = await bed.turn(async (apply) => {
      await apply([{ op: "quest", quest: "q_far_bank_fever", stage: "carry", source: { from: "prose", message: "msg-reply-ford" } }]);
    });
    const hinted = body(await bed.send({ type: "lre.fix", hint: "q_far_bank_fever" }), "lre.fix");
    if (typeof hinted.undo !== "string") throw new Error("no Undo");
    const recorded = bed.store.user(USER).changes(newest.id);

    expect(refusal(await bed.undo(hinted.undo))).toEqual({ code: "conflict", message: words("no_undo_for", { parts: [keyed("engine.hint")] }) });
    expect(bed.store.user(USER).changes(newest.id)).toEqual(recorded);
  });

  test("is counted by the next turn's world state among what the turn before changed", async () => {
    const bed = makeBed();
    await bed.plays("modern_slice_of_life");
    await bed.turn();
    body(await bed.send(PAY), "lre.action");
    const s = bed.store.user(USER);
    const next = await bed.writes.run(() => s.beginTurn({ chat: CHAT, kind: "normal" }));
    const block = worldState(s, { chat: CHAT, turn: next.id, layout: readFileSync(join(GUIDANCE, ".prompts", "world-state.md"), "utf8"), charsPerToken: 3.2 });
    const engine = (block.sections.changed ?? []).find((l) => l.fields.lane === "engine");
    expect(engine?.fields.ops).toEqual({ list: expect.arrayContaining(["post"]) });
    expect(block.text).toContain("post");
  });

  test("as a ✎ moves the player character, and its Undo moves them back", async () => {
    const bed = makeBed();
    const { doc } = await bed.plays("fantasy_town");
    await bed.turn();
    const view = await bed.state();
    const from = view.hud?.place?.id;
    const to = view.hud?.fixes.place?.options?.map((o) => o.value).find((p) => typeof p === "string" && p !== from);
    if (typeof from !== "string" || typeof to !== "string") throw new Error("no place to move to");

    const fixed = body(await bed.send({ type: "lre.fix", entity: doc.pov, field: "place", value: to }), "lre.fix");
    if (typeof fixed.undo !== "string") throw new Error("no Undo");
    expect((await bed.state()).hud?.place?.id).toBe(to);
    expect(body(await bed.undo(fixed.undo), "lre.chip")).toEqual({ applied: true, pending: false });
    const back = await bed.state();
    expect({ hud: back.hud?.place?.id, scene: back.scene?.placeId }).toEqual({ hud: from, scene: from });
  });

  test.skip("hardening: as a ✎ of cash, opens the accounts the world gave as the world's own, and records only the correction as the player's", async () => {
    const bed = makeBed();
    const { doc } = await bed.plays("mystery_manor");
    const newest = await bed.turn();
    const fixed = body(await bed.send({ type: "lre.fix", entity: doc.pov, field: "cash", value: 5000 }), "lre.fix");
    expect(bed.store.user(USER).changes(newest.id).map((c) => ({ op: c.op, source: c.source, standing: c.standing }))).toEqual([
      { op: "materialize", source: "default", standing: "assumed" },
      { op: "post", source: "player", standing: null },
      { op: "economy.txn", source: "player", standing: null },
    ]);
    if (typeof fixed.undo !== "string") throw new Error("no Undo");
    expect(body(await bed.undo(fixed.undo), "lre.chip")).toEqual({ applied: true, pending: false });
  });

  test.skip("hardening: as a ✎ of cash for someone the world gave no accounts, changes the cash they keep as a field and makes nothing up, and its Undo is whole", async () => {
    const bed = makeBed();
    // The manor's guest, kept by a world made so that they hold no accounts and keep their cash as a field.
    const doc = STARTER_WORLDS.mystery_manor?.("", "mystery_manor");
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
    const newest = await bed.turn();
    const before = s.headState(CHAT).state.world;

    const fixed = body(await bed.send({ type: "lre.fix", entity: doc.pov, field: "cash", value: 5000 }), "lre.fix");
    expect(s.changes(newest.id).map((c) => ({ op: c.op, source: c.source }))).toEqual([{ op: "set", source: "player" }]);
    const after = s.headState(CHAT).state.world;
    expect(after.entities[doc.pov]?.fields.cash).toBe(5000);
    // Nothing else: no account, no balance, no other field of anyone's.
    const was = after.entities[doc.pov];
    if (was === undefined) throw new Error("no point-of-view character");
    expect({ entities: { ...after.entities, [doc.pov]: { ...was, fields: { ...was.fields, cash: 4000 } } }, accounts: after.accounts }).toEqual({ entities: before.entities, accounts: before.accounts });

    if (typeof fixed.undo !== "string") throw new Error("no Undo");
    expect(body(await bed.undo(fixed.undo), "lre.chip")).toEqual({ applied: true, pending: false });
    const undone = s.headState(CHAT).state.world;
    expect({ entities: undone.entities, accounts: undone.accounts }).toEqual({ entities: before.entities, accounts: before.accounts });
  });

  test("names no one the player character does not know, in the file's words, and records nothing", async () => {
    const bed = makeBed();
    await bed.plays("modern_slice_of_life");
    const newest = await bed.turn();
    expect(refusal(await bed.send({ ...PAY, params: { to: "stranger_nobody_knows", amount: 1500 } }))).toEqual({ code: "validation", message: words("not_known", { action: "Pay" }) });
    expect(refusal(await bed.send({ type: "lre.fix", things: [] }))).toEqual({ code: "bad_request", message: words("things_count", { most: FIX_THINGS_MAX }) });
    expect(bed.store.user(USER).changes(newest.id)).toEqual([]);
  });

  test.skip("hardening: on a chat with no turn yet changes nothing, and says so", async () => {
    const bed = makeBed();
    await bed.plays("modern_slice_of_life");
    const before = banked(await bed.state());
    expect(refusal(await bed.send(PAY))).toEqual({ code: "unavailable", message: words("no_turn") });
    expect(banked(await bed.state())).toBe(before);
  });

  test.skip("hardening: in a branch with no turn of its own changes nothing, neither there nor in the chat it was branched from, and says so; once the branch has played a turn, it lands on that turn", async () => {
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

    expect(refusal(await bed.send(PAY, USER, BRANCH))).toEqual({ code: "unavailable", message: words("branch_no_turn") });
    expect(s.changes(shared.id)).toEqual([]);
    expect({ source: banked(await bed.state()), branch: banked(await bed.state({}, USER, BRANCH)) }).toEqual({ source: before, branch: before });

    const own = await bed.turn(undefined, BRANCH);
    const paid = body(await bed.send(PAY, USER, BRANCH), "lre.action");
    expect(s.changes(own.id).filter((c) => c.source === "player").map((c) => c.op)).toEqual(["post", "economy.txn"]);
    expect(s.changes(shared.id)).toEqual([]);
    expect({ source: banked(await bed.state()), branch: banked(await bed.state({}, USER, BRANCH)) }).toEqual({ source: before, branch: before - 1500 });
    if (!("undo" in paid) || typeof paid.undo !== "string") throw new Error("no Undo");
    expect(body(await bed.undo(paid.undo, USER, BRANCH), "lre.chip").applied).toBe(true);
    expect(banked(await bed.state({}, USER, BRANCH))).toBe(before);
  });

  test("on another user's chat is refused, and so is the Undo of another user's tap", async () => {
    const bed = makeBed();
    await bed.plays("modern_slice_of_life");
    await bed.turn();
    const paid = body(await bed.send(PAY), "lre.action");
    const after = banked(await bed.state());
    expect(refusal(await bed.send(PAY, OTHER))).toEqual({ code: "not_world_chat", message: words("not_world") });
    if (!("undo" in paid) || typeof paid.undo !== "string") throw new Error("no Undo");
    expect(refusal(await bed.undo(paid.undo, OTHER))).toEqual({ code: "not_found", message: words("no_undo") });
    expect(banked(await bed.state())).toBe(after);
  });
});

describe("what is not served", () => {
  test("answers today's unavailable error in the file's words, and changes nothing", async () => {
    const bed = makeBed();
    await bed.plays("fantasy_town");
    const newest = await bed.turn();
    bed.listen();
    const asked: [Record<string, unknown>, string, Record<string, unknown>?][] = [
      // A tap that does not manage is held or played now (`requests.test.ts`, `plays.test.ts`); a chip of the previous build's is no request this route serves.
      [{ type: "lre.chip", chip: "chip-1", choice: "confirm" }, "other", { type: "lre.chip" }],
      [{ type: "lre.things", scope: "gm", op: "list" }, "things"],
      [{ type: "lre.map", op: "walk", place: "market_square" }, "map"],
      [{ type: "lre.view.open", panel: "economy.money", entity: null }, "other", { type: "lre.view.open" }],
    ];
    for (const [message, line, fields] of asked) expect(refusal(await bed.send(message))).toEqual({ code: "unavailable", message: words(line, fields) });
    expect(bed.store.user(USER).changes(newest.id)).toEqual([]);
    expect(bed.heard).toEqual([]);
  });

  test("a chat's own choices read as RPE has them, each following and no engine of today's named; setting one is not served", async () => {
    const bed = makeBed();
    await bed.plays("fantasy_town");
    expect(body(await bed.send({ type: "lre.chat.knowledge", engines: true }), "lre.chat.knowledge")).toEqual({ knowledge: null, narrator: null });
    expect("engine" in (await bed.state())).toBe(false);
    expect(refusal(await bed.send({ type: "lre.chat.knowledge", knowledge: false }))).toEqual({ code: "unavailable", message: words("chat_choices") });
  });

  test("a message naming another chat than the path, or no message at all, is refused before anything is read", async () => {
    const bed = makeBed();
    await bed.plays("fantasy_town");
    await expect(bed.send({ ...PAY, chatId: "chat-elsewhere" })).rejects.toMatchObject({ status: 400 });
    await expect(bed.send({ type: "lre.action", action: "pay", source: "palette" })).rejects.toMatchObject({ status: 400 });
  });
});
