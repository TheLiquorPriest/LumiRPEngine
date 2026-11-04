// Requests for approval (ORG-SPEC Phase 5; DESIGN §29.20): an act for an organization over a limit of
// the position or delegation its power rests on (each payment, the month, the accounts), by an action
// that asks (`ask`), is put up the requester's chain of command instead of refused (the economy's
// `actAs` calls `orgs.ask_approval`). The request holds the act itself (its effect with the arguments
// as evaluated, `EffectContext.effect`) and who may approve it: only those above the requester,
// nearest first (the delegation's granter, the holders of the positions above theirs, then the
// organization's governors and owners), each within their own limits; never someone else, however
// high their own limit. Approved, the act runs then as the requester's own, the limit lifted by the
// approval (`EffectContext.carried`) and the approver named on its History line, in the approval's
// unit; denied or withdrawn, it closes. A request not answered in its organization's days lapses,
// read when asked. Approving and denying play as turns; the GM answers for anyone, and the reply's
// `approval` fact records an answer the story tells. Bookkeeping in `packs.orgs.asks`.

import { ownersIn } from "../../../shared/finance";
import { hashParts } from "../../../shared/hash";
import type { EntityId } from "../../../shared/ids";
import { isRecord, type JsonObject, type JsonValue } from "../../../shared/json";
import type { LedgerEvent, PackEvent } from "../../../shared/ledger";
import { isOrgPower, type OrgPower } from "../../../shared/org";
import { DECISION_ACTIONS, DECISION_EFFECTS, isRequestStatus, type ApprovalRequest, type RequestState } from "../../../shared/org-motions";
import type { ActionDef, ParamDef } from "../../../shared/world";
import { calendarOf, formatStamp } from "../../../engine/calendar";
import { acts } from "../../../engine/life";
import { directMembers, heldPositions, mayAct, orgPower, positionsOf } from "../../../engine/org";
import { labelOf, objOf, own, sliceOf, sliceRecord, strOf } from "../../../engine/pack-kit";
import type { CoreRegistry, EffectContext, EventTypeDef, ReadContext, Rejection } from "../../../engine/registry";
import { isGone, kindIs } from "../../../engine/scope";
import { canSeeEntity } from "../../../engine/visibility";
import { actNames, orgLog } from "./log";
import { rulesOf } from "./motions";

export const ORGS_ASK = "orgs.ask";
export const ORGS_ANSWER = "orgs.answer";
/** Requests kept per organization: every waiting one (at most 20 at once), and the last 20 answered or lapsed. */
export const ASKS_KEPT = Object.freeze({ open: 20, closed: 20 });

const DAY = 24 * 60;

type Args = Record<string, JsonValue>;

function refuse(code: string, reason: string): Rejection {
  return { code, reason };
}

// ---------------------------------------------------------------- the records

/** A request as `packs.orgs.asks` keeps it; null when it lacks its id, power, words or act. */
export function requestIn(raw: JsonValue | undefined): ApprovalRequest | null {
  if (!isRecord(raw)) return null;
  const what = objOf(raw.what);
  const id = strOf(raw.id);
  if (id === "" || !isOrgPower(raw.power) || strOf(raw.text) === "" || strOf(what.type) === "") return null;
  const answered = objOf(raw.answered);
  const num = (v: JsonValue | undefined): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  return {
    id,
    by: strOf(raw.by),
    power: raw.power,
    ...(num(raw.cents) !== undefined ? { cents: num(raw.cents) } : {}),
    ...(strOf(raw.account) !== "" ? { account: strOf(raw.account) } : {}),
    ...(strOf(raw.target) !== "" ? { target: strOf(raw.target) } : {}),
    text: strOf(raw.text),
    why: strOf(raw.why),
    what: { type: strOf(what.type), args: objOf(what.args) },
    approvers: Array.isArray(raw.approvers) ? raw.approvers.filter((x): x is string => typeof x === "string") : [],
    at: num(raw.at) ?? 0,
    until: num(raw.until) ?? 0,
    status: isRequestStatus(raw.status) ? raw.status : "asked",
    ...(isRecord(raw.answered) ? { answered: { ...(strOf(answered.by) !== "" ? { by: strOf(answered.by) } : {}), at: num(answered.at) ?? 0, ...(strOf(answered.why) !== "" ? { why: strOf(answered.why) } : {}) } } : {}),
  };
}

