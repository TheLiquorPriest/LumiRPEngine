// Lore curation on the host (DESIGN §4.2): whether a lore entry indexed from a World Info book still
// matches its book entry (the host's books are readable, so the entry's stored hash is compared
// with the book entry's text now; Build offers the new text for review), and saving a chat's reply
// or an excerpt of it as a draft lore entry of the chat's world.

import type { ChatId, UserId, WorldId } from "../shared/ids";
import type { JsonObject } from "../shared/json";
import { hasOwn } from "../shared/json";
import { bookTextHash, loreSourceOf, topicIdOf } from "../shared/lore";
import { neutralizeMacros } from "../shared/macros";
import type { LoreDrift } from "../shared/protocol";
import { PROTOCOL_VERSION } from "../shared/protocol";
import type { WorldDoc } from "../shared/world";
import type { HostBookEntry, HostPort } from "./host";
import { readableReply } from "./json-hiding";
import { WorldError, type WorldStore } from "./worlds";

/** The most of a chat's text a saved entry keeps. */
export const SAVED_MAX_CHARS = 20_000;

/** The world's book-sourced entries (or just `only`) whose book entry changed since they were indexed, or is gone. Each book is read once. */
export async function bookDrift(host: HostPort, world: WorldDoc, userId: UserId, only?: string): Promise<Record<string, LoreDrift>> {
  const books = new Map<string, Map<string, HostBookEntry>>();
  const out: Record<string, LoreDrift> = {};
  for (const [id, entry] of Object.entries(world.lore)) {
    const source = loreSourceOf(entry.source);
    if (source.kind !== "book" || (only !== undefined && id !== only)) continue;
    let book = books.get(source.bookId);
    if (!book) {
      // A deleted book reads as one with no entries: every entry from it is gone.
      const entries = await host.books.entries(source.bookId, userId).catch((): HostBookEntry[] => []);
      book = new Map(entries.map((e) => [e.id, e]));
      books.set(source.bookId, book);
    }
    const now = book.get(source.entryId);
    if (!now) {
      out[id] = { status: "missing" };
      continue;
    }
    const hash = bookTextHash(now.content);
    if (hash !== source.hash) out[id] = { status: "changed", content: now.content, hash };
  }
  return out;
}

/** A saved entry's first title: its text's first sentence without roleplay markup, at most eight words. */
function savedTitle(text: string): string {
  const first = neutralizeMacros(text.replace(/[*_"“”]/g, " "))
    .trim()
    .split(/(?<=[.!?…])\s/)[0]
    ?.trim()
    .replace(/[.!?…]+$/, "");
  const words = (first ?? "").split(/\s+/).filter((w) => w !== "");
  return words.length === 0 ? "Saved from a chat" : words.length > 8 ? `${words.slice(0, 8).join(" ")}…` : words.join(" ");
}

/**
 * Saves the chat's latest reply, or `excerpt`, as a lore entry in the draft of the chat's world. Its
 * source names the message it came from: the latest one holding the excerpt word for word (spacing
 * and case aside), else the latest reply. The title is the text's first words, for the author to
 * edit in the form that opens next; nothing is committed.
 */
export async function saveFromChat(host: HostPort, worlds: WorldStore, chatId: ChatId, worldId: WorldId, userId: UserId, hiding: boolean, excerpt?: string): Promise<{ worldId: WorldId; id: string }> {
  const messages = await host.chats.messages(chatId, userId);
  const reply = messages.filter((m) => !m.isUser && m.content.trim() !== "").at(-1);
  const plain = (s: string): string => s.replace(/\s+/g, " ").trim().toLowerCase();
  const wanted = excerpt === undefined ? "" : plain(excerpt);
  const from = wanted === "" ? reply : (messages.filter((m) => plain(m.content).includes(wanted)).at(-1) ?? reply);
  if (!from) throw new WorldError("not_found", "the chat has no reply to save yet");
  // A whole reply is saved as the engine reads it: without the JSON blocks the display hides (DESIGN §6.7).
  const content = (wanted === "" ? readableReply(from.content, hiding) : (excerpt ?? "")).trim().slice(0, SAVED_MAX_CHARS);
  const draft = await worlds.working(worldId, userId);
  const title = savedTitle(content);
  const base = `lore_${topicIdOf(title.split(/\s+/).slice(0, 5).join(" ")) || "saved"}`;
  let id = base;
  for (let n = 2; hasOwn(draft.lore, id); n++) id = `${base}_${n}`;
  const value: JsonObject = { id, title, content, keys: [], links: [], source: { kind: "chat", chatId, messageId: from.id } };
  await worlds.edit({ lre: PROTOCOL_VERSION, type: "lre.editor", reqId: "", worldId, base: null, op: "put", collection: "lore", id, value }, userId);
  return { worldId, id };
}
