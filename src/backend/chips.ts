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

/** A stored entry with every field of the type the frontend reads; anything else is dropped (the file comes from storage, not from us). */
function isStoredChip(raw: unknown): raw is StoredChip {
  if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.kind !== "string" || typeof raw.messageId !== "string" || typeof raw.label !== "string" || !isRecord(raw.payload)) return false;
  if (raw.swipeId !== undefined && !Number.isInteger(raw.swipeId)) return false;
  if (raw.detail !== undefined && typeof raw.detail !== "string") return false;
  if (raw.expires !== "next_send" && raw.expires !== "never") return false;
  return Array.isArray(raw.actions) && raw.actions.every((a) => isRecord(a) && typeof a.id === "string" && typeof a.label === "string" && (a.style === undefined || a.style === "primary" || a.style === "danger"));
}

export class ChipStore {
  /** Chips by `user \0 chat`: one user's cache never answers another. */
  private readonly chips = new Map<string, StoredChip[]>();

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
    this.chips.set(
      this.key(chatId, userId),
      list.filter((c) => c.expires !== "next_send"),
    );
    await this.save(chatId, userId);
    return gone;
  }

  /** Chips on messages that no longer exist go. */
  async prune(chatId: ChatId, userId: UserId, alive: ReadonlySet<MessageId>): Promise<void> {
    const list = await this.list(chatId, userId);
    const kept = list.filter((c) => alive.has(c.messageId));
    if (kept.length === list.length) return;
    this.chips.set(this.key(chatId, userId), kept);
    await this.save(chatId, userId);
  }
}
