// The books a chat reads, decided as Lumiverse decides them for a generation, and a view of one user's
// books shaped as the lore lane reads them (`LoreBooks` in `src/lore/sources.ts`). The adapter may not
// import lore, so the shape is matched here and the composition plugs one into the other.

import { isRecord } from "../../shared/json";
import type { LvBook, LvChat, LvEntry, LvPersona } from "./rows";
import type { LumiverseReads } from "./reads";

/** One user's books, each method asked with the user it is for. */
export interface UserBooks {
  attached(user: string, chat: string): Promise<string[]>;
  book(user: string, id: string): Promise<LvBook | null>;
  entries(user: string, book: string): Promise<LvEntry[]>;
  entry(user: string, id: string): Promise<LvEntry | null>;
}

/** Who a generation is for, when the caller knows: the character speaking and the persona in use. */
export interface BooksAt {
  speaker?: string | null;
  persona?: string | null;
}

/**
 * The ids of the books a chat reads, each once, in Lumiverse's order: its character's (or, in a group
 * chat, its members' as the chat's setting and mutes say), the persona's, the chat's own and the
 * user's global ones (`services/world-info-sources.service.ts:92-131`).
 */
export async function attachedBooks(reads: LumiverseReads, chatId: string, at: BooksAt = {}): Promise<string[]> {
  const chat = await reads.chat(chatId);
  if (chat === null) return [];
  const out: string[] = [];
  const push = (id: unknown): void => {
    if (typeof id === "string" && id !== "" && !out.includes(id)) out.push(id);
  };
  for (const character of await bookCharacters(reads, chat, at.speaker ?? chat.character)) {
    for (const id of characterBooks((await reads.character(character))?.extensions)) push(id);
  }
  push((await personaOf(reads, at.persona ?? null))?.book);
  const own = chat.metadata.chat_world_book_ids;
  if (Array.isArray(own)) for (const id of own) push(id);
  const global = (await reads.setting("globalWorldBooks"))?.value;
  if (Array.isArray(global)) for (const id of global) push(id);
  return out;
}

/**
 * Whose character books a chat reads (`services/world-info-sources.service.ts:26-90`): one chat's
 * character; in a group chat, by `group_lorebook_mode` (else by `group_card_mode`: merge → all,
 * merge_ignore_muted → all unmuted, swap → the active character), members in `character_ids` order,
 * the muted left out (`services/chats.service.ts:1650-1655`), and the active one when none is left.
 */
async function bookCharacters(reads: LumiverseReads, chat: LvChat, active: string | null): Promise<string[]> {
  const meta = chat.metadata;
  const fallback = active === null ? [] : [active];
  if (meta.group !== true && meta.group !== 1) return fallback;
  const card = meta.group_card_mode;
  const lore = meta.group_lorebook_mode;
  const mode =
    lore === "active_character" || lore === "all_unmuted" || lore === "all" ? lore : card === "merge" ? "all" : card === "merge_ignore_muted" ? "all_unmuted" : "active_character";
  if (mode === "active_character") return fallback;
  const muted = new Set(mode === "all_unmuted" && Array.isArray(meta.muted_character_ids) ? meta.muted_character_ids : []);
  const ids = Array.isArray(meta.character_ids) ? meta.character_ids : [];
  const members = [...new Set(ids.filter((id): id is string => typeof id === "string" && id !== "" && !muted.has(id)))];
  const present: string[] = [];
  for (const id of members) if ((await reads.character(id)) !== null) present.push(id);
  return present.length > 0 ? present : fallback;
}

/** A character's books (`utils/character-world-books.ts:6-14`): the list, else the one id. */
function characterBooks(extensions: unknown): string[] {
  if (!isRecord(extensions)) return [];
  if (Array.isArray(extensions.world_book_ids)) return extensions.world_book_ids.filter((id): id is string => typeof id === "string" && id !== "");
  return typeof extensions.world_book_id === "string" && extensions.world_book_id !== "" ? [extensions.world_book_id] : [];
}

/** The persona in use (`services/personas.service.ts:189-202`): the one asked for, else the active one by setting, else the default. */
async function personaOf(reads: LumiverseReads, asked: string | null): Promise<LvPersona | null> {
  if (asked !== null) {
    const persona = await reads.persona(asked);
    if (persona !== null) return persona;
  }
  const active = (await reads.setting("activePersonaId"))?.value;
  if (typeof active === "string" && active !== "") {
    const persona = await reads.persona(active);
    if (persona !== null) return persona;
  }
  return await reads.defaultPersona();
}

/**
 * One user's books over their reads. Another user's books are none of RPE's business here: asking for
 * them reads nothing.
 */
export function loreBooks(reads: LumiverseReads, user: string): UserBooks {
  return {
    attached: async (asker, chat) => (asker === user ? await attachedBooks(reads, chat) : []),
    book: async (asker, id) => (asker === user ? await reads.book(id) : null),
    entries: async (asker, book) => (asker === user ? await reads.entries(book) : []),
    entry: async (asker, id) => (asker === user ? await reads.entry(id) : null),
  };
}
