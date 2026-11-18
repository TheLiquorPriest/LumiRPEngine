// Motions (ORG-SPEC Phase 5; DESIGN §29.19): a decision short of the decider's votes, put to a vote
// instead of refused when its action asks (`vote`), is carried out when the vote passes. The motion
// holds the act itself (the decision's effect with its arguments as evaluated when it was put,
// `EffectContext.effect`) and its voters and their weights, fixed when it opens: by shares for a
// company (`economy.votes`: each unit its class's votes, else each owner's share of its worth, or one
// a holder where it counts by members; a listed company's outside public counted as abstaining), one
// each to the members who are people elsewhere. Its proposer votes for it; standing votes (the
// organization's `vote_rules`) are cast as it opens, or as the voter they follow votes; anyone else
// votes on the page, through the story (the reply's `vote` fact) or by the GM. It is settled as soon
// as the votes not yet cast can't change it, else at its close (`orgs.motions`, each slot): quorum,
// then more than its pass mark of the votes cast for or against. Passing carries the act out again,
// as the company's own decision (`EffectContext.carried`), in the unit of the vote or the close that
// settled it; an act that can't be carried out then fails it. Every record is bookkeeping in
// `packs.orgs.motions`, worded to the player character where they put it or vote.

import { say, wordedParam } from "../../../engine/lines";
import { hashParts } from "../../../shared/hash";
import type { EntityId } from "../../../shared/ids";
import { isRecord, type JsonObject, type JsonValue } from "../../../shared/json";
import type { LedgerEvent, PackEvent } from "../../../shared/ledger";
import { DECISION_ACTIONS, DECISION_EFFECTS, DECISION_FIELDS, DECISION_RANGES, decisionRulesIn, isMotionStatus, isVote, isVoteBasis, isVoteHow, pctWords, settled, STANDING_VOTES, tallyOf, VOTE_WORDS, type CarriedAct, type DecisionRules, type Motion, type MotionStatus, type MotionVote, type StandingVote, type Tally, type VoteHow } from "../../../shared/org-motions";
import { parseOrgOp } from "../../../shared/org-ops";
import type { ParamDef } from "../../../shared/world";
import { calendarOf, formatStamp } from "../../../engine/calendar";
import { mayAct, membersOfOrg, orgTypeOf, trusteesOf } from "../../../engine/org";
import { unlisting } from "../../../engine/engine-pack";
import { labelOf, newestOf, objOf, optionalQuery, own, sliceOf, sliceRecord, strOf } from "../../../engine/pack-kit";
import type { Advice, CoreRegistry, EffectContext, EventTypeDef, ProcessDef, ReadContext, Rejection, PackAction } from "../../../engine/registry";
import type { Rng } from "../../../engine/rng";
import { isGone, kindIs } from "../../../engine/scope";
import { canSeeEntity } from "../../../engine/visibility";
import { Working } from "../../../engine/working";
import { actNames, orgLog } from "./log";
import { compileOrgOp } from "./ops";

export const ORGS_MOTION = "orgs.motion";
export const ORGS_VOTE = "orgs.vote";
export const ORGS_MOTION_END = "orgs.motion_end";
/** Motions kept per organization: every open one (at most 12 at once), and the last 12 closed. */
export const MOTIONS_KEPT = Object.freeze({ open: 12, closed: 12 });

const DAY = 24 * 60;

type Args = Record<string, JsonValue>;

function refuse(code: string, reason: string): Rejection {
  return { code, reason };
}

// ---------------------------------------------------------------- the records

function voteIn(v: JsonValue | undefined): MotionVote | null {
  const o = objOf(v);
  if (!isVote(o.vote)) return null;
  return { vote: o.vote, how: isVoteHow(o.how) ? o.how : "own", at: typeof o.at === "number" ? o.at : 0, ...(strOf(o.by) !== "" ? { by: strOf(o.by) } : {}) };
}

function weightsIn(v: JsonValue | undefined): Record<EntityId, number> {
  const out: Record<EntityId, number> = {};
  for (const [who, w] of Object.entries(objOf(v))) if (typeof w === "number" && Number.isFinite(w) && w > 0) out[who] = w;
  return out;
}

