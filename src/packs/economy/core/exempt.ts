// Exempt organizations (ORG-SPEC §3.11, Phase 5; DESIGN §26.3): an organization's `tax_exempt` names a
// row of the world's `economy.exempt` table (charity, church, club), which says what the status
// spares it: income tax always; FUTA and SUTA as its row says; and whether a person's gifts to it
// are deductible. A status the world's table doesn't hold (a world made before the table shipped,
// or a row taken out) exempts nothing, and lint says so (`orgs.exempt_unknown`).
//
// Donations: `donate` gives an organization money, as a turn, filed under `donations`, with what it
// was for the donor's taxes kept beside it (`economy.donation`): deductible when a person gives to an
// organization whose status says so, at the time of the gift. The taxes module takes a year's
// deductible gifts off the donor's ordinary income and, at the top level, refunds what they saved.

import type { JsonObject, JsonValue } from "../../../shared/json";
import type { EntityId } from "../../../shared/ids";
import type { LedgerEvent, PackEvent } from "../../../shared/ledger";
import { FINANCE_ACTIONS, type ExemptView } from "../../../shared/finance";
import { GROUP_KIND } from "../../../engine/selector";
import { calendarOf, dateAt } from "../../../engine/calendar";
import { orgTypeOf } from "../../../engine/org";
import { labelOf, numOf, objOf, optionalService, own, rowOf, sliceOf, sliceRecord, strOf } from "../../../engine/pack-kit";
import type { EffectContext, EventTypeDef, ReadContext, Rejection } from "../../../engine/registry";
import { isGone } from "../../../engine/scope";
import type { WorldState } from "../../../engine/state";
import { actAs, asParam, mayAs, moneyWords } from "./acting";
import type { FinanceApi, FinanceRegistry } from "./module";

/** The table of exempt statuses. */
export const EXEMPT_TABLE = "economy.exempt";

/** `economy.donation`: a gift to an organization, as its donor's taxes and its receiver's Taxes keep it. */
export const DONATION = "economy.donation";

/** Years of gifts kept per donor and per receiver: this one and the last, whose refund comes in April. */
const YEARS_KEPT = 2;

/** The status an organization's `tax_exempt` names, as its row reads; null when it names none, or one the world's table doesn't hold. */
export function exemptStatusOf(ctx: Pick<ReadContext, "state" | "tables">, org: EntityId): ExemptView | null {
  const status = strOf(own(ctx.state.entities, org)?.fields.tax_exempt).trim();
  if (status === "") return null;
  const row = rowOf(ctx, EXEMPT_TABLE, status);
  if (!row || row.income_tax_exempt === false) return null;
  return { status, name: strOf(row.name, status), code: strOf(row.code), deductible: row.donations_deductible === true, futa: row.futa !== false, suta: row.suta !== false };
}

/** Whether an organization's status exempts it from income tax. */
export function isExempt(ctx: Pick<ReadContext, "state" | "tables">, org: EntityId): boolean {
  return exemptStatusOf(ctx, org) !== null;
}

/** The statuses the world's exempt table holds that exempt an organization from income tax, in the table's order: what GM → Orgs offers. */
export function exemptStatuses(ctx: Pick<ReadContext, "tables">): { id: string; name: string; code: string }[] {
  return Object.entries(ctx.tables.get(EXEMPT_TABLE)?.rows ?? {}).flatMap(([id, row]) => (row.income_tax_exempt === false ? [] : [{ id, name: strOf(row.name, id), code: strOf(row.code) }]));
}

// ---------------------------------------------------------------- donations

function donations(state: Readonly<WorldState>, side: "given" | "received", party: EntityId): JsonObject {
  return objOf(own(objOf(objOf(sliceOf(state, "economy").donations)[side]), party));
}

/** A donor's gifts in a year: deductible, and the rest. */
export function donationsGiven(state: Readonly<WorldState>, donor: EntityId, year: number): { deductible: number; other: number } {
  const y = objOf(own(donations(state, "given", donor), String(year)));
  return { deductible: numOf(y.deductible), other: numOf(y.other) };
}

