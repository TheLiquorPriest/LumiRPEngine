// A harness turn's part of its record, as it is read (HARNESS-SLICE3: "One record per reply", "Jobs").
// The record of a reply is RPEngine's, and LumiAH's own record of the turn rides inside it
// (`Rec.harness`, `shared/ledger.ts`), so a reply holds one record: LumiAH's anchor for a swipe is
// read from here and written back here. A job a turn's agents started is tied to that turn's record
// by the turn's id; its writes land only while that record is on the chat's path.
//
// Reads are lenient: the part is outside every hash, any metadata writer can change it, and a damaged
// one costs the session link or the job's tie, never the turn's world changes.

import type { MessageId } from "../../shared/ids";
import { isRecord, type JsonObject } from "../../shared/json";
import type { Rec, RecHarness } from "../../shared/ledger";
import type { ChainMessage } from "../../engine/ledger/chain";
import type { LedgerCore } from "../../engine/ledger/journal";
import { activeRecord, isTombstoned } from "../../engine/ledger/path";

/** A record's harness part as stored; null when it has none, or what it holds names no turn (a reply no turn was played for has only its mark, `unplayedOf`). */
export function recHarnessOf(rec: Pick<Rec, "harness"> | null | undefined): RecHarness | null {
  const raw: unknown = rec?.harness;
  if (!isRecord(raw) || !Array.isArray(raw.turns)) return null;
  const turns = raw.turns.filter((t): t is string => typeof t === "string" && t !== "");
  if (turns.length === 0) return null;
  return {
    turns,
    ...(isRecord(raw.record) ? { record: raw.record as JsonObject } : {}),
    ...(typeof raw.defaultTick === "number" && Number.isFinite(raw.defaultTick) && raw.defaultTick > 0 ? { defaultTick: raw.defaultTick } : {}),
    // Kept through a later write of LumiAH's record (a job of the turn ending): only a turn that writes the record again clears it.
    ...(typeof raw.unplayed === "string" && raw.unplayed !== "" ? { unplayed: raw.unplayed } : {}),
  };
}

/** A reply's mark that no turn was played for it, as its record holds it: why, and whether it is about only what a Continue added to a reply a turn was played for (`added`) or the whole reply. Null for a reply with no such mark. */
export function unplayedOf(rec: Pick<Rec, "harness"> | null | undefined): { why: string; added: boolean } | null {
  const raw: unknown = rec?.harness;
  if (!isRecord(raw) || typeof raw.unplayed !== "string" || raw.unplayed === "") return null;
  return { why: raw.unplayed, added: recHarnessOf(rec) !== null };
}

/**
 * LumiAH's own record on a reply's record, where it holds one: of the turn that wrote it, or, on a
 * reply no turn was played for, LumiAH's record that it had no part in it (which names no turn of
 * the engine's, so nothing is tied to it). Null where it holds none.
 */
export function anchorOf(rec: Pick<Rec, "harness"> | null | undefined): JsonObject | null {
  const raw: unknown = rec?.harness;
  return isRecord(raw) && isRecord(raw.record) ? (raw.record as JsonObject) : null;
}

/**
 * Why LumiAH says it had no part in a reply, as its record of that reply holds it (what its backend
 * keeps beside the core's own fields, `ran.noPart.text`): its own words, which say what happened and
 * what to do. Null for a record that says no such thing.
 */
export function noPartOf(record: JsonObject): string | null {
  const ran = record.ran;
  const noPart = isRecord(ran) ? ran.noPart : null;
  return isRecord(noPart) && typeof noPart.text === "string" && noPart.text.trim() !== "" ? noPart.text : null;
}

/** Where a harness turn's record is: its reply, the swipe that holds it, and its place in the chain. */
export interface TurnRecordAt {
  messageId: MessageId;
  swipeId: number;
  index: number;
  rec: Rec;
}

/** Why a turn's record takes no more writes: none names the turn on the swipes the chat shows, or the one that does no longer folds where its turn was played. */
export type OffPath = "unknown" | "off_path";

/**
 * The record of harness turn `turn` on the chat's path as it stands (the journal's ledgers over the
 * messages'), or why none takes its writes. On the path means: its reply is in the chat, the swipe
 * holding it is the one shown, the record was not discarded, and it folds as it was played
 * (`on_path`), which an edit before it, waiting on Keep or Discard or kept as another story, a swipe
 * away, a delete, or a record read on another chain all end.
 */
export function turnRecord(core: LedgerCore, observed: readonly ChainMessage[], turn: string): TurnRecordAt | OffPath {
  const chain = core.chain(observed);
  let known = false;
  for (let index = chain.length - 1; index >= 0; index--) {
    const m = chain[index];
    if (!m || m.isUser) continue;
    for (const [key, stored] of Object.entries(m.ledger?.swipes ?? {})) {
      if (!recHarnessOf(stored)?.turns.includes(turn)) continue;
      known = true;
      const rec = activeRecord(m, core.journal.tombstones);
      if (Number(key) !== m.swipeId || rec !== stored || rec.readElsewhere === true) continue;
      if (core.fold(observed).messages[index]?.fold !== "on_path") continue;
      return { messageId: m.id, swipeId: m.swipeId, index, rec };
    }
  }
  return known ? "off_path" : "unknown";
}

/** The record harness turn `turn` wrote, wherever it is: on a swipe the chat shows or one swiped away, on the path or off it. Null when no record names the turn (it left none, or its message is gone). */
export function findTurn(core: LedgerCore, observed: readonly ChainMessage[], turn: string): { messageId: MessageId; swipeId: number; rec: Rec } | null {
  for (const m of core.chain(observed)) {
    if (m.isUser) continue;
    for (const [key, rec] of Object.entries(m.ledger?.swipes ?? {})) if (recHarnessOf(rec)?.turns.includes(turn)) return { messageId: m.id, swipeId: Number(key), rec };
  }
  return null;
}

/** LumiAH's records on one reply of the chat: the swipe it shows, and LumiAH's record of the turn that wrote each swipe that holds one, by the swipe's number. */
export interface AnchorRow {
  messageId: MessageId;
  swipeId: number;
  swipes: Record<string, JsonObject>;
}

/**
 * LumiAH's records on each reply of the chat, oldest first, read from the records the replies hold
 * (the journal's ledgers over the messages'): every swipe's, since LumiAH keeps a record for each
 * telling of a reply and reads one again when the chat goes back to it. A record discarded with its
 * turn holds none.
 */
export function anchorsOf(core: LedgerCore, observed: readonly ChainMessage[]): AnchorRow[] {
  return core.chain(observed).flatMap((m): AnchorRow[] => {
    if (m.isUser) return [];
    const swipes: Record<string, JsonObject> = {};
    for (const [swipe, rec] of Object.entries(m.ledger?.swipes ?? {})) {
      const record = isTombstoned(core.journal.tombstones, m.id, rec) ? null : anchorOf(rec);
      if (record !== null) swipes[swipe] = record;
    }
    return [{ messageId: m.id, swipeId: m.swipeId, swipes }];
  });
}
