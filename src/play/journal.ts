// The Journal's notes from the chat's own turns (plan §14, PlanChatUI-P1 item 6): for each reply on the chat's path with a turn
// tied to it, what the turn recorded and the player may read (the engine's lines as his character knows them, and each beat the
// story wrote), and what it recorded that took no effect, with why. Newest turns last, as the Journal lists them; a long chat
// gives the newest `most` turns at a time. A read only, from the store's own changes and tree.

import { playerLines } from "../engine/player-events";
import { isRecord } from "../shared/json";
import type { JournalNote } from "../shared/ledger";
import { JoinedTurnError, type ChangeRow, type Store } from "../store";
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

/**
 * The Journal's notes for the newest `most` turns of the chat's path, oldest first.
 * `code` words a report's code (the page's words for it); a code with none reads as the code.
 */
export function journalNotes(store: Store, user: string, chat: string, most: number, code: (code: string) => string = (c) => c): JournalNote[] {
  const s = store.user(user);
  if (s.chat(chat) === null) return [];
  const turns = s.path(chat).filter((entry) => !entry.user && entry.turn !== null);
  const notes: JournalNote[] = [];
  for (const entry of turns.slice(-Math.max(1, most))) {
    if (entry.turn === null) continue;
    try {
      const view = s.viewAt(entry.turn);
      const changes = s.changes(entry.turn);
      const applied = changes.filter((c) => c.applied);
      const events = applied.filter((c) => c.lane === "engine").flatMap((c) => eventOf(c.op, c.value) ?? []);
      const lines = events.length === 0 ? [] : playerLines(store.env.registry, view.world, view.state.world, view.world.pov, events, events.length);
      for (const text of [...lines, ...beatsOf(applied)]) notes.push({ kind: "note", messageId: entry.message, ref: null, text });
      for (const change of changes) if (!change.applied) notes.push({ kind: "dropped", messageId: entry.message, ref: null, text: reasonOf(change, code) });
    } catch (error) {
      // A turn joined to another is shown under the one it joined, never read twice.
      if (!(error instanceof JoinedTurnError)) throw error;
    }
  }
  return notes;
}
