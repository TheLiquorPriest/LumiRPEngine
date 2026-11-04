// The card or account a payment's words name pays it (DESIGN §9.5, §25.8). With several cards or
// accounts, the one the reply or the player names takes it: by its name, its bank or its last four
// digits, or as the card in gear the reply names as the payer. Words that only say a way of paying
// ("credit card"), or fit several alike, name none: the payer's order picks, and the chip says which
// account took it.

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../../../src/shared/json";
import type { LedgerEvent, PostEvent } from "../../../src/shared/ledger";
import type { EffectSpec, EntityDef } from "../../../src/shared/world";
import { applyEffects } from "../../../src/engine/effects";
import { EXTERNAL_ACCOUNT_PREFIX } from "../../../src/engine/events";
import { materializeAll } from "../../../src/engine/materialize";
import { createRegistry } from "../../../src/engine/registry-impl";
import { createRng } from "../../../src/engine/rng";
import { Working } from "../../../src/engine/working";
import { namedSource } from "../../../src/packs/economy/core/pay";
import { ALL_PACKS } from "../../../src/packs/index";
import { modernUsWorld } from "../riverton";
import { startState } from "../support";

const reg = createRegistry(ALL_PACKS);
const OWNED = [{ party: "you", role: "owner" }];
const COMPASS: JsonObject = { type: "purchase", item: "brass compass", price: 16500 };

function entity(id: string, kind: string, name: string, fields: JsonObject): EntityDef {
  return { id, kind, name, tier: "background", fields, relations: [] };
}

/**
 * Riverton at Money 4 with a second credit card, the Amex, which the payer's accounts list before
 * the Visa (by class, then id), and a second savings account. With `cards`, each credit account has
 * its card, the Visa's with its plastic in gear.
 */
function setup(cards = false): Working {
  const world = modernUsWorld("g", "R");
  const add = (e: EntityDef): void => {
    world.entities[e.id] = e;
  };
  add(entity("amex", "account", "Amex Gold", { owners: OWNED, product: "credit_card", institution: "American Express", limit: 500000, apr_pct: 24, statement_day: 12, due_day: 7, opening: 0 }));
  add(entity("rainy_day", "account", "Rainy day fund", { owners: OWNED, product: "savings", institution: "Harbor Savings Bank", opening: 300000 }));
  if (cards) {
    add({ ...entity("visa_plastic", "item", "Visa card", { owner: "you", slot: "pocket" }), relations: [{ type: "in", to: "you" }] });
    add(entity("card_visa", "card", "Visa card", { account: "card", holder: "you", network: "credit", state: "active", last4: "1111", item: "visa_plastic" }));
    add(entity("card_amex", "card", "Amex Gold card", { account: "amex", holder: "you", network: "credit", state: "active", last4: "2222" }));
  }
  const w = new Working(reg, world, startState(world));
  materializeAll(reg, w, world.pov, "run");
  return w;
}

function applied(w: Working, effects: EffectSpec[]) {
  return applyEffects(reg, w, effects, { bindings: {}, rng: createRng("c") });
}

/** A narrated change applied through its channel, as a reply's read applies it. */
function narrated(w: Working, p: JsonObject) {
  return applied(w, reg.proposals.get(String(p.type))?.toEffects(p, w.ctx) ?? []);
}

/** The accounts in the world a payment drew on. */
function drawnFrom(events: readonly LedgerEvent[]): string[] {
  const posts = events.filter((e): e is PostEvent => e.type === "post");
  return [...new Set(posts.flatMap((p) => p.lines.filter((l) => l.amount < 0 && !l.account.startsWith(EXTERNAL_ACCOUNT_PREFIX)).map((l) => l.account)))];
}

describe("the card or account a payment's words name pays it", () => {
  test("a narrated purchase 'with my Visa' goes on the Visa, though the Amex comes first and covers it", () => {
    const w = setup();
    const bought = narrated(w, { ...COMPASS, method: "my Visa" });
    expect(bought.rejected).toEqual([]);
    expect(drawnFrom(bought.applied)).toEqual(["card"]);
  });

  test("a card is named by its bank, or by its last four digits", () => {
    expect(drawnFrom(narrated(setup(), { ...COMPASS, method: "her American Express" }).applied)).toEqual(["amex"]);
    expect(drawnFrom(narrated(setup(true), { ...COMPASS, method: "the card ending in 1111" }).applied)).toEqual(["card"]);
    expect(drawnFrom(narrated(setup(true), { ...COMPASS, method: "the card ending in 2222" }).applied)).toEqual(["amex"]);
  });

  test("the card in gear named as the payer pays: its holder buys with it", () => {
    const w = setup(true);
    const bought = narrated(w, { ...COMPASS, payer: "visa_plastic" });
    expect(bought.rejected).toEqual([]);
    expect(drawnFrom(bought.applied)).toEqual(["card"]);
  });

  test("a typed Buy paid 'with the Visa', the way the player chose, goes on the Visa", () => {
    const w = setup(true);
    const bought = applied(w, [{ type: "economy.buy", args: { payer: "you", item: "brass compass", price: 16500, stated: true, method: "the Visa" } }]);
    expect(bought.rejected).toEqual([]);
    expect(drawnFrom(bought.applied)).toEqual(["card"]);
  });

  test("a payment to someone comes from the account its words name", () => {
    const w = setup();
    const paid = narrated(w, { type: "transfer", from: "you", to: "maya", cents: 20000, method: "from the rainy day fund" });
    expect(paid.rejected).toEqual([]);
    expect(drawnFrom(paid.applied)).toEqual(["rainy_day"]);
  });

  test("words that fit several ('credit card') name none: the payer's order takes it, and the chip says which account", () => {
    const w = setup(true);
    const bought = narrated(w, { ...COMPASS, method: "credit card" });
    expect(drawnFrom(bought.applied)).toEqual(["amex"]);
    expect(w.ctx.query("economy.paid_from")(w.ctx, bought.applied, "you")).toMatchObject({ name: "Amex Gold", credit: true });
  });
});

describe("namedSource", () => {
  test("a word only some of the payer's ways carry picks one out; the way's own words break a tie", () => {
    const w = setup(true);
    expect(namedSource(w.ctx, "you", "the Visa")).toBe("card_visa");
    expect(namedSource(w.ctx, "you", "Amex Gold")).toBe("card_amex");
    expect(namedSource(w.ctx, "you", "my Harbor Savings account")).toBe("rainy_day");
  });

  test("way words alone, a word every way shares, and words that fit several alike pick none", () => {
    const w = setup(true);
    for (const said of ["", "credit card", "my card", "cash", "savings", "with her own money", "the blue one"]) expect(namedSource(w.ctx, "you", said)).toBeNull();
  });

  test("only the payer's own ways count: someone else's card picks nothing", () => {
    const w = setup(true);
    expect(namedSource(w.ctx, "maya", "the Visa")).toBeNull();
  });
});
