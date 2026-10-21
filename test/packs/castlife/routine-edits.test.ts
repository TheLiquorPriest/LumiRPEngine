// A chat's own routine changes and the routine read model (DESIGN §8, §24.9): the GM's three controls
// (`routine_follow`, `routine_block`, `schedule_override`) fold the same in the reference and the
// optimized folds, change the day, are listed as changed, and an Undo lands exactly where the chat was.
// The GM reads each block's owner, source and what it shadows; the player reads only what Cast may.

import { describe, expect, test } from "bun:test";
import { hashJson } from "../../../src/shared/hash";
import type { EventRef, LedgerEvent } from "../../../src/shared/ledger";
import type { RoutineEditOp } from "../../../src/shared/routines";
import type { WorldDoc } from "../../../src/shared/world";
import { resolveEdit } from "../../../src/engine/edits";
import type { ReadContext } from "../../../src/engine/registry";
import type { WorldState } from "../../../src/engine/state";
import type { Working } from "../../../src/engine/working";
import { dayPlan } from "../../../src/packs/castlife/core/index";
import { routineChanges, routineGmView, routinePlayerView } from "../../../src/packs/castlife/core/view";
import { at, fixed, foldBoth, gmEdit, record, reg, routine, town, townWorld, withRoutines, YOU } from "./town";
import { applyEffects } from "../../../src/engine/effects";
import { createRng } from "../../../src/engine/rng";
import { calendarOf, dateAt } from "../../../src/engine/calendar";

/** Maya's own evening at the Anchor, asking Alex along; she is fond of Alex. */
function mayaWorld(): WorldDoc {
  return townWorld((wd) => {
    withRoutines(wd, [routine("r_maya", "maya", [fixed("evening", "18:00", 180, { place: "pub" }, { label: "Evening out", activity: "drinks", company: { who: { ids: [YOU] }, invite: true } })])]);
    wd.entities.maya?.relations.push({ type: "regard", to: YOU, fields: { warmth: 60, trust: 60, respect: 60, t: 0 } });
  });
}

describe("the GM's routine controls in a chat", () => {
  test("each folds the same in both folds, changes her day, is listed as changed, and Undo lands exactly back", () => {
    const world = mayaWorld();
    const fixes: LedgerEvent[][] = [];
    const states: WorldState[] = [foldBoth(world, [], fixes).state];
    /** The control as `lre.edit` resolves it on the chat as folded so far: one more `fix` entry. */
    const edit = (op: RoutineEditOp): ReadContext => {
      const out = resolveEdit(reg, world, states.at(-1) ?? states[0], [op], { gm: true, runSeed: "seed" });
      if ("rejection" in out) throw new Error(`refused: ${out.rejection.reason}`);
      fixes.push(out.events);
      const state = foldBoth(world, [], fixes).state;
      states.push(state);
      return reg.context(world, state);
    };
    const friday = (ctx: ReadContext): string[] => dayPlan(ctx, "maya", 0).blocks.map((b) => `${b.option} ${b.place ?? "-"}`);

    let ctx = edit({ op: "routine_follow", entity: "maya", mode: "no_invitations" });
    expect(routineGmView(ctx, "maya", 0).follow).toEqual({ mode: "no_invitations", awareness: "balanced", role: "enforced", chat: { mode: "no_invitations", awareness: null, role: null } });
    expect(routineGmView(ctx, "maya", 0).invitations.made).toEqual([]);
    // A part left out is kept.
    ctx = edit({ op: "routine_follow", entity: "maya", awareness: "story_first" });
    expect(routineGmView(ctx, "maya", 0).follow.chat).toEqual({ mode: "no_invitations", awareness: "story_first", role: null });
    ctx = edit({ op: "routine_block", entity: "maya", block: "evening", value: { id: "evening", label: "Settling up", activity: "errand", kind: "fixed", at: "18:00", minutes: 60, place: { place: "bank" } } });
    expect(friday(ctx)).toContain("routine:evening bank");
    ctx = edit({ op: "routine_block", entity: "maya", block: "dinner", value: { id: "dinner", off: true } });
    expect(friday(ctx).some((b) => b.startsWith("routine:dinner"))).toBe(false);
    ctx = edit({ op: "schedule_override", entity: "maya", schedule: "maya_place", value: { off: true, until: null } });
    expect(routineGmView(ctx, "maya", 0).schedules.find((s) => s.schedule === "maya_place")?.chat).toMatchObject({ off: true, until: null, source: { type: "gm" } });
    ctx = edit({ op: "schedule_override", entity: "maya", schedule: "maya_shift", value: { slots: [{ start: "10:00", end: "16:00", value: "work_shift" }] } });
    const shift = dayPlan(ctx, "maya", 0).blocks.find((b) => b.option.startsWith("schedule:maya_shift"));
    expect([shift?.start, shift?.end]).toEqual([at(ctx, 0, "10:00"), at(ctx, 0, "16:00")]);

    expect(routineChanges(ctx)).toEqual([
      {
        entity: "maya",
        name: "Maya Chen",
        follow: { mode: "no_invitations", awareness: "story_first", role: null },
        blocks: [
          { block: "evening", source: { type: "gm", at: at(ctx, 0, "07:30") }, off: false },
          { block: "dinner", source: { type: "gm", at: at(ctx, 0, "07:30") }, off: true },
        ],
        schedules: [
          { schedule: "maya_place", source: { type: "gm", at: at(ctx, 0, "07:30") }, off: true },
          { schedule: "maya_shift", source: { type: "gm", at: at(ctx, 0, "07:30") }, off: false },
        ],
      },
    ]);

    // Undo takes back the latest edits, one entry at a time, and both folds land exactly where the
    // chat stood before them; undoing them all leaves no change of hers to list.
    const undo = (count: number): EventRef[] => Array.from({ length: count }, (_, i) => ({ in: "post" as const, seq: fixes.length - i, index: 0 }));
    for (let k = 1; k <= fixes.length; k++) expect(hashJson(foldBoth(world, [], fixes, undo(k)).state)).toBe(hashJson(states[fixes.length - k]));
    expect(routineChanges(reg.context(world, foldBoth(world, [], fixes, undo(fixes.length)).state))).toEqual([]);
  });

  test("a control names a person and one of their own schedules", () => {
    const w = town((wd) => withRoutines(wd, []));
    const refused = (op: RoutineEditOp): boolean => "rejection" in resolveEdit(reg, w.world, w.state, [op], { gm: true, runSeed: "seed" });
    expect(refused({ op: "routine_follow", entity: "chen_household", mode: "off" })).toBe(true);
    expect(refused({ op: "schedule_override", entity: "maya", schedule: "jordan_work", value: { off: true, until: null } })).toBe(true);
    expect(refused({ op: "schedule_override", entity: "maya", schedule: "no_such_schedule", value: null })).toBe(true);
    expect(refused({ op: "routine_block", entity: "maya", block: "nap", value: { id: "nap", label: "Nap", activity: "sleep", kind: "fixed", minutes: 30 } })).toBe(true);
    expect(refused({ op: "routine_follow", entity: "maya", mode: "off" })).toBe(false);
  });
});

