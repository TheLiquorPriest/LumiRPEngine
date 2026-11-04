// Succession (ORG-SPEC §3.14, §8): each slot, a seat whose holder no longer acts (dead, or gone from
// the world) is filled by its position's successor, only where the position names one: `next`, the
// senior holder of a position reporting to it, moved up; or a named person, appointed through their
// membership there (made when they have none) or their job there. A title the holder went by with
// the seat passes with it. Each filling is one unit: the appointment, the History line, and, when the
// player character belongs, a signal that tells them. Nothing else passes: shares and things go only
// by the story or the GM. Derived from the state alone, so replay folds it the same. On unless the
// world's orgs config turns it off (Build → Packs → orgs), and this chat's own switch (the GM's
// `orgs.succession`) wins over the world's.

import { hashParts } from "../../../shared/hash";
import type { EntityId } from "../../../shared/ids";
import type { JsonObject, JsonValue } from "../../../shared/json";
import type { LedgerEvent, PackEvent } from "../../../shared/ledger";
import type { OrgMember, Position } from "../../../shared/org";
import { calendarOf, dateAt } from "../../../engine/calendar";
import { ENGINE_EVENTS } from "../../../engine/engine-pack";
import { belongsTo, directMembers, orgTypeOf, positionsOf, seatFilled } from "../../../engine/org";
import { objOf, own, sliceOf, sliceRecord, strOf } from "../../../engine/pack-kit";
import type { EffectDef, EventTypeDef, ProcessDef, ReadContext } from "../../../engine/registry";
import { linkEvents } from "../../../engine/relations";
import { isGone } from "../../../engine/scope";
import { MEMBER_OF } from "../../../engine/selector";
import { canSeeEntity } from "../../../engine/visibility";
import { orgLog } from "./log";

/** This chat's own settings for the orgs pack (`packs.orgs.config`), which win over the world's. */
export const ORGS_CONFIG = "orgs.config";

/** The orgs pack's settings in force: the world's `packs.orgs.config`, this chat's own over it. */
export function orgsSetting(ctx: Pick<ReadContext, "world" | "state">, key: string): JsonValue | undefined {
  const chat = objOf(sliceOf(ctx.state, "orgs").config)[key];
  if (chat !== undefined && chat !== null) return chat;
  return own(ctx.world.packs, "orgs")?.config[key];
}

/** Whether succession runs (§9: on by default). */
export function successionOn(ctx: Pick<ReadContext, "world" | "state">): boolean {
  return orgsSetting(ctx, "succession") !== false;
}

