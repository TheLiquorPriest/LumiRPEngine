// The party as an organization (ORG-SPEC §3.12, §4.5; assess-party §6.1). Its roster is the
// `travels_with` links to its leader, the player character, each in a tier; its entity
// (`party_<leader>`, kind `party`) is made only when the party needs a name, a purse or a thing of
// its own. The leader's actions here are each one effect, so one unit (L41): `party_tier` (someone
// they know added in a tier, their tier changed, or taken out), `party_name`, `party_purse` (an
// account the party owns, opened with the leader's deposit) and `party_hire` (Hire a hand: a job
// the party employs, and the hired tier). The party's section of its page reads the roster with
// where each is as the reader knows it, whom the leader may add, its purse, whom a share-out pays
// (the economy's `org_share_out` pays them), and the hired hands whose job with the party has
// ended, each offered a way out of it.

import type { EntityId } from "../../../shared/ids";
import type { JsonObject, JsonValue } from "../../../shared/json";
import type { LedgerEvent } from "../../../shared/ledger";
import { isPartyTier, PARTY_KIND, PARTY_OUT, PARTY_RELATION, PARTY_SECTION, PARTY_TIERS, partyTierIn, TIER_NOUNS, type PartyCan, type PartySectionView, type PartyTier } from "../../../shared/party";
import { formatMoney } from "../../../shared/world";
import { acts } from "../../../engine/life";
import { mayAct, membersOfOrg } from "../../../engine/org";
import { labelOf, numOf, optionalService, own, strOf } from "../../../engine/pack-kit";
import { povMayKnow } from "../../../engine/player-events";
import type { CoreRegistry, EffectContext, ReadContext, Rejection } from "../../../engine/registry";
import { linkEvents, unlinkEvents } from "../../../engine/relations";
import { isGone, kindIs, placeOfEntity } from "../../../engine/scope";
import { together } from "../../../engine/presence";
import { lastSighting } from "../../../engine/seen";
import { canSeeEntity, canSeeField, canSeePlace } from "../../../engine/visibility";
import { Working } from "../../../engine/working";
import { fundingSources, today } from "./found";
import { orgLog } from "./log";
import { partyIdOf } from "./view";

/** The tiers a share-out pays (§3.8). */
const SHARES: readonly PartyTier[] = ["core", "companion"];

/** The longest name a party takes. */
const NAME_MAX = 60;

/** The Money level a purse needs (accounts, §4.7), and a hand (jobs). */
const PURSE_LEVEL = 2;
const HIRE_LEVEL = 3;

function refuse(code: string, reason: string): Rejection {
  return { code, reason };
}

/** "a companion", "an ally". */
function aTier(tier: PartyTier): string {
  const noun = TIER_NOUNS[tier][0];
  return `${/^[aeiou]/.test(noun) ? "an" : "a"} ${noun}`;
}

/** Why `by` may not act as the party's leader here, or null when they lead it. */
function notLeader(ctx: ReadContext, by: EntityId | null): string | null {
  return by === ctx.world.pov ? null : "Only the party's leader may do that";
}

/** Someone in the party in a share-out's tiers, in id order: whom `org_share_out` pays for the party. */
export function shareOutRecipients(ctx: ReadContext, party: EntityId): EntityId[] {
  return [...new Set(membersOfOrg(ctx, party).filter((r) => SHARES.includes(r.how as PartyTier)).map((r) => r.who))].sort();
}

// ---------------------------------------------------------------- the leader's acts

