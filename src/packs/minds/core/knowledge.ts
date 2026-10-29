// What everyone knows (DESIGN §24.11), read from the minds slice: the facts, one person's holdings,
// a fact's holders, whether a holding is only a suspicion, and how a holding reads to a model (a
// mind's What they know, the narrator's Who knows what, the knowledge step's context). A slice
// without knowledge (a chat from before it, or one that never learned anything) reads empty, and so
// does one whose chat switched knowledge off (`knowledgeTracked`). Whose holdings a consumer gets is
// its own view's choice; these readers give whatever they are asked for.

import type { EntityId, MessageId } from "../../../shared/ids";
import type { FactId, Holding, KnowledgeFact, KnowledgeSettings, KnowledgeTextId, MindsSlice } from "../../../shared/minds";
import { fillText, knowledgeText, knowledgeTracked } from "../../../shared/minds";
import { own } from "../../../engine/pack-kit";

type Knowing = Pick<MindsSlice, "knowledge">;

/** Every fact the chat holds, by id. */
export function factsOf(slice: Knowing): Readonly<Record<FactId, KnowledgeFact>> {
  return slice.knowledge?.facts ?? {};
}

/** What one person holds, by fact; none is knowing nothing the chat records. */
export function holdingsOf(slice: Knowing, who: EntityId): Readonly<Record<FactId, Holding>> {
  return own(slice.knowledge?.holdings ?? {}, who) ?? {};
}

/** Who holds a fact, in id order. */
export function knowersOf(slice: Knowing, fact: FactId): EntityId[] {
  const holdings = slice.knowledge?.holdings ?? {};
  return Object.keys(holdings)
    .filter((who) => own(own(holdings, who) ?? {}, fact) !== undefined)
    .sort();
}

/** Whether a holding is a suspicion: held with less confidence than the threshold (Settings → Minds → Knowledge). */
export function isSuspicion(holding: Pick<Holding, "confidence">, threshold: number): boolean {
  return holding.confidence < threshold;
}

/** What one person holds while the chat tracks knowledge; none once it switched it off. */
export function trackedHoldings(slice: Knowing, who: EntityId): Readonly<Record<FactId, Holding>> {
  return knowledgeTracked(slice) ? holdingsOf(slice, who) : {};
}

/** Whether a holding is kept from `who` (from everyone, or from them by name). */
export function keptFromIt(holding: Pick<Holding, "keptFrom">, who: EntityId): boolean {
  return holding.keptFrom === "everyone" || (holding.keptFrom?.includes(who) ?? false);
}

/** The words a holding reads in: the user's knowledge texts, the names of those it names, and the threshold under which it is a suspicion. */
export interface HoldingWords {
  texts: Pick<KnowledgeSettings, "prompts">;
  threshold: number;
  nameOf(id: EntityId): string;
}

/**
 * One holding as a model reads it (DESIGN §24.11): the fact's claim (`claim`, as the consumer may
 * give it) in the template its belief and confidence call for (known, suspected under the threshold,
 * disbelieved, unsure), how they came by it, and whom they keep it from. The same words for a mind,
 * the narrator and the knowledge step, each the user's own wording where they set one.
 */
export function holdingLine(claim: string, h: Holding, words: HoldingWords): string {
  const text = (id: KnowledgeTextId): string => knowledgeText(words.texts, id);
  const how = fillText(text(h.how), { by: h.by === null ? "" : words.nameOf(h.by) });
  const template: KnowledgeTextId = h.belief === "false" ? "disbelieved" : h.belief === "uncertain" ? "unsure" : isSuspicion(h, words.threshold) ? "suspected" : "known";
  const line = fillText(text(template), { claim, how, percent: String(Math.round(h.confidence * 100)) });
  if (h.keptFrom === undefined) return line;
  const whom = h.keptFrom === "everyone" ? text("everyone") : h.keptFrom.map(words.nameOf).join(", ");
  return `${line}; ${fillText(text("keeps"), { whom })}`;
}

/**
 * The chat's latest turns, as their messages, newest first, at most `turns`: those the minds were
 * present for (`minds.presence`) and those someone learned in, so a chat with minds off counts its
 * learning turns. A fact learned in one of them is in play (`inPlayTurns`). Turns at the same game
 * time (none of it passing) go latest recorded first.
 */
export function latestTurns(slice: Pick<MindsSlice, "knowledge" | "presence">, turns: number): Set<MessageId> {
  const seen: { msg: MessageId; at: number }[] = [];
  for (const p of [...slice.presence].reverse()) if (p.msg !== null) seen.push({ msg: p.msg, at: p.at });
  for (const held of Object.values(slice.knowledge?.holdings ?? {}).reverse()) for (const h of Object.values(held).reverse()) if (h.since.msg !== null) seen.push({ msg: h.since.msg, at: h.since.at });
  seen.sort((a, b) => b.at - a.at);
  const out = new Set<MessageId>();
  for (const s of seen) {
    if (out.size >= turns) break;
    out.add(s.msg);
  }
  return out;
}

/**
 * What makes a holding bear on the moment: who and where is here, the latest turns' messages, and
 * which facts the world keeps from the player character (`worldSecrets`), each a secret to whoever
 * holds it as much as one they keep themselves.
 */
export interface InPlay {
  here: readonly string[];
  recent: ReadonlySet<MessageId>;
  secret(id: FactId, fact: KnowledgeFact | undefined): boolean;
}

/**
 * One person's holding as ranked, with why it bears on the moment (DESIGN §24.11, facts in play):
 * it is a secret (one its holder keeps from others, or one the world keeps from the player
 * character), which shapes all they do; it is about someone or somewhere here; it was learned in
 * the latest turns. A holding with none of them isn't in play.
 */
export interface RankedHolding {
  id: FactId;
  fact: KnowledgeFact | undefined;
  holding: Holding;
  secret: boolean;
  about: boolean;
  recent: boolean;
}

/**
 * The order holdings bear on the moment in, most first, whoever holds them: a secret before any
 * other holding, then the one with more of the other two reasons (about someone or somewhere here,
 * learned in the latest turns); among equals the newest, then by fact id. A total order, so the
 * same holdings rank alike in every read and every consumer, and a secret never loses a tie to an
 * ordinary fact on its id.
 */
export function byPlay(a: RankedHolding, b: RankedHolding): number {
  if (a.secret !== b.secret) return a.secret ? -1 : 1;
  return Number(b.about) + Number(b.recent) - Number(a.about) - Number(a.recent) || b.holding.since.at - a.holding.since.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** One person's holdings, the most relevant first (`byPlay`), each with its fact and why it bears on the moment. */
export function rankedHoldings(slice: Knowing, who: EntityId, play: InPlay): RankedHolding[] {
  const facts = factsOf(slice);
  return Object.entries(trackedHoldings(slice, who))
    .map(([id, holding]) => {
      const fact = own(facts, id);
      return {
        id,
        fact,
        holding,
        secret: holding.keptFrom !== undefined || play.secret(id, fact),
        about: fact?.about.some((x) => play.here.includes(x)) ?? false,
        recent: holding.since.msg !== null && play.recent.has(holding.since.msg),
      };
    })
    .sort(byPlay);
}