/** What an organization received in gifts in a year. */
export function donationsReceived(state: Readonly<WorldState>, org: EntityId, year: number): number {
  return numOf(own(donations(state, "received", org), String(year)));
}

/** The donors with deductible gifts kept, by id. */
export function deductibleDonors(state: Readonly<WorldState>): EntityId[] {
  const given = objOf(objOf(sliceOf(state, "economy").donations).given);
  return Object.keys(given)
    .filter((donor) => Object.values(objOf(given[donor])).some((y) => numOf(objOf(y).deductible) > 0))
    .sort();
}

/** Adds to one side's year (inside the event's apply), keeping the newest years. */
function addDonation(state: WorldState, side: "given" | "received", party: EntityId, year: number, value: (was: JsonValue | undefined) => JsonValue): void {
  const all = sliceRecord(state, "economy", "donations");
  const sideOf: JsonObject = { ...objOf(all[side]) };
  const mine: JsonObject = { ...objOf(own(sideOf, party)) };
  mine[String(year)] = value(own(mine, String(year)));
  for (const old of Object.keys(mine).sort().slice(0, Math.max(0, Object.keys(mine).length - YEARS_KEPT))) delete mine[old];
  sideOf[party] = mine;
  all[side] = sideOf;
}

function str(e: PackEvent, k: string): string {
  return typeof e.data[k] === "string" ? (e.data[k] as string) : "";
}

/** `economy.donation`: a gift's amount added to its donor's year (deductible or not, as it was when given) and to its receiver's. Its posting travels beside it in one unit. */
export const DONATION_EVENT: EventTypeDef<PackEvent> = {
  type: DONATION,
  validate: (e, ctx) => (own(ctx.state.entities, str(e, "donor")) && own(ctx.state.entities, str(e, "org")) && typeof e.data.cents === "number" && typeof e.data.year === "number" ? null : ({ code: "bad_event", reason: "a donation needs its donor, its receiver, its amount and its year" } satisfies Rejection)),
  apply: (e, state) => {
    const cents = numOf(e.data.cents);
    const year = numOf(e.data.year);
    const key = e.data.deductible === true ? "deductible" : "other";
    addDonation(state, "given", str(e, "donor"), year, (was) => ({ ...objOf(was), [key]: numOf(objOf(was)[key]) + cents }));
    addDonation(state, "received", str(e, "org"), year, (was) => numOf(was) + cents);
  },
  describe: (e, ctx, viewer) => (viewer ? "" : `Donation: ${labelOf(ctx, str(e, "donor"))} to ${labelOf(ctx, str(e, "org"))}`),
};

/**
 * `economy.donate`: `from` (a party, or an organization given for, `by` acting) gives `to`, an
 * organization, `cents`: paid as the giver pays (or by `method`), filed under `donations`, with its
 * `economy.donation`. Deductible when the giver is a person and the receiver's status says gifts are.
 */
function donateEvents(api: FinanceApi, ctx: EffectContext, a: Record<string, JsonValue>): LedgerEvent[] | Rejection {
  const to = strOf(a.to);
  const by = strOf(a.by);
  const from = strOf(a.from) || by || ctx.world.pov;
  const cents = Math.round(numOf(a.cents));
  if (orgTypeOf(ctx, to) === null || isGone(ctx.state, to)) return { code: "not_an_organization", reason: `${labelOf(ctx, to)} isn't an organization to give to` };
  if (from === to) return { code: "bad_target", reason: "an organization doesn't give to itself" };
  if (cents <= 0) return { code: "bad_amount", reason: "a gift is more than nothing" };
  const method = strOf(a.method);
  return actAs(ctx, { by, party: from, power: "money.spend", target: to, amount: cents, line: () => `Gave ${labelOf(ctx, to)} ${moneyWords(ctx, cents)}`, names: [to] }, () => {
    const paid = api.pay(ctx, { from, to, cents, memo: `Donation to ${labelOf(ctx, to)}`, kind: "payment", category: "donations", ...(method !== "" ? { method } : {}) });
    if (!Array.isArray(paid)) return paid;
    const deductible = api.partyKind(ctx, from) === "person" && exemptStatusOf(ctx, to)?.deductible === true;
    return [...paid, { type: DONATION, data: { donor: from, org: to, cents, year: dateAt(calendarOf(ctx.world), ctx.state.clock).year, deductible } }];
  });
}

