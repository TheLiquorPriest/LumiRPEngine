// An organization's own records (ORG-SPEC §3.17, §8, §9), in the `packs.orgs` slice, made when first
// written: its History (`orgs.log`, the last 40 lines per organization) and what each person spent
// for it in each calendar month (`orgs.spent`, the last 13 months per person), which `mayAct`'s
// monthly limit reads. Both are bookkeeping, secret, so neither is ever a player's line. `orgLog`
// makes a History line; `orgsActed` makes what an act for an organization records beside its
// effects, one unit with them (the `orgs.acted` service the economy calls).

import { say } from "../../../engine/lines";
import type { EntityId } from "../../../shared/ids";
import { isRecord, type JsonObject, type JsonValue } from "../../../shared/json";
import type { LedgerEvent, PackEvent } from "../../../shared/ledger";
import { isOrgPower, type OrgAct, type OrgLogLine, type OrgPower } from "../../../shared/org";
import { formatMoney } from "../../../shared/world";
import { spendMonth } from "../../../engine/org";
import { labelOf, numOf, objOf, own, sliceOf, sliceRecord, strOf } from "../../../engine/pack-kit";
import type { EventTypeDef, ReadContext } from "../../../engine/registry";
import type { WorldState } from "../../../engine/state";

export const ORGS_LOG = "orgs.log";
/** A History line taken off again (the Undo of one `orgs.log` made): the organization, and the line's words, time and doer as it was made. */
export const ORGS_LOG_REMOVED = "orgs.log_removed";
export const ORGS_SPENT = "orgs.spent";
/** History kept per organization (§9). */
export const LOG_KEPT = 40;
/** Months of spending kept per person and organization (§9). */
export const SPENT_MONTHS_KEPT = 13;

const MONTH = /^\d{4}-\d{2}$/;

/**
 * A line of `org`'s History, at the clock: `text` names people by name, and `names` are their ids,
 * kept with the names they have now, so a reader who can't see one of them reads "someone" there;
 * `power`, the one it was done with, so a money line reads only to those who may see the money.
 */
export function orgLog(ctx: Pick<ReadContext, "state">, org: EntityId, text: string, opts: { by?: EntityId; names?: readonly EntityId[]; power?: OrgPower } = {}): LedgerEvent {
  const names = [...new Set(opts.names ?? [])].map((id) => ({ id, name: own(ctx.state.entities, id)?.name ?? id }));
  return { type: ORGS_LOG, data: { org, text, at: ctx.state.clock, ...(opts.by ? { by: opts.by } : {}), ...(names.length > 0 ? { names } : {}), ...(opts.power ? { power: opts.power } : {}), visibility: "secret" } };
}

/**
 * The entities an act's arguments name (whom it pays or issues to, what it moves), for a History line
 * quoting its words (a motion's, a request's): passed as the line's `names`, so a reader who can't see
 * one of them reads "someone" there.
 */
export function actNames(ctx: Pick<ReadContext, "state">, act: { args: Readonly<Record<string, JsonValue>> }): EntityId[] {
  const out: EntityId[] = [];
  const walk = (v: JsonValue | undefined): void => {
    if (typeof v === "string") {
      if (v !== "" && own(ctx.state.entities, v) && !out.includes(v)) out.push(v);
    } else if (Array.isArray(v)) for (const x of v) walk(x);
    else if (isRecord(v)) for (const x of Object.values(v)) walk(x);
  };
  for (const v of Object.values(act.args)) walk(v);
  return out;
}

/** What an act for an organization records (§3.6, §3.8): a payment out of its money counts toward its payer's month (`orgs.spent`), and every act writes its History line. */
export function orgsActed(ctx: ReadContext, act: OrgAct): LedgerEvent[] {
  const cents = act.power === "money.spend" && typeof act.cents === "number" && Number.isFinite(act.cents) ? Math.round(act.cents) : 0;
  const spent: LedgerEvent[] = cents > 0 ? [{ type: ORGS_SPENT, data: { org: act.org, who: act.by, month: spendMonth(ctx.world, ctx.state.clock), cents, visibility: "secret" } }] : [];
  return [...spent, orgLog(ctx, act.org, act.text, { by: act.by, power: act.power, ...(act.names ? { names: act.names } : {}) })];
}

