// Money (the skill `economy`): what today's money tools and the economy's own effects do besides a
// payment (`world_apply` `pay`): a correction to an account, accounts opened and closed, credit and
// loans, a tax status, a gift to an organization, and what a thing costs where. Each runs today's
// economy (`packs/economy`). What today's economy would refuse for what it means (a correction or a
// gift past what is held, an account closed with money on it, credit its lending rules turn down)
// is applied all the same and reported.

import type { JsonObject, JsonValue } from "rp-harness/contract";
import { CLASS_TRAITS, FINANCE_EVENTS, isAccountClass, isCredit } from "../../shared/finance";
import type { LedgerEvent } from "../../shared/ledger";
import { formatMoney } from "../../shared/world";
import { labelOf, numOf, own, rowOf, strOf } from "../../engine/pack-kit";
import { calendarOf, dateAt } from "../../engine/calendar";
import type { ReadContext } from "../../engine/registry";
import { placeOfEntity } from "../../engine/scope";
import { creditApplication } from "../../packs/economy/core/actions";
import { currentScore } from "../../packs/economy/core/credit";
import { DONATION, donateFindings, exemptStatuses, exemptStatusOf, foundationTerms, taxFindings } from "../../packs/economy/core/exempt";
import { matchCatalog, placeTrade } from "../../packs/economy/core/index";
import { isOpened } from "../../packs/economy/core/journal";
import { balance, dayPriceOf, openerOf, priceOf, statusOf, worldProducts } from "../../packs/economy/core/model";
import { cardsOn, featureFor, NO_WAY_TO_PAY } from "../../packs/economy/core/pay";
import { openingEvent } from "../../packs/economy/core/process";
import { NUMBER, TEXT, WHOLE } from "../kit";
import { find, isUnread, minorUnits, missed, named, notAs, numberArg, outsideList, textArg, type OpContext, type Unread } from "../ops";
import { openAuthored, paidLines, payPastCover } from "../ops-values";
import type { Reading } from "../reading";
import { textOf } from "../texts";
import { editChange, effectTool, notApplicable, optionalId, readTool, type WriteDef, writeTool } from "./run";

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
    // The funds guard advises, never declines: a correction out of an account that is not open, or past what it held, stands as given, and the guard's advice (`account_not_open`, `corrected_past_held`) is its one report.
    const refused = editChange(o, { op: "adjust", account: account.id, cents });
    if (refused !== null) return notApplicable(o, refused.code);
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
  args: [{ field: "who", arg: "party", want: "party" }, { field: "product" }, { field: "name" }, { field: "due_day" }, { field: "statement_day" }, { field: "autopay_from", want: "thing" }],
  properties: { who: TEXT, product: TEXT, name: TEXT, due_day: WHOLE, statement_day: WHOLE, autopay_from: TEXT },
  required: ["who", "product"],
  example: { who: "bram", product: "checking", name: "Bram's till account", source: { from: "prose", message: "m-0201" } },
  // A day that is not a day of the month is answered naming it, never dropped.
  bend(o, code) {
    if (code !== "bad_day") return null;
    const field = ["due_day", "statement_day"].find((f) => o.args[f] !== undefined && o.args[f] !== null && !(typeof o.args[f] === "number" && Number.isInteger(o.args[f]) && Number(o.args[f]) >= 1 && Number(o.args[f]) <= 31)) ?? "due_day";
    return notAs(o, field, o.args[field] ?? null, "day_of_month");
  },
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

/** What a product is called as the world's products name it, else its class's own name. */
function productLabel(ctx: ReadContext, product: string): string {
  const def = own(worldProducts(ctx.world), product);
  const cls = def?.class ?? (isAccountClass(product) ? product : null);
  return def?.label ?? (cls !== null ? CLASS_TRAITS[cls].label : product);
}

