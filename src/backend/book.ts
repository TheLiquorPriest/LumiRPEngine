// The engine-managed lore book per world (DESIGN §4.2, D11): "LumiRPEngine · <World>", one slot
// entry per section, stored `disabled:true, key:[]` so nothing activates natively; only the
// interceptor enables them, with content rendered from the fold (DESIGN §6.3) and chat-depth
// placement (§6.4). Each entry sits where its section's Position puts it, and follows the Position
// when it changes. The book is attached to world chats through `chat_world_book_ids`. It holds
// slots only: world lore stays in the world document, and copies an earlier build synced into the
// book are removed.

import type { ChatId, SlotId, UserId } from "../shared/ids";
import type { JsonObject } from "../shared/json";
import { isRecord } from "../shared/json";
import { LEDGER_NAMESPACE } from "../shared/ledger";
import { neutralizeMacros } from "../shared/macros";
import type { SectionTemplate, SlotPosition, WorldDoc, WorldIndex } from "../shared/world";
import type { HostBookEntry, HostEntryPlacement, HostPort, PlacementOverride } from "./host";
import { NARRATOR_OUTLET, outletOf } from "./preset-binding";
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
  stance: { id: "stance", label: "Stance", rank: 9, template: "The narrator knows only what the player character knows. These lines say how the people here behave; never state what a cue only hints at.\n{{lines}}", position: { type: "chat_depth", role: "system", depth: 1, direction: "from_end" } },
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

/**
 * Where a section's entry is stored for its Position: at its chat depth (the interceptor's placement
 * repeats it each turn, with its direction); only at its outlet (host position 8, outlet-only, so the
 * section lands at `{{outlet::name}}` and nowhere else); or before the character, where a native entry
 * starts and the host's World Info editor may move it.
 */
