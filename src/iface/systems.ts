// A level's typed systems (plan §6.4 l.658, §14 World): at a level of the tree, at the chat's head or at one of its
// turns, each game system that keeps something there, shown as that system keeps it and named as the source: a
// person's or a group's accounts with their postings and balance (economy), a thing's four facts and a person's
// things with theirs (gear), a group's people, positions and ranks and a person's place in each (orgs), the day and
// the clock where it is told (calendar), the sky over a place or a region (weather), a vehicle's driver and what it
// has (vehicles), and a person's sheet. Nothing is held back: a value that is out of the player's sight is marked
// `secret`, and the page's own gate decides what shows. Read from the stored state alone; nothing is written.

import { route, RouteError, shape } from "../app";
import { accessFor } from "../engine/access";
import { calendarOf, dateAt, dayPartAt, formatClock, holidayDay, MINUTES_PER_DAY, placeOffset, placeZone } from "../engine/calendar";
import { buildCharacter } from "../engine/character";
import { orgTypeOf } from "../engine/org";
import { numOf, optionalQuery, own, rowOf, strOf } from "../engine/pack-kit";
import { readPass } from "../engine/read-pass";
import type { ReadContext } from "../engine/registry";
import { isGone, kindIs, placeOfEntity } from "../engine/scope";
import { personThings, thingPage } from "../engine/thing-view";
import { isThing } from "../engine/things";
import { canSeeField, couldSeeEntity, canSeePlace } from "../engine/visibility";
import { holidaysOf } from "../packs/calendar/core/holidays";
import { isParty } from "../packs/economy/core/pay";
import { ownersOf } from "../packs/economy/core/model";
import { buildOrgsGm } from "../packs/orgs/core/gm";
import { vehiclesFor } from "../packs/vehicles/core/access";
import { driverOf, rangeLeft, serviceInterval } from "../packs/vehicles/core/index";
import { climateOf, placeWeatherAt, regionOf, seasonAt, stateAt } from "../packs/weather/core";
import type { EntityId, PlaceId } from "../shared/ids";
import { GRANT_WORDS, presumedLine, type ThingRow, whoseWords } from "../shared/thing-view";
import { formatMoney, formatTemperature } from "../shared/world";
import { clockRecorded, JoinedTurnError, type Store, type StoreState } from "../store";

export const SYSTEMS_PATH = "/api/v1/chats/:chat/state/systems";

/** What the app area is given by the composition for this route: the store the chats' states are in. */
export interface SystemsTakes {
  store: Store;
}

const precision = shape.named("FactPrecision", "How exact a value or a fact is.", shape.oneOf("exact", "approximate", "vague", "unknown"));
const standing = shape.named("FactStanding", "How sure a value or a fact is.", shape.oneOf("established", "proposed", "assumed"));

const rowShown = shape.named(
  "SystemRowShown",
  "One row of a typed system's view at a level: its label, its value, a note, how exact and how sure it is where a change recorded it, and whether it is out of the player's sight.",
  shape.object({
    label: shape.text(),
    value: shape.text(),
    note: shape.nullable(shape.text()),
    precision: shape.nullable(precision),
    standing: shape.nullable(standing),
    secret: shape.field(shape.yesNo(), "Whether the player could not see it: the level, or the thing it is about, is hidden from them."),
  }),
);
const systemShown = shape.named(
  "SystemShown",
  "One typed system's view at a level, as the system keeps it, named as the source: its sections of rows.",
  shape.object({
    system: shape.field(shape.text(), "The system that keeps it: economy, gear, orgs, calendar, weather, vehicles or sheets."),
    title: shape.text(),
    sections: shape.list(shape.object({ title: shape.text(), rows: shape.list(rowShown) })),
  }),
);
const systemsReply = shape.named(
  "SystemsReply",
  "A level's typed systems, at the chat's head or at a turn: the level as the tree names it, and each system that keeps something there.",
  shape.object({ at: shape.field(shape.text(), "The level, as the tree names it."), systems: shape.list(systemShown) }),
);

