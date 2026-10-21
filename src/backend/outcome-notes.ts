// Notes for the next turn's Outcome slot (DESIGN §9.5: "the next Outcome slot says so"): a declined
// payment, an action that couldn't apply, a contradicted fact. Each comes from the reply that
// produced it and is told to the next turn and its swipes, then dropped. They are kept in
// `userStorage/runs/<chatId>/outcome-notes.json`, so a restart between the reply and the next turn
// still tells that turn.

import type { ChatId, MessageId, UserId } from "../shared/ids";
import { runDir } from "../shared/ids";
import { isRecord } from "../shared/json";
import type { HostPort } from "./host";
import { readStoredJson } from "./stored-json";

export interface OutcomeNote {
  id: string;
  /** The reply that produced the note. */
  messageId: MessageId;
  text: string;
  /** The message the note was first told to (its swipes are told too). */
  toldTo?: MessageId;
}

function isOutcomeNote(raw: unknown): raw is OutcomeNote {
  return isRecord(raw) && typeof raw.id === "string" && typeof raw.messageId === "string" && typeof raw.text === "string" && (raw.toldTo === undefined || typeof raw.toldTo === "string");
}

export class OutcomeNotes {
  /** Notes by `user \0 chat`: one user's cache never answers another. */
  private readonly notes = new Map<string, OutcomeNote[]>();
  /** How many times each `user \0 chat`'s notes changed in this process: a reply the engine prepared from older notes is stale (DESIGN §5.1). */
  private readonly changes = new Map<string, number>();

  constructor(private readonly host: HostPort) {}

  /** The chat's notes' revision in this process (a freshness input of the guard's). */
  revision(chatId: ChatId, userId: UserId): number {
    return this.changes.get(`${userId}\u0000${chatId}`) ?? 0;
  }

  private path(chatId: ChatId): string {
    return `${runDir(chatId)}outcome-notes.json`;
  }

  /** The chat's pending notes (a copy; `save` replaces them). */
  async list(chatId: ChatId, userId: UserId): Promise<OutcomeNote[]> {
    const key = `${userId}\u0000${chatId}`;
    let known = this.notes.get(key);
    if (!known) {
      const raw = await readStoredJson(this.host, this.path(chatId), userId, "Outcome notes", Array.isArray);
      known = this.notes.get(key) ?? (Array.isArray(raw) ? raw.filter(isOutcomeNote).map((n) => ({ id: n.id, messageId: n.messageId, text: n.text, ...(n.toldTo !== undefined ? { toldTo: n.toldTo } : {}) })) : []);
      this.notes.set(key, known);
      if (this.notes.size > 256) this.notes.delete(this.notes.keys().next().value ?? "");
    }
    return known.map((n) => ({ ...n }));
  }

  async save(chatId: ChatId, userId: UserId, notes: readonly OutcomeNote[]): Promise<void> {
    const key = `${userId}\u0000${chatId}`;
    const before = this.notes.get(key);
    if (before && JSON.stringify(before) === JSON.stringify(notes)) return;
    this.notes.delete(key);
    this.notes.set(key, notes.map((n) => ({ ...n })));
    if (this.notes.size > 256) this.notes.delete(this.notes.keys().next().value ?? "");
    const changed = (this.changes.get(key) ?? 0) + 1;
    this.changes.delete(key);
    this.changes.set(key, changed);
    if (this.changes.size > 1024) this.changes.delete(this.changes.keys().next().value ?? "");
    const path = this.path(chatId);
    await this.host.storage.write(`${path}.tmp`, JSON.stringify(notes), userId);
    await this.host.storage.move(`${path}.tmp`, path, userId);
  }
}
