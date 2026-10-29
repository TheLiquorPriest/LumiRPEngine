// The money family (AGENT-LOOP-PLAN §6; INC1-SPEC R3a): someone's money, and what things cost, read
// with the economy pack's own readers.
//
// - `money_balances`: a person's or a business's accounts, each balance in the world's minor units
//   and in its currency (a negative one owed), their cash, how well off they are (the wealth band),
//   their net worth and what they owe, from the economy's view of a party's money at its own Money
//   level (`economy.finance`: the Money panel's, and the GM's). Under `pov` the player character's
//   own money is what Play's Money panel shows (`player: true`); of anyone else, only the accounts
//   it holds a role on with them (`rightsOf`), and with none the note that it doesn't know. Under
//   `everyone` and `gm` the party's whole view, unmasked (`player: false`), each account and owner
//   named as the view names it (marked, or with its visibility); `gm` adds the economy's notes.
// - `money_prices`: what a catalog item costs at a place (`priceOf`; an item in words is the catalog
//   item a purchase of it would be, `matchCatalog`), with its band and whether the place sells it;
//   with no item, everything the place sells (`placeTrade`), priced there, in the order the Buy
//   options list them (`economy.offers`), every one of them. Prices are public; under `pov` the
//   place is one the player character can see (the resolver), the one it is at by default.

import { optionalQuery, own, rowOf, strOf } from "../../../../engine/pack-kit";
import { placeOfEntity } from "../../../../engine/scope";
import { matchCatalog, placeTrade } from "../../../../packs/economy/core/index";
import { priceOf, rightsOf } from "../../../../packs/economy/core/model";
import { isParty } from "../../../../packs/economy/core/pay";
import { TOOL_NOTE } from "../../../../shared/agent-tools";
import { type AccountView, CLASS_TRAITS, type FinanceView, type PartyKind } from "../../../../shared/finance";
import type { PlaceId } from "../../../../shared/ids";
import { formatMoney } from "../../../../shared/world";
import type { ToolReadView, ViewRef } from "../read-view";
import type { ToolDefinition } from "../registry";
import { resolveEntity, resolvePlace } from "../resolve";
import { objectSchema, placeEnum, text, textArg } from "../schema";
import { beyondPov, type PlaceShown, placeShown } from "./people";

const BALANCES = "money_balances";
const PRICES = "money_prices";

/** A sum of money: in the world's minor units, and in its currency's words. */
interface Amount {
  cents: number;
  amount: string;
}

/** An owner of an account as the view names them, with their role and their share of its worth in percent. */
interface Holder extends ViewRef {
  role: string;
  share: number;
}

/**
 * An account as the view names it: its class, product, bank and status, the party's role on it, its
 * balance (from the holder's side: negative on credit, owed), what it can spend or draw now, its
 * credit limit, and its owners.
 */
interface AccountRead extends ViewRef {
  class: string;
  product: string;
  institution: string | null;
  status: string;
  role: string | null;
  cents: number;
  balance: string;
  available?: Amount;
  limit?: Amount;
  owners: Holder[];
}

/** What is owed on a credit account or a loan: the sum, a loan's payment and months left, and what is due next. */
interface Owed extends ViewRef, Amount {
  payment?: Amount;
  monthsLeft?: number;
  due?: Amount & { label: string; at: string };
}

interface BalancesAnswer {
  party: ViewRef;
  /** Absent under `pov` for someone else, as their level, wealth, cash and worth are: only the accounts the player character shares with them are its to know. */
  kind?: PartyKind;
  level?: number;
  wealth?: string | null;
  cash?: Amount | { band: string } | null;
  netWorth?: Amount;
  accounts: AccountRead[];
  owes: Owed[];
  /** Under `gm`: the economy's private notes on the party (paydays, bills, declines). */
  notes?: { at: string; text: string }[];
}

/** An item priced at a place: its catalog id (none for a price category), its category, name and unit, where its price comes from, the price of one, its band there, and whether the place sells it. */
interface ItemPrice extends Amount {
  catalog?: string;
  category: string;
  name: string;
  unit?: string;
  source: "catalog" | "category";
  band: { min: Amount; typical: Amount; max: Amount };
  sold: boolean;
}

