// Places made in play (ITEMS-SPEC §6.2, §12 Phase 3 "Places"), on Port Alder. The space pack's place
// ops: a room, a spot or a venue made under its parent, found first by name, alias or head noun, held
// to the per-chat cap, labelled, and removed only when empty. The `space.place` event keeps the
// world's own places the world's. The `place_make` change makes the place and moves who the story
// put there as one unit, and every reader sees it. Through the reply's read: "Jordan slides into the
// back booth at the Rusty Anchor" makes a spot under The Rusty Anchor with Jordan there, the next
// turn's "the booth" is it, a venue asks first, a reply makes at most its world's places per reply,
// and swipe, Branch and Undo fold identically, the reference fold with them.

import { describe, expect, test } from "bun:test";
import { toChain } from "../../../src/backend/ledger-io";
import { applyProposals, type ProposalOutcome } from "../../../src/backend/turn-model";
import type { LedgerCore } from "../../../src/engine/ledger/journal";
import { referenceFold } from "../../../src/engine/ledger/reference";
import { placeSaid } from "../../../src/engine/place-names";
import { findPlaces, isMadePlace, madePlaces, PLACE_EVENT, placeKindFor, placeOp } from "../../../src/engine/places-in-play";
import type { ReadContext } from "../../../src/engine/registry";
import { createRegistry } from "../../../src/engine/registry-impl";
import { placeOfEntity } from "../../../src/engine/scope";
import type { WorldState } from "../../../src/engine/state";
import { canSeePlace } from "../../../src/engine/visibility";
import { Working } from "../../../src/engine/working";
import { ALL_PACKS, STARTER_WORLDS } from "../../../src/packs/index";
import { sceneLines } from "../../../src/packs/space/core/feed";
import { hashJson } from "../../../src/shared/hash";
import type { JsonObject } from "../../../src/shared/json";
import type { LedgerEvent } from "../../../src/shared/ledger";
import type { PlaceOp } from "../../../src/shared/things";
import type { Chip } from "../../../src/shared/state-view";
import type { WorldDoc } from "../../../src/shared/world";
import { Rig } from "../../support/rig";
import { fold, startState } from "../support";

const reg = createRegistry(ALL_PACKS);

function portAlder(patch: Partial<WorldDoc> = {}): { world: WorldDoc; state: WorldState } {
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (!make) throw new Error("no Port Alder starter");
  const world = { ...make("pa", "Port Alder"), ...patch };
  return { world, state: startState(world, reg) };
}

const BOOTH: PlaceOp = { do: "make", name: "the back booth", parent: "rusty_anchor", as: "spot", why: "Jordan slides into it" };

/** A place op's events folded onto `state`, and the place it made; its refusal's code otherwise. */
function op(world: WorldDoc, state: Readonly<WorldState>, change: PlaceOp, by = "story"): { state: WorldState; made: string | undefined } | string {
  const out = placeOp(reg.context(world, state), change, { by, salt: "t" });
  return "code" in out ? out.code : { state: fold(reg, world, state, out.events), made: out.made };
}

function made(world: WorldDoc, state: Readonly<WorldState>, change: PlaceOp): { state: WorldState; id: string } {
  const out = op(world, state, change);
  if (typeof out === "string" || out.made === undefined) throw new Error(`refused: ${typeof out === "string" ? out : "nothing made"}`);
  return { state: out.state, id: out.made };
}

