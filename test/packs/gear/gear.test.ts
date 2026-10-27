import { describe, expect, test } from "bun:test";
import { calendarOf, formatClock } from "../../../src/engine/calendar";
import type { WorldDoc } from "../../../src/shared/world";
import { applyEffects } from "../../../src/engine/effects";
import { createRegistry } from "../../../src/engine/registry-impl";
import { resolveAction } from "../../../src/engine/resolve";
import { createRng } from "../../../src/engine/rng";
import { runTimelapse } from "../../../src/engine/time";
import { Working } from "../../../src/engine/working";
import { ALL_PACKS } from "../../../src/packs/index";
import { modernUsWorld } from "../riverton";
import { kitStatus, overdueFor } from "../../../src/packs/gear/core/model";
import { cashGift } from "../../../src/packs/gear/core/index";
import { buildGearView } from "../../../src/packs/gear/core/view";
import { fold, startState } from "../support";

const reg = createRegistry(ALL_PACKS);

function setup(patch: (w: WorldDoc) => void = () => undefined): Working {
  const world = modernUsWorld("w", "Riverton");
  patch(world);
  return new Working(reg, world, startState(world));
}

describe("gear: kits as template plus overrides (L36)", () => {
  test("the toolbox shows 44/45 after one wrench is taken; putting it back restores 45/45", () => {
    const w = setup((wd) => {
      wd.entities.you!.fields.place = "garage";
    });
    expect(kitStatus(w.ctx, "toolbox")).toMatchObject({ present: 45, total: 45, complete: true });
    const take = resolveAction(reg, w, { action: "take_piece", params: { kit: "toolbox", piece: "wrench" } }, createRng("t"));
    expect(take.ok).toBe(true);
    const status = kitStatus(w.ctx, "toolbox");
    expect([status?.present, status?.total, status?.complete]).toEqual([44, 45, false]);
    expect(status?.missing).toEqual(["Combination wrench, metric (10, 12, 13, 14, 17, 19 mm) ×1"]);
    // Exactly one override item was created, and the POV carries it.
    const overrides = Object.entries(w.state.entities).filter(([, e]) => e.fields.from_kit === "toolbox");
    expect(overrides).toHaveLength(1);
    const wrench = overrides[0]![0];
    expect(reg.context(w.world, w.state).query("has_item")(w.ctx, "you", "wrench")).toBe(true);
    const back = applyEffects(reg, w, [{ type: "gear.transfer", args: { item: wrench, to: "toolbox" } }], { bindings: {}, rng: createRng("b") });
    expect(back.rejected).toEqual([]);
    expect(kitStatus(w.ctx, "toolbox")).toMatchObject({ present: 45, complete: true });
    // Taking it again moves the same override item (no second override).
    resolveAction(reg, w, { action: "take_piece", params: { kit: "toolbox", piece: "wrench" } }, createRng("t2"));
    expect(Object.values(w.state.entities).filter((e) => e.fields.from_kit === "toolbox")).toHaveLength(1);
    expect(kitStatus(w.ctx, "toolbox")?.present).toBe(44);
    const view = buildGearView(w.ctx);
    expect(view.stored.find((i) => i.id === "toolbox")?.kit).toMatchObject({ present: 44, total: 45, complete: false });
  });
});

