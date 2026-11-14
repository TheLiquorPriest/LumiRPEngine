// Money (the skill `economy`): what today's money tools and the economy's own effects do besides a
// payment (`world_apply` `pay`): a correction to an account, accounts opened and closed, credit and
// loans, a tax status, a gift to an organization, and what a thing costs where. Each runs today's
// economy (`packs/economy`). A correction that takes an account below nothing is applied and
// reported.

import type { JsonObject, JsonValue } from "rp-harness/contract";
import type { LedgerEvent } from "../../shared/ledger";
import { formatMoney } from "../../shared/world";
import { labelOf, optionalService, own, rowOf, strOf } from "../../engine/pack-kit";
import { calendarOf, dateAt } from "../../engine/calendar";
import { placeOfEntity } from "../../engine/scope";
import { DONATION, exemptStatusOf, foundationTerms } from "../../packs/economy/core/exempt";
import { matchCatalog, placeTrade } from "../../packs/economy/core/index";
import { accountsOf, dayPriceOf, external, priceOf, statusOf } from "../../packs/economy/core/model";
import { asUnit, cashAccount, mostPayable, NO_WAY_TO_PAY, payeeSide, posting } from "../../packs/economy/core/pay";
import { NUMBER, TEXT, WHOLE } from "../kit";
import { find, isUnread, named, notOneOf, numberArg, textArg } from "../ops";
import type { Reading } from "../reading";
import { editChange, effectTool, minorUnits, notApplicable, readTool, type WriteDef, writeTool } from "./run";

const FAMILY = "money";

/** A sum as the answer gives it: in the world's smallest unit, and in its currency's words. */
function amount(r: Reading, cents: number): JsonObject {
  return { cents, amount: formatMoney(cents, r.doc.currency) };
}

const adjust: WriteDef = {
  name: "gm_adjust_money",
  family: FAMILY,
  lane: "engine",
  properties: { account: TEXT, amount: NUMBER },
  required: ["account", "amount"],
  example: { account: "Wren's coin", amount: -3, source: { from: "gm" } },
  run(o) {
    const account = find(o, "account", "thing");
    if (isUnread(account)) return account;
    const given = numberArg(o.args, "amount");
    const cents = given === undefined ? 0 : minorUnits(o.reading, given);
    if (cents === 0) return notOneOf(o, "amount", o.args.amount ?? null, ["a number other than 0, in the world's main coin"]);
    const w = o.draft.w;
    const from = w.events.length;
    const refused = editChange(o, { op: "adjust", account: account.id, cents });
    if (refused !== null) {
      // Past what the account holds, the funds guard declines it: today's correction all the same,
      // its posting marked as today's story payments past cover are (`overdraw`), and reported.
      if (refused.code !== "declined") return notApplicable(o, refused.code);
      const events = optionalService(w.ctx, "economy.adjust")?.(w.ctx, account.id, cents);
      if (!Array.isArray(events)) return notApplicable(o, refused.code);
      const bad = o.draft.applyAll(events.map((e): LedgerEvent => (e.type === "post" ? { ...e, overdraw: true } : e)));
      if (bad) return notApplicable(o, bad.code);
    }
    const now = w.state.accounts[account.id] ?? 0;
    if (cents < 0 && now < 0) o.reply.report("paid_past_held", { n: o.n, op: o.op, payer: named(o.reading, account.id), amount: formatMoney(-cents, o.reading.doc.currency), held: formatMoney(Math.max(0, now - cents), o.reading.doc.currency) });
    o.draft.record(o.n, o.op, "engine", o.prov, from);
    return undefined;
  },
};

const openAccount = effectTool({
  name: "open_account",
  family: FAMILY,
  lane: "engine",
  effect: "economy.open_account",
  materialize: "money",
  args: [{ field: "who", arg: "party", want: "entity" }, { field: "product" }, { field: "name" }],
  properties: { who: TEXT, product: TEXT, name: TEXT },
  required: ["who"],
  example: { who: "bram", product: "checking", name: "Bram's till account", source: { from: "prose", message: "m-0201" } },
});

const closeAccount = effectTool({
  name: "close_account",
  family: FAMILY,
  lane: "engine",
  effect: "economy.close_account",
  materialize: "money",
  args: [{ field: "account", want: "thing" }],
  shows: (_o, state, args) => ({ status: statusOf(state.world, String(args.account)) }),
  properties: { account: TEXT },
  required: ["account"],
  example: { account: "Bram's till account", source: { from: "prose", message: "m-0202" } },
});

const applyCredit = effectTool({
  name: "apply_credit",
  family: FAMILY,
  lane: "engine",
  effect: "economy.apply_credit",
  materialize: "money",
  args: [{ field: "who", want: "entity" }, { field: "product" }, { field: "amount", arg: "cents", money: true }, { field: "term" }, { field: "secured_by", want: "thing" }],
  properties: { who: TEXT, product: TEXT, amount: NUMBER, term: WHOLE, secured_by: TEXT },
  required: ["who", "product"],
  example: { who: "wren", product: "loan", amount: 40, term: 12, source: { from: "prose", message: "m-0203" } },
});

const taxStatus = effectTool({
  name: "tax_status",
  family: FAMILY,
  lane: "engine",
  effect: "economy.tax_status",
  args: [{ field: "org", want: "entity" }, { field: "status" }],
  properties: { org: TEXT, status: TEXT },
  required: ["org"],
  example: { org: "The Lamplighters", status: "charity", source: { from: "lore", lore: "lore-lamplighters" } },
});