describe("place ops (ITEMS-SPEC §6.2, the space pack's `space.place_op`)", () => {
  test("a spot is made under its parent, as visible as it is, with what made it", () => {
    const { world, state } = portAlder();
    const { state: after, id } = made(world, state, BOOTH);
    const ctx = reg.context(world, after);
    expect(id).toMatch(/^place_the_back_booth_[0-9a-f]{8}$/);
    expect(ctx.world.places[id]).toMatchObject({ id, name: "The back booth", parent: "rusty_anchor", fields: {}, made: { as: "spot", by: "story", at: after.clock, why: "Jordan slides into it" } });
    expect(isMadePlace(ctx, id)).toBe(true);
    expect(isMadePlace(ctx, "rusty_anchor")).toBe(false);
    expect(canSeePlace(reg, ctx.world, after, "pov", id)).toBe(true);
    // The world document itself never changes.
    expect(world.places[id]).toBeUndefined();
  });

  test("found first: the same name, an alias or the head noun under the same parent is that place; elsewhere it isn't", () => {
    const { world, state } = portAlder();
    const { state: after, id } = made(world, state, { ...BOOTH, aliases: ["the corner seat"] });
    const exists = (change: PlaceOp): { code: string; exists?: string } => {
      const out = placeOp(reg.context(world, after), change, { by: "story", salt: "t2" });
      return "code" in out ? { code: out.code, ...(out.exists !== undefined ? { exists: out.exists } : {}) } : { code: "made" };
    };
    expect(exists(BOOTH)).toEqual({ code: "exists", exists: id });
    expect(exists({ ...BOOTH, name: "The Back Booth!" })).toEqual({ code: "exists", exists: id });
    expect(exists({ ...BOOTH, name: "the corner seat" })).toEqual({ code: "exists", exists: id });
    expect(exists({ ...BOOTH, name: "the booth" })).toEqual({ code: "exists", exists: id });
    // A more particular name, or another parent, is another place.
    expect(exists({ ...BOOTH, name: "the front booth" })).toEqual({ code: "made" });
    expect(exists({ ...BOOTH, parent: "bluebird_coffee" })).toEqual({ code: "made" });
    // A world place under that parent by that name is found too.
    expect(exists({ do: "make", name: "the Rusty Anchor", parent: "port_alder", as: "venue", why: "" })).toEqual({ code: "exists", exists: "rusty_anchor" });
  });

  test("the per-chat cap is the world's (`placeCap`), and a parent must be there", () => {
    const { world, state } = portAlder({ placeCap: 1 });
    const { state: after } = made(world, state, BOOTH);
    expect(op(world, after, { ...BOOTH, name: "the back office", parent: "alder_automotive", as: "room" })).toBe("place_cap");
    expect(op(portAlder({ placeCap: 0 }).world, state, BOOTH)).toBe("place_cap");
    expect(op(world, state, { ...BOOTH, parent: "atlantis" })).toBe("missing_place");
    expect(op(world, state, { ...BOOTH, name: "  " })).toBe("bad_name");
  });

  test("a label renames a made place or sets its aliases; the world's own places are Build's", () => {
    const { world, state } = portAlder();
    const { state: after, id } = made(world, state, BOOTH);
    const out = op(world, after, { do: "label", place: id, name: "Jordan's booth", aliases: ["the back booth"], description: "Cracked red vinyl." });
    if (typeof out === "string") throw new Error(out);
    expect(reg.context(world, out.state).world.places[id]).toMatchObject({ name: "Jordan's booth", fields: { aliases: ["The back booth"], description: "Cracked red vinyl." } });
    expect(op(world, out.state, { do: "label", place: id, name: "Jordan's booth" })).toBe("no_change");
    expect(op(world, after, { do: "label", place: "rusty_anchor", name: "The Anchor" })).toBe("not_made");
    const { state: two, id: office } = made(world, after, { ...BOOTH, name: "the front booth" });
    expect(op(world, two, { do: "label", place: office, name: "The back booth" })).toBe("exists");
  });

  test("a made place is removed only once nobody and nothing is in it and no place is inside it", () => {
    const { world, state } = portAlder();
    const { state: after, id } = made(world, state, BOOTH);
    const { state: inside } = made(world, after, { do: "make", name: "the table", parent: id, as: "spot", why: "" });
    expect(op(world, inside, { do: "remove", place: id })).toBe("occupied");
    const w = new Working(reg, world, after);
    for (const e of [{ type: "set", entity: "pov", field: "place", value: id }] as LedgerEvent[]) expect(w.apply(e)).toBeNull();
    expect(op(world, w.state, { do: "remove", place: id })).toBe("occupied");
    const removed = op(world, after, { do: "remove", place: id });
    if (typeof removed === "string") throw new Error(removed);
    expect(madePlaces(removed.state)).toEqual([]);
    expect(op(world, removed.state, { do: "remove", place: id })).toBe("gone");
    expect(op(world, after, { do: "remove", place: "rusty_anchor" })).toBe("not_made");
  });

  test("the `space.place` event never writes a world place, nor a place inside itself", () => {
    const { world, state } = portAlder();
    const { state: after, id } = made(world, state, BOOTH);
    const ctx = reg.context(world, after);
    const def = ctx.world.places[id] as unknown as JsonObject;
    const event = (data: JsonObject): LedgerEvent => ({ type: PLACE_EVENT, data });
    const check = (e: LedgerEvent): string | null => reg.get(PLACE_EVENT)?.validate(e, ctx)?.code ?? null;
    expect(check(event({ place: "rusty_anchor", def: { ...def, id: "rusty_anchor" } }))).toBe("not_made");
    expect(check(event({ place: id, def: { ...def, parent: id } }))).toBe("bad_parent");
    expect(check(event({ place: id, def: { ...def, parent: "atlantis" } }))).toBe("missing_place");
    expect(check(event({ place: id, def: { ...def, name: "" } }))).toBe("bad_place");
    expect(check(event({ place: "nowhere", gone: true }))).toBe("gone");
    expect(check(event({ place: id, def }))).toBeNull();
  });

  test("what a place made in a parent is, when the story doesn't say", () => {
    const { world } = portAlder();
    expect(placeKindFor(world, "port_alder", "the Tin Cup")).toBe("venue");
    expect(placeKindFor(world, "lakeshore_county", "a farm stand")).toBe("venue");
    expect(placeKindFor(world, "rusty_anchor", "the back booth")).toBe("spot");
    expect(placeKindFor(world, "harbor_street_114", "the kitchen")).toBe("room");
    expect(placeKindFor(world, "alder_automotive", "the parts room")).toBe("room");
  });

  test("findPlaces: made ones included, by parent, the nearest first", () => {
    const { world, state } = portAlder();
    const { state: one, id: back } = made(world, state, BOOTH);
    const { state: two, id: front } = made(world, one, { ...BOOTH, name: "the front booth", parent: "bluebird_coffee" });
    const ctx = reg.context(world, two);
    expect(findPlaces(ctx, "the back booth")).toEqual([{ id: back, name: "The back booth", parent: "rusty_anchor", made: true, matched: "name" }]);
    // Two booths answer "the booth": none, unless one is nearer.
    expect(findPlaces(ctx, "the booth")).toEqual([]);
    expect(findPlaces(ctx, "the booth", { near: "rusty_anchor" }).map((h) => h.id)).toEqual([back]);
    expect(findPlaces(ctx, "the booth", { parent: "bluebird_coffee" }).map((h) => [h.id, h.matched])).toEqual([[front, "head"]]);
    expect(findPlaces(ctx, "rusty_anchor").map((h) => h.matched)).toEqual(["id"]);
  });
});

