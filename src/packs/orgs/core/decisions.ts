// An organization's decisions as its page, its alerts and the story read them (ORG-SPEC Phase 5;
// DESIGN §29.19-29.20): the Decisions section (`orgs.decisions`: its rules, its motions and its
// requests for approval, as the reader may see them, with what they may do), the alerts that a motion
// waits on their vote or a request on their approval, what a mind (Your organizations) and the
// narrator (the Quest section's `decisions` source) are told of the open ones, and the reply's `vote`
// and `approval` facts: a vote or an answer the story tells, quoting it, on an open motion or request
// the read is told of by its id. Pure.

import type { EntityId } from "../../../shared/ids";
import type { JsonObject, JsonValue } from "../../../shared/json";
import type { OrgAlertView } from "../../../shared/org-feed";
import { ANSWERS, DECISION_EFFECTS, DECISIONS_SECTION, pctWords, tallyOf, VOTE_WORDS, type ApprovalRequest, type DecisionsView, type Motion, type MotionView, type RequestView } from "../../../shared/org-motions";
import { calendarOf, formatStamp } from "../../../engine/calendar";
import { delegationsOf, mayAct, orgTypeOf, positionsOf } from "../../../engine/org";
import { labelOf, own, strOf } from "../../../engine/pack-kit";
import type { CoreRegistry, ProposalChannelDef, ReadContext, Rejection } from "../../../engine/registry";
import { createRng } from "../../../engine/rng";
import { isGone } from "../../../engine/scope";
import { canSeeEntity } from "../../../engine/visibility";
import { refFor } from "./agenda";
import { answerEvents, approversOf, orgsWithRequests, requestsOf, requestState } from "./approvals";
import { castsFor, electorateOf, motionsOf, orgsWithMotions, povIn, rulesOf, voteEvents } from "./motions";
import { entityNamed, personNamed, statesChange } from "./story";

/** The latest closed motions and answered requests the page shows. */
const RECENT = 10;

/** A motion as `viewer` may read it, with whom they may vote for now (nobody, once it is closed). */
function motionView(ctx: ReadContext, m: Motion, viewer: EntityId | null): MotionView {
  const open = m.status === "open" && ctx.state.clock <= m.closes;
  const cast =
    viewer === null || !open
      ? []
      : Object.keys(m.electorate)
          .filter((v) => castsFor(ctx, viewer, v))
          .map((v) => ({ voter: v, name: v === viewer ? "You" : labelOf(ctx, v), ...(v !== viewer ? { as: v } : {}), vote: m.votes[v]?.vote ?? null }));
  return {
    id: m.id,
    text: m.text,
    by: m.by === "" ? null : refFor(ctx, viewer, m.by),
    at: m.at,
    closes: m.closes,
    closesText: formatStamp(calendarOf(ctx.world), m.closes),
    status: m.status,
    why: m.why ?? null,
    basis: m.basis,
    quorum: m.quorum,
    pass: m.pass,
    tally: tallyOf(m),
    voters: Object.keys(m.electorate).map((who) => ({ who: refFor(ctx, viewer, who), weight: m.electorate[who] ?? 0, vote: m.votes[who]?.vote ?? null, how: m.votes[who]?.how ?? null })),
    public: m.public,
    cast,
    mayWithdraw: viewer !== null && m.status === "open" && (m.by === viewer || (m.party !== undefined && castsFor(ctx, viewer, m.party))),
  };
}

/** A request as `viewer` may read it: who may approve it now while it waits, and whether they may answer or withdraw it. */
function requestView(ctx: ReadContext, org: EntityId, r: ApprovalRequest, viewer: EntityId | null): RequestView {
  const state = requestState(ctx, r);
  const approvers = state === "asked" ? approversOf(ctx, org, r) : r.approvers;
  return {
    id: r.id,
    text: r.text,
    why: r.why,
    by: refFor(ctx, viewer, r.by),
    power: r.power,
    cents: r.cents ?? null,
    at: r.at,
    until: r.until,
    untilText: formatStamp(calendarOf(ctx.world), r.until),
    state,
    approvers: approvers.map((a) => refFor(ctx, viewer, a)),
    answered: r.answered ? { by: r.answered.by !== undefined ? refFor(ctx, viewer, r.answered.by) : null, at: r.answered.at, why: r.answered.why ?? null } : null,
    mayAnswer: viewer !== null && state === "asked" && approvers.includes(viewer),
    mayWithdraw: viewer !== null && state === "asked" && r.by === viewer,
  };
}

