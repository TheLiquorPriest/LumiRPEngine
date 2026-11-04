// Founding an organization (ORG-SPEC §3.13; Orgs → Start something…, §4.2), and changing a
// company's structure: `org_found` and `org_restructure`, each played as a turn, its one effect one
// unit (L41). A company, from Money 3: the business spawned with its founder as its only owner
// (counting its stake in units of its classes when asked, §3.10), a business checking account it owns
// opened, and the founder's capital moved into it. A founder may be an organization, acting `as`
// itself through whoever governs it: a company starting a subsidiary from its own money. A group of
// one of the world's group kinds: the group spawned with a Leader position that holds every power,
// the founder in it as its Leader. A change of structure needs `org.govern` and more than half the
// votes; its tax treatment follows from the next estimated-tax period (the economy's
// `economy.restructure`).

import type { EntityId } from "../../../shared/ids";
import type { JsonObject, JsonValue } from "../../../shared/json";
import type { LedgerEvent } from "../../../shared/ledger";
import { CLASS_TRAITS, classesIn, FINANCE_EVENTS, ROLE_RIGHTS, STRUCTURE_WORDS, type AccountClass } from "../../../shared/finance";
import { ORG_ACTIONS, ORG_POWERS, type Position } from "../../../shared/org";
import type { OrgStartView } from "../../../shared/org-view";
import { PARTY_KIND } from "../../../shared/party";
import { formatMoney } from "../../../shared/world";
import { calendarOf, dateAt } from "../../../engine/calendar";
import { LEADER, mayAct, orgTypeOf } from "../../../engine/org";
import { labelOf, numOf, optionalQuery, optionalService, own, strOf } from "../../../engine/pack-kit";
import type { CoreRegistry, EffectContext, ReadContext, Rejection } from "../../../engine/registry";
import { linkEvents } from "../../../engine/relations";
import { isGone, kindDef, kindIs } from "../../../engine/scope";
import { COMPANY_KIND, GROUP_KIND, MEMBER_OF } from "../../../engine/selector";
import { Working } from "../../../engine/working";
import { orgLog } from "./log";
import { dateWords } from "./view";

/** The Money level a company needs (payroll, books and property, §4.7). */
const COMPANY_LEVEL = 3;

/** The longest name a founded organization takes. */
const NAME_MAX = 60;

/** A company's structures, the first the default (AGENT-GUIDE: `llc` when left out). */
const STRUCTURES = ["llc", "sole_proprietorship", "partnership", "s_corp", "c_corp"] as const;

/** The kinds that are an organization of their own type, never a group a founder starts as one. */
const NOT_GROUPS = [COMPANY_KIND, "household", "trust", PARTY_KIND] as const;

function refuse(code: string, reason: string): Rejection {
  return { code, reason };
}

