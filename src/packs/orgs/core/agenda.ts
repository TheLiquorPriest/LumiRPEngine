// The Plan (assess-party §6.2, generalized to every organization; ORG-SPEC §3.14, §4.4): an
// organization's goals and the orders given for it, each kept once in the `packs.orgs` slice (`plan`)
// with its status and where it came from, never copied to the people it names. Whoever holds
// `orders.give` there (the party's leader, before the party has an entity of its own) sets and
// changes them, at once with Undo; anyone an order is asked of moves their own along. The clock never
// closes an item: one whose time has passed reads late until someone closes it. The page reads it as
// the Plan tab (`orgs.plan`), the narrator in the Quest section (source `plan`), and minds as what was
// asked of them. The story reaches it through `orgs.plan_read` (the player's own message) and the
// reply's status-only `agenda` channel. Defaults (ORG-SPEC §12 item 5): orders apply at once; the
// narrator shows only what messages and time cover; core members treat orders as binding and may
// object in words; companions weigh them; the hired take them as their job; allies as favours.

import { hashParts } from "../../../shared/hash";
import type { EntityId } from "../../../shared/ids";
import type { JsonObject, JsonValue } from "../../../shared/json";
import type { LedgerEvent, PackEvent } from "../../../shared/ledger";
import { isPlanStatus, isPlanStatusLive, PLAN_ACTIONS, PLAN_EFFECTS, PLAN_SECTION, PLAN_SOURCES, PLAN_STATUS_WORDS, PLAN_TEXT_MAX, type OrgPlanView, type PlanGoal, type PlanGoalView, type PlanNote, type PlanOrder, type PlanOrderView, type PlanSource, type PlanStatus } from "../../../shared/org-feed";
import type { OrgRef } from "../../../shared/org-view";
import { partyTierIn, type PartyTier } from "../../../shared/party";
import type { ActionDef, ParamDef } from "../../../shared/world";
import { calendarOf, clockOfLocal, dateAt, dayIndexOfText, formatClock, formatStamp } from "../../../engine/calendar";
import { acts } from "../../../engine/life";
import { mayAct, orgTypeOf, partyLeader } from "../../../engine/org";
import { labelOf, objOf, own, sliceOf, sliceRecord, strOf } from "../../../engine/pack-kit";
import type { CoreRegistry, EffectContext, EventTypeDef, ProposalChannelDef, ReadContext, Rejection } from "../../../engine/registry";
import { isGone, kindIs } from "../../../engine/scope";
import { canSeeEntity } from "../../../engine/visibility";
import { partyIdOf, powersAt, rowsAt } from "./view";

declare module "../../../engine/registry" {
  interface ServiceMap {
    /**
     * The plan the player's own message gives (interpret's `agenda` part): its goals and orders as
     * events for the organization they are for (the party unless named), each one's `said` checked
     * against the message, names resolved to the people the player character may know. A refusal
     * says why in words.
     */
    "orgs.plan_read": (ctx: ReadContext, items: PlanReadItems, said: string) => { events: LedgerEvent[]; org: EntityId; goals: number; orders: number } | Rejection;
  }
}

/** What interpret reads of a plan from the player's message. */
export interface PlanReadItems {
  goals?: { text: string; said: string; window?: string; where?: string; org?: string }[];
  orders?: { to: string[]; lead?: string; text: string; said: string; where?: string; when?: string; org?: string }[];
}

export const ORGS_GOAL = "orgs.goal";
export const ORGS_ORDER = "orgs.order";
export const ORGS_STATUS = "orgs.status";
export const ORGS_LIVED = "orgs.lived";

/** The most a plan holds open (assess-party §6.2), the longest words an item keeps, and how many closed ones it keeps after. */
export const PLAN_LIMITS = { goals: 12, orders: 40, text: PLAN_TEXT_MAX, closedGoals: 12, closedOrders: 40 } as const;

/** The closed goals and orders the page lists, newest first, for Reopen. */
export const PLAN_RECENT = 10;

/** The statuses an order's own people may move it to; the rest are for whoever gives orders. */
const OWN_MOVES: readonly PlanStatus[] = ["under_way", "done", "blocked", "refused"];

// ---------------------------------------------------------------- the records

/** An organization's plan as the slice holds it: goals and orders, open and closed, oldest first. */
export function planOf(state: ReadContext["state"], org: EntityId): { goals: PlanGoal[]; orders: PlanOrder[] } {
  const raw = objOf(objOf(sliceOf(state, "orgs").plan)[org]);
  const list = (v: JsonValue | undefined): JsonObject[] => (Array.isArray(v) ? v.map((x) => objOf(x)) : []);
  return { goals: list(raw.goals).flatMap((g) => goalIn(g) ?? []), orders: list(raw.orders).flatMap((o) => orderIn(o) ?? []) };
}

function noteIn(v: JsonValue | undefined): PlanNote | undefined {
  const n = objOf(v);
  const source = strOf(n.source);
  if (typeof n.at !== "number" || !(PLAN_SOURCES as readonly string[]).includes(source)) return undefined;
  return { note: strOf(n.note), at: n.at, source: source as PlanSource, ...(strOf(n.said) !== "" ? { said: strOf(n.said) } : {}) };
}

function common(o: JsonObject): { id: string; text: string; status: PlanStatus; source: PlanSource; at: number; by?: EntityId; last?: PlanNote } | null {
  const id = strOf(o.id);
  const text = strOf(o.text).trim();
  const source = strOf(o.source);
  if (id === "" || text === "" || text.length > PLAN_LIMITS.text || !isPlanStatus(o.status) || !(PLAN_SOURCES as readonly string[]).includes(source) || typeof o.at !== "number") return null;
  const last = noteIn(o.last);
  return { id, text, status: o.status, source: source as PlanSource, at: o.at, ...(strOf(o.by) !== "" ? { by: strOf(o.by) } : {}), ...(last ? { last } : {}) };
}

function goalIn(o: JsonObject): PlanGoal | null {
  const base = common(o);
  if (!base) return null;
  return { ...base, ...(strOf(o.window) !== "" ? { window: strOf(o.window) } : {}), ...(strOf(o.where) !== "" ? { where: strOf(o.where) } : {}) };
}

function orderIn(o: JsonObject): PlanOrder | null {
  const base = common(o);
  const to = Array.isArray(o.to) ? [...new Set(o.to.filter((x): x is string => typeof x === "string" && x !== ""))] : [];
  if (!base || to.length === 0) return null;
  return { ...base, to, ...(strOf(o.goal) !== "" ? { goal: strOf(o.goal) } : {}), ...(strOf(o.lead) !== "" ? { lead: strOf(o.lead) } : {}), ...(strOf(o.where) !== "" ? { where: strOf(o.where) } : {}), ...(typeof o.when === "number" ? { when: o.when } : {}), ...(typeof o.lived === "number" ? { lived: o.lived } : {}) };
}