/** An organization's requests, oldest first. */
export function requestsOf(state: ReadContext["state"], org: EntityId): ApprovalRequest[] {
  const list = objOf(sliceOf(state, "orgs").asks)[org];
  return Array.isArray(list) ? list.flatMap((raw) => requestIn(raw) ?? []) : [];
}

/** The organizations with any request on record, by id. */
export function orgsWithRequests(state: ReadContext["state"]): EntityId[] {
  return Object.keys(objOf(sliceOf(state, "orgs").asks)).sort();
}

/** Where a request stands now: as recorded, or lapsed when it was still asked at its time. */
export function requestState(ctx: Pick<ReadContext, "state">, r: Pick<ApprovalRequest, "status" | "until">): RequestState {
  return r.status === "asked" && ctx.state.clock > r.until ? "lapsed" : r.status;
}

// ---------------------------------------------------------------- who approves

/** What an act asks of a power: its amount, account and whom it is for. */
interface Ask {
  by: EntityId;
  power: OrgPower;
  cents?: number;
  account?: EntityId;
  target?: EntityId;
}

/**
 * The asker's chain of command at `org` (§29.20), nearest first, the asker left out: the granter of
 * the delegation their power rests on; the holders of the positions above theirs, up each one's
 * `reports_to` (the position the power rests on first); then the organization's governors (`org.govern`
 * as an owner or by a position, as Run by reads them) and its owners, by id.
 */
function chainOf(ctx: ReadContext, org: EntityId, ask: Ask): EntityId[] {
  const near: EntityId[] = [];
  const grant = orgPower(ctx, ask.by, org, ask.power);
  if (grant?.basis === "delegate" && grant.id !== undefined) near.push(grant.id);
  const positions = positionsOf(ctx, org);
  const people = [...new Set(directMembers(ctx, org).map((r) => r.who))].sort();
  const held = heldPositions(ctx, ask.by, org).map((h) => h.position.id);
  const starts = grant?.basis === "position" && grant.id !== undefined ? [grant.id, ...held.filter((p) => p !== grant.id)] : held;
  for (const start of starts) {
    const seen = new Set<string>([start]);
    for (let at = positions.find((p) => p.id === start)?.reports_to; at !== undefined && !seen.has(at); at = positions.find((p) => p.id === at)?.reports_to) {
      seen.add(at);
      const up = at;
      near.push(...people.filter((p) => heldPositions(ctx, p, org).some((h) => h.position.id === up)));
    }
  }
  const governors = people.filter((p) => ["owner", "position"].includes(orgPower(ctx, p, org, "org.govern")?.basis ?? ""));
  const top = [...new Set([...governors, ...ownersIn(own(ctx.state.entities, org)?.fields ?? {}).map((o) => o.party)])].sort();
  return [...new Set([...near, ...top])].filter((c) => c !== ask.by);
}

/**
 * Who may approve an act of `ask.by`'s for `org` (§29.20): up their chain of command only (`chainOf`),
 * nearest first, the people there who act and may do it themselves within their own limits (`mayAct`
 * for the same amount, account and payee). No one else may, however high their own limit.
 */
export function approversOf(ctx: ReadContext, org: EntityId, ask: Ask): EntityId[] {
  const limits = { ...(ask.cents !== undefined ? { amount: ask.cents } : {}), ...(ask.account !== undefined ? { account: ask.account } : {}), ...(ask.target !== undefined ? { target: ask.target } : {}) };
  return chainOf(ctx, org, ask).filter((c) => !isGone(ctx.state, c) && kindIs(ctx.registry, ctx.world, own(ctx.state.entities, c)?.kind ?? "", "person") && acts(ctx.world, ctx.state, c) && mayAct(ctx, c, org, ask.power, limits).ok);
}

/** Why `who` may not answer `r` (`approversOf`): it is their own, they aren't up its chain of command, or it is more than they may do themselves. */
function notApprover(ctx: ReadContext, org: EntityId, r: ApprovalRequest, who: EntityId): string {
  if (who === r.by) return "it's their own request";
  return chainOf(ctx, org, r).includes(who) ? `it's more than they may do themselves for ${labelOf(ctx, org)}` : `they aren't above ${labelOf(ctx, r.by)} at ${labelOf(ctx, org)}`;
}