interface RowOut {
  label: string;
  value: string;
  note: string | null;
  precision: "exact" | "approximate" | "vague" | "unknown" | null;
  standing: "established" | "proposed" | "assumed" | null;
  secret: boolean;
}
interface SectionOut {
  title: string;
  rows: RowOut[];
}
interface SystemOut {
  system: string;
  title: string;
  sections: SectionOut[];
}

/** A level of the tree: its ref, what it is, and its id there. */
interface Level {
  ref: string;
  kind: "world" | "place" | "entity" | "groups" | "elsewhere";
  id: string;
}

/** What one reading holds: the context over the state, the state's marks, the level, and whether the player could see it. */
interface Read {
  ctx: ReadContext;
  marks: StoreState["marks"];
  /** The state itself, for what its marks say of the clock. */
  stored: StoreState;
  level: Level;
  pov: EntityId;
  /** The level itself is out of the player's sight. */
  hidden: boolean;
}

interface Extra {
  note?: string | null;
  /** The key a change recorded this value under, on the level `ref` (the read's level when none). */
  key?: string;
  ref?: string;
  secret?: boolean;
}

function row(r: Read, label: string, value: string, o: Extra = {}): RowOut {
  const mark = o.key === undefined ? undefined : r.marks[o.ref ?? r.level.ref]?.[o.key];
  return { label, value, note: o.note ?? null, precision: mark?.precision ?? null, standing: mark?.standing ?? null, secret: r.hidden || o.secret === true };
}

const section = (title: string, rows: RowOut[]): SectionOut => ({ title, rows });

const nameOf = (ctx: ReadContext, id: string | null | undefined): string => (id === null || id === undefined ? "" : (own(ctx.state.entities, id)?.name ?? own(ctx.world.places, id)?.name ?? id));
const placeName = (ctx: ReadContext, id: string | null): string => (id === null ? "Nowhere" : (own(ctx.world.places, id)?.name ?? id));
const hiddenFrom = (r: Read, id: string): boolean => !couldSeeEntity(r.ctx.registry, r.ctx.world, r.ctx.state, r.pov, id);
const money = (ctx: ReadContext, cents: number): string => formatMoney(cents, ctx.world.currency);

// ---------------------------------------------------------------- economy

/** The party an account level shows the account of: the first of its owners that is a party. */
function holderOf(ctx: ReadContext, account: EntityId): EntityId | null {
  return ownersOf(ctx.state, account).find((o) => own(ctx.state.entities, o.party) !== undefined && isParty(ctx, o.party))?.party ?? null;
}

