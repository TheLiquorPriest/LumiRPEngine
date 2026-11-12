// No reader takes a world without its state (ITEMS-SPEC §6.2, §13). Places made in play live in the
// chat's state, so a world document read apart from the state it is played in misses them. Every
// world a play-time reader is handed comes through a boundary that takes the state and overlays them
// once (`playedWorld(world, state)`, `LedgerCore.playedAt(state)`, `registry.context(world, state)`,
// a `Working`). The bare revision lookups (`worldAt`, an env's `worlds`, the world store's `get` and
// `cached`) stay in the few places that read a revision as authored, or hand it straight to one of
// those boundaries, each listed here with why: a new one fails until it is overlaid or listed. The
// overlay itself is checked here too: identity while nothing is made, the world's own places winning,
// a Working seeing a place made in it, idempotence, and a copy of a played world never keeping a
// place the state took away.

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { JsonObject } from "../../src/shared/json";
import type { LedgerEvent } from "../../src/shared/ledger";
import type { WorldDoc } from "../../src/shared/world";
import { baseWorld, madePlaces, PLACE_EVENT, placeOp, playedWorld } from "../../src/engine/places-in-play";
import { chatDraftOf, draftChanges, draftEvent } from "../../src/engine/world-draft";
import { createRegistry } from "../../src/engine/registry-impl";
import type { WorldState } from "../../src/engine/state";
import { Working } from "../../src/engine/working";
import { ALL_PACKS, STARTER_WORLDS } from "../../src/packs/index";
import { fold, startState } from "../packs/support";

const SRC = resolve(import.meta.dir, "../../src");

/** The code that reads a world while a chat plays: the engine, the backend and its worker, and the packs' cores. */
const PLAY_ZONES = ["engine", "backend", "worker", "packs"];

