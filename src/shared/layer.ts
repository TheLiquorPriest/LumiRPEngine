// The basis-anchored layer (DEPTH-PLAN §4.9): where work that lands between turns lives. Background
// results (mind writes, notebook revisions, the bootstrap's beats, settlements, verdicts, spend) are
// stored outside every record and its hash, keyed by the message and swipe they were made from, and
// fold wherever that basis is on the active chain, right after that message's record, in landing
// order. Landing changes no path, so no record's hash or P1 tag moves; a swipe of the latest reply
// leaves inert only the entries anchored at it, which come back on a switch back.
//
// Stored per chat in userStorage `runs/<chatId>/layer/` (`backend/layer-store.ts`); landed through the
// chat's ledger queue (`backend/ledger-io.ts` `landLayer`), which checks the basis inside the landing
// itself and holds a result that arrives while a turn is in flight until its window closes (P2).

import type { ChatId, GenerationId, MessageId } from "./ids";
import { isRecord } from "./json";
import type { LedgerEvent, PathHash } from "./ledger";
import { isBlobHash } from "./stores";

/**
 * A swipe's identity, which an index can't give (deleting a swipe shifts the rest): `r<seq>` for a
 * swipe holding a turn record (its `Rec.seq`, chat-wide and never reused), else `c<hash>`, the hash
 * of the swipe's text (a user message, or a reply with no record). An assistant edit keeps a
 * record's key; editing a reply with no record gives it a bare record carrying its earlier text, so
 * that key holds too (`engine/ledger/layer.ts` `swipeKeyOf`).
 */
export type SwipeKey = string;

/** The frontier a job read: the deepest message whose content it used. */
export interface Basis {
  message: MessageId;
  swipe: SwipeKey;
  /** The path up to that message when the job read it: an entry whose basis message and swipe are on the chain under another prefix (an earlier edit, a Keep) folds as a rebased view, dropping what no longer fits. */
  parentPath: PathHash;
}

/** One landed entry: immutable once written. */
export interface LayerEntry {
  /**
   * The entry's identity, chosen by its job and deterministic for it (`layerEntryId`): landing an id
   * already landed changes nothing and returns the entry that is there, so a job rerun after a crash
   * never lands twice.
   */
  id: string;
  /** The chat it was landed in: a branch keeps what it inherited as its ancestor landed it, renamed for it (`LayerInherit`). */
  chat: ChatId;
  basis: Basis;
  /** What it holds, for readers and the drawer: `engine.ws.write`, `minds.v2.write`, `story.beat`, `story.settle`, `author.drop`, `author.spend`, ... */
  kind: string;
  /** Validated and applied by the same event types as a record's (the registry's `EventTypeDef`s). Texts in blobs. None only in an entry that only takes others' place. */
  events: LedgerEvent[];
  /** Earlier entries this one replaces (an amendment, a retcon, a bootstrap redo): they stop folding wherever this one folds. */
  supersedes?: string[];
  /** The job's thinking, as a blob, readable in the drawer. */
  reasoning?: string;
  /** Who made it: a role and, optionally, the job that ran. */
  by?: { role: string; job?: string };
  /** Its landing: the sequence of the chat it was landed in (landing order) and the time. */
  landed: { seq: number; at: string };
}

/** What a job hands to `landLayer`: the entry without its landing. */
export type LayerDraft = Omit<LayerEntry, "chat" | "landed">;

/** How a landing went. */
export type LandResult =
  /** Landed now, or already there under this id (`existing`). */
  | { status: "landed"; entry: LayerEntry; existing?: true }
  /** Held: a turn is in flight; it lands, checked again, when every window it waits for has closed. */
  | { status: "held"; waitFor: GenerationId[] }
  /** Refused: its basis isn't on the active chain, or an event failed against the fold at its basis. */
  | { status: "refused"; reason: string };

/** An entry as the store lists it: everything but its events, for cheap resumption and listing. */
export type LayerSummary = Omit<LayerEntry, "events"> & { events: number };

/**
 * What a branch took of an ancestor sharing its run seed, at its first open (DEPTH-PLAN §4.9): every
 * entry the ancestor folded that was landed by the time the branch was made, copied into the
 * branch's own layer with its basis message renamed to the branch's copy (core gives copied
 * messages new ids). The branch never reads its ancestor again.
 */
export interface LayerInherit {
  from: ChatId;
  /** When the branch was made (ISO, the end of the second core made it in): what the ancestor landed by then is inherited. */
  before: string;
  /** Ancestor message id → this chat's copy. */
  messages: Record<MessageId, MessageId>;
}

/** A layer entry as a fold reads it: in landing order, its basis already renamed for this chat. */
export type FoldLayerEntry = Pick<LayerEntry, "id" | "basis" | "events" | "supersedes" | "kind" | "reasoning">;

/** The entry as its folds read it. */
export function foldEntryOf(e: Pick<LayerEntry, "id" | "basis" | "events" | "supersedes" | "kind" | "reasoning">): FoldLayerEntry {
  return { id: e.id, basis: e.basis, kind: e.kind, events: e.events, ...(e.supersedes ? { supersedes: e.supersedes } : {}), ...(e.reasoning ? { reasoning: e.reasoning } : {}) };
}

/** Why `d` can't land as an entry, or null: its id, basis, kind and events must be well formed (each event is validated against the fold when it lands). */
export function layerDraftProblem(d: LayerDraft): string | null {
  if (typeof d.id !== "string" || d.id === "" || d.id.length > 128) return "an entry needs an id (at most 128 characters)";
  const b = d.basis;
  if (!isRecord(b) || typeof b.message !== "string" || b.message === "" || typeof b.swipe !== "string" || !/^[rc]/.test(b.swipe) || typeof b.parentPath !== "string") return "an entry needs its basis: message, swipe and parent path";
  if (typeof d.kind !== "string" || d.kind === "") return "an entry needs its kind";
  const replaces = Array.isArray(d.supersedes) && d.supersedes.length > 0;
  if (!Array.isArray(d.events) || (d.events.length === 0 && !replaces)) return "an entry holds at least one event, or takes others' place";
  if (d.events.some((e) => !isRecord(e) || typeof e.type !== "string")) return "an entry's events must be events";
  if (d.supersedes !== undefined && (!Array.isArray(d.supersedes) || d.supersedes.some((s) => typeof s !== "string" || s === d.id))) return "an entry supersedes other entries, by id";
  if (d.reasoning !== undefined && !isBlobHash(d.reasoning)) return "an entry's reasoning must be a blob";
  return null;
}