/** Whether an organization has decisions to show: a company, one with a motion or a request on record, or one whose positions or delegations set limits. */
function hasDecisions(ctx: ReadContext, org: EntityId): boolean {
  if (orgTypeOf(ctx, org) === "company" || motionsOf(ctx.state, org).length > 0 || requestsOf(ctx.state, org).length > 0) return true;
  return positionsOf(ctx, org).some((p) => p.limits !== undefined) || delegationsOf(ctx, org).some((d) => d.limits !== undefined);
}

/** Whether `viewer` reads an organization's decisions: a voter, someone in a motion or a request, or a holder there of `money.view` or `org.govern`; the GM always. */
function readsDecisions(ctx: ReadContext, org: EntityId, viewer: EntityId | null): boolean {
  if (viewer === null) return true;
  if (electorateOf(ctx, org).weights[viewer] !== undefined) return true;
  if (motionsOf(ctx.state, org).some((m) => m.by === viewer || m.electorate[viewer] !== undefined)) return true;
  if (requestsOf(ctx.state, org).some((r) => r.by === viewer || r.approvers.includes(viewer))) return true;
  return mayAct(ctx, viewer, org, "money.view").ok || mayAct(ctx, viewer, org, "org.govern").ok;
}

/**
 * The Decisions section (§29.19-29.20) as `viewer` (the player character; null for the GM) may read
 * it: the rules, the open motions and the latest closed, the waiting requests and the latest answered,
 * and what the reader may change; null where the organization has no decisions or the reader doesn't
 * read them. A request (its words name whom it pays and how much) reads only to whoever asked it, may
 * approve it or answered it, and to a holder there of `money.view` or `org.govern`, never to every
 * voter: a listed company's are all its stockholders.
 */
export function buildDecisionsView(ctx: ReadContext, org: EntityId, viewer: EntityId | null): DecisionsView | null {
  if (orgTypeOf(ctx, org) === null || isGone(ctx.state, org) || !hasDecisions(ctx, org) || !readsDecisions(ctx, org, viewer)) return null;
  const rules = rulesOf(ctx, org);
  const motions = motionsOf(ctx.state, org);
  const requests = requestsOf(ctx.state, org);
  const govern = viewer === null ? null : mayAct(ctx, viewer, org, "org.govern");
  const voter = viewer !== null && electorateOf(ctx, org).weights[viewer] !== undefined;
  const seesAll = viewer === null || (govern?.ok ?? false) || mayAct(ctx, viewer, org, "money.view").ok;
  const shown = requests.filter((r) => viewer === null || seesAll || r.by === viewer || r.approvers.includes(viewer) || r.answered?.by === viewer || (requestState(ctx, r) === "asked" && approversOf(ctx, org, r).includes(viewer)));
  return {
    rules: {
      basis: rules.basis,
      quorum: rules.quorum,
      pass: rules.pass,
      days: rules.days,
      approvalDays: rules.approvalDays,
      standing: rules.standing.map((s) => ({ who: refFor(ctx, viewer, s.who), vote: s.vote, with: s.with !== undefined ? refFor(ctx, viewer, s.with) : null })),
    },
    open: motions.filter((m) => m.status === "open").map((m) => motionView(ctx, m, viewer)),
    closed: motions
      .filter((m) => m.status !== "open")
      .slice(-RECENT)
      .reverse()
      .map((m) => motionView(ctx, m, viewer)),
    waiting: shown.filter((r) => requestState(ctx, r) === "asked").map((r) => requestView(ctx, org, r, viewer)),
    answered: shown
      .filter((r) => requestState(ctx, r) !== "asked")
      .slice(-RECENT)
      .reverse()
      .map((r) => requestView(ctx, org, r, viewer)),
    rulesWhy: govern === null || govern.ok ? null : govern.reason,
    ...(voter && viewer !== null ? { standing: rules.standing.find((s) => s.who === viewer) ?? null } : {}),
  };
}

// ---------------------------------------------------------------- alerts

/**
 * The alerts of an organization's decisions (§29.15's, added): each open motion the reader may still
 * vote on (needs them while their vote isn't cast), and each request waiting on them, or theirs that
 * waits.
 */