/** A bare revision lookup: what reads a world document without the state it is played in. */
const RAW = /\b(?:worldAt|worlds)\s*\(|\.worlds\.(?:get|getMany|cached)\s*\(/;

/** Each bare lookup allowed: its file, a text its line holds, how many such lines, and why it may read a revision as authored. */
const ALLOWED: readonly { file: string; has: string; count: number; why: string }[] = [
  { file: "engine/ledger/fold.ts", has: "input.worlds(", count: 5, why: "the fold: its reads go through `types.context`, which plays the world over the state; the rest look for a revision or start the state, before anything is made" },
  { file: "engine/ledger/reference.ts", has: "input.worlds(", count: 5, why: "the reference fold, as the fold" },
  { file: "engine/ledger/journal.ts", has: "worlds(revision: RevisionId): WorldDoc | undefined;", count: 1, why: "the env's lookup, declared" },
  { file: "engine/ledger/journal.ts", has: "worldAt(revision: RevisionId)", count: 1, why: "`worldAt`, a revision as authored, declared" },
  { file: "engine/ledger/journal.ts", has: "return this.env.worlds(revision);", count: 1, why: "`worldAt` itself" },
  { file: "engine/ledger/journal.ts", has: "const world = this.env.worlds(revision);", count: 1, why: "`playedAt`, which plays it over the state" },
  { file: "engine/ledger/journal.ts", has: "worlds: (r) => this.env.worlds(r),", count: 1, why: "the fold's input" },
  { file: "engine/ledger/journal.ts", has: "this.env.worlds(scratch.revision)", count: 1, why: "a carried fix, read through `types.context`" },
  { file: "engine/ledger/journal.ts", has: "const world = this.env.worlds(state.revision);", count: 2, why: "`prefixState`, which hands its world out played over its state, and the held writes, read through `types.context` and `resolveFix`" },
  { file: "engine/ledger/journal.ts", has: "const world = this.env.worlds(head.state.revision);", count: 2, why: "a Continue's suffix, read through `types.context`" },
  { file: "engine/upgrade.ts", has: "worlds(revision: RevisionId): WorldDoc | undefined;", count: 1, why: "the marker env's lookup, declared" },
  { file: "engine/upgrade.ts", has: "env.worlds(revision)", count: 1, why: "an Upgrade compares revisions as authored; its reads of the state go through `types.context`" },
  { file: "backend/runtime.ts", has: "this.worlds.get(run.worldId, userId, run.revision)).world;", count: 1, why: "the env's pinned revision" },
  { file: "backend/runtime.ts", has: "this.worlds.cached(userId, run.worldId, revision)", count: 1, why: "the env's lookup, by revision" },
  { file: "backend/runtime.ts", has: "await this.worlds.getMany(run.worldId, userId, wanted)", count: 1, why: "the env's pins, read together" },
  { file: "backend/runtime.ts", has: "sectionsOf((await this.worlds.get(", count: 2, why: "the world's sections, which name no place" },
  { file: "backend/runtime.ts", has: "world: (r) => core.worldAt(r)", count: 1, why: "`buildView`'s lookup, which it plays over the head state" },
  { file: "backend/agents/turn-task.ts", has: "worlds: (revision) => d.core.worldAt(revision)", count: 1, why: "the digest's Upgrade lines: the marker env an Upgrade's plan and merge read their revisions through, as authored, as the fold's does" },
  { file: "backend/agents/turn-task.ts", has: "const was = env.worlds(before.revision);", count: 1, why: "the digest's Upgrade lines: an entity's classes and tags as the revision before the Upgrade authors them, to compare it across the Upgrade as the Upgrade does" },
  { file: "backend/agents/turn-task.ts", has: "const now = env.worlds(after.revision);", count: 1, why: "the digest's Upgrade lines: an entity's classes and tags as the revision after it authors them" },
  { file: "backend/dispatch.ts", has: "const { world } = await this.rt.worlds.get(worldId, userId);", count: 1, why: "the world's book follows its head revision as authored" },
  { file: "backend/upgrade-preview.ts", has: "(await rt.worlds.get(run.worldId, userId, revision)).world", count: 1, why: "an Upgrade preview's revisions, as authored" },
  { file: "backend/agents/tools/harness-ports.ts", has: "rt.book.ensure((await rt.worlds.get(worldId, userId)).world", count: 1, why: "the world's book follows its head revision as authored, after an agent's commit as after Build's" },
  { file: "backend/agents/tools/harness-ports.ts", has: "revision: async (revision) => (await rt.worlds.get(worldId, userId, revision)).world", count: 1, why: "the world tools compare a draft with a revision as authored, for the review card; nothing is played from it" },
  { file: "backend/jobs.ts", has: "await this.worlds.get(worldId, job.userId)", count: 1, why: "a Build job, on the world as authored" },
];

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (/\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

/** Every bare lookup in play-time code that isn't a comment, as `file: line`. Pack UIs draw a view the backend built, so they're left out. */
function rawLookups(): { file: string; line: string }[] {
  const out: { file: string; line: string }[] = [];
  for (const zone of PLAY_ZONES) {
    for (const path of sources(join(SRC, zone))) {
      const file = relative(SRC, path).split("\\").join("/");
      if (/^packs\/[^/]+\/ui\//.test(file) || file.startsWith("packs/starters/")) continue;
      for (const line of readFileSync(path, "utf8").split("\n")) {
        const code = line.trim();
        if (code.startsWith("//") || code.startsWith("*") || !RAW.test(code)) continue;
        out.push({ file, line: code });
      }
    }
  }
  return out;
}

const reg = createRegistry(ALL_PACKS);

function portAlder(): { world: WorldDoc; state: WorldState } {
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (!make) throw new Error("no Port Alder starter");
  const world = make("pa", "Port Alder");
  return { world, state: startState(world, reg) };
}

/** The back booth made under The Rusty Anchor, folded onto `state`, and its id. */
function withBooth(world: WorldDoc, state: Readonly<WorldState>): { state: WorldState; booth: string } {
  const out = placeOp(reg.context(world, state), { do: "make", name: "The back booth", parent: "rusty_anchor", as: "spot", why: "Jordan sits there" }, { by: "story", salt: "test" });
  if ("code" in out || out.made === undefined) throw new Error(`refused: ${"code" in out ? out.code : "no place"}`);
  return { state: fold(reg, world, state, out.events), booth: out.made };
}

describe("no reader takes a world without its state (ITEMS-SPEC §6.2, §13)", () => {
  test("every bare revision lookup in play-time code is one listed, as many times as listed", () => {
    const found = rawLookups();
    const unlisted = found.filter((r) => !ALLOWED.some((a) => a.file === r.file && r.line.includes(a.has))).map((r) => `${r.file}: ${r.line}`);
    expect(unlisted).toEqual([]);
    const counts = ALLOWED.map((a) => ({ file: a.file, has: a.has, count: found.filter((r) => r.file === a.file && r.line.includes(a.has)).length }));
    expect(counts).toEqual(ALLOWED.map((a) => ({ file: a.file, has: a.has, count: a.count })));
  });

  test("the overlay: the world itself while nothing is made; the same played world for the same slice; idempotent", () => {
    const { world, state } = portAlder();
    expect(playedWorld(world, state)).toBe(world);
    expect(reg.context(world, state).world).toBe(world);
    const { state: made, booth } = withBooth(world, state);
    const played = playedWorld(world, made);
    expect(played).not.toBe(world);
    expect(played.places[booth]?.name).toBe("The back booth");
    expect(world.places[booth]).toBeUndefined();
    expect(playedWorld(world, made)).toBe(played);
    expect(playedWorld(played, made)).toBe(played);
    expect(baseWorld(played)).toBe(world);
    expect(reg.context(played, made).world).toBe(played);
    // The world's own places first, in its order, then the made ones.
    expect(Object.keys(played.places)).toEqual([...Object.keys(world.places), booth]);
  });

  test("the world's own place wins a collision: a made place under an id the world has is the world's", () => {
    const { world, state } = portAlder();
    const { state: made, booth } = withBooth(world, state);
    const kept: WorldDoc = { ...world, places: { ...world.places, [booth]: { id: booth, name: "The corner booth", parent: "rusty_anchor", fields: {} } } };
    const played = playedWorld(kept, made);
    expect(played.places[booth]?.name).toBe("The corner booth");
    expect(played).toBe(kept);
    expect(madePlaces(made).map((p) => p.id)).toEqual([booth]);
  });

  test("a Working sees a place made by an event it applied, and its moves check against it", () => {
    const { world, state } = portAlder();
    const w = new Working(reg, world, state);
    expect(w.world).toBe(world);
    const out = placeOp(w.ctx, { do: "make", name: "The back booth", parent: "rusty_anchor", as: "spot", why: "" }, { by: "story", salt: "w" });
    if ("code" in out || out.made === undefined) throw new Error("refused");
    for (const e of out.events) expect(w.apply(e)).toBeNull();
    expect(w.world.places[out.made]?.parent).toBe("rusty_anchor");
    expect(w.ctx.world.places[out.made]).toBeDefined();
    // A mark taken before, restored: the place is gone again.
    const mark = w.mark();
    const gone: LedgerEvent = { type: PLACE_EVENT, data: { place: out.made, gone: true } };
    expect(w.apply(gone)).toBeNull();
    expect(w.world.places[out.made]).toBeUndefined();
    w.restore(mark);
    expect(w.world.places[out.made]).toBeDefined();
  });

  test("a copy of a played world never keeps a place the state has since taken away", () => {
    const { world, state } = portAlder();
    const { state: made, booth } = withBooth(world, state);
    const copy: WorldDoc = { ...playedWorld(world, made), lore: {} };
    expect(copy.places[booth]).toBeDefined();
    const removed = fold(reg, world, made, [{ type: PLACE_EVENT, data: { place: booth, gone: true } }]);
    expect(playedWorld(copy, removed).places[booth]).toBeUndefined();
    expect(reg.context(copy, removed).world.places[booth]).toBeUndefined();
    expect(Object.keys(baseWorld(copy).places)).toEqual(Object.keys(world.places));
  });
});

describe("this chat's own world (DEPTH2-PLAN §2: the chat plays its own working draft of the world)", () => {
  const PATH = { id: "rt_lane", from: "harbor_street_114", to: "rusty_anchor", modes: { walk: { minutes: 7 } }, bidirectional: true };

  test("a path laid in play plays at once, folds alike, and is gone without its event", () => {
    const { world, state } = portAlder();
    const laid = draftEvent(world, chatDraftOf(state), { collection: "routes", id: "rt_lane", value: PATH });
    const w = new Working(reg, world, state);
    expect(w.apply(laid)).toBeNull();
    expect(w.world.routes.rt_lane).toEqual(PATH);
    expect(world.routes.rt_lane).toBeUndefined();
    // The same record folded again plays the same world.
    const folded = fold(reg, world, state, [laid]);
    expect(playedWorld(world, folded).routes.rt_lane).toEqual(PATH);
    expect(draftChanges(world, chatDraftOf(folded))).toEqual([{ collection: "routes", id: "rt_lane", value: PATH }]);
    expect(playedWorld(world, state)).toBe(world);
  });

  test("the world's own item wins once it is no longer what the change was made over; a change back is no change", () => {
    const { world, state } = portAlder();
    const [id, own] = Object.entries(world.routes).find(([, r]) => r.map === undefined) ?? [];
    if (!id || !own) throw new Error("no authored route in Port Alder");
    const slower = { ...own, modes: { walk: { minutes: 99 } } };
    const changed = fold(reg, world, state, [draftEvent(world, chatDraftOf(state), { collection: "routes", id, value: slower })]);
    expect(playedWorld(world, changed).routes[id]).toEqual(slower);
    // Laid over a revision it wasn't carried to (an Upgrade carries it: `carryDraft`), the revision's own item plays.
    const edited = { ...world, routes: { ...world.routes, [id]: { ...own, modes: { walk: { minutes: 3 } } } } };
    expect(playedWorld(edited, changed).routes[id]?.modes.walk?.minutes).toBe(3);
    // Written back as the world has it, the change goes.
    const back = fold(reg, world, changed, [draftEvent(world, chatDraftOf(changed), { collection: "routes", id, value: own as unknown as JsonObject })]);
    expect(draftChanges(world, chatDraftOf(back))).toEqual([]);
  });

  test("a change that would leave someone nowhere is refused, and a copy of a played world never keeps a path the state took away", () => {
    const { world, state } = portAlder();
    const w = new Working(reg, world, state);
    const home = "harbor_street_114";
    expect(w.apply(draftEvent(world, chatDraftOf(state), { collection: "places", id: home, gone: true }))?.code).toBe("leaves_out");
    const laid = fold(reg, world, state, [draftEvent(world, chatDraftOf(state), { collection: "routes", id: "rt_lane", value: PATH })]);
    const copy: WorldDoc = { ...playedWorld(world, laid), lore: {} };
    expect(copy.routes.rt_lane).toBeDefined();
    expect(baseWorld(copy).routes.rt_lane).toBeUndefined();
    expect(reg.context(copy, state).world.routes.rt_lane).toBeUndefined();
  });
});