describe("the routine read model", () => {
  /**
   * Maya's routine from every kind of source: the world's default (authored), her household's (a
   * secret lore entry), her own (public lore, a sheet field, a private block), and this chat's (the
   * GM's, and the story's from a turn). Alex, whom she knows, is at the café with her; Vik, a
   * stranger, walks in the park.
   */
  function sourced(): Working {
    const w = town((wd) => {
      wd.lore.anchor_nights = { id: "anchor_nights", title: "Friday nights at the Anchor", content: "Maya pours at the Anchor on Friday nights.", keys: [], links: [] };
      wd.lore.chen_debts = { id: "chen_debts", title: "The Chens' debts", content: "The Chens owe the bank more than they let on.", keys: [], links: [], secret: true, gate: "false" };
      withRoutines(wd, [
        routine("r_world", undefined, [fixed("evening", "18:00", 180, { place: "park" }, { label: "A walk" })]),
        routine("r_chens", "chen_household", [fixed("evening", "18:00", 180, { place: "market" }, { label: "Minds the stall", source: { type: "lore", entry: "chen_debts", quote: "work the stall to pay it down" } })]),
        routine("r_maya", "maya", [
          fixed("evening", "18:00", 180, { place: "pub" }, { label: "Pours pints", activity: "work", company: { who: { ids: ["rosa"] } }, source: { type: "lore", entry: "anchor_nights", quote: "on Friday nights" } }),
          fixed("ledger", "15:00", 30, "home", { label: "Goes over the accounts", activity: "accounts", source: { type: "lore", entry: "chen_debts", quote: "every afternoon" } }),
          fixed("sketch", "16:00", 45, "home", { label: "Sketches", activity: "leisure", private: true, source: { type: "sheet", entity: "maya", field: "hobbies", quote: "draws in a little notebook" } }),
        ]),
      ]);
      wd.entities.maya?.relations.push({ type: "regard", to: YOU, fields: { warmth: 30, trust: 30, respect: 30, t: 0 } });
      wd.entities.vik = { id: "vik", kind: "person", name: "Vik Sorensen", tier: "principal", fields: { place: "park", home: "park" }, relations: [], agent: true };
      const you = wd.entities[YOU];
      if (you) you.fields.place = "cafe";
    });
    gmEdit(w, [{ op: "routine_block", entity: "maya", block: "tea", value: { id: "tea", label: "Tea break", activity: "leisure", kind: "fixed", at: "14:30", minutes: 30, place: { place: "cafe" } } }]);
    // The story's own change, as the reply's read records it, told the day before: a block the story
    // adds is theirs from the day after its turn, so it's in her day today.
    record(w, [{ type: "castlife.routine", data: { entity: "maya", block: "swim", value: { id: "swim", label: "A late swim", activity: "exercise", kind: "fixed", at: "21:00", minutes: 30, place: { place: "lake" } }, source: { type: "story", at: w.state.clock - 24 * 60, turn: "a3" } } }]);
    return w;
  }

  test("the GM reads each block's owner, its source with the quote it rests on, and what it shadows", () => {
    const w = sourced();
    const view = routineGmView(w.ctx, "maya", 0);
    const block = (id: string) => view.blocks.find((b) => b.block.id === id);
    expect(block("evening")).toMatchObject({
      routine: "r_maya",
      owner: { level: "own", id: "maya", name: "Maya Chen" },
      source: { type: "lore", entry: "anchor_nights", quote: "on Friday nights", title: "Friday nights at the Anchor" },
      off: false,
    });
    expect(block("evening")?.shadowed.map((s) => [s.routine, s.owner.level, s.source.type])).toEqual([
      ["r_chens", "group", "lore"],
      ["r_world", "world", "authored"],
    ]);
    expect(block("sketch")?.source).toMatchObject({ type: "sheet", entity: "maya", field: "hobbies", quote: "draws in a little notebook" });
    expect(block("tea")).toMatchObject({ routine: null, owner: { level: "chat" }, source: { type: "gm" } });
    expect(block("swim")).toMatchObject({ routine: null, owner: { level: "chat" }, source: { type: "story", turn: "a3" } });
    expect(block("sleep")).toMatchObject({ owner: { level: "builtin" }, source: { type: "builtin" } });
    // Her day as laid says why each block is there.
    const laid = (from: string) => view.day.blocks.find((b) => b.from === from)?.origin;
    expect(laid("18:00")).toMatchObject({ type: "routine", block: "evening", owner: { level: "own" }, source: { type: "lore", entry: "anchor_nights" } });
    expect(laid("06:00")).toMatchObject({ type: "schedule", schedule: "maya_shift" });
    expect(laid("14:30")).toMatchObject({ type: "routine", block: "tea", owner: { level: "chat" }, source: { type: "gm" } });
  });

  test("the player reads only what Cast may: no secret, no GM change, no place or company, lore named only when the POV may read it", () => {
    const w = sourced();
    const view = routinePlayerView(w.ctx, "maya");
    const block = (from: string) => view?.day?.blocks.find((b) => b.from === from);
    expect(block("18:00")).toEqual({ from: "18:00", to: "21:00", label: "Pours pints", kind: "work", reasons: ["routine"], source: { type: "lore", entry: "anchor_nights", title: "Friday nights at the Anchor" } });
    // A secret entry is never named: the block reads as her routine.
    expect(block("15:00")?.source).toEqual({ type: "routine" });
    // A private block is her own business.
    expect(block("16:00")).toMatchObject({ label: "Busy", source: { type: "routine" } });
    // The GM's change reads as her routine; the story's as the story.
    expect(block("14:30")?.source).toEqual({ type: "routine" });
    expect(block("21:00")?.source).toEqual({ type: "story" });
    const text = JSON.stringify(view);
    for (const hidden of ["chen_debts", "The Chens' debts", "Sketches", "notebook", "hobbies", "gm", "rosa", "Rosa", "pub", "The Anchor", "lake", "cafe", "Daybreak", "maya_flat", "market"]) expect(text).not.toContain(hidden);
  });

  test("the player reads no day of someone away, and nothing of someone the POV doesn't know", () => {
    const w = sourced();
    record(w, [{ type: "set", entity: YOU, field: "place", value: "apartment" }]);
    expect(routinePlayerView(w.ctx, "maya")).toEqual({ entity: "maya", name: "Maya Chen", day: null });
    // Vik, whom Alex has never met, is nowhere in Alex's knowledge.
    expect(routinePlayerView(w.ctx, "vik")).toBeNull();
  });
});