/** Today in the world's calendar as a link's `since` writes it (`YYYY-MM-DD`). */
export function today(ctx: Pick<ReadContext, "world" | "state">): string {
  const d = dateAt(calendarOf(ctx.world), ctx.state.clock);
  return `${String(d.year).padStart(4, "0")}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

/**
 * Someone's accounts money they put into something of theirs (a party's purse, a company's capital)
 * may come from: the open deposit accounts that are their own money (an owner's or a joint owner's,
 * never one they are only an authorized user on), the one money paid to them lands in first
 * (checking, then cash, then savings), each with its balance.
 */
export function fundingSources(ctx: ReadContext, who: EntityId): { id: EntityId; name: string; balance: string }[] {
  const accounts = optionalQuery(ctx, "economy.finance")?.(ctx, who, true).accounts ?? [];
  const rank = (cls: AccountClass): number => CLASS_TRAITS[cls].depositRank ?? Number.POSITIVE_INFINITY;
  return accounts
    .filter((a) => {
      const t = CLASS_TRAITS[a.class];
      return a.status === "open" && a.spends && a.role !== null && ROLE_RIGHTS[a.role].worth && t.pays && !t.liability && !t.locked && t.depositRank !== null;
    })
    .sort((a, b) => rank(a.class) - rank(b.class) || a.id.localeCompare(b.id))
    .map((a) => ({ id: a.id, name: a.name, balance: formatMoney(a.cents, ctx.world.currency) }));
}

/** The world's kinds a founder may start a group as (a faction, a family, its own): every kind that extends `group` and isn't a company, household, trust or the party, by label. */
export function groupKinds(ctx: Pick<ReadContext, "registry" | "world">): { id: string; label: string }[] {
  const ids = new Set([...ctx.registry.kinds.keys(), ...Object.keys(ctx.world.kinds ?? {})]);
  return [...ids]
    .filter((id) => id !== GROUP_KIND && kindIs(ctx.registry, ctx.world, id, GROUP_KIND) && !NOT_GROUPS.some((k) => kindIs(ctx.registry, ctx.world, id, k)))
    .map((id) => ({ id, label: kindDef(ctx.registry, ctx.world, id)?.label ?? id }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}

/** Why `who` may not start a company now (Money 3), or null when they may. */
function companyRefusal(ctx: ReadContext, who: EntityId): string | null {
  return ctx.levelOf(who, "money") < COMPANY_LEVEL ? `Starting a company needs payroll and books in play (Money ${COMPANY_LEVEL})` : null;
}

/** What Orgs' Start something… offers `who` (§4.2): a company, with the accounts its capital may come from, and a group of one of the world's group kinds (null when it has none). */
export function startOptions(ctx: ReadContext, who: EntityId): OrgStartView {
  const kinds = groupKinds(ctx);
  return { company: { why: companyRefusal(ctx, who), sources: fundingSources(ctx, who) }, group: kinds.length > 0 ? { kinds } : null };
}

/** A fresh id for a founded organization, from its name: `ellis_mobile_repair_co`, then a number when that is taken. */
function freshId(ctx: ReadContext, name: string, suffix: string): EntityId {
  const slug =
    name
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "org";
  const base = `${slug}${suffix}`;
  let id = base;
  for (let n = 2; own(ctx.state.entities, id) || own(ctx.world.places, id); n++) id = `${base}_${n}`;
  return id;
}

/** What founding a company asks: who founds it (a person, or an organization acting through `by`), its name, its capital and where it comes from, its structure, and its units and classes when asked. */
interface Company {
  by: EntityId;
  founder: EntityId;
  name: string;
  cents: number;
  from: EntityId;
  structure: string;
  units: number | undefined;
  classes: JsonValue | undefined;
}

/**
 * A company (§3.13): the business, its founder its only owner (with its units in the first of its
 * classes, when it counts them), a business checking account it owns (its founder an authorized user,
 * who may spend from it), and the founder's capital moved into it from `from` (else their first
 * funding source) as their basis in it, worked out on one working state so each part sees the last.
 * Founded by an organization, the capital's posting names who moved it for it, and its History tells
 * it too.
 */
function companyEvents(ctx: EffectContext, c: Company): LedgerEvent[] | Rejection {
  const refused = companyRefusal(ctx, c.founder);
  if (refused) return refuse("level", refused);
  if (!(c.cents > 0)) return refuse("bad_amount", "a company starts with capital above nothing");
  if (!STRUCTURES.some((s) => s === c.structure)) return refuse("bad_structure", `a company's structure is one of ${STRUCTURES.join(", ")}`);
  if (c.units !== undefined && !(Number.isSafeInteger(c.units) && c.units > 0)) return refuse("bad_amount", "a company counts its shares in a whole number of units");
  const classes = c.classes === undefined ? null : classesIn({ share_classes: c.classes });
  const sources = fundingSources(ctx, c.founder);
  const source = c.from === "" ? sources[0]?.id : sources.find((s) => s.id === c.from)?.id;
  const whose = c.founder === c.by ? "of yours" : `of ${labelOf(ctx, c.founder)}'s`;
  if (source === undefined) return refuse("no_source", c.from === "" ? `${c.founder === c.by ? "You have" : `${labelOf(ctx, c.founder)} has`} no account to put capital in from` : `${labelOf(ctx, c.from)} isn't an account ${whose} capital can come from`);
  const open = optionalService(ctx, "economy.open_account");
  const pay = optionalService(ctx, "economy.transfer");
  if (!open || !pay) return refuse("no_money", "a company needs the economy");
  const w = new Working(ctx.registry, ctx.world, ctx.state);
  const apply = (events: readonly LedgerEvent[]): Rejection | null => {
    for (const ev of events) {
      const failed = w.apply(ev);
      if (failed) return failed;
    }
    return null;
  };
  const id = freshId(ctx, c.name, "_co");
  const founder = own(ctx.state.entities, c.founder);
  const fields: JsonObject = { owners: [{ party: c.founder, role: "owner", share: 100, ...(c.units !== undefined ? { units: c.units } : {}), ...(classes && c.units !== undefined && classes[0] ? { class: classes[0].id } : {}) }], structure: c.structure };
  if (classes) fields.share_classes = classes.map((k) => ({ id: k.id, label: k.label, votes: k.votes }));
  const spawned = apply([{ type: "spawn", entity: { id, kind: COMPANY_KIND, name: c.name, tier: founder?.tier ?? "background", fields, relations: [] } }]);
  if (spawned) return spawned;
  const owners = [
    { party: id, role: "owner" as const },
    { party: c.founder, role: "authorized_user" as const },
  ];
  const product = (p: string) => open(w.ctx, { name: `${c.name} checking`, product: p, owners });
  const tried = product("business_checking");
  const opened = !Array.isArray(tried) && tried.code === "bad_product" ? product("checking") : tried;
  if (!Array.isArray(opened)) return opened;
  const failed = apply(opened);
  if (failed) return failed;
  const account = opened.find((ev): ev is Extract<LedgerEvent, { type: "spawn" }> => ev.type === "spawn")?.entity.id;
  if (account === undefined) return refuse("no_account", "the company's account didn't open");
  const set = apply([{ type: "set", entity: id, field: "operating_account", value: account }]);
  if (set) return set;
  const paid = pay(w.ctx, source, account, c.cents, `Capital into ${c.name}`);
  if (!Array.isArray(paid)) return paid;
  // Capital, not income: filed under investment, so neither side's books count it as profit (DESIGN §26.2). Moved for an organization by someone acting for it (§3.6), its posting names who moved it.
  const stamp: JsonObject = c.founder === c.by || c.by === "" ? {} : { by: c.by, as: c.founder };
  const short = apply(paid.map((e): LedgerEvent => (e.type === FINANCE_EVENTS.txn && "data" in e ? { ...e, data: { ...e.data, category: "investment", ...stamp } } : e)));
  if (short) return short;
  // What the founder put in is their basis in it (DESIGN §27.10), as a buyer's price is when shares are issued to them.
  const basis = apply([{ type: "economy.acquire", data: { entity: id, party: c.founder, cents: c.cents } }]);
  if (basis) return basis;
  const money = formatMoney(c.cents, ctx.world.currency);
  const by = c.by !== "" ? { by: c.by } : {};
  const lines = c.founder === c.by ? [orgLog(w.ctx, id, `${labelOf(ctx, c.by)} founded ${c.name} with ${money}.`, { by: c.by, names: [c.by] })] : [orgLog(w.ctx, id, `${labelOf(ctx, c.founder)} founded ${c.name} with ${money}.`, { ...by, names: [c.founder] }), orgLog(w.ctx, c.founder, `Started ${c.name}, its subsidiary, with ${money}.`, by)];
  const logged = apply(lines);
  return logged ?? w.events;
}