function economy(r: Read): SectionOut[] {
  const { ctx, level } = r;
  const out: SectionOut[] = [];
  if (level.kind === "world") return [section("Currency", [row(r, "Counted in", `${ctx.world.currency.code} (${ctx.world.currency.symbol})`)])];
  if (level.kind === "place") {
    const offers = optionalQuery(ctx, "economy.offers_at")?.(ctx, level.id) ?? [];
    return offers.length === 0 ? [] : [section("Sold here", offers.map((o) => row(r, o.name, money(ctx, o.cents), { note: o.category })))];
  }
  const finance = optionalQuery(ctx, "economy.finance");
  if (level.kind !== "entity" || finance === null) return out;
  const party = isParty(ctx, level.id) ? level.id : holderOf(ctx, level.id);
  if (party === null) return out;
  const view = finance(ctx, party, false);
  if (party === level.id) {
    const cash = view.cash === null ? null : "cents" in view.cash ? money(ctx, view.cash.cents) : view.cash.band;
    const worth = view.overview?.netWorth ?? null;
    const head = [
      ...(cash === null ? [] : [row(r, "Cash on hand", cash)]),
      ...(worth === null ? [] : [row(r, "Net worth", money(ctx, worth))]),
      ...(view.band === null ? [] : [row(r, "Wealth", view.band)]),
    ];
    if (head.length > 0) out.push(section("Cash", head));
  }
  for (const a of party === level.id ? view.accounts : view.accounts.filter((x) => x.id === level.id)) {
    const own = `entity:${a.id}`;
    const rows = [
      row(r, "Balance", money(ctx, a.cents), { key: "posted", ref: own }),
      ...(a.available === null ? [] : [row(r, "Available", money(ctx, a.available))]),
      ...(a.limit === null ? [] : [row(r, "Limit", money(ctx, a.limit))]),
      row(r, "Kind", `${a.classLabel}, ${a.product.label}${a.institution === null ? "" : ` at ${a.institution}`}`, { note: a.status }),
      row(r, "Owners", a.owners.map((o) => `${o.name} (${o.role}${o.share < 100 ? `, ${Math.round(o.share * 10) / 10}%` : ""})`).join("; ") || "None"),
      ...(a.due === null ? [] : [row(r, "Due", `${money(ctx, a.due.cents)}, ${a.due.at}`, { note: a.due.label })]),
      ...(a.loan === null ? [] : [row(r, "Loan", `${money(ctx, a.loan.payment)} a month, ${a.loan.monthsLeft} months left`, { note: `${money(ctx, a.loan.payoff)} to pay it off` })]),
      ...a.holds.map((h) => row(r, "Hold", money(ctx, h.cents), { note: `${h.kind}, until ${h.until}${h.memo === "" ? "" : `: ${h.memo}`}` })),
      ...a.pending.map((p) => row(r, `Pending, ${p.at}`, money(ctx, p.cents), { note: p.memo })),
      ...a.transactions.map((t) => row(r, t.at, money(ctx, t.cents), { note: [t.memo, t.counterparty, t.by].filter((w): w is string => w !== null && w !== undefined && w !== "").join(", ") || null })),
    ];
    out.push(section(`${a.name} (${a.product.label})`, rows));
  }
  if (party === level.id && view.flows.length > 0) out.push(section("Standing payments", view.flows.map((f) => row(r, f.label, f.amount, { note: `${f.kind}, ${f.schedule}${f.next === null ? "" : `, next ${f.next}`}, ${f.status}` }))));
  return out;
}

// ---------------------------------------------------------------- gear

/** Whose a thing is, who has it and where, in one line each. */
function whereWords(row: ThingRow): string {
  return row.where.length === 0 ? "Nowhere" : row.where.map((s) => s.name).join(" › ");
}

function useWords(ctx: ReadContext, who: EntityId, thing: EntityId): string {
  const use = accessFor(ctx, who, thing).use;
  if (use === null || use === undefined) return "no ground to use it";
  const via = use.via === undefined ? "" : ` of ${nameOf(ctx, use.via)}`;
  return `${use.basis}${via}${use.grant === undefined ? "" : `, ${GRANT_WORDS[use.grant]}`}${use.presumed === true ? " (presumed)" : ""}`;
}

function thingFacts(r: Read, t: ThingRow, who: EntityId | null): RowOut {
  const has = t.with === null ? "nobody" : nameOf(r.ctx, t.with);
  const use = who === null ? "" : ` May use: ${nameOf(r.ctx, who)}, ${useWords(r.ctx, who, t.id)}.`;
  return row(r, t.name, `Where: ${whereWords(t)}. Has it: ${has}. Whose: ${whoseWords(t.whose)}.${use}`, { note: presumedLine(t.whose), secret: t.secret });
}

