// Acting for an organization (ORG-SPEC §3.6, §3.8): an action's optional `as` (a ref param with
// `acting`, the power it needs) names the organization that pays, owns and is recorded. Given, it is
// `self` in the action's requirements and outcomes, and `actor` is whoever acts for it (the resolver
// binds them so); the action asks `may(actor, as, '<power>')`, and its effect, passed `by: actor`,
// runs through `actAs`, which holds the actor to the power's limits, scope and the fiduciary rule
// (`mayAct`), names them on every posting the act makes, and records what the act paid and its
// History line (`orgs.acted`) in the act's own unit, so a rebased view keeps or drops them whole.
// Acting for oneself runs exactly as before.

import type { EntityId } from "../../../shared/ids";
import type { LedgerEvent } from "../../../shared/ledger";
import { FINANCE_EVENTS } from "../../../shared/finance";
import type { OrgPower } from "../../../shared/org";
import type { ParamDef } from "../../../shared/world";
import { formatMoney } from "../../../shared/world";
import { actsFor, mayAct, orgTypeOf } from "../../../engine/org";
import { optionalService, own } from "../../../engine/pack-kit";
import type { ReadContext, Rejection } from "../../../engine/registry";
import { reject } from "./journal";
import { holdersOf, traitsOf } from "./model";
import { namedSource } from "./pay";

/** What an `as` may name: an organization of any type (a company, a household, a group of any kind, the party, a trust). */
const ORG_KINDS = ["business", "household", "group", "trust"];

/** The `as` param of an action an actor may take for an organization, needing `power` there (§3.6). */
export function asParam(power: OrgPower, label: string): ParamDef {
  return { type: "ref", optional: true, of: { kind: ORG_KINDS }, acting: power, label };
}

/** The requirement an `as` adds: acting for nobody, or for an organization where the actor holds `power`. */
export function mayAs(power: OrgPower): string {
  return `params.as == null or may(actor, params.as, '${power}')`;
}

/** An act that may be done for an organization, and what it asks of the power it needs there. */
export interface Act {
  /** Who does it: the action's actor; empty for none (a process, the story). */
  by: EntityId;
  /** The party it acts as: an organization, or the actor themselves. */
  party: EntityId;
  power: OrgPower;
  /** Whom it pays or is done to: the fiduciary rule and a position's scope read it. */
  target?: EntityId;
  /** What it pays out of the organization's money, when known before it runs; else what its postings drew. */
  amount?: number;
  /** The account it uses, when it names one; else the one its postings drew on. */
  account?: EntityId;
  /** Its History line, naming people by name, given what it paid; and the people it names. */
  line: (paid: number | undefined) => string;
  names?: readonly (EntityId | undefined)[];
}

/** What a payment drew and from where: its biggest draw on an account in the world held by `party`. */
function drawnBy(ctx: ReadContext, events: readonly LedgerEvent[], party: EntityId): { account: EntityId; cents: number } | undefined {
  let top: { account: EntityId; cents: number } | undefined;
  for (const e of events) {
    if (e.type !== "post") continue;
    for (const l of e.lines) if (l.amount < 0 && traitsOf(ctx, l.account) !== null && holdersOf(ctx.state, l.account).includes(party) && (top === undefined || -l.amount > top.cents)) top = { account: l.account, cents: -l.amount };
  }
  return top;
}

/**
 * MoneyFix's named way, extended to what the actor may spend for (§3.6): words naming none of the
 * actor's own cards or accounts but one of an organization the actor may spend for ("from the
 * Alder Automotive operating account") make that organization the payer, from it. Null otherwise.
 */
export function namedOrgSource(ctx: ReadContext, by: EntityId, words: string): { party: EntityId; source: EntityId } | null {
  if (by === "" || words.trim() === "" || !own(ctx.state.entities, by) || namedSource(ctx, by, words) !== null) return null;
  for (const party of actsFor(ctx, by, "money.spend")) {
    const source = namedSource(ctx, party, words);
    if (source !== null) return { party, source };
  }
  return null;
}

/** The party an account or a party stands for: the account's first holder in the world, else itself. */
export function partyOf(ctx: ReadContext, id: EntityId): EntityId {
  return own(ctx.state.entities, id)?.kind === "account" ? (holdersOf(ctx.state, id).find((h) => own(ctx.state.entities, h)) ?? id) : id;
}

/**
 * Runs an act that may be done for an organization (§3.6, §3.8): `run` makes its events as `party`
 * makes them. When someone else (`by`) acts for an organization, they must hold `power` there within
 * its scope and the fiduciary rule, or the act is refused in their words; a payment out of its money
 * (`money.spend`) must keep within the limits of the position or delegation it rests on, each
 * payment and the month counted from what it drew and the accounts checked against the one it drew
 * on; each posting it makes names its actor (`by` on its journal lines); and what it paid and its
 * History line are recorded with it (`orgs.acted`). Anything else runs as it always has.
 */
export function actAs(ctx: ReadContext, act: Act, run: () => LedgerEvent[] | Rejection): LedgerEvent[] | Rejection {
  const { by, party, power } = act;
  if (by === "" || by === party || !own(ctx.state.entities, by) || orgTypeOf(ctx, party) === null) return run();
  const target = act.target !== undefined && act.target !== "" && own(ctx.state.entities, act.target) ? partyOf(ctx, act.target) : undefined;
  const ask = { ...(target !== undefined ? { target } : {}), ...(act.account !== undefined ? { account: act.account } : {}) };
  const may = mayAct(ctx, by, party, power, ask);
  if (!may.ok) return reject("not_allowed", may.reason);
  const events = run();
  if (!Array.isArray(events)) return events;
  const spends = power === "money.spend";
  const drawn = spends ? drawnBy(ctx, events, party) : undefined;
  const paid = spends ? (act.amount ?? drawn?.cents) : undefined;
  if (spends && (paid !== undefined || drawn !== undefined)) {
    const within = mayAct(ctx, by, party, power, { ...ask, ...(paid !== undefined ? { amount: paid } : {}), ...(act.account === undefined && drawn !== undefined ? { account: drawn.account } : {}) });
    if (!within.ok) return reject("not_allowed", within.reason);
  }
  const stamped = events.map((e): LedgerEvent => (e.type === FINANCE_EVENTS.txn && "data" in e ? { ...e, data: { ...e.data, by, as: party } } : e));
  const names = [...new Set((act.names ?? []).filter((id): id is EntityId => id !== undefined && id !== "" && own(ctx.state.entities, id) !== undefined))];
  const recorded = optionalService(ctx, "orgs.acted")?.(ctx, { org: party, by, power, ...(paid !== undefined ? { cents: paid } : {}), text: act.line(paid), ...(names.length > 0 ? { names } : {}) }) ?? [];
  return [...stamped, ...recorded];
}

/** An amount in the world's currency, as a History line words it. */
export function moneyWords(ctx: ReadContext, cents: number): string {
  return formatMoney(Math.round(cents), ctx.world.currency);
}
