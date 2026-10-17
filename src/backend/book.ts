// The engine-managed lore book per world (DESIGN §4.2, D11): "LumiRPEngine · <World>", one slot
// entry per section, stored `disabled:true, key:[]` so nothing activates natively; only the
// interceptor enables them, with content rendered from the fold (DESIGN §6.3) and chat-depth
// placement (§6.4). The book is attached to world chats through `chat_world_book_ids`. It holds
// slots only: world lore stays in the world document, and copies an earlier build synced into
// the book are removed.

import type { ChatId, SlotId, UserId } from "../shared/ids";
import { isRecord } from "../shared/json";
import { LEDGER_NAMESPACE } from "../shared/ledger";
import { neutralizeMacros } from "../shared/macros";
import type { SectionTemplate, WorldDoc, WorldIndex } from "../shared/world";
import type { HostBookEntry, HostPort, PlacementOverride } from "./host";
import type { WorldStore } from "./worlds";

/** Sections a world gets when it defines none (DESIGN §4.2 slot list); lower rank is kept first. */
export const DEFAULT_SECTIONS: Record<SlotId, SectionTemplate> = {
  outcome: { id: "outcome", label: "Outcome", rank: 0, template: "{{lines}}", position: { type: "chat_depth", role: "system", depth: 0, direction: "from_end" } },
  montage: { id: "montage", label: "Montage", rank: 1, template: "{{lines}}", position: { type: "chat_depth", role: "system", depth: 0, direction: "from_end" } },
  scene: { id: "scene", label: "Scene", rank: 2, template: "{{lines}}", position: { type: "chat_depth", role: "system", depth: 1, direction: "from_end" } },
  people: { id: "people", label: "People", rank: 3, template: "{{lines}}", position: { type: "chat_depth", role: "system", depth: 1, direction: "from_end" } },
  money: { id: "money", label: "Money", rank: 4, template: "{{lines}}", position: { type: "chat_depth", role: "system", depth: 2, direction: "from_end" } },
  gear: { id: "gear", label: "Gear", rank: 5, template: "{{lines}}", position: { type: "chat_depth", role: "system", depth: 2, direction: "from_end" } },
  vehicles: { id: "vehicles", label: "Vehicles", rank: 6, template: "{{lines}}", position: { type: "chat_depth", role: "system", depth: 2, direction: "from_end" } },
  quest: { id: "quest", label: "Quest", rank: 7, template: "{{lines}}", position: { type: "chat_depth", role: "system", depth: 3, direction: "from_end" } },
  outline: { id: "outline", label: "Outline", rank: 8, template: "{{lines}}", position: { type: "chat_depth", role: "system", depth: 0, direction: "from_end" } },
};

export function sectionsOf(world: WorldDoc): SectionTemplate[] {
  const own = Object.values(world.sections);
  return (own.length > 0 ? own : Object.values(DEFAULT_SECTIONS)).sort((a, b) => a.rank - b.rank);
}

/** The host placement for a section, or null to keep native placement (outlets, native). */
export function placementOf(section: SectionTemplate): PlacementOverride | null {
  const p = section.position;
  return p.type === "chat_depth" ? { type: "chat_depth", role: p.role, depth: p.depth, direction: p.direction } : null;
}

/** The slot an engine-book entry carries in its extension data. */
export function slotOfEntry(extensions: Readonly<Record<string, unknown>>): SlotId | null {
  const ns = extensions[LEDGER_NAMESPACE];
  return isRecord(ns) && typeof ns.slot === "string" ? ns.slot : null;
}

/** The world lore id an engine-book entry carries, if it is a lore entry an earlier build synced into the book. */
export function loreOfEntry(extensions: Readonly<Record<string, unknown>>): string | null {
  const ns = extensions[LEDGER_NAMESPACE];
  return isRecord(ns) && typeof ns.lore === "string" ? ns.lore : null;
}

export class EngineBook {
  /** bookId → slot → entry id */
  private readonly slots = new Map<string, Map<SlotId, string>>();

  constructor(
    private readonly host: HostPort,
    private readonly worlds: WorldStore,
  ) {}