export function entryPlacement(position: SlotPosition): HostEntryPlacement {
  if (position.type === "chat_depth") return { position: 4, depth: position.depth, role: position.role, outlet: null };
  if (position.type === "outlet") return { position: 8, depth: 4, role: "system", outlet: position.name.trim() };
  return { position: 0, depth: 4, role: "system", outlet: null };
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

/** The engine's entries in one world's book. */
export interface BookEntries {
  /** Each section's own entry, by slot. */
  slots: Map<SlotId, string>;
  /** Each section's outlet twin, outlet-only at `{{outlet::lre_<slot>}}`, for a preset that places the section itself (DESIGN §6.7). */
  twins: Map<SlotId, string>;
  /** The preset's narrator rules: their own entry (before the character) and their twin at `{{outlet::lre_narrator}}`. */
  narrator: string | null;
  narratorOutlet: string | null;
}

/** The engine's entries among a book's, with the Position each slot entry was placed for, and the lore copies an earlier build left. */
function sortEntries(all: readonly HostBookEntry[]): { found: BookEntries; slots: Map<SlotId, { id: string; placed: string | null; extensions: JsonObject }>; leftoverLore: string[] } {
  const found: BookEntries = { slots: new Map(), twins: new Map(), narrator: null, narratorOutlet: null };
  const slots = new Map<SlotId, { id: string; placed: string | null; extensions: JsonObject }>();
  const leftoverLore: string[] = [];
  for (const e of all) {
    const ns = e.extensions[LEDGER_NAMESPACE];
    const slot = slotOfEntry(e.extensions);
    if (slot) {
      found.slots.set(slot, e.id);
      slots.set(slot, { id: e.id, placed: isRecord(ns) && typeof ns.placed === "string" ? ns.placed : null, extensions: e.extensions });
    } else if (isRecord(ns) && typeof ns.twin === "string") found.twins.set(ns.twin, e.id);
    else if (isRecord(ns) && ns.narrator === "rules") found.narrator = e.id;
    else if (isRecord(ns) && ns.narrator === "outlet") found.narratorOutlet = e.id;
    else if (loreOfEntry(e.extensions) !== null) leftoverLore.push(e.id);
  }
  return { found, slots, leftoverLore };
}

export class EngineBook {
  /** The engine's entries by book. */
  private readonly known = new Map<string, BookEntries>();

  constructor(
    private readonly host: HostPort,
    private readonly worlds: WorldStore,
  ) {}

  /**
   * Creates the world's book if it has none (or it was deleted) and the engine's entries in it: a slot
   * entry and an outlet twin per section, and the narrator rules with their twin. It moves each slot
   * entry whose section's Position changed since the engine placed it, and deletes the world lore
   * copies an earlier build synced into the book: lore is no longer delivered, and those copies (secret
   * ones included) shouldn't sit in a host-visible book. The world document keeps the lore.
   */
  async ensure(world: WorldDoc, index: WorldIndex, userId: UserId): Promise<string> {
    let bookId = index.loreBookId;
    if (!bookId || !(await this.host.books.exists(bookId, userId))) {
      bookId = await this.host.books.create(`LumiRPEngine · ${world.name}`, "Engine-managed slots. Entries here are activated only by LumiRPEngine.", userId);
      await this.worlds.setLoreBook(world.id, bookId, userId);
    }
    // Read the book afresh: an entry deleted in the host's UI is recreated.
    const { found, slots, leftoverLore } = sortEntries(await this.host.books.entries(bookId, userId));
    const blank = { content: "", keys: [] as string[], disabled: true, constant: false };
    for (const section of sectionsOf(world)) {
      const p = section.position;
      // The Position the entry was placed for, so a later change of it is seen (the host's own entry
      // fields can't tell: the outlet isn't read back, and a move in its editor changes them too).
      const placed = p.type === "chat_depth" ? `chat_depth:${p.role}:${p.depth}:${p.direction}` : p.type === "outlet" ? `outlet:${p.name.trim()}` : "native";
      const known = slots.get(section.id);
      const extensions: JsonObject = { ...(known?.extensions ?? {}), [LEDGER_NAMESPACE]: { slot: section.id, placed } };
      if (!known) found.slots.set(section.id, await this.host.books.createEntry(bookId, { ...blank, comment: `LRE · ${section.label}`, ...entryPlacement(p), order: 100 + section.rank, extensions }, userId));
      // A move in the host's editor stands until the Position changes; a native entry an earlier
      // build made (none recorded) keeps its place.
      else if (known.placed !== placed && !(known.placed === null && p.type === "native")) await this.host.books.place(known.id, entryPlacement(p), extensions, userId);
      if (!found.twins.has(section.id)) found.twins.set(section.id, await this.host.books.createEntry(bookId, { ...blank, comment: `LRE · ${section.label} (preset outlet)`, position: 8, depth: 4, role: "system", outlet: outletOf(section.id), order: 100 + section.rank, extensions: { [LEDGER_NAMESPACE]: { twin: section.id } } }, userId));
    }
    found.narrator ??= await this.host.books.createEntry(bookId, { ...blank, comment: "LRE · Narrator rules", position: 0, depth: 4, role: "system", order: 99, extensions: { [LEDGER_NAMESPACE]: { narrator: "rules" } } }, userId);
    found.narratorOutlet ??= await this.host.books.createEntry(bookId, { ...blank, comment: "LRE · Narrator rules (preset outlet)", position: 8, depth: 4, role: "system", outlet: NARRATOR_OUTLET, order: 99, extensions: { [LEDGER_NAMESPACE]: { narrator: "outlet" } } }, userId);
    this.known.set(bookId, found);
    for (const id of leftoverLore) await this.host.books.deleteEntry(id, userId);
    return bookId;
  }

  /** The engine's entries in the book, read once and kept until the next ensure. */
  async entriesOf(bookId: string, userId: UserId): Promise<BookEntries> {
    const known = this.known.get(bookId);
    if (known) return known;
    const { found } = sortEntries(await this.host.books.entries(bookId, userId));
    this.known.set(bookId, found);
    return found;
  }

  /** Each section's own entry, by slot. */
  async slotEntries(bookId: string, userId: UserId): Promise<Map<SlotId, string>> {
    return (await this.entriesOf(bookId, userId)).slots;
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
