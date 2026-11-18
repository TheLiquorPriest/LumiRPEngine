// Reads (the skills `items`, `groups`, `people`, `vehicles` and `economy`): what today's read tools let the
// game master and the Author read besides the world query. Whose a thing is, who has it and who may use or
// dispose of it, and why; a person's things by where they stand; a person's groups and one group's page;
// how one person regards another on each axis; the way between two places and how long it takes; a
// person's or a group's accounts, debts and cash in one read. Each is read as the packs' own readers have
// it; none of it is marked or held back (the answer's names carry their ids).

import type { JsonObject, JsonValue } from "rp-harness/contract";
import { accessFor, accessOf, type AccessAnswer } from "../../engine/access";
import { controlThrough, heldPositions, HOW_WORDS, orgTitle, orgTypeOf } from "../../engine/org";
import { optionalQuery, own } from "../../engine/pack-kit";
import { bandOf, isGone, placeOfEntity } from "../../engine/scope";
import { thingIndex } from "../../engine/thing-index";
import { isThing } from "../../engine/things";
import { personThings, thingRow } from "../../engine/thing-view";
import { buildOrgsGm } from "../../packs/orgs/core/gm";
import { buildOrgView, dateWords, powersAt, rowsAt } from "../../packs/orgs/core/view";
import { axesOf, bandsOf, regardAxes, regardWords } from "../../packs/relationships/core/index";
import { routeAt } from "../../packs/space/core/travel";
import { CLASS_TRAITS } from "../../shared/finance";
import { TRAVEL_MODES } from "../../shared/maps";
import { ORG_PARTS, orgPart, type OrgPart } from "../../shared/org-view";
import type { ThingRow } from "../../shared/thing-view";
import { formatMoney } from "../../shared/world";
import { oneOf, TEXT } from "../kit";
import { isUnread, textArg } from "../ops";
import type { Reading } from "../reading";
import { textOf } from "../texts";
import { foundIn, readTool } from "./run";
import { powerWords } from "../../engine/word-tables";

const FAMILY = "reads";

/** Someone or something as an answer names them: its name and its id. */
const label = (r: Reading, id: string): string => `${r.nameOf(id)} [${id}]`;

/** What a thing's access rests on, as an answer gives it. */
function ground(r: Reading, g: AccessAnswer | null): JsonValue {
  if (g === null) return null;
  return { basis: g.basis, ...(g.via !== undefined ? { via: label(r, g.via) } : {}), ...(g.by !== undefined ? { by: label(r, g.by) } : {}), ...(g.grant !== undefined ? { grant: g.grant } : {}), ...(g.until !== undefined ? { until: g.until } : {}), ...(g.presumed === true ? { presumed: true } : {}) };
}

/** A thing as a list gives it: its name and id, what it is, where it is, whose it is and who has it. */
function thingBrief(r: Reading, t: ThingRow): JsonObject {
  return { id: t.id, name: t.name, ...(t.type !== null ? { type: t.type } : {}), where: t.where as unknown as JsonValue, whose: t.whose as unknown as JsonValue, ...(t.with !== null ? { with: label(r, t.with) } : {}), ...(t.worn !== null ? { worn: t.worn } : {}) };
}

const access = readTool({
  name: "items_access",
  family: FAMILY,
  properties: { who: TEXT, item: TEXT },
  required: ["who", "item"],
  example: { who: "Odile", item: "Old van" },
  read(r, args, reply) {
    const who = foundIn(r, "who", args.who, "entity");
    if (isUnread(who)) return who;
    const item = foundIn(r, "item", args.item, "thing");
    if (isUnread(item)) return item;
    const may = accessFor(r.ctx, who.id, item.id);
    const held = accessOf(r.ctx.state, item.id);
    reply.data({
      who: label(r, who.id),
      thing: thingBrief(r, thingRow(r.ctx, item.id)),
      use: ground(r, may.use),
      dispose: ground(r, may.dispose),
      owners: held.owners.map((o) => ({ party: o.party === null ? null : label(r, o.party), role: o.role, share: o.share })) as unknown as JsonValue,
      users: held.users.map((u) => ({ who: label(r, u.who), ...(u.until !== undefined ? { until: u.until } : {}) })),
    });
    return undefined;
  },
});

