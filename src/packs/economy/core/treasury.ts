// Treasuries (ORG-SPEC §3.8): the money a household, a group or the party holds in its own name, what
// its members pay into it and what it shares out among them. Dues (`dues {cents, every, day?}` on the
// organization) derive one flow per member who owes them, run at the payer's Money level from Money
// 3, each carrying what it couldn't pay to the next time. Share out pays an amount from the
// organization's money to its members equally: the party's to its core and companion members. A
// company or a trust pays out to its owners by their shares instead (`distribute_profit`).

import type { EntityId } from "../../../shared/ids";
import type { JsonObject, JsonValue } from "../../../shared/json";
import type { LedgerEvent } from "../../../shared/ledger";
import type { Flow, FlowSchedule } from "../../../shared/finance";
import type { ParamDef } from "../../../shared/world";
import { DUES_EVERY } from "../../../shared/org";
import { acts } from "../../../engine/life";
import { heldPositions, mayAct, membersOfOrg, orgTypeOf } from "../../../engine/org";
import { labelOf, numOf, optionalService, own, strOf } from "../../../engine/pack-kit";
import type { EffectContext, ReadContext, Rejection } from "../../../engine/registry";
import { isGone, kindIs } from "../../../engine/scope";
import { GROUP_KIND, type MembershipContext } from "../../../engine/selector";
import { ASK_PARAM } from "../../../shared/org-motions";
import { approvedWords, heldTo } from "./acting";
import { orgRecord } from "./model";
import type { FinanceApi, FinanceRegistry } from "./module";

type DuesEvery = (typeof DUES_EVERY)[number];

/** An organization's dues (§3.8): so much from each member who owes them, every week, month or year, on a day of it (a weekday, 0 Sunday; a day of the month, -1 its last; a yearly one's in January). Null when it sets none. */
export interface Dues {
  cents: number;
  every: DuesEvery;
  day: number;
}

/** An organization's dues as its `dues` field sets them; null when it sets none, or none that pay anything. */
export function duesOf(ctx: Pick<ReadContext, "state">, org: EntityId): Dues | null {
  const d = orgRecord(ctx.state, org, "dues");
  const cents = Math.round(numOf(d?.cents));
  const every = strOf(d?.every, "month");
  if (!d || cents <= 0 || !(DUES_EVERY as readonly string[]).includes(every)) return null;
  const day = typeof d.day === "number" && Number.isInteger(d.day) ? d.day : 1;
  return { cents, every: every as DuesEvery, day: every === "week" ? Math.min(6, Math.max(0, day)) : day === 0 ? 1 : Math.min(31, Math.max(-1, day)) };
}

/**
 * Who shares in an organization's money (§3.8), in id order: for the party, its core and companion
 * members, never its leader, hired hands or allies; for a household or any other group, each person
 * who is a member of it, directly or through a member group, once. Nobody for a company or a trust,
 * whose money goes to its owners by their shares. Only people who are still about to act count.
 */
export function sharersOf(ctx: MembershipContext, org: EntityId): EntityId[] {
  const type = orgTypeOf(ctx, org);
  if (type === null || type === "company" || type === "trust") return [];
  const hows: readonly string[] = type === "party" ? ["core", "companion"] : ["member"];
  const people = membersOfOrg(ctx, org).filter((r) => hows.includes(r.how) && kindIs(ctx.registry, ctx.world, own(ctx.state.entities, r.who)?.kind ?? "", "person") && !isGone(ctx.state, r.who) && acts(ctx.world, ctx.state, r.who));
  return [...new Set(people.map((r) => r.who))].sort();
}

/** When dues fall due: a weekday each week, a day each month, or a day of January each year. */
function duesSchedule(dues: Dues): FlowSchedule {
  if (dues.every === "week") return { every: "week", weekdays: [dues.day] };
  return dues.every === "month" ? { every: "month", days: [dues.day] } : { every: "year", months: [1], days: [dues.day] };
}

/**
 * The dues flows (§3.8, §3.14): for each organization with dues and an account they can land in, one
 * per member who owes them (`dues:<org>:<member>`), from the member as their preferences choose, at
 * their own Money level; whoever holds a position free of dues (`no_dues`) owes none. A payment that
 * can't be made is carried to the next.
 */
