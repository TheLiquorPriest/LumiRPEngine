// The Journal's notes from the chat's own turns (plan §14, PlanChatUI-P1 item 6): for each reply on the chat's path with a turn
// tied to it, what the turn recorded and the player may read (the engine's lines as his character knows them, and each beat the
// story wrote), and what it recorded that took no effect, with why. Newest turns last, as the Journal lists them; a long chat
// gives the newest `most` turns at a time. A read only, from the store's own changes and tree. No part of the state view: the Journal
// reads them on their own route (`GET /api/v1/chats/:chat/state/journal`) when it opens and again as the state it shows changes, so
// no view waits for them.
//
// A turn's notes are worked out from the state at its end, once for as long as that state stands, and stored with the turn's node
// (`store/turn-reads.ts`), under what words them (the wording of the code, `NOTES_WORDING`, and the packs'; the reply; the words). A read
// takes them from memory (by the turn's mark, `turnMark`, and what words them), else from the node's row, before anything is folded, so a
// restart works out only the turns whose node holds no row in these words; what it works out is stored in a write of its own that the
// read does not wait for. Working them out lets RPE's thread go every so often (`inStretches`), so the first read of a long chat holds it
// no longer than that at a time.

import { playerLines } from "../engine/player-events";
import { linesOf, type HistoryTexts } from "../iface/history-lines";
import { hashParts } from "../shared/hash";
import { isRecord } from "../shared/json";
import type { JournalNote } from "../shared/ledger";
import { withLines } from "../shared/lines";
import { inStretches, JoinedTurnError, type ChangeRow, type PathEntry, type Store, type UserStore } from "../store";
import { eventOf } from "../store/fold";
import { type KeepTurnReads, storedTurnReads, type TurnReadMade, turnMark } from "../store/turn-reads";

/** Why a change took no effect, in a person's words: the rule's own words where a report brought them, else the report's code worded by `code`. */
function reasonOf(change: ChangeRow, code: (code: string) => string): string {
  const said = change.reports.flatMap((r) => (typeof r.values?.why === "string" ? [r.values.why] : [code(r.code)]));
  return [...new Set(said.filter((words) => words !== ""))].join(" ");
}

/** The beats a turn's story lane wrote: each the text of an item written as a beat. */
function beatsOf(changes: readonly ChangeRow[]): string[] {
  return changes.flatMap((c) => (c.lane === "story" && isRecord(c.value) && c.value.part === "beat" && isRecord(c.value.value) && typeof c.value.value.text === "string" ? [c.value.value.text] : []));
}

/** The words the notes are worded in: the chat's history lines (the engine's lines), a report's code in the page's words, and what names both. */
export interface JournalWords {
  texts: HistoryTexts;
  code: (code: string) => string;
  /** Names these words: notes kept under other words are worked out again. */
  key: string;
}

/**
 * The version of the code that words a turn's notes (this file's, and the engine's player lines, `playerLines`): bumped by whoever
 * changes how a note is worded, so notes stored under an earlier wording are worked out again.
 */
export const NOTES_WORDING = 1;

/** Each store's notes as last worked out or read from their rows, by their key (`noteKey`); the least recently read go first past `KEPT`. */
const keptBy = new WeakMap<Store, Map<string, JournalNote[]>>();
const KEPT = 4096;

function keptOf(store: Store): Map<string, JournalNote[]> {
  let kept = keptBy.get(store);
  if (kept === undefined) {
    kept = new Map();
    keptBy.set(store, kept);
  }
  return kept;
}

/** Holds a turn's notes in memory as the most recently read. */
function hold(kept: Map<string, JournalNote[]>, key: string, notes: JournalNote[]): void {
  kept.delete(key);
  kept.set(key, notes);
  for (const oldest of kept.keys()) {
    if (kept.size <= KEPT) break;
    kept.delete(oldest);
  }
}

/** The wording the notes' keys name beside the words: this code's (`NOTES_WORDING`) and each pack's version. */
function wordingOf(store: Store): string {
  return hashParts("journal-notes", String(NOTES_WORDING), ...store.env.registry.packs.map((p) => `${p.id}@${p.version}`));
}

/**
 * Where a turn's notes are kept: in memory under the turn's mark and what words them (`held`), in the node's row under what words them
 * (`worded`). Null for a turn with none: one joined to another is shown under the one it joined, never read twice.
 */