/** An organization's History, newest first. */
export function orgHistory(state: ReadContext["state"], org: EntityId): OrgLogLine[] {
  const lines = objOf(sliceOf(state, "orgs").log)[org];
  if (!Array.isArray(lines)) return [];
  return lines
    .map((raw): OrgLogLine => {
      const l = objOf(raw);
      const names = Array.isArray(l.names) ? l.names.map((n) => objOf(n)).map((n) => ({ id: strOf(n.id), name: strOf(n.name) })).filter((n) => n.id !== "") : [];
      const power = isOrgPower(l.power) ? { power: l.power } : {};
      return { at: numOf(l.at), text: strOf(l.text), ...(strOf(l.by) !== "" ? { by: strOf(l.by) } : {}), ...(names.length > 0 ? { names } : {}), ...power };
    })
    .reverse();
}

function str(e: PackEvent, key: string): string {
  return strOf(e.data[key]);
}

/** Where the newest line of an organization's History with the words, time (when given) and doer of `data` stands in it; -1 when there is none. */
function loggedLine(state: Readonly<WorldState>, data: JsonObject): number {
  const lines = objOf(sliceOf(state, "orgs").log)[strOf(data.org)];
  if (!Array.isArray(lines) || strOf(data.text) === "") return -1;
  return lines.findLastIndex((raw) => {
    const l = objOf(raw);
    return strOf(l.text) === strOf(data.text) && strOf(l.by) === strOf(data.by) && (typeof data.at !== "number" || l.at === data.at);
  });
}

export const ORG_EVENTS: EventTypeDef<PackEvent>[] = [
  {
    // A History line, kept with its organization: the last 40. One the history lines have no words for (the line was deleted) is made with no text, and is no line.
    type: ORGS_LOG,
    validate: (e) => (str(e, "org") !== "" ? null : { code: "bad_event", reason: say("why_a_history_line_needs_an_organization_and") }),
    apply: (e, state) => {
      if (str(e, "text") === "") return;
      const log = sliceRecord(state, "orgs", "log");
      const org = str(e, "org");
      const line: JsonObject = { at: typeof e.data.at === "number" ? e.data.at : state.clock, text: str(e, "text") };
      if (str(e, "by") !== "") line.by = str(e, "by");
      if (Array.isArray(e.data.names) && e.data.names.length > 0) line.names = e.data.names;
      if (isOrgPower(e.data.power)) line.power = e.data.power;
      const before = log[org];
      log[org] = [...(Array.isArray(before) ? before.slice(-(LOG_KEPT - 1)) : []), line];
    },
    describe: (e) => str(e, "text"),
    // The line is taken off again; where it is gone already (pushed out by newer ones) there is nothing to take back.
    reverse: (e, _before, now) => (loggedLine(now, e.data) === -1 ? [] : [{ type: ORGS_LOG_REMOVED, data: { org: str(e, "org"), text: str(e, "text"), ...(typeof e.data.at === "number" ? { at: e.data.at } : {}), ...(str(e, "by") !== "" ? { by: str(e, "by") } : {}), visibility: "secret" } }]),
  },
  {
    // A History line taken off, the newest one with these words, time and doer: the Undo of the act that made it.
    type: ORGS_LOG_REMOVED,
    validate: (e) => (str(e, "org") !== "" ? null : { code: "bad_event", reason: say("why_a_history_line_needs_an_organization_and") }),
    apply: (e, state) => {
      const at = loggedLine(state, e.data);
      const log = sliceRecord(state, "orgs", "log");
      const lines = log[str(e, "org")];
      if (at === -1 || !Array.isArray(lines)) return;
      lines.splice(at, 1);
      if (lines.length === 0) delete log[str(e, "org")];
    },
    describe: () => "",
  },
  {
    // What someone paid out of an organization's money in a calendar month, added up: the last 13 months.
    type: ORGS_SPENT,
    validate: (e) => (str(e, "org") !== "" && str(e, "who") !== "" && MONTH.test(str(e, "month")) && typeof e.data.cents === "number" && Number.isFinite(e.data.cents) ? null : { code: "bad_event", reason: say("why_spending_needs_an_organization_who_spent_a") }),
    apply: (e, state) => {
      const spent = sliceRecord(state, "orgs", "spent");
      const org = objOf(spent[str(e, "org")]);
      const months = objOf(org[str(e, "who")]);
      const month = str(e, "month");
      months[month] = numOf(months[month]) + Math.round(numOf(e.data.cents));
      for (const old of Object.keys(months).sort().slice(0, -SPENT_MONTHS_KEPT)) delete months[old];
      org[str(e, "who")] = months;
      spent[str(e, "org")] = org;
    },
    describe: (e, ctx) => say("org_spent", { who: labelOf(ctx, str(e, "who")), amount: formatMoney(Math.round(numOf(e.data.cents)), ctx.world.currency), org: labelOf(ctx, str(e, "org")) }),
    reverse: (e) => [{ type: ORGS_SPENT, data: { ...e.data, cents: -Math.round(numOf(e.data.cents)) } }],
  },
];