describe("a change the story made today", () => {
  test("the GM reads it as in force from the next day, as the planner lays it, and one the player stated says so in both folds", () => {
    const w = town();
    const swim = { id: "swim", label: "A late swim", activity: "exercise", kind: "fixed", at: "21:00", minutes: 30, place: { place: "pub" } };
    const from = w.events.length;
    // The reply's read of a change the player's own message stated and the player said yes to.
    applyEffects(reg, w, [{ type: "castlife.routine", args: { entity: "maya", blocks: [{ block: "swim", value: swim }], turn: "a3", by: "player" } }], { bindings: {}, rng: createRng("story") });
    const today = dateAt(calendarOf(w.world), w.state.clock).dayIndex;
    const swimOn = (day?: number) => (day === undefined ? routineGmView(w.ctx, "maya") : routineGmView(w.ctx, "maya", day)).blocks.find((b) => b.block.id === "swim");
    // Today was laid as the story had it: the block is theirs from tomorrow, in the planner and in the GM's read alike.
    expect([swimOn()?.owner.level, swimOn(today)?.owner.level, swimOn(today + 1)?.owner.level]).toEqual([undefined, undefined, "chat"]);
    expect(swimOn(today + 1)?.source).toMatchObject({ type: "story", turn: "a3", by: "player" });
    const folded = foldBoth(w.world, w.events.slice(from)).state;
    expect(routineChanges(reg.context(w.world, folded))).toEqual([expect.objectContaining({ entity: "maya", blocks: [{ block: "swim", source: { type: "story", at: w.state.clock, turn: "a3", by: "player" }, off: false }] })]);
  });
});
