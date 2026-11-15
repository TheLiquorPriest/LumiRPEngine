// The same reads as `db.ts`, over Lumiverse's HTTP routes as RPE's signed-in user, for when its
// database file cannot be read (STANDALONE-PLAN §4.2): Lumiverse answers with the session's own user's
// rows only. Every `/api/v1` route takes `limit` and `offset`, at most 1000 rows a page, and answers a
// list as `{data, total, limit, offset}` (`services/pagination.ts:27-45`, `types/pagination.ts:6-14`).
// A chat's messages come in the light form, the shown swipe's text only (`chats.service.ts:655-669`),
// which is all RPE reads of them. A chat whose pages disagree (a message came or went between two) is
// read again from its start.

import { isRecord, type JsonValue } from "../../shared/json";
import type { LumiverseReads, LvStep, Places } from "./reads";
import { bookFrom, characterFrom, chatFrom, entryFrom, messageFrom, personaFrom, presetFrom, settingFrom, Unreadable, type LvMessage } from "./rows";
import { LumiverseError, type LumiverseSession } from "./session";

/** Lumiverse's own cap on a page (`types/pagination.ts:12-14`). */
const PAGE = 1000;
/** The default of `lumiverse.reads.rereads`: how many times a chat whose pages disagreed is read again before the read fails. */
export const REREADS = 3;
/** The default of `lumiverse.reads.breakdownReplies`: how many of a chat's newest replies are asked for a stored breakdown over HTTP, which has no route for a chat's latest. */
export const BREAKDOWN_TRIES = 10;

const enc = encodeURIComponent;

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

/** The reads over HTTP; `settings` gives a changing chat's rereads and the replies asked for a stored breakdown at each read (the door's settings). */
export function createHttpReads(session: LumiverseSession, settings: () => { rereads: number; breakdownReplies: number } = () => ({ rereads: REREADS, breakdownReplies: BREAKDOWN_TRIES })): LumiverseReads {
  const get = (path: string, signal?: AbortSignal): Promise<unknown> => session.json("GET", path, undefined, signal);

  /** Every message of a chat, in order, from its pages; null when Lumiverse has no such chat of this user. `signal` ends the reading. */
  async function allMessages(chat: string, signal?: AbortSignal): Promise<LvMessage[] | null> {
    const asked = `the messages of chat ${chat}`;
    const { rereads } = settings();
    for (let attempt = 1; ; attempt++) {
      const first = await get(`/api/v1/chats/${enc(chat)}/messages?limit=${PAGE}&offset=0`, signal);
      if (first === null) return null;
      const page = pageOf(first, asked);
      const rows = [...page.data];
      let agreed = true;
      for (let offset = PAGE; offset < page.total; offset += PAGE) {
        const next = pageOf(await get(`/api/v1/chats/${enc(chat)}/messages?limit=${PAGE}&offset=${offset}`, signal), asked);
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

  return {
    kind: "http",
    // `GET /api/v1/chats/:id?messages=false` (`routes/chats.routes.ts:410-421`).
    async chat(chat) {
      const body = await get(`/api/v1/chats/${enc(chat)}?messages=false`);
      return body === null ? null : mapped(`chat ${chat}`, () => chatFrom(rowOf(body, `chat ${chat}`)));
    },
    // `GET /api/v1/chats/:id/messages` (`routes/chats.routes.ts:792-821`), every page.
    async path(chat, signal) {
      const messages = await allMessages(chat, signal);
      return messages === null ? null : messages.map(step);
    },
    async messages(chat, places: Places) {
      const from = Math.max(0, Math.floor(places.from));
      const to = Math.floor(places.to);
      const out: LvMessage[] = [];
      for (let offset = from; offset < to; offset += PAGE) {
        const body = await get(`/api/v1/chats/${enc(chat)}/messages?limit=${Math.min(PAGE, to - offset)}&offset=${offset}`);
        if (body === null) return [];
        const page = pageOf(body, `the messages of chat ${chat}`);
        out.push(...page.data.map((r) => mapped(`a message of chat ${chat}`, () => messageFrom(rowOf(r, `chat ${chat}`)))));
        if (page.data.length === 0 || offset + page.data.length >= page.total) break;
      }
      return out;
    },
    // Lumiverse has no route for one message by id: the chat is read and the ids picked out.
    async messagesById(chat, ids) {
      if (ids.length === 0) return [];
      const wanted = new Set(ids);
      return ((await allMessages(chat)) ?? []).filter((m) => wanted.has(m.id));
    },
    // `GET /api/v1/world-books/:id` (`routes/world-books.routes.ts:325-342`).
    async book(book) {
      const body = await get(`/api/v1/world-books/${enc(book)}?limit=1&offset=0`);
      return body === null ? null : mapped(`world book ${book}`, () => bookFrom(rowOf(body, `world book ${book}`)));
    },
    // `GET /api/v1/world-books/:id/entries` (`routes/world-books.routes.ts:907-938`), every page.
    async entries(book) {
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
    },
    // Lumiverse has no route for one entry by id (`routes/world-books.routes.ts`): the user's books are
    // listed (`:302-323`) and their entries read until it is found. Slow, and only the fallback's.
    async entry(entry) {
      for (const book of await everyRow("/api/v1/world-books", "the world books")) {
        if (typeof book.id !== "string") continue;
        const found = (await everyRow(`/api/v1/world-books/${enc(book.id)}/entries`, `the entries of world book ${book.id}`)).find((r) => r.id === entry);
        if (found !== undefined) return mapped(`entry ${entry}`, () => entryFrom(found));
      }
      return null;
    },
    // `GET /api/v1/characters/:id` (`routes/characters.routes.ts:860-865`).
    async character(character) {
      const body = await get(`/api/v1/characters/${enc(character)}`);
      return body === null ? null : mapped(`character ${character}`, () => characterFrom(rowOf(body, `character ${character}`)));
    },
    // `GET /api/v1/personas/:id` (`routes/personas.routes.ts:272-277`).
    async persona(persona) {
      const body = await get(`/api/v1/personas/${enc(persona)}`);
      return body === null ? null : mapped(`persona ${persona}`, () => personaFrom(rowOf(body, `persona ${persona}`)));
    },
    // `GET /api/v1/personas` (`routes/personas.routes.ts:85-89`), every page, for the one marked default.
    async defaultPersona() {
      const found = (await everyRow("/api/v1/personas", "the personas")).find((r) => r.is_default === true || r.is_default === 1);
      return found === undefined ? null : mapped("the default persona", () => personaFrom(found));
    },
    // `GET /api/v1/presets/:id` (`routes/presets.routes.ts:139-158`).
    async preset(preset) {
      const body = await get(`/api/v1/presets/${enc(preset)}`);
      return body === null ? null : mapped(`preset ${preset}`, () => presetFrom(rowOf(body, `preset ${preset}`)));
    },
    // `GET /api/v1/settings/:key` (`routes/settings.routes.ts:20-25`): its value already parsed.
    async setting(key) {
      const body = await get(`/api/v1/settings/${enc(key)}`);
      if (body === null) return null;
      const row = rowOf(body, `setting ${key}`);
      return mapped(`setting ${key}`, () => settingFrom({ ...row, value: JSON.stringify(row.value ?? null) }));
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
  };
}
