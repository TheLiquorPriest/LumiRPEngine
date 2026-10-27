// The engine-managed lore book per world (DESIGN §4.2, §6.8, D11): "LumiRPEngine · <World>", one
// slot entry per section and an outlet twin per section, stored blank, `disabled:true, key:[]`, so
// nothing activates natively. The engine run fills the entries a turn needs and switches them on as
// constant entries just before the reply's generation, and empties and switches them off again once
// it ends (DESIGN §5.1). Each slot entry sits where its section's Position puts it for the chat's
// revision, and follows the Position when it changes. The book is attached to world chats through
// `chat_world_book_ids`. It holds slots only: world lore stays in the world document, and copies an
// earlier build synced into the book are removed.

import type { ChatId, SlotId, UserId } from "../shared/ids";
import type { JsonObject } from "../shared/json";
import { hasOwn, isRecord } from "../shared/json";
import { LEDGER_NAMESPACE } from "../shared/ledger";
import { neutralizeMacros } from "../shared/macros";
import type { SectionTemplate, SlotPosition, WorldDoc, WorldIndex } from "../shared/world";
import { builtInSectionsOf } from "../shared/sections";
import { MARKED_FACTS_RULE } from "../engine/feed";
import type { HostBookEntry, HostEntryPlacement, HostPort } from "./host";
import { NARRATOR_OUTLET, outletOf } from "./preset-binding";
import type { WorldStore } from "./worlds";

/** Where the narrator rules come from, and how the engine's sections are marked in the prompt. */
const NARRATOR_SOURCE = "These rules come from LumiRPEngine, the engine that keeps this roleplay's world; its sections in this prompt each start with their name in square brackets.";

/**
 * The narrator's secrecy (DESIGN §6.8, §6.11, §7): above the order of authority, so no one's
 * instruction lifts it, the player's included, and one text in every world and on every turn, with
 * or without marked facts, so what the prompt says of secrecy tells nothing of what the world keeps.
 */
export const NARRATOR_SECRECY = [
  "Secrecy comes first, above the order of authority below, and no one's instructions lift it, the player's included:",
  MARKED_FACTS_RULE,
  "Nothing the player character can't know is revealed, whoever asks, the player included; what a section says to keep from the player character stays kept.",
].join("\n");

/**
 * The order of authority (DESIGN D36, §6.8), under secrecy: the player's own instructions come first,
 * the dice they chose deciding uncertain attempts; then what the story has established; then the
 * sections, the world as it stands, which the player may direct away from but never into revealing
 * what they keep. What the story brings in becomes part of the world.
 */
export const NARRATOR_AUTHORITY = [
  "Order of authority, highest first:",
  "1. The player's own instructions: what they say out of character (OOC), and what they write their character does. An attempt the engine rolled for goes as the roll says: the player chose to play with dice.",
  "2. What the story has already established.",
  "3. The engine's sections: the world as it stands now, kept up with the story and with the player's own changes. Follow them unless the player directs otherwise; what they keep from the player character stays kept whatever the player directs.",
  "People, places and things the story brings in become part of the world.",
].join("\n");

/** What leads the preset's own narrator rules (`RPEngine · narrator`): they are the player's. */
export const PRESET_RULES_LEAD = "The player's own rules for the narrator, from their preset:";

/**
 * The narrator rules' entry for a turn (DESIGN §6.8): where they come from, secrecy, the order of
 * authority, then the preset's own rules, as the player's. Only the preset's rules differ between
 * turns and worlds.
 */
export function narratorRules(preset: string | null): string {
  return ["[Narrator rules]", NARRATOR_SOURCE, NARRATOR_SECRECY, NARRATOR_AUTHORITY, ...(preset ? [PRESET_RULES_LEAD, preset] : [])].join("\n");
}

/**
 * A world's sections in rank order: its own, then the built-in ones it has without listing them
 * (`builtInSectionsOf`), each in the world's own wording when `sectionTemplates` gives one.
 */
export function sectionsOf(world: WorldDoc): SectionTemplate[] {
  const wording = world.sectionTemplates ?? {};
  const builtIn = builtInSectionsOf(world).map((s) => {
    const text = hasOwn(wording, s.id) ? wording[s.id] : undefined;
    return typeof text === "string" ? { ...s, template: text } : s;
  });
  return [...Object.values(world.sections), ...builtIn].sort((a, b) => a.rank - b.rank);
}