/** Someone added to the party in a tier, their tier changed (keeping since when), or taken out (`out`). */
function tierEvents(ctx: EffectContext, by: EntityId, who: EntityId, tier: string): LedgerEvent[] | Rejection {
  const pov = ctx.world.pov;
  if (by !== pov) return refuse("not_leader", "Only the party's leader changes who is in it");
  if (who === pov) return refuse("bad_party", "You lead the party");
  const e = own(ctx.state.entities, who);
  if (!e || isGone(ctx.state, who) || !kindIs(ctx.registry, ctx.world, e.kind, "person") || !povMayKnow(ctx.registry, ctx.world, ctx.state, who)) return refuse("missing_entity", `no person ${labelOf(ctx, who)}`);
  const party = partyIdOf(ctx).id;
  const now = partyTierIn(e.relations, pov);
  if (tier === PARTY_OUT) {
    if (now === null) return refuse("not_in_party", `${e.name} isn't in your party`);
    return [...unlinkEvents(ctx.registry, ctx.world, ctx.state, { rel: PARTY_RELATION, from: who, to: pov }), orgLog(ctx, party, `${labelOf(ctx, by)} took ${e.name} out of the party.`, { by, names: [by, who] })];
  }
  if (!isPartyTier(tier)) return refuse("bad_tier", `a tier is one of ${PARTY_TIERS.join(", ")}, or ${PARTY_OUT}`);
  if (now === tier) return refuse("unchanged", `${e.name} is already ${aTier(tier)} of the party`);
  const linked = linkEvents(ctx.registry, ctx.world, ctx.state, { rel: PARTY_RELATION, from: who, to: pov, fields: { tier, since: sinceOf(ctx, who) } });
  if (!Array.isArray(linked)) return linked;
  const text = now === null ? `${labelOf(ctx, by)} added ${e.name} to the party as ${aTier(tier)}.` : `${labelOf(ctx, by)} made ${e.name} ${aTier(tier)} of the party.`;
  return [...linked, orgLog(ctx, party, text, { by, names: [by, who] })];
}

/** Since when `who` has been in the player character's party: their link's own date, else today. */
function sinceOf(ctx: ReadContext, who: EntityId): string {
  const since = own(ctx.state.entities, who)?.relations.find((r) => r.type === PARTY_RELATION && r.to === ctx.world.pov)?.fields?.since;
  return typeof since === "string" && since !== "" ? since : today(ctx);
}

/** The party's entity spawned for its leader, in the leader's tier so its money runs at their level, named, or "<first name>'s party". */
function spawnParty(ctx: ReadContext, id: EntityId, name?: string): LedgerEvent {
  const pov = ctx.world.pov;
  const leader = own(ctx.state.entities, pov);
  const first = (leader?.name ?? pov).split(/\s+/)[0] || pov;
  return { type: "spawn", entity: { id, kind: PARTY_KIND, name: name ?? `${first}'s party`, tier: leader?.tier ?? "background", fields: { leader: pov }, relations: [] } };
}

/** Name the party: its entity made with the name, or its name changed. */
function nameEvents(ctx: EffectContext, by: EntityId, raw: string): LedgerEvent[] | Rejection {
  if (notLeader(ctx, by)) return refuse("not_leader", "Only the party's leader names it");
  const name = raw.replace(/\s+/g, " ").trim();
  if (name === "" || name.length > NAME_MAX) return refuse("bad_name", `a party's name is 1–${NAME_MAX} characters`);
  const party = partyIdOf(ctx);
  const was = own(ctx.state.entities, party.id)?.name;
  if (party.exists && was === name) return refuse("unchanged", `the party is already called ${name}`);
  const named: LedgerEvent = party.exists ? { type: "engine.rename", data: { entity: party.id, name, was: was ?? party.id } } : spawnParty(ctx, party.id, name);
  return [named, orgLog(ctx, party.id, `${labelOf(ctx, by)} named the party ${name}.`, { by, names: [by] })];
}

/**
 * Start a purse: the party's entity made if it has none, an account it owns opened, and the
 * leader's deposit paid into it from `from` (else their first source), worked out on one working
 * state so each part sees the last, and returned as one unit: a rebased view keeps all of it or none.
 */
