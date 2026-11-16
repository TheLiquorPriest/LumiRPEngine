// The host's other stores, as RPH's `archive_search` reaches them (STANDALONE-PLAN §6.8, §10.5; RPH `StoresPort`): the databanks attached to a
// chat and its characters, and Lumiverse's memory (its entities, its arcs and the consolidations below them). Both are asked of Lumiverse as the
// signed-in user, and nothing of what they hold is kept.
//
// A databank is searched by Lumiverse itself, by meaning (`POST /api/v1/databanks/search`, `routes/databank.routes.ts:409-426`). Lumiverse has
// no route that searches its memory, so RPE reads the entities and the consolidations by their routes and searches what it read, by words,
// at each search (§4.2, Y29); the text read is let go when the search is answered. A hit's `ref` reads it in full: a databank hit names its
// document, a memory hit its entity, arc or consolidation.

import type { SearchHit, StoreInfo, StoreItem, StoresPort, StoresQuery, Scope } from "rp-harness/contract";
import { isRecord } from "../../shared/json";
import type { LumiverseReads } from "./reads";
import { LumiverseError, type LumiverseSession } from "./session";
import { matchAt, snippetOf, wordsOf } from "./words";

/** The default of `lumiverse.stores.hits`: the hits a search of the other stores gives when it names none. */
export const STORE_HITS = 20;

/** The stores RPE offers, by the name a search asks for them with. */
export const STORE_NAMES = ["databank", "memory"] as const;
export type StoreName = (typeof STORE_NAMES)[number];

/** One memory entity as RPE's cast reads it: Lumiverse's own, with its revision. */
export interface MemoryEntityRead {
  id: string;
  name: string;
  /** Lumiverse's kind of entity (character, location, item, faction, …). */
  type: string;
  aliases: string[];
  description: string;
  facts: string[];
  /** Changes when Lumiverse changes the entity: the row's `updated_at`. */
  revision: number;
}

export interface Stores extends StoresPort {
  /** One memory entity of the chat by its id; null where Lumiverse has none. */
  entity(chat: string, entity: string): Promise<MemoryEntityRead | null>;
}

export interface StoresDeps {
  session: LumiverseSession;
  /** The chat's row, for the characters whose databanks it takes. */
  reads: Pick<LumiverseReads, "chat">;
  /** The user RPE belongs to: the only one whose stores are read. */
  user: string;
  /** The hits a search gives when it names none, and a hit's snippet in characters, read at each search (the door's settings). */
  settings(): { hits: number; snippetChars: number };
  /** One line on what a store holds, in the shipped words; the store's name where none is given. */
  describe?(store: StoreName): Promise<string>;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);

/** The rows of a list Lumiverse answers as `{data}`; none where there is no such chat. */
function listOf(body: unknown, asked: string): Record<string, unknown>[] {
  if (body === null) return [];
  if (!isRecord(body) || !Array.isArray(body.data)) throw new LumiverseError("protocol", `Lumiverse answered ${asked} with something RPE does not read.`);
  return body.data.filter(isRecord);
}

/** Hits from several stores, one from each in turn, so no store's hits crowd the others out of the cap. */
function interleaved(lists: readonly SearchHit[][], limit: number): SearchHit[] {
  const out: SearchHit[] = [];
  for (let i = 0; out.length < limit && lists.some((l) => i < l.length); i++) {
    for (const list of lists) {
      const hit = list[i];
      if (hit !== undefined && out.length < limit) out.push(hit);
    }
  }
  return out;
}

/** An entity as the cast reads it. */
function entityOf(row: Record<string, unknown>): MemoryEntityRead | null {
  const id = str(row.id);
  if (id === "") return null;
  return { id, name: str(row.name), type: str(row.entityType), aliases: strings(row.aliases), description: str(row.description), facts: strings(row.facts), revision: typeof row.updatedAt === "number" ? row.updatedAt : 0 };
}

/** What an entity says, as one text a search reads and a read gives. */
function entityText(e: MemoryEntityRead): string {
  return [`${e.name}${e.type === "" ? "" : ` (${e.type})`}`, ...(e.aliases.length === 0 ? [] : [e.aliases.join(", ")]), ...(e.description === "" ? [] : [e.description]), ...e.facts.map((f) => `- ${f}`)].join("\n");
}