/** Applies proposals through their channels on a copy of `state`, as a reply's read does. */
function read(world: WorldDoc, state: Readonly<WorldState>, proposals: JsonObject[]): { w: Working; outcomes: ProposalOutcome[] } {
  const w = new Working(reg, world, state);
  return { w, outcomes: applyProposals(reg, w, proposals, "seed", "run") };
}

describe("the `place_make` change (ITEMS-SPEC §5.2, §6.2)", () => {
  test("makes the spot and moves Jordan in, as one unit; Scene names it; the next change's \"the booth\" is it", () => {
    const { world, state } = portAlder();
    const { w, outcomes } = read(world, state, [{ type: "place_make", place: "The back booth", parent: "rusty_anchor", as: "spot", entity: "pov", why: "Jordan slides into the back booth" }]);
    expect(outcomes.map((o) => o.rejection?.code ?? null)).toEqual([null]);
    const [booth] = madePlaces(w.state);
    if (!booth) throw new Error("no booth");
    expect(booth).toMatchObject({ name: "The back booth", parent: "rusty_anchor", made: { as: "spot", by: "story" } });
    expect(placeOfEntity(w.state, "pov")).toBe(booth.id);
    const events = outcomes[0]?.events ?? [];
    expect(events[0]?.type).toBe(PLACE_EVENT);
    expect(new Set(events.map((e) => e.group)).size).toBe(1);
    expect(events[0]?.group).toBeDefined();
    // Every reader sees it: the scene names where Jordan is, and a name finds it.
    expect(sceneLines(w.ctx, "player").map((l) => l.text).join("\n")).toContain("The back booth");
    expect(placeSaid(reg, w.world, w.state, "the booth")).toBe(booth.id);
    const next = applyProposals(reg, w, [{ type: "location", entity: "danny_okafor", place: "the booth" }], "seed2", "run");
    expect(next.map((o) => o.rejection?.code ?? null)).toEqual([null]);
    expect(placeOfEntity(w.state, "danny_okafor")).toBe(booth.id);
  });

  test("a place it finds under the parent is moved into, never made twice; one that moves no one and finds its place changes nothing", () => {
    const { world, state } = portAlder();
    const { state: after, id } = made(world, state, BOOTH);
    const { w, outcomes } = read(world, after, [
      { type: "place_make", place: "the booth", parent: "rusty_anchor", entity: "pov" },
      { type: "place_make", place: "the back booth", parent: "rusty_anchor" },
    ]);
    expect(outcomes.map((o) => o.rejection?.code ?? null)).toEqual([null, "no_change"]);
    expect(madePlaces(w.state).map((p) => p.id)).toEqual([id]);
    expect(placeOfEntity(w.state, "pov")).toBe(id);
  });

  test("refused as it can't land: no parent, a parent nobody can see, the cap", () => {
    const { world, state } = portAlder({ placeCap: 0 });
    const codes = read(world, state, [
      { type: "place_make", place: "the back booth", entity: "pov" },
      { type: "place_make", place: "the back booth", parent: "nowhere", entity: "pov" },
      { type: "place_make", place: "the back booth", parent: "rusty_anchor", entity: "pov" },
    ]).outcomes.map((o) => o.rejection?.code ?? null);
    expect(codes).toEqual(["missing_place", "missing_place", "place_cap"]);
  });
});

