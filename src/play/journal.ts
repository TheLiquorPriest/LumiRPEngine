// The Journal's notes from the chat's own turns (plan §14, PlanChatUI-P1 item 6): for each reply on the chat's path with a turn
// tied to it, what the turn recorded and the player may read (the engine's lines as his character knows them, and each beat the
// story wrote), and what it recorded that took no effect, with why. Newest turns last, as the Journal lists them; a long chat
// gives the newest `most` turns at a time. A read only, from the store's own changes and tree.
//
// A turn's notes are worked out from the state at its end, once for as long as that state stands: they are kept under the store's own
// key for it (`UserStore.foldKey`, which every change to what that fold reads renews) and the words they were worded in, and no state
// is held for them. Working them out lets RPE's thread go every so often (`inStretches`), so the first read of a long chat holds it no
// longer than that at a time.

import { playerLines } from "../engine/player-events";
import { linesOf, type HistoryTexts } from "../iface/history-lines";
import { isRecord } from "../shared/json";
import type { JournalNote } from "../shared/ledger";
import { withLines } from "../shared/lines";
import { inStretches, JoinedTurnError, type ChangeRow, type PathEntry, type Store, type UserStore } from "../store";
import { eventOf } from "../store/fold";

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

/** Each turn's notes as last worked out, by the store's key for the state at the turn and the words; the least recently read go first past `KEPT`. */
const kept = new Map<string, JournalNote[]>();
const KEPT = 4096;

/** One turn's notes: kept ones while its state and the words stand, else worked out from the state at its end and kept. A joined turn has none. */
function notesOf(store: Store, s: UserStore, entry: PathEntry, words: JournalWords): JournalNote[] {
  const turn = entry.turn;
  if (turn === null) return [];
  try {
    const key = `${s.foldKey(turn)}\u0000${entry.message}\u0000${words.key}`;
    const hit = kept.get(key);
    if (hit !== undefined) {
      kept.delete(key);
      kept.set(key, hit);
      return hit;
    }
    const view = s.viewAt(turn);
    const changes = s.changes(turn);
    const applied = changes.filter((c) => c.applied);
    const events = applied.filter((c) => c.lane === "engine").flatMap((c) => eventOf(c.op, c.value) ?? []);
    const lines = events.length === 0 ? [] : playerLines(store.env.registry, view.world, view.state.world, view.world.pov, events, events.length);
    const notes: JournalNote[] = [];
    for (const text of [...lines, ...beatsOf(applied)]) notes.push({ kind: "note", messageId: entry.message, ref: null, text });
    for (const change of changes) if (!change.applied) notes.push({ kind: "dropped", messageId: entry.message, ref: null, text: reasonOf(change, words.code) });
    kept.set(key, notes);
    for (const oldest of kept.keys()) {
      if (kept.size <= KEPT) break;
      kept.delete(oldest);
    }
    return notes;
  } catch (error) {
    // A turn joined to another is shown under the one it joined, never read twice.
    if (!(error instanceof JoinedTurnError)) throw error;
    return [];
  }
}

/** The Journal's notes for the newest `most` turns of the chat's path, oldest first, worded in `words`. */
export async function journalNotes(store: Store, user: string, chat: string, most: number, words: JournalWords): Promise<JournalNote[]> {
  const s = store.user(user);
  if (s.chat(chat) === null) return [];
  const turns = s.path(chat).filter((entry) => !entry.user && entry.turn !== null);
  const lines = linesOf(words.texts);
  // Oldest first, so each turn's state folds on from the one before it.
  const notes = await inStretches(turns.slice(-Math.max(1, most)), (entry) => notesOf(store, s, entry, words), (stretch) => withLines(lines, stretch));
  return notes.flat();
}
