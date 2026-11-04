// Winding up and merging a company (ORG-SPEC §3.13, Phase 5): `org_wind_up` and `org_merge`, each
// played as a turn, its one effect one unit (L41). Either is an ownership decision: whoever decides
// holds `org.govern` and more than the company's threshold of its votes, deciding as themselves or as
// an organization holding it that they govern (`economy.decider`); a merger needs that of both
// companies. Short of the votes, an action that asks (`vote`) puts it to a vote instead (`putToVote`),
// carried out once the company's motion passes. With no `by` (the GM, an agent's org op) no power or
// votes are asked. The economy settles the money (`economy.wind_up`, `economy.merge`); here is what
// is the organization's own: at the finish its members' links and the delegations to it end; in a
// merger its positions join the survivor's, its members move over in them and its delegations end;
// and both companies' Histories tell it.

import type { EntityId } from "../../../shared/ids";
import type { JsonObject, JsonValue } from "../../../shared/json";
import type { LedgerEvent } from "../../../shared/ledger";
import { PARTY_KINDS } from "../../../shared/finance";
import { ACTS_FOR, ORG_ACTIONS, WIND_PROPERTY, WIND_STAGES, WINDING_FIELD, type Position } from "../../../shared/org";
import { VOTE_PARAM } from "../../../shared/org-motions";
import { orgTypeOf, positionsOf, windingUpSince } from "../../../engine/org";
import { labelOf, numOf, optionalQuery, optionalService, own, strOf } from "../../../engine/pack-kit";
import type { CoreRegistry, EffectContext, ReadContext, Rejection } from "../../../engine/registry";
import { linkEvents } from "../../../engine/relations";
import { COMPANY_KIND, MEMBER_OF } from "../../../engine/selector";
import { Working } from "../../../engine/working";
import { orgLog } from "./log";
import { putToVote } from "./motions";
import { plainWords, withWhy } from "./ops";

function refuse(code: string, reason: string): Rejection {
  return { code, reason };
}

function isRejection<T>(v: T | Rejection): v is Rejection {
  return typeof v === "object" && v !== null && !Array.isArray(v) && "code" in v && "reason" in v;
}

/** The links of `rel` that point at `org`, from whom and with what fields, in id order. */
function linksTo(ctx: ReadContext, rel: string, org: EntityId): { from: EntityId; fields: JsonObject }[] {
  return Object.keys(ctx.state.entities)
    .sort()
    .flatMap((id) => (own(ctx.state.entities, id)?.relations ?? []).filter((r) => r.type === rel && r.to === org).map((r) => ({ from: id, fields: r.fields ?? {} })));
}

/**
 * Who decides for `org` when `by` acts (the economy's `economy.decider`), or why no one may. Short of
 * the votes, an action that asks (`vote`) puts it to a vote instead (ORG-SPEC Phase 5, `putToVote`):
 * the motion's events, `what` its words. The company's motion that passed carries it out with no
 * decision asked (`EffectContext.carried`).
 */
function decide(ctx: EffectContext, by: EntityId, org: EntityId, doing: string, what: string): { party: EntityId } | LedgerEvent[] | Rejection {
  if (by !== "" && ctx.carried?.motion !== undefined && ctx.carried.org === org) return { party: by };
  const decider = optionalQuery(ctx, "economy.decider");
  if (!decider) return refuse("no_money", "a company's ownership needs the economy");
  const decided = decider(ctx, by, org, "org.govern", doing);
  if (!isRejection(decided) || decided.code !== "votes") return decided;
  return putToVote(ctx, { org, by, party: by, text: what, why: decided.reason }) ?? decided;
}

/** The History lines a step said, on `org`, by `by` when someone did it. */
function linesOf(ctx: ReadContext, org: EntityId, said: readonly { text: string; names: EntityId[] }[], by: EntityId): LedgerEvent[] {
  return said.map((s) => orgLog(ctx, org, s.text, { ...(by !== "" ? { by } : {}), ...(s.names.length > 0 ? { names: s.names } : {}), power: "org.govern" }));
}

/**
 * `orgs.wind_up` (§3.13): a company begun winding up (it stops trading), finished (settled, paid out
 * and dissolved, begun first where it hasn't been), all at once (the same), or resumed (it trades
 * again; its staff and standing payments stay ended). At the finish its members' links and every
 * delegation to it end. Its History tells each step, with the reason given.
 */
