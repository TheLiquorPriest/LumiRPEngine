// The same reads as `db.ts`, over Lumiverse's HTTP routes as RPE's signed-in user, for when its
// database file cannot be read (STANDALONE-PLAN §4.2): Lumiverse answers with the session's own user's
// rows only. Every `/api/v1` route takes `limit` and `offset`, at most 1000 rows a page, and answers a
// list as `{data, total, limit, offset}` (`services/pagination.ts:27-45`, `types/pagination.ts:6-14`).
// A chat's path comes in the light form, the shown swipe's text only (`chats.service.ts:655-669`); the
// messages themselves are asked with `full=true`, so every swipe is read as saved. A chat whose pages
// disagree (a message came or went between two) is read again from its start.
//
// Nothing can be asked of whether a row changed, so what is read is held a short while (`memo.ts`,
// `lumiverse.reads.keep`, 15 seconds) and let go the moment an event Lumiverse sent says it changed.

import { isRecord, type JsonValue } from "../../shared/json";
import { HTTP_KEEP_MS, KEEP, KEPT, Memo } from "./memo";
import type { LumiverseReads, LvStep, Places } from "./reads";
import { bookFrom, characterFrom, chatFrom, entryFrom, messageFrom, personaFrom, presetFrom, settingFrom, Unreadable, type LvEntry, type LvMessage } from "./rows";
import { LumiverseError, type LumiverseSession } from "./session";

/** Lumiverse's own cap on a page (`types/pagination.ts:12-14`). */
const PAGE = 1000;
/** The default of `lumiverse.reads.rereads`: how many times a chat whose pages disagreed is read again before the read fails. */
export const REREADS = 3;
/** The default of `lumiverse.reads.breakdownReplies`: how many of a chat's newest replies are asked for a stored breakdown over HTTP, which has no route for a chat's latest. */
export const BREAKDOWN_TRIES = 10;
/** Messages in the gap between two wanted ones that are read along rather than asked for apart: one request beats two for a few rows. */
const RUN_GAP = 50;

const enc = encodeURIComponent;

/** What the door's settings give the reads over HTTP. */
export interface HttpReadSettings {
  rereads: number;
  breakdownReplies: number;
  /** Milliseconds a read is held. */
  keepMs: number;
  /** How many chats, books and presets are held at once. */
  kept: number;
}

export const HTTP_READ_DEFAULTS: HttpReadSettings = { rereads: REREADS, breakdownReplies: BREAKDOWN_TRIES, keepMs: HTTP_KEEP_MS, kept: KEPT };

/** What the reads over HTTP are given beside the session. */
export interface HttpReadDeps {
  now?(): number;
  /**
   * The book an entry is in, where the entry index knows (`index-feed.ts`): Lumiverse has no route for one entry by id, so an entry named
   * with no book is looked for in this one, and in the user's books one by one only where the index does not know it.
   */
  bookOf?(entry: string): Promise<string | null>;
}

interface Page {
  data: unknown[];
  total: number;
}

function pageOf(body: unknown, asked: string): Page {
  if (!isRecord(body) || !Array.isArray(body.data) || typeof body.total !== "number") throw new LumiverseError("protocol", `Lumiverse answered ${asked} with something that is not a page.`);
  return { data: body.data, total: body.total };
}

function rowOf(value: unknown, asked: string): Record<string, unknown> {
  if (!isRecord(value)) throw new LumiverseError("protocol", `Lumiverse answered ${asked} with something RPE does not read.`);
  return value;
}

/** A row Lumiverse sent that RPE's mapper refuses fails the read, in words that say so. */
function mapped<T>(what: string, map: () => T): T {
  try {
    return map();
  } catch (error) {
    if (error instanceof Unreadable) throw new LumiverseError("protocol", `Lumiverse sent ${what} that RPE cannot read (${error.message}).`);
    throw error;
  }
}

/** The events that say a chat's rows changed, and the fields of their payloads that name the chat. */
const CHAT_EVENTS = new Set(["MESSAGE_SENT", "MESSAGE_EDITED", "MESSAGE_DELETED", "MESSAGE_SWIPED", "GENERATION_STARTED", "GENERATION_ENDED", "GENERATION_STOPPED", "CHAT_CHANGED", "CHAT_DELETED", "CHAT_FORKED"]);
const CHAT_FIELDS = ["chatId", "chat_id", "id", "sourceChatId", "forkedChatId"] as const;
/** Where the rows that are none of a chat's, a book's or a preset's are held together: characters, personas, settings, the lists of books and characters. */
const OTHER = "other";