/** A list with `item` put in its place (or added), its closed items cut to the last `closedKept`. */
function upsert<T extends { id: string; status: PlanStatus }>(list: readonly T[], item: T, closedKept: number): T[] {
  const next = list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item];
  const closed = next.filter((x) => !isPlanStatusLive(x.status));
  const drop = new Set(closed.slice(0, Math.max(0, closed.length - closedKept)).map((x) => x.id));
  return next.filter((x) => !drop.has(x.id));
}

function writePlan(state: Parameters<EventTypeDef<PackEvent>["apply"]>[1], org: EntityId, plan: { goals: PlanGoal[]; orders: PlanOrder[] }): void {
  const all = sliceRecord(state, "orgs", "plan");
  all[org] = { goals: plan.goals as unknown as JsonValue, orders: plan.orders as unknown as JsonValue };
}

export const PLAN_EVENTS: EventTypeDef<PackEvent>[] = [
  {
    // A goal set or changed, whole: the plan keeps its last 12 closed goals.
    type: ORGS_GOAL,
    validate: (e, ctx) => {
      const goal = goalIn(objOf(e.data.goal));
      if (strOf(e.data.org) === "" || !goal) return { code: "bad_event", reason: "a goal needs an organization, an id, its words (at most 300 characters), a status and where it came from" };
      const plan = planOf(ctx.state, strOf(e.data.org));
      const fresh = !plan.goals.some((g) => g.id === goal.id);
      return fresh && isPlanStatusLive(goal.status) && plan.goals.filter((g) => isPlanStatusLive(g.status)).length >= PLAN_LIMITS.goals ? { code: "plan_full", reason: `a plan holds at most ${PLAN_LIMITS.goals} open goals` } : null;
    },
    apply: (e, state) => {
      const org = strOf(e.data.org);
      const goal = goalIn(objOf(e.data.goal));
      if (!goal) return;
      const plan = planOf(state, org);
      writePlan(state, org, { goals: upsert(plan.goals, goal, PLAN_LIMITS.closedGoals), orders: plan.orders });
    },
    describe: (e) => `Plan: ${strOf(objOf(e.data.goal).text)}`,
  },
  {
    // An order given or changed, whole: the plan keeps its last 40 closed orders.
    type: ORGS_ORDER,
    validate: (e, ctx) => {
      const order = orderIn(objOf(e.data.order));
      if (strOf(e.data.org) === "" || !order) return { code: "bad_event", reason: "an order needs an organization, an id, whom it is for, its words (at most 300 characters), a status and where it came from" };
      const plan = planOf(ctx.state, strOf(e.data.org));
      const fresh = !plan.orders.some((o) => o.id === order.id);
      return fresh && isPlanStatusLive(order.status) && plan.orders.filter((o) => isPlanStatusLive(o.status)).length >= PLAN_LIMITS.orders ? { code: "plan_full", reason: `a plan holds at most ${PLAN_LIMITS.orders} open orders` } : null;
    },
    apply: (e, state) => {
      const org = strOf(e.data.org);
      const order = orderIn(objOf(e.data.order));
      if (!order) return;
      const plan = planOf(state, org);
      writePlan(state, org, { goals: plan.goals, orders: upsert(plan.orders, order, PLAN_LIMITS.closedOrders) });
    },
    describe: (e) => `Order: ${strOf(objOf(e.data.order).text)}`,
  },
  {
    // A goal or an order moved along: its status and the latest word on it.
    type: ORGS_STATUS,
    validate: (e, ctx) => {
      const plan = planOf(ctx.state, strOf(e.data.org));
      const id = strOf(e.data.id);
      if (!isPlanStatus(e.data.status) || !(PLAN_SOURCES as readonly string[]).includes(strOf(e.data.source))) return { code: "bad_event", reason: "a status change needs a status and where it came from" };
      return plan.goals.some((g) => g.id === id) || plan.orders.some((o) => o.id === id) ? null : { code: "not_found", reason: `nothing on the plan is ${id}` };
    },
    apply: (e, state) => {
      const org = strOf(e.data.org);
      const id = strOf(e.data.id);
      const status = e.data.status;
      if (!isPlanStatus(status)) return;
      const last: PlanNote = { note: strOf(e.data.note), at: typeof e.data.at === "number" ? e.data.at : state.clock, source: strOf(e.data.source) as PlanSource, ...(strOf(e.data.said) !== "" ? { said: strOf(e.data.said) } : {}) };
      const plan = planOf(state, org);
      const move = <T extends PlanGoal | PlanOrder>(x: T): T => (x.id === id ? { ...x, status, last } : x);
      // A standing order going under way is laid anew from then (`orgs.order_plans`): what the day as laid said of it before no longer holds.
      const order = (o: PlanOrder): PlanOrder => {
        const moved = move(o);
        if (o.id !== id || status !== "under_way" || o.when !== undefined || moved.lived === undefined) return moved;
        const { lived: _, ...rest } = moved;
        return rest;
      };
      writePlan(state, org, { goals: plan.goals.map(move), orders: plan.orders.map(order) });
    },
    describe: (e) => `Plan: ${strOf(e.data.id)} ${PLAN_STATUS_WORDS[isPlanStatus(e.data.status) ? e.data.status : "open"].toLowerCase()}`,
  },
  {
    // The day planner's marker (`orgs.orders`): every block it laid for an order has ended, at `at`. It closes nothing.
    type: ORGS_LIVED,
    validate: (e, ctx) => (typeof e.data.at === "number" && planOf(ctx.state, strOf(e.data.org)).orders.some((o) => o.id === strOf(e.data.id)) ? null : { code: "not_found", reason: `no order on the plan is ${strOf(e.data.id)}` }),
    apply: (e, state) => {
      const org = strOf(e.data.org);
      const id = strOf(e.data.id);
      const at = e.data.at;
      if (typeof at !== "number") return;
      const plan = planOf(state, org);
      writePlan(state, org, { goals: plan.goals, orders: plan.orders.map((o) => (o.id === id ? { ...o, lived: at } : o)) });
    },
    describe: (e) => `Plan: ${strOf(e.data.id)} should be done by the day as laid`,
  },
];

// ---------------------------------------------------------------- who may

/** Whether `org` may hold a plan: any organization but a trust, and the player character's party before it has an entity. */
export function planned(ctx: ReadContext, org: EntityId): boolean {
  const type = orgTypeOf(ctx, org);
  if (type !== null) return type !== "trust" && !isGone(ctx.state, org);
  const party = partyIdOf(ctx);
  return !party.exists && org === party.id;
}