  /**
   * Creates the world's book if it has none (or it was deleted) and a slot entry per section, and
   * deletes the world lore copies an earlier build synced into it: lore is no longer delivered, and
   * those copies (secret ones included) shouldn't sit in a host-visible book. The world document
   * keeps the lore.
   */
  async ensure(world: WorldDoc, index: WorldIndex, userId: UserId): Promise<string> {
    let bookId = index.loreBookId;
    if (!bookId || !(await this.host.books.exists(bookId, userId))) {
      bookId = await this.host.books.create(`LumiRPEngine · ${world.name}`, "Engine-managed slots. Entries here are activated only by LumiRPEngine.", userId);
      await this.worlds.setLoreBook(world.id, bookId, userId);
    }
    // Read the book afresh: a slot entry deleted in the host's UI is recreated.
    const existing = new Map<SlotId, string>();
    const leftoverLore: string[] = [];
    for (const e of await this.host.books.entries(bookId, userId)) {
      const slot = slotOfEntry(e.extensions);
      if (slot) existing.set(slot, e.id);
      else if (loreOfEntry(e.extensions) !== null) leftoverLore.push(e.id);
    }
    this.slots.set(bookId, existing);
    for (const section of sectionsOf(world)) {
      if (existing.has(section.id)) continue;
      const placement = placementOf(section);
      const id = await this.host.books.createEntry(
        bookId,
        {
          comment: `LRE · ${section.label}`,
          content: "",
          keys: [],
          disabled: true,
          constant: false,
          position: placement ? 4 : 0,
          depth: placement?.depth ?? 4,
          role: placement?.role ?? "system",
          order: 100 + section.rank,
          extensions: { [LEDGER_NAMESPACE]: { slot: section.id } },
        },
        userId,
      );
      existing.set(section.id, id);
    }
    for (const id of leftoverLore) await this.host.books.deleteEntry(id, userId);
    return bookId;
  }

  async slotEntries(bookId: string, userId: UserId): Promise<Map<SlotId, string>> {
    const known = this.slots.get(bookId);
    if (known) return known;
    const map = new Map<SlotId, string>();
    for (const e of await this.host.books.entries(bookId, userId)) {
      const slot = slotOfEntry(e.extensions);
      if (slot) map.set(slot, e.id);
    }
    this.slots.set(bookId, map);
    return map;
  }

  /** Appends the book to the chat's `chat_world_book_ids` (read-merge-write). */
  async attach(chatId: ChatId, bookId: string, userId: UserId): Promise<void> {
    const meta = await this.host.chats.chatMetadata(chatId, userId);
    const ids = Array.isArray(meta.chat_world_book_ids) ? meta.chat_world_book_ids.filter((x): x is string => typeof x === "string") : [];
    if (ids.includes(bookId)) return;
    await this.host.chats.mergeChatMetadata(chatId, { chat_world_book_ids: [...ids, bookId] }, userId);
  }

  async detach(chatId: ChatId, bookId: string, userId: UserId): Promise<void> {
    const meta = await this.host.chats.chatMetadata(chatId, userId);
    const ids = Array.isArray(meta.chat_world_book_ids) ? meta.chat_world_book_ids.filter((x): x is string => typeof x === "string") : [];
    if (!ids.includes(bookId)) return;
    await this.host.chats.mergeChatMetadata(chatId, { chat_world_book_ids: ids.filter((id) => id !== bookId) }, userId);
  }

  /** The book's entries (for import and linking). */
  entries(bookId: string, userId: UserId): Promise<HostBookEntry[]> {
    return this.host.books.entries(bookId, userId);
  }
}

/** A section's text: the authored template (which may hold only `{{lines}}`, linted) around neutralized lines. */
export function renderSection(label: string, template: string, lines: readonly string[]): string {
  const list = lines.map((l) => `- ${neutralizeMacros(l)}`).join("\n");
  const parts = template.split("{{lines}}").map(neutralizeMacros);
  const body = parts.length > 1 ? parts.join(list) : `${parts[0] ?? ""}\n${list}`;
  return `[${neutralizeMacros(label)}]\n${body}`;
}

/**
 * Token estimate for the section budget. Conservative (3.2 characters per token): against the
 * host's own counts the old 4-per-token estimate ran 4–17 tokens short per section.
 */
export function tokensOf(text: string): number {
  return Math.ceil(text.length / 3.2);
}

/**
 * A rendered section's cost until the host has counted that exact text: 3.2 characters per token
 * plus 2 for the `[Label]` header, 3 per line break (the `- ` bullets) and 1 per number, so it stays
 * at or above the host tokenizers (OpenAI o200k and cl100k, Claude, DeepSeek V4) on the shipped
 * worlds' sections; the plain character estimate ran up to 16 under on name- and number-dense ones.
 */
export function sectionTokens(text: string): number {
  return tokensOf(text) + 2 + 3 * (text.match(/\n/g)?.length ?? 0) + (text.match(/\d+/g)?.length ?? 0);
}