export function createStores(deps: StoresDeps): Stores {
  const { session } = deps;
  const own = (scope: Scope): boolean => scope.user === deps.user;
  const get = (path: string): Promise<unknown> => session.json("GET", path);
  const enc = encodeURIComponent;

  /** The chat's character and, in a group chat, its members: whose databanks the chat takes. */
  async function charactersOf(chat: string): Promise<string[]> {
    const row = await deps.reads.chat(chat);
    if (row === null) return [];
    return [...new Set([...(row.character === null ? [] : [row.character]), ...strings(row.metadata.character_ids)])];
  }

  const entities = async (chat: string): Promise<MemoryEntityRead[]> => listOf(await get(`/api/v1/memory-cortex/chats/${enc(chat)}/entities`), "the chat's memory entities").flatMap((r) => entityOf(r) ?? []);
  /** The consolidations of one tier: 2 is the arcs, 1 the consolidations below them (`routes/memory-cortex.routes.ts:1939-1947`). */
  const consolidations = async (chat: string, tier: 1 | 2): Promise<Record<string, unknown>[]> => listOf(await get(`/api/v1/memory-cortex/chats/${enc(chat)}/consolidations?tier=${tier}`), `the chat's tier ${tier} consolidations`);
  const entityRead = async (chat: string, entity: string): Promise<MemoryEntityRead | null> => {
    const body = await get(`/api/v1/memory-cortex/chats/${enc(chat)}/entities/${enc(entity)}`);
    return isRecord(body) ? entityOf(body) : null;
  };

  async function searchDatabank(scope: Scope, text: string, limit: number, chars: number): Promise<SearchHit[]> {
    const characters = await charactersOf(scope.chat);
    const found = listOf(await session.json("POST", "/api/v1/databanks/search", { query: text, chatId: scope.chat, characterId: characters, limit }), "a databank search");
    const wanted = wordsOf(text).map((w) => w.word);
    // One hit for a document, its best passage.
    const seen = new Set<string>();
    const hits: SearchHit[] = [];
    for (const r of found) {
      const bank = str(r.databankId);
      const doc = str(r.documentId);
      if (doc === "" || seen.has(doc)) continue;
      seen.add(doc);
      const content = str(r.content);
      hits.push({ ref: `databank:${bank}:${doc}`, title: str(r.documentName), snippet: snippetOf(content, matchAt(content, wanted) ?? 0, chars), how: "meaning" });
    }
    return hits;
  }

  async function searchMemory(scope: Scope, text: string, limit: number, chars: number): Promise<SearchHit[]> {
    const wanted = wordsOf(text).map((w) => w.word);
    if (wanted.length === 0) return [];
    const [entityRows, arcs, below] = await Promise.all([entities(scope.chat), consolidations(scope.chat, 2), consolidations(scope.chat, 1)]);
    const hits: SearchHit[] = [];
    const found = (ref: string, title: string, body: string): void => {
      const at = matchAt(body, wanted);
      if (at !== null) hits.push({ ref, title, snippet: snippetOf(body, at, chars), how: "words" });
    };
    for (const e of entityRows) found(`memory:entity:${e.id}`, e.name, entityText(e));
    for (const [kind, rows] of [["arc", arcs], ["consolidation", below]] as const) {
      for (const r of rows) found(`memory:${kind}:${str(r.id)}`, str(r.title), `${str(r.title)}\n${str(r.summary)}`);
    }
    return hits.slice(0, limit);
  }

  return {
    async list(scope) {
      if (!own(scope)) return [];
      const lines = await Promise.all(STORE_NAMES.map(async (name): Promise<StoreInfo> => ({ name, line: (await deps.describe?.(name)) ?? name })));
      return lines;
    },
    async search(scope, query: StoresQuery) {
      if (!own(scope)) return [];
      const { hits, snippetChars } = deps.settings();
      const limit = query.limit ?? hits;
      const asked = query.stores === undefined ? STORE_NAMES : STORE_NAMES.filter((n) => query.stores?.includes(n));
      const lists = await Promise.all(asked.map((name) => (name === "databank" ? searchDatabank(scope, query.text, limit, snippetChars) : searchMemory(scope, query.text, limit, snippetChars))));
      return interleaved(lists, limit);
    },
    async read(scope, ref): Promise<StoreItem | undefined> {
      if (!own(scope)) return undefined;
      const [store, kind, id] = ref.split(":");
      if (store === "databank" && kind !== undefined && id !== undefined) {
        const [content, doc] = await Promise.all([get(`/api/v1/databanks/${enc(kind)}/documents/${enc(id)}/content`), get(`/api/v1/databanks/${enc(kind)}/documents/${enc(id)}`)]);
        if (!isRecord(content) || typeof content.content !== "string") return undefined;
        return { ref, store: "databank", title: isRecord(doc) ? str(doc.name) : "", text: content.content };
      }
      if (store === "memory" && id !== undefined) {
        if (kind === "entity") {
          const e = await entityRead(scope.chat, id);
          return e === null ? undefined : { ref, store: "memory", title: e.name, text: entityText(e) };
        }
        if (kind === "arc" || kind === "consolidation") {
          const row = (await consolidations(scope.chat, kind === "arc" ? 2 : 1)).find((r) => r.id === id);
          return row === undefined ? undefined : { ref, store: "memory", title: str(row.title), text: str(row.summary) };
        }
      }
      return undefined;
    },
    entity: entityRead,
  };
}
