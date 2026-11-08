// The GM's truth links and the holdings projection (DEPTH-PLAN §4.4; `shared/truth-links.ts`). A
// link folds into the holding it projects: the holder's hold on the fact, whole, in place of any
// they had, so every reader of holdings (secret gating and the leak check through `heldSecrets`, the
// minds context's secrets, the GM's `mind_knowledge` edit, the `knowledge` tool, What you know)
// reads it unchanged. Beside it the slice keeps the link: what the GM read, its reason, and the
// holding it projected, so taking the link back takes only that holding, never one a learning or
// the GM's own edit set since. Each apply reads only its own data, the minds slice and who exists.

import type { JsonValue } from "../../../shared/json";
import { isRecord } from "../../../shared/json";
import type { PackEvent } from "../../../shared/ledger";
import type { Holding } from "../../../shared/minds";
import { isWitnessRef } from "../../../shared/minds";
import { isTruthLinkFrom, LINK_HOWS, TRUTH_EVENTS, type TruthLink } from "../../../shared/truth-links";
import { own } from "../../../engine/pack-kit";
import type { EventTypeDef, ReadContext, Rejection } from "../../../engine/registry";
import { holdingOf, isHolding } from "./events";
import { readKnowledge, readSlice, writeKnowledge } from "./state";

const str = (v: JsonValue | undefined): v is string => typeof v === "string";

function bad(reason: string): Rejection {
  return { code: "bad_event", reason };
}

/** The holding a link projects, as its data carries it (`since` is its message and clock). */
function linkedHolding(d: Readonly<Record<string, JsonValue | undefined>>): JsonValue {
  return { how: d.how ?? null, by: d.by ?? null, evidence: d.evidence ?? null, since: { msg: d.msg ?? null, at: d.at ?? null }, belief: d.belief ?? null, confidence: d.confidence ?? null, ...(d.keptFrom !== undefined ? { keptFrom: d.keptFrom } : {}) };
}

/** Whether two holdings are the same hold, field by field. */
function sameHolding(a: Holding, b: Holding): boolean {
  const kept = (h: Holding): string => (h.keptFrom === undefined ? "" : h.keptFrom === "everyone" ? "everyone" : [...h.keptFrom].sort().join("\u0000"));
  return a.how === b.how && a.by === b.by && a.belief === b.belief && a.confidence === b.confidence && a.since.msg === b.since.msg && a.since.at === b.since.at && kept(a) === kept(b) && [...a.evidence].sort().join("\u0000") === [...b.evidence].sort().join("\u0000");
}

function nameOf(ctx: ReadContext, id: string): string {
  if (id === ctx.world.pov) return "the player character";
  return own(ctx.state.entities, id)?.name ?? id;
}

function claimOf(ctx: ReadContext, fact: JsonValue | undefined): string {
  const f = str(fact) ? own(readKnowledge(ctx.state).facts, fact) : undefined;
  return f ? `“${f.claim}”` : "a fact";
}

const BELIEF_WORDS: Record<Holding["belief"], string> = { true: "taken as true", false: "taken as false", uncertain: "unsure" };

/**
 * `minds.link`: the GM's link of one holder's belief, or of what reached the player character, to a
 * fact the minds hold. The holder is in the world; the teller and those it's kept from are in the
 * world and aren't the holder; what it rests on are facts the minds hold, never itself; it is never
 * `authored` (the world's design holds those); and the GM gives its reason.
 */
