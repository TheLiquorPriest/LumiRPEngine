// The new fold (plan §6.3): state is the changes along a path, applied by the packs' own handlers.
// Each change carries its lane; a change that does not apply is recorded with its report, and
// nothing a change says makes the store throw or refuse.

import { describe, expect, test } from "bun:test";
import { hashJson } from "../../src/shared/hash";
import type { LedgerEvent, PackEvent } from "../../src/shared/ledger";
import { applyEvent } from "../../src/engine/events";
import type { PackDef } from "../../src/engine/registry";
import { createRegistry } from "../../src/engine/registry-impl";
import { initialState } from "../../src/engine/world-state";
import { ALL_PACKS } from "../../src/packs/index";
import { StoreInputError, type ChangeInput } from "../../src/store/types";
import { carried, engine, goTo, hand, make, pay, play, POV, registry, testStore, tick } from "./fixtures";

describe("the new fold", () => {
  test("changes fold through the packs' own handlers to the state today's handlers give, each marked with its lane", () => {
    const { s, world, revision } = testStore();
    s.createChat({ id: "c", revision });
    const events: LedgerEvent[] = [
      tick(45),
      goTo(POV, "cellar"),
      pay("acct_wren", 350, "A round for the cellar"),
      make("lamp", "Lamp", POV),
      ...hand("knife", "satchel", "bram"),
      { type: "relationships.regard", data: { from: "bram", to: POV, deltas: { trust: 4 }, why: "she paid" } },
      { type: "castlife.need", data: { entity: POV, need: "hunger", delta: -30, at: 0, from: 60 } },
    ];
    const t = play(s, "c", "m1", "A round, and a lamp.", 1, [...engine(...events), { lane: "story", op: "store.note", value: { at: "cellar", text: "warmer than it looks" }, by: "author", source: "author" }]);
    // The same events through today's reducers, one after another, from the world's own start.
    const reg = registry();
    const direct = initialState(world, revision, reg);
    for (const e of events) applyEvent(reg, e, direct, reg.context(world, direct));
    const head = s.headState("c").state;
    expect(hashJson(head.world)).toBe(hashJson(direct));
    expect(carried(head.world, "bram")).toEqual(["knife"]);
    expect(head.notes.cellar?.text).toBe("warmer than it looks");
    expect(s.changes(t.id).map((c) => [c.lane, c.op, c.applied])).toEqual([
      ...events.map((e) => ["engine", e.type, true]),
      ["story", "store.note", true],
    ]);
  });

  test("a change that does not apply is recorded with its report and left unapplied; nothing is refused and nothing throws", () => {
    const { s, revision } = testStore();
    s.createChat({ id: "c", revision });
    const t = s.beginTurn({ chat: "c", kind: "normal" });
    const { changes, state } = s.addChanges(t.id, [
      ...engine({ type: "set", entity: "nobody", field: "place", value: "cellar" }, { type: "post", lines: [{ account: "acct_wren", amount: -100 }, { account: "economy.external:market", amount: 90 }], memo: "Short" }, { type: "nopack.thing", data: {} }),
      { lane: "engine", op: "store.marker", value: { kind: "migrate", to: "rev_nowhere" }, by: "gm" },
      ...engine(tick(20)),
    ]);
    expect(changes.map((c) => c.applied)).toEqual([false, false, false, false, true]);
    expect(changes.map((c) => c.reports.map((r) => r.code))).toEqual([["missing_entity"], ["unbalanced"], ["unknown_event"], ["unknown_revision"], []]);
    // A report is a code and its values: no sentence of the store's or of a handler's goes with it.
    expect(changes[1]?.reports[0]).toEqual({ code: "unbalanced" });
    expect(state.world.clock - s.headState("c").state.world.clock).toBe(20);
    expect(state.world.accounts).toEqual({});
  });

  test("a change keeps what its source cites, as its writer gave it, and none when it gives none", () => {
    const { s, store, revision } = testStore();
    s.createChat({ id: "c", revision });
    const t = s.beginTurn({ chat: "c", kind: "normal" });
    const invented = { gapCheck: "gap-7", consent: "msg-12", searched: ["lamp", "lantern"] };
    const { changes } = s.addChanges(t.id, [
      { ...(engine(make("lamp", "Lamp", POV))[0] as ChangeInput), source: "invented", cite: invented },
      { ...(engine(goTo(POV, "cellar"))[0] as ChangeInput), source: "player", cite: "msg-3" },
      ...engine(tick(5)),
    ]);
    expect(changes.map((c) => c.cite)).toEqual([invented, "msg-3", null]);
    expect(s.changes(t.id).map((c) => c.cite)).toEqual([invented, "msg-3", null]);
    // What it cites is kept beside the change and never folded: the state is the same without it.
    const plain = testStore();
    plain.s.createChat({ id: "c", revision: plain.revision });
    const p = plain.s.beginTurn({ chat: "c", kind: "normal" });
    plain.s.addChanges(p.id, engine(make("lamp", "Lamp", POV), goTo(POV, "cellar"), tick(5)));
    expect(hashJson(s.stateAt(t.id).state.world)).toBe(hashJson(plain.s.stateAt(p.id).state.world));
    // A cite that is not JSON is the one thing refused, and nothing is recorded.
    expect(() => s.addChanges(t.id, [{ ...(engine(tick(1))[0] as ChangeInput), cite: (() => "a function") as unknown as ChangeInput["cite"] }])).toThrow(StoreInputError);
    expect(store.db.query<{ n: number }, [string]>("SELECT count(*) AS n FROM change WHERE turn = ?").get(t.id)?.n).toBe(3);
  });

  test("a unit of grouped events lands whole or not at all", () => {
    const { s, revision } = testStore();
    s.createChat({ id: "c", revision });
    const t = s.beginTurn({ chat: "c", kind: "normal" });
    const unit: LedgerEvent[] = [
      { ...make("token", "Brass token", POV), group: "g1" },
      { type: "set", entity: "nobody", field: "mood", value: "glad", group: "g1" },
    ];
    const { changes, state } = s.addChanges(t.id, [...engine(...unit), ...engine({ type: "link", rel: "in", from: "cask", to: POV, tiedTo: ["g1"] })]);
    expect(changes.map((c) => c.applied)).toEqual([false, false, false]);
    expect(changes[0]?.reports[0]).toEqual({ code: "missing_entity" });
    expect(changes[2]?.reports[0]?.code).toBe("tied");
    expect(state.world.entities.token).toBeUndefined();
    expect(carried(state.world, POV)).not.toContain("cask");
  });

  test("staged changes show inside their turn and not outside it; a dropped turn never joins the path", () => {
    const { s, revision } = testStore();
    s.createChat({ id: "c", revision });
    play(s, "c", "m1", "Morning.", 1, engine(tick(10)));
    const open = s.beginTurn({ chat: "c", kind: "normal" });
    s.addChanges(open.id, engine(goTo(POV, "cellar")));
    s.addChanges(open.id, engine(make("map", "Folded map", POV)).map((c) => ({ ...c, by: "helper" })));
    expect(s.stateAt(open.id).state.world.entities[POV]?.fields.place).toBe("cellar");
    expect(s.headState("c").state.world.entities[POV]?.fields.place).toBe("common_room");
    // The lead takes back one helper's writes; the rest stay staged.
    expect(s.dropStaged(open.id, "helper")).toBe(1);
    expect(s.stateAt(open.id).state.world.entities.map).toBeUndefined();
    s.dropTurn(open.id);
    expect(s.headState("c").state.world.entities[POV]?.fields.place).toBe("common_room");
    expect(() => s.addChanges(open.id, engine(tick(1)))).toThrow(StoreInputError);
  });

  test("a handler that throws is reported on its change, and the fold goes on", () => {
    const fragile: PackDef = {
      id: "fragile",
      label: "A pack whose reducer fails",
      version: 1,
      domain: null,
      requires: [],
      register(r) {
        r.event<PackEvent>({
          type: "fragile.break",
          validate: () => null,
          apply: () => {
            throw new Error("the reducer broke");
          },
          describe: () => "breaks",
        });
      },
    };
    const { s, revision } = testStore({ registry: createRegistry([...ALL_PACKS, fragile]) });
    s.createChat({ id: "c", revision });
    const t = s.beginTurn({ chat: "c", kind: "normal" });
    const { changes, state } = s.addChanges(t.id, engine({ type: "fragile.break", data: {} }, tick(3)));
    expect(changes.map((c) => [c.applied, c.reports])).toEqual([
      [false, [{ code: "failed", values: { error: "the reducer broke" } }]],
      [true, []],
    ]);
    expect(state.world.clock - s.headState("c").state.world.clock).toBe(3);
  });

  test("a change added to an earlier turn after later ones were made is checked where they stand, and what no longer applies is listed", () => {
    const { s, revision } = testStore();
    s.createChat({ id: "c", revision });
    const t1 = play(s, "c", "m1", "She checks her satchel.", 1, engine(tick(5)));
    const t2 = play(s, "c", "m2", "She lends Bram her knife.", 2, engine(...hand("knife", "satchel", "bram")));
    expect(carried(s.headState("c").state.world, "bram")).toEqual(["knife"]);
    // A job tied to the first turn records, late, that Odile had taken the knife by then.
    s.addChanges(t1.id, [...engine(...hand("knife", "satchel", "odile")).map((c) => ({ ...c, job: "job-7" }))]);
    const head = s.headState("c");
    expect(carried(head.state.world, "odile")).toEqual(["knife"]);
    expect(carried(head.state.world, "bram")).toEqual([]);
    expect(head.notApplied.map((n) => [n.turn, n.op])).toEqual([
      [t2.id, "unlink"],
      [t2.id, "link"],
    ]);
    expect(s.changes(t1.id).at(-1)?.job).toBe("job-7");
  });
});