/** A group (§3.13) of `kind`: spawned with a Leader position holding every power, and its founder in it as its Leader since today. */
function groupEvents(ctx: EffectContext, by: EntityId, name: string, kind: string): LedgerEvent[] | Rejection {
  const kinds = groupKinds(ctx);
  const of = kinds.find((k) => k.id === kind);
  if (!of) return refuse("bad_kind", kinds.length === 0 ? "This world has no kinds of group to start" : `a group is one of ${kinds.map((k) => k.label).join(", ")}`);
  const id = freshId(ctx, name, "");
  const founder = own(ctx.state.entities, by);
  const leader: Position = { id: LEADER, title: "Leader", powers: [...ORG_POWERS], seats: 1, scope: "org", successor: "vacant" };
  const spawn: LedgerEvent = { type: "spawn", entity: { id, kind, name, tier: founder?.tier ?? "background", fields: { positions: [leader as unknown as JsonObject] }, relations: [] } };
  const w = new Working(ctx.registry, ctx.world, ctx.state);
  const failed = w.apply(spawn);
  if (failed) return failed;
  const linked = linkEvents(w.ctx.registry, w.ctx.world, w.ctx.state, { rel: MEMBER_OF, from: by, to: id, fields: { position: LEADER, since: today(ctx) } });
  if (!Array.isArray(linked)) return linked;
  return [spawn, ...linked, orgLog(w.ctx, id, `${labelOf(ctx, by)} founded ${name}, a ${of.label.toLowerCase()}, and leads it.`, { by, names: [by] })];
}