/** Whether `who` may give orders for `org` (`orders.give`); the party before its entity is its leader's. */
export function mayGive(ctx: ReadContext, who: EntityId, org: EntityId): boolean {
  if (orgTypeOf(ctx, org) === null) return planned(ctx, org) && who === ctx.world.pov;
  return mayAct(ctx, who, org, "orders.give").ok;
}

/** Why someone may not change the plan, or null when they may: the GM (no `by`) always may. */
function refusal(ctx: ReadContext, by: string, org: EntityId): Rejection | null {
  if (!planned(ctx, org)) return { code: "bad_org", reason: "only an organization (not a trust) has a plan" };
  if (by === "" || mayGive(ctx, by, org)) return null;
  const may = orgTypeOf(ctx, org) === null ? null : mayAct(ctx, by, org, "orders.give");
  return { code: "not_allowed", reason: may && !may.ok ? may.reason : `${labelOf(ctx, by)} may not give orders for ${labelOf(ctx, org)}` };
}

// ---------------------------------------------------------------- the effects

type Args = Record<string, JsonValue>;

function sourceOf(a: Args): PlanSource {
  const s = strOf(a.source);
  return (PLAN_SOURCES as readonly string[]).includes(s) ? (s as PlanSource) : strOf(a.by) === "" ? "gm" : "play";
}

/** A list of ids as an arg gives it: a list, or words separated by commas. */
function idsOf(v: JsonValue | undefined): string[] {
  const raw = Array.isArray(v) ? v.map((x) => strOf(x)) : strOf(v).split(",");
  return [...new Set(raw.map((x) => x.trim()).filter((x) => x !== ""))];
}

/** A time as an arg gives it: a clock reading, or `YYYY-MM-DD[ HH:MM]` in the world's calendar; null for none, a Rejection for words it can't read. */
function whenOf(ctx: ReadContext, v: JsonValue | undefined): number | null | Rejection {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const text = strOf(v).trim();
  if (text === "") return null;
  try {
    return clockOfLocal(calendarOf(ctx.world), text.replace(" ", "T"));
  } catch {
    return { code: "bad_args", reason: `"${text}" isn't a date and time (YYYY-MM-DD HH:MM)` };
  }
}

/** A goal's window as an arg gives it: "today" or a date (`YYYY-MM-DD`). */
function windowOf(v: JsonValue | undefined): string | null | Rejection {
  const text = strOf(v).trim();
  if (text === "") return null;
  return text === "today" || /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : { code: "bad_args", reason: `a goal's window is "today" or a date (YYYY-MM-DD), not "${text}"` };
}

function words(text: string): string | Rejection {
  const t = text.trim();
  if (t === "") return { code: "bad_args", reason: "what it is, in words" };
  return t.length > PLAN_LIMITS.text ? { code: "bad_args", reason: `at most ${PLAN_LIMITS.text} characters` } : t;
}

function isRejection(v: unknown): v is Rejection {
  return typeof v === "object" && v !== null && "code" in v && "reason" in v;
}

/** A fresh item id: `g_…` for a goal, `o_…` for an order, from what it is and when. */
function newId(ctx: ReadContext, prefix: "g" | "o", org: EntityId, text: string, n: number): string {
  return `${prefix}_${hashParts(org, text, String(ctx.state.clock), String(n)).slice(0, 8)}`;
}

/** Whether a change leaves an item's `key` as it was: the arg isn't given (absent, or null, as an action's param left out reads); "" clears it. */
function keeps(a: Args, key: string): boolean {
  return a[key] === undefined || a[key] === null;
}

/** `orgs.plan_goal`: a goal set (no `id`) or changed. */
export function goalEvents(ctx: ReadContext, a: Args): LedgerEvent[] | Rejection {
  const org = strOf(a.org);
  const by = strOf(a.by);
  const refused = refusal(ctx, by, org);
  if (refused) return refused;
  const plan = planOf(ctx.state, org);
  const id = strOf(a.id);
  const was = id === "" ? undefined : plan.goals.find((g) => g.id === id);
  if (id !== "" && !was) return { code: "not_found", reason: `nothing on the plan is ${id}` };
  const text = keeps(a, "text") && was ? was.text : words(strOf(a.text));
  if (isRejection(text)) return text;
  const window = keeps(a, "window") && was ? (was.window ?? null) : windowOf(a.window);
  if (isRejection(window)) return window;
  const where = keeps(a, "where") && was ? (was.where ?? "") : strOf(a.where).trim();
  const status = isPlanStatus(a.status) ? a.status : (was?.status ?? "open");
  const goal: PlanGoal = { id: was?.id ?? newId(ctx, "g", org, text, plan.goals.length), text, ...(window !== null ? { window } : {}), ...(where !== "" ? { where } : {}), status, ...(was?.by ?? by ? { by: was?.by ?? by } : {}), source: was?.source ?? sourceOf(a), at: was?.at ?? ctx.state.clock, ...(was?.last ? { last: was.last } : {}) };
  return [{ type: ORGS_GOAL, data: { org, goal: goal as unknown as JsonValue, visibility: "secret" } }];
}

/** `orgs.plan_order`: an order given (no `id`) or changed: whom it is for, who leads, the task, where and when, the goal it serves; one given from the story keeps the words it quotes (`said`). */
export function orderEvents(ctx: ReadContext, a: Args): LedgerEvent[] | Rejection {
  const org = strOf(a.org);
  const by = strOf(a.by);
  const refused = refusal(ctx, by, org);
  if (refused) return refused;
  const plan = planOf(ctx.state, org);
  const id = strOf(a.id);
  const was = id === "" ? undefined : plan.orders.find((o) => o.id === id);
  if (id !== "" && !was) return { code: "not_found", reason: `nothing on the plan is ${id}` };
  const text = keeps(a, "text") && was ? was.text : words(strOf(a.text));
  if (isRejection(text)) return text;
  const to = keeps(a, "to") && was ? was.to : idsOf(a.to);
  if (to.length === 0) return { code: "bad_args", reason: "whom the order is for" };
  const unknown = to.find((who) => !own(ctx.state.entities, who) || !kindIs(ctx.registry, ctx.world, own(ctx.state.entities, who)?.kind ?? "", "person"));
  if (unknown !== undefined) return { code: "bad_args", reason: `${unknown} is no one in the world` };
  const lead = keeps(a, "lead") && was ? (was.lead ?? "") : strOf(a.lead).trim();
  if (lead !== "" && !to.includes(lead)) return { code: "bad_args", reason: "who leads must be one of those it is for" };
  const goal = keeps(a, "goal") && was ? (was.goal ?? "") : strOf(a.goal).trim();
  if (goal !== "" && !plan.goals.some((g) => g.id === goal)) return { code: "not_found", reason: `no goal on the plan is ${goal}` };
  const when = keeps(a, "when") && was ? (was.when ?? null) : whenOf(ctx, a.when);
  if (isRejection(when)) return when;
  const where = keeps(a, "where") && was ? (was.where ?? "") : strOf(a.where).trim();
  const status = isPlanStatus(a.status) ? a.status : (was?.status ?? "open");
  // The planner's marker holds while what it laid the order from does: a change of its time, place or people clears it, as does a standing order going under way.
  const relaid = !was || (was.when ?? null) !== when || (was.where ?? "") !== where || [...was.to].sort().join(",") !== [...to].sort().join(",") || (when === null && status === "under_way" && was.status !== "under_way");
  const order: PlanOrder = {
    id: was?.id ?? newId(ctx, "o", org, `${to.join(",")}:${text}`, plan.orders.length),
    ...(goal !== "" ? { goal } : {}),
    to,
    ...(lead !== "" ? { lead } : {}),
    text,
    ...(where !== "" ? { where } : {}),
    ...(when !== null ? { when } : {}),
    status,
    ...(was?.by ?? by ? { by: was?.by ?? by } : {}),
    source: was?.source ?? sourceOf(a),
    at: was?.at ?? ctx.state.clock,
    ...(was?.last ? { last: was.last } : strOf(a.said).trim() !== "" ? { last: { note: "Offered in the story", at: ctx.state.clock, source: sourceOf(a), said: strOf(a.said).trim().slice(0, PLAN_LIMITS.text) } } : {}),
    ...(was?.lived !== undefined && !relaid ? { lived: was.lived } : {}),
  };
  return [{ type: ORGS_ORDER, data: { org, order: order as unknown as JsonValue, visibility: "secret" } }];
}

