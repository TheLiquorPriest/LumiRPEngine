// The Plan's follow-through off screen (assess-party §6.2 "How minds and routines follow it", §6.3
// phase 3; ORG-SPEC §3.14): what the world does with the orders on the player character's party plan
// while no one is looking. From Cast life 3 the day planner lays each party member's orders into their
// days at their tier's priority, whatever their agent flag or minds level (`orgs.order_plans`, read by
// castlife's commitments); their routine gives way to a timed order under way (`orgs.on_order`); an
// order bound to a place keeps them from following the player character elsewhere, and one with the
// player character on its team brings a hired hand along (`orgs.order_hold`, read by the move path);
// a slot's end marks an order whose laid blocks have all ended (`orgs.orders`, the `lived` marker,
// which closes nothing); the Montage says who worked on what (`orgs.worked`); and orders pending with
// the player character make those they're asked of involved, and first in catch-up after the scene
// (`orgs.open_orders`). Everything here reads the state alone, never the clock but where a caller
// hands it one, so a timelapse lays and marks the same however it is cut. Below Cast life 3 orders
// steer only the narrator and the minds.

import type { EntityId, PlaceId } from "../../../shared/ids";
import type { LedgerEvent } from "../../../shared/ledger";
import { isPlanStatusLive, ORDER_PRIORITY, type OrderPlan, type PlanGoal, type PlanOrder } from "../../../shared/org-feed";
import { partyTierIn } from "../../../shared/party";
import { listWords } from "../../../shared/words";
import { calendarOf, clockAt, dateAt, dayIndexOfText, MINUTES_PER_DAY } from "../../../engine/calendar";
import { numOf, objOf, optionalQuery, own, sliceOf } from "../../../engine/pack-kit";
import type { CoreRegistry, ProcessDef, ReadContext, SlotInfo } from "../../../engine/registry";
import { ORGS_LIVED, peopleIn, planned, planOf, refFor } from "./agenda";
import { orgsSetting } from "./seats";
import { partyIdOf } from "./view";

declare module "../../../engine/registry" {
  interface QueryMap {
    /**
     * The orders on the player character's party plan asked of a party member, as the day planner lays
     * them for that member (`OrderPlan`): every one but those closed and gone from the plan's tail, a
     * closed one laying only before it closed. None for the player character or anyone outside the party.
     */
    "orgs.order_plans": (ctx: ReadContext, who: EntityId) => OrderPlan[];
    /** Whether a party member is on a timed order under way at `at`, before its time: their routine gives way to it, as to the GM's intent. */
    "orgs.on_order": (ctx: ReadContext, who: EntityId, at: number) => boolean;
    /**
     * What a party member's orders say of the player character's move now to `to` (any move, with
     * none): `come` when one still on the plan has the player character on its team ("with me"); `stay`
     * when one is bound to another place while its window holds; else null.
     */
    "orgs.order_hold": (ctx: ReadContext, who: EntityId, to: PlaceId | undefined) => "stay" | "come" | null;
    /** How many orders still on the plans the player character is on are asked of someone: each pending with the player character. */
    "orgs.open_orders": (ctx: ReadContext, who: EntityId) => number;
    /** Who worked on which order of the party's in [from, to), by the blocks the day planner laid: the Montage's lines ("Danny Okafor worked on: Sweep the bays"). */
    "orgs.worked": (ctx: ReadContext, from: number, to: number) => string[];
  }
}

/** How far past a slot's end its marking has the planner lay an order unless the world's orgs config says (`plan_days`, 1 to 62). */
export const PLAN_DAYS = 14;

/** The plan id an order's blocks are laid under. */
export function orderPlanId(org: EntityId, id: string): string {
  return `order:${org}:${id}`;
}

/** Where a goal's window ends: the end of the day it was set for "today", of its date for a date; null for none. */
function goalEnd(ctx: ReadContext, goal: PlanGoal | undefined): number | null {
  const cal = calendarOf(ctx.world);
  if (goal?.window === "today") return clockAt(cal, dateAt(cal, goal.at).dayIndex + 1, 0);
  if (goal?.window !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(goal.window)) return clockAt(cal, dayIndexOfText(cal, goal.window) + 1, 0);
  return null;
}