/** A motion as `packs.orgs.motions` keeps it; null when it lacks its id, words or act. */
export function motionIn(raw: JsonValue | undefined): Motion | null {
  if (!isRecord(raw)) return null;
  const what = objOf(raw.what);
  const id = strOf(raw.id);
  const text = strOf(raw.text);
  if (id === "" || text === "" || strOf(what.type) === "") return null;
  const votes: Record<EntityId, MotionVote> = {};
  for (const [who, v] of Object.entries(objOf(raw.votes))) {
    const cast = voteIn(v);
    if (cast) votes[who] = cast;
  }
  const num = (v: JsonValue | undefined, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
  return {
    id,
    text,
    what: { type: strOf(what.type), args: objOf(what.args) },
    by: strOf(raw.by),
    ...(strOf(raw.party) !== "" ? { party: strOf(raw.party) } : {}),
    at: num(raw.at, 0),
    closes: num(raw.closes, 0),
    basis: isVoteBasis(raw.basis) ? raw.basis : "shares",
    quorum: num(raw.quorum, 50),
    pass: num(raw.pass, 50),
    electorate: weightsIn(raw.electorate),
    public: Math.max(0, num(raw.public, 0)),
    votes,
    status: isMotionStatus(raw.status) ? raw.status : "open",
    ...(typeof raw.closed === "number" ? { closed: raw.closed } : {}),
    ...(strOf(raw.why) !== "" ? { why: strOf(raw.why) } : {}),
  };
}

/** An organization's motions, oldest first. */
export function motionsOf(state: ReadContext["state"], org: EntityId): Motion[] {
  const list = objOf(sliceOf(state, "orgs").motions)[org];
  return Array.isArray(list) ? list.flatMap((raw) => motionIn(raw) ?? []) : [];
}

/** The organizations with any motion on record, by id. */
export function orgsWithMotions(state: ReadContext["state"]): EntityId[] {
  return Object.keys(objOf(sliceOf(state, "orgs").motions)).sort();
}

/** The rules an organization's decisions follow now (its fields, the defaults where they set none). */
export function rulesOf(ctx: Pick<ReadContext, "registry" | "world" | "state">, org: EntityId): DecisionRules {
  return decisionRulesIn(own(ctx.state.entities, org)?.fields ?? {}, orgTypeOf(ctx, org) === "company");
}

// ---------------------------------------------------------------- who votes

/**
 * Who votes on `org`'s motions, each with their weight in percent of all the votes, and the votes no
 * one here casts: a company's holders by its decision votes (`economy.votes`), a listed company's
 * outside public the rest; a trust counting by trustees (`vote_by: trustees`, DESIGN §29.1), its
 * trustees who act, one each (an organization trustee's cast by whoever manages its shares); any
 * other organization's members who are people, one each.
 */
export function electorateOf(ctx: ReadContext, org: EntityId): { weights: Record<EntityId, number>; public: number } {
  if (orgTypeOf(ctx, org) === "company") {
    const votes = optionalQuery(ctx, "economy.votes")?.(ctx, org) ?? {};
    const weights: Record<EntityId, number> = {};
    for (const who of Object.keys(votes).sort()) if ((votes[who] ?? 0) > 1e-9) weights[who] = votes[who] ?? 0;
    const sum = Object.values(weights).reduce((a, w) => a + w, 0);
    const rest = 100 - sum;
    return { weights, public: sum > 0 && rest > 1e-6 ? rest : 0 };
  }
  if (orgTypeOf(ctx, org) === "trust" && rulesOf(ctx, org).basis === "trustees") {
    const trustees = trusteesOf(ctx, org);
    return { weights: Object.fromEntries(trustees.map((t) => [t, 100 / trustees.length])), public: 0 };
  }
  const people = [...new Set(membersOfOrg(ctx, org).filter((r) => r.how !== "staff" && kindIs(ctx.registry, ctx.world, own(ctx.state.entities, r.who)?.kind ?? "", "person")).map((r) => r.who))].sort();
  return { weights: Object.fromEntries(people.map((p) => [p, 100 / people.length])), public: 0 };
}

/** Whether `by` may cast `voter`'s vote: their own, or that of an organization holder whose shares they manage. */
export function castsFor(ctx: ReadContext, by: EntityId, voter: EntityId): boolean {
  if (by === voter) return true;
  return orgTypeOf(ctx, voter) !== null && mayAct(ctx, by, voter, "shares.manage").ok;
}

/** Whether the player character is in it: they put it, or have a vote on it. */
export function povIn(ctx: Pick<ReadContext, "world">, m: Pick<Motion, "by" | "party" | "electorate">): boolean {
  const pov = ctx.world.pov;
  return m.by === pov || m.party === pov || m.electorate[pov] !== undefined;
}

/**
 * The votes standing rules cast: as a motion opens, each voter's standing for, against or abstain,
 * where they haven't voted; then, until nothing moves, each voter who stands `with` someone who has
 * voted takes that vote, unless they voted on their own.
 */
export function ruleVotes(m: Pick<Motion, "electorate" | "votes">, standing: readonly StandingVote[], at: number, opening: boolean): Record<EntityId, MotionVote> {
  const out: Record<EntityId, MotionVote> = {};
  const now = (who: EntityId): MotionVote | undefined => out[who] ?? m.votes[who];
  if (opening) for (const s of standing) if (s.vote !== "with" && m.electorate[s.who] !== undefined && !now(s.who)) out[s.who] = { vote: s.vote, how: "rule", at };
  for (let round = 0; round < 8; round++) {
    let moved = false;
    for (const s of standing) {
      if (s.vote !== "with" || s.with === undefined || m.electorate[s.who] === undefined) continue;
      const mine = now(s.who);
      const lead = now(s.with);
      if ((mine && mine.how !== "rule") || !lead || mine?.vote === lead.vote) continue;
      out[s.who] = { vote: lead.vote, how: "rule", at };
      moved = true;
    }
    if (!moved) break;
  }
  return out;
}

// ---------------------------------------------------------------- words

/** A name the player character's lines may use: theirs as "you", one they can see, else "someone". */
function nameFor(ctx: ReadContext, viewer: EntityId | undefined, id: EntityId): string {
  if (id === "") return say("org_log_the_gm");
  if (viewer !== undefined && id === viewer) return "you";
  if (viewer !== undefined && !canSeeEntity(ctx.registry, ctx.world, ctx.state, viewer, id)) return "someone";
  return labelOf(ctx, id);
}

function when(ctx: ReadContext, clock: number): string {
  return formatStamp(calendarOf(ctx.world), clock);
}

/** How a closed motion ended, as a phrase (the lines `org_motion_ended_*`). */
const endWords = (status: Exclude<MotionStatus, "open">): string => say(`org_motion_ended_${status}`);

// ---------------------------------------------------------------- settling and carrying out

/** The act a motion holds, carried out as `org`'s own decision (`EffectContext.carried`): its events, or why it can't be. */
function carryOut(ctx: ReadContext, rng: Rng, org: EntityId, id: string, what: CarriedAct): LedgerEvent[] | Rejection {
  const def = ctx.registry.effects.get(what.type);
  if (!def) return refuse("unknown_effect", say("why_this_world_cant_carry_out_type", { type: what.type }));
  return def.resolve({ ...what.args }, { ...ctx, rng, params: {}, effect: { type: what.type, args: { ...what.args } }, carried: { org, motion: id } });
}

/** A motion's end, and its History line. */
function ended(ctx: ReadContext, org: EntityId, m: Motion, status: Exclude<MotionStatus, "open">, why: string, tally: Tally, by?: EntityId): LedgerEvent[] {
  const text = status === "passed" ? say("org_log_carried_by_vote_why_text", { why: why.replace(/^carried: /, ""), text: m.text }) : status === "withdrawn" ? say("org_log_withdrew_the_motion_text", { text: m.text }) : say("org_log_the_motion_failed_why_text", { why: why, text: m.text });
  return [
    { type: ORGS_MOTION_END, data: { org, id: m.id, status, why, result: tally as unknown as JsonObject, at: ctx.state.clock, ...(by !== undefined && by !== "" ? { by } : {}), visibility: povIn(ctx, m) ? "public" : "secret" } },
    orgLog(ctx, org, text, { ...(by !== undefined && by !== "" ? { by } : {}), names: [m.by, ...Object.keys(m.electorate), ...actNames(ctx, m.what)].filter((id) => id !== "") }),
  ];
}

/**
 * A motion the votes settle (`final`: at its close, on the votes cast): its end, and, passing, the
 * act it carries out, in the unit of what settled it; nothing while it stands open. An act that can't
 * be carried out now fails it, in the words of why.
 */
function settle(ctx: ReadContext, rng: Rng, org: EntityId, m: Motion, final: boolean): LedgerEvent[] {
  const s = settled(m, final);
  if (!s) return [];
  if (s.outcome === "failed") return ended(ctx, org, m, "failed", s.why, s.tally);
  const carried = carryOut(ctx, rng, org, m.id, m.what);
  if (!Array.isArray(carried)) return ended(ctx, org, m, "failed", say("org_log_couldnt_be_carried_out_reason", { reason: carried.reason }), s.tally);
  return [...ended(ctx, org, m, "passed", s.why, s.tally), ...carried];
}

// ---------------------------------------------------------------- opening

/**
 * A decision put to a vote (`orgs.put_to_vote`): when the action asks (`vote`), the motion holding
 * the effect being resolved, put by `by` for `party` (themselves, or an organization holder they
 * decide for); null when it didn't ask.
 */
export function putToVote(ctx: ReadContext, ask: { org: EntityId; by: EntityId; party: EntityId; text: string; why: string }): LedgerEvent[] | Rejection | null {
  const e = ctx as Partial<EffectContext>;
  if (e.params?.vote !== true) return null;
  if (!e.effect || !e.rng) return refuse("votes", say("why_why_and_it_cant_be_put_to", { why: ask.why }));
  return openMotion(ctx, e.rng, { ...ask, what: e.effect });
}

/**
 * A motion opened (§29.19): its voters and weights and the organization's rules fixed now; the
 * proposer's vote for it and the standing votes cast; its History line; settled at once when those
 * votes already decide it. Refused when the organization has no one to vote, has as many open as it
 * keeps, or the act couldn't be carried out were it to pass now.
 */
export function openMotion(ctx: ReadContext, rng: Rng, o: { org: EntityId; by: EntityId; party: EntityId; text: string; what: CarriedAct }): LedgerEvent[] | Rejection {
  const { org } = o;
  const name = labelOf(ctx, org);
  const rules = rulesOf(ctx, org);
  const { weights, public: pub } = electorateOf(ctx, org);
  if (Object.keys(weights).length === 0) return refuse("no_voters", say("why_name_has_no_one_to_vote", { name: name }));
  const all = motionsOf(ctx.state, org);
  if (all.filter((m) => m.status === "open").length >= MOTIONS_KEPT.open) return refuse("too_many", say("why_name_has_open_motions_open_already", { name: name, open: MOTIONS_KEPT.open }));
  const id = `m_${hashParts("orgs.motion", org, o.text, String(ctx.state.clock), String(all.length)).slice(0, 10)}`;
  // What it would do is tried now, as if it had passed: one that couldn't be carried out isn't put.
  const tried = carryOut(ctx, rng.fork("try"), org, id, o.what);
  if (!Array.isArray(tried)) return tried;
  const at = ctx.state.clock;
  const voter = weights[o.party] !== undefined ? o.party : weights[o.by] !== undefined ? o.by : null;
  const votes: Record<EntityId, MotionVote> = voter === null ? {} : { [voter]: { vote: "for", how: o.by === "" ? "gm" : "own", at, ...(o.by !== "" && o.by !== voter ? { by: o.by } : {}) } };
  const m: Motion = { id, text: o.text, what: { type: o.what.type, args: { ...o.what.args } }, by: o.by, ...(o.party !== "" && o.party !== o.by ? { party: o.party } : {}), at, closes: at + rules.days * DAY, basis: rules.basis, quorum: rules.quorum, pass: rules.pass, electorate: weights, public: pub, votes, status: "open" };
  Object.assign(m.votes, ruleVotes(m, rules.standing, at, true));
  const who = o.party !== "" && o.party !== o.by ? say("org_log_o_for_party", { o: labelOf(ctx, o.by), party: labelOf(ctx, o.party) }) : o.by === "" ? say("org_log_the_gm_2") : labelOf(ctx, o.by);
  return [
    { type: ORGS_MOTION, data: { org, motion: JSON.parse(JSON.stringify(m)) as JsonObject, visibility: povIn(ctx, m) ? "public" : "secret" } },
    orgLog(ctx, org, say("org_log_who_put_to_a_vote_text_it", { who: who, text: o.text, closes: when(ctx, m.closes) }), { ...(o.by !== "" ? { by: o.by } : {}), names: [o.by, o.party, ...actNames(ctx, o.what)].filter((x) => x !== "") }),
    ...settle(ctx, rng.fork("settle"), org, m, false),
  ];
}

// ---------------------------------------------------------------- effects

function motionAt(ctx: ReadContext, org: EntityId, id: string): Motion | Rejection {
  const m = motionsOf(ctx.state, org).find((x) => x.id === id);
  if (!m) return refuse("missing_motion", say("why_org_has_no_motion_id", { org: labelOf(ctx, org), id: id }));
  return m.status === "open" ? m : refuse("closed", say("why_that_motion_status_already", { status: endWords(m.status) }));
}

function isRejection(v: unknown): v is Rejection {
  return typeof v === "object" && v !== null && "code" in v && "reason" in v;
}

/** A vote event, worded to the player character where they are in the motion. */
function voteEvent(ctx: ReadContext, org: EntityId, m: Motion, who: EntityId, v: MotionVote, said?: string): LedgerEvent {
  return { type: ORGS_VOTE, data: { org, id: m.id, who, vote: v.vote, how: v.how, at: v.at, ...(v.by !== undefined ? { by: v.by } : {}), ...(said !== undefined && said !== "" ? { said: said.slice(0, 300) } : {}), visibility: povIn(ctx, m) ? "public" : "secret" } };
}

/**
 * `orgs.vote` (§29.19): `who`'s vote on a motion that is open and not yet closed (`who` defaults to
 * `by`), cast by them or by whoever manages an organization holder's shares; with no `by`, the GM's
 * (`how: gm`), or the story's when it quotes the reply (`said`, `how: story`). The votes it moves
 * by standing rules follow it, and it settles the motion when it can.
 */
export function voteEvents(ctx: EffectContext, a: Args): LedgerEvent[] | Rejection {
  const org = strOf(a.org);
  const m = motionsOf(ctx.state, org).find((x) => x.id === strOf(a.motion));
  if (!m) return refuse("missing_motion", say("why_org_has_no_motion_id", { org: labelOf(ctx, org), id: strOf(a.motion) }));
  const vote = strOf(a.vote);
  if (!isVote(vote)) return refuse("bad_vote", say("why_a_vote_is_for_against_or_abstain"));
  const by = strOf(a.by);
  const who = strOf(a.who) || by;
  if (who === "") return refuse("bad_args", say("why_say_whose_vote_it_is"));
  if (by !== "" && !castsFor(ctx, by, who)) return refuse("not_allowed", say("why_by_may_not_vote_for_who", { by: labelOf(ctx, by), who: labelOf(ctx, who) }));
  const said = strOf(a.said);
  const how: VoteHow = by !== "" ? "own" : said !== "" ? "story" : "gm";
  const was = m.votes[who];
  if (was && was.vote === vote && was.how !== "rule") return refuse("already", say("why_who_voted_vote_already", { who: labelOf(ctx, who), vote: VOTE_WORDS[vote] }));
  const at = ctx.state.clock;
  const cast: MotionVote = { vote, how, at, ...(by !== "" && by !== who ? { by } : {}) };
  // A vote by someone with no vote on it, or on a motion that closed, is kept beside it: it moves no standing rule and settles nothing.
  if (m.status !== "open" || ctx.state.clock > m.closes || m.electorate[who] === undefined) return [voteEvent(ctx, org, m, who, cast, said)];
  const next: Motion = { ...m, votes: { ...m.votes, [who]: cast } };
  const ruled = ruleVotes(next, rulesOf(ctx, org).standing, at, false);
  Object.assign(next.votes, ruled);
  return [voteEvent(ctx, org, m, who, cast, said), ...Object.entries(ruled).map(([w, v]) => voteEvent(ctx, org, m, w, v)), ...settle(ctx, ctx.rng.fork(`vote:${m.id}:${who}`), org, next, false)];
}

/** `orgs.motion_end`: withdrawn by whoever put it (or the GM), or closed now on the votes cast (the GM's alone). */
export function endEvents(ctx: EffectContext, a: Args): LedgerEvent[] | Rejection {
  const org = strOf(a.org);
  const m = motionAt(ctx, org, strOf(a.motion));
  if (isRejection(m)) return m;
  const by = strOf(a.by);
  const how = strOf(a.how) || "withdraw";
  if (how === "close") return by !== "" ? refuse("not_allowed", say("why_only_the_gm_closes_a_motion_before")) : settle(ctx, ctx.rng.fork(`close:${m.id}`), org, m, true);
  if (how !== "withdraw") return refuse("bad_args", say("why_a_motion_is_withdrawn_or_closed"));
  if (by !== "" && by !== m.by && !(m.party !== undefined && castsFor(ctx, by, m.party))) return refuse("not_allowed", say("why_only_m_may_withdraw_it", { m: labelOf(ctx, m.by) }));
  return ended(ctx, org, m, "withdrawn", "withdrawn", tallyOf(m), by);
}

/**
 * `orgs.propose` (the GM's and the agents', §29.19): a decision (`change`, an organization op) put to
 * a vote for `by` (deciding as `party` when that is an organization holder), as if they had taken it
 * with `vote`; refused when it compiles to no single decision, or when they may make it alone.
 */
export function proposeEvents(ctx: EffectContext, a: Args): LedgerEvent[] | Rejection {
  const by = strOf(a.by);
  if (by === "" || !own(ctx.state.entities, by)) return refuse("bad_args", say("why_a_motion_is_put_by_someone_name"));
  const op = parseOrgOp(a.change);
  if (!op) return refuse("bad_op", say("why_the_motions_change_isnt_an_organization_op"));
  const specs = compileOrgOp(ctx, op);
  if (!Array.isArray(specs)) return specs;
  const decided = specs.filter((s) => s.type !== "orgs.note");
  const spec = decided[0];
  if (decided.length !== 1 || !spec) return refuse("bad_op", say("why_a_motion_carries_one_decision"));
  const def = ctx.registry.effects.get(spec.type);
  if (!def) return refuse("unknown_effect", say("why_this_world_cant_type", { type: spec.type }));
  const args: Args = { ...spec.args, by, ...(strOf(a.party) !== "" ? { party: strOf(a.party) } : {}) };
  const out = def.resolve(args, { ...ctx, params: { vote: true }, effect: { type: spec.type, args } });
  if (!Array.isArray(out)) return out;
  return out.some((e) => e.type === ORGS_MOTION) ? out : refuse("no_vote_needed", say("why_by_may_decide_that_alone_no_vote", { by: labelOf(ctx, by) }));
}

function pctArg(v: JsonValue | undefined, [lo, hi]: readonly [number, number]): number | null | undefined | Rejection {
  if (v === undefined || v === "") return undefined;
  if (v === null || v === "default") return null;
  return typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : refuse("bad_args", say("why_say_a_number_from_lo_to_hi", { lo: lo, hi: hi }));
}

/**
 * `orgs.decisions` (at once, `org.govern`; the GM's with no `by`): how its votes are counted, its
 * quorum and pass mark, how long a motion stays open and a request waits; a value left out keeps
 * what is set, `null` (or "default") puts the default back.
 */
export function rulesEvents(ctx: EffectContext, a: Args): LedgerEvent[] | Rejection {
  const org = strOf(a.org);
  if (orgTypeOf(ctx, org) === null || isGone(ctx.state, org)) return refuse("missing_entity", say("why_no_organization_org", { org: labelOf(ctx, org) }));
  const by = strOf(a.by);
  if (by !== "") {
    const may = mayAct(ctx, by, org, "org.govern");
    if (!may.ok) return refuse("not_allowed", may.reason);
  }
  const fields = own(ctx.state.entities, org)?.fields ?? {};
  const out: LedgerEvent[] = [];
  const words: string[] = [];
  const put = (field: string, value: JsonValue | null, said: string): void => {
    if ((fields[field] ?? null) === value) return;
    out.push({ type: "set", entity: org, field, value });
    words.push(said);
  };
  const basis = a.vote_by;
  if (basis !== undefined && basis !== "") {
    if (basis !== null && basis !== "default" && !isVoteBasis(basis)) return refuse("bad_args", say("why_votes_are_counted_by_shares_by_members"));
    if (basis === "trustees" && orgTypeOf(ctx, org) !== "trust") return refuse("bad_args", say("why_only_a_trust_counts_its_trustees_votes", { org: labelOf(ctx, org) }));
    put(DECISION_FIELDS.basis, isVoteBasis(basis) ? basis : null, isVoteBasis(basis) ? say("org_log_votes_counted_by_basis", { basis: basis }) : say("org_log_votes_counted_as_its_type_counts_them"));
  }
  // Each number: its argument, its field, its range, its words set, and its words put back to the default.
  const numbers: [string, string, readonly [number, number], (n: number) => string, string][] = [
    ["quorum", DECISION_FIELDS.quorum, DECISION_RANGES.quorum, (n) => say("org_log_a_quorum_of_n", { n: pctWords(n) }), say("org_log_the_default_quorum")],
    ["pass", DECISION_FIELDS.pass, DECISION_RANGES.pass, (n) => say("org_log_passing_with_more_than_n", { n: pctWords(n) }), say("org_log_the_default_pass_mark")],
    ["days", DECISION_FIELDS.days, DECISION_RANGES.days, (n) => say("org_log_motions_open_n_days", { n: n }), say("org_log_motions_open_the_default_time")],
    ["approval_days", DECISION_FIELDS.approvalDays, DECISION_RANGES.days, (n) => say("org_log_requests_waiting_n_days", { n: n }), say("org_log_requests_waiting_the_default_time")],
  ];
  for (const [arg, field, range, said, back] of numbers) {
    const v = pctArg(a[arg], range);
    if (isRejection(v)) return v;
    if (v === undefined) continue;
    const n = v === null ? null : arg.endsWith("days") ? Math.round(v) : v;
    put(field, n, n === null ? back : said(n));
  }
  if (out.length === 0) return refuse("no_change", say("why_nothing_to_change"));
  return [...out, orgLog(ctx, org, say("org_log_set_how_decisions_are_made_words", { words: words.join(", ") }), by !== "" ? { by, power: "org.govern" } : {})];
}

/** `orgs.vote_rule`: someone's standing vote (for, against, abstain, or with another voter; `none` clears it), set by them or by the GM. */
export function standingEvents(ctx: EffectContext, a: Args): LedgerEvent[] | Rejection {
  const org = strOf(a.org);
  if (orgTypeOf(ctx, org) === null || isGone(ctx.state, org)) return refuse("missing_entity", say("why_no_organization_org", { org: labelOf(ctx, org) }));
  const by = strOf(a.by);
  const who = strOf(a.who) || by;
  if (who === "" || !own(ctx.state.entities, who)) return refuse("bad_args", say("why_say_whose_standing_vote_it_is"));
  if (by !== "" && !castsFor(ctx, by, who)) return refuse("not_allowed", say("why_by_may_not_set_who_s_standing", { by: labelOf(ctx, by), who: labelOf(ctx, who) }));
  const vote = strOf(a.vote) || "none";
  const follows = strOf(a.with);
  if (vote !== "none" && !(STANDING_VOTES as readonly string[]).includes(vote)) return refuse("bad_args", say("why_a_standing_vote_is_for_against_abstain"));
  if (vote === "with" && (follows === "" || follows === who || !own(ctx.state.entities, follows))) return refuse("bad_args", say("why_say_whose_vote_it_follows"));
  const rules = rulesOf(ctx, org).standing.filter((s) => s.who !== who);
  const next: StandingVote[] = vote === "none" ? rules : [...rules, vote === "with" ? { who, vote: "with", with: follows } : { who, vote: vote as StandingVote["vote"] }];
  const words = vote === "none" ? say("org_log_who_no_longer_has_a_standing_vote", { who: labelOf(ctx, who) }) : vote === "with" ? say("org_log_who_votes_with_follows", { who: labelOf(ctx, who), follows: labelOf(ctx, follows) }) : say("org_log_who_votes_abstain_as_a_rule", { who: labelOf(ctx, who), abstain: VOTE_WORDS[vote as "for" | "against" | "abstain"] });
  return [{ type: "set", entity: org, field: DECISION_FIELDS.standing, value: next.length > 0 ? (next as unknown as JsonValue) : null }, orgLog(ctx, org, words, { ...(by !== "" ? { by } : {}), names: [who, ...(follows !== "" ? [follows] : [])] })];
}

// ---------------------------------------------------------------- at their close

/**
 * Motions due to close, at a slot (`orgs.motions`, every level): the earliest open one past its
 * close in each organization, settled on the votes cast, one unit each; the next waits for the next
 * slot. Each is settled on what the ones before it in the slot left (a working state), so two acts
 * can't spend the same money or write over each other's lists: one that no longer applies whole fails
 * its motion, as an act that can't be carried out does.
 */
export function stepMotions(ctx: ReadContext, rng: (entity: EntityId) => Rng): LedgerEvent[] {
  const due = orgsWithMotions(ctx.state).flatMap((org) => {
    const m = motionsOf(ctx.state, org).filter((x) => x.status === "open" && x.closes <= ctx.state.clock).sort((x, y) => x.closes - y.closes || x.id.localeCompare(y.id))[0];
    return m ? [{ org, m }] : [];
  });
  if (due.length === 0) return [];
  const w = new Working(ctx.registry, ctx.world, ctx.state);
  // A unit's events applied in order as one group; the first that doesn't apply, as a rejection.
  const unit = (events: readonly LedgerEvent[], group: string): Rejection | null => {
    for (const e of events) {
      const failed = w.apply({ ...e, group });
      if (failed) return failed;
    }
    return null;
  };
  for (const { org, m } of due) {
    const group = `orgs.motion:${hashParts(org, m.id).slice(0, 10)}`;
    const mark = w.mark();
    const failed = unit(settle(w.ctx, rng(org).fork(m.id), org, m, true), group);
    if (!failed) continue;
    w.restore(mark);
    const s = settled(m, true);
    if (s && unit(ended(w.ctx, org, m, "failed", say("org_log_couldnt_be_carried_out_reason", { reason: failed.reason }), s.tally), group)) w.restore(mark);
  }
  return w.events;
}

export const MOTIONS_PROCESS: ProcessDef = { id: "orgs.motions", domain: "relationships", minLevel: 0, step: (_slot, ctx, rng) => stepMotions(ctx, rng) };

// ---------------------------------------------------------------- events

function str(e: PackEvent, key: string): string {
  return strOf(e.data[key]);
}

/** The motions list of `org` in the slice, made when first written. */
function listAt(state: Parameters<EventTypeDef<PackEvent>["apply"]>[1], org: EntityId): JsonValue[] {
  const all = sliceRecord(state, "orgs", "motions");
  const list = all[org];
  return Array.isArray(list) ? list : [];
}

function writeList(state: Parameters<EventTypeDef<PackEvent>["apply"]>[1], org: EntityId, list: JsonValue[]): void {
  const open = list.filter((m) => motionIn(m)?.status === "open");
  const closed = list.filter((m) => motionIn(m)?.status !== "open").slice(-MOTIONS_KEPT.closed);
  const keep = new Set([...open, ...closed]);
  sliceRecord(state, "orgs", "motions")[org] = list.filter((m) => keep.has(m));
}

function openIn(ctx: ReadContext, e: PackEvent): Motion | Rejection {
  const m = motionsOf(ctx.state, str(e, "org")).find((x) => x.id === str(e, "id"));
  return m && m.status === "open" ? m : refuse("bad_event", say("why_no_such_motion_open"));
}

export const MOTION_EVENTS: EventTypeDef<PackEvent>[] = [
  {
    // A motion opened, whole: its act, voters, rules and the votes cast as it opened.
    type: ORGS_MOTION,
    validate: (e, ctx) => {
      const m = motionIn(e.data.motion);
      if (str(e, "org") === "" || !m) return refuse("bad_event", say("why_a_motion_needs_its_organization_words_and"));
      return motionsOf(ctx.state, str(e, "org")).some((x) => x.id === m.id) ? refuse("bad_event", say("why_motion_id_is_on_record_already", { id: m.id })) : null;
    },
    apply: (e, state) => {
      const org = str(e, "org");
      writeList(state, org, [...listAt(state, org), e.data.motion as JsonValue]);
    },
    describe: (e, ctx, viewer) => {
      const m = motionIn(e.data.motion);
      if (!m) return say("org_motion_bare");
      const by = m.by === "" ? say("org_the_gm") : nameFor(ctx, viewer, m.by);
      return say("org_motion_put", { by: `${by.charAt(0).toUpperCase()}${by.slice(1)}`, org: labelOf(ctx, str(e, "org")), text: m.text, closes: when(ctx, m.closes) });
    },
    // The motion comes off the organization's motions, as it stands there now.
    reverse: (e, _before, now) => {
      const org = str(e, "org");
      const id = motionIn(e.data.motion)?.id;
      const entry = newestOf(objOf(sliceOf(now, "orgs").motions)[org], (m) => isRecord(m) && m.id === id);
      return entry === undefined ? [] : [unlisting("orgs", ["motions", org], entry)];
    },
  },
  {
    // A vote cast, or changed, on a motion. One by someone with no vote on it, or after it closed, is kept beside the votes (`late`), never counted: the outcome stays as it was decided.
    type: ORGS_VOTE,
    validate: (e, ctx) => {
      const m = motionsOf(ctx.state, str(e, "org")).find((x) => x.id === str(e, "id"));
      if (!m) return refuse("bad_event", say("why_no_such_motion"));
      return isVote(e.data.vote) && str(e, "who") !== "" ? null : refuse("bad_event", say("why_a_vote_is_for_against_or_abstain_2"));
    },
    advise: (e, ctx): Advice | null => {
      const m = motionsOf(ctx.state, str(e, "org")).find((x) => x.id === str(e, "id"));
      if (!m) return null;
      const who = labelOf(ctx, str(e, "who"));
      if (m.status !== "open" || ctx.state.clock > m.closes) return { code: "closed", values: { what: "motion", who } };
      return m.electorate[str(e, "who")] === undefined ? { code: "not_voter", values: { who } } : null;
    },
    apply: (e, state) => {
      const org = str(e, "org");
      writeList(
        state,
        org,
        listAt(state, org).map((raw) => {
          if (!isRecord(raw) || raw.id !== str(e, "id")) return raw;
          const who = str(e, "who");
          const cast = { vote: str(e, "vote"), how: isVoteHow(e.data.how) ? e.data.how : "own", at: typeof e.data.at === "number" ? e.data.at : state.clock, ...(str(e, "by") !== "" ? { by: str(e, "by") } : {}) };
          const counts = raw.status === "open" && !(typeof raw.closes === "number" && state.clock > raw.closes) && objOf(raw.electorate)[who] !== undefined;
          if (!counts) return { ...raw, late: { ...objOf(raw.late), [who]: cast } };
          return { ...raw, votes: { ...objOf(raw.votes), [who]: cast } };
        }),
      );
    },
    describe: (e, ctx, viewer) => {
      const m = motionsOf(ctx.state, str(e, "org")).find((x) => x.id === str(e, "id"));
      const who = nameFor(ctx, viewer, str(e, "who"));
      const vote = isVote(e.data.vote) ? e.data.vote : "abstain";
      return say(vote === "abstain" ? "org_abstain" : "org_vote", { who: `${who.charAt(0).toUpperCase()}${who.slice(1)}`, ...(who === "you" ? { you: true } : {}), vote, ...(m ? { text: m.text } : {}) });
    },
  },
  {
    // A motion closed: carried, failed or withdrawn, with its count.
    type: ORGS_MOTION_END,
    validate: (e, ctx) => {
      const m = openIn(ctx, e);
      if (isRejection(m)) return m;
      return ["passed", "failed", "withdrawn"].includes(str(e, "status")) ? null : refuse("bad_event", say("why_a_motion_ends_carried_failed_or_withdrawn"));
    },
    apply: (e, state) => {
      const org = str(e, "org");
      writeList(
        state,
        org,
        listAt(state, org).map((raw) => (isRecord(raw) && raw.id === str(e, "id") ? { ...raw, status: str(e, "status"), closed: typeof e.data.at === "number" ? e.data.at : state.clock, why: str(e, "why"), ...(isRecord(e.data.result) ? { result: e.data.result } : {}) } : raw)),
      );
    },
    describe: (e, ctx) => {
      const m = motionsOf(ctx.state, str(e, "org")).find((x) => x.id === str(e, "id"));
      const status = str(e, "status") as Exclude<MotionStatus, "open">;
      return say("org_motion_end", { org: labelOf(ctx, str(e, "org")), ended: (status === "passed" || status === "failed" || status === "withdrawn" ? endWords(status) : "") || say("org_motion_closed"), ...(status === "withdrawn" ? {} : { why: str(e, "why") }), ...(m ? { text: m.text } : {}) });
    },
  },
];

// ---------------------------------------------------------------- actions

const ORG_PARAM: ParamDef = wordedParam({ type: "ref", of: { kind: ["business", "household", "group", "trust"] } }, "param_org");

const ACTIONS: readonly PackAction[] = [
  {
    id: DECISION_ACTIONS.vote,
    pack: "orgs",
    params: {
      org: ORG_PARAM,
      motion: { type: "text" },
      vote: { type: "text" },
      as: { type: "ref", optional: true, of: { kind: ["business", "household", "group", "trust"] }, acting: "shares.manage" },
    },
    requires: ["params.as == null or may(actor, params.as, 'shares.manage')"],
    outcomes: { default: [{ type: DECISION_EFFECTS.vote, args: { org: "org", motion: "=params.motion", vote: "=params.vote", who: "self", by: "actor" } }] },
    duration: "5",
    lexicon: ["vote for the motion", "vote against", "raise a hand for", "abstain"],
    observable: "casts a vote",
  },
  {
    id: DECISION_ACTIONS.end,
    pack: "orgs",
    params: { org: ORG_PARAM, motion: { type: "text" } },
    requires: [],
    outcomes: { default: [{ type: DECISION_EFFECTS.end, args: { org: "org", motion: "=params.motion", how: "withdraw", by: "self" } }] },
    duration: "2",
    lexicon: ["withdraw the motion"],
    observable: "does some paperwork",
    mechanical: true,
  },
  {
    id: DECISION_ACTIONS.rules,
    pack: "orgs",
    params: {
      org: ORG_PARAM,
      vote_by: { type: "text", optional: true },
      quorum: { type: "number", optional: true },
      pass: { type: "number", optional: true },
      days: { type: "number", optional: true },
      approval_days: { type: "number", optional: true },
    },
    requires: ["may(self, org, 'org.govern')"],
    outcomes: { default: [{ type: DECISION_EFFECTS.rules, args: { org: "org", vote_by: "=params.vote_by", quorum: "=params.quorum", pass: "=params.pass", days: "=params.days", approval_days: "=params.approval_days", by: "self" } }] },
    duration: "2",
    lexicon: ["set the quorum", "change the voting rules"],
    observable: "does some paperwork",
    mechanical: true,
  },
  {
    id: DECISION_ACTIONS.standing,
    pack: "orgs",
    params: { org: ORG_PARAM, vote: { type: "text" }, with: { type: "ref", optional: true } },
    requires: [],
    outcomes: { default: [{ type: DECISION_EFFECTS.standing, args: { org: "org", vote: "=params.vote", with: "=params.with", who: "self", by: "self" } }] },
    duration: "2",
    lexicon: ["vote with", "always vote for"],
    observable: "does some paperwork",
    mechanical: true,
  },
];

/** Motions: their events, the GM's effects (which the actions play with `by`), the decisions' service, the close each slot, and the actions. */
export function registerMotions(r: CoreRegistry): void {
  for (const def of MOTION_EVENTS) r.event(def);
  r.service("orgs.put_to_vote", putToVote);
  r.effect({ type: DECISION_EFFECTS.propose, args: ["change", "by", "party?"], gm: true, resolve: (a, ctx) => proposeEvents(ctx, a) });
  r.effect({ type: DECISION_EFFECTS.vote, args: ["org", "motion", "vote", "who?", "said?", "by?"], gm: true, resolve: (a, ctx) => voteEvents(ctx, a) });
  r.effect({ type: DECISION_EFFECTS.end, args: ["org", "motion", "how?", "by?"], gm: true, resolve: (a, ctx) => endEvents(ctx, a) });
  r.effect({ type: DECISION_EFFECTS.rules, args: ["org", "vote_by?", "quorum?", "pass?", "days?", "approval_days?", "by?"], gm: true, resolve: (a, ctx) => rulesEvents(ctx, a) });
  r.effect({ type: DECISION_EFFECTS.standing, args: ["org", "who?", "vote?", "with?", "by?"], gm: true, resolve: (a, ctx) => standingEvents(ctx, a) });
  r.process(MOTIONS_PROCESS);
  for (const def of ACTIONS) r.action(def);
}