/** `orgs.plan_status`: a goal or an order moved along, with a note; one asked of `by` they may move along themselves. */
export function statusEvents(ctx: ReadContext, a: Args): LedgerEvent[] | Rejection {
  const org = strOf(a.org);
  const by = strOf(a.by);
  const id = strOf(a.id);
  const status = a.status;
  if (!isPlanStatus(status)) return { code: "bad_args", reason: `a status is one of ${Object.keys(PLAN_STATUS_WORDS).join(", ")}` };
  const plan = planOf(ctx.state, org);
  const order = plan.orders.find((o) => o.id === id);
  const item = order ?? plan.goals.find((g) => g.id === id);
  if (!item) return { code: "not_found", reason: `nothing on the plan is ${id}` };
  const own = order !== undefined && by !== "" && (order.to.includes(by) || order.lead === by) && OWN_MOVES.includes(status);
  if (!own) {
    const refused = refusal(ctx, by, org);
    if (refused) return refused;
  }
  if (item.status === status) return [];
  return [{ type: ORGS_STATUS, data: { org, id, status, note: strOf(a.note).slice(0, PLAN_LIMITS.text), source: sourceOf(a), ...(strOf(a.said) !== "" ? { said: strOf(a.said).slice(0, PLAN_LIMITS.text) } : {}), at: ctx.state.clock, visibility: "secret" } }];
}

// ---------------------------------------------------------------- reading it

/** Someone the reader may name; "someone" under an id nothing acts on, else. */
export function refFor(ctx: ReadContext, viewer: EntityId | null, id: EntityId): OrgRef {
  const seen = viewer === null || id === viewer || canSeeEntity(ctx.registry, ctx.world, ctx.state, viewer, id);
  return seen ? { id, name: own(ctx.state.entities, id)?.name ?? id } : { id: `someone_${hashParts(id).slice(0, 6)}`, name: "someone" };
}

/** Whether an item's time has passed while it is still open: a goal's window (the day it was set, for "today"), an order's time. */
function lateOf(ctx: ReadContext, item: { status: PlanStatus; at: number; window?: string; when?: number }): boolean {
  if (!isPlanStatusLive(item.status)) return false;
  const cal = calendarOf(ctx.world);
  const today = dateAt(cal, ctx.state.clock).dayIndex;
  if (item.when !== undefined) return item.when < ctx.state.clock;
  if (item.window === "today") return dateAt(cal, item.at).dayIndex < today;
  if (item.window !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(item.window)) return dayIndexOfText(cal, item.window) < today;
  return false;
}

const SOURCE_WORDS: Readonly<Record<PlanSource, string>> = { player: "from your message", reply: "from the story", gm: "by the GM", play: "on the plan" };

/** Who set an item, when and from where, in words. */
function setWords(ctx: ReadContext, viewer: EntityId | null, item: { by?: EntityId; at: number; source: PlanSource }): string {
  const who = item.by === undefined ? null : item.by === viewer ? "you" : refFor(ctx, viewer, item.by).name;
  return `Set${who ? ` by ${who}` : ""} ${formatClock(calendarOf(ctx.world), item.at)}, ${SOURCE_WORDS[item.source]}`;
}

function placeWords(ctx: ReadContext, where: string | undefined): string | null {
  return where === undefined ? null : labelOf(ctx, where);
}

/** The people an organization's page names: its rows' people (the party's roster before its entity), each once. */
export function peopleIn(ctx: ReadContext, org: EntityId): EntityId[] {
  return [...new Set(rowsAt(ctx, org).map((r) => r.who))].filter((who) => orgTypeOf(ctx, who) === null && !isGone(ctx.state, who)).sort();
}