const donate = effectTool({
  name: "donate",
  family: FAMILY,
  lane: "engine",
  effect: "economy.donate",
  materialize: "money",
  args: [{ field: "to", want: "entity" }, { field: "amount", arg: "cents", money: true }, { field: "from", want: "entity" }, { field: "method" }],
  properties: { to: TEXT, amount: NUMBER, from: TEXT, method: TEXT },
  required: ["to", "amount"],
  example: { to: "The Lamplighters", amount: 5, from: "wren", source: { from: "prose", message: "m-0204" } },
  // Past what the giver has to hand, today's economy declines it: the gift is posted all the same
  // from the giver's own money, marked as today's story payments past cover are (`overdraw`), with
  // today's record of the donation, and reported.
  bend(o, code, args) {
    if (code !== "declined" && code !== NO_WAY_TO_PAY) return null;
    const ctx = o.draft.w.ctx;
    const to = String(args.to);
    const from = typeof args.from === "string" ? args.from : ctx.world.pov;
    const cents = Number(args.cents);
    if (o.reading.isPerson(to)) return null;
    const held = mostPayable(ctx, from, cents, { till: false, overdraft: true });
    const source = cashAccount(ctx, from) ?? accountsOf(ctx, from, "spend")[0] ?? external(from);
    const dest = payeeSide(ctx, { payee: to }, cents);
    const lines = [
      { account: source, amount: -cents },
      { account: dest.account, amount: cents },
    ];
    const paid = posting(lines, { memo: `Donation to ${labelOf(ctx, to)}`, kind: "payment", payer: from, counterparty: to, category: "donations", story: true }).map((e): LedgerEvent => (e.type === "post" ? { ...e, overdraw: true } : e));
    const deductible = o.reading.isPerson(from) && exemptStatusOf(ctx, to)?.deductible === true;
    const pf = deductible && foundationTerms(ctx, to) !== null;
    const record: LedgerEvent = { type: DONATION, data: { donor: from, org: to, cents, year: dateAt(calendarOf(ctx.world), ctx.state.clock).year, deductible, ...(pf ? { pf: true } : {}) } };
    const bad = o.draft.applyAll(asUnit([...paid, ...dest.extra, record]));
    if (bad) return notApplicable(o, bad.code);
    o.reply.report("paid_past_held", { n: o.n, op: o.op, payer: named(o.reading, from), amount: formatMoney(cents, o.reading.doc.currency), held: formatMoney(Math.max(0, held), o.reading.doc.currency) });
    return undefined;
  },
});

/** An item priced at a place as today's `money_prices` prices it: a catalog item, a price category, or the catalog item a purchase of it would be; null when nothing prices it. */
function priced(r: Reading, item: string, place: string | null): JsonObject | null {
  const ctx = r.ctx;
  const byId = rowOf(ctx, "economy.catalog", item) !== undefined;
  const category = !byId && rowOf(ctx, "economy.categories", item) !== undefined ? item : null;
  const catalog = byId ? item : category === null ? matchCatalog(ctx, item, place) : null;
  const price = catalog !== null ? dayPriceOf(ctx, { catalog, place }) : category !== null ? priceOf(ctx, { category, place }) : null;
  if (!price) return null;
  const trade = placeTrade(ctx, place);
  const unit = catalog === null ? "" : strOf(rowOf(ctx, "economy.catalog", catalog)?.unit);
  return {
    ...(catalog !== null ? { catalog } : {}),
    category: price.category,
    name: price.name,
    ...(unit !== "" ? { unit } : {}),
    source: price.source,
    ...amount(r, price.unitCents),
    band: { min: amount(r, price.band.min), typical: amount(r, price.band.typical), max: amount(r, price.band.max) },
    sold: trade.categories.includes(price.category) || (catalog !== null && trade.sells.includes(catalog)),
  };
}

/** Everything a place sells, each at its price there, in the order its trade lists them. */
function sells(r: Reading, place: string | null): JsonObject[] {
  const ctx = r.ctx;
  const trade = placeTrade(ctx, place);
  const rows = ctx.tables.get("economy.catalog")?.rows ?? {};
  const ids = Object.keys(rows).sort();
  const listed = new Set<string>();
  const out: JsonObject[] = [];
  for (const category of trade.categories) {
    for (const id of ids) {
      const row = own(rows, id);
      if (!row || listed.has(id) || (strOf(row.category) !== category && !trade.sells.includes(id))) continue;
      const price = dayPriceOf(ctx, { catalog: id, place });
      if (!price) continue;
      listed.add(id);
      out.push({ catalog: id, name: price.name, category: price.category, ...(strOf(row.unit) !== "" ? { unit: strOf(row.unit) } : {}), ...amount(r, price.unitCents) });
    }
  }
  return out;
}

const prices = readTool({
  name: "money_prices",
  family: FAMILY,
  properties: { item: TEXT, place: TEXT },
  required: [],
  example: { item: "a mug of cider", place: "The Common Room" },
  read(r, args, reply) {
    let place: string | null = placeOfEntity(r.state.world, r.doc.pov);
    if (textArg(args, "place") !== undefined) {
      const found = r.find(textArg(args, "place") ?? "", "place");
      if (!("id" in found)) return { line: "unknown", fields: { field: "place", name: found.name, wanted: "place", near: found.near.map((x) => `${x.name} [${x.id}]`) } };
      place = found.id;
    }
    const at: JsonValue = place === null ? null : { ref: `place:${place}`, name: r.nameOf(place) };
    const item = textArg(args, "item");
    reply.data(item === undefined ? { place: at, sells: sells(r, place) } : { place: at, item, price: priced(r, item, place) });
    return undefined;
  },
});

/** The family's tools, as RPH's search finds them. */
export const MONEY_TOOLS = [writeTool(adjust), openAccount, closeAccount, applyCredit, taxStatus, donate, prices];
