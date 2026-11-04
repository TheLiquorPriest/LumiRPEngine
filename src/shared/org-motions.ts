// Motions and approvals over limits (ORG-SPEC Phase 5; DESIGN §29.19-29.20): an organization's
// decisions that one person may not make alone. A decision short of the decider's votes is put to a
// vote (a motion), carried out when the vote passes; an act over a position's or a delegation's limit
// is put up the requester's chain of command (a request for approval), carried out when approved.
// Each holds the act it carries (`CarriedAct`: an effect and its arguments, as they were evaluated
// when it was put). Here: the organization's rules for its decisions (`decisionRulesIn`), the records
// as `packs.orgs` keeps them, the tally and when a motion is settled (`tallyOf`, `settled`), and the
// Decisions section as the page reads it. Pure.

import type { EntityId } from "./ids";
import { isRecord, type JsonValue } from "./json";
import type { OrgPower } from "./org";
import type { OrgRef } from "./org-view";
import type { ParamDef } from "./world";

/** An action's choice to put a decision short of the decider's votes to a vote instead: the economy's `decision` reads it from the action's params. */
export const VOTE_PARAM: ParamDef = { type: "bool", optional: true, label: "Put it to a vote when your votes aren't enough" };

/** An action's choice to ask those above the actor for approval when it's over the actor's limit: the economy's `actAs` reads it from the action's params. */
export const ASK_PARAM: ParamDef = { type: "bool", optional: true, label: "Ask for approval when it's over your limit" };

/** The Decisions section of an organization's page, and its tab (`orgRoute(org, DECISIONS_TAB)`). */
export const DECISIONS_SECTION = "orgs.decisions";
export const DECISIONS_TAB = "orgs.decisions";

/** A vote: for, against, or taking part without either (abstaining). */
export const VOTES = ["for", "against", "abstain"] as const;
export type Vote = (typeof VOTES)[number];

export function isVote(v: unknown): v is Vote {
  return typeof v === "string" && (VOTES as readonly string[]).includes(v);
}

/** The words of each vote, as a voter's row and the History give them. */
export const VOTE_WORDS: Readonly<Record<Vote, string>> = { for: "for", against: "against", abstain: "abstains" };

/** How a vote was cast: the voter's own (on the page, or as they made the decision), by their standing vote, as the story told it, or by the GM. */
export const VOTE_HOWS = ["own", "rule", "story", "gm"] as const;
export type VoteHow = (typeof VOTE_HOWS)[number];

export function isVoteHow(v: unknown): v is VoteHow {
  return typeof v === "string" && (VOTE_HOWS as readonly string[]).includes(v);
}

/** How an organization counts its votes: by its shares (each unit its class's votes, else each owner's share of its worth), or one holder or member, one vote. */
export const VOTE_BASES = ["shares", "members"] as const;
export type VoteBasis = (typeof VOTE_BASES)[number];

export function isVoteBasis(v: unknown): v is VoteBasis {
  return typeof v === "string" && (VOTE_BASES as readonly string[]).includes(v);
}

/** A standing vote: cast for someone whenever a motion opens (for, against, abstain), or as another voter votes (`with`). */
export const STANDING_VOTES = ["for", "against", "abstain", "with"] as const;
export type StandingVoteKind = (typeof STANDING_VOTES)[number];

export interface StandingVote {
  who: EntityId;
  vote: StandingVoteKind;
  /** Whose vote a `with` follows. */
  with?: EntityId;
}

/** A motion's life: open until it passes (and is carried out), fails (voted down, no quorum, or it couldn't be carried out) or its proposer withdraws it. */
export const MOTION_STATUSES = ["open", "passed", "failed", "withdrawn"] as const;
export type MotionStatus = (typeof MOTION_STATUSES)[number];

export function isMotionStatus(v: unknown): v is MotionStatus {
  return typeof v === "string" && (MOTION_STATUSES as readonly string[]).includes(v);
}