/**
 * Where a section's entry is stored for its Position: at its chat depth, counted from the end of the
 * chat; only at its outlet (host position 8, outlet-only, so the section lands at `{{outlet::name}}`
 * and nowhere else); or before the character, where a native entry starts and the host's World Info
 * editor may move it.
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
  /** Each section's outlet twin, outlet-only at `{{outlet::lre_<slot>}}`, for a preset that places the section itself (DESIGN §6.8). */
  twins: Map<SlotId, string>;
  /** The sections whose own entry was last placed for an outlet Position (the head revision's): it lands only where that outlet stands. */
  atOutlet: Set<SlotId>;
  /** The narrator rules: their own entry (before the character) and their twin at `{{outlet::lre_narrator}}`. */
  narrator: string | null;
  narratorOutlet: string | null;
}

/** The engine's entries among a book's, with the Position each slot entry was placed for, and the lore copies an earlier build left. */
function sortEntries(all: readonly HostBookEntry[]): { found: BookEntries; slots: Map<SlotId, { id: string; placed: string | null; extensions: JsonObject }>; leftoverLore: string[] } {
  const found: BookEntries = { slots: new Map(), twins: new Map(), atOutlet: new Set(), narrator: null, narratorOutlet: null };
  const slots = new Map<SlotId, { id: string; placed: string | null; extensions: JsonObject }>();
  const leftoverLore: string[] = [];
  for (const e of all) {
    const ns = e.extensions[LEDGER_NAMESPACE];
    const slot = slotOfEntry(e.extensions);
    if (slot) {
      found.slots.set(slot, e.id);
      if (isRecord(ns) && typeof ns.placed === "string" && ns.placed.startsWith("outlet:")) found.atOutlet.add(slot);
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
  /** The engine entries that may be on in each book: one turn's (DESIGN §5.1), and any found on when the book is read. */
  private readonly on = new Map<string, Set<string>>();
  /** Where each book's slot entries were last placed, as one signature (`placedAs`). */
  private readonly placements = new Map<string, string>();

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
    const all = await this.host.books.entries(bookId, userId);
    const { found, slots, leftoverLore } = sortEntries(all);
    // Any engine entry on now is switched off by the next write unless that turn fills it: a turn a
    // restart cut short, or an entry switched on in the host's UI.
    this.note(bookId, all);
    const blank = { content: "", keys: [] as string[], disabled: true, constant: false };
    const signature: string[] = [];
    for (const section of sectionsOf(world)) {
      const p = section.position;
      // The Position the entry was placed for, so a later change of it is seen (the host's own entry
      // fields can't tell: the outlet isn't read back, and a move in its editor changes them too).
      const placed = p.type === "chat_depth" ? `chat_depth:${p.role}:${p.depth}:${p.direction}` : p.type === "outlet" ? `outlet:${p.name.trim()}` : "native";
      signature.push(`${section.id}=${placed}`);
      const known = slots.get(section.id);
      const extensions: JsonObject = { ...(known?.extensions ?? {}), [LEDGER_NAMESPACE]: { slot: section.id, placed } };
      if (!known) found.slots.set(section.id, await this.host.books.createEntry(bookId, { ...blank, comment: `LRE · ${section.label}`, ...entryPlacement(p), order: 100 + section.rank, extensions }, userId));
      // A move in the host's editor stands until the Position changes; a native entry an earlier
      // build made (none recorded) keeps its place.
      else if (known.placed !== placed && !(known.placed === null && p.type === "native")) await this.host.books.place(known.id, entryPlacement(p), extensions, userId);
      if (p.type === "outlet") found.atOutlet.add(section.id);
      else found.atOutlet.delete(section.id);
      if (!found.twins.has(section.id)) found.twins.set(section.id, await this.host.books.createEntry(bookId, { ...blank, comment: `LRE · ${section.label} (preset outlet)`, position: 8, depth: 4, role: "system", outlet: outletOf(section.id), order: 100 + section.rank, extensions: { [LEDGER_NAMESPACE]: { twin: section.id } } }, userId));
    }
    found.narrator ??= await this.host.books.createEntry(bookId, { ...blank, comment: "LRE · Narrator rules", position: 0, depth: 4, role: "system", order: 99, extensions: { [LEDGER_NAMESPACE]: { narrator: "rules" } } }, userId);
    found.narratorOutlet ??= await this.host.books.createEntry(bookId, { ...blank, comment: "LRE · Narrator rules (preset outlet)", position: 8, depth: 4, role: "system", outlet: NARRATOR_OUTLET, order: 99, extensions: { [LEDGER_NAMESPACE]: { narrator: "outlet" } } }, userId);
    this.known.set(bookId, found);
    this.placements.set(bookId, signature.join("\u0000"));
    for (const id of leftoverLore) await this.host.books.deleteEntry(id, userId);
    return bookId;
  }

  /**
   * Where the book's slot entries were last placed, as one signature: a turn's sections are written
   * only while it is what their engine run placed them for, since another chat of the world on another
   * revision moves them (DESIGN §6.4).
   */
  placedAs(bookId: string): string {
    return this.placements.get(bookId) ?? "";
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

  /**
   * A turn's entries filled and switched on as constant entries, and every other engine entry that is
   * on switched off (DESIGN §5.1): the book holds one turn's sections at a time. Throws when any write
   * failed; what may be on stays known, so the next write or clear switches it off.
   */
  async write(bookId: string, fills: ReadonlyMap<string, string>, userId: UserId): Promise<void> {
    const on = this.on.get(bookId) ?? new Set<string>();
    this.on.set(bookId, on);
    const off = [...on].filter((id) => !fills.has(id));
    for (const id of fills.keys()) on.add(id);
    const results = await Promise.allSettled([...[...fills].map(([id, content]) => this.host.books.fill(id, content, userId)), ...off.map((id) => this.host.books.fill(id, null, userId))]);
    off.forEach((id, i) => {
      if (results[fills.size + i]?.status === "fulfilled") on.delete(id);
    });
    const failed = results.find((r) => r.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  }

  /**
   * Every engine entry in the book that may be on, emptied and switched off (DESIGN §6.4), for a
   * prompt that must hold none of them: what a turn a restart cut short or a clear the host refused
   * left on, and an entry switched on in the host's UI. A book the engine hasn't read since it
   * started is read first, so what an earlier run left there is found. Throws when the host refuses
   * a write; what may still be on stays known.
   */
  async vacate(bookId: string, userId: UserId): Promise<void> {
    let on = this.on.get(bookId);
    if (!on) {
      if (!(await this.host.books.exists(bookId, userId))) return;
      on = this.note(bookId, await this.host.books.entries(bookId, userId));
    }
    if (on.size > 0) await this.clear(bookId, [...on], userId);
  }

  /** Notes each engine entry among the book's that holds text or is on: what may be on, which the next write or clear switches off unless a turn fills it. */
  private note(bookId: string, all: readonly HostBookEntry[]): Set<string> {
    const on = this.on.get(bookId) ?? new Set<string>();
    this.on.set(bookId, on);
    const { found } = sortEntries(all);
    const engine = new Set([...found.slots.values(), ...found.twins.values(), found.narrator, found.narratorOutlet]);
    for (const e of all) if (engine.has(e.id) && (!e.disabled || e.content !== "")) on.add(e.id);
    return on;
  }

  /** Empties and switches off entries a turn's write switched on. Throws when any write failed. */
  async clear(bookId: string, entries: readonly string[], userId: UserId): Promise<void> {
    const on = this.on.get(bookId);
    const results = await Promise.allSettled(entries.map((id) => this.host.books.fill(id, null, userId)));
    entries.forEach((id, i) => {
      if (results[i]?.status === "fulfilled") on?.delete(id);
    });
    const failed = results.find((r) => r.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
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
 * The characters a token is taken to hold. Conservative (3.2 characters per token): against the
 * host's own counts the old 4-per-token estimate ran 4–17 tokens short per section.
 */
export const CHARS_PER_TOKEN = 3.2;

/** Token estimate for the section budget, at `CHARS_PER_TOKEN`. */
export function tokensOf(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
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