/**
 * `economy.tax_status`: an organization's exempt status set (a row of the exempt table) or taken off
 * (`status` empty), as the GM or an op sets it; a household and the party hold none. With `by`, its
 * History line is theirs.
 */
function taxStatusEvents(ctx: EffectContext, a: Record<string, JsonValue>): LedgerEvent[] | Rejection {
  const org = strOf(a.org);
  const status = strOf(a.status).trim();
  const type = isGone(ctx.state, org) ? null : orgTypeOf(ctx, org);
  if (type === null) return { code: "missing_entity", reason: `no organization ${labelOf(ctx, org)}` };
  if (status !== "" && (type === "household" || type === "party")) return { code: "not_exempt", reason: `${labelOf(ctx, org)} is a ${type}, which can't hold a tax exemption` };
  const row = status === "" ? null : rowOf(ctx, EXEMPT_TABLE, status);
  if (status !== "" && !row) return { code: "unknown_status", reason: `"${status}" isn't a status in this world's exempt table (${Object.keys(ctx.tables.get(EXEMPT_TABLE)?.rows ?? {}).join(", ") || "none"})` };
  if (strOf(own(ctx.state.entities, org)?.fields.tax_exempt).trim() === status) return { code: "no_change", reason: `${labelOf(ctx, org)} ${status === "" ? "isn't exempt" : `is exempt as ${strOf(row?.name, status)} already`}` };
  const by = strOf(a.by);
  const text = status === "" ? "No longer exempt from income tax" : `Exempt from income tax as ${strOf(row?.name, status)}${strOf(row?.code) !== "" ? ` (${strOf(row?.code)})` : ""}`;
  const line = by !== "" && by !== org ? (optionalService(ctx, "orgs.acted")?.(ctx, { org, by, power: "org.govern", text }) ?? []) : [];
  return [{ type: "set", entity: org, field: "tax_exempt", value: status }, ...line];
}

/** Exempt organizations and gifts: the donation's event, `economy.donate` (an effect and the `donate` action) and `economy.tax_status`. */
export function registerExempt(r: FinanceRegistry): void {
  const { api, core } = r;
  core.event(DONATION_EVENT);
  core.effect({ type: "economy.donate", args: ["to", "cents", "from?", "method?", "by?"], gm: true, resolve: (a, ctx) => donateEvents(api, ctx, a) });
  core.effect({ type: "economy.tax_status", args: ["org", "status?", "by?"], gm: true, resolve: (a, ctx) => taxStatusEvents(ctx, a) });
  core.action({
    id: FINANCE_ACTIONS.donate,
    label: "Donate",
    description: "Give money to an organization: a charity, a church, a club. A person's gift to a charity or a church is deductible from their income tax.",
    pack: "economy",
    params: {
      to: { type: "ref", of: { kind: [GROUP_KIND, "trust"] }, label: "To" },
      amount: { type: "money" },
      method: { type: "text", optional: true, label: "Paid with (cash, card, debit or savings, or the card or account the input names, in its words)" },
      as: asParam("money.spend", "Giving as: an organization you may spend for, only when the input gives from its money; left out, you give"),
    },
    requires: ["amount > 0", "can_afford(self, amount)", mayAs("money.spend")],
    outcomes: { default: [{ type: "economy.donate", args: { from: "self", to: "to", cents: "=amount", method: "=params.method", by: "actor" } }] },
    duration: "5",
    lexicon: ["donate", "make a donation", "give to charity", "tithe", "put money in the collection plate", "sponsor"],
    observable: "makes a donation",
  });
}