function purseEvents(ctx: EffectContext, by: EntityId, cents: number, from: EntityId): LedgerEvent[] | Rejection {
  if (notLeader(ctx, by)) return refuse("not_leader", "Only the party's leader starts its purse");
  if (!(cents > 0)) return refuse("bad_amount", "a purse starts with a deposit above nothing");
  const sources = fundingSources(ctx, by);
  const source = from === "" ? sources[0]?.id : sources.find((s) => s.id === from)?.id;
  if (source === undefined) return refuse("no_source", from === "" ? "You have no account to start a purse from" : `${labelOf(ctx, from)} isn't an account of yours a purse can start from`);
  const w = new Working(ctx.registry, ctx.world, ctx.state);
  const party = partyIdOf(w.ctx);
  if (party.exists && purseAccount(w.ctx, party.id)) return refuse("exists", `${labelOf(ctx, party.id)} already has a purse`);
  const apply = (events: readonly LedgerEvent[]): Rejection | null => {
    for (const ev of events) {
      const failed = w.apply(ev);
      if (failed) return failed;
    }
    return null;
  };
  const open = optionalService(w.ctx, "economy.open_account");
  const pay = optionalService(w.ctx, "economy.transfer");
  if (!open || !pay) return refuse("no_money", "a purse needs the economy");
  const spawned = party.exists ? null : apply([spawnParty(w.ctx, party.id)]);
  if (spawned) return spawned;
  const opened = open(w.ctx, { name: "Party purse", product: "checking", owners: [{ party: party.id, role: "owner" }] });
  if (!Array.isArray(opened)) return opened;
  const failed = apply(opened);
  if (failed) return failed;
  const account = opened.find((ev): ev is Extract<LedgerEvent, { type: "spawn" }> => ev.type === "spawn")?.entity.id;
  if (account === undefined) return refuse("no_account", "the purse didn't open");
  const paid = pay(w.ctx, source, account, cents, `Into ${labelOf(w.ctx, party.id)}'s purse`);
  if (!Array.isArray(paid)) return paid;
  const short = apply(paid);
  if (short) return short;
  const logged = apply([orgLog(w.ctx, party.id, `${labelOf(ctx, by)} started the party's purse with ${formatMoney(cents, ctx.world.currency)}.`, { by, names: [by] })]);
  return logged ?? w.events;
}

/** The party's purse: the first account it owns, by id, that is open. */
function purseAccount(ctx: ReadContext, party: EntityId): EntityId | null {
  return (
    Object.keys(ctx.state.entities)
      .sort()
      .find((id) => {
        const e = own(ctx.state.entities, id);
        return e?.kind === "account" && !isGone(ctx.state, id) && strOf(e.fields.status, "open") === "open" && Array.isArray(e.fields.owners) && e.fields.owners.some((o) => typeof o === "object" && o !== null && !Array.isArray(o) && (o as JsonObject).party === party);
      }) ?? null
  );
}

/** Hire a hand (§3.12): the economy's hire with the party as employer, and the hired tier, in one unit. */
function hireEvents(ctx: EffectContext, by: EntityId, args: Record<string, JsonValue>): LedgerEvent[] | Rejection {
  if (notLeader(ctx, by)) return refuse("not_leader", "Only the party's leader hires for it");
  const party = partyIdOf(ctx);
  if (!party.exists || !purseAccount(ctx, party.id)) return refuse("no_purse", "Start a purse first: the party pays its hands from it");
  const worker = strOf(args.worker);
  if (worker === ctx.world.pov) return refuse("bad_party", "You lead the party");
  const may = mayAct(ctx, by, party.id, "staff.hire", { target: worker });
  if (!may.ok) return refuse("not_allowed", may.reason);
  const hire = ctx.registry.effects.get("economy.hire");
  if (!hire) return refuse("no_money", "hiring needs the economy");
  const job: Record<string, JsonValue> = { business: party.id, worker, by };
  for (const k of ["title", "occupation", "basis", "rate", "hours_per_week", "pay_every"] as const) if (args[k] !== undefined && args[k] !== null && args[k] !== "") job[k] = args[k];
  const hired = hire.resolve(job, ctx);
  if (!Array.isArray(hired)) return hired;
  const e = own(ctx.state.entities, worker);
  const tier = e ? partyTierIn(e.relations, ctx.world.pov) : null;
  const linked = tier === "hired" ? [] : linkEvents(ctx.registry, ctx.world, ctx.state, { rel: PARTY_RELATION, from: worker, to: ctx.world.pov, fields: { tier: "hired", since: sinceOf(ctx, worker) } });
  if (!Array.isArray(linked)) return linked;
  return [...hired, ...linked, orgLog(ctx, party.id, `${labelOf(ctx, by)} hired ${labelOf(ctx, worker)} as a hand.`, { by, names: [by, worker] })];
}

// ---------------------------------------------------------------- the party's section

/** Where someone is as `viewer` knows it, when not with them: their place's name, else where they were last seen, else null. */
function whereOf(ctx: ReadContext, viewer: EntityId, who: EntityId): string | null {
  const { registry: reg, world, state } = ctx;
  const place = placeOfEntity(state, who);
  if (place !== null && canSeeField(reg, world, state, viewer, who, "place") && canSeePlace(reg, world, state, viewer, place)) return own(world.places, place)?.name ?? place;
  const last = viewer === world.pov ? lastSighting(state, who) : null;
  return last && canSeePlace(reg, world, state, viewer, last.place) ? `last seen at ${own(world.places, last.place)?.name ?? last.place}` : null;
}