function gear(r: Read): SectionOut[] {
  const { ctx, level } = r;
  if (level.kind !== "entity") return [];
  if (isThing(ctx, level.id) && !isGone(ctx.state, level.id)) {
    const page = thingPage(ctx, level.id);
    if (page === null) return [];
    const t = page.row;
    const facts = [
      row(r, "Where it is", whereWords(t), { secret: t.secret }),
      row(r, "Who has it", t.with === null ? "Nobody" : nameOf(ctx, t.with), { note: t.worn === null ? null : `worn in ${t.worn}`, secret: t.secret }),
      row(r, "Whose it is", whoseWords(t.whose), { note: presumedLine(t.whose), secret: t.secret }),
      row(r, "Who may use it", [...page.use.map((u) => u.label), ...page.grants.map((g) => `${g.who.name}, ${GRANT_WORDS[g.basis]}${g.until === null ? "" : ` until ${g.until}`}`)].join("; ") || "No one", { secret: t.secret }),
    ];
    const more = [
      ...(t.hidden ? [row(r, "Hidden", "Until searched for", { secret: true })] : []),
      ...(page.contents.length === 0 ? [] : [row(r, "Holds", page.contents.map((c) => c.name).join(", "))]),
    ];
    return [section("The four facts", facts), ...(more.length === 0 ? [] : [section("More", more)])];
  }
  const things = personThings(ctx, level.id);
  if (things === null) return [];
  const groups: [string, ThingRow[]][] = [
    ["Theirs, with them", things.on],
    ["Others', with them", things.holding],
    ["Theirs, at home", things.home],
    ["Theirs, elsewhere", things.away],
    ["Theirs, someone else has them", things.lent],
  ];
  return groups.filter(([, rows]) => rows.length > 0).map(([title, rows]) => section(title, rows.map((t) => thingFacts(r, t, level.id))));
}

// ---------------------------------------------------------------- orgs

function orgs(r: Read): SectionOut[] {
  const { ctx, level } = r;
  if (level.kind !== "entity") return [];
  const out: SectionOut[] = [];
  if (orgTypeOf(ctx, level.id) !== null) {
    const page = buildOrgsGm(ctx, [level.id])[0]?.page;
    if (page === undefined) return out;
    const ended = page.ended === null ? null : page.ended.dissolved !== null ? `dissolved ${page.ended.dissolved}` : page.ended.winding !== null ? `winding up since ${page.ended.winding}` : null;
    const stand = [
      row(r, "Kind", page.badge),
      row(r, "Standing", ended ?? "Running", { note: page.ended?.mergedInto === null || page.ended?.mergedInto === undefined ? null : `merged into ${page.ended.mergedInto.name}` }),
      ...(page.runBy.length === 0 ? [] : [row(r, "Run by", page.runBy.map((x) => x.name).join(", "))]),
      ...(page.dues === null ? [] : [row(r, "Dues", `${money(ctx, page.dues.cents)} ${page.dues.every}`)]),
      ...page.above.map((l) => row(r, "Held by", l.name, { note: [l.share === null ? null : `${l.share}%`, l.role, l.position?.title].filter((w) => w !== null && w !== undefined).join(", ") || null })),
      ...page.below.map((l) => row(r, "Holds", l.name, { note: [l.share === null ? null : `${l.share}%`, l.role, l.position?.title].filter((w) => w !== null && w !== undefined).join(", ") || null })),
    ];
    out.push(section("Standing", stand));
    if (page.people.length > 0) {
      out.push(
        section(
          "People",
          page.people.map((p) =>
            row(r, p.name, p.title, {
              note: [p.position === null ? null : `position ${p.position.title}`, p.rank === null ? null : `rank ${p.rank}`, p.hows.join("/"), p.status === "leave" ? "on leave" : null, p.since === null ? null : `since ${p.since}`, p.share === null ? null : `${Math.round(p.share * 10) / 10}%`].filter((w) => w !== null).join(", ") || null,
              secret: hiddenFrom(r, p.id),
            }),
          ),
        ),
      );
    }
    if (page.positions.length > 0) {
      out.push(
        section(
          "Positions",
          page.positions.map((p) =>
            row(r, p.title, `${p.filled} of ${p.seats === 0 ? "any number" : p.seats}${p.holders.length === 0 ? "" : `: ${p.holders.map((h) => nameOf(ctx, h)).join(", ")}`}`, {
              note: [p.reportsTo === null ? null : `reports to ${p.reportsTo.title}`, p.successor === "" ? null : `successor ${p.successor}`, p.joinsIn ? "new members join here" : null].filter((w) => w !== null).join(", ") || null,
            }),
          ),
        ),
      );
    }
    return out;
  }
  if (!kindIs(ctx.registry, ctx.world, own(ctx.state.entities, level.id)?.kind ?? "", "person")) return out;
  for (const { page } of buildOrgsGm(ctx)) {
    const me = page.people.find((p) => p.id === level.id);
    if (me === undefined) continue;
    out.push(
      section(`${page.name} (${page.badge})`, [
        row(r, "Title", me.title),
        ...(me.position === null ? [] : [row(r, "Position", me.position.title)]),
        ...(me.rank === null ? [] : [row(r, "Rank", String(me.rank))]),
        row(r, "Standing", [me.hows.join("/"), me.status === "leave" ? "on leave" : null, page.ended === null ? null : "the group is ending"].filter((w) => w !== null && w !== "").join(", ") || "Member"),
        ...(me.since === null ? [] : [row(r, "Since", me.since)]),
        ...(me.share === null ? [] : [row(r, "Stake", `${Math.round(me.share * 10) / 10}%`, { note: me.role })]),
        ...(me.powers.length === 0 ? [] : [row(r, "Powers", me.powers.map((p) => p.words).join("; "))]),
      ]),
    );
  }
  return out;
}