/** A request's life as recorded: asked until approved (and carried out), denied or withdrawn; one asked past its time reads `lapsed`. */
export const REQUEST_STATUSES = ["asked", "approved", "denied", "withdrawn"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
export type RequestState = RequestStatus | "lapsed";

export function isRequestStatus(v: unknown): v is RequestStatus {
  return typeof v === "string" && (REQUEST_STATUSES as readonly string[]).includes(v);
}

/** An answer to a request: approve it, deny it, or (its requester) withdraw it. */
export const ANSWERS = ["approve", "deny", "withdraw"] as const;
export type Answer = (typeof ANSWERS)[number];

/** The rules a world gives an organization's decisions where its own fields set none (each settable per organization). */
export const DECISION_DEFAULTS = Object.freeze({ quorum: 50, pass: 50, days: 7, approvalDays: 7 });
/** The ranges each rule takes: percentages; a pass of "more than" under 100; whole days. */
export const DECISION_RANGES = Object.freeze({ quorum: [0, 100], pass: [0, 99.9], days: [1, 365] } as const);

/** The organization fields that hold its rules (on every organization, ORG_FIELDS). */
export const DECISION_FIELDS = Object.freeze({ basis: "vote_by", quorum: "quorum_pct", pass: "pass_pct", days: "motion_days", standing: "vote_rules", approvalDays: "approval_days" } as const);

/** An organization's rules for its decisions: how votes are counted, the quorum and the pass mark in percent, how long a motion stays open and a request waits, in days, and the standing votes. */
export interface DecisionRules {
  basis: VoteBasis;
  quorum: number;
  pass: number;
  days: number;
  approvalDays: number;
  standing: StandingVote[];
}

function inRange(v: JsonValue | undefined, [lo, hi]: readonly [number, number], fallback: number, whole = false): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  const n = whole ? Math.round(v) : v;
  return Math.min(hi, Math.max(lo, n));
}

/** Standing votes as the field holds them: each person once (the first), a `with` naming someone else. */
export function standingIn(v: JsonValue | undefined): StandingVote[] {
  if (!Array.isArray(v)) return [];
  const out: StandingVote[] = [];
  for (const raw of v) {
    if (!isRecord(raw)) continue;
    const who = typeof raw.who === "string" ? raw.who : "";
    const vote = raw.vote;
    if (who === "" || typeof vote !== "string" || !(STANDING_VOTES as readonly string[]).includes(vote) || out.some((s) => s.who === who)) continue;
    if (vote === "with") {
      const w = typeof raw.with === "string" ? raw.with : "";
      if (w !== "" && w !== who) out.push({ who, vote: "with", with: w });
      continue;
    }
    out.push({ who, vote: vote as StandingVoteKind });
  }
  return out;
}

/** The rules an organization's fields give, the defaults where they set none: a company counts by shares unless it says otherwise, any other organization by members. */
export function decisionRulesIn(fields: Readonly<Record<string, JsonValue>>, company: boolean): DecisionRules {
  const basis = fields[DECISION_FIELDS.basis];
  return {
    basis: isVoteBasis(basis) ? basis : company ? "shares" : "members",
    quorum: inRange(fields[DECISION_FIELDS.quorum], DECISION_RANGES.quorum, DECISION_DEFAULTS.quorum),
    pass: inRange(fields[DECISION_FIELDS.pass], DECISION_RANGES.pass, DECISION_DEFAULTS.pass),
    days: inRange(fields[DECISION_FIELDS.days], DECISION_RANGES.days, DECISION_DEFAULTS.days, true),
    approvalDays: inRange(fields[DECISION_FIELDS.approvalDays], DECISION_RANGES.days, DECISION_DEFAULTS.approvalDays, true),
    standing: standingIn(fields[DECISION_FIELDS.standing]),
  };
}