/** Today in the world's calendar, as a membership's `since` writes it (`YYYY-MM-DD`). */
function today(ctx: ReadContext): string {
  const d = dateAt(calendarOf(ctx.world), ctx.state.clock);
  return `${String(d.year).padStart(4, "0")}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

/** The most senior first: by rank, highest first, then by id. */
function bySeniority(a: OrgMember, b: OrgMember): number {
  return (b.rank ?? 0) - (a.rank ?? 0) || a.who.localeCompare(b.who);
}

/** A position's holders, each once by their most senior row. */
function holdersOf(rows: readonly OrgMember[], position: string): OrgMember[] {
  const out: OrgMember[] = [];
  for (const row of [...rows].filter((r) => r.position === position).sort(bySeniority)) if (!out.some((r) => r.who === row.who)) out.push(row);
  return out;
}

/** How many of a position's seats a holder who no longer acts has left empty: none while enough holders act (0 seats: any one). */
function vacantSeats(ctx: ReadContext, p: Position, holders: readonly OrgMember[]): number {
  const acting = holders.filter((r) => seatFilled(ctx, r.who)).length;
  const lapsed = holders.length - acting;
  if (p.seats === 0) return acting === 0 && lapsed > 0 ? 1 : 0;
  return Math.min(lapsed, Math.max(0, p.seats - acting));
}

/**
 * Who takes a vacant seat of `p` (§3.14): a named successor who acts and doesn't hold it already; for
 * `next`, the senior acting holder of a position reporting to it; else nobody. `taken` are those this
 * slot has already seated.
 */
function successorFor(ctx: ReadContext, org: EntityId, p: Position, positions: readonly Position[], rows: readonly OrgMember[], taken: ReadonlySet<EntityId>): EntityId | null {
  const free = (who: EntityId): boolean => seatFilled(ctx, who) && !taken.has(who) && !rows.some((r) => r.who === who && r.position === p.id);
  if (p.successor === "vacant") return null;
  if (p.successor !== "next") return own(ctx.state.entities, p.successor) && orgTypeOf(ctx, p.successor) === null && free(p.successor) ? p.successor : null;
  const below = positions.filter((q) => q.reports_to === p.id).map((q) => q.id);
  return [...rows].filter((r) => r.position !== undefined && below.includes(r.position)).sort(bySeniority).find((r) => free(r.who))?.who ?? null;
}

/**
 * The events that seat `who` in `p`: their own membership there carries it (made when they have
 * none, since today), else their job there; a title the vacated holder went by there passes to them.
 */
function seatEvents(ctx: ReadContext, org: EntityId, p: Position, who: EntityId, title: string | null, rows: readonly OrgMember[]): LedgerEvent[] | null {
  const link = own(ctx.state.entities, who)?.relations.find((r) => r.type === MEMBER_OF && r.to === org);
  const job = rows.find((r) => r.who === who && r.how === "staff" && r.via === undefined && r.job !== undefined)?.job;
  if (!link && job !== undefined) return [{ type: "set", entity: job, field: "position", value: p.id }];
  const fields: JsonObject = link ? { ...objOf(link.fields) } : { since: today(ctx) };
  fields.position = p.id;
  if (title !== null) fields.role = title;
  const events = linkEvents(ctx.registry, ctx.world, ctx.state, { rel: MEMBER_OF, from: who, to: org, fields, ...(link?.until !== undefined ? { until: link.until } : {}) });
  return Array.isArray(events) ? events : null;
}

/** One organization's successions this slot, each its own unit. */
function succeed(ctx: ReadContext, org: EntityId): LedgerEvent[] {
  const positions = positionsOf(ctx, org);
  if (!positions.some((p) => p.successor !== "vacant")) return [];
  const rows = directMembers(ctx, org).filter((r) => r.via === undefined);
  const name = (id: EntityId): string => own(ctx.state.entities, id)?.name ?? id;
  const orgName = name(org);
  const taken = new Set<EntityId>();
  const out: LedgerEvent[] = [];
  for (const p of positions) {
    if (p.successor === "vacant") continue;
    const holders = holdersOf(rows, p.id);
    const lapsed = holders.filter((r) => !seatFilled(ctx, r.who));
    for (let seat = 0, n = vacantSeats(ctx, p, holders); seat < n; seat++) {
      const who = successorFor(ctx, org, p, positions, rows, taken);
      if (who === null) break;
      const was = lapsed[seat];
      // The title the holder went by there, when it was their own and not merely the position's.
      const kept = was?.how === "member" && was.title !== undefined && was.title.trim().toLowerCase() !== p.title.trim().toLowerCase() ? was.title : null;
      const seatedBy = seatEvents(ctx, org, p, who, kept, rows);
      if (seatedBy === null) continue;
      taken.add(who);
      const text = was ? `${name(who)} succeeds ${name(was.who)} as ${p.title}` : `${name(who)} takes the seat of ${p.title}`;
      const unit: LedgerEvent[] = [...seatedBy, orgLog(ctx, org, text, { names: was ? [who, was.who] : [who] })];
      // The members are told: a signal to the player character when they are one, naming the successor only where they may see them.
      if (belongsTo(ctx, ctx.world.pov, org)) {
        const told = canSeeEntity(ctx.registry, ctx.world, ctx.state, ctx.world.pov, who) ? name(who) : "Someone";
        unit.push({ type: ENGINE_EVENTS.signal, data: { class: "incident", text: `${told} now holds ${p.title} for ${orgName}.`, entity: org } });
      }
      const group = `orgs.seat:${hashParts(org, p.id, who, String(ctx.state.clock)).slice(0, 10)}`;
      out.push(...unit.map((e) => ({ ...e, group })));
    }
  }
  return out;
}

/** Every organization's successions at a slot: those whose positions name a successor, in id order. */
export function stepSeats(ctx: ReadContext): LedgerEvent[] {
  if (!successionOn(ctx)) return [];
  return Object.keys(ctx.state.entities)
    .sort()
    .filter((id) => !isGone(ctx.state, id) && orgTypeOf(ctx, id) !== null)
    .flatMap((org) => succeed(ctx, org));
}

/** Succession, each slot, at every level (§3.14: always). */
export const SEATS_PROCESS: ProcessDef = { id: "orgs.seats", domain: "relationships", minLevel: 0, step: (_slot, ctx) => stepSeats(ctx) };

/** Settings this chat may hold for itself, and their values. */
const CHAT_SETTINGS: Readonly<Record<string, (v: JsonValue) => boolean>> = { succession: (v) => typeof v === "boolean" };

/** `orgs.config`: one of this chat's own orgs settings, or (null) back to the world's. Bookkeeping, the GM's. */
export const ORGS_CONFIG_EVENT: EventTypeDef<PackEvent> = {
  type: ORGS_CONFIG,
  validate: (e) => {
    const key = strOf(e.data.key);
    const check = own(CHAT_SETTINGS, key);
    if (!check) return { code: "bad_event", reason: `no orgs setting "${key}"` };
    const value = e.data.value;
    return value === null || (value !== undefined && check(value)) ? null : { code: "bad_event", reason: `a bad value for the orgs setting "${key}"` };
  },
  apply: (e, state) => {
    const config = sliceRecord(state, "orgs", "config");
    const key = strOf(e.data.key);
    if (e.data.value === null || e.data.value === undefined) delete config[key];
    else config[key] = e.data.value;
  },
  describe: (e) => (e.data.value === null ? `Orgs: ${strOf(e.data.key)} follows the world's setting` : `Orgs: ${strOf(e.data.key)} ${e.data.value === false ? "off" : "on"} in this chat`),
};

/** The GM's switch for succession in this chat (GM → This chat): on, off, or (none) as the world sets it. */
export const SUCCESSION_EFFECT: EffectDef = {
  type: "orgs.succession",
  args: ["on?"],
  gm: true,
  resolve: (a) => [{ type: ORGS_CONFIG, data: { key: "succession", value: typeof a.on === "boolean" ? a.on : null, visibility: "secret" } }],
};