export function decisionAlerts(ctx: ReadContext, org: EntityId, viewer: EntityId | null): OrgAlertView[] {
  const out: OrgAlertView[] = [];
  const cal = calendarOf(ctx.world);
  for (const m of motionsOf(ctx.state, org)) {
    if (m.status !== "open" || ctx.state.clock > m.closes) continue;
    const mine = viewer === null ? [] : Object.keys(m.electorate).filter((v) => castsFor(ctx, viewer, v));
    if (viewer !== null && mine.length === 0 && m.by !== viewer) continue;
    const owed = mine.some((v) => m.votes[v] === undefined || m.votes[v]?.how === "rule");
    out.push({ id: `motion:${m.id}`, kind: "motion_open", tone: "info", text: `To a vote, closing ${formatStamp(cal, m.closes)}: ${m.text}.`, short: owed ? "your vote is wanted" : "a motion is open", tab: "decisions", needsYou: owed });
  }
  for (const r of requestsOf(ctx.state, org)) {
    if (requestState(ctx, r) !== "asked") continue;
    const answers = viewer !== null && approversOf(ctx, org, r).includes(viewer);
    if (viewer !== null && !answers && r.by !== viewer) continue;
    out.push({ id: `request:${r.id}`, kind: "approval_waiting", tone: "info", text: answers ? `${refFor(ctx, viewer, r.by).name} asks your approval: ${r.text}.` : r.by === viewer ? `Waiting for approval: ${r.text}.` : `A request waits for approval: ${r.text}.`, short: answers ? "a request waits on you" : "waiting for approval", tab: "decisions", needsYou: answers });
  }
  return out;
}

// ---------------------------------------------------------------- what minds and the narrator are told

/** How a motion stands, in words: who has voted which way and who hasn't. */
function standingWords(ctx: ReadContext, m: Motion, viewer: EntityId | null): string {
  const t = tallyOf(m);
  const yet = Object.keys(m.electorate).filter((v) => m.votes[v] === undefined);
  const names = yet.map((v) => refFor(ctx, viewer, v).name);
  return `${pctWords(t.for)} for, ${pctWords(t.against)} against, ${pctWords(t.abstain)} abstaining${names.length > 0 ? `; not yet voted: ${names.join(", ")}` : ""}; it needs ${pctWords(m.quorum)} to take part and more than ${pctWords(m.pass)} of the votes cast for it`;
}

/**
 * What a mind is told of decisions (Your organizations, §29.19-29.20): each open motion they vote
 * on, with what it would do, who put it, when it closes, their votes and their vote so far; and each
 * request waiting on their approval, or theirs that waits. A mind decides only in what it intends:
 * its vote or answer reaches the world when the story tells it.
 */
export function decisionMindLines(ctx: ReadContext, who: EntityId): string[] {
  const cal = calendarOf(ctx.world);
  const out: string[] = [];
  for (const org of orgsWithMotions(ctx.state)) {
    for (const m of motionsOf(ctx.state, org)) {
      if (m.status !== "open" || m.electorate[who] === undefined || ctx.state.clock > m.closes) continue;
      const mine = m.votes[who];
      out.push(`- A vote at ${labelOf(ctx, org)}${m.by !== "" ? `, put by ${refFor(ctx, who, m.by).name}` : ""}: ${m.text}. It closes ${formatStamp(cal, m.closes)}. You hold ${pctWords(m.electorate[who] ?? 0)} of the votes; ${mine ? `you vote ${VOTE_WORDS[mine.vote]}${mine.how === "rule" ? " (your standing vote)" : ""}` : "you haven't voted"}. So far ${standingWords(ctx, m, who)}. How you vote counts only when the story tells it.`);
    }
  }
  for (const org of orgsWithRequests(ctx.state)) {
    if (orgTypeOf(ctx, org) === null) continue;
    for (const r of requestsOf(ctx.state, org)) {
      if (requestState(ctx, r) !== "asked") continue;
      if (r.by === who) out.push(`- You asked approval for ${labelOf(ctx, org)}: ${r.text} (${r.why}). It waits on ${r.approvers.map((a) => refFor(ctx, who, a).name).join(" or ")}.`);
      else if (approversOf(ctx, org, r).includes(who)) out.push(`- ${refFor(ctx, who, r.by).name} asks your approval for ${labelOf(ctx, org)}: ${r.text} (${r.why}). You may approve or deny it; it counts only when the story tells it.`);
    }
  }
  return out;
}

/**
 * The narrator's Quest section (source `decisions`): each open motion the player character votes
 * on or put, and each request they asked or may answer, as they may know it, with how it stands; the
 * latitude that only the story's words record a vote or an answer.
 */