/** Every product that is credit: the world's, and the kinds of credit themselves. */
function creditProducts(ctx: ReadContext): string[] {
  const world = Object.entries(worldProducts(ctx.world)).filter(([, def]) => isCredit(def.class)).map(([id]) => id);
  const kinds = (Object.keys(CLASS_TRAITS) as (keyof typeof CLASS_TRAITS)[]).filter((k) => isCredit(k));
  return [...new Set([...world, ...kinds])].sort();
}

/**
 * Credit asked for, opened through the economy's own path (`creditApplication`) with what the call gives: its amount,
 * term, rate (`apr`) and limit. Where the lending rules turn the application down, the credit is opened all the same,
 * with the same fields and events as an approved one, and the answer says the rules would have refused it. What the
 * call leaves out and the world's tables supply (the rate for the person's score, the product's limit) is recorded
 * apart, as filled in; a person with no score is read at `engine.creditScoreAssumed`, and the answer says so.
 */
const applyCredit: WriteDef = {
  name: "apply_credit",
  family: FAMILY,
  lane: "engine",
  properties: { who: TEXT, product: TEXT, amount: NUMBER, term: WHOLE, secured_by: TEXT, apr: NUMBER, limit: NUMBER },
  required: ["who", "product"],
  example: { who: "wren", product: "loan", amount: 40, term: 12, source: { from: "prose", message: "m-0203" } },
  run(o) {
    const who = find(o, "who", "party");
    if (isUnread(who)) return who;
    const product = textArg(o.args, "product") ?? "";
    // An amount, a rate, a limit and a term that cannot be read are answered naming the field and what it takes; none is rounded or dropped.
    const sum = (field: string, floor: "above" | "least"): number | undefined | Unread => {
      const said = o.args[field];
      if (said === undefined || said === null) return undefined;
      const n = numberArg(o.args, field);
      return n === undefined || (floor === "above" ? n <= 0 : n < 0) ? notAs(o, field, said, field === "apr" ? "apr" : "amount") : n;
    };
    const amount = sum("amount", "above");
    if (isUnread(amount)) return amount;
    const limit = sum("limit", "above");
    if (isUnread(limit)) return limit;
    const apr = sum("apr", "least");
    if (isUnread(apr)) return apr;
    const said = o.args.term;
    if (said !== undefined && said !== null && !(typeof said === "number" && Number.isInteger(said) && said > 0)) return notAs(o, "term", said, "term");
    const term = typeof said === "number" ? said : undefined;
    const secured = optionalId(o, "secured_by", "thing");
    if (isUnread(secured)) return secured;
    const w = o.draft.w;
    const from = w.events.length;
    const unopened = openAuthored(o, [who.id]);
    if (unopened) return unopened;
    const ctx = w.ctx;
    const name = productLabel(ctx, product);
    const assumed = o.call.settings.creditScoreAssumed;
    const made = creditApplication(ctx, who.id, {
      product,
      ...(amount !== undefined ? { cents: minorUnits(o.reading, amount) } : {}),
      ...(term !== undefined ? { term_months: term } : {}),
      ...(secured !== undefined ? { secured_by: secured } : {}),
      ...(apr !== undefined ? { apr_pct: apr } : {}),
      ...(limit !== undefined ? { limit: minorUnits(o.reading, limit) } : {}),
      scoreAssumed: assumed,
      force: true,
      apart: true,
      memo: o.call.lines.line("loan_paid_out", { name }) ?? "",
      card_name: o.call.lines.line("credit_card_name", { name }) ?? name,
    });
    if ("code" in made) {
      if (made.code === "not_credit") return outsideList(o, "product", product, creditProducts(ctx));
      return notApplicable(o, o.draft.note(made).code);
    }
    const bad = o.draft.applyAll(made.events);
    if (bad) return notApplicable(o, o.draft.note(bad).code);
    const filled = o.draft.fillWith(made.filled);
    if (filled) return notApplicable(o, o.draft.note(filled).code);
    const d = made.decision;
    const score = featureFor(ctx, who.id, "credit") ? currentScore(ctx, who.id) : null;
    if (!d.approved) o.reply.report("against_rules", { n: o.n, op: o.op, what: named(o.reading, who.id), code: "declined", class: d.cls, ...(score !== null ? { score } : {}), reason: d.reason });
    if (score === null && featureFor(ctx, who.id, "credit")) o.reply.report("score_assumed", { n: o.n, op: o.op, what: named(o.reading, who.id), score: assumed });
    o.draft.record(o.n, o.op, "engine", o.prov, from);
    return undefined;
  },
};