/** The jobs the party employs `who` in: each one's id and whether it has ended. */
function partyJobs(ctx: ReadContext, party: EntityId, who: EntityId): { id: EntityId; ended: boolean }[] {
  return Object.keys(ctx.state.entities)
    .sort()
    .flatMap((id) => {
      const e = own(ctx.state.entities, id);
      return e?.kind === "job" && e.fields.worker === who && e.fields.employer === party && !isGone(ctx.state, id) ? [{ id, ended: e.fields.status === "ended" }] : [];
    });
}

/** What `viewer` may do on the party's page now, each null when they may, else why not. */
function canOf(ctx: ReadContext, party: { id: EntityId; exists: boolean }, viewer: EntityId | null, purse: EntityId | null, shares: number): PartyCan {
  const lead = notLeader(ctx, viewer);
  const level = viewer === null ? 0 : ctx.levelOf(viewer, "money");
  return {
    manage: lead,
    name: lead,
    purse: lead ?? (purse !== null ? "The party has a purse" : level < PURSE_LEVEL ? "A purse needs money in play (Money 2)" : null),
    hire: lead ?? (purse === null ? "Start a purse first: the party pays its hands from it" : level < HIRE_LEVEL ? "Hiring needs jobs in play (Money 3)" : null),
    shareOut: lead ?? (purse === null ? "Start a purse first" : shares === 0 ? "Share out pays core members and companions, and the party has none" : party.exists && viewer !== null && mayAct(ctx, viewer, party.id, "money.payout").ok ? null : "Only the party's leader shares out its money"),
  };
}

/** The party's section of its page, as `viewer` may see it (the GM, null, sees everyone); null for anything but the party. */
export function partySection(ctx: ReadContext, org: EntityId, viewer: EntityId | null): PartySectionView | null {
  const party = partyIdOf(ctx);
  if (org !== party.id) return null;
  const pov = ctx.world.pov;
  const seen = (id: EntityId): boolean => viewer === null || id === viewer || canSeeEntity(ctx.registry, ctx.world, ctx.state, viewer, id);
  const name = (id: EntityId): string => own(ctx.state.entities, id)?.name ?? id;
  const at = placeOfEntity(ctx.state, viewer ?? pov);
  const members = Object.keys(ctx.state.entities)
    .sort()
    .flatMap((id) => {
      const tier = id === pov || isGone(ctx.state, id) ? null : partyTierIn(own(ctx.state.entities, id)?.relations, pov);
      return tier !== null && seen(id) ? [{ id, tier, where: together(ctx.world, at, placeOfEntity(ctx.state, id)) ? null : whereOf(ctx, viewer ?? pov, id) }] : [];
    });
  const inParty = new Set(members.map((m) => m.id));
  const candidates =
    viewer === pov
      ? Object.keys(ctx.state.entities)
          .filter((id) => {
            const e = own(ctx.state.entities, id);
            return !!e && id !== pov && !inParty.has(id) && partyTierIn(e.relations, pov) === null && kindIs(ctx.registry, ctx.world, e.kind, "person") && !isGone(ctx.state, id) && acts(ctx.world, ctx.state, id) && povMayKnow(ctx.registry, ctx.world, ctx.state, id);
          })
          .map((id) => ({ id, name: name(id) }))
          .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
      : [];
  const offers = members.flatMap((m) => {
    if (m.tier !== "hired") return [];
    const jobs = partyJobs(ctx, party.id, m.id);
    const ended = jobs.find((j) => j.ended);
    return ended && jobs.every((j) => j.ended) ? [{ id: m.id, name: name(m.id), job: ended.id }] : [];
  });
  const account = party.exists ? purseAccount(ctx, party.id) : null;
  const sees = account !== null && (viewer === null || mayAct(ctx, viewer, party.id, "money.view").ok);
  const shares = party.exists ? shareOutRecipients(ctx, party.id).filter(seen) : members.filter((m) => SHARES.includes(m.tier)).map((m) => m.id);
  return {
    id: party.id,
    exists: party.exists,
    leader: { id: pov, name: name(pov) },
    members,
    candidates,
    offers,
    purse: sees && account !== null ? { account, name: name(account), balance: formatMoney(numOf(ctx.state.accounts[account]), ctx.world.currency) } : null,
    sources: viewer === pov && account === null ? fundingSources(ctx, pov) : [],
    shareOut: shares.map((id) => ({ id, name: name(id) })),
    can: canOf(ctx, party, viewer, account, shares.length),
  };
}