const itemsOf = readTool({
  name: "items_of",
  family: FAMILY,
  properties: { person: TEXT },
  required: ["person"],
  example: { person: "Odile" },
  read(r, args, reply) {
    const who = foundIn(r, "person", args.person, "person");
    if (isUnread(who)) return who;
    const groups = personThings(r.ctx, who.id);
    const state = r.ctx.state;
    const kept = (rows: readonly ThingRow[]): JsonValue => rows.filter((t) => own(state.entities, t.id)?.fields.lost !== true).map((t) => thingBrief(r, t));
    const lost = (thingIndex(r.ctx).owned.get(who.id) ?? []).filter((id) => own(state.entities, id)?.fields.lost === true && !isGone(state, id));
    const borrowed = (own(state.entities, who.id)?.relations ?? []).filter((rel) => rel.type === "uses" && isThing(r.ctx, rel.to) && !isGone(state, rel.to)).map((rel) => thingBrief(r, thingRow(r.ctx, rel.to)));
    reply.data({
      person: label(r, who.id),
      on: groups ? kept(groups.on) : [],
      holding: groups ? kept(groups.holding) : [],
      elsewhere: groups ? kept([...groups.home, ...groups.away]) : [],
      lent: groups ? kept(groups.lent) : [],
      borrowed,
      missing: lost.map((id) => thingBrief(r, thingRow(r.ctx, id))),
    });
    return undefined;
  },
});

const orgsList = readTool({
  name: "orgs_list",
  family: FAMILY,
  properties: { who: TEXT },
  required: [],
  example: { who: "Odile" },
  read(r, args, reply) {
    const pages = buildOrgsGm(r.ctx).map((g) => g.page);
    const said = textArg(args, "who");
    if (said === undefined) {
      reply.data({ organizations: pages.map((p) => ({ organization: label(r, p.id), type: p.type, kind: p.kind, run_by: p.runBy.map((x) => label(r, x.id)), members: p.people.length })) });
      return undefined;
    }
    const who = foundIn(r, "who", said, "person");
    if (isUnread(who)) return who;
    const orgs = pages.flatMap((p) => {
      const rows = rowsAt(r.ctx, p.id).filter((m) => m.who === who.id);
      if (rows.length === 0) return [];
      const typed = orgTypeOf(r.ctx, p.id) !== null;
      const held = typed ? heldPositions(r.ctx, who.id, p.id)[0] : undefined;
      const since = held?.row.since ?? rows.find((m) => m.since !== undefined)?.since;
      const title = (typed ? orgTitle(r.ctx, who.id, p.id) : null) ?? (rows.some((m) => m.how === "leader") ? "Leader" : HOW_WORDS[rows[0]?.how ?? "member"]);
      return [{ organization: label(r, p.id), type: p.type, title, position: held ? { id: held.position.id, title: held.position.title } : null, powers: powersAt(r.ctx, p.id, who.id).map(({ power, grant }) => ({ power, basis: grant.basis, words: powerWords[power] })), since: since === undefined ? null : dateWords(r.ctx, since) }];
    });
    reply.data({ who: label(r, who.id), organizations: orgs as unknown as JsonValue });
    return undefined;
  },
});

const orgsRead = readTool({
  name: "orgs_read",
  family: FAMILY,
  properties: { org: TEXT, part: oneOf(ORG_PARTS) },
  required: ["org"],
  example: { org: "The Lamplighters", part: "people" },
  read(r, args, reply) {
    const org = foundIn(r, "org", args.org, "organization");
    if (isUnread(org)) return org;
    const part = textArg(args, "part");
    if (part !== undefined && !ORG_PARTS.some((p) => p === part)) return { line: "unreadable", fields: { field: "part", value: JSON.stringify(part), choices: textOf(ORG_PARTS) } };
    const page = buildOrgView(r.ctx, org.id, null);
    if (page === null) return { line: "unreadable", fields: { field: "org", value: JSON.stringify(args.org), choices: "an organization" } };
    // The game master's own place in it: who answers up through, in each power.
    reply.data({ organization: label(r, org.id), ...(part !== undefined ? { part, [part]: orgPart(page, part as OrgPart) as unknown as JsonValue } : { page: page as unknown as JsonValue }), controlled_through: controlThrough(r.ctx, r.ctx.world.pov, org.id).map((id) => label(r, id)) });
    return undefined;
  },
});

const regard = readTool({
  name: "people_regard",
  family: FAMILY,
  properties: { person: TEXT, toward: TEXT },
  required: ["person"],
  example: { person: "Odile", toward: "Bram" },
  read(r, args, reply) {
    const from = foundIn(r, "person", args.person, "person");
    if (isUnread(from)) return from;
    let toward: string | null = null;
    if (args.toward !== undefined && args.toward !== null && args.toward !== "") {
      const to = foundIn(r, "toward", args.toward, "person");
      if (isUnread(to)) return to;
      toward = to.id;
    }
    const targets = [...new Set((own(r.ctx.state.entities, from.id)?.relations ?? []).filter((rel) => rel.type === "regard" && (toward === null || rel.to === toward)).map((rel) => rel.to))].sort();
    const bands = bandsOf(r.ctx);
    const regards = targets.map((to) => {
      const values = regardAxes(r.ctx, from.id, to);
      const words = regardWords(r.ctx, from.id, to);
      return { toward: label(r, to), ...(words !== null ? { words } : {}), axes: axesOf(r.ctx).map((a) => ({ axis: a.label, band: bandOf(bands, own(values, a.id) ?? 0)?.label ?? "neutral", value: own(values, a.id) ?? 0 })) };
    });
    reply.data({ person: label(r, from.id), regard: regards as unknown as JsonValue });
    return undefined;
  },
});