export function decisionNarratorLines(ctx: ReadContext): string[] {
  const pov = ctx.world.pov;
  const cal = calendarOf(ctx.world);
  const out: string[] = [];
  for (const org of orgsWithMotions(ctx.state)) {
    for (const m of motionsOf(ctx.state, org)) {
      if (m.status !== "open" || ctx.state.clock > m.closes || !(m.by === pov || m.party === pov || m.electorate[pov] !== undefined)) continue;
      out.push(`- To a vote at ${labelOf(ctx, org)}: ${m.text}; it closes ${formatStamp(cal, m.closes)}; ${standingWords(ctx, m, pov)}.`);
    }
  }
  for (const org of orgsWithRequests(ctx.state)) {
    if (orgTypeOf(ctx, org) === null) continue;
    for (const r of requestsOf(ctx.state, org)) {
      if (requestState(ctx, r) !== "asked" || !(r.by === pov || approversOf(ctx, org, r).includes(pov))) continue;
      out.push(`- Waiting for approval at ${labelOf(ctx, org)}, asked by ${refFor(ctx, pov, r.by).name}: ${r.text} (${r.why}); ${r.approvers.map((a) => refFor(ctx, pov, a).name).join(" or ")} may approve it.`);
    }
  }
  return out.length > 0 ? [...out, "- Show a vote or an answer only as the player's message and the time that passes cover; never decide one for anyone."] : [];
}

// ---------------------------------------------------------------- the reply's votes and answers

/**
 * What the reply's read is told of decisions (the extract step's open items, beside the plans'): each
 * open motion the player character put or votes on, while votes are read, and each waiting request
 * they asked or may answer, while answers are read, by id, with who may vote or approve, so a fact
 * names one that is there. Anyone the player character can't see is "someone".
 */
export function decisionExtractLines(ctx: ReadContext, read: { votes: boolean; answers: boolean }): string[] {
  const pov = ctx.world.pov;
  const name = (id: EntityId): string => (id === pov ? "the player character" : refFor(ctx, pov, id).name);
  const cal = calendarOf(ctx.world);
  const out: string[] = [];
  for (const org of read.votes ? orgsWithMotions(ctx.state) : []) {
    for (const m of motionsOf(ctx.state, org)) {
      if (m.status !== "open" || ctx.state.clock > m.closes || !povIn(ctx, m)) continue;
      const voters = Object.keys(m.electorate);
      const yet = voters.filter((v) => m.votes[v] === undefined || m.votes[v]?.how === "rule");
      out.push(`- [${m.id}] ${labelOf(ctx, org)} (${org}), motion${m.by !== "" ? ` put by ${name(m.by)}` : ""}: ${m.text} (open until ${formatStamp(cal, m.closes)}; voters: ${voters.map(name).join(", ")}${yet.length > 0 ? `; not yet voted: ${yet.map(name).join(", ")}` : ""})`);
    }
  }
  for (const org of read.answers ? orgsWithRequests(ctx.state) : []) {
    if (orgTypeOf(ctx, org) === null) continue;
    for (const r of requestsOf(ctx.state, org)) {
      if (requestState(ctx, r) !== "asked") continue;
      const approvers = approversOf(ctx, org, r);
      if (r.by !== pov && !approvers.includes(pov)) continue;
      out.push(`- [${r.id}] ${labelOf(ctx, org)} (${org}), request for approval by ${name(r.by)}: ${r.text} (${r.why}); may approve: ${approvers.length > 0 ? approvers.map(name).join(", ") : "no one now"}`);
    }
  }
  return out;
}

function isRejection(v: unknown): v is Rejection {
  return typeof v === "object" && v !== null && "code" in v && "reason" in v;
}

/** A reply's vote fact as the `orgs.vote` it lands as, the story's (no `by`, quoting the reply): the open motion it names by id, the voter among its voters by id or name; or why not. */
function voteArgs(ctx: ReadContext, p: JsonObject): Record<string, JsonValue> | Rejection {
  const said = strOf(p.said).trim();
  if (!statesChange(said)) return { code: "not_stated", reason: "the reply doesn't state it as done" };
  const id = strOf(p.motion).trim();
  const org = orgsWithMotions(ctx.state).find((o) => motionsOf(ctx.state, o).some((m) => m.id === id));
  const m = org === undefined ? undefined : motionsOf(ctx.state, org).find((x) => x.id === id);
  if (org === undefined || !m) return { code: "missing_motion", reason: `no motion ${id || "named"}` };
  const who = entityNamed(ctx, strOf(p.who), (e) => m.electorate[e] !== undefined);
  if (who === null) return { code: "not_voter", reason: `${strOf(p.who).trim() || "No one named"} has no vote on it` };
  return { org, motion: id, who, vote: strOf(p.vote).trim().toLowerCase(), said };
}