/** An organization's Plan as `viewer` may see it (the GM: null); null when they don't belong there and hold no power there, or it has none and they may give none. */
export function buildPlanView(ctx: ReadContext, org: EntityId, viewer: EntityId | null): OrgPlanView | null {
  if (!planned(ctx, org)) return null;
  const people = peopleIn(ctx, org);
  const give = viewer === null || mayGive(ctx, viewer, org);
  const belongs = viewer === null || people.includes(viewer) || powersAt(ctx, org, viewer).length > 0;
  if (!belongs) return null;
  const plan = planOf(ctx.state, org);
  const live = { goals: plan.goals.filter((g) => isPlanStatusLive(g.status)), orders: plan.orders.filter((o) => isPlanStatusLive(o.status)) };
  if (!give && live.goals.length === 0 && live.orders.length === 0) return null;
  const cal = calendarOf(ctx.world);
  const last = (n: PlanNote | undefined): { note: string; at: string } | null => (n ? { note: n.said ?? n.note, at: formatClock(cal, n.at) } : null);
  const seen = (who: EntityId): boolean => viewer === null || who === viewer || canSeeEntity(ctx.registry, ctx.world, ctx.state, viewer, who);
  const orderView = (o: PlanOrder): PlanOrderView => {
    const mine = viewer !== null && (o.to.includes(viewer) || o.lead === viewer);
    const to = o.to.filter(seen);
    return {
      id: o.id,
      goal: o.goal ?? null,
      to: o.to.map((who) => refFor(ctx, viewer, who)),
      lead: o.lead === undefined ? null : refFor(ctx, viewer, o.lead),
      text: o.text,
      where: placeWords(ctx, o.where),
      when: o.when === undefined ? null : formatClock(cal, o.when),
      status: o.status,
      set: setWords(ctx, viewer, o),
      late: lateOf(ctx, o),
      lived: o.lived !== undefined,
      last: last(o.last),
      mine,
      mayStatus: give || mine,
      mayEdit: give,
      edit: give ? { to, hidden: o.to.length - to.length, lead: o.lead !== undefined && seen(o.lead) ? o.lead : "", where: o.where ?? "", when: o.when === undefined ? "" : formatStamp(cal, o.when), goal: o.goal ?? "" } : null,
    };
  };
  const goals: PlanGoalView[] = live.goals.map((g) => {
    const orders = plan.orders.filter((o) => o.goal === g.id && (isPlanStatusLive(o.status) || o.status === "done"));
    return {
      id: g.id,
      text: g.text,
      window: g.window === undefined ? null : g.window === "today" ? "Today" : g.window,
      where: placeWords(ctx, g.where),
      status: g.status,
      set: setWords(ctx, viewer, g),
      late: lateOf(ctx, g),
      last: last(g.last),
      orders: orders.map(orderView),
      ordersDone: orders.length > 0 && orders.every((o) => o.status === "done"),
      mayEdit: give,
      edit: give ? { window: g.window ?? "", where: g.where ?? "" } : null,
    };
  });
  const goalIds = new Set(live.goals.map((g) => g.id));
  return {
    goals,
    orders: live.orders.filter((o) => o.goal === undefined || !goalIds.has(o.goal)).map(orderView),
    closed: plan.goals.length - live.goals.length + plan.orders.length - live.orders.length,
    recent: [...plan.goals.map((g) => ({ kind: "goal" as const, x: g as PlanGoal | PlanOrder })), ...plan.orders.map((o) => ({ kind: "order" as const, x: o as PlanGoal | PlanOrder }))]
      .filter(({ x }) => !isPlanStatusLive(x.status))
      .sort((a, b) => (b.x.last?.at ?? b.x.at) - (a.x.last?.at ?? a.x.at) || a.x.id.localeCompare(b.x.id))
      .slice(0, PLAN_RECENT)
      .map(({ kind, x }) => ({ id: x.id, kind, text: x.text, status: x.status, when: x.last ? formatClock(cal, x.last.at) : null })),
    mayGive: give,
    people: people.filter(seen).map((who) => refFor(ctx, viewer, who)),
  };
}

/** The organizations someone is on a plan of: every planned one whose live orders name them, in id order. */
function plansNaming(ctx: ReadContext, who: EntityId): { org: EntityId; orders: PlanOrder[] }[] {
  const all = objOf(sliceOf(ctx.state, "orgs").plan);
  return Object.keys(all)
    .sort()
    .filter((org) => planned(ctx, org))
    .map((org) => ({ org, orders: planOf(ctx.state, org).orders.filter((o) => isPlanStatusLive(o.status) && (o.to.includes(who) || o.lead === who)) }))
    .filter((p) => p.orders.length > 0);
}

/** The words for a team: who else it is for, and who leads. */
function teamWords(ctx: ReadContext, viewer: EntityId | null, o: PlanOrder, self: EntityId | null): string {
  const name = (id: EntityId): string => (id === self ? "you" : id === ctx.world.pov ? "the player character" : refFor(ctx, viewer, id).name);
  const others = o.to.filter((id) => id !== self);
  const lead = o.lead === undefined ? "" : o.lead === self ? "; you lead" : `; ${name(o.lead)} leads`;
  return others.length > 0 ? `with ${others.map(name).join(", ")}${lead}` : lead.replace(/^; /, "");
}

/** How someone in the party takes the leader's orders, by tier (§12 item 5's defaults). */
const TIER_FRAMES: Readonly<Record<PartyTier, string>> = {
  core: "You treat it as binding: carry it out as yourself; if you object, say so in the scene, then do it.",
  companion: "Weigh it in character: you may take it on or refuse, and say so in the scene.",
  hired: "It's part of the work you're paid for: get it done.",
  ally: "It's a favour asked of you: you may agree to it or not.",
};

/**
 * What a mind is told of the plans that name them (assess-party §6.2): each order asked of them, with
 * who gave it and when, their part, the team and the lead, its time and place, its status and the
 * goal it serves, and how to take it; a core party member also reads the rest of the party's plan.
 */
export function planMindLines(ctx: ReadContext, who: EntityId): string[] {
  const cal = calendarOf(ctx.world);
  const out: string[] = [];
  for (const { org, orders } of plansNaming(ctx, who)) {
    const goals = planOf(ctx.state, org).goals;
    const isParty = orgTypeOf(ctx, org) === "party" || (orgTypeOf(ctx, org) === null && org === partyIdOf(ctx).id);
    const leader = isParty ? (orgTypeOf(ctx, org) === null ? ctx.world.pov : partyLeader(ctx, org)) : null;
    const tier = leader === null ? null : partyTierIn(own(ctx.state.entities, who)?.relations, leader);
    const orgName = orgTypeOf(ctx, org) === null ? "the party" : (own(ctx.state.entities, org)?.name ?? org);
    for (const o of orders) {
      const giver = o.by === undefined ? "the GM" : o.by === ctx.world.pov ? `${own(ctx.state.entities, o.by)?.name ?? o.by} (the player character)` : (own(ctx.state.entities, o.by)?.name ?? o.by);
      const team = teamWords(ctx, null, o, who);
      const goal = o.goal === undefined ? undefined : goals.find((g) => g.id === o.goal);
      const parts = [
        `Asked of you by ${giver} for ${orgName} (${formatClock(cal, o.at)}): ${o.text}`,
        team !== "" ? `(${team})` : "",
        o.where !== undefined ? `at ${labelOf(ctx, o.where)}` : "",
        o.when !== undefined ? `by ${formatClock(cal, o.when)}` : "standing",
        `— ${PLAN_STATUS_WORDS[o.status].toLowerCase()}${lateOf(ctx, o) ? ", and late" : ""}.`,
        goal ? `It serves the goal: ${goal.text}.` : "",
        tier ? TIER_FRAMES[tier] : "Carry it out as part of your place there; if you won't, say so in the scene.",
      ];
      out.push(`- ${parts.filter((p) => p !== "").join(" ")}`);
    }
    if (tier === "core") {
      const rest = planOf(ctx.state, org).orders.filter((o) => isPlanStatusLive(o.status) && !orders.includes(o));
      for (const o of rest) out.push(`- The rest of the plan: ${o.to.map((id) => (id === ctx.world.pov ? "the player character" : (own(ctx.state.entities, id)?.name ?? id))).join(", ")}: ${o.text} (${PLAN_STATUS_WORDS[o.status].toLowerCase()}).`);
    }
  }
  return out;
}