/** The act a motion or a request carries out once it passes or is approved: an effect, with its arguments as they were evaluated when it was put. */
export interface CarriedAct {
  type: string;
  args: Record<string, JsonValue>;
}

/** One voter's vote on a motion: what, how it was cast, when, and who cast it for them when that was someone else (the one who acts for an organization holder). */
export interface MotionVote {
  vote: Vote;
  how: VoteHow;
  at: number;
  by?: EntityId;
}

/** A motion as `packs.orgs.motions[org]` keeps it. Its voters and their weights (`electorate`, percent of all the votes) and its rules are fixed when it opens. */
export interface Motion {
  id: string;
  /** What it does, in words ("Issue 100 units of Ellis Mobile Repair to Priya Nair at $5.00 a unit"). */
  text: string;
  what: CarriedAct;
  /** Who put it (the GM's has none), and the holder they put it for when that is someone else (an organization they act for). */
  by: EntityId;
  party?: EntityId;
  at: number;
  closes: number;
  basis: VoteBasis;
  quorum: number;
  pass: number;
  electorate: Record<EntityId, number>;
  /** The votes no one here casts (a listed company's outside public), counted as taking part without voting either way. */
  public: number;
  votes: Record<EntityId, MotionVote>;
  status: MotionStatus;
  closed?: number;
  why?: string;
}

/** A request for approval as `packs.orgs.asks[org]` keeps it: who asked, the power and what the act asks of it, its words and the limit it is over, who may approve it, until when. */
export interface ApprovalRequest {
  id: string;
  by: EntityId;
  power: OrgPower;
  cents?: number;
  account?: EntityId;
  target?: EntityId;
  /** What the act does, as its History line words it ("Paid Westside Parts $600.00"). */
  text: string;
  /** The limit it is over, in the refusal's words. */
  why: string;
  what: CarriedAct;
  approvers: EntityId[];
  at: number;
  until: number;
  status: RequestStatus;
  answered?: { by?: EntityId; at: number; why?: string };
}

/** A motion's count, in percent of all its votes: for, against, abstaining (the outside public among them), cast in all, and not cast yet. */
export interface Tally {
  for: number;
  against: number;
  abstain: number;
  cast: number;
  remaining: number;
  quorumMet: boolean;
}

const EPS = 1e-9;

/** How a motion stands on the votes cast. */
export function tallyOf(m: Pick<Motion, "electorate" | "public" | "votes" | "quorum">): Tally {
  let yes = 0;
  let no = 0;
  let abstain = Math.max(0, m.public);
  let open = 0;
  for (const [who, weight] of Object.entries(m.electorate)) {
    const v = m.votes[who]?.vote;
    if (v === "for") yes += weight;
    else if (v === "against") no += weight;
    else if (v === "abstain") abstain += weight;
    else open += weight;
  }
  const cast = yes + no + abstain;
  return { for: yes, against: no, abstain, cast, remaining: open, quorumMet: cast + EPS >= m.quorum };
}

/** A percentage in words: whole where it is, else to one place. */
export function pctWords(pct: number): string {
  const r = Math.round(pct * 10) / 10;
  return `${Number.isInteger(r) ? r.toFixed(0) : r.toFixed(1)}%`;
}

/**
 * Whether a motion is settled (§29.19), and why: before it closes, only when the votes not yet cast
 * can't change it (it passes with quorum met and more than its pass mark of the votes for or
 * against even were the rest to go against; it fails when even all the rest for it couldn't pass
 * it); at its close (`final`), on the votes cast: quorum, then more than the pass mark for.
 */