interface PriceAnswer {
  place: PlaceShown | null;
  item: string;
  /** Null for an item nothing in the catalog prices. */
  price: ItemPrice | null;
}

/** A catalog item a place sells, at its price there. */
interface Offered extends Amount {
  catalog: string;
  name: string;
  category: string;
  unit?: string;
}

interface SellsAnswer {
  place: PlaceShown | null;
  sells: Offered[];
}

function amount(view: ToolReadView, cents: number): Amount {
  return { cents, amount: formatMoney(cents, view.world.currency) };
}

/** Each of `accounts` the view may name, as `party`'s, each owner as the view names them (one it may not, left out). */
function accountReads(view: ToolReadView, party: ViewRef, accounts: readonly AccountView[]): AccountRead[] {
  return accounts.flatMap((a): AccountRead[] => {
    const ref = view.entity(a.id);
    if (!ref) return [];
    const owners = a.owners.flatMap((o): Holder[] => {
      const owner = o.party === null ? null : view.entity(o.party);
      return owner ? [{ ...owner, role: o.role, share: o.share }] : [];
    });
    return [
      {
        ...ref,
        class: a.class,
        product: a.product.label,
        institution: a.institution,
        status: a.status,
        role: a.owners.find((o) => o.party === party.id)?.role ?? null,
        cents: a.cents,
        balance: formatMoney(a.cents, view.world.currency),
        available: a.available === null ? undefined : amount(view, a.available),
        limit: a.limit === null ? undefined : amount(view, a.limit),
        owners,
      },
    ];
  });
}

/** What is owed on each credit account and loan of `accounts` the view may name. */
function owedOn(view: ToolReadView, accounts: readonly AccountView[]): Owed[] {
  return accounts.flatMap((a): Owed[] => {
    const ref = CLASS_TRAITS[a.class].liability && a.cents < 0 ? view.entity(a.id) : null;
    return ref ? [{ ...ref, ...amount(view, -a.cents), payment: a.loan ? amount(view, a.loan.payment) : undefined, monthsLeft: a.loan?.monthsLeft, due: a.due ? { ...amount(view, a.due.cents), label: a.due.label, at: a.due.at } : undefined }] : [];
  });
}

/** A party's money as the economy's view of it has it (`FinanceView`), everything the view may name of it. */
function wholeMoney(view: ToolReadView, party: ViewRef, money: FinanceView): BalancesAnswer {
  const worth = money.overview?.netWorth ?? null;
  return {
    party,
    kind: money.partyKind,
    level: money.level,
    wealth: money.band,
    cash: money.cash === null ? null : "cents" in money.cash ? amount(view, money.cash.cents) : { band: money.cash.band },
    netWorth: worth === null ? undefined : amount(view, worth),
    accounts: accountReads(view, party, money.accounts),
    owes: owedOn(view, money.accounts),
    notes: view.knowledge === "gm" ? money.notes : undefined,
  };
}

/**
 * A party's money as the view may read it, or null when it is the player character's not to know:
 * someone else's with whom it shares no account. A world without the economy pack keeps no money.
 */
function balances(view: ToolReadView, party: ViewRef): BalancesAnswer | null {
  const finance = optionalQuery(view.ctx, "economy.finance");
  if (!finance) return { party, accounts: [], owes: [] };
  if (view.knowledge !== "pov") return wholeMoney(view, party, finance(view.ctx, party.id, false));
  const mine = finance(view.ctx, view.pov, true);
  if (party.id === view.pov) return wholeMoney(view, party, mine);
  const shared = mine.accounts.filter((a) => rightsOf(view.state, a.id, party.id) !== null);
  return shared.length === 0 ? null : { party, accounts: accountReads(view, party, shared), owes: owedOn(view, shared) };
}