// ---------------------------------------------------------------- words

function nameFor(ctx: ReadContext, viewer: EntityId | undefined, id: EntityId): string {
  if (id === "") return "the GM";
  if (viewer !== undefined && id === viewer) return "you";
  if (viewer !== undefined && !canSeeEntity(ctx.registry, ctx.world, ctx.state, viewer, id)) return "someone";
  return labelOf(ctx, id);
}

/** Whether the player character is in a request: they asked it, or may approve it. */
function povIn(ctx: Pick<ReadContext, "world">, r: Pick<ApprovalRequest, "by" | "approvers">, answerer?: EntityId): boolean {
  const pov = ctx.world.pov;
  return r.by === pov || r.approvers.includes(pov) || answerer === pov;
}

// ---------------------------------------------------------------- asking

/**
 * `orgs.ask_approval` (the economy's `actAs` and share-out, over a limit, when the action asks): the
 * request holding the effect being resolved, and its History line; refused, in the limit's words,
 * when no one may approve it, when the organization has as many waiting as it keeps, or when there is
 * no act to hold.
 */
export function askApproval(ctx: ReadContext, ask: { org: EntityId; by: EntityId; power: OrgPower; cents?: number; account?: EntityId; target?: EntityId; text: string; why: string }): LedgerEvent[] | Rejection {
  const what = (ctx as Partial<EffectContext>).effect;
  if (!what) return refuse("not_allowed", `${ask.why}, and it can't be put up for approval from here`);
  const approvers = approversOf(ctx, ask.org, ask);
  if (approvers.length === 0) return refuse("not_allowed", `${ask.why}, and no one above you may approve it`);
  const all = requestsOf(ctx.state, ask.org);
  if (all.filter((r) => requestState(ctx, r) === "asked").length >= ASKS_KEPT.open) return refuse("too_many", `${labelOf(ctx, ask.org)} has ${ASKS_KEPT.open} requests waiting already`);
  const at = ctx.state.clock;
  const id = `r_${hashParts("orgs.ask", ask.org, ask.by, ask.text, String(at), String(all.length)).slice(0, 10)}`;
  const r: ApprovalRequest = {
    id,
    by: ask.by,
    power: ask.power,
    ...(ask.cents !== undefined ? { cents: Math.round(ask.cents) } : {}),
    ...(ask.account !== undefined ? { account: ask.account } : {}),
    ...(ask.target !== undefined ? { target: ask.target } : {}),
    text: ask.text,
    why: ask.why,
    what: { type: what.type, args: { ...what.args } },
    approvers,
    at,
    until: at + rulesOf(ctx, ask.org).approvalDays * DAY,
    status: "asked",
  };
  const first = approvers[0] ?? "";
  return [
    { type: ORGS_ASK, data: { org: ask.org, request: JSON.parse(JSON.stringify(r)) as JsonObject, visibility: povIn(ctx, r) ? "public" : "secret" } },
    orgLog(ctx, ask.org, `${labelOf(ctx, ask.by)} asked ${labelOf(ctx, first)} to approve: ${ask.text} (${ask.why})`, { by: ask.by, names: [ask.by, first, ...(ask.target !== undefined ? [ask.target] : []), ...actNames(ctx, what)], power: ask.power }),
  ];
}

// ---------------------------------------------------------------- answering

/**
 * `orgs.answer` (§29.20): a waiting request approved, denied or withdrawn. Approving, `by` (or, with
 * no `by`, the `approver` the story names; with neither, the GM) must be among those who may approve
 * it now; the act runs then, as the requester's, under the approval, in this unit. Denying needs an
 * approver too; withdrawing, the requester (a requester's deny is a withdrawal). A lapsed request
 * takes no approval.
 */
