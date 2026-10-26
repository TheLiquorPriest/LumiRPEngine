// Stored chips (DESIGN §11, §12): confirm proposals, declines and D4 mode changes. They live in
// `userStorage/runs/<chatId>/chips.json` until acted on, or until the next send for the ones that
// lapse. Chips derived from the fold (Re-read edit, Retry, Keep report, pending) are built by the
// view, not stored.

import type { ChatId, ChipId, MessageId, UserId } from "../shared/ids";
import { runDir } from "../shared/ids";
import type { JsonObject } from "../shared/json";
import { isRecord } from "../shared/json";
import type { Chip } from "../shared/state-view";
import type { HostPort } from "./host";
import { readStoredJson } from "./stored-json";

export interface StoredChip extends Chip {
  /** What acting on the chip needs (a proposal, a mode change). Never sent to the frontend. */
  payload: JsonObject;
}

/** A chip action's input as stored: an amount (with an optional starting amount) or a list of options. */
function isChipInput(raw: unknown): boolean {
  if (!isRecord(raw) || typeof raw.label !== "string") return false;
  if (raw.type === "money") return raw.value === undefined || Number.isSafeInteger(raw.value);
  return raw.type === "choice" && Array.isArray(raw.options) && raw.options.every((o) => isRecord(o) && typeof o.value === "string" && typeof o.label === "string");
}

/** A stored entry with every field of the type the frontend reads; anything else is dropped (the file comes from storage, not from us). */
function isStoredChip(raw: unknown): raw is StoredChip {
  if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.kind !== "string" || typeof raw.messageId !== "string" || typeof raw.label !== "string" || !isRecord(raw.payload)) return false;
  if (raw.swipeId !== undefined && !Number.isInteger(raw.swipeId)) return false;
  if (raw.detail !== undefined && typeof raw.detail !== "string") return false;
  if (raw.expires !== "next_send" && raw.expires !== "never") return false;
  if (raw.as !== undefined && raw.as !== "regenerate" && raw.as !== "continue" && raw.as !== "send") return false;
  return Array.isArray(raw.actions) && raw.actions.every((a) => isRecord(a) && typeof a.id === "string" && typeof a.label === "string" && (a.style === undefined || a.style === "primary" || a.style === "danger") && (a.input === undefined || isChipInput(a.input)));
}

export class ChipStore {
  /** Chips by `user \0 chat`: one user's cache never answers another. */
  private readonly chips = new Map<string, StoredChip[]>();
  /** The chips each chat's latest lapse took, by `user \0 chat`: a turn sent after it may still read them (`recent`), a message sent again in its place included. */
  private readonly lapsed = new Map<string, StoredChip[]>();

  constructor(private readonly host: HostPort) {}

  private path(chatId: ChatId): string {
    return `${runDir(chatId)}chips.json`;
  }

  private key(chatId: ChatId, userId: UserId): string {
    return `${userId}\u0000${chatId}`;
  }

  async list(chatId: ChatId, userId: UserId): Promise<StoredChip[]> {
    const known = this.chips.get(this.key(chatId, userId));
    if (known) return known;
    const raw = await readStoredJson(this.host, this.path(chatId), userId, "chips", Array.isArray);
    const list = Array.isArray(raw) ? raw.filter(isStoredChip) : [];
    this.chips.set(this.key(chatId, userId), list);
    if (this.chips.size > 256) this.chips.delete(this.chips.keys().next().value ?? "");
    return list;
  }

  private async save(chatId: ChatId, userId: UserId): Promise<void> {
    const path = this.path(chatId);
    await this.host.storage.write(`${path}.tmp`, JSON.stringify(this.chips.get(this.key(chatId, userId)) ?? []), userId);
    await this.host.storage.move(`${path}.tmp`, path, userId);
  }

  /** Adds chips; one with the id of a stored chip replaces it, so a repeated read never duplicates a chip. */
  async add(chatId: ChatId, userId: UserId, chips: StoredChip[]): Promise<void> {
    if (chips.length === 0) return;
    const list = await this.list(chatId, userId);
    for (const chip of chips) {
      const at = list.findIndex((c) => c.id === chip.id);
      if (at >= 0) list[at] = chip;
      else list.push(chip);
    }
    await this.save(chatId, userId);
  }

  async take(chatId: ChatId, userId: UserId, id: ChipId): Promise<StoredChip | null> {
    const list = await this.list(chatId, userId);
    const index = list.findIndex((c) => c.id === id);
    if (index < 0) return null;
    const [chip] = list.splice(index, 1);
    await this.save(chatId, userId);
    return chip ?? null;
  }

