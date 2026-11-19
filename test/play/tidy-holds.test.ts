// The holds that cannot be at a turn's start (R-173), for its world state: the kept finder's two kinds, read from the state, with the
// path's events read only where a thing too big to carry is found (who bought it gives its fix). Either way the findings are those the
// finder gives over the whole path. Every name is invented.

import { describe, expect, test } from "bun:test";
import { playedWorld } from "../../src/engine/places-in-play";
import { tidyFindings } from "../../src/engine/thing-tidy";
import { pathEventsBefore, tidyHolds } from "../../src/play/path-events";
import type { LedgerEvent } from "../../src/shared/ledger";
import { engine, play, POV, testStore, tick, USER } from "../store/fixtures";

const TIDY = { on: true, left: [], leftMost: 50 };

/** A thing spawned with `fields` and `relations`. */
const thing = (id: string, name: string, fields: Record<string, unknown>, relations: { type: string; to: string }[]): LedgerEvent => ({ type: "spawn", entity: { id, kind: "item", name, tier: "background", fields, relations } }) as unknown as LedgerEvent;

/** The finder's two kinds over the whole path before `turn`, as the turn's start read them before. */
function overThePath(ts: ReturnType<typeof testStore>, turn: string) {
  const { state } = ts.s.stateAt(turn);
  const doc = ts.store.env.worlds(state.world.revision);
  if (doc === undefined) throw new Error("the chat's world is not kept");
  const ctx = ts.store.env.registry.context(playedWorld(doc, state.world), state.world);
  return tidyFindings(ctx, pathEventsBefore(ts.s, turn), { kinds: ["too_big", "worn_elsewhere"] });
}

describe("the holds at a turn's start", () => {
  test("with nothing too big to carry: what is worn but lies elsewhere, as the finder over the path gives it", () => {
    const ts = testStore();
    ts.s.createChat({ id: "c", revision: ts.revision });
    play(ts.s, "c", "m1", "A scarf left on the stairs.", 1, engine(thing("scarf", "Grey scarf", { place: "cellar" }, [{ type: "worn_by", to: POV }])));
    const next = play(ts.s, "c", "m2", "Later.", 2, engine(tick(5)));
    const holds = tidyHolds(ts.store, USER, next.id, TIDY);
    expect(holds.map((h) => h.key)).toEqual(["worn_elsewhere:scarf"]);
    expect(holds).toEqual(overThePath(ts, next.id));
  });

  test("with a thing too big to carry on a person: the path is read, and the finding is the finder's over it", () => {
    const ts = testStore();
    ts.s.createChat({ id: "c", revision: ts.revision });
    play(ts.s, "c", "m1", "She hefts a wardrobe.", 1, engine(thing("wardrobe", "Oak wardrobe", { size: "furniture" }, [{ type: "in", to: POV }])));
    const next = play(ts.s, "c", "m2", "Later.", 2, engine(tick(5)));
    const holds = tidyHolds(ts.store, USER, next.id, TIDY);
    expect(holds.map((h) => h.key)).toEqual(["too_big:wardrobe"]);
    expect(holds).toEqual(overThePath(ts, next.id));
  });
});