export function settled(m: Pick<Motion, "electorate" | "public" | "votes" | "quorum" | "pass">, final: boolean): { outcome: "passed" | "failed"; why: string; tally: Tally } | null {
  const t = tallyOf(m);
  const share = m.pass / 100;
  const counted = `${pctWords(t.for)} for, ${pctWords(t.against)} against`;
  if (t.quorumMet && t.for > share * (t.for + t.against + t.remaining) + EPS) return { outcome: "passed", why: `carried: ${counted}`, tally: t };
  if (!(t.for + t.remaining > share * (t.for + t.remaining + t.against) + EPS)) return { outcome: "failed", why: `voted down: ${counted}`, tally: t };
  if (!final) return null;
  if (!t.quorumMet) return { outcome: "failed", why: `no quorum: ${pctWords(t.cast)} took part, ${pctWords(m.quorum)} needed`, tally: t };
  return t.for > share * (t.for + t.against) + EPS ? { outcome: "passed", why: `carried: ${counted}`, tally: t } : { outcome: "failed", why: `voted down: ${counted}`, tally: t };
}

// ---------------------------------------------------------------- the Decisions section

/** One voter on a motion, as the reader may see them: who, their weight in percent, their vote and how it was cast (none yet). */
export interface VoterView {
  who: OrgRef;
  weight: number;
  vote: Vote | null;
  how: VoteHow | null;
}

/** A voter the reader may cast a vote for: themselves, or an organization holder they act for. */
export interface CastView {
  voter: EntityId;
  name: string;
  /** The organization they vote as, when not themselves (an action's `as`). */
  as?: EntityId;
  vote: Vote | null;
}

/** A motion as the reader may see it. */
export interface MotionView {
  id: string;
  text: string;
  by: OrgRef | null;
  at: number;
  closes: number;
  /** When it closes, in the world calendar's words. */
  closesText: string;
  status: MotionStatus;
  why: string | null;
  basis: VoteBasis;
  quorum: number;
  pass: number;
  tally: Tally;
  voters: VoterView[];
  /** The outside public's votes (a listed company), counted as abstaining. */
  public: number;
  /** Whom the reader may vote for now, each with their vote so far; empty when they may vote for no one. */
  cast: CastView[];
  /** Whether the reader may withdraw it (its proposer, while it is open). */
  mayWithdraw: boolean;
}

/** A request for approval as the reader may see it. */
export interface RequestView {
  id: string;
  text: string;
  why: string;
  by: OrgRef;
  power: OrgPower;
  cents: number | null;
  at: number;
  until: number;
  /** When it lapses, in the world calendar's words. */
  untilText: string;
  state: RequestState;
  approvers: OrgRef[];
  answered: { by: OrgRef | null; at: number; why: string | null } | null;
  /** Whether the reader may approve or deny it (they are above its requester there, within their own limits), or withdraw it (they asked). */
  mayAnswer: boolean;
  mayWithdraw: boolean;
}

/** An organization's decisions as its page's Decisions tab reads them: its rules, its motions (open, then the latest closed), its requests for approval (waiting, then the latest answered), and what the reader may change. */
export interface DecisionsView {
  rules: {
    basis: VoteBasis;
    quorum: number;
    pass: number;
    days: number;
    approvalDays: number;
    standing: { who: OrgRef; vote: StandingVoteKind; with: OrgRef | null }[];
  };
  open: MotionView[];
  closed: MotionView[];
  waiting: RequestView[];
  answered: RequestView[];
  /** Why the reader may not change the rules (`org.govern`), or null when they may. */
  rulesWhy: string | null;
  /** The reader's own standing vote, when they vote here (null: none set); undefined when they hold no vote. */
  standing?: StandingVote | null;
}

/** The actions Decisions sends: a vote, a motion's end (withdraw), an answer to a request, the rules and one's own standing vote. */
export const DECISION_ACTIONS = { vote: "org_vote", end: "org_motion_end", approve: "org_approve", deny: "org_deny", rules: "org_decisions", standing: "org_vote_rule" } as const;
/** The GM effects they play, which GM → Orgs and the agents' ops play with no actor. */
export const DECISION_EFFECTS = { propose: "orgs.propose", vote: "orgs.vote", end: "orgs.motion_end", answer: "orgs.answer", rules: "orgs.decisions", standing: "orgs.vote_rule" } as const;