  /** Removes the chips `drop` matches (a read that replaces an earlier one drops that read's chips). */
  async removeWhere(chatId: ChatId, userId: UserId, drop: (chip: StoredChip) => boolean): Promise<void> {
    const list = await this.list(chatId, userId);
    const kept = list.filter((c) => !drop(c));
    if (kept.length === list.length) return;
    this.chips.set(this.key(chatId, userId), kept);
    await this.save(chatId, userId);
  }

  /** The next send: chips that lapse there go (DESIGN §11, confirm chips until the next send). */
  async lapse(chatId: ChatId, userId: UserId): Promise<StoredChip[]> {
    const list = await this.list(chatId, userId);
    const gone = list.filter((c) => c.expires === "next_send");
    if (gone.length === 0) return [];
    const key = this.key(chatId, userId);
    this.lapsed.delete(key);
    this.lapsed.set(key, gone);
    if (this.lapsed.size > 256) this.lapsed.delete(this.lapsed.keys().next().value ?? "");
    this.chips.set(
      key,
      list.filter((c) => c.expires !== "next_send"),
    );
    await this.save(chatId, userId);
    return gone;
  }

  /**
   * A chip by id, stored or taken by the chat's latest lapse: the turn a send starts reads what the
   * reply before it left (its Send chip, DESIGN §5.2), whether or not that send's lapse ran first,
   * and so does a message sent again after one deleted. Ids name their message, so an older lapse's
   * chip never answers for another reply.
   */
  async recent(chatId: ChatId, userId: UserId, id: ChipId): Promise<StoredChip | null> {
    const stored = (await this.list(chatId, userId)).find((c) => c.id === id);
    return stored ?? this.lapsed.get(this.key(chatId, userId))?.find((c) => c.id === id) ?? null;
  }

  /** Chips on messages that no longer exist go. */
  async prune(chatId: ChatId, userId: UserId, alive: ReadonlySet<MessageId>): Promise<void> {
    const list = await this.list(chatId, userId);
    const kept = list.filter((c) => alive.has(c.messageId));
    if (kept.length === list.length) return;
    this.chips.set(this.key(chatId, userId), kept);
    await this.save(chatId, userId);
  }

  /**
   * A swipe of `messageId` was deleted (the host shifts the swipes after it down; DESIGN §4.3 swipe
   * identity): its chips go, and the chips of the swipes after it move down with them, as the
   * ledger's records do. A turn's chip names its swipe in its id, so that id moves too
   * (`idAfterSwipeDelete`) and a chip a later swipe makes at the old index can't replace it. Returns
   * the ids of the chips that went, for the notes tied to them.
   */
  async shiftSwipes(chatId: ChatId, userId: UserId, messageId: MessageId, deleted: number): Promise<Set<ChipId>> {
    const list = await this.list(chatId, userId);
    const dropped = new Set<ChipId>();
    let changed = false;
    // Changed in place: an `add` or `take` already holding this list keeps writing to the same one.
    for (let i = list.length - 1; i >= 0; i--) {
      const c = list[i];
      if (!c || c.messageId !== messageId || c.swipeId === undefined || c.swipeId < deleted) continue;
      changed = true;
      if (c.swipeId === deleted) {
        dropped.add(c.id);
        list.splice(i, 1);
      } else list[i] = { ...c, id: idAfterSwipeDelete(c.id, messageId, deleted) ?? c.id, swipeId: c.swipeId - 1 };
    }
    // What the latest lapse took of the message goes too: its ids may now name another swipe.
    const key = this.key(chatId, userId);
    const lapsed = this.lapsed.get(key);
    if (lapsed?.some((c) => c.messageId === messageId)) this.lapsed.set(key, lapsed.filter((c) => c.messageId !== messageId));
    if (changed) await this.save(chatId, userId);
    return dropped;
  }
}

/**
 * A chip's or a note's id after a swipe of `messageId` was deleted. An id that names one of its swipes
 * (`<kind>:<message>:<swipe>`, then `:…` or nothing, as a turn's chips and an unfit decline's note
 * do): null for the deleted swipe, the swipe before it for a later one. Any other id (one keyed by
 * its generation) stays as it is.
 */
export function idAfterSwipeDelete(id: string, messageId: MessageId, deleted: number): string | null {
  const head = `:${messageId}:`;
  for (let at = id.indexOf(head); at >= 0; at = id.indexOf(head, at + 1)) {
    const from = at + head.length;
    const digits = /^\d+/.exec(id.slice(from))?.[0];
    const end = from + (digits?.length ?? 0);
    if (digits === undefined || (end < id.length && id[end] !== ":")) continue;
    const swipe = Number(digits);
    if (swipe < deleted) return id;
    return swipe === deleted ? null : `${id.slice(0, from)}${swipe - 1}${id.slice(end)}`;
  }
  return id;
}