// ---------------------------------------------------------------- registration

/** The party's actions and their effects (§3.17: `party_tier`, `party_name`, `party_purse`; Hire a hand), and its section. */
export function registerParty(r: CoreRegistry): void {
  r.effect({ type: "orgs.party_tier", args: ["who", "tier", "by?"], resolve: (a, ctx) => tierEvents(ctx, strOf(a.by) || ctx.world.pov, strOf(a.who), strOf(a.tier)) });
  r.effect({ type: "orgs.party_name", args: ["name", "by?"], resolve: (a, ctx) => nameEvents(ctx, strOf(a.by) || ctx.world.pov, strOf(a.name)) });
  r.effect({ type: "orgs.party_purse", args: ["cents", "from?", "by?"], resolve: (a, ctx) => purseEvents(ctx, strOf(a.by) || ctx.world.pov, Math.round(numOf(a.cents)), strOf(a.from)) });
  r.effect({ type: "orgs.party_hire", args: ["worker", "title?", "occupation?", "basis?", "rate?", "hours_per_week?", "pay_every?", "by?"], resolve: (a, ctx) => hireEvents(ctx, strOf(a.by) || ctx.world.pov, a) });
  // The leader's own bookkeeping, done alone: a tap on the party's page with no words records it at once, with its Undo (§4.6).
  const directive = { duration: "1", mechanical: true, observable: "sorts out who travels with them", pack: "orgs" } as const;
  r.action({
    id: "party_tier",
    label: "Party tier",
    description: `Add someone you know to your party in a tier (${PARTY_TIERS.join(", ")}), change their tier, or take them out of the party (${PARTY_OUT}).`,
    params: { who: { type: "ref", ref: "person" }, tier: { type: "text", label: `${PARTY_TIERS.join(", ")} or ${PARTY_OUT}` } },
    requires: [],
    outcomes: { default: [{ type: "orgs.party_tier", args: { who: "who", tier: "=params.tier", by: "self" } }] },
    lexicon: ["join my party", "travel with me from now on", "leave the party"],
    ...directive,
  });
  r.action({
    id: "party_name",
    label: "Name the party",
    description: "Give your party a name.",
    params: { name: { type: "text", label: "Its name" } },
    requires: [],
    outcomes: { default: [{ type: "orgs.party_name", args: { name: "=params.name", by: "self" } }] },
    lexicon: ["call our party", "name our group"],
    ...directive,
  });
  r.action({
    id: "party_purse",
    label: "Start a purse",
    description: "Open an account your party owns, with a deposit from an account of your own.",
    params: { amount: { type: "money", label: "Your deposit" }, from: { type: "ref", ref: "account", optional: true, label: "From" } },
    requires: ["amount > 0", `level.money >= ${PURSE_LEVEL}`],
    outcomes: { default: [{ type: "orgs.party_purse", args: { cents: "=amount", from: "=params.from", by: "self" } }] },
    lexicon: ["start a party purse", "pool our money", "a kitty for the party"],
    ...directive,
  });
  r.action({
    id: "party_hire",
    label: "Hire a hand",
    description: "Hire someone for your party, paid from its purse; they join it as a hired hand.",
    pack: "orgs",
    params: { worker: { type: "ref", ref: "person" }, title: { type: "text", optional: true }, basis: { type: "text", optional: true, label: "Pay basis" }, rate: { type: "money", optional: true, label: "Pay rate" }, hours_per_week: { type: "number", optional: true }, pay_every: { type: "text", optional: true, label: "Paid every" } },
    requires: [`level.money >= ${HIRE_LEVEL}`],
    outcomes: { default: [{ type: "orgs.party_hire", args: { worker: "worker", title: "=params.title", basis: "=params.basis", rate: "=params.rate", hours_per_week: "=params.hours_per_week", pay_every: "=params.pay_every", by: "self" } }] },
    duration: "15",
    lexicon: ["hire a hand", "take on a hand", "hire them for the party"],
    observable: "talks business",
  });
  r.orgSection({ id: PARTY_SECTION, label: "Party", build: (ctx, org, viewer) => partySection(ctx, org, viewer) as unknown as JsonValue });
}