/**
 * Everything a place sells (`placeTrade`): each catalog item of a category it sells, or that it
 * sells by id, priced there (`priceOf`), in the order the economy pack's Buy options list them
 * (`economy.offers`: by category, then id), each once and every one of them.
 */
function sells(view: ToolReadView, place: PlaceId | null): Offered[] {
  const trade = placeTrade(view.ctx, place);
  const rows = view.ctx.tables.get("economy.catalog")?.rows ?? {};
  const ids = Object.keys(rows).sort();
  const listed = new Set<string>();
  const out: Offered[] = [];
  for (const category of trade.categories) {
    for (const id of ids) {
      const row = own(rows, id);
      if (!row || listed.has(id) || (strOf(row.category) !== category && !trade.sells.includes(id))) continue;
      const price = priceOf(view.ctx, { catalog: id, place });
      if (!price) continue;
      listed.add(id);
      out.push({ catalog: id, name: price.name, category: price.category, unit: strOf(row.unit) || undefined, ...amount(view, price.unitCents) });
    }
  }
  return out;
}

/**
 * An item priced at a place: a catalog item by its id, a price category by its id, else the catalog
 * item a purchase of it there would be (`matchCatalog`); null for one nothing in the catalog prices.
 */
function priced(view: ToolReadView, item: string, place: PlaceId | null): ItemPrice | null {
  const { ctx } = view;
  const byId = rowOf(ctx, "economy.catalog", item) !== undefined;
  const category = !byId && rowOf(ctx, "economy.categories", item) !== undefined ? item : null;
  const catalog = byId ? item : category === null ? matchCatalog(ctx, item, place) : null;
  const price = catalog !== null ? priceOf(ctx, { catalog, place }) : category !== null ? priceOf(ctx, { category, place }) : null;
  if (!price) return null;
  // Sold there as Buy options are (`placeTrade`): a category it sells, or the item it sells by id.
  const trade = placeTrade(ctx, place);
  const unit = catalog === null ? "" : strOf(rowOf(ctx, "economy.catalog", catalog)?.unit);
  return {
    catalog: catalog ?? undefined,
    category: price.category,
    name: price.name,
    unit: unit || undefined,
    source: price.source,
    ...amount(view, price.unitCents),
    band: { min: amount(view, price.band.min), typical: amount(view, price.band.typical), max: amount(view, price.band.max) },
    sold: trade.categories.includes(price.category) || (catalog !== null && trade.sells.includes(catalog)),
  };
}

/** The money family, in the order of its texts (`shared/agent-tools-read.ts`). */
export const MONEY_TOOLS: readonly ToolDefinition[] = [
  {
    name: BALANCES,
    family: "money",
    tier: "read",
    parameters: () => objectSchema({ person: text() }),
    run: async (args, env) => {
      const view = await env.reader.view();
      const said = textArg(args, "person");
      return view.read(() => {
        const r = said === null ? { id: view.pov } : resolveEntity(view, said);
        if ("refused" in r) return r.refused;
        const party = view.entity(r.id);
        // Money is a person's or a party's (a business, a trust, a household); nothing else holds any.
        if (!party || !isParty(view.ctx, r.id)) return view.refuse(TOOL_NOTE.noPerson, { name: said ?? view.name(r.id) });
        const money = balances(view, party);
        return money ? view.answer(money) : beyondPov(view);
      });
    },
  },
  {
    name: PRICES,
    family: "money",
    tier: "read",
    parameters: (world) => objectSchema({ item: text(), place: text(placeEnum(world)) }),
    run: async (args, env) => {
      const view = await env.reader.view();
      const said = textArg(args, "place");
      const item = textArg(args, "item");
      return view.read(() => {
        const r = said === null ? { id: placeOfEntity(view.state, view.pov) } : resolvePlace(view, said);
        if ("refused" in r) return r.refused;
        const place = r.id === null ? null : placeShown(view, r.id);
        const answer: PriceAnswer | SellsAnswer = item === null ? { place, sells: sells(view, r.id) } : { place, item, price: priced(view, item, r.id) };
        return view.answer(answer);
      });
    },
  },
];