function duesFlows(ctx: ReadContext, api: FinanceApi): Flow[] {
  const out: Flow[] = [];
  for (const org of Object.keys(ctx.state.entities).sort()) {
    const dues = isGone(ctx.state, org) ? null : duesOf(ctx, org);
    const into = dues ? api.depositAccount(ctx, org) : null;
    if (!dues || into === null) continue;
    for (const who of sharersOf(ctx, org)) {
      if (heldPositions(ctx, who, org).some((h) => h.position.no_dues === true)) continue;
      out.push({ id: `dues:${org}:${who}`, label: `Dues: ${labelOf(ctx, org)}`, kind: "bill", from: who, to: into, amount: { fixed: dues.cents }, schedule: duesSchedule(dues), shortfall: "defer", category: "dues", link: org, status: "active", source: "dues" });
    }
  }
  return out;
}

/** What an act for an organization records when someone does it for one other than themselves (`orgs.acted`: its History line, and what it paid). */
function acted(ctx: ReadContext, org: EntityId, by: EntityId, act: { power: "org.govern" | "money.payout"; text: string; cents?: number; names?: EntityId[] }): LedgerEvent[] {
  if (by === "" || by === org) return [];
  return optionalService(ctx, "orgs.acted")?.(ctx, { org, by, ...act }) ?? [];
}

/** Why `by` may not use `power` for `org`, or null: an organization's own act, or one within the power's limits (`mayAct`). */
function refusal(ctx: ReadContext, by: EntityId, org: EntityId, power: "org.govern" | "money.payout", ask: { amount?: number; account?: EntityId } = {}): Rejection | null {
  if (by === "" || by === org) return null;
  const may = mayAct(ctx, by, org, power, ask);
  return may.ok ? null : { code: "not_owner", reason: may.reason };
}

/** An organization dues and shares are for: a household, any other group, or the party; a rejection otherwise. */
function treasuryOf(ctx: ReadContext, org: EntityId): Rejection | null {
  const type = own(ctx.state.entities, org) && !isGone(ctx.state, org) ? orgTypeOf(ctx, org) : null;
  if (type === null) return { code: "missing_entity", reason: `no organization ${labelOf(ctx, org)}` };
  return type === "company" || type === "trust" ? { code: "not_shared", reason: `${labelOf(ctx, org)} pays out to its owners by their shares` } : null;
}

/** `economy.dues`: an organization's dues change (`cents` 0 ends them), every week, month or year on `day`. */
function setDues(api: FinanceApi, args: Record<string, JsonValue>, ctx: EffectContext): LedgerEvent[] | Rejection {
  const org = strOf(args.org);
  const bad = treasuryOf(ctx, org);
  if (bad) return bad;
  const cents = Math.round(numOf(args.cents));
  const every = strOf(args.every, "month");
  if (cents < 0 || !(DUES_EVERY as readonly string[]).includes(every)) return { code: "bad_amount", reason: `dues are an amount every ${DUES_EVERY.join(", ")}` };
  const by = strOf(args.by);
  const no = refusal(ctx, by, org, "org.govern");
  if (no) return no;
  const value: JsonObject | null = cents > 0 ? { cents, every, ...(typeof args.day === "number" && Number.isInteger(args.day) ? { day: args.day } : {}) } : null;
  return [{ type: "set", entity: org, field: "dues", value: value ? [value] : null }, ...acted(ctx, org, by, { power: "org.govern", text: value ? `Set dues of ${api.money(ctx, cents)} a ${every}` : "Ended dues" })];
}

/**
 * `economy.share_out`: an organization pays `cents` from `from` (an account of its own it may spend),
 * else its deposit account, to the people it shares with (`sharersOf`), equally, the odd cents to the
 * first, each into their own account; all of it in one unit, or none.
 */