describe("gear: containment, slots and use grants", () => {
  test("containers enforce volume and load; nothing goes inside itself", () => {
    const w = setup();
    const r = applyEffects(reg, w, [{ type: "gear.transfer", args: { item: "toolbox", to: "wallet" } }], { bindings: {}, rng: createRng("x") });
    expect(r.rejected[0]?.rejection.code).toBe("no_room");
    const cyc = applyEffects(reg, w, [{ type: "gear.transfer", args: { item: "wallet", to: "wallet" } }], { bindings: {}, rng: createRng("x") });
    expect(cyc.rejected[0]?.rejection.code).toBe("cycle");
  });

  test("a reply's handover lands as the story told it, room or not; an action's still needs the room", () => {
    const w = setup();
    const acted = applyEffects(reg, w, [{ type: "gear.give", args: { item: "toolbox", from: "you", to: "wallet" } }], { bindings: {}, rng: createRng("x") });
    expect(acted.rejected[0]?.rejection.code).toBe("no_room");
    const told = applyEffects(reg, w, [{ type: "gear.give", args: { item: "toolbox", from: "you", to: "wallet", told: true } }], { bindings: {}, rng: createRng("x") });
    expect(told.rejected).toEqual([]);
    expect(w.state.entities.toolbox?.relations).toContainEqual({ type: "in", to: "wallet" });
  });

  test("Owned lists a container's contents under it, not again at the top; slots read as words", () => {
    const w = setup();
    w.state.realism.levels.gear = 3;
    w.state.entities.card = { kind: "item", name: "Library card", tier: "background", fields: { owner: "you", volume_l: 0.01 }, relations: [{ type: "in", to: "wallet" }], levels: {}, agent: false };
    w.state.entities.wallet!.fields.slot = "pocket_or_bag";
    const view = buildGearView(w.ctx);
    expect(view.owned.some((i) => i.id === "card")).toBe(false);
    const wallet = view.owned.find((i) => i.id === "wallet");
    expect(wallet?.children?.some((i) => i.id === "card")).toBe(true);
    expect(wallet?.slot).toBe("pocket or bag");
    // Lent, it is with the borrower: Owned shows the loan, not the owner's slot.
    w.state.entities.rosa!.relations.push({ type: "uses", to: "wallet", until: w.state.clock + 1440 });
    const lent = buildGearView(w.ctx).owned.find((i) => i.id === "wallet");
    expect([lent?.slot, lent?.lent?.to]).toEqual([undefined, "Rosa Delgado"]);
  });

  test("worn slots hold one item each (Gear 3)", () => {
    const w = setup((wd) => {
      wd.entities.coat = { id: "coat", kind: "item", name: "Coat", tier: "background", fields: { owner: "you", slot: "torso_outer" }, relations: [{ type: "in", to: "you" }] };
      wd.entities.parka = { id: "parka", kind: "item", name: "Parka", tier: "background", fields: { owner: "you", slot: "torso_outer" }, relations: [{ type: "in", to: "you" }] };
    });
    expect(resolveAction(reg, w, { action: "wear", params: { item: "coat" } }, createRng("w")).rejected).toEqual([]);
    const second = resolveAction(reg, w, { action: "wear", params: { item: "parka" } }, createRng("w2"));
    expect(second.rejected[0]?.rejection.code).toBe("slot_taken");
    expect(buildGearView(w.ctx).worn.map((i) => i.id)).toEqual(["coat"]);
  });

  test("a use grant expires to overdue (with a signal) and the owner's retrieval brings it back", () => {
    const w = setup((wd) => {
      wd.entities.you!.fields.place = "garage";
      wd.entities.rosa!.fields.place = "garage";
    });
    const lend = resolveAction(reg, w, { action: "lend", params: { item: "toolbox", to: "rosa", days: 1 } }, createRng("l"));
    expect(lend.ok).toBe(true);
    expect(lend.rejected).toEqual([]);
    expect(w.state.entities.rosa?.relations.some((r) => r.type === "uses" && r.to === "toolbox")).toBe(true);
    const out = runTimelapse(reg, w, { type: "duration", minutes: 2 * 1440 }, { runSeed: "r", overrides: { invitation: "note", incident: "note", arrival: "note", quest: "note", decline: "note" } });
    if ("code" in out) throw new Error(out.reason);
    expect(w.state.entities.toolbox?.fields.overdue).toBe(true);
    expect(w.events.some((e) => e.type === "engine.signal" && e.data.class === "overdue")).toBe(true);
    expect(overdueFor(w.state, "you").map((g) => g.thing)).toEqual(["toolbox"]);
    const back = resolveAction(reg, w, { action: "reclaim", params: { item: "toolbox" } }, createRng("rc"));
    expect(back.rejected).toEqual([]);
    expect(w.state.entities.toolbox?.fields.overdue).toBe(false);
    expect(overdueFor(w.state, "you")).toEqual([]);
    expect(fold(reg, w.world, startState(w.world), w.events)).toEqual(w.state);
  });

  test("an NPC handing over money is not a new item: cash words and amounts are refused as money, real things still come into being", () => {
    const w = setup();
    const give = reg.proposals.get("give");
    if (!give) throw new Error("no give channel");
    for (const item of ["$20", "cash", "a twenty", "twenty bucks", "20 dollars", "some money", "20 USD"]) expect(give.validate({ type: "give", item, from: "rosa", to: "you" }, w.ctx)?.code).toBe("is_money");
    for (const item of ["a thermos of coffee", "spare key", "Twenty Questions board game", "the notes", "her bills", "2 old daggers", "my $300 jacket", "a $20 gift card", "a $5 coin purse"]) expect(give.validate({ type: "give", item, from: "rosa", to: "you" }, w.ctx)).toBeNull();
  });

  test("only a whole item that is money is cash: a priced thing ('my $300 jacket', 'a $20 gift card', 'a $5 coin purse') stays a thing", () => {
    const usd = setup().world.currency;
    expect(["my $300 jacket", "a $20 gift card", "a $5 coin purse", "20 dollars worth of gas", "$20 for gas"].map((t) => cashGift(t, usd))).toEqual([null, null, null, null, null]);
    expect(["$20", "a twenty", "20 dollars in cash", "a $20 bill", "a twenty-dollar bill", "his $50 notes"].map((t) => cashGift(t, usd)?.amount)).toEqual([20, 20, 20, 20, 20, 50]);
  });

  test("cash a give names carries its amount as written; a letter currency symbol counts only beside the number", () => {
    const usd = setup().world.currency;
    const amounts = ["$20", "$1,250.50 in cash", "a twenty", "twenty bucks", "20 dollars", "20 USD", "a fiver", "some money", "cash"].map((t) => cashGift(t, usd)?.amount);
    expect(amounts).toEqual([20, 1250.5, 20, 20, 20, 20, 5, null, null]);
    const pence = { ...usd, code: "GBP", symbol: "d" };
    expect(cashGift("12d", pence)).toEqual({ amount: 12 });
    expect(cashGift("2 old daggers", pence)).toBeNull();
    expect(cashGift("3 dresses", pence)).toBeNull();
  });

  test("a thing handed back to its owner ends the loan and its overdue flag; passed on to someone else, it stays lent", () => {
    const w = setup((wd) => {
      wd.entities.you!.fields.place = "garage";
      wd.entities.rosa!.fields.place = "garage";
    });
    expect(resolveAction(reg, w, { action: "lend", params: { item: "phone", to: "rosa", days: 1 } }, createRng("l")).ok).toBe(true);
    const out = runTimelapse(reg, w, { type: "duration", minutes: 2 * 1440 }, { runSeed: "r", overrides: { invitation: "note", incident: "note", arrival: "note", quest: "note", decline: "note" } });
    if ("code" in out) throw new Error(out.reason);
    expect(w.state.entities.phone?.fields.overdue).toBe(true);
    // The narrated hand-overs arrive as give proposals.
    const give = reg.proposals.get("give");
    if (!give) throw new Error("no give channel");
    const hand = (from: string, to: string): void => {
      const p = { type: "give", item: "phone", from, to };
      expect(give.validate(p, w.ctx)).toBeNull();
      expect(applyEffects(reg, w, give.toEffects(p, w.ctx), { bindings: {}, rng: createRng(`${from}:${to}`) }).rejected).toEqual([]);
    };
    const lentBy = (who: string): boolean => w.state.entities[who]?.relations.some((r) => r.type === "uses" && r.to === "phone") ?? false;
    hand("rosa", "maya");
    expect([lentBy("rosa"), w.state.entities.phone?.fields.overdue, w.state.entities.phone?.fields.owner]).toEqual([true, true, "you"]);
    hand("maya", "you");
    expect([lentBy("rosa"), w.state.entities.phone?.fields.overdue, w.state.entities.phone?.fields.owner]).toEqual([false, false, "you"]);
    expect(overdueFor(w.state, "you")).toEqual([]);
    expect(fold(reg, w.world, startState(w.world), w.events)).toEqual(w.state);
  });

  test("a loan ends when the player says: a said time wins over the days, a span counts from now", () => {
    const w = setup((wd) => {
      wd.entities.you!.fields.place = "garage";
      wd.entities.rosa!.fields.place = "garage";
    });
    const cal = calendarOf(w.world);
    const untilOf = (item: string): number | undefined => w.state.entities.rosa?.relations.find((r) => r.type === "uses" && r.to === item)?.until;
    const tonight = resolveAction(reg, w, { action: "lend", params: { item: "phone", to: "rosa", days: 1, until: "7 tonight" } }, createRng("l7"));
    expect([tonight.ok, tonight.rejected]).toEqual([true, []]);
    const at = untilOf("phone") ?? 0;
    expect(formatClock(cal, at)).toEndWith(", 7:00 PM");
    expect(at - w.state.clock).toBeLessThanOrEqual(1440);
    const span = resolveAction(reg, w, { action: "lend", params: { item: "wallet", to: "rosa", days: 0, until: "for 3 hours" } }, createRng("l3"));
    expect([span.ok, span.rejected]).toEqual([true, []]);
    expect(untilOf("wallet")).toBe(w.state.clock + 180);
    // Words that name no time fall back to the days; no days and no time is no loan.
    const vague = resolveAction(reg, w, { action: "lend", params: { item: "toolbox", to: "rosa", days: 2, until: "a while" } }, createRng("lv"));
    expect([vague.ok, untilOf("toolbox")]).toEqual([true, w.state.clock + 2 * 1440]);
    expect(resolveAction(reg, w, { action: "lend", params: { item: "truck", to: "rosa", days: 0 } }, createRng("l0")).failed?.code).toBe("requirement");
    expect(resolveAction(reg, w, { action: "lend", params: { item: "truck", to: "rosa" } }, createRng("ln")).failed?.code).toBe("requirement");
    // An end that names no time, with no days, is declined rather than given a length ...
    const none = resolveAction(reg, w, { action: "lend", params: { item: "truck", to: "rosa", until: "a while" } }, createRng("lw"));
    expect(none.rejected.map((r) => r.rejection.code)).toEqual(["bad_until"]);
    expect(untilOf("truck")).toBeUndefined();
    // ... but either one is enough: an end alone (what interpret fills from "until 7 tonight").
    const said = resolveAction(reg, w, { action: "lend", params: { item: "truck", to: "rosa", until: "19:00" } }, createRng("lu"));
    expect([said.ok, said.failed, said.rejected]).toEqual([true, null, []]);
    expect(formatClock(cal, untilOf("truck") ?? 0)).toEndWith(", 7:00 PM");
  });

  test("a second bought or received thing joins the stack its holder has", () => {
    const w = setup();
    const mine = (name: string): [string, number][] => Object.entries(w.state.entities).filter(([, e]) => e.name === name && e.relations.some((r) => r.type === "in" && r.to === "you")).map(([id, e]) => [id, typeof e.fields.qty === "number" ? e.fields.qty : 1]);
    for (const i of [1, 2]) expect(resolveAction(reg, w, { action: "buy", params: { item: "earbuds_wireless" } }, createRng(`buy:${i}`)).ok).toBe(true);
    const bought = mine(w.state.entities[Object.keys(w.state.entities).find((id) => w.state.entities[id]?.fields.catalog === "earbuds_wireless") ?? ""]?.name ?? "");
    expect(bought.map(([, qty]) => qty)).toEqual([2]);
    for (const from of ["maya", "jordan"]) expect(applyEffects(reg, w, [{ type: "gear.receive", args: { name: "Apple", to: "you", from } }], { bindings: {}, rng: createRng(from) }).rejected).toEqual([]);
    expect(mine("Apple").map(([, qty]) => qty)).toEqual([2]);
  });

  test("gear level 0 makes transfers no-ops; level 1 renders notable items only", () => {
    const w = setup((wd) => {
      wd.realism.levels.gear = 1;
    });
    const view = buildGearView(w.ctx);
    expect(view.carried.map((i) => i.name)).toEqual(["Phone"]);
    w.state.realism.levels.gear = 0;
    const r = applyEffects(reg, w, [{ type: "gear.transfer", args: { item: "phone", to: "maya" } }], { bindings: {}, rng: createRng("z") });
    expect(r.applied).toEqual([]);
  });

  test("at Gear 1 a thing handed over that the world hadn't tracked shows, as a notable one does", () => {
    const w = setup((wd) => {
      wd.realism.levels.gear = 1;
    });
    const r = applyEffects(reg, w, [{ type: "gear.receive", args: { name: "Brass key", to: "you", from: "maya" } }], { bindings: {}, rng: createRng("r") });
    expect(r.rejected).toEqual([]);
    expect(buildGearView(w.ctx).carried.map((i) => i.name)).toContain("Brass key");
  });

  test("a narrated hand-over by name gives the thing the giver holds, never a second one", () => {
    const w = setup((wd) => {
      wd.entities.brass_key = { id: "brass_key", kind: "item", name: "Brass key", tier: "background", fields: { owner: "maya" }, relations: [{ type: "in", to: "maya" }] };
    });
    const give = reg.proposals.get("give");
    if (!give) throw new Error("no give channel");
    const p = { type: "give", item: "the brass key", from: "maya", to: "you" };
    const count = Object.keys(w.state.entities).length;
    expect(give.validate(p, w.ctx)).toBeNull();
    expect(applyEffects(reg, w, give.toEffects(p, w.ctx), { bindings: {}, rng: createRng("g") }).rejected).toEqual([]);
    expect(Object.keys(w.state.entities).length).toBe(count);
    expect(w.state.entities.brass_key?.relations).toContainEqual({ type: "in", to: "you" });
  });
});