// ---------------------------------------------------------------- calendar

/** The holidays that fall on a day, and the next one coming (a year ahead at most). */
function holidaysAround(ctx: ReadContext, dayIndex: number): { today: string[]; next: { label: string; day: number } | null } {
  const cal = calendarOf(ctx.world);
  const today: string[] = [];
  let next: { label: string; day: number } | null = null;
  for (const h of holidaysOf(ctx)) {
    const day = holidayDay(cal, h, dayIndex);
    if (day === dayIndex) today.push(h.label);
    const ahead = day !== null && day > dayIndex ? day : holidayDay(cal, h, dayIndex + 366);
    if (ahead !== null && ahead > dayIndex && (next === null || ahead < next.day)) next = { label: h.label, day: ahead };
  }
  return { today, next };
}

function calendar(r: Read): SectionOut[] {
  const { ctx, level } = r;
  if ((level.kind !== "world" && level.kind !== "place") || !clockRecorded(r.stored)) return [];
  const cal = calendarOf(ctx.world);
  const offset = level.kind === "place" ? placeOffset(ctx.world, ctx.state.clock, level.id) : 0;
  const now = ctx.state.clock + offset;
  const day = dateAt(cal, now).dayIndex;
  const { today, next } = holidaysAround(ctx, day);
  const rows = [
    row(r, level.kind === "world" ? "Now" : "Local time", formatClock(cal, ctx.state.clock, offset), { key: "time", ref: "world" }),
    row(r, "Part of the day", dayPartAt(cal, now).label),
    row(r, "Time zone", level.kind === "place" ? placeZone(ctx.world, level.id) : ctx.world.calendar.timeZone),
    row(r, "Holidays today", today.length === 0 ? "None" : today.join(", ")),
    ...(next === null ? [] : [row(r, "Next holiday", next.label, { note: formatClock(cal, next.day * MINUTES_PER_DAY - cal.epochMinute).split(",")[0] ?? null })]),
  ];
  return [section(level.kind === "world" ? "The day" : "The day here", rows)];
}

// ---------------------------------------------------------------- weather