function windUpEvents(ctx: EffectContext, a: Record<string, JsonValue>): LedgerEvent[] | Rejection {
  const org = strOf(a.org);
  const name = labelOf(ctx, org);
  if (orgTypeOf(ctx, org) !== "company") return refuse("not_company", `${name} isn't a company`);
  const stage = WIND_STAGES.find((s) => s === strOf(a.stage, "all"));
  if (stage === undefined) return refuse("bad_stage", `winding up is ${WIND_STAGES.join(", ")}`);
  const property = WIND_PROPERTY.find((p) => p === strOf(a.property, "distribute"));
  if (property === undefined) return refuse("bad_property", `its property is ${WIND_PROPERTY.join(" or ")}`);
  const by = strOf(a.by);
  const why = plainWords(strOf(a.why));
  const what = { all: `Wind up ${name}`, begin: `Begin winding up ${name}`, finish: `Finish winding up ${name}`, resume: `Stop winding up ${name}` }[stage];
  const decider = decide(ctx, by, org, stage === "resume" ? "Resuming" : "Winding up", what);
  if (Array.isArray(decider) || isRejection(decider)) return decider;
  const holder = decider.party !== by && decider.party !== "" ? decider.party : null;
  const credit = by !== "" ? { by } : {};
  if (stage === "resume") {
    if (windingUpSince(ctx.state, org) === null) return refuse("not_winding", `${name} isn't winding up`);
    return [{ type: "set", entity: org, field: WINDING_FIELD, value: null }, orgLog(ctx, org, withWhy("Stopped winding up: it trades again", why), { ...credit, power: "org.govern" })];
  }
  const money = optionalService(ctx, "economy.wind_up");
  if (!money) return refuse("no_money", "winding up a company needs the economy");
  const result = money(ctx, org, { stage: stage === "begin" ? "begin" : "finish", property, to: strOf(a.to) });
  if (isRejection(result)) return result;
  const w = new Working(ctx.registry, ctx.world, ctx.state);
  for (const e of result.events) {
    const failed = w.apply(e);
    if (failed) return failed;
  }
  const ends: LedgerEvent[] =
    stage === "begin"
      ? []
      : [MEMBER_OF, ACTS_FOR].flatMap((rel) =>
          linksTo(w.ctx, rel, org).map((l): LedgerEvent => ({ type: "unlink", rel, from: l.from, to: org })),
        );
  const said = stage === "begin" ? result.said : [...result.said, { text: "Dissolved", names: [] }];
  const lines = linesOf(ctx, org, said.map((s, i) => (i === 0 ? { ...s, text: withWhy(s.text, why) } : s)), by);
  const told = holder !== null ? [orgLog(ctx, holder, `${name}: ${stage === "begin" ? "began winding up" : "wound up and dissolved"}`, { ...credit, names: [org], power: "org.govern" })] : [];
  return [...result.events, ...ends, ...lines, ...told];
}

/**
 * The positions `org` brings to `into` in a merger: the survivor's own where the title matches,
 * each other one added (its id made unique, its report and default following), and the id each of
 * `org`'s positions becomes; `positions` null when nothing is added.
 */
function mergedPositions(ctx: ReadContext, org: EntityId, into: EntityId): { positions: Position[] | null; map: Record<string, string> } {
  const mine = positionsOf(ctx, into);
  const key = (title: string): string => title.trim().toLowerCase().replace(/\s+/g, " ");
  const map: Record<string, string> = {};
  const added: Position[] = [];
  const taken = new Set(mine.map((p) => p.id));
  for (const p of positionsOf(ctx, org)) {
    const same = mine.find((m) => key(m.title) === key(p.title));
    if (same) {
      map[p.id] = same.id;
      continue;
    }
    let id = p.id;
    for (let n = 2; taken.has(id); n++) id = `${p.id}_${n}`;
    taken.add(id);
    map[p.id] = id;
    added.push(p);
  }
  if (added.length === 0) return { positions: null, map };
  const hasDefault = mine.some((m) => m.default === true);
  const brought = added.map((p): Position => {
    const { default: isDefault, reports_to: reports, ...rest } = p;
    return { ...rest, id: map[p.id] ?? p.id, ...(reports !== undefined ? { reports_to: map[reports] ?? reports } : {}), ...(isDefault === true && !hasDefault ? { default: true } : {}) };
  });
  return { positions: [...mine, ...brought], map };
}