/** A person's open orders by id, for the memory step's dedupe: they are recorded, never to be restated as plans or commitments. */
export function planMemoryLines(ctx: ReadContext, who: EntityId): string[] {
  return plansNaming(ctx, who).flatMap(({ orders }) => orders.map((o) => `- [${o.id}] ${o.text}`));
}

/**
 * The narrator's lines (assess-party §6.2, in the Quest section, source `plan`): for each organization
 * the player character belongs to, or leads as the party, with anything open on its plan: who set
 * each goal and order, when, its status and source, those it is for, and the latitude the narrator
 * has (§12 item 5.2: only what the player's message and the time that passes cover). Anyone the
 * player character can't see is "someone".
 */
export function planNarratorLines(ctx: ReadContext): string[] {
  const pov = ctx.world.pov;
  const cal = calendarOf(ctx.world);
  const all = objOf(sliceOf(ctx.state, "orgs").plan);
  const name = (id: EntityId): string => (id === pov ? "you" : refFor(ctx, pov, id).name);
  const out: string[] = [];
  for (const org of Object.keys(all).sort()) {
    if (!planned(ctx, org) || !peopleIn(ctx, org).includes(pov)) continue;
    const plan = planOf(ctx.state, org);
    const goals = plan.goals.filter((g) => isPlanStatusLive(g.status));
    const orders = plan.orders.filter((o) => isPlanStatusLive(o.status));
    if (goals.length === 0 && orders.length === 0) continue;
    const orgName = orgTypeOf(ctx, org) === null ? "your party" : (own(ctx.state.entities, org)?.name ?? org);
    out.push(`${orgName}: the plan and the orders given, as the story stands.`);
    const set = (x: PlanGoal | PlanOrder): string => `set${x.by === undefined ? " by the GM" : ` by ${name(x.by)}`} ${formatClock(cal, x.at)}${lateOf(ctx, x) ? " (its time has passed)" : ""}`;
    const latest = (x: PlanGoal | PlanOrder): string => (x.last && x.last.note !== "" ? `; latest: ${x.last.said ?? x.last.note} (${formatClock(cal, x.last.at)}, ${SOURCE_WORDS[x.last.source]})` : "");
    // The planner's marker (`orgs.lived`) says only what the day as laid says, never that it is done.
    const orderLine = (o: PlanOrder): string => `- ${o.to.map(name).join(", ")}${o.lead ? ` (${name(o.lead)} leads)` : ""}: ${o.text}${o.where ? `, at ${labelOf(ctx, o.where)}` : ""}${o.when !== undefined ? `, by ${formatClock(cal, o.when)}` : ""}. ${PLAN_STATUS_WORDS[o.status]}, ${set(o)}${latest(o)}.${o.lived !== undefined ? " By the day as laid it should be done; not told yet." : ""}`;
    for (const g of goals) {
      out.push(`Goal, ${set(g)}: ${g.text}${g.window ? ` (${g.window === "today" ? "today" : `by ${g.window}`})` : ""}. ${PLAN_STATUS_WORDS[g.status]}${latest(g)}.`);
      for (const o of orders.filter((x) => x.goal === g.id)) out.push(orderLine(o));
    }
    for (const o of orders.filter((x) => x.goal === undefined || !goals.some((g) => g.id === x.goal))) out.push(orderLine(o));
  }
  if (out.length === 0) return [];
  out.push("Play each one carrying out their order in character unless the scene gives them a reason not to. Show progress only as the player's message and the time that passes cover; never mark anything done, hand out a task, or change who does what yourself.");
  return out;
}

// ---------------------------------------------------------------- the story

/** Whether `said` is the message's own words (case and spacing aside). */
function statedIn(said: string, message: string): boolean {
  const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();
  const s = norm(said);
  return s.length >= 3 && norm(message).includes(s);
}

/** Someone the player character may name, by their name or their first name when only one fits: the people of `org` first, then anyone they can see. */
function personNamed(ctx: ReadContext, org: EntityId, words: string): EntityId | null {
  const w = words.trim().toLowerCase();
  if (w === "") return null;
  const pov = ctx.world.pov;
  const people = (ids: EntityId[]): EntityId | null => {
    const full = ids.filter((id) => (own(ctx.state.entities, id)?.name ?? "").toLowerCase() === w || id.toLowerCase() === w);
    if (full.length === 1) return full[0] ?? null;
    const first = ids.filter((id) => (own(ctx.state.entities, id)?.name ?? "").toLowerCase().split(/\s+/)[0] === w);
    return first.length === 1 ? (first[0] ?? null) : null;
  };
  const known = Object.keys(ctx.state.entities)
    .sort()
    .filter((id) => id !== pov && !isGone(ctx.state, id) && kindIs(ctx.registry, ctx.world, own(ctx.state.entities, id)?.kind ?? "", "person") && canSeeEntity(ctx.registry, ctx.world, ctx.state, pov, id));
  return people(peopleIn(ctx, org).filter((id) => id !== pov)) ?? people(known);
}

/** The organization a read plan is for: the one named (by id or name) the player character may give orders for, else their party. */
function planOrgNamed(ctx: ReadContext, words: string | undefined): EntityId | Rejection {
  const pov = ctx.world.pov;
  const w = (words ?? "").trim().toLowerCase();
  if (w === "" || w === "party" || w === "the party" || w === "our party") return partyIdOf(ctx).id;
  const org = Object.keys(ctx.state.entities)
    .sort()
    .find((id) => orgTypeOf(ctx, id) !== null && (id.toLowerCase() === w || (own(ctx.state.entities, id)?.name ?? "").toLowerCase() === w));
  if (org === undefined) return { code: "not_found", reason: `no organization is called ${words}` };
  return mayGive(ctx, pov, org) ? org : { code: "not_allowed", reason: `you may not give orders for ${labelOf(ctx, org)}` };
}