/**
 * Where the planner lays an order (assess-party §6.2, `OrderPlan`): a timed one from the minute after
 * it was given to its time; a standing one under way from when it went under way to the end of its
 * goal's window, or until it is done or dropped (`hold`); an open standing one with a place to the end
 * of its goal's window, else for a day. A blocked one, an open standing one with no place, and a
 * closed standing one with no place lay nothing.
 */
function windowOf(ctx: ReadContext, o: PlanOrder, place: string | null, goals: readonly PlanGoal[]): { window: OrderPlan["window"]; hold: boolean } {
  const none = { window: null, hold: false };
  if (o.status === "blocked") return none;
  const start = o.at + 1;
  if (o.when !== undefined) return o.when > start ? { window: { from: start, to: o.when }, hold: false } : none;
  const end = goalEnd(ctx, goals.find((g) => g.id === o.goal));
  if (o.status === "under_way") {
    const from = Math.max(start, o.last?.at ?? start);
    return end === null || end > from ? { window: { from, to: end }, hold: true } : none;
  }
  if (place === null) return none;
  const to = end ?? start + MINUTES_PER_DAY;
  return to > start ? { window: { from: start, to }, hold: false } : none;
}

/** The orders on the player character's party plan asked of `who`, as the day planner lays them (`orgs.order_plans`). */
export function orderPlans(ctx: ReadContext, who: EntityId): OrderPlan[] {
  const pov = ctx.world.pov;
  if (who === pov) return [];
  const tier = partyTierIn(own(ctx.state.entities, who)?.relations, pov);
  // Most chats hold no plan: the day planner asks this of every party member at every turn.
  if (tier === null || Object.keys(objOf(sliceOf(ctx.state, "orgs").plan)).length === 0) return [];
  const org = partyIdOf(ctx).id;
  const { goals, orders } = planOf(ctx.state, org);
  return orders
    .filter((o) => o.to.includes(who))
    .map((o) => {
      const place = o.where !== undefined && own(ctx.world.places, o.where) ? o.where : null;
      const { window, hold } = windowOf(ctx, o, place, goals);
      return { plan: orderPlanId(org, o.id), org, id: o.id, text: o.text, by: o.by ?? null, to: o.to, place, when: o.when ?? null, status: o.status, priority: ORDER_PRIORITY[tier], made: o.at, window, hold, closed: isPlanStatusLive(o.status) ? null : (o.last?.at ?? o.at) };
    });
}

/** Whether `at` falls in an order's window. */
function within(o: OrderPlan, at: number): boolean {
  return o.window !== null && o.window.from <= at && (o.window.to === null || at < o.window.to);
}

/** `orgs.on_order`: a timed order under way, before its time (a standing one holds through its own laid days instead). */
export function onOrder(ctx: ReadContext, who: EntityId, at: number): boolean {
  return orderPlans(ctx, who).some((o) => o.status === "under_way" && !o.hold && within(o, at));
}

/** `orgs.order_hold`: a team with the player character on it brings them along; an order bound to another place while it runs keeps them back. A blocked order waits on someone, so it does neither. */
export function orderHold(ctx: ReadContext, who: EntityId, to: PlaceId | undefined): "stay" | "come" | null {
  const live = orderPlans(ctx, who).filter((o) => o.status === "open" || o.status === "under_way");
  if (live.some((o) => o.to.includes(ctx.world.pov))) return "come";
  const now = ctx.state.clock;
  return live.some((o) => o.place !== null && o.place !== to && within(o, now)) ? "stay" : null;
}

/** `orgs.open_orders`: orders still on the plans the player character is on, asked of `who` (their lead included). */
export function openOrders(ctx: ReadContext, who: EntityId): number {
  const pov = ctx.world.pov;
  let n = 0;
  for (const org of Object.keys(objOf(sliceOf(ctx.state, "orgs").plan)).sort()) {
    if (!planned(ctx, org) || !peopleIn(ctx, org).includes(pov)) continue;
    n += planOf(ctx.state, org).orders.filter((o) => isPlanStatusLive(o.status) && (o.to.includes(who) || o.lead === who)).length;
  }
  return n;
}