/** The sky over a place, or over a region: what it is, the temperature, the season, what it closes and how long it is held. */
function sky(r: Read, region: EntityId | null, place: PlaceId | null): RowOut[] {
  const { ctx } = r;
  const e = region === null ? undefined : own(ctx.state.entities, region);
  const placed = place === null ? null : placeWeatherAt(ctx, place);
  if (e === undefined && placed === null) return [];
  const st = region !== null && place === null ? (climateOf(ctx, region).states.find((s) => s.id === strOf(e?.fields.weather)) ?? null) : stateAt(ctx, place);
  const id = placed ?? strOf(e?.fields.weather, "clear");
  const at = region === null ? undefined : `entity:${region}`;
  const heat = e?.fields.temp_c;
  const cal = calendarOf(ctx.world);
  const hold = numOf(e?.fields.weather_hold, Number.NEGATIVE_INFINITY);
  const until = strOf(e?.fields.weather_hold_until);
  return [
    row(r, "Sky", st?.label ?? id, { key: "weather", ref: at, note: placed !== null ? "kept on the place itself" : e === undefined ? null : `over ${e.name}` }),
    ...(typeof heat === "number" ? [row(r, "Temperature", formatTemperature(heat), { key: "temp_c", ref: at })] : []),
    row(r, "Season", seasonAt(ctx)),
    ...(st === null || st.closes.length === 0 ? [] : [row(r, "Closed to travel", st.closes.join(", "))]),
    ...(hold > ctx.state.clock ? [row(r, "Held until", formatClock(cal, hold))] : until !== "" ? [row(r, "Held until", until)] : []),
  ];
}

function weather(r: Read): SectionOut[] {
  const { ctx, level } = r;
  if (level.kind === "place") {
    const rows = sky(r, regionOf(ctx, level.id), level.id);
    return rows.length === 0 ? [] : [section("The sky here", rows)];
  }
  if (level.kind === "world") {
    return Object.keys(ctx.state.entities)
      .sort()
      .filter((id) => !isGone(ctx.state, id) && kindIs(ctx.registry, ctx.world, own(ctx.state.entities, id)?.kind ?? "", "region"))
      .flatMap((id) => {
        const rows = sky(r, id, null);
        return rows.length === 0 ? [] : [section(nameOf(ctx, id), rows)];
      });
  }
  if (level.kind === "entity" && kindIs(ctx.registry, ctx.world, own(ctx.state.entities, level.id)?.kind ?? "", "region")) {
    const rows = sky(r, level.id, null);
    return rows.length === 0 ? [] : [section("The sky", rows)];
  }
  return [];
}

// ---------------------------------------------------------------- vehicles

const isVehicle = (ctx: ReadContext, id: EntityId): boolean => {
  const e = own(ctx.state.entities, id);
  return e !== undefined && kindIs(ctx.registry, ctx.world, e.kind, "vehicle") && !isGone(ctx.state, id);
};

function vehicleRows(r: Read, id: EntityId): RowOut[] {
  const { ctx } = r;
  const e = own(ctx.state.entities, id);
  if (e === undefined) return [];
  const at = `entity:${id}`;
  const cls = rowOf(ctx, "vehicles.classes", strOf(e.fields.class));
  const driver = driverOf(ctx, id);
  const aboard = Object.keys(ctx.state.entities)
    .sort()
    .filter((x) => !isGone(ctx.state, x) && kindIs(ctx.registry, ctx.world, own(ctx.state.entities, x)?.kind ?? "", "person") && own(ctx.state.entities, x)?.relations.some((rel) => rel.type === "in" && rel.to === id) === true)
    .map((x) => nameOf(ctx, x));
  const range = rangeLeft(ctx, id);
  const interval = serviceInterval(ctx, id);
  const used = typeof e.fields.odometer_mi === "number" ? e.fields.odometer_mi : numOf(e.fields.engine_hours);
  const unit = typeof e.fields.odometer_mi === "number" ? "mi" : "h";
  const home = e.fields.home;
  return [
    ...(typeof e.fields.status === "string" ? [row(r, "Status", e.fields.status.replace(/_/g, " "), { key: "status", ref: at })] : []),
    ...(cls === undefined ? [] : [row(r, "Class", strOf(cls.name, strOf(e.fields.class)))]),
    row(r, "Stands at", placeName(ctx, placeOfEntity(ctx.state, id))),
    row(r, "Driver", driver === null ? "No one" : nameOf(ctx, driver), { key: "driver", ref: at, secret: driver !== null && hiddenFrom(r, driver) }),
    ...(aboard.length === 0 ? [] : [row(r, "Aboard", aboard.join(", "))]),
    ...(typeof e.fields.fuel_pct === "number" ? [row(r, "Fuel", `${Math.round(e.fields.fuel_pct)}%`, { key: "fuel_pct", ref: at, note: range === null ? null : `about ${Math.round(range.value)} ${range.unit} left` })] : []),
    ...(typeof e.fields.odometer_mi === "number" || typeof e.fields.engine_hours === "number" ? [row(r, typeof e.fields.odometer_mi === "number" ? "Odometer" : "Engine hours", `${Math.round(used)} ${unit}`, { key: typeof e.fields.odometer_mi === "number" ? "odometer_mi" : "engine_hours", ref: at })] : []),
    ...(typeof e.fields.condition === "number" ? [row(r, "Condition", String(e.fields.condition), { key: "condition", ref: at })] : []),
    ...(typeof home === "string" ? [row(r, "Home base", placeName(ctx, home))] : []),
    ...(interval === null ? [] : [row(r, "Service due", `${Math.round(numOf(e.fields.last_service) + interval)} ${unit}`, { note: used > numOf(e.fields.last_service) + interval ? "overdue" : null })]),
  ];
}

