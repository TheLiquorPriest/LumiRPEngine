// Founding an organization (ORG-SPEC §3.13; Orgs → Start something…, §4.2), and changing a
// company's structure: `org_found` and `org_restructure`, each played as a turn, its one effect one
// unit (L41). A company, from Money 3: the business spawned with its founder as its only owner
// (counting its stake in units of its classes when asked, §3.10), a business checking account it owns
// opened, and the founder's capital moved into it. A founder may be an organization, acting `as`
// itself through whoever governs it: a company starting a subsidiary from its own money, settling a
// trust or starting a nonprofit, the money it puts into either spent as the actor's money powers
// there allow. A trust settled (DESIGN §29.1 Trusts), from Money 3: its trustee and
// beneficiary (each its settlor unless named), its terms, its trustees' one vote each, a trust account
// it owns and what its settlor puts in. A nonprofit (§29.1 Nonprofits), from Money 3: a company of
// structure `nonprofit` with no owners of its worth, its founder seated as its Director, an account
// it owns and the founder's gift into it. A group of one of the world's group kinds: the group
// spawned with a Leader position that holds every power, the founder in it as its Leader. A change of
// structure needs `org.govern` and more than half the votes; its tax treatment follows from the next
// estimated-tax period (the economy's `economy.restructure`).

import type { EntityId } from "../../../shared/ids";
import type { JsonObject, JsonValue } from "../../../shared/json";
import type { LedgerEvent } from "../../../shared/ledger";
import { CLASS_TRAITS, classesIn, FINANCE_EVENTS, listingIn, ROLE_RIGHTS, STRUCTURE_WORDS, type AccountClass } from "../../../shared/finance";
import { DIRECTOR, NONPROFIT_STRUCTURE, ORG_ACTIONS, ORG_POWERS, type Position } from "../../../shared/org";
import { VOTE_PARAM } from "../../../shared/org-motions";
import type { OrgStartView } from "../../../shared/org-view";
import { PARTY_KIND } from "../../../shared/party";
import { formatMoney } from "../../../shared/world";
import { calendarOf, dateAt } from "../../../engine/calendar";
import { LEADER, mayAct, orgTypeOf, spendMonth } from "../../../engine/org";
import { labelOf, numOf, optionalQuery, optionalService, own, strOf } from "../../../engine/pack-kit";
import type { CoreRegistry, EffectContext, ReadContext, Rejection } from "../../../engine/registry";
import { linkEvents } from "../../../engine/relations";
import { isGone, kindDef, kindIs } from "../../../engine/scope";
import { COMPANY_KIND, GROUP_KIND, MEMBER_OF, TRUST_KIND } from "../../../engine/selector";
import { Working } from "../../../engine/working";
import { orgLog, ORGS_SPENT } from "./log";
import { putToVote } from "./motions";
import { dateWords } from "./view";

/** The Money level a company, a trust or a nonprofit needs (payroll, books and property, §4.7). */
const COMPANY_LEVEL = 3;

/** The longest name a founded organization takes. */
const NAME_MAX = 60;

/** A company's structures, the first the default (AGENT-GUIDE: `llc` when left out); a nonprofit is founded as one, never restructured into or out of. */
const STRUCTURES = ["llc", "sole_proprietorship", "partnership", "s_corp", "c_corp"] as const;

/** What an organization founds: a company, a trust it settles or a nonprofit; a group is founded by its people. */
const FOUNDED_BY_ORGS = ["company", "trust", "nonprofit"] as const;

/** The kinds that are an organization of their own type, never a group a founder starts as one. */
const NOT_GROUPS = [COMPANY_KIND, "household", TRUST_KIND, PARTY_KIND] as const;

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

/** Why `who` may not start `what` now (Money 3), or null when they may. */
function startRefusal(ctx: ReadContext, who: EntityId, what: string): string | null {
  return ctx.levelOf(who, "money") < COMPANY_LEVEL ? `${what} needs payroll and books in play (Money ${COMPANY_LEVEL})` : null;
}