/**
 * `orgs.found`: a company or a group, founded by `by` (§3.13), one unit. A `founder` other than `by`
 * is an organization `by` governs (`org.govern`), founding a company of its own (a subsidiary); with
 * no `by` (the GM's), an organization founds one with no power asked.
 */
function foundEvents(ctx: EffectContext, args: Record<string, JsonValue>): LedgerEvent[] | Rejection {
  const given = strOf(args.by);
  const founder = strOf(args.founder) || given || ctx.world.pov;
  const person = (id: EntityId): boolean => kindIs(ctx.registry, ctx.world, own(ctx.state.entities, id)?.kind ?? "", "person") && !isGone(ctx.state, id);
  const by = given !== "" ? given : person(founder) ? founder : "";
  if (by !== "" && !person(by)) return refuse("bad_founder", "Only a person founds an organization, for themselves or for one they govern");
  const type = strOf(args.type);
  if (founder !== by) {
    if (orgTypeOf(ctx, founder) === null || isGone(ctx.state, founder)) return refuse("bad_founder", `${labelOf(ctx, founder)} isn't an organization`);
    if (type !== "company") return refuse("bad_type", `${labelOf(ctx, founder)} founds companies; a group is founded by its people`);
    const may = by === "" ? null : mayAct(ctx, by, founder, "org.govern");
    if (may && !may.ok) return refuse("not_allowed", may.reason);
  }
  const name = strOf(args.name).replace(/\s+/g, " ").trim();
  if (name === "" || name.length > NAME_MAX) return refuse("bad_name", `an organization's name is 1–${NAME_MAX} characters`);
  if (type === "company") return companyEvents(ctx, { by, founder, name, cents: Math.round(numOf(args.cents)), from: strOf(args.from), structure: strOf(args.structure) || STRUCTURES[0], units: typeof args.units === "number" ? args.units : undefined, classes: args.classes ?? undefined });
  if (type === "group") return groupEvents(ctx, by, name, strOf(args.kind));
  return refuse("bad_type", "an organization founded is a company or a group");
}

/**
 * `orgs.restructure` (§3.13): a company's new structure, by whoever governs it (`org.govern`) with more
 * than half its votes, deciding as themselves or as an organization holder they govern (`party`); its
 * History line says when its taxes follow. With no `by` (the GM), no power or votes asked.
 */
function restructureEvents(ctx: EffectContext, a: Record<string, JsonValue>): LedgerEvent[] | Rejection {
  const org = strOf(a.org);
  if (orgTypeOf(ctx, org) !== "company") return refuse("not_company", `${labelOf(ctx, org)} isn't a company`);
  const structure = strOf(a.structure);
  const by = strOf(a.by);
  const party = strOf(a.party) || by;
  if (by !== "") {
    if (party !== by) {
      const may = mayAct(ctx, by, party, "org.govern");
      if (!may.ok) return refuse("not_allowed", may.reason);
    }
    const may = mayAct(ctx, party, org, "org.govern");
    if (!may.ok) return refuse("not_allowed", may.reason);
    const votes = optionalQuery(ctx, "economy.decide")?.(ctx, org, party, "Changing the structure of") ?? null;
    if (votes !== null) return refuse("votes", votes);
  }
  const change = optionalService(ctx, "economy.restructure");
  if (!change) return refuse("no_money", "a company's structure needs the economy");
  const events = change(ctx, org, structure);
  if (!Array.isArray(events) || events.length === 0) return events;
  const from = events.flatMap((e) => (e.type === "set" && e.field === "structure_from" && typeof e.value === "string" ? [e.value] : []))[0] ?? "";
  const text = `Became ${STRUCTURE_WORDS[structure] ?? structure}${from !== "" ? `, taxed as one from ${dateWords(ctx, from)}` : ""}`;
  return [...events, orgLog(ctx, org, text, by !== "" ? { by } : {}), ...(party !== by && party !== org ? [orgLog(ctx, party, `${labelOf(ctx, org)}: ${text}`, { by, names: [org] })] : [])];
}

