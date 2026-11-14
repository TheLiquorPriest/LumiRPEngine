// Money (the skill `economy`): what today's money tools and the economy's own effects do besides a
// payment (`world_apply` `pay`): a correction to an account, accounts opened and closed, credit and
// loans, a tax status, a gift to an organization, and what a thing costs where. Each runs today's
// economy (`packs/economy`). What today's economy would refuse for what it means (a correction or a
// gift past what is held, an account closed with money on it, credit its lending rules turn down)
// is applied all the same and reported.

import type { JsonObject, JsonValue } from "rp-harness/contract";
import { CLASS_TRAITS, FINANCE_EVENTS } from "../../shared/finance";
import type { LedgerEvent } from "../../shared/ledger";
import { formatMoney } from "../../shared/world";
import { labelOf, numOf, optionalService, own, rowOf, strOf } from "../../engine/pack-kit";
import { calendarOf, dateAt } from "../../engine/calendar";
import { placeOfEntity } from "../../engine/scope";
import { openAccount as openProductAccount } from "../../packs/economy/core/actions";
import { aprFor, currentScore, decide } from "../../packs/economy/core/credit";
import { DONATION, exemptStatusOf, foundationTerms } from "../../packs/economy/core/exempt";
import { matchCatalog, placeTrade } from "../../packs/economy/core/index";
import { isOpened } from "../../packs/economy/core/journal";
import { balance, dayPriceOf, openerOf, priceOf, statusOf, worldProducts } from "../../packs/economy/core/model";
import { cardsOn, featureFor, NO_WAY_TO_PAY } from "../../packs/economy/core/pay";
import { openingEvent } from "../../packs/economy/core/process";
import { NUMBER, TEXT, WHOLE } from "../kit";
import { find, isUnread, minorUnits, missed, named, notAs, notOneOf, numberArg, textArg } from "../ops";
import { openAuthored, paidLines, payPastCover } from "../ops-values";
import type { Reading } from "../reading";
import { editChange, effectChange, effectTool, notApplicable, optionalId, readTool, type WriteDef, writeTool } from "./run";

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
    if (cents === 0) return notAs(o, "amount", o.args.amount ?? null, "amount_not_zero");
    const w = o.draft.w;
    const from = w.events.length;
    // An account the world authored and nobody has opened opens first, as the economy's correction would open it inside its own unit: no call said its opening, so it is a change of its own.
    const opener = openerOf(w.state, account.id);
    const opening = opener !== null && !isOpened(w.state, account.id, opener) ? openingEvent(w.ctx, opener) : null;
    const unopened = opening === null ? null : o.draft.fillWith([opening]);
    if (unopened) return notApplicable(o, unopened.code);
    const refused = editChange(o, { op: "adjust", account: account.id, cents });
    if (refused !== null) {
      // Past what the account holds, the funds guard declines it: today's correction all the same,
      // its posting marked as today's story payments past cover are (`overdraw`), and reported.
      if (refused.code !== "declined") return notApplicable(o, refused.code);
      // Out of an account that is not open, every posting is declined as it folds (the funds guard), so it cannot stand on any path: said as the books' rule, not as a failure.
      const status = statusOf(w.state, account.id);
      if (status !== "open") return { line: "not_open", fields: { n: o.n, op: o.op, what: named(o.reading, account.id), status } };
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
  opensMoney: true,
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
  args: [{ field: "account", want: "thing" }],
  shows: (_o, state, args) => ({ status: statusOf(state.world, String(args.account)) }),
  properties: { account: TEXT },
  required: ["account"],
  example: { account: "Bram's till account", source: { from: "prose", message: "m-0202" } },
  // With money on it, or an opening still to post, today's economy keeps it open: it is closed all
  // the same, its cards cancelled as today's closing cancels them, and the answer says what is on it.
  bend(o, code, args) {
    if (code !== "not_empty") return null;
    const ctx = o.draft.w.ctx;
    const account = String(args.account);
    const held = balance(ctx.state, account);
    const left = held !== 0 ? held : Math.round(numOf(own(ctx.state.entities, account)?.fields.opening));
    const cards = cardsOn(ctx.state, account).map((c): LedgerEvent => ({ type: "set", entity: c, field: "state", value: "cancelled" }));
    const bad = o.draft.applyAll([{ type: FINANCE_EVENTS.status, data: { account, status: "closed" } }, ...cards]);
    if (bad) return notApplicable(o, bad.code);
    o.reply.report("closed_with_money", { n: o.n, op: o.op, what: named(o.reading, account), amount: formatMoney(left, o.reading.doc.currency) });
    return undefined;
  },
});

/**
 * Credit asked for, as today's economy decides it (`economy.apply_credit`). Where its lending rules
 * turn the application down, the credit is opened all the same, as an approved one opens (the
 * inquiry, the account at the product's or the score's rate, a loan's principal paid out), and the
 * answer says that the world's rules would have refused it.
 */