// ---------------------------------------------------------------- through the reply's read

const EXTRACT_MARK = "You read a narrator's roleplay reply";

async function chat(): Promise<{ rig: Rig; chatId: string }> {
  const rig = new Rig({ shipped: true });
  const worldId = await rig.newWorld("Port Alder", "modern_slice_of_life");
  const chatId = rig.host.createChat("Evening.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  return { rig, chatId };
}

/** The read answers with `proposals`, each turn alike. */
function reads(rig: Rig, proposals: JsonObject[]): void {
  rig.host.quietReply = (req) => ((req.messages[0]?.content ?? "").includes(EXTRACT_MARK) ? JSON.stringify({ proposals }) : "{}");
}

async function coreOf(rig: Rig, chatId: string): Promise<LedgerCore> {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  if (!core) throw new Error("no ledger");
  return core;
}

/** The chat's head: the optimized fold's state, after checking the reference fold folds the same. */
async function head(rig: Rig, chatId: string): Promise<{ state: WorldState; ctx: ReadContext }> {
  const core = await coreOf(rig, chatId);
  const observed = toChain(await rig.host.chats.messages(chatId, rig.host.userId));
  const optimized = core.fold(observed);
  const reference = referenceFold(core.foldInput(observed), rig.rt.registry);
  expect(hashJson(reference.state)).toBe(hashJson(optimized.state));
  expect(reference.violations).toEqual([]);
  const world = core.playedAt(optimized.state);
  if (!world) throw new Error("no world");
  return { state: optimized.state, ctx: rig.rt.registry.context(world, optimized.state) };
}

async function chips(rig: Rig, chatId: string): Promise<Chip[]> {
  return (await rig.rt.view(chatId, rig.host.userId)).chips;
}

async function move(rig: Rig, chatId: string, entity: string, place: string): Promise<void> {
  rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "move", entity, to: place }] }));
}

const SLIDES = { type: "location", entity: "pov", place: "the back booth", parent: "rusty_anchor", why: "Jordan slides into the back booth" };

