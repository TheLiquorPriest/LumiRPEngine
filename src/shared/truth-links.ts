// The GM's truth links (DEPTH-PLAN §4.4, §5.2): out of world, the GM ties each belief a character
// wrote in its own mind (`minds/<who>/beliefs.md`), and what reached the player character (a beat's
// exposure), to the world-truth fact it concerns, with its reason and the words it read. A character
// agent never sees a fact; the link is the GM's, shown in Minds as the GM's.
//
// The holdings projection: a link folds into today's holdings (`MindsKnowledge.holdings`: how, by,
// belief, confidence, keptFrom, since), so every reader of holdings keeps working unchanged: secret
// gating and the leak check (`heldSecrets`, `engine/visibility.ts`), the minds context's secrets,
// the GM's `mind_knowledge` edit, the agents' `knowledge` tool and What you know. A secret the story
// reveals stops being gated because the GM linked the player character's exposure, or a belief, to
// it. Beside each projected holding the slice keeps the link itself (`MindsKnowledge.links`), so the
// views show the GM's reason. Pure types and readers.

import type { EntityId, MessageId } from "./ids";
import { isRecord } from "./json";
import type { FactId, FactTruth, Holding, HoldingBelief, HoldingHow, KeptFrom } from "./minds";

/** The GM's link events, in the minds pack beside its knowledge events. */
export const TRUTH_EVENTS = {
  /** One holder's belief, or the player character's exposure, linked to a fact, projected into their holding. */
  link: "minds.link",
  /** A link the GM takes back (the belief no longer concerns the fact, or was let go): its holding goes with it. */
  unlink: "minds.unlink",
} as const;

/** What the GM read to make a link: a file of the holder's own mind, or a beat that reached them. */
export type TruthLinkFrom = { mind: string } | { beat: string };

/** A link as the slice keeps it beside the holding it projects. */
export type TruthLink = {
  from: TruthLinkFrom;
  /** The holder's own words the GM read ("I'd swear to it"), or what reached them. */
  words: string;
  /** The GM's reason. */
  why: string;
  msg: MessageId | null;
  at: number;
  /** The holding it projected: taking the link back takes this one only, never one set since. */
  holding: Holding;
};

/**
 * `minds.link`: `who` holds `fact` as the GM read it from `from`: how they came by it (never
 * `authored`: that is the world's design), from whom, what it rests on, what they take it to be and
 * how sure they are (a number the GM derived from their words), and whom they keep it from.
 */
export type LinkEventData = {
  who: EntityId;
  fact: FactId;
  from: TruthLinkFrom;
  words: string;
  why: string;
  how: Exclude<HoldingHow, "authored">;
  by: EntityId | null;
  evidence: FactId[];
  belief: HoldingBelief;
  confidence: number;
  keptFrom?: KeptFrom;
  msg: MessageId | null;
  at: number;
};

/** `minds.unlink`: the GM takes back `who`'s link to `fact`, and the holding it projected. */
export type UnlinkEventData = { who: EntityId; fact: FactId; why: string };

export const LINK_HOWS: readonly LinkEventData["how"][] = ["witnessed", "told", "inferred", "guessed"];

export function isTruthLinkFrom(v: unknown): v is TruthLinkFrom {
  if (!isRecord(v)) return false;
  const keys = Object.keys(v);
  return keys.length === 1 && ((typeof v.mind === "string" && v.mind !== "") || (typeof v.beat === "string" && v.beat !== ""));
}

/**
 * The links the GM made for `who`, by fact, as the minds slice holds them (`state.packs.minds`, as
 * stored); none in a chat that never linked one, or once it stopped tracking knowledge.
 */
export function linksOf(slice: unknown, who: EntityId): Record<FactId, TruthLink> {
  const k = isRecord(slice) ? slice.knowledge : undefined;
  if (!isRecord(k) || k.off === true || !isRecord(k.links)) return {};
  const mine = Object.prototype.hasOwnProperty.call(k.links, who) ? k.links[who] : undefined;
  return isRecord(mine) ? (mine as unknown as Record<FactId, TruthLink>) : {};
}

/** How a belief stands against the truth, as GM → Minds shows a link (§4.4): held as the fact is, against it, unsure, or not linked. */
export function linkVerdict(belief: HoldingBelief | null, truth: FactTruth | null): "true" | "false" | "partly" | "unlinked" {
  if (belief === null || truth === null) return "unlinked";
  if (belief === "uncertain" || truth === "open") return "partly";
  return belief === truth ? "true" : "false";
}