export function answerEvents(ctx: EffectContext, a: Args): LedgerEvent[] | Rejection {
  const org = strOf(a.org);
  const r = requestsOf(ctx.state, org).find((x) => x.id === strOf(a.request));
  if (!r) return refuse("missing_request", `${labelOf(ctx, org)} has no request ${strOf(a.request)}`);
  const state = requestState(ctx, r);
  if (state !== "asked") return refuse("closed", state === "lapsed" ? `It lapsed on ${formatStamp(calendarOf(ctx.world), r.until)}` : `That request was ${state} already`);
  const by = strOf(a.by);
  const who = by !== "" ? by : strOf(a.approver);
  const said = strOf(a.said);
  const asked = strOf(a.answer);
  const answer = asked === "deny" && who !== "" && who === r.by ? "withdraw" : asked;
  const why = strOf(a.why).trim().slice(0, 300);
  const at = ctx.state.clock;
  // Whom the act names, so its History line reads "someone" for each one its reader can't see.
  const named = [...(r.target !== undefined ? [r.target] : []), ...actNames(ctx, r.what)];
  const end = (status: "approved" | "denied" | "withdrawn"): LedgerEvent => ({ type: ORGS_ANSWER, data: { org, id: r.id, status, ...(who !== "" ? { by: who } : {}), ...(why !== "" ? { why } : {}), ...(said !== "" ? { said: said.slice(0, 300) } : {}), at, visibility: povIn(ctx, r, who) ? "public" : "secret" } });
  if (answer === "withdraw") {
    if (who !== "" && who !== r.by) return refuse("not_allowed", `Only ${labelOf(ctx, r.by)} may withdraw it`);
    return [end("withdrawn"), orgLog(ctx, org, `${labelOf(ctx, r.by)} withdrew the request: ${r.text}`, { by: r.by, names: [r.by, ...named], power: r.power })];
  }
  if (answer !== "approve" && answer !== "deny") return refuse("bad_args", "A request is approved, denied or withdrawn");
  if (who !== "" && !approversOf(ctx, org, r).includes(who)) return refuse("not_allowed", `${labelOf(ctx, who)} may not ${answer} it: ${notApprover(ctx, org, r, who)}`);
  if (answer === "deny") return [end("denied"), orgLog(ctx, org, `${who !== "" ? labelOf(ctx, who) : "The GM"} denied ${labelOf(ctx, r.by)}'s request: ${r.text}${why !== "" ? `: ${why}` : ""}`, { ...(who !== "" ? { by: who } : {}), names: [r.by, who, ...named].filter((x) => x !== ""), power: r.power })];
  const def = ctx.registry.effects.get(r.what.type);
  if (!def) return refuse("unknown_effect", `this world can't carry out ${r.what.type}`);
  const carried = def.resolve({ ...r.what.args }, { ...ctx, rng: ctx.rng.fork(`approve:${r.id}`), params: {}, effect: { type: r.what.type, args: { ...r.what.args } }, carried: { org, approval: r.id, ...(who !== "" ? { by: who } : {}), ...(r.cents !== undefined ? { cents: r.cents } : {}) } });
  if (!Array.isArray(carried)) return carried;
  return [...carried, end("approved")];
}

// ---------------------------------------------------------------- events

function str(e: PackEvent, key: string): string {
  return strOf(e.data[key]);
}

/**
 * Writes an organization's requests back: every one still waiting, and the last 20 answered or lapsed
 * (a request is lapsed once its time is past, though its record still says asked), so lapsed ones
 * don't pile up.
 */
function writeList(state: Parameters<EventTypeDef<PackEvent>["apply"]>[1], org: EntityId, list: JsonValue[]): void {
  const waiting = (raw: JsonValue): boolean => {
    const r = requestIn(raw);
    return r !== null && requestState({ state }, r) === "asked";
  };
  const open = list.filter(waiting);
  const closed = list.filter((r) => !waiting(r)).slice(-ASKS_KEPT.closed);
  const keep = new Set([...open, ...closed]);
  sliceRecord(state, "orgs", "asks")[org] = list.filter((r) => keep.has(r));
}

function listAt(state: Parameters<EventTypeDef<PackEvent>["apply"]>[1], org: EntityId): JsonValue[] {
  const list = sliceRecord(state, "orgs", "asks")[org];
  return Array.isArray(list) ? list : [];
}