function shareOut(api: FinanceApi, args: Record<string, JsonValue>, ctx: EffectContext): LedgerEvent[] | Rejection {
  const org = strOf(args.org);
  const bad = treasuryOf(ctx, org);
  if (bad) return bad;
  const cents = Math.round(numOf(args.cents));
  if (!(cents > 0)) return { code: "bad_amount", reason: "a share out needs an amount" };
  const to = sharersOf(ctx, org);
  if (to.length === 0) return { code: "no_members", reason: `${labelOf(ctx, org)} has nobody to share with` };
  const from = strOf(args.from) || (api.depositAccount(ctx, org) ?? "");
  if (from === "" || !api.accountsOf(ctx, org, "spend").includes(from)) return { code: "bad_account", reason: from === "" ? `${labelOf(ctx, org)} holds no money to share out` : `${labelOf(ctx, from)} isn't ${labelOf(ctx, org)}'s to spend` };
  const by = strOf(args.by);
  // Over its limit, put up for approval when the action asks; under an approval, past it (ORG-SPEC Phase 5).
  if (by !== "" && by !== org) {
    const held = heldTo(ctx, { by, party: org, power: "money.payout", text: `Shared out ${api.money(ctx, cents)}`, cents, account: from }, mayAct(ctx, by, org, "money.payout", { amount: cents, account: from }), "not_owner");
    if (held) return held;
  }
  if (api.available(ctx, from) < cents) return { code: "declined", reason: `${labelOf(ctx, from)} doesn't have ${api.money(ctx, cents)}` };
  const each = Math.floor(cents / to.length);
  const out: LedgerEvent[] = [];
  for (const [i, who] of to.entries()) {
    const share = i === 0 ? cents - each * (to.length - 1) : each;
    if (share <= 0) continue;
    const paid = api.pay(ctx, { from, to: who, cents: share, memo: `Share out from ${labelOf(ctx, org)}`, kind: "transfer", category: "share_out" });
    if (!Array.isArray(paid)) return paid;
    out.push(...paid);
  }
  return [...out, ...acted(ctx, org, by, { power: "money.payout", text: `Shared out ${api.money(ctx, cents)}${approvedWords(ctx, org)}`, cents, names: to })];
}

/** Treasuries: dues flows, and setting dues and sharing out, for households, groups and the party. */
export function registerTreasury(r: FinanceRegistry): void {
  const { api, core } = r;
  r.flows({ id: "dues", flows: (ctx) => duesFlows(ctx, api) });
  core.effect({ type: "economy.dues", args: ["org", "cents", "every?", "day?", "by?"], resolve: (args, ctx) => setDues(api, args, ctx) });
  core.effect({ type: "economy.share_out", args: ["org", "cents", "from?", "by?"], resolve: (args, ctx) => shareOut(api, args, ctx) });
  const org: ParamDef = { type: "ref", of: { kind: [GROUP_KIND] }, label: "Organization" };
  core.action({ id: "org_dues", label: "Set dues", description: "Set what each member pays into an organization's money, and how often; nothing ends them.", pack: "economy", params: { org, amount: { type: "money", label: "Each member pays" }, every: { type: "text", optional: true, label: "week, month or year" }, day: { type: "number", optional: true, label: "On the day (a weekday, 0 = Sunday; a day of the month, -1 the last)" } }, requires: ["may(self, org, 'org.govern')", "amount >= 0", "level.money >= 3"], outcomes: { default: [{ type: "economy.dues", args: { org: "org", cents: "=amount", every: "=params.every", day: "=params.day", by: "self" } }] }, duration: "2", observable: "does the paperwork", mechanical: true, lexicon: ["set dues", "membership fee", "everyone chips in"] });
  core.action({ id: "org_share_out", label: "Share out", description: "Pay an amount from an organization's money to its members equally (the party's: its core members and companions).", pack: "economy", params: { org, amount: { type: "money" }, from: { type: "ref", ref: "account", optional: true, label: "From its account" }, ask: ASK_PARAM }, requires: ["may(self, org, 'money.payout')", "amount > 0", "level.money >= 2"], outcomes: { default: [{ type: "economy.share_out", args: { org: "org", cents: "=amount", from: "=params.from", by: "self" } }] }, duration: "5", observable: "shares out money", lexicon: ["share out", "split the money", "divide the purse", "hand out"] });
}