const taxStatus = effectTool({
  name: "tax_status",
  family: FAMILY,
  lane: "engine",
  effect: "economy.tax_status",
  args: [{ field: "org", want: "organization" }, { field: "status" }],
  properties: { org: TEXT, status: TEXT },
  required: ["org"],
  example: { org: "The Lamplighters", status: "charity", source: { from: "lore", lore: "lore-lamplighters" } },
  // A status on one the world's rule says cannot hold it (a household, a party) is recorded and reported.
  watch(o, args) {
    const found = taxFindings(o.draft.w.ctx, args);
    return () => {
      for (const f of found) o.reply.report(f.code, { n: o.n, op: o.op, ...f.values });
    };
  },
  // A status the world's table does not hold is answered with the table's, and names `fact`.
  bend(o, code, args) {
    return code === "unknown_status" ? outsideList(o, "status", args.status ?? null, exemptStatuses(o.draft.w.ctx).map((s) => s.id)) : null;
  },
});

/**
 * A gift between any two parties, from the one the call names, with the memo the call gives, else the answers file's line
 * for a gift or a grant filled with the receiver's name. A grant to a person by one who is no exempt organization and a
 * party's gift to itself are recorded all the same and reported.
 */
const donate = effectTool({
  name: "donate",
  family: FAMILY,
  lane: "engine",
  effect: "economy.donate",
  opensMoney: true,
  args: [{ field: "to", want: "party" }, { field: "amount", arg: "cents", money: true }, { field: "from", want: "party" }, { field: "method" }, { field: "memo" }],
  properties: { to: TEXT, amount: NUMBER, from: TEXT, method: TEXT, memo: TEXT },
  required: ["to", "amount", "from"],
  example: { to: "The Lamplighters", amount: 5, from: "wren", source: { from: "prose", message: "m-0204" } },
  watch(o, args) {
    const ctx = o.draft.w.ctx;
    const to = String(args.to);
    // The memo is the call's; with none it is the answers file's line for a gift or a grant.
    if (typeof args.memo !== "string" || args.memo.trim() === "") args.memo = o.call.lines.line(o.reading.isPerson(to) ? "grant_memo" : "gift_memo", { to: o.reading.nameOf(to) }) ?? "";
    const found = donateFindings(ctx, args);
    return () => {
      for (const f of found) o.reply.report(f.code, { n: o.n, op: o.op, ...f.values });
    };
  },
  // An amount not above 0 is answered naming `amount`. Past what the giver has to hand, today's economy declines it: the gift
  // (or an exempt group's grant to a person) is posted all the same from the giver's own money, as a payment past cover
  // is (`payPastCover`), with today's record of it, and what did not add up is reported (`paidLines`).
  bend(o, code, args) {
    if (code === "bad_amount") return notAs(o, "amount", o.args.amount ?? null, "amount");
    if (code !== "declined" && code !== NO_WAY_TO_PAY) return null;
    const ctx = o.draft.w.ctx;
    const to = String(args.to);
    const from = String(args.from);
    const cents = Number(args.cents);
    const grant = o.reading.isPerson(to);
    const deductible = !grant && o.reading.isPerson(from) && exemptStatusOf(ctx, to)?.deductible === true;
    const pf = deductible && foundationTerms(ctx, to) !== null;
    const record: LedgerEvent = { type: DONATION, data: { donor: from, org: to, cents, year: dateAt(calendarOf(ctx.world), ctx.state.clock).year, deductible, ...(pf ? { pf: true } : {}) } };
    const before = o.draft.w.events.length;
    const failed = payPastCover(o, { payer: from, payee: to, cents, memo: String(args.memo ?? ""), kind: "payment", category: "donations", with: [record] });
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