/** `orgs.plan_read`: the plan the player's own message gives, as events for one organization. */
export function planRead(ctx: ReadContext, items: PlanReadItems, message: string): { events: LedgerEvent[]; org: EntityId; goals: number; orders: number } | Rejection {
  const pov = ctx.world.pov;
  const goals = items.goals ?? [];
  const orders = items.orders ?? [];
  if (goals.length + orders.length === 0) return { code: "bad_args", reason: "nothing to add to the plan" };
  const org = planOrgNamed(ctx, [...goals, ...orders].map((x) => x.org).find((x) => x !== undefined && x.trim() !== ""));
  if (isRejection(org)) return org;
  if (!mayGive(ctx, pov, org)) return { code: "not_allowed", reason: `you may not give orders for ${labelOf(ctx, org)}` };
  const events: LedgerEvent[] = [];
  let state = ctx;
  const apply = (made: LedgerEvent[]): void => {
    events.push(...made);
    // Each item reads the plan as the ones before it left it: ids stay apart, and an order finds its goal.
    const next = structuredClone(state.state) as ReadContext["state"];
    for (const e of made) for (const def of PLAN_EVENTS) if (def.type === e.type) def.apply(e as PackEvent, next as never, state);
    state = { ...state, state: next };
  };
  const goalIds: string[] = [];
  for (const g of goals) {
    if (!statedIn(g.said, message)) return { code: "not_said", reason: `"${g.said}" isn't in your message` };
    const made = goalEvents(state, { org, text: g.text, ...(g.window ? { window: g.window } : {}), ...(g.where ? { where: g.where } : {}), by: pov, source: "player" });
    if (isRejection(made)) return made;
    goalIds.push(strOf(objOf(made[0]?.type === ORGS_GOAL ? (made[0] as PackEvent).data.goal : undefined).id));
    apply(made);
  }
  for (const o of orders) {
    if (!statedIn(o.said, message)) return { code: "not_said", reason: `"${o.said}" isn't in your message` };
    const to = o.to.map((n) => personNamed(state, org, n));
    const missing = o.to.find((_, i) => to[i] === null);
    if (missing !== undefined) return { code: "not_found", reason: `you don't know anyone called ${missing}` };
    const lead = o.lead ? personNamed(state, org, o.lead) : null;
    const made = orderEvents(state, { org, to: to as string[], ...(lead ? { lead } : {}), text: o.text, ...(o.where ? { where: o.where } : {}), ...(o.when ? { when: o.when } : {}), ...(goalIds.length === 1 ? { goal: goalIds[0] ?? "" } : {}), by: pov, source: "player" });
    if (isRejection(made)) return made;
    apply(made);
  }
  return { events, org, goals: goals.length, orders: orders.length };
}

/** The plan an item is on: the organization named when its plan holds the item, else whichever plan holds it (each id is its own plan's hash). */
function itemOrg(state: ReadContext["state"], org: string, id: string): EntityId | null {
  const holds = (o: EntityId): boolean => {
    const plan = planOf(state, o);
    return plan.orders.some((x) => x.id === id) || plan.goals.some((x) => x.id === id);
  };
  if (org !== "" && holds(org)) return org;
  return Object.keys(objOf(sliceOf(state, "orgs").plan)).sort().find(holds) ?? null;
}

/**
 * Whether a reply's agenda fact is someone volunteering (assess-party §6.2: "I'll handle the
 * permits"), which always asks "Add to the plan?" and never applies by itself, rather than an item
 * moved along: it names a task (`offer`) and no item.
 */
export function agendaAsks(p: JsonObject): boolean {
  return strOf(p.offer).trim() !== "" && strOf(p.id) === "";
}

/** An offer from the story, resolved: who volunteers, on which plan (the party's unless one is named), the task, where and when, and the words quoted; or why it can't go on the plan. */
function offerOf(ctx: ReadContext, p: JsonObject): { org: EntityId; who: EntityId; text: string; where: string; when: number | null; said: string } | Rejection {
  const pov = ctx.world.pov;
  const org = planOrgNamed(ctx, strOf(p.org) || undefined);
  if (isRejection(org)) return org;
  const named = strOf(p.who).trim();
  const byId = own(ctx.state.entities, named);
  const who = byId && kindIs(ctx.registry, ctx.world, byId.kind, "person") ? named : personNamed(ctx, org, named);
  if (who === null || who === pov) return { code: "not_found", reason: named === "" ? "who offers it" : `no one you know is ${named}` };
  if (isGone(ctx.state, who) || !acts(ctx.world, ctx.state, who)) return { code: "not_acting", reason: `${labelOf(ctx, who)} can't take it on` };
  const text = words(strOf(p.offer));
  if (isRejection(text)) return text;
  const said = strOf(p.said).trim().slice(0, PLAN_LIMITS.text);
  if (said === "") return { code: "bad_proposal", reason: "it quotes the story's words" };
  const when = whenOf(ctx, p.when);
  if (isRejection(when)) return when;
  if (planOf(ctx.state, org).orders.some((o) => isPlanStatusLive(o.status) && o.to.includes(who) && o.text.toLowerCase() === text.toLowerCase())) return { code: "already", reason: "it's on the plan already" };
  return { org, who, text, where: strOf(p.where).trim(), when, said };
}

/**
 * The reply's agenda channel (assess-party §6.2): an item on a plan moved along (under way, done,
 * blocked or refused), quoting the reply, which never makes a goal or an order by itself; or someone
 * volunteering a task, an order for them on the plan once the player says yes ("Add to the plan?",
 * `agendaAsks`), given by the player character.
 */
export const AGENDA_CHANNEL: ProposalChannelDef = {
  type: "agenda",
  boundField: "routine",
  validate: (p, ctx) => {
    if (agendaAsks(p)) {
      const offer = offerOf(ctx, p);
      return isRejection(offer) ? offer : null;
    }
    const id = strOf(p.id);
    const status = p.status;
    if (!isPlanStatus(status) || !OWN_MOVES.includes(status)) return { code: "bad_proposal", reason: "a plan's status from the story is under way, done, blocked or refused" };
    if (strOf(p.said).trim() === "") return { code: "bad_proposal", reason: "it quotes the story's words" };
    const org = itemOrg(ctx.state, strOf(p.org), id);
    const plan = org === null ? null : planOf(ctx.state, org);
    const item = plan?.orders.find((o) => o.id === id) ?? plan?.goals.find((g) => g.id === id);
    if (!item) return { code: "not_found", reason: `nothing on the plan is ${id}` };
    return isPlanStatusLive(item.status) ? null : { code: "closed", reason: `${id} is closed already` };
  },
  toEffects: (p, ctx) => {
    if (agendaAsks(p)) {
      const offer = offerOf(ctx, p);
      if (isRejection(offer)) return [];
      return [{ type: PLAN_EFFECTS.order, args: { org: offer.org, to: [offer.who], text: offer.text, ...(offer.where !== "" ? { where: offer.where } : {}), ...(offer.when !== null ? { when: offer.when } : {}), said: offer.said, source: "reply", by: ctx.world.pov } }];
    }
    const id = strOf(p.id);
    return [{ type: PLAN_EFFECTS.status, args: { org: itemOrg(ctx.state, strOf(p.org), id) ?? strOf(p.org), id, status: strOf(p.status), said: strOf(p.said), source: "reply" } }];
  },
};

/**
 * A reply's agenda fact as its chip reads it: "Add to the plan? Danny Okafor: handle the permits" for
 * an offer, "Done: Sweep the bays and stack the tyres" for an item moved along. Only names the player
 * character may know.
 */
