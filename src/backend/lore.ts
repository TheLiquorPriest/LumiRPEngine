// Lore curation on the host (DESIGN §4.2): saving a chat's reply or an excerpt of it as a draft lore
// entry of the chat's world. World Info needs no curation here: it is read live (`book-lore.ts`).

import type { ChatId, UserId, WorldId } from "../shared/ids";
import type { JsonObject } from "../shared/json";
import { hasOwn } from "../shared/json";
import { topicIdOf } from "../shared/lore";
import { neutralizeMacros } from "../shared/macros";
import { PROTOCOL_VERSION } from "../shared/protocol";
import type { HostPort } from "./host";
import { readableReply } from "./json-hiding";
import { type DraftNotice, WorldError, type WorldStore } from "./worlds";

/** The most of a chat's text a saved entry keeps. */
export const SAVED_MAX_CHARS = 20_000;

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
 * edit in the form that opens next; nothing is committed. The entry's id is picked from the draft
 * in turn with the world's other writes, so two saves at once never pick the same one; `changed`
 * hears of the draft's change.
 */
export async function saveFromChat(host: HostPort, worlds: WorldStore, chatId: ChatId, worldId: WorldId, userId: UserId, hiding: boolean, excerpt?: string, changed?: DraftNotice): Promise<{ worldId: WorldId; id: string }> {
  const messages = await host.chats.messages(chatId, userId);
  const reply = messages.filter((m) => !m.isUser && m.content.trim() !== "").at(-1);
  const plain = (s: string): string => s.replace(/\s+/g, " ").trim().toLowerCase();
  const wanted = excerpt === undefined ? "" : plain(excerpt);
  const from = wanted === "" ? reply : (messages.filter((m) => plain(m.content).includes(wanted)).at(-1) ?? reply);
  if (!from) throw new WorldError("not_found", "the chat has no reply to save yet");
  // A whole reply is saved as the engine reads it: without the JSON blocks the display hides (DESIGN §6.7).
  const content = (wanted === "" ? readableReply(from.content, hiding) : (excerpt ?? "")).trim().slice(0, SAVED_MAX_CHARS);
  const title = savedTitle(content);
  const base = `lore_${topicIdOf(title.split(/\s+/).slice(0, 5).join(" ")) || "saved"}`;
  let id = base;
  await worlds.editFrom(
    worldId,
    userId,
    (draft) => {
      for (let n = 2; hasOwn(draft.lore, id); n++) id = `${base}_${n}`;
      const value: JsonObject = { id, title, content, keys: [], links: [], source: { kind: "chat", chatId, messageId: from.id } };
      return { lre: PROTOCOL_VERSION, type: "lre.editor", reqId: "", worldId, base: null, op: "put", collection: "lore", id, value };
    },
    changed,
  );
  return { worldId, id };
}