const applyCredit: WriteDef = {
  name: "apply_credit",
  family: FAMILY,
  lane: "engine",
  properties: { who: TEXT, product: TEXT, amount: NUMBER, term: WHOLE, secured_by: TEXT },
  required: ["who", "product"],
  example: { who: "wren", product: "loan", amount: 40, term: 12, source: { from: "prose", message: "m-0203" } },
  run(o) {
    const who = find(o, "who", "entity");
    if (isUnread(who)) return who;
    const product = textArg(o.args, "product") ?? "";
    const amount = o.args.amount;
    if (amount !== undefined && amount !== null && numberArg(o.args, "amount") === undefined) return notAs(o, "amount", amount, "amount_any");
    const given = numberArg(o.args, "amount");
    const cents = given !== undefined && given > 0 ? minorUnits(o.reading, given) : undefined;
    const term = typeof o.args.term === "number" && o.args.term > 0 ? Math.round(o.args.term) : undefined;
    const secured = optionalId(o, "secured_by", "thing");
    if (isUnread(secured)) return secured;
    const w = o.draft.w;
    const from = w.events.length;
    const unopened = openAuthored(o, [who.id]);
    if (unopened) return unopened;
    const ctx = w.ctx;
    const reports = featureFor(ctx, who.id, "credit");
    const decision = decide(ctx, who.id, { product, ...(cents !== undefined ? { cents } : {}), ...(term !== undefined ? { term_months: term } : {}), ...(secured !== undefined ? { secured_by: secured } : {}) }, reports);
    if ("code" in decision || decision.approved) {
      const refused = effectChange(o, { type: "economy.apply_credit", args: { who: who.id, product, ...(cents !== undefined ? { cents } : {}), ...(term !== undefined ? { term } : {}), ...(secured !== undefined ? { secured_by: secured } : {}) } });
      if (refused !== null) return notApplicable(o, refused.code);
    } else {
      const def = own(worldProducts(ctx.world), product);
      const apr = reports ? (def?.apr_pct ?? aprFor(ctx, decision.cls, currentScore(ctx, who.id))) : null;
      const limit = cents ?? (typeof def?.limit === "number" ? def.limit : undefined);
      const opened = openProductAccount(ctx, { name: decision.label, product, owners: [{ party: who.id, role: "owner" }], ...(limit !== undefined ? { cents: limit } : {}), ...(term !== undefined ? { term_months: term } : {}), ...(apr !== null ? { apr_pct: apr } : {}), ...(secured !== undefined ? { secured_by: secured } : {}), card: CLASS_TRAITS[decision.cls].revolving });
      if ("code" in opened) return notApplicable(o, opened.code);
      const inquiry: LedgerEvent[] = reports ? [{ type: FINANCE_EVENTS.credit, data: { person: who.id, kind: "inquiry", note: product.replace(/_/g, " ") } }] : [];
      const bad = o.draft.applyAll([...inquiry, ...opened]);
      if (bad) return notApplicable(o, bad.code);
      o.reply.report("against_rules", { n: o.n, op: o.op, what: named(o.reading, who.id), code: "declined" });
    }
    o.draft.record(o.n, o.op, "engine", o.prov, from);
    return undefined;
  },
};

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
  opensMoney: true,
  args: [{ field: "to", want: "entity" }, { field: "amount", arg: "cents", money: true }, { field: "from", want: "entity" }, { field: "method" }],
  properties: { to: TEXT, amount: NUMBER, from: TEXT, method: TEXT },
  required: ["to", "amount"],
  example: { to: "The Lamplighters", amount: 5, from: "wren", source: { from: "prose", message: "m-0204" } },
  // Past what the giver has to hand, today's economy declines it: the gift (or an exempt group's
  // grant to a person) is posted all the same from the giver's own money, as a payment past cover
  // is (`payPastCover`), with today's record of it, and what did not add up is reported (`paidLines`).
  bend(o, code, args) {
    if (code !== "declined" && code !== NO_WAY_TO_PAY) return null;
    const ctx = o.draft.w.ctx;
    const to = String(args.to);
    const from = typeof args.from === "string" ? args.from : ctx.world.pov;
    const cents = Number(args.cents);
    const grant = o.reading.isPerson(to);
    const deductible = !grant && o.reading.isPerson(from) && exemptStatusOf(ctx, to)?.deductible === true;
    const pf = deductible && foundationTerms(ctx, to) !== null;
    const record: LedgerEvent = { type: DONATION, data: { donor: from, org: to, cents, year: dateAt(calendarOf(ctx.world), ctx.state.clock).year, deductible, ...(pf ? { pf: true } : {}) } };
    const before = o.draft.w.events.length;
    const failed = payPastCover(o, { payer: from, payee: to, cents, memo: `${grant ? "Grant" : "Donation"} to ${labelOf(ctx, to)}`, kind: "payment", category: "donations", with: [record] });
    if (failed) return failed;
    paidLines(o, from, cents, before);
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
      if (!("id" in found)) return { line: "unknown", fields: missed(r.lines, "place", found, "place") };
      place = found.id;
    }
    const at: JsonValue = place === null ? null : { ref: `place:${place}`, name: r.nameOf(place) };
    const item = textArg(args, "item");
    reply.data(item === undefined ? { place: at, sells: sells(r, place) } : { place: at, item, price: priced(r, item, place) });
    return undefined;
  },
});

/** The family's tools, as RPH's search finds them. */
export const MONEY_TOOLS = [writeTool(adjust), openAccount, closeAccount, writeTool(applyCredit), taxStatus, donate, prices];