const route = readTool({
  name: "places_route",
  family: FAMILY,
  properties: { to: TEXT, from: TEXT, mode: oneOf(TRAVEL_MODES) },
  required: ["to"],
  example: { to: "The Far Road", from: "Market Square", mode: "road" },
  read(r, args, reply) {
    const to = foundIn(r, "to", args.to, "place");
    if (isUnread(to)) return to;
    const fromSaid = textArg(args, "from");
    let from: string | null = placeOfEntity(r.ctx.state, r.ctx.world.pov);
    if (fromSaid !== undefined) {
      const found = foundIn(r, "from", fromSaid, "place");
      if (isUnread(found)) return found;
      from = found.id;
    }
    if (from === null) return { line: "needs_field", fields: { field: "from" } };
    const mode = textArg(args, "mode");
    if (mode !== undefined && !TRAVEL_MODES.some((m) => m === mode)) return { line: "unreadable", fields: { field: "mode", value: JSON.stringify(mode), choices: textOf(TRAVEL_MODES) } };
    const routes: JsonObject[] = [];
    const none: string[] = [];
    for (const m of mode !== undefined ? TRAVEL_MODES.filter((x) => x === mode) : TRAVEL_MODES) {
      const plan = routeAt(r.ctx, from, to.id, m);
      if (!plan) {
        none.push(m);
        continue;
      }
      routes.push({ mode: plan.mode, minutes: plan.minutes, distance_km: Math.round(plan.distanceKm * 100) / 100, legs: plan.legs.map((l) => ({ from: label(r, l.from), to: label(r, l.to), minutes: l.minutes, distance_km: Math.round(l.distanceKm * 100) / 100 })) });
    }
    reply.data({ from: label(r, from), to: label(r, to.id), routes, ...(none.length > 0 ? { none } : {}) });
    return undefined;
  },
});

const balances = readTool({
  name: "money_balances",
  family: FAMILY,
  properties: { who: TEXT },
  required: ["who"],
  example: { who: "Odile" },
  read(r, args, reply) {
    const party = foundIn(r, "who", args.who, "party");
    if (isUnread(party)) return party;
    const finance = optionalQuery(r.ctx, "economy.finance");
    if (!finance) {
      reply.data({ party: label(r, party.id), accounts: [], owes: [] });
      return undefined;
    }
    const money = finance(r.ctx, party.id, false);
    const cur = r.doc.currency;
    const sum = (cents: number): JsonObject => ({ cents, amount: formatMoney(cents, cur) });
    reply.data({
      party: label(r, party.id),
      kind: money.partyKind,
      level: money.level,
      wealth: money.band,
      cash: money.cash === null ? null : "cents" in money.cash ? sum(money.cash.cents) : { band: money.cash.band },
      ...(money.overview?.netWorth !== undefined && money.overview.netWorth !== null ? { net_worth: sum(money.overview.netWorth) } : {}),
      accounts: money.accounts.map((a) => ({ account: label(r, a.id), class: a.class, product: a.product.label, institution: a.institution, status: a.status, ...sum(a.cents), ...(a.available !== null ? { available: sum(a.available) } : {}), ...(a.limit !== null ? { limit: sum(a.limit) } : {}), owners: a.owners.map((o) => ({ party: o.party === null ? null : label(r, o.party), role: o.role, share: o.share })) })) as unknown as JsonValue,
      owes: money.accounts.filter((a) => CLASS_TRAITS[a.class].liability && a.cents < 0).map((a) => ({ account: label(r, a.id), ...sum(-a.cents), ...(a.loan ? { payment: sum(a.loan.payment), months_left: a.loan.monthsLeft } : {}), ...(a.due ? { due: { ...sum(a.due.cents), label: a.due.label, at: a.due.at } } : {}) })) as unknown as JsonValue,
      flows: money.flows.map((f) => ({ id: f.id, label: f.label, kind: f.kind, from: f.from, to: f.to, amount: f.amount, schedule: f.schedule, next: f.next, status: f.status })) as unknown as JsonValue,
      notes: money.notes as unknown as JsonValue,
    });
    return undefined;
  },
});

/** The family's tools, as RPH's search finds them. */
export const READ_TOOLS = [access, itemsOf, orgsList, orgsRead, regard, route, balances];