export function agendaLabel(view: Pick<ReadContext, "registry" | "world" | "state">, p: JsonObject): string {
  const { registry, world, state } = view;
  if (agendaAsks(p)) {
    const who = strOf(p.who).trim();
    const e = own(state.entities, who);
    const name = e ? (who === world.pov || canSeeEntity(registry, world, state, world.pov, who) ? e.name : "Someone") : who || "Someone";
    return `Add to the plan? ${name}: ${strOf(p.offer).trim()}`;
  }
  const id = strOf(p.id);
  const org = itemOrg(state, strOf(p.org), id);
  const plan = org === null ? null : planOf(state, org);
  const text = (plan?.orders.find((o) => o.id === id) ?? plan?.goals.find((g) => g.id === id))?.text ?? id;
  return `${isPlanStatus(p.status) ? PLAN_STATUS_WORDS[p.status] : "Plan"}: ${text}`;
}

/**
 * What the reply's read is told of the plans (the extract step's agenda lines): each open goal and
 * order of every plan the player character is on, by id, with whom it is for and how it stands, so a
 * status names an item that is there. Anyone the player character can't see is "someone".
 */
export function planExtractLines(ctx: ReadContext): string[] {
  const pov = ctx.world.pov;
  const name = (id: EntityId): string => (id === pov ? "the player character" : refFor(ctx, pov, id).name);
  const out: string[] = [];
  for (const org of Object.keys(objOf(sliceOf(ctx.state, "orgs").plan)).sort()) {
    if (!planned(ctx, org) || !peopleIn(ctx, org).includes(pov)) continue;
    const plan = planOf(ctx.state, org);
    const orgName = `${orgTypeOf(ctx, org) === null ? "your party" : (own(ctx.state.entities, org)?.name ?? org)} (${org})`;
    for (const g of plan.goals.filter((x) => isPlanStatusLive(x.status))) out.push(`- [${g.id}] ${orgName}, goal: ${g.text} (${PLAN_STATUS_WORDS[g.status].toLowerCase()})`);
    for (const o of plan.orders.filter((x) => isPlanStatusLive(x.status))) out.push(`- [${o.id}] ${orgName}, order for ${o.to.map(name).join(", ")}: ${o.text} (${PLAN_STATUS_WORDS[o.status].toLowerCase()})`);
  }
  return out;
}

// ---------------------------------------------------------------- actions

/** The organization, by id: the party's own before it has an entity is `party_<you>`. */
const PLAN_ORG: ParamDef = { type: "text", label: "Organization (its id)" };

/** At once, with Undo (§12 item 5.1). */
const AT_ONCE = { duration: "2", observable: "makes plans", mechanical: true } as const;

const ACTIONS: readonly ActionDef[] = [
  {
    id: PLAN_ACTIONS.goal,
    label: "Set a goal",
    description: "Add a goal to an organization's plan, or change one.",
    pack: "orgs",
    params: { org: PLAN_ORG, id: { type: "text", optional: true, label: "Goal (its id, to change one)" }, text: { type: "text", optional: true, label: "The goal" }, window: { type: "text", optional: true, label: "By when: today, or a date (YYYY-MM-DD)" }, where: { type: "text", optional: true, label: "Where" } },
    requires: [],
    outcomes: { default: [{ type: PLAN_EFFECTS.goal, args: { org: "=params.org", id: "=params.id", text: "=params.text", window: "=params.window", where: "=params.where", by: "self" } }] },
    lexicon: ["set a goal", "add to the plan"],
    ...AT_ONCE,
  },
  {
    id: PLAN_ACTIONS.order,
    label: "Give an order",
    description: "Give people in an organization a task on its plan, or change one: whom it is for, who leads, where and when.",
    pack: "orgs",
    params: {
      org: PLAN_ORG,
      id: { type: "text", optional: true, label: "Order (its id, to change one)" },
      to: { type: "text", optional: true, label: "For (ids, comma separated)" },
      lead: { type: "text", optional: true, label: "Who leads (an id)" },
      text: { type: "text", optional: true, label: "The task" },
      where: { type: "text", optional: true, label: "Where" },
      when: { type: "text", optional: true, label: "When (YYYY-MM-DD HH:MM; none is a standing order)" },
      goal: { type: "text", optional: true, label: "The goal it serves (its id)" },
    },
    requires: [],
    outcomes: { default: [{ type: PLAN_EFFECTS.order, args: { org: "=params.org", id: "=params.id", to: "=params.to", lead: "=params.lead", text: "=params.text", where: "=params.where", when: "=params.when", goal: "=params.goal", by: "self" } }] },
    lexicon: ["give an order", "put them on it"],
    ...AT_ONCE,
  },
  {
    id: PLAN_ACTIONS.status,
    label: "Move a plan along",
    description: "Mark a goal or an order on an organization's plan under way, done, blocked, refused or dropped, or open it again.",
    pack: "orgs",
    params: { org: PLAN_ORG, id: { type: "text", label: "Goal or order (its id)" }, status: { type: "text", label: "open, under_way, done, dropped, blocked or refused" }, note: { type: "text", optional: true, label: "Note" } },
    requires: [],
    outcomes: { default: [{ type: PLAN_EFFECTS.status, args: { org: "=params.org", id: "=params.id", status: "=params.status", note: "=params.note", by: "self" } }] },
    lexicon: ["mark it done", "drop the plan"],
    ...AT_ONCE,
  },
];

/** The Plan's events, effects, actions, page section, narrator lines, story service and reply channel. */
export function registerPlan(r: CoreRegistry): void {
  for (const def of PLAN_EVENTS) r.event(def);
  r.effect({ type: PLAN_EFFECTS.goal, args: ["org", "id?", "text?", "window?", "where?", "status?", "source?", "by?"], gm: true, resolve: (a, ctx: EffectContext) => goalEvents(ctx, a) });
  r.effect({ type: PLAN_EFFECTS.order, args: ["org", "id?", "to?", "lead?", "text?", "where?", "when?", "goal?", "status?", "said?", "source?", "by?"], gm: true, resolve: (a, ctx: EffectContext) => orderEvents(ctx, a) });
  r.effect({ type: PLAN_EFFECTS.status, args: ["org", "id", "status", "note?", "said?", "source?", "by?"], gm: true, resolve: (a, ctx: EffectContext) => statusEvents(ctx, a) });
  for (const def of ACTIONS) r.action(def);
  r.orgSection({ id: PLAN_SECTION, label: "Plan", build: (ctx, org, viewer) => buildPlanView(ctx, org, viewer) as unknown as JsonValue | null });
  r.renderer({ slot: "quest", source: "plan", label: "Your plans and the orders given", render: (ctx) => planNarratorLines(ctx) });
  r.service("orgs.plan_read", planRead);
  r.proposal(AGENDA_CHANNEL);
}