/** `orgs.worked`: each order of the party's someone had a block laid for in [from, to), with whom, as the player character may name them. */
export function ordersWorked(ctx: ReadContext, from: number, to: number): string[] {
  const commitments = optionalQuery(ctx, "castlife.commitments");
  if (!commitments || to <= from) return [];
  const pov = ctx.world.pov;
  const org = partyIdOf(ctx).id;
  const { orders } = planOf(ctx.state, org);
  // The order plans each person had laid in the span, read once each.
  const laid = new Map<EntityId, Set<string>>();
  for (const who of new Set(orders.flatMap((o) => o.to))) {
    const reaching = orderPlans(ctx, who).some((x) => x.window !== null && x.window.from < to && (x.window.to === null || x.window.to > from));
    if (reaching) laid.set(who, new Set(commitments(ctx, who, from, to).flatMap((b) => (b.plan !== undefined ? [b.plan] : []))));
  }
  return orders.flatMap((o) => {
    const who = o.to.filter((p) => laid.get(p)?.has(orderPlanId(org, o.id)) === true);
    return who.length > 0 ? [`${listWords(who.map((p) => refFor(ctx, pov, p).name))} worked on: ${o.text}`] : [];
  });
}

/**
 * The `lived` markers a slot's end sets (`orgs.lived`): an order still on the party's plan, unmarked,
 * whose laid blocks have all ended by then, at the last one's end (a standing order under way: at its
 * window's end, and never for one held until it is done or dropped). Nothing for one nothing was laid
 * for. Each says its own time, so a late step marks it alike. The planner lays a window only as far as
 * `plan_days` past the slot: one reaching years ahead would have every day of it laid again each slot.
 */
export function stepOrders(slot: SlotInfo, ctx: ReadContext): LedgerEvent[] {
  const commitments = optionalQuery(ctx, "castlife.commitments");
  if (!commitments || Object.keys(objOf(sliceOf(ctx.state, "orgs").plan)).length === 0) return [];
  const org = partyIdOf(ctx).id;
  const ahead = slot.end + Math.max(1, Math.min(62, Math.round(numOf(orgsSetting(ctx, "plan_days"), PLAN_DAYS)))) * MINUTES_PER_DAY;
  const out: LedgerEvent[] = [];
  for (const o of planOf(ctx.state, org).orders) {
    if (!isPlanStatusLive(o.status) || o.lived !== undefined) continue;
    const ends: number[] = [];
    let open = false;
    for (const who of o.to) {
      const p = orderPlans(ctx, who).find((x) => x.id === o.id);
      if (!p?.window || p.window.from > slot.end) continue;
      if (p.window.to === null) {
        open = true;
        continue;
      }
      const laid = commitments(ctx, who, p.window.from, Math.min(p.window.to, ahead)).filter((b) => b.plan === p.plan);
      if (laid.length > 0) ends.push(p.hold ? p.window.to : Math.max(...laid.map((b) => b.end)));
    }
    const at = Math.max(...ends);
    if (!open && ends.length > 0 && at <= slot.end) out.push({ type: ORGS_LIVED, data: { org, id: o.id, at, visibility: "secret" } });
  }
  return out;
}

/** The `lived` markers, each slot, at every level (the planner lays orders from Cast life 3 only, so below it there is nothing to mark). */
export const ORDERS_PROCESS: ProcessDef = { id: "orgs.orders", domain: "relationships", minLevel: 0, step: (slot, ctx) => stepOrders(slot, ctx) };

/** The follow-through's queries and process. */
export function registerFollow(r: CoreRegistry): void {
  r.query("orgs.order_plans", orderPlans);
  r.query("orgs.on_order", onOrder);
  r.query("orgs.order_hold", orderHold);
  r.query("orgs.open_orders", openOrders);
  r.query("orgs.worked", ordersWorked);
  r.process(ORDERS_PROCESS);
}