/** The reads over HTTP; `settings` gives a changing chat's rereads, the replies asked for a stored breakdown and how long a read is held at each read (the door's settings). */
export function createHttpReads(session: LumiverseSession, settings: () => HttpReadSettings = () => HTTP_READ_DEFAULTS, deps: HttpReadDeps = {}): LumiverseReads {
  const get = (path: string, signal?: AbortSignal): Promise<unknown> => session.json("GET", path, undefined, signal);
  const memo = new Memo({ most: () => settings().kept, now: deps.now ?? Date.now });
  /** One read, held for the setting's time under the key (a chat's, a book's, a preset's: `memo.ts`). */
  const held = <T>(key: string, part: string, fill: () => Promise<T>): Promise<T> => memo.get(key, "", settings().keepMs, part, fill);
  const other = new Memo({ most: () => 1, now: deps.now ?? Date.now });
  const heldOther = <T>(part: string, fill: () => Promise<T>): Promise<T> => other.get(OTHER, "", settings().keepMs, part, fill);

  /** Every message of a chat, in order, from its pages, in the light form or whole; null when Lumiverse has no such chat of this user. `signal` ends the reading. */
  async function allMessages(chat: string, light: boolean, signal?: AbortSignal): Promise<LvMessage[] | null> {
    const asked = `the messages of chat ${chat}`;
    const { rereads } = settings();
    const form = light ? "" : "&full=true";
    for (let attempt = 1; ; attempt++) {
      const first = await get(`/api/v1/chats/${enc(chat)}/messages?limit=${PAGE}&offset=0${form}`, signal);
      if (first === null) return null;
      const page = pageOf(first, asked);
      const rows = [...page.data];
      let agreed = true;
      for (let offset = PAGE; offset < page.total; offset += PAGE) {
        const next = pageOf(await get(`/api/v1/chats/${enc(chat)}/messages?limit=${PAGE}&offset=${offset}${form}`, signal), asked);
        if (next.total !== page.total) {
          agreed = false;
          break;
        }
        rows.push(...next.data);
      }
      const messages = rows.map((r) => mapped(`a message of chat ${chat}`, () => messageFrom(rowOf(r, asked))));
      if (agreed && messages.length === page.total && new Set(messages.map((m) => m.id)).size === messages.length) return messages;
      if (attempt >= rereads) throw new LumiverseError("protocol", `Chat ${chat} kept changing while RPE read it (${rereads} times).`);
    }
  }

  /** The chat's messages in the light form, held: all that the path and the places of its messages are read from. */
  const lightMessages = async (chat: string, signal?: AbortSignal): Promise<LvMessage[] | null> => {
    // A caller that was stopped is not answered from what is held.
    signal?.throwIfAborted();
    return held(KEEP.chat(chat), "path", () => allMessages(chat, true, signal));
  };

  const step = (m: LvMessage): LvStep => ({ id: m.id, chat: m.chat, index: m.index, role: m.role, swipe: m.swipe, swipes: m.swipes, hidden: m.hidden, revision: m.revision, shown: m.shown });

  /** Every row of a paged list, in Lumiverse's order. */
  async function everyRow(path: string, asked: string): Promise<Record<string, unknown>[]> {
    const out: Record<string, unknown>[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const body = await get(`${path}?limit=${PAGE}&offset=${offset}`);
      if (body === null) return out;
      const page = pageOf(body, asked);
      out.push(...page.data.map((r) => rowOf(r, asked)));
      if (page.data.length === 0 || offset + PAGE >= page.total) return out;
    }
  }

  /** The messages at these places of the chat's path, whole, held. */
  async function stretch(chat: string, from: number, to: number): Promise<LvMessage[]> {
    return held(KEEP.chat(chat), `messages ${from} ${to}`, async () => {
      const out: LvMessage[] = [];
      for (let offset = from; offset < to; offset += PAGE) {
        const body = await get(`/api/v1/chats/${enc(chat)}/messages?limit=${Math.min(PAGE, to - offset)}&offset=${offset}&full=true`);
        if (body === null) return [];
        const page = pageOf(body, `the messages of chat ${chat}`);
        out.push(...page.data.map((r) => mapped(`a message of chat ${chat}`, () => messageFrom(rowOf(r, `chat ${chat}`)))));
        if (page.data.length === 0 || offset + page.data.length >= page.total) break;
      }
      return out;
    });
  }

  /** A book's entries, held under the book. */
  const entriesOf = (book: string): Promise<LvEntry[]> =>
    held(KEEP.book(book), "entries", async () => {
      const asked = `the entries of world book ${book}`;
      const out: Record<string, unknown>[] = [];
      for (let offset = 0; ; offset += PAGE) {
        const body = await get(`/api/v1/world-books/${enc(book)}/entries?limit=${PAGE}&offset=${offset}`);
        if (body === null) return [];
        const page = pageOf(body, asked);
        out.push(...page.data.map((r) => rowOf(r, asked)));
        if (page.data.length === 0 || offset + PAGE >= page.total) break;
      }
      return out.map((r) => mapped(`an entry of world book ${book}`, () => entryFrom(r)));
    });

  return {
    kind: "http",
    // `GET /api/v1/chats/:id?messages=false` (`routes/chats.routes.ts:410-421`).
    async chat(chat) {
      return held(KEEP.chat(chat), "row", async () => {
        const body = await get(`/api/v1/chats/${enc(chat)}?messages=false`);
        return body === null ? null : mapped(`chat ${chat}`, () => chatFrom(rowOf(body, `chat ${chat}`)));
      });
    },
    // `GET /api/v1/chats` (`routes/chats.routes.ts:154-159`), every page: the user's chats as Lumiverse lists them, read fresh.
    async chats() {
      return (await everyRow("/api/v1/chats", "the chats")).map((r) => mapped("a chat", () => chatFrom(r)));
    },
    // `GET /api/v1/chats/:id/messages` (`routes/chats.routes.ts:792-821`), every page.
    async path(chat, signal) {
      const messages = await lightMessages(chat, signal);
      return messages === null ? null : messages.map(step);
    },
    // `?full=true` (`routes/chats.routes.ts:798-801`): every swipe as saved, not the shown one alone.
    async messages(chat, places: Places) {
      const from = Math.max(0, Math.floor(places.from));
      const to = Math.floor(places.to);
      if (to <= from) return [];
      return [...(await stretch(chat, from, to))];
    },
    // Lumiverse has no route for one message by id: the chat's path says where each one is, and the stretches that hold them are read.
    async messagesById(chat, ids) {
      if (ids.length === 0) return [];
      const wanted = new Set(ids);
      const path = await lightMessages(chat);
      if (path === null) return [];
      const places = path.flatMap((m, place) => (wanted.has(m.id) ? [place] : []));
      const out: LvMessage[] = [];
      for (let i = 0; i < places.length; ) {
        let end = i;
        while (end + 1 < places.length && (places[end + 1] ?? 0) - (places[end] ?? 0) <= RUN_GAP) end++;
        for (const m of await stretch(chat, places[i] ?? 0, (places[end] ?? 0) + 1)) if (wanted.has(m.id)) out.push(m);
        i = end + 1;
      }
      return out;
    },
    // `GET /api/v1/world-books/:id` (`routes/world-books.routes.ts:325-342`).
    async book(book) {
      return held(KEEP.book(book), "row", async () => {
        const body = await get(`/api/v1/world-books/${enc(book)}?limit=1&offset=0`);
        return body === null ? null : mapped(`world book ${book}`, () => bookFrom(rowOf(body, `world book ${book}`)));
      });
    },
    // `GET /api/v1/world-books` (`routes/world-books.routes.ts:302-323`), every page.
    async books() {
      const rows = await heldOther("books", () => everyRow("/api/v1/world-books", "the world books"));
      return rows.map((r) => mapped("a world book", () => bookFrom(r)));
    },
    // `GET /api/v1/world-books/:id/entries` (`routes/world-books.routes.ts:907-938`), every page.
    async entries(book) {
      return [...(await entriesOf(book))];
    },
    // Lumiverse has no route for one entry by id (`routes/world-books.routes.ts`): the entry is looked for in its own book, which the caller or the entry index names;
    // where neither knows, in the user's books one by one (each held, so the walk is paid once), which is the fallback's alone.
    async entry(entry, book) {
      const named = book ?? (await deps.bookOf?.(entry)) ?? null;
      if (named !== null) return (await entriesOf(named)).find((e) => e.id === entry) ?? null;
      for (const each of await heldOther("books", () => everyRow("/api/v1/world-books", "the world books"))) {
        if (typeof each.id !== "string") continue;
        const found = (await entriesOf(each.id)).find((e) => e.id === entry);
        if (found !== undefined) return found;
      }
      return null;
    },
    // `GET /api/v1/characters/:id` (`routes/characters.routes.ts:860-865`).
    async character(character) {
      return heldOther(`character ${character}`, async () => {
        const body = await get(`/api/v1/characters/${enc(character)}`);
        return body === null ? null : mapped(`character ${character}`, () => characterFrom(rowOf(body, `character ${character}`)));
      });
    },
    // `GET /api/v1/characters` (`routes/characters.routes.ts:525-537`), every page: whole cards, as Lumiverse lists them.
    async characters() {
      const rows = await heldOther("characters", () => everyRow("/api/v1/characters", "the characters"));
      return rows.map((r) => mapped("a character", () => characterFrom(r)));
    },
    // `GET /api/v1/personas/:id` (`routes/personas.routes.ts:272-277`).
    async persona(persona) {
      return heldOther(`persona ${persona}`, async () => {
        const body = await get(`/api/v1/personas/${enc(persona)}`);
        return body === null ? null : mapped(`persona ${persona}`, () => personaFrom(rowOf(body, `persona ${persona}`)));
      });
    },
    // `GET /api/v1/personas` (`routes/personas.routes.ts:85-89`), every page, for the one marked default.
    async defaultPersona() {
      return heldOther("default persona", async () => {
        const found = (await everyRow("/api/v1/personas", "the personas")).find((r) => r.is_default === true || r.is_default === 1);
        return found === undefined ? null : mapped("the default persona", () => personaFrom(found));
      });
    },
    // `GET /api/v1/presets/:id` (`routes/presets.routes.ts:139-158`).
    async preset(preset) {
      return held(KEEP.preset(preset), "row", async () => {
        const body = await get(`/api/v1/presets/${enc(preset)}`);
        return body === null ? null : mapped(`preset ${preset}`, () => presetFrom(rowOf(body, `preset ${preset}`)));
      });
    },
    // `GET /api/v1/settings/:key` (`routes/settings.routes.ts:20-25`): its value already parsed.
    async setting(key) {
      return heldOther(`setting ${key}`, async () => {
        const body = await get(`/api/v1/settings/${enc(key)}`);
        if (body === null) return null;
        const row = rowOf(body, `setting ${key}`);
        return mapped(`setting ${key}`, () => settingFrom({ ...row, value: JSON.stringify(row.value ?? null) }));
      });
    },
    // `GET /api/v1/generate/breakdown/:messageId` (`routes/generate.routes.ts:175-181`) for the chat's newest replies.
    async breakdown(chat) {
      const body = await get(`/api/v1/chats/${enc(chat)}/messages?tail=true&limit=${settings().breakdownReplies}`);
      if (body === null) return null;
      const replies = pageOf(body, `the newest messages of chat ${chat}`)
        .data.map((r) => mapped(`a message of chat ${chat}`, () => messageFrom(rowOf(r, `chat ${chat}`))))
        .filter((m) => m.role !== "user")
        .reverse();
      for (const reply of replies) {
        const found = await get(`/api/v1/generate/breakdown/${enc(reply.id)}`);
        if (found !== null) return found as JsonValue;
      }
      return null;
    },
    dropChat: (chat) => memo.drop(KEEP.chat(chat)),
    // What Lumiverse says changed is let go: a chat the event names (every chat where it names none), every book, every preset, or the other rows, on an event about them.
    heard(event, payload) {
      if (CHAT_EVENTS.has(event)) {
        const named = isRecord(payload) ? CHAT_FIELDS.flatMap((f) => (typeof payload[f] === "string" && payload[f] !== "" ? [payload[f] as string] : [])) : [];
        if (named.length === 0) memo.drop(KEEP.chats);
        for (const chat of named) memo.drop(KEEP.chat(chat));
      } else if (event.startsWith("WORLD_BOOK_")) {
        memo.drop(KEEP.books);
        other.clear();
      } else if (event.startsWith("PRESET_")) memo.drop(KEEP.presets);
      else if (event.startsWith("CHARACTER_") || event === "PERSONA_CHANGED" || event === "SETTINGS_UPDATED") other.clear();
    },
  };
}