const linking: EventTypeDef<PackEvent> = {
  type: TRUTH_EVENTS.link,
  validate: (e, ctx) => {
    const d = e.data;
    if (!str(d.who) || own(ctx.state.entities, d.who) === undefined) return { code: "missing_entity", reason: "a link names a holder in the world" };
    const k = readKnowledge(ctx.state);
    if (!str(d.fact) || own(k.facts, d.fact) === undefined) return { code: "missing_fact", reason: "a link names a fact the minds hold" };
    const h = linkedHolding(d);
    if (!isHolding(h) || !LINK_HOWS.some((how) => how === h.how)) return bad("a link needs how they came by it (witnessed, told, inferred or guessed; one told names its teller), its evidence, its message and clock, the belief, a confidence from 0 to 1 and whom it's kept from, if anyone");
    if (!isTruthLinkFrom(d.from) || !str(d.words) || !str(d.why) || d.why.trim() === "") return bad("a link says what the GM read (a mind file or a beat), the words it read, and why");
    if (h.by !== null && (own(ctx.state.entities, h.by) === undefined || h.by === d.who)) return { code: "missing_entity", reason: "a link's teller is in the world, and isn't its holder" };
    if (Array.isArray(h.keptFrom) && h.keptFrom.some((id) => own(ctx.state.entities, id) === undefined || id === d.who)) return { code: "missing_entity", reason: "those a link is kept from are in the world, and never its holder" };
    if (h.evidence.some((ref) => ref === d.fact || (!isWitnessRef(ref) && own(k.facts, ref) === undefined))) return { code: "missing_fact", reason: "a link rests on facts the minds hold, never on itself" };
    return null;
  },
  apply: (e, state) => {
    const d = e.data;
    const h = linkedHolding(d);
    if (!str(d.who) || !str(d.fact) || !isHolding(h) || !isTruthLinkFrom(d.from) || own(readKnowledge(state).facts, d.fact) === undefined || own(state.entities, d.who) === undefined) return;
    const k = writeKnowledge(state);
    const holding = holdingOf(h, d.who);
    const held = own(k.holdings, d.who) ?? {};
    held[d.fact] = holding;
    k.holdings[d.who] = held;
    const links = k.links ?? {};
    const mine = own(links, d.who) ?? {};
    const link: TruthLink = { from: "mind" in d.from ? { mind: d.from.mind } : { beat: d.from.beat }, words: str(d.words) ? d.words : "", why: str(d.why) ? d.why : "", msg: holding.since.msg, at: holding.since.at, holding: holdingOf(holding, d.who) };
    mine[d.fact] = link;
    links[d.who] = mine;
    k.links = links;
  },
  describe: (e, ctx, viewer) => {
    if (viewer !== undefined) return "";
    const d = e.data;
    const h = linkedHolding(d);
    const who = str(d.who) ? nameOf(ctx, d.who) : "someone";
    const from = isRecord(d.from) && str(d.from.beat) ? "what reached them" : "their belief";
    if (!isHolding(h)) return `The GM linked ${who}'s ${from} to ${claimOf(ctx, d.fact)}`;
    return `The GM linked ${who}'s ${from} to ${claimOf(ctx, d.fact)} (${BELIEF_WORDS[h.belief]}, ${Math.round(h.confidence * 100)}% sure)`;
  },
};

/**
 * `minds.unlink`: the GM takes back a link it made, with its reason. The holding it projected goes
 * with it; one a learning or the GM's own edit set since stays, as theirs.
 */
const unlinking: EventTypeDef<PackEvent> = {
  type: TRUTH_EVENTS.unlink,
  validate: (e, ctx) => {
    const d = e.data;
    if (!str(d.who) || !str(d.fact) || !str(d.why) || d.why.trim() === "") return bad("taking a link back names its holder and fact, and why");
    const links = readSlice(ctx.state).knowledge?.links;
    return links && own(own(links, d.who) ?? {}, d.fact) ? null : { code: "missing_holding", reason: "the GM made no such link" };
  },
  apply: (e, state) => {
    const d = e.data;
    if (!str(d.who) || !str(d.fact)) return;
    const link = own(own(readSlice(state).knowledge?.links ?? {}, d.who) ?? {}, d.fact);
    if (!link) return;
    const k = writeKnowledge(state);
    const held = own(k.holdings, d.who);
    const h = held ? own(held, d.fact) : undefined;
    if (held && h && sameHolding(h, link.holding)) {
      delete held[d.fact];
      // Someone who holds nothing has no entry, as if they never held anything.
      if (Object.keys(held).length === 0) delete k.holdings[d.who];
    }
    const links = k.links ?? {};
    const mine = own(links, d.who);
    if (mine) {
      delete mine[d.fact];
      if (Object.keys(mine).length === 0) delete links[d.who];
    }
    if (Object.keys(links).length === 0) delete k.links;
    else k.links = links;
  },
  describe: (e, ctx, viewer) => (viewer !== undefined ? "" : `The GM took back ${str(e.data.who) ? nameOf(ctx, e.data.who) : "someone"}'s link to ${claimOf(ctx, e.data.fact)}`),
};

export const TRUTH_EVENT_DEFS: readonly EventTypeDef<PackEvent>[] = [linking, unlinking];