/** Founding and changing structure (§3.13, §3.17 `org_found`, `org_restructure`): their effects and actions, each played as a turn (§4.6). */
export function registerFound(r: CoreRegistry): void {
  // GM effects too (§7.2), so the GM and agents' org ops found and restructure: the founder named as `by` (a person) or `founder` (an organization), no power or votes asked without `by`'s power to check.
  r.effect({ type: "orgs.found", args: ["type", "name", "kind?", "cents?", "from?", "structure?", "units?", "classes?", "founder?", "by?"], gm: true, resolve: (a, ctx) => foundEvents(ctx, a) });
  r.effect({ type: "orgs.restructure", args: ["org", "structure", "party?", "by?"], gm: true, resolve: (a, ctx) => restructureEvents(ctx, a) });
  r.action({
    id: ORG_ACTIONS.found,
    label: "Start an organization",
    description: `Found a company (from Money ${COMPANY_LEVEL}: you its only owner, with capital from an account of yours, counted in units when you say how many; or, for an organization you govern, its subsidiary from its money) or a group of one of the world's kinds, which you lead.`,
    pack: "orgs",
    params: {
      type: { type: "text", label: "company or group" },
      name: { type: "text", label: "Its name" },
      kind: { type: "text", optional: true, label: "A group's kind" },
      amount: { type: "money", optional: true, label: "A company's capital" },
      from: { type: "ref", ref: "account", optional: true, label: "Capital from" },
      structure: { type: "text", optional: true, label: `A company's structure (${STRUCTURES.join(", ")})` },
      units: { type: "number", optional: true, label: "A company's units (its shares counted in them)" },
      as: { type: "ref", optional: true, of: { kind: ["business", "household", "group", "trust"] }, acting: "org.govern", label: "Founding as: an organization you govern, only when the input starts a company for it (\"the shop starts a towing arm\"); left out, it's yours" },
    },
    requires: ["params.as == null or may(actor, params.as, 'org.govern')"],
    outcomes: { default: [{ type: "orgs.found", args: { type: "=params.type", name: "=params.name", kind: "=params.kind", cents: "=params.amount", from: "=params.from", structure: "=params.structure", units: "=params.units", founder: "self", by: "actor" } }] },
    duration: "30",
    lexicon: ["start a company", "found a business", "set up a company", "start a group", "found a club", "form a crew", "start a subsidiary"],
    observable: "sets up something new",
  });
  r.action({
    id: ORG_ACTIONS.restructure,
    label: "Change structure",
    description: "Change a company's legal structure (a sole proprietorship, a partnership, an LLC, an S or a C corporation): draws and payouts change at once, its taxes from the next estimated-tax period.",
    pack: "orgs",
    params: {
      org: { type: "ref", ref: COMPANY_KIND, label: "Company" },
      structure: { type: "text", label: `Structure (${STRUCTURES.join(", ")})` },
      as: { type: "ref", optional: true, of: { kind: ["business", "household", "group", "trust"] }, acting: "org.govern", label: "Deciding as: an organization you govern that holds the company's shares; left out, it's your own votes" },
    },
    requires: ["level.money >= 3", "may(self, org, 'org.govern')", "params.as == null or may(actor, params.as, 'org.govern')"],
    outcomes: { default: [{ type: "orgs.restructure", args: { org: "org", structure: "=params.structure", party: "self", by: "actor" } }] },
    duration: "30",
    lexicon: ["incorporate", "become an LLC", "change the company's structure", "turn it into a corporation"],
    observable: "signs incorporation papers",
  });
}