function vehicles(r: Read): SectionOut[] {
  const { ctx, level } = r;
  if (level.kind === "place") {
    const here = Object.keys(ctx.state.entities)
      .sort()
      .filter((id) => isVehicle(ctx, id) && placeOfEntity(ctx.state, id) === level.id);
    return here.length === 0 ? [] : [section("Vehicles here", here.map((id) => row(r, nameOf(ctx, id), `Driver: ${driverOf(ctx, id) === null ? "no one" : nameOf(ctx, driverOf(ctx, id))}`, { secret: hiddenFrom(r, id) })))];
  }
  if (level.kind !== "entity") return [];
  if (isVehicle(ctx, level.id)) return [section(nameOf(ctx, level.id), vehicleRows(r, level.id))];
  if (!kindIs(ctx.registry, ctx.world, own(ctx.state.entities, level.id)?.kind ?? "", "person")) return [];
  return vehiclesFor(ctx, level.id).map((u) => section(nameOf(ctx, u.id), [...vehicleRows(r, u.id), row(r, "May drive", useWords(ctx, level.id, u.id))].map((x) => ({ ...x, secret: x.secret || hiddenFrom(r, u.id) }))));
}

// ---------------------------------------------------------------- sheets

const SHEET_PARTS = { identity: "Identity", where: "Where", day: "Day", work: "Work", stats: "Stats", advanced: "Advanced" } as const;

function sheets(r: Read): SectionOut[] {
  const { ctx, level } = r;
  if (level.kind !== "entity") return [];
  const sheet = buildCharacter(ctx.registry, ctx.world, level.id, ctx.state)?.character;
  if (sheet === undefined) return [];
  const at = `entity:${level.id}`;
  const head = [row(r, "Kind", sheet.kind.label), row(r, "Tier", sheet.tier.label, { key: "tier" }), ...(sheet.life === null ? [] : [row(r, "Life", sheet.life.label, { key: "life" })])];
  const parts = sheet.sections.map((s) =>
    section(
      SHEET_PARTS[s.id],
      s.fields
        .filter((f) => f.value !== null)
        .map((f) => {
          const v = f.value;
          const said = f.type === "ref" && typeof v === "string" ? nameOf(ctx, v) : typeof v === "string" ? v : Array.isArray(v) && v.every((x) => typeof x !== "object" || x === null) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : String(v);
          return row(r, f.label, said, { key: f.id, ref: at, secret: !canSeeField(ctx.registry, ctx.world, ctx.state, r.pov, level.id, f.id) });
        }),
    ),
  );
  return [section("Sheet", head), ...parts.filter((s) => s.rows.length > 0)];
}

// ---------------------------------------------------------------- the read