/**
 * `orgs.merge` (§3.13): `org` folded into `into`, its holders paid in `into`'s units at `ratio` (by
 * value unless given) and any `cash` from `into`'s account `from`; its positions join the survivor's,
 * its members move over in them, its delegations end, and it is dissolved as merged. With `keep`,
 * `into` takes all of it as its subsidiary instead and nothing else moves. Both companies decide.
 */
function mergeEvents(ctx: EffectContext, a: Record<string, JsonValue>): LedgerEvent[] | Rejection {
  const org = strOf(a.org);
  const into = strOf(a.into);
  const name = labelOf(ctx, org);
  const intoName = labelOf(ctx, into);
  for (const id of [org, into]) if (orgTypeOf(ctx, id) !== "company") return refuse("not_company", `${labelOf(ctx, id)} isn't a company`);
  if (org === into) return refuse("same", `${name} can't merge with itself`);
  const keep = a.keep === true;
  const by = strOf(a.by);
  const why = plainWords(strOf(a.why));
  // One motion carries it, the company's whose votes fell short; the other company decides as it is carried out.
  const what = keep ? `${intoName} takes over ${name} as its subsidiary` : `Merge ${name} into ${intoName}`;
  const theirs = decide(ctx, by, org, keep ? "Selling the whole of" : "Merging", what);
  if (Array.isArray(theirs) || isRejection(theirs)) return theirs;
  const ours = decide(ctx, by, into, keep ? "Taking over a company for" : "Merging into", what);
  if (Array.isArray(ours) || isRejection(ours)) return ours;
  const money = optionalService(ctx, "economy.merge");
  if (!money) return refuse("no_money", "merging companies needs the economy");
  const { positions, map } = keep ? { positions: null, map: {} } : mergedPositions(ctx, org, into);
  const result = money(ctx, org, into, { ...(typeof a.ratio === "number" ? { ratio: a.ratio } : {}), ...(typeof a.cash === "number" ? { cash: Math.round(numOf(a.cash)) } : {}), ...(strOf(a.from) !== "" ? { from: strOf(a.from) } : {}), keep, positions: map });
  if (isRejection(result)) return result;
  const w = new Working(ctx.registry, ctx.world, ctx.state);
  const apply = (events: readonly LedgerEvent[]): Rejection | null => {
    for (const e of events) {
      const failed = w.apply(e);
      if (failed) return failed;
    }
    return null;
  };
  const moneyFailed = apply(result.events);
  if (moneyFailed) return moneyFailed;
  if (!keep) {
    // Its positions join the survivor's; its members move over in them; delegations to it end.
    if (positions) {
      const failed = apply([{ type: "set", entity: into, field: "positions", value: positions as unknown as JsonValue }]);
      if (failed) return failed;
    }
    for (const l of linksTo(w.ctx, MEMBER_OF, org)) {
      const failed = apply([{ type: "unlink", rel: MEMBER_OF, from: l.from, to: org }]);
      if (failed) return failed;
      if (l.from === into || (own(w.ctx.state.entities, l.from)?.relations ?? []).some((r) => r.type === MEMBER_OF && r.to === into)) continue;
      const position = strOf(l.fields.position);
      const fields: JsonObject = { ...l.fields, ...(position !== "" ? { position: map[position] ?? position } : {}) };
      const linked = linkEvents(w.ctx.registry, w.ctx.world, w.ctx.state, { rel: MEMBER_OF, from: l.from, to: into, fields });
      if (isRejection(linked)) return linked;
      const failedLink = apply(linked);
      if (failedLink) return failedLink;
    }
    for (const l of linksTo(w.ctx, ACTS_FOR, org)) {
      const failed = apply([{ type: "unlink", rel: ACTS_FOR, from: l.from, to: org }]);
      if (failed) return failed;
    }
  }
  const credit = by !== "" ? { by } : {};
  const lines = [
    ...linesOf(ctx, into, result.said.map((s, i) => (i === 0 ? { ...s, text: withWhy(s.text, why) } : s)), by),
    orgLog(ctx, org, withWhy(keep ? `Became ${intoName}'s subsidiary` : `Merged into ${intoName}, and dissolved`, why), { ...credit, names: [], power: "org.govern" }),
    ...[theirs.party, ours.party].filter((p, i, all) => p !== "" && p !== by && p !== org && p !== into && all.indexOf(p) === i).map((p) => orgLog(ctx, p, `${name} ${keep ? `became ${intoName}'s subsidiary` : `merged into ${intoName}`}`, { ...credit, power: "org.govern" })),
  ];
  return [...w.events, ...lines];
}

/** Winding up and merging (§3.13, §3.17 `org_wind_up`, `org_merge`): their effects (the GM's too, §7.2) and actions, each played as a turn (§4.6). */
export function registerWind(r: CoreRegistry): void {
  r.effect({ type: "orgs.wind_up", args: ["org", "stage?", "property?", "to?", "why?", "by?"], gm: true, resolve: (a, ctx) => windUpEvents(ctx, a) });
  r.effect({ type: "orgs.merge", args: ["org", "into", "ratio?", "cash?", "from?", "keep?", "why?", "by?"], gm: true, resolve: (a, ctx) => mergeEvents(ctx, a) });
  r.action({
    id: ORG_ACTIONS.windUp,
    label: "Wind up a company",
    description: `Close a company down (from Money 3), all at once or in stages: begin (it stops trading: its staff go, its standing payments end), sell what you choose as the company, then finish (its debts paid, its holdings sold, its real estate and stakes handed to its owners by share or sold, the rest of its cash paid out to them by share, its accounts closed, it dissolved); or resume trading. Stage: ${WIND_STAGES.join(", ")}.`,
    pack: "orgs",
    params: {
      org: { type: "ref", ref: COMPANY_KIND, label: "Company" },
      stage: { type: "text", optional: true, label: `Stage (${WIND_STAGES.join(", ")}); left out, all at once` },
      property: { type: "text", optional: true, label: "Its real estate and stakes: distribute (to its owners by share) or sell" },
      to: { type: "ref", optional: true, of: { kind: [...PARTY_KINDS] }, label: "Its things and vehicles go to (else its largest owner)" },
      vote: VOTE_PARAM,
    },
    requires: ["level.money >= 3"],
    outcomes: { default: [{ type: "orgs.wind_up", args: { org: "org", stage: "=params.stage", property: "=params.property", to: "=params.to", by: "actor" } }] },
    duration: "60",
    lexicon: ["wind up the company", "close the business down", "dissolve the company", "shut the business for good", "liquidate the company"],
    observable: "signs the closing papers",
  });
  r.action({
    id: ORG_ACTIONS.merge,
    label: "Merge companies",
    description: "Fold one company into another (from Money 3): its holders get the other's units at a ratio (by their values unless you say) and any cash it pays, and its accounts, property, staff and positions move over; or, kept, the other takes all of it as its subsidiary. You decide for both, with more than half the votes of each (yours, or an organization's you govern).",
    pack: "orgs",
    params: {
      org: { type: "ref", ref: COMPANY_KIND, label: "The company merging in (or taken over)" },
      into: { type: "ref", ref: COMPANY_KIND, label: "The company it merges into (or that takes it over)" },
      ratio: { type: "number", optional: true, label: "Units of the second for each unit of the first (else by their values)" },
      cash: { type: "money", optional: true, label: "Cash to the first's holders, in all" },
      from: { type: "ref", ref: "account", optional: true, label: "Cash from (the second's account)" },
      keep: { type: "bool", optional: true, label: "Keep it as a subsidiary instead of folding it in" },
      vote: VOTE_PARAM,
    },
    requires: ["level.money >= 3"],
    outcomes: { default: [{ type: "orgs.merge", args: { org: "org", into: "into", ratio: "=params.ratio", cash: "=params.cash", from: "=params.from", keep: "=params.keep", by: "actor" } }] },
    duration: "60",
    lexicon: ["merge the companies", "fold it into", "take over the company", "buy out the company", "acquire the business"],
    observable: "signs merger papers",
  });
}