function noteAt(s: UserStore, entry: PathEntry, words: JournalWords, wording: string): { mark: string; held: string; worded: string } | null {
  if (entry.turn === null) return null;
  const worded = `${wording}\u0000${entry.message}\u0000${words.key}`;
  try {
    const mark = turnMark(s, entry.turn);
    return { mark, held: `${mark}\u0000${worded}`, worded };
  } catch (error) {
    if (!(error instanceof JoinedTurnError)) throw error;
    return null;
  }
}

/** One turn's notes: those held in memory, else worked out from the state at its end, held, and put in `made` to be stored with its node. */
function notesOf(store: Store, s: UserStore, entry: PathEntry, words: JournalWords, wording: string, made: Map<string, TurnReadMade>): JournalNote[] {
  const at = noteAt(s, entry, words, wording);
  if (at === null || entry.turn === null) return [];
  const kept = keptOf(store);
  const hit = kept.get(at.held);
  if (hit !== undefined) {
    hold(kept, at.held, hit);
    return hit;
  }
  const view = s.viewAt(entry.turn);
  const changes = s.changes(entry.turn);
  const applied = changes.filter((c) => c.applied);
  const events = applied.filter((c) => c.lane === "engine").flatMap((c) => eventOf(c.op, c.value) ?? []);
  const lines = events.length === 0 ? [] : playerLines(store.env.registry, view.world, view.state.world, view.world.pov, events, events.length);
  const notes: JournalNote[] = [];
  for (const text of [...lines, ...beatsOf(applied)]) notes.push({ kind: "note", messageId: entry.message, ref: null, text });
  for (const change of changes) if (!change.applied) notes.push({ kind: "dropped", messageId: entry.message, ref: null, text: reasonOf(change, words.code) });
  hold(kept, at.held, notes);
  const node = s.turn(entry.turn)?.node;
  if (node !== undefined) made.set(entry.turn, { node, mark: at.mark, key: at.worded, value: JSON.stringify(notes) });
  return notes;
}

/**
 * The Journal's notes for the newest `most` turns of the chat's path, oldest first, worded in `words`; those worked out here are given to
 * `keep` to be stored with their turns (none stored without it).
 */
export async function journalNotes(store: Store, user: string, chat: string, most: number, words: JournalWords, keep?: KeepTurnReads): Promise<JournalNote[]> {
  const s = store.user(user);
  if (s.chat(chat) === null) return [];
  const turns = s.path(chat).filter((entry) => !entry.user && entry.turn !== null);
  const lines = linesOf(words.texts);
  const asked = turns.slice(-Math.max(1, most));
  const kept = keptOf(store);
  const wording = wordingOf(store);
  // The turns whose notes memory does not hold are read from their nodes' rows, before anything is folded: after a restart, every turn's
  // notes stored in these words.
  const missing = new Map<string, { node: string; held: string; worded: string }>();
  for (const entry of asked) {
    const at = noteAt(s, entry, words, wording);
    const node = entry.turn === null ? undefined : s.turn(entry.turn)?.node;
    if (at !== null && entry.turn !== null && node !== undefined && !kept.has(at.held)) missing.set(entry.turn, { node, ...at });
  }
  if (missing.size > 0) {
    const stored = storedTurnReads(store, user, "notes", [...missing.values()].map((m) => m.node));
    for (const [turn, m] of missing) {
      const row = stored.get(m.node);
      if (row?.key !== m.worded) continue;
      hold(kept, m.held, JSON.parse(row.value) as JournalNote[]);
      missing.delete(turn);
    }
  }
  // The first state a note neither held nor stored reads is folded where a long fold runs on a worker thread (`Store.afar`): after a
  // restart no state is held, and its fold reads a snapshot whole.
  const cold = asked.find((entry) => entry.turn !== null && missing.has(entry.turn))?.turn ?? null;
  if (cold !== null) await store.afar(() => s.stateAt(cold));
  // Oldest first, so each turn's state folds on from the one before it.
  const made = new Map<string, TurnReadMade>();
  const notes = await inStretches(asked, (entry) => notesOf(store, s, entry, words, wording, made), (stretch) => withLines(lines, stretch));
  keep?.(store, user, "notes", made);
  return notes.flat();
}