const SYSTEMS: readonly { system: string; title: string; build: (r: Read) => SectionOut[] }[] = [
  { system: "economy", title: "Money", build: economy },
  { system: "gear", title: "Things", build: gear },
  { system: "orgs", title: "Groups", build: orgs },
  { system: "calendar", title: "Calendar", build: calendar },
  { system: "weather", title: "Weather", build: weather },
  { system: "vehicles", title: "Vehicles", build: vehicles },
  { system: "sheets", title: "Sheet", build: sheets },
];

/** The level a tree ref names. */
function levelOf(ref: string): Level {
  if (ref === "world" || ref === "groups" || ref === "elsewhere") return { ref, kind: ref, id: ref };
  return ref.startsWith("place:") ? { ref, kind: "place", id: ref.slice("place:".length) } : { ref, kind: "entity", id: ref.slice("entity:".length) };
}

/**
 * What each system keeps at the level `asked` names, as the chat stands at its head or at `turn`. A turn joined to another is
 * refused with the typed error naming the turn it joined, before any state is read. A system that cannot be read says so in a
 * row of its own and the others are still given.
 */
export function systemsAt(store: Store, user: string, chat: string, asked: string, turn: string | null): { at: string; systems: SystemOut[] } {
  const s = store.user(user);
  const chatRow = s.chat(chat);
  if (chatRow === null) throw new RouteError(404, `RPE holds no chat ${chat}.`);
  if (turn !== null) {
    const t = s.turn(turn);
    if (t?.chat !== chat) throw new RouteError(404, `Chat ${chat} has no turn ${turn}.`);
    if (t.joined !== null) throw new JoinedTurnError(turn, t.joined);
  }
  const folded = turn === null ? s.headState(chat) : s.stateAt(turn);
  const tree = turn === null ? s.view(chat) : s.viewAt(turn);
  const ref = tree.resolve(asked);
  if (ref === null) throw new RouteError(404, `Nothing in the world of chat ${chat} is called ${asked}.`);
  const doc = store.env.worlds(folded.state.world.revision);
  if (chatRow.world === null || doc === undefined) return { at: ref, systems: [] };
  const level = levelOf(ref);
  return readPass(() => {
    const ctx = store.env.registry.context(doc, folded.state.world);
    const hidden = level.kind === "entity" ? !couldSeeEntity(ctx.registry, ctx.world, ctx.state, ctx.world.pov, level.id) : level.kind === "place" ? !canSeePlace(ctx.registry, ctx.world, ctx.state, ctx.world.pov, level.id) : false;
    const read: Read = { ctx, marks: folded.state.marks, stored: folded.state, level, pov: ctx.world.pov, hidden };
    const systems: SystemOut[] = [];
    for (const { system, title, build } of SYSTEMS) {
      try {
        const sections = build(read).filter((x) => x.rows.length > 0);
        if (sections.length > 0) systems.push({ system, title, sections });
      } catch (error) {
        systems.push({ system, title, sections: [section("Not read", [row(read, "Error", error instanceof Error ? error.message : String(error))])] });
      }
    }
    return { at: ref, systems };
  });
}

export function systemsRoutes(takes: SystemsTakes) {
  return [
    route({
      method: "GET",
      path: SYSTEMS_PATH,
      access: "page",
      group: "state",
      does: "A level's typed systems, at the chat's head or as it stood at a turn: each game system that keeps something there as that system keeps it (accounts with their postings and balance, a thing's four facts, a group's positions and ranks, the day, the sky, a vehicle's driver, a sheet), named as the source; what the player could not see is marked secret.",
      query: {
        at: shape.field(shape.text({ blank: false }), "The level, by its tree ref (`world`, `place:<id>`, `entity:<id>`) or a bare id."),
        turn: shape.optional(shape.turnId(), "A turn's id: the systems as they stood at that turn; left out, at the chat's head."),
      },
      reply: systemsReply,
      joined: true,
      handle: ({ user, params, query }) => systemsAt(takes.store, user, params.chat, query.at, query.turn ?? null),
    }),
  ] as const;
}