/** What Orgs' Start something… offers `who` (§4.2): a company, a trust and a nonprofit, each with the accounts what goes into it may come from, and a group of one of the world's group kinds (null when it has none). */
export function startOptions(ctx: ReadContext, who: EntityId): OrgStartView {
  const kinds = groupKinds(ctx);
  const sources = fundingSources(ctx, who);
  return {
    company: { why: startRefusal(ctx, who, "Starting a company"), sources },
    trust: { why: startRefusal(ctx, who, "Settling a trust"), sources },
    nonprofit: { why: startRefusal(ctx, who, "Starting a nonprofit"), sources },
    group: kinds.length > 0 ? { kinds } : null,
  };
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

/** Who founds an organization: a person, or an organization (`founder`) acting through `by`; its name; and what they put in and from where. */
interface Founding {
  by: EntityId;
  founder: EntityId;
  name: string;
  cents: number;
  from: EntityId;
}

/** What founding a company asks besides: its structure, and its units and classes when asked. */
interface Company extends Founding {
  structure: string;
  units: number | undefined;
  classes: JsonValue | undefined;
}

/** What settling a trust asks besides (§29.1 Trusts): its trustee and beneficiary, and its terms. */
interface Trust extends Founding {
  trustee: EntityId;
  beneficiary: EntityId;
  revocable: boolean;
  purpose: string;
  until: string;
}

function applyAll(w: Working, events: readonly LedgerEvent[]): Rejection | null {
  for (const ev of events) {
    const failed = w.apply(ev);
    if (failed) return failed;
  }
  return null;
}

/** The founder's account what they put in comes from: `from` among their funding sources, else their first; why not when there is none. */
function sourceOf(ctx: ReadContext, f: Founding, what: string): EntityId | Rejection {
  const sources = fundingSources(ctx, f.founder);
  const source = f.from === "" ? sources[0]?.id : sources.find((s) => s.id === f.from)?.id;
  const whose = f.founder === f.by ? "of yours" : `of ${labelOf(ctx, f.founder)}'s`;
  return source ?? refuse("no_source", f.from === "" ? `${f.founder === f.by ? "You have" : `${labelOf(ctx, f.founder)} has`} no account to put ${what} in from` : `${labelOf(ctx, f.from)} isn't an account ${whose} ${what} can come from`);
}

/**
 * A founded organization's account, opened on `w` (`product`, else plain checking where the world
 * has none), owned by it with `users` authorized on it; and `f.cents` moved into it from `source`
 * (none when it is nothing), filed under `category`, its posting naming who moved it for an
 * organization founder (§3.6). The account's id, or why not.
 */
function openAndFund(ctx: EffectContext, w: Working, f: Founding, o: { org: EntityId; label: string; product: string; users: readonly EntityId[]; source: EntityId | null; category: string; memo: string }): EntityId | Rejection {
  const open = optionalService(ctx, "economy.open_account");
  const pay = optionalService(ctx, "economy.transfer");
  if (!open || !pay) return refuse("no_money", `${f.name} needs the economy`);
  const owners = [{ party: o.org, role: "owner" as const }, ...o.users.map((party) => ({ party, role: "authorized_user" as const }))];
  const product = (p: string) => open(w.ctx, { name: `${f.name} ${o.label}`, product: p, owners });
  const tried = product(o.product);
  const opened = !Array.isArray(tried) && tried.code === "bad_product" ? product("checking") : tried;
  if (!Array.isArray(opened)) return opened;
  const failed = applyAll(w, opened);
  if (failed) return failed;
  const account = opened.find((ev): ev is Extract<LedgerEvent, { type: "spawn" }> => ev.type === "spawn")?.entity.id;
  if (account === undefined) return refuse("no_account", `${f.name}'s account didn't open`);
  if (o.source === null || f.cents <= 0) return account;
  const paid = pay(w.ctx, o.source, account, f.cents, o.memo);
  if (!Array.isArray(paid)) return paid;
  const stamp: JsonObject = f.founder === f.by || f.by === "" ? {} : { by: f.by, as: f.founder };
  return applyAll(w, paid.map((e): LedgerEvent => (e.type === FINANCE_EVENTS.txn && "data" in e ? { ...e, data: { ...e.data, category: o.category, ...stamp } } : e))) ?? account;
}

/** The History lines of a founding: the new organization's, and, founded by an organization, that one's too. */
function foundedLines(w: Working, f: Founding, id: EntityId, text: string, theirs: string): LedgerEvent[] {
  const by = f.by !== "" ? { by: f.by } : {};
  return f.founder === f.by ? [orgLog(w.ctx, id, text, { by: f.by, names: [f.by] })] : [orgLog(w.ctx, id, text, { ...by, names: [f.founder] }), orgLog(w.ctx, f.founder, theirs, by)];
}

/**
 * What an organization founder's money into a trust or a nonprofit asks of `by` (§3.4): the money
 * leaves it, so `by` spends it as their money powers there allow (each payment, the month, the
 * account it comes from), never for themselves or theirs where they only manage it (the fiduciary
 * rule; `beneficiary`, whom a trust is for), and it counts toward their month. Why not, or what it
 * records; nothing for the GM's act, a person's own money, or nothing put in. A subsidiary stays its
 * founder's, so its capital asks only `org.govern`.
 */
function spending(ctx: ReadContext, f: Founding, source: EntityId | null, beneficiary?: EntityId): LedgerEvent[] | Rejection {
  if (f.by === "" || f.founder === f.by || f.cents <= 0) return [];
  const may = mayAct(ctx, f.by, f.founder, "money.spend", { amount: f.cents, ...(source !== null ? { account: source } : {}), ...(beneficiary !== undefined && beneficiary !== f.founder ? { target: beneficiary } : {}) });
  if (!may.ok) return refuse("not_allowed", may.reason);
  return [{ type: ORGS_SPENT, data: { org: f.founder, who: f.by, month: spendMonth(ctx.world, ctx.state.clock), cents: f.cents, visibility: "secret" } }];
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
  const refused = startRefusal(ctx, c.founder, "Starting a company");
  if (refused) return refuse("level", refused);
  if (!(c.cents > 0)) return refuse("bad_amount", "a company starts with capital above nothing");
  if (!STRUCTURES.some((s) => s === c.structure)) return refuse("bad_structure", `a company's structure is one of ${STRUCTURES.join(", ")}`);
  if (c.units !== undefined && !(Number.isSafeInteger(c.units) && c.units > 0)) return refuse("bad_amount", "a company counts its shares in a whole number of units");
  const classes = c.classes === undefined ? null : classesIn({ share_classes: c.classes });
  const source = sourceOf(ctx, c, "capital");
  if (typeof source !== "string") return source;
  const w = new Working(ctx.registry, ctx.world, ctx.state);
  const id = freshId(ctx, c.name, "_co");
  const founder = own(ctx.state.entities, c.founder);
  const fields: JsonObject = { owners: [{ party: c.founder, role: "owner", share: 100, ...(c.units !== undefined ? { units: c.units } : {}), ...(classes && c.units !== undefined && classes[0] ? { class: classes[0].id } : {}) }], structure: c.structure };
  if (classes) fields.share_classes = classes.map((k) => ({ id: k.id, label: k.label, votes: k.votes }));
  const spawned = applyAll(w, [{ type: "spawn", entity: { id, kind: COMPANY_KIND, name: c.name, tier: founder?.tier ?? "background", fields, relations: [] } }]);
  if (spawned) return spawned;
  // An S corporation's one holder, its founder, as its taxes allow (DESIGN §26.3; the taxes module's check).
  const scorp = optionalService(w.ctx, "economy.scorp_holders")?.(w.ctx, id, [c.founder]) ?? null;
  if (scorp) return scorp;
  // Capital, not income: filed under investment, so neither side's books count it as profit (DESIGN §26.2).
  const account = openAndFund(ctx, w, c, { org: id, label: "checking", product: "business_checking", users: [c.founder], source, category: "investment", memo: `Capital into ${c.name}` });
  if (typeof account !== "string") return account;
  const set = applyAll(w, [{ type: "set", entity: id, field: "operating_account", value: account }]);
  if (set) return set;
  // What the founder put in is their basis in it (DESIGN §27.10), as a buyer's price is when shares are issued to them.
  const basis = applyAll(w, [{ type: "economy.acquire", data: { entity: id, party: c.founder, cents: c.cents } }]);
  if (basis) return basis;
  const money = formatMoney(c.cents, ctx.world.currency);
  const logged = applyAll(w, foundedLines(w, c, id, `${labelOf(ctx, c.founder)} founded ${c.name} with ${money}.`, `Started ${c.name}, its subsidiary, with ${money}.`));
  return logged ?? w.events;
}

/** Whether `id` may hold a trust's role or a nonprofit's seat: a person or an organization in the world, not gone. */
function holderOk(ctx: ReadContext, id: EntityId): boolean {
  return own(ctx.state.entities, id) !== undefined && !isGone(ctx.state, id) && (kindIs(ctx.registry, ctx.world, own(ctx.state.entities, id)?.kind ?? "", "person") || orgTypeOf(ctx, id) !== null);
}

/**
 * A trust settled (§29.1 Trusts): spawned with its trustee and its beneficiary (each the settlor
 * unless named; the beneficiary holding all its worth), its settlor and terms, its trustees deciding
 * each on their own and its motions counted one vote a trustee (`vote_by: trustees`, for trusts
 * settled from now on); a trust account it owns; and what the settlor puts in moved into it from
 * `from` (else their first funding source), filed under investment, as no one's income. Settled by
 * an organization (`as`), what goes in is spent as `by`'s money powers allow (`spending`), the
 * posting names who moved it, and both Histories tell it.
 */
function trustEvents(ctx: EffectContext, t: Trust): LedgerEvent[] | Rejection {
  const refused = startRefusal(ctx, t.founder, "Settling a trust");
  if (refused) return refuse("level", refused);
  if (t.cents < 0) return refuse("bad_amount", "what goes into a trust is nothing or more");
  for (const [role, id] of [["trustee", t.trustee], ["beneficiary", t.beneficiary]] as const) if (!holderOk(ctx, id)) return refuse("missing_entity", `no one ${labelOf(ctx, id)} to be its ${role}`);
  if (t.until !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(t.until)) return refuse("bad_date", "a trust ends on a day, YYYY-MM-DD");
  if (t.until !== "" && t.until <= today(ctx)) return refuse("bad_date", "a trust ends after today");
  const source = t.cents > 0 ? sourceOf(ctx, t, "money for it") : null;
  if (source !== null && typeof source !== "string") return source;
  const spent = spending(ctx, t, source, t.beneficiary);
  if (!Array.isArray(spent)) return spent;
  const w = new Working(ctx.registry, ctx.world, ctx.state);
  // "Ellis Family Trust" is `ellis_family_trust`; "The Ellis Fund" is `the_ellis_fund_trust`.
  const id = freshId(ctx, t.name, /\btrust$/i.test(t.name) ? "" : "_trust");
  const settlor = own(ctx.state.entities, t.founder);
  const fields: JsonObject = {
    owners: [
      { party: t.trustee, role: "trustee" },
      { party: t.beneficiary, role: "beneficiary", share: 100 },
    ],
    settlor: t.founder,
    revocable: t.revocable,
    ...(t.purpose !== "" ? { purpose: t.purpose } : {}),
    ...(t.until !== "" ? { until: t.until } : {}),
    trustees_decide: "each",
    vote_by: "trustees",
  };
  const spawned = applyAll(w, [{ type: "spawn", entity: { id, kind: TRUST_KIND, name: t.name, tier: settlor?.tier ?? "background", fields, relations: [] } }]);
  if (spawned) return spawned;
  const account = openAndFund(ctx, w, t, { org: id, label: "trust account", product: "trust", users: [], source, category: "investment", memo: `Into ${t.name}` });
  if (typeof account !== "string") return account;
  const into = t.cents > 0 ? ` with ${formatMoney(t.cents, ctx.world.currency)}` : "";
  const logged = applyAll(w, [...spent, ...foundedLines(w, t, id, `${labelOf(ctx, t.founder)} settled ${t.name}${into}${t.revocable ? ", revocably" : ""}.`, `Settled ${t.name}, a trust${into}.`)]);
  return logged ?? w.events;
}

/**
 * A nonprofit (§29.1 Nonprofits): a company of structure `nonprofit` with no owners of its worth, a
 * Director position holding every power (any number of seats), its founder seated in it (a person
 * by their membership, an organization founding it as its director), an account it owns (a person
 * founder an authorized user), and the founder's gift into it, filed under donations; an
 * organization's gift is spent as `by`'s money powers allow (`spending`).
 */
function nonprofitEvents(ctx: EffectContext, f: Founding): LedgerEvent[] | Rejection {
  const refused = startRefusal(ctx, f.founder, "Starting a nonprofit");
  if (refused) return refuse("level", refused);
  if (f.cents < 0) return refuse("bad_amount", "what goes into a nonprofit is nothing or more");
  const source = f.cents > 0 ? sourceOf(ctx, f, "a gift") : null;
  if (source !== null && typeof source !== "string") return source;
  const spent = spending(ctx, f, source);
  if (!Array.isArray(spent)) return spent;
  const w = new Working(ctx.registry, ctx.world, ctx.state);
  const id = freshId(ctx, f.name, "_org");
  const founder = own(ctx.state.entities, f.founder);
  const director: Position = { id: DIRECTOR, title: "Director", powers: [...ORG_POWERS], seats: 0, scope: "org", successor: "vacant" };
  const fields: JsonObject = { owners: [], structure: NONPROFIT_STRUCTURE, positions: [director as unknown as JsonObject] };
  const spawned = applyAll(w, [{ type: "spawn", entity: { id, kind: COMPANY_KIND, name: f.name, tier: founder?.tier ?? "background", fields, relations: [] } }]);
  if (spawned) return spawned;
  const linked = linkEvents(w.ctx.registry, w.ctx.world, w.ctx.state, { rel: MEMBER_OF, from: f.founder, to: id, fields: { position: DIRECTOR, since: today(ctx) } });
  if (!Array.isArray(linked)) return linked;
  const seated = applyAll(w, linked);
  if (seated) return seated;
  const person = orgTypeOf(ctx, f.founder) === null;
  const account = openAndFund(ctx, w, f, { org: id, label: "checking", product: "business_checking", users: person ? [f.founder] : [], source, category: "donations", memo: `Gift to ${f.name}` });
  if (typeof account !== "string") return account;
  const set = applyAll(w, [{ type: "set", entity: id, field: "operating_account", value: account }]);
  if (set) return set;
  const into = f.cents > 0 ? ` with ${formatMoney(f.cents, ctx.world.currency)}` : "";
  const logged = applyAll(w, [...spent, ...foundedLines(w, f, id, `${labelOf(ctx, f.founder)} founded ${f.name}, a nonprofit${into}, as its Director.`, `Started ${f.name}, a nonprofit${into}, as its Director.`)]);
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
 * `orgs.found`: a company, a trust, a nonprofit or a group, founded by `by` (§3.13), one unit. A
 * `founder` other than `by` is an organization `by` governs (`org.govern`), founding a company of its
 * own (a subsidiary), settling a trust or starting a nonprofit (what it puts into either asking
 * `money.spend` there too); with no `by` (the GM's), an organization founds one with no power asked.
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
    if (!FOUNDED_BY_ORGS.some((t) => t === type)) return refuse("bad_type", `${labelOf(ctx, founder)} founds companies, settles trusts and starts nonprofits; a group is founded by its people`);
    const may = by === "" ? null : mayAct(ctx, by, founder, "org.govern");
    if (may && !may.ok) return refuse("not_allowed", may.reason);
  }
  const name = strOf(args.name).replace(/\s+/g, " ").trim();
  if (name === "" || name.length > NAME_MAX) return refuse("bad_name", `an organization's name is 1–${NAME_MAX} characters`);
  const founding: Founding = { by, founder, name, cents: Math.round(numOf(args.cents)), from: strOf(args.from) };
  if (type === "company") return companyEvents(ctx, { ...founding, structure: strOf(args.structure) || STRUCTURES[0], units: typeof args.units === "number" ? args.units : undefined, classes: args.classes ?? undefined });
  if (type === "trust") return trustEvents(ctx, { ...founding, trustee: strOf(args.trustee) || founder, beneficiary: strOf(args.beneficiary) || founder, revocable: args.revocable === true, purpose: strOf(args.purpose).replace(/\s+/g, " ").trim().slice(0, 300), until: strOf(args.until).trim() });
  if (type === "nonprofit") return nonprofitEvents(ctx, founding);
  if (type === "group") return groupEvents(ctx, by, name, strOf(args.kind));
  return refuse("bad_type", "an organization founded is a company, a trust, a nonprofit or a group");
}

/**
 * `orgs.restructure` (§3.13): a company's new structure, by whoever governs it (`org.govern`) with more
 * than half its votes, deciding as themselves or as an organization holder they govern (`party`); its
 * History line says when its taxes follow. Short of the votes, an action that asks (`vote`) puts it
 * to a vote instead (ORG-SPEC Phase 5, `putToVote`), which carries it out once it passes. With no
 * `by` (the GM), no power or votes asked.
 */
function restructureEvents(ctx: EffectContext, a: Record<string, JsonValue>): LedgerEvent[] | Rejection {
  const org = strOf(a.org);
  if (orgTypeOf(ctx, org) !== "company") return refuse("not_company", `${labelOf(ctx, org)} isn't a company`);
  const structure = strOf(a.structure);
  // A nonprofit has no owners of its worth to hold a company's shares: what it is changes only in Build (DESIGN §29.1 Nonprofits).
  if (structure === NONPROFIT_STRUCTURE || own(ctx.state.entities, org)?.fields.structure === NONPROFIT_STRUCTURE) return refuse("nonprofit", `${labelOf(ctx, org)} ${structure === NONPROFIT_STRUCTURE ? "becomes a nonprofit" : "stops being a nonprofit"} only by changing what it is in Build`);
  // A listed company stays a C corporation while the public holds its units (DESIGN §27.10 Listing).
  if (structure !== "c_corp" && listingIn(own(ctx.state.entities, org)?.fields ?? {})) return refuse("listed", `${labelOf(ctx, org)} is on a market: take it off the market before it stops being a C corporation`);
  const by = strOf(a.by);
  const party = strOf(a.party) || by;
  const voted = ctx.carried?.motion !== undefined && ctx.carried.org === org;
  if (by !== "" && !voted) {
    if (party !== by) {
      const may = mayAct(ctx, by, party, "org.govern");
      if (!may.ok) return refuse("not_allowed", may.reason);
    }
    const may = mayAct(ctx, party, org, "org.govern");
    if (!may.ok) return refuse("not_allowed", may.reason);
    const votes = optionalQuery(ctx, "economy.decide")?.(ctx, org, party, "Changing the structure of") ?? null;
    if (votes !== null) return putToVote(ctx, { org, by, party, text: `Make ${labelOf(ctx, org)} ${STRUCTURE_WORDS[structure] ?? structure}`, why: votes }) ?? refuse("votes", votes);
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
  r.effect({ type: "orgs.found", args: ["type", "name", "kind?", "cents?", "from?", "structure?", "units?", "classes?", "trustee?", "beneficiary?", "revocable?", "purpose?", "until?", "founder?", "by?"], gm: true, resolve: (a, ctx) => foundEvents(ctx, a) });
  r.effect({ type: "orgs.restructure", args: ["org", "structure", "party?", "by?"], gm: true, resolve: (a, ctx) => restructureEvents(ctx, a) });
  r.action({
    id: ORG_ACTIONS.found,
    label: "Start an organization",
    description: `Found a company (from Money ${COMPANY_LEVEL}: you its only owner, with capital from an account of yours, counted in units when you say how many; or, for an organization you govern, its subsidiary from its money), settle a trust (from Money ${COMPANY_LEVEL}: its trustee and beneficiary you unless named, with what you put in), start a nonprofit (from Money ${COMPANY_LEVEL}: no owners, you its Director, with what you give it), or a group of one of the world's kinds, which you lead. An organization you govern may settle a trust or start a nonprofit too.`,
    pack: "orgs",
    params: {
      type: { type: "text", label: "company, trust, nonprofit or group" },
      name: { type: "text", label: "Its name" },
      kind: { type: "text", optional: true, label: "A group's kind" },
      amount: { type: "money", optional: true, label: "A company's capital; what goes into a trust or a nonprofit" },
      from: { type: "ref", ref: "account", optional: true, label: "Paid in from" },
      structure: { type: "text", optional: true, label: `A company's structure (${STRUCTURES.join(", ")})` },
      units: { type: "number", optional: true, label: "A company's units (its shares counted in them)" },
      trustee: { type: "ref", optional: true, of: { kind: ["person", "business", "household", "group", "trust"] }, label: "A trust's trustee (else its settlor)" },
      beneficiary: { type: "ref", optional: true, of: { kind: ["person", "business", "household", "group", "trust"] }, label: "A trust's beneficiary (else its settlor)" },
      revocable: { type: "bool", optional: true, label: "A trust its settlor may take back" },
      purpose: { type: "text", optional: true, label: "What a trust is for" },
      until: { type: "text", optional: true, label: "The day a trust ends (YYYY-MM-DD)" },
      as: { type: "ref", optional: true, of: { kind: ["business", "household", "group", "trust"] }, acting: "org.govern", label: "Founding as: an organization you govern, only when the input starts a company, a trust or a nonprofit for it (\"the shop starts a towing arm\", \"the company sets up a trust\"); left out, it's yours" },
    },
    requires: ["params.as == null or may(actor, params.as, 'org.govern')"],
    outcomes: { default: [{ type: "orgs.found", args: { type: "=params.type", name: "=params.name", kind: "=params.kind", cents: "=params.amount", from: "=params.from", structure: "=params.structure", units: "=params.units", trustee: "=params.trustee", beneficiary: "=params.beneficiary", revocable: "=params.revocable", purpose: "=params.purpose", until: "=params.until", founder: "self", by: "actor" } }] },
    duration: "30",
    lexicon: ["start a company", "found a business", "set up a company", "start a group", "found a club", "form a crew", "start a subsidiary", "settle a trust", "set up a trust", "start a charity", "start a nonprofit", "set up a foundation"],
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
      vote: VOTE_PARAM,
    },
    requires: ["level.money >= 3", "may(self, org, 'org.govern')", "params.as == null or may(actor, params.as, 'org.govern')"],
    outcomes: { default: [{ type: "orgs.restructure", args: { org: "org", structure: "=params.structure", party: "self", by: "actor" } }] },
    duration: "30",
    lexicon: ["incorporate", "become an LLC", "change the company's structure", "turn it into a corporation"],
    observable: "signs incorporation papers",
  });
}