/** A reply's approval fact as the `orgs.answer` it lands as, the story's (`approver`, no `by`, quoting the reply): the request it names by id, who answers by id or name, and the answer; or why not. */
function answerArgs(ctx: ReadContext, p: JsonObject): Record<string, JsonValue> | Rejection {
  const said = strOf(p.said).trim();
  if (!statesChange(said)) return { code: "not_stated", reason: "the reply doesn't state it as done" };
  const id = strOf(p.request).trim();
  const org = orgsWithRequests(ctx.state).find((o) => requestsOf(ctx.state, o).some((r) => r.id === id));
  if (org === undefined) return { code: "missing_request", reason: `no request ${id || "named"}` };
  const who = personNamed(ctx, strOf(p.who));
  if (who === null) return { code: "missing_entity", reason: `no one ${strOf(p.who).trim() || "named"} the player character knows` };
  const answer = strOf(p.answer).trim().toLowerCase();
  if (!(ANSWERS as readonly string[]).includes(answer)) return { code: "bad_proposal", reason: `an answer is ${ANSWERS.join(", ")}` };
  return { org, request: id, answer, approver: who, said };
}

/** A channel over a decision fact: validated by resolving its effect as it would land now, applied as that effect. */
function decisionChannel(type: "vote" | "approval", effect: string, argsOf: (ctx: ReadContext, p: JsonObject) => Record<string, JsonValue> | Rejection, resolve: typeof voteEvents): ProposalChannelDef {
  return {
    type,
    boundField: "routine",
    validate: (p, ctx) => {
      const args = argsOf(ctx, p);
      if (isRejection(args)) return args;
      const out = resolve({ ...ctx, rng: createRng(`${type}:${strOf(args.motion) || strOf(args.request)}`), params: {} }, args);
      return Array.isArray(out) ? null : out;
    },
    toEffects: (p, ctx) => {
      const args = argsOf(ctx, p);
      return isRejection(args) ? [] : [{ type: effect, args }];
    },
  };
}

/** The reply's vote channel: someone's vote on an open motion, as the story tells it. */
export const VOTE_CHANNEL = decisionChannel("vote", DECISION_EFFECTS.vote, voteArgs, voteEvents);
/** The reply's approval channel: an answer to a waiting request for approval, as the story tells it. */
export const APPROVAL_CHANNEL = decisionChannel("approval", DECISION_EFFECTS.answer, answerArgs, answerEvents);

/** The words of a vote or an answer on a chip, as the player character's own (`you`) and as someone else's. */
const FACT_VERBS: Readonly<Record<string, readonly [string, string]>> = { for: ["vote for", "votes for"], against: ["vote against", "votes against"], abstain: ["abstain", "abstains"], approve: ["approve", "approves"], deny: ["deny", "denies"], withdraw: ["withdraw the request", "withdraws the request"] };

/**
 * A reply's vote or approval fact as its chip reads it: "Danny Okafor votes for: Issue 100 units …",
 * "Marcus Delgado approves: Paid Priya Nair $600.00". Only names the player character may know.
 */
export function decisionLabel(view: Pick<ReadContext, "registry" | "world" | "state">, p: JsonObject): string {
  const { registry, world, state } = view;
  const said = strOf(p.who).trim();
  const you = said === world.pov;
  const e = own(state.entities, said);
  const who = you ? "You" : e ? (canSeeEntity(registry, world, state, world.pov, said) ? e.name : "Someone") : said || "Someone";
  const vote = p.type === "vote";
  const id = strOf(vote ? p.motion : p.request);
  const text = (vote ? orgsWithMotions(state).flatMap((o) => motionsOf(state, o)) : orgsWithRequests(state).flatMap((o) => requestsOf(state, o))).find((x) => x.id === id)?.text ?? id;
  const verbs = FACT_VERBS[strOf(vote ? p.vote : p.answer).trim().toLowerCase()] ?? (vote ? ["vote", "votes"] : ["answer", "answers"]);
  return `${who} ${verbs[you ? 0 : 1]}: ${text}`;
}

/** The Decisions section, the narrator's `decisions` source and the reply's vote and approval channels; the alerts and Your organizations take theirs through `feed.ts`. */
export function registerDecisions(r: CoreRegistry): void {
  r.orgSection({ id: DECISIONS_SECTION, label: "Decisions", build: (ctx, org, viewer) => buildDecisionsView(ctx, org, viewer) as unknown as JsonValue | null });
  r.renderer({ slot: "quest", source: "decisions", label: "Votes and requests for approval waiting", render: (ctx) => decisionNarratorLines(ctx) });
  r.proposal(VOTE_CHANNEL);
  r.proposal(APPROVAL_CHANNEL);
}
