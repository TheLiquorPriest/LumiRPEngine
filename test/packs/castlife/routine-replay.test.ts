// Older chats (DESIGN §8 "Replay"): a chat the build before routines recorded (`older-chat.json`, its
// world and its turn's events) folds exactly as that build left it, the `castlife.need` events it
// recorded without the value they started from included, in both folds; and its next turn plans with
// the new defaults on the same world revision, with no Upgrade: no outing or invitation that nothing
// in the world or the story grounds.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hashJson } from "../../../src/shared/hash";
import type { JsonObject } from "../../../src/shared/json";
import type { LedgerEvent } from "../../../src/shared/ledger";
import type { WorldDoc } from "../../../src/shared/world";
import type { EntityState } from "../../../src/engine/state";
import { Working } from "../../../src/engine/working";
import { dayPlan } from "../../../src/packs/castlife/core/index";
import { routineGmView } from "../../../src/packs/castlife/core/view";
import { at, foldBoth, invitations, lapse, reg } from "./town";

interface OlderChat {
  runSeed: string;
  world: WorldDoc;
  events: LedgerEvent[];
  /** Where the recording build's fold left the clock, its people and the castlife slice. */
  recorded: { clock: number; people: Record<string, EntityState>; castlife: JsonObject | null };
}

const older = JSON.parse(readFileSync(join(import.meta.dir, "older-chat.json"), "utf8")) as OlderChat;

describe("an older chat", () => {
  test("folds exactly as the build that recorded it left it, in both folds, needs recorded without their start included", () => {
    // The fixture holds what makes this hard: needs that folded against that build's own day plans.
    expect(older.events.filter((e) => e.type === "castlife.need" && "data" in e && e.data.from === undefined).length).toBeGreaterThan(0);
    const folded = foldBoth(older.world, older.events).state;
    expect(folded.clock).toBe(older.recorded.clock);
    for (const [id, person] of Object.entries(older.recorded.people)) expect(folded.entities[id]).toEqual(person);
    expect(folded.packs.castlife ?? null).toEqual(older.recorded.castlife);
  });

  test("plans its next turn with the new defaults on the same revision: no outing or invitation nothing grounds", () => {
    const folded = foldBoth(older.world, older.events).state;
    expect(folded.revision).toBe(hashJson(older.world));
    const w = new Working(reg, older.world, folded);
    // What the template asked stays as it was recorded, and reads as the template's, with no ground.
    expect(routineGmView(w.ctx, "dev").invitations.made.map((i) => [i.key, i.origin.type, i.status])).toEqual([
      ["dev:invite:2", "legacy", "sent"],
      ["dev:invite:6", "legacy", "sent"],
    ]);
    // Dev, fond of Sam, with a free Sunday: the next turn's two days ask nothing.
    const run = lapse(w, at(w, 3, "20:00"), true);
    expect(run.result.stop).toBe("target");
    expect(invitations(w.events)).toEqual([]);
    const grounded = /^(routine:(sleep|sleep:carried|breakfast|lunch|dinner)|idle|schedule:.*)$/;
    for (const who of ["dev", "ana"]) for (const day of [2, 3]) expect(dayPlan(w.ctx, who, day).blocks.map((b) => b.option).filter((o) => !grounded.test(o))).toEqual([]);
  });
});