export const APPROVAL_EVENTS: EventTypeDef<PackEvent>[] = [
  {
    // A request opened, whole: its act, the limit it is over, who may approve it and until when.
    type: ORGS_ASK,
    validate: (e, ctx) => {
      const r = requestIn(e.data.request);
      if (str(e, "org") === "" || !r) return refuse("bad_event", "a request needs its organization, power, words and act");
      return requestsOf(ctx.state, str(e, "org")).some((x) => x.id === r.id) ? refuse("bad_event", `request ${r.id} is on record already`) : null;
    },
    apply: (e, state) => {
      const org = str(e, "org");
      writeList(state, org, [...listAt(state, org), e.data.request as JsonValue]);
    },
    describe: (e, ctx, viewer) => {
      const r = requestIn(e.data.request);
      if (!r) return "A request for approval";
      const by = nameFor(ctx, viewer, r.by);
      return `${by.charAt(0).toUpperCase()}${by.slice(1)} asked ${nameFor(ctx, viewer, r.approvers[0] ?? "")} to approve, for ${labelOf(ctx, str(e, "org"))}: ${r.text} (${r.why}).`;
    },
  },
  {
    // A request answered: approved (the act ran with it), denied or withdrawn.
    type: ORGS_ANSWER,
    validate: (e, ctx) => {
      const r = requestsOf(ctx.state, str(e, "org")).find((x) => x.id === str(e, "id"));
      if (!r || r.status !== "asked") return refuse("bad_event", "no such request waiting");
      return ["approved", "denied", "withdrawn"].includes(str(e, "status")) ? null : refuse("bad_event", "a request is approved, denied or withdrawn");
    },
    apply: (e, state) => {
      const org = str(e, "org");
      writeList(
        state,
        org,
        listAt(state, org).map((raw) => (isRecord(raw) && raw.id === str(e, "id") ? { ...raw, status: str(e, "status"), answered: { ...(str(e, "by") !== "" ? { by: str(e, "by") } : {}), at: typeof e.data.at === "number" ? e.data.at : state.clock, ...(str(e, "why") !== "" ? { why: str(e, "why") } : {}) } } : raw)),
      );
    },
    describe: (e, ctx, viewer) => {
      const r = requestsOf(ctx.state, str(e, "org")).find((x) => x.id === str(e, "id"));
      const status = str(e, "status");
      const who = nameFor(ctx, viewer, str(e, "by") || (status === "withdrawn" ? (r?.by ?? "") : ""));
      return `${who.charAt(0).toUpperCase()}${who.slice(1)} ${status === "approved" ? "approved" : status === "denied" ? "denied" : "withdrew"}${r ? ` the request: ${r.text}` : " a request"}.`;
    },
  },
];

// ---------------------------------------------------------------- actions

const ORG_PARAM: ParamDef = { type: "ref", of: { kind: ["business", "household", "group", "trust"] }, label: "Organization" };

const ACTIONS: readonly ActionDef[] = [
  {
    id: DECISION_ACTIONS.approve,
    label: "Approve",
    description: "Approve a request made for an organization over the limit of someone below you there (you granted their delegation, hold a position above theirs, or govern or own it), within your own limits: it is done now, as theirs.",
    pack: "orgs",
    params: { org: ORG_PARAM, request: { type: "text", label: "Request (its id)" } },
    requires: [],
    outcomes: { default: [{ type: DECISION_EFFECTS.answer, args: { org: "org", request: "=params.request", answer: "approve", by: "self" } }] },
    duration: "5",
    lexicon: ["approve it", "sign off on it", "okay the spend"],
    observable: "signs off on something",
  },
  {
    id: DECISION_ACTIONS.deny,
    label: "Deny",
    description: "Deny a request for approval made for an organization (your own request: withdraw it).",
    pack: "orgs",
    params: { org: ORG_PARAM, request: { type: "text", label: "Request (its id)" }, why: { type: "text", optional: true, label: "Why" } },
    requires: [],
    outcomes: { default: [{ type: DECISION_EFFECTS.answer, args: { org: "org", request: "=params.request", answer: "deny", why: "=params.why", by: "self" } }] },
    duration: "5",
    lexicon: ["deny the request", "turn it down", "withdraw my request"],
    observable: "has a word with someone",
  },
];

/** Requests for approval: their events, the service the economy asks, the GM's answer (which the actions play with `by`), and the actions. */
export function registerApprovals(r: CoreRegistry): void {
  for (const def of APPROVAL_EVENTS) r.event(def);
  r.service("orgs.ask_approval", askApproval);
  r.effect({ type: DECISION_EFFECTS.answer, args: ["org", "request", "answer", "why?", "approver?", "said?", "by?"], gm: true, resolve: (a, ctx) => answerEvents(ctx, a) });
  for (const def of ACTIONS) r.action(def);
}