describe("places the reply makes (ITEMS-SPEC §12 Phase 3)", () => {
  test("\"Jordan slides into the back booth at the Rusty Anchor\": a spot under The Rusty Anchor, Jordan there, with Undo; the next turn's \"the booth\" is it", async () => {
    const { rig, chatId } = await chat();
    await move(rig, chatId, "pov", "rusty_anchor");
    reads(rig, [SLIDES]);
    await rig.turn(chatId, "I grab a seat.", "Jordan slides into the back booth at the Rusty Anchor.");
    const { state, ctx } = await head(rig, chatId);
    const [booth] = madePlaces(state);
    expect(booth).toMatchObject({ name: "The back booth", parent: "rusty_anchor", made: { as: "spot", by: "story", why: "Jordan slides into the back booth" } });
    expect(placeOfEntity(state, "pov")).toBe(booth?.id ?? "");
    expect(canSeePlace(rig.rt.registry, ctx.world, state, "pov", booth?.id ?? "")).toBe(true);
    const chip = (await chips(rig, chatId)).find((c) => c.kind === "undo" && c.label === "You went to The back booth, in The Rusty Anchor (a new place)");
    expect(chip).toBeDefined();
    // The next reply's read is offered it, and its "the booth" is it.
    reads(rig, [{ type: "location", entity: "danny_okafor", place: "the booth" }]);
    let offered = "";
    const answer = rig.host.quietReply;
    rig.host.quietReply = (req) => {
      const text = req.messages.map((m) => m.content).join("\n");
      if (text.includes(EXTRACT_MARK)) offered = text;
      return answer?.(req) ?? "{}";
    };
    await rig.turn(chatId, "I wave Danny over.", "Danny slides into the booth across from Jordan.");
    expect(offered).toContain(booth?.id ?? "?");
    const after = await head(rig, chatId);
    expect(placeOfEntity(after.state, "danny_okafor")).toBe(booth?.id ?? "");
    expect(madePlaces(after.state).length).toBe(1);
  });

  test("swipe, Branch and Undo fold identically", async () => {
    const { rig, chatId } = await chat();
    await move(rig, chatId, "pov", "rusty_anchor");
    reads(rig, [SLIDES]);
    await rig.turn(chatId, "I grab a seat.", "Jordan slides into the back booth at the Rusty Anchor.");
    const first = await head(rig, chatId);
    const reply = rig.host.head(chatId);
    if (!reply) throw new Error("no reply");
    // A swipe reads its reply again, on its own record; going back to the first folds as before.
    await rig.host.finish(await rig.host.start(chatId, { type: "swipe" }), "Jordan slides into the back booth at the Rusty Anchor.");
    const swiped = await head(rig, chatId);
    expect(madePlaces(swiped.state).map((p) => [p.name, p.parent])).toEqual([["The back booth", "rusty_anchor"]]);
    expect(placeOfEntity(swiped.state, "pov")).toBe(madePlaces(swiped.state)[0]?.id ?? "");
    rig.host.navigate(chatId, reply.id, 0);
    await rig.host.settle();
    expect(hashJson((await head(rig, chatId)).state)).toBe(hashJson(first.state));
    // A branch at the reply folds to the same state.
    const branch = rig.host.branch(chatId, reply.id);
    await rig.rt.ledger.core(branch, rig.host.userId);
    await rig.host.settle();
    expect(hashJson((await head(rig, branch)).state)).toBe(hashJson(first.state));
    // Undo takes the place and the move back together.
    const chip = (await chips(rig, chatId)).find((c) => c.kind === "undo" && c.label.includes("The back booth"));
    if (!chip) throw new Error("no Undo");
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: chip.id, choice: "undo" }));
    const undone = await head(rig, chatId);
    expect(madePlaces(undone.state)).toEqual([]);
    expect(placeOfEntity(undone.state, "pov")).toBe("rusty_anchor");
    expect(undone.ctx.world.places[madePlaces(first.state)[0]?.id ?? ""]).toBeUndefined();
  });

  test("a venue new in town asks first; Apply makes it, with Jordan there", async () => {
    const { rig, chatId } = await chat();
    reads(rig, [{ type: "location", entity: "pov", place: "the Tin Cup", parent: "port_alder", why: "Jordan tries the new bar on Front Street" }]);
    await rig.turn(chatId, "I head out.", "Jordan tries the Tin Cup, the new bar on Front Street.");
    expect(madePlaces((await head(rig, chatId)).state)).toEqual([]);
    const chip = (await chips(rig, chatId)).find((c) => c.kind === "confirm" && c.label === "You went to The Tin Cup, in Port Alder (a new place)");
    if (!chip) throw new Error(`no confirm chip: ${(await chips(rig, chatId)).map((c) => `${c.kind} ${c.label}`).join("; ")}`);
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: chip.id, choice: "confirm" }));
    const { state } = await head(rig, chatId);
    const [bar] = madePlaces(state);
    expect(bar).toMatchObject({ name: "The Tin Cup", parent: "port_alder", made: { as: "venue" } });
    expect(placeOfEntity(state, "pov")).toBe(bar?.id ?? "");
  });

  test("a reply makes at most its world's places per reply; past it, a Not tracked receipt", async () => {
    const { rig, chatId } = await chat();
    await move(rig, chatId, "pov", "rusty_anchor");
    reads(rig, [
      { type: "location", entity: "danny_okafor", place: "the back booth", parent: "rusty_anchor" },
      { type: "location", entity: "jess_kowalczyk", place: "the dartboard corner", parent: "rusty_anchor" },
      { type: "location", entity: "pov", place: "the pool table", parent: "rusty_anchor" },
    ]);
    await rig.turn(chatId, "I look around.", "Danny takes the back booth, Jess the dartboard corner, and Jordan the pool table.");
    const { state } = await head(rig, chatId);
    expect(madePlaces(state).map((p) => p.name)).toEqual(["The back booth", "The dartboard corner"]);
    expect(placeOfEntity(state, "pov")).toBe("rusty_anchor");
    expect((await chips(rig, chatId)).some((c) => c.kind === "untracked" && (c.detail ?? "").includes("2 new places already"))).toBe(true);
  });
});
