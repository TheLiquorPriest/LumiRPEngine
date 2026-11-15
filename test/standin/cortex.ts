// What the stand-in Lumiverse's HTTP routes (`http.ts`) answer beside the chats and books: macro resolution, token counts, the
// databanks a chat has active and a search of them, and a chat's memory (entities and consolidations). Each route follows
// Lumiverse's (staging at a70f4ed2; paths are Lumiverse's `src/`), the memory and databank rows kept in the stand-in's database
// in tables made with the very columns of `src/db/baseline.sql`. What Lumiverse does that the stand-in cannot copy is the stand-in's
// own, and says so: a macro is resolved from a small set (`{{user}}`, `{{char}}` and the macros the caller gives), a token count is
// a quarter of the characters for the models a test names, and a databank search ranks by the words a chunk shares with the query.

import type { StandInDb } from "./db";
import { approximateTokens, parsed } from "./served";

type Row = Record<string, unknown>;
type Value = string | number | null;
type Rows = (sql: string, ...params: Value[]) => Row[];

/** The tables of memory and databanks the stand-in adds to its database file, as `src/db/baseline.sql` makes them (`chat_chunks` `:71-90`, `memory_consolidations` `:534-554`, `memory_entities` `:557-581`, `memory_mentions` `:595-606`, `databanks` `:238-249`). */
export const CORTEX_DDL = `
CREATE TABLE IF NOT EXISTS chat_chunks (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  start_message_id TEXT NOT NULL,
  end_message_id TEXT NOT NULL,
  message_ids TEXT NOT NULL,
  content TEXT NOT NULL,
  token_count INTEGER NOT NULL,
  vectorized_at INTEGER,
  vector_model TEXT,
  retrieval_count INTEGER DEFAULT 0,
  last_retrieved_at INTEGER,
  avg_similarity_score REAL,
  has_dialogue INTEGER DEFAULT 1,
  has_action INTEGER DEFAULT 0,
  message_count INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL, salience_score REAL DEFAULT NULL, emotional_tags TEXT DEFAULT NULL, entity_ids TEXT DEFAULT NULL, consolidation_id TEXT DEFAULT NULL, message_range_start INTEGER DEFAULT NULL, message_range_end INTEGER DEFAULT NULL, cortex_warmup_signature TEXT DEFAULT NULL, cortex_warmup_completed_at INTEGER DEFAULT NULL,
  FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS memory_consolidations (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  tier INTEGER NOT NULL DEFAULT 1,
  title TEXT,
  summary TEXT NOT NULL,
  source_chunk_ids TEXT DEFAULT '[]',
  source_consolidation_ids TEXT DEFAULT '[]',
  entity_ids TEXT DEFAULT '[]',
  message_range_start INTEGER,
  message_range_end INTEGER,
  time_range_start INTEGER,
  time_range_end INTEGER,
  salience_avg REAL DEFAULT 0.0,
  emotional_tags TEXT DEFAULT '[]',
  token_count INTEGER DEFAULT 0,
  vectorized_at INTEGER,
  vector_model TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS memory_entities (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  name TEXT NOT NULL,
  entity_type TEXT NOT NULL DEFAULT 'character',
  aliases TEXT DEFAULT '[]',
  description TEXT DEFAULT '',
  first_seen_chunk_id TEXT,
  last_seen_chunk_id TEXT,
  first_seen_at INTEGER,
  last_seen_at INTEGER,
  mention_count INTEGER DEFAULT 0,
  salience_avg REAL DEFAULT 0.0,
  status TEXT DEFAULT 'active',
  status_changed_at INTEGER,
  facts TEXT DEFAULT '[]',
  emotional_valence TEXT DEFAULT '{}',
  metadata TEXT DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL, fact_extraction_status TEXT DEFAULT 'never', fact_extraction_last_attempt INTEGER, salience_breakdown TEXT DEFAULT '{"mentionComponent":0,"arcComponent":0,"graphComponent":0,"total":0}', last_mention_timestamp INTEGER, recent_mention_count INTEGER DEFAULT 0, confidence TEXT DEFAULT 'confirmed', user_edited_at INTEGER, salience_peak REAL DEFAULT 0.0,
  FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS memory_mentions (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  chunk_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  role TEXT DEFAULT 'present',
  excerpt TEXT,
  sentiment REAL DEFAULT 0.0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (entity_id) REFERENCES memory_entities(id) ON DELETE CASCADE,
  FOREIGN KEY (chunk_id) REFERENCES chat_chunks(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS databanks (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  scope       TEXT NOT NULL CHECK(scope IN ('global', 'character', 'chat')),
  scope_id    TEXT,
  enabled     INTEGER NOT NULL DEFAULT 1,
  metadata    TEXT NOT NULL DEFAULT '{}',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
`;

/** A chunk a test puts in a databank: the stand-in keeps no vectors, so what a search finds is these. */
export interface BankChunk {
  chunkId: string;
  documentId: string;
  documentName: string;
  content: string;
}

/** The rest of what answers beside the rows: the chunks of each bank, and the models whose tokens Lumiverse counts. */
export interface CortexState {
  readonly bankChunks: Map<string, BankChunk[]>;
  readonly tokenizedModels: ReadonlySet<string>;
}

const safeArray = (raw: unknown): unknown[] => {
  const value = parsed(raw, []);
  return Array.isArray(value) ? value : [];
};
const safeObject = (raw: unknown): Record<string, unknown> => {
  const value = parsed(raw, {});
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
};

/** `rowToEntity` (`services/memory-cortex/entity-graph.ts:33-63`). */
function entityOf(row: Row): Record<string, unknown> {
  return {
    id: row.id,
    chatId: row.chat_id,
    name: row.name,
    entityType: row.entity_type,
    aliases: safeArray(row.aliases),
    description: row.description,
    firstSeenChunkId: row.first_seen_chunk_id,
    lastSeenChunkId: row.last_seen_chunk_id,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    mentionCount: row.mention_count,
    salienceAvg: row.salience_avg,
    status: row.status,
    statusChangedAt: row.status_changed_at,
    facts: safeArray(row.facts),
    emotionalValence: safeObject(row.emotional_valence),
    metadata: safeObject(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    factExtractionStatus: row.fact_extraction_status ?? "never",
    factExtractionLastAttempt: row.fact_extraction_last_attempt ?? null,
    salienceBreakdown: safeObject(row.salience_breakdown),
    lastMentionTimestamp: row.last_mention_timestamp ?? null,
    recentMentionCount: row.recent_mention_count ?? 0,
    confidence: row.confidence ?? "confirmed",
    userEditedAt: row.user_edited_at ?? null,
    saliencePeak: row.salience_peak ?? 0,
  };
}

/** `rowToConsolidation` (`services/memory-cortex/consolidation.ts:69-91`). */
function consolidationOf(row: Row): Record<string, unknown> {
  return {
    id: row.id,
    chatId: row.chat_id,
    tier: row.tier,
    title: row.title,
    summary: row.summary,
    sourceChunkIds: safeArray(row.source_chunk_ids),
    sourceConsolidationIds: safeArray(row.source_consolidation_ids),
    entityIds: safeArray(row.entity_ids),
    messageRangeStart: row.message_range_start,
    messageRangeEnd: row.message_range_end,
    timeRangeStart: row.time_range_start,
    timeRangeEnd: row.time_range_end,
    salienceAvg: row.salience_avg,
    emotionalTags: safeArray(row.emotional_tags),
    tokenCount: row.token_count,
    vectorizedAt: row.vectorized_at,
    vectorModel: row.vector_model,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** `resolveChunkMessageReferences` (`routes/memory-cortex.routes.ts:1975-1998`): each message a chunk holds, with the number it shows in the chat if it still exists. */
function messageReferences(rows: Rows, chatId: string, perRow: (string | null | undefined)[]): { messageId: string; messageNumber: number | null }[][] {
  const idsByRow = perRow.map((raw) => (typeof raw === "string" ? safeArray(raw).filter((id): id is string => typeof id === "string") : []));
  const numbers = new Map<string, number>();
  for (const id of new Set(idsByRow.flat())) {
    const found = rows("SELECT id, index_in_chat FROM messages WHERE chat_id = ? AND id = ?", chatId, id)[0];
    if (found !== undefined) numbers.set(id, Number(found.index_in_chat));
  }
  return idsByRow.map((ids) => ids.map((messageId) => ({ messageId, messageNumber: numbers.get(messageId) ?? null })));
}

/** The chunks beneath a consolidation, down through the arcs that sum others (`enrichConsolidationsWithMessageReferences`, `:2001-2060`): their messages in order of the chunks' ranges. */
function sourceMessageIds(rows: Rows, chatId: string, root: string): string[] {
  const seen = new Set<string>();
  const chunks: Row[] = [];
  const visit = (id: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    const node = rows("SELECT * FROM memory_consolidations WHERE chat_id = ? AND id = ?", chatId, id)[0];
    if (node === undefined) return;
    for (const source of safeArray(node.source_consolidation_ids)) if (typeof source === "string") visit(source);
    for (const chunk of safeArray(node.source_chunk_ids)) {
      const found = typeof chunk === "string" ? rows("SELECT * FROM chat_chunks WHERE chat_id = ? AND id = ?", chatId, chunk)[0] : undefined;
      if (found !== undefined) chunks.push(found);
    }
  };
  visit(root);
  chunks.sort((a, b) => Number(a.message_range_start === null) - Number(b.message_range_start === null) || Number(a.message_range_start) - Number(b.message_range_start) || Number(a.message_range_end) - Number(b.message_range_end) || String(a.id).localeCompare(String(b.id)));
  return chunks.flatMap((chunk) => safeArray(chunk.message_ids).filter((id): id is string => typeof id === "string"));
}

/**
 * A chat's memory (`routes/memory-cortex.routes.ts:1431-1470`, `:1528-1539`, `:1939-1947`): its entities by how often they were mentioned, each with its
 * latest excerpt and the messages behind it (`?status=` keeps one status); one entity; its consolidations by tier and place (`?tier=2` for the arcs), each with
 * the messages beneath it. A chat that is not the user's is "Chat not found" (404). There is no route that searches memory.
 */
export function memoryAnswer(rows: Rows, user: string, path: string, query: URLSearchParams): { status: number; body: unknown } | null {
  const route = /^\/api\/v1\/memory-cortex\/chats\/([^/]+)\/(entities|consolidations)(?:\/([^/]+))?$/.exec(path);
  if (route === null) return null;
  const chatId = decodeURIComponent(route[1]!);
  if (rows("SELECT id FROM chats WHERE id = ? AND user_id = ?", chatId, user)[0] === undefined) return { status: 404, body: { error: "Chat not found" } };
  if (route[2] === "entities") {
    if (route[3] !== undefined) {
      const found = rows("SELECT * FROM memory_entities WHERE chat_id = ? AND id = ?", chatId, decodeURIComponent(route[3]))[0];
      return found === undefined ? { status: 404, body: { error: "Entity not found" } } : { status: 200, body: entityOf(found) };
    }
    const status = query.get("status");
    const entities = rows("SELECT * FROM memory_entities WHERE chat_id = ? ORDER BY mention_count DESC", chatId).map(entityOf).filter((e) => !status || e.status === status);
    // The most recent mention of each entity that has an excerpt, and the chunk's messages (`:1435-1458`).
    const latest = new Map<string, { excerpt: string; messageIds: string | null }>();
    const mentions = rows(
      "SELECT mm.entity_id, mm.excerpt, cc.message_ids, mm.created_at FROM memory_mentions mm LEFT JOIN chat_chunks cc ON cc.id = mm.chunk_id WHERE mm.chat_id = ? AND mm.excerpt IS NOT NULL ORDER BY mm.created_at DESC",
      chatId,
    );
    for (const m of mentions) if (!latest.has(String(m.entity_id))) latest.set(String(m.entity_id), { excerpt: String(m.excerpt), messageIds: (m.message_ids as string | null) ?? null });
    const data = entities.map((entity) => {
      const mention = latest.get(String(entity.id));
      return { ...entity, latestExcerpt: mention?.excerpt ?? null, latestMessageReferences: mention === undefined ? [] : messageReferences(rows, chatId, [mention.messageIds])[0]! };
    });
    return { status: 200, body: { data, total: data.length } };
  }
  if (route[3] !== undefined) return null;
  const tier = query.get("tier") ? Number.parseInt(query.get("tier")!, 10) : undefined;
  const found = tier !== undefined && !Number.isNaN(tier) ? rows("SELECT * FROM memory_consolidations WHERE chat_id = ? AND tier = ? ORDER BY message_range_start ASC", chatId, tier) : rows("SELECT * FROM memory_consolidations WHERE chat_id = ? ORDER BY tier ASC, message_range_start ASC", chatId);
  const references = messageReferences(rows, chatId, found.map((c) => JSON.stringify(sourceMessageIds(rows, chatId, String(c.id)))));
  const data = found.map((c, i) => ({ ...consolidationOf(c), messageReferences: references[i]! }));
  return { status: 200, body: { data, total: data.length } };
}

// ---------------------------------------------------------------- tokens

/** `publicTokenizerBodyLimit` (`routes/tokenizers.routes.ts:11-14`): 256 KiB. */
export const TOKENIZER_BODY_MAX = 256 * 1024;
/** `MAX_COUNT_BATCH_TEXTS` (`services/tokenizer.service.ts:17`). */
export const COUNT_BATCH_MAX = 64;

/**
 * `POST /api/v1/tokenizers/count` and `/count-batch` (`routes/tokenizers.routes.ts:86-126`): the characters of each text and its tokens, which are null for a model
 * Lumiverse has no tokenizer for (`services/tokenizer.service.ts:455-463`). The stand-in has a tokenizer for the models a test names, and counts a quarter of the characters.
 */
export function tokenAnswer(state: CortexState, path: string, raw: string): { status: number; body: unknown } | null {
  if (path !== "/api/v1/tokenizers/count" && path !== "/api/v1/tokenizers/count-batch") return null;
  if (raw.length > TOKENIZER_BODY_MAX) return { status: 413, body: { error: "Request body too large" } };
  const body = parsed(raw, undefined) as Record<string, unknown> | undefined;
  if (body === undefined || body === null) return { status: 500, body: "Internal Server Error" };
  const count = (model: unknown, text: string): number | null => (typeof model === "string" && state.tokenizedModels.has(model) ? approximateTokens(text) : null);
  if (path.endsWith("/count")) {
    if (!body.model_id || !body.text) return { status: 400, body: { error: "model_id and text are required" } };
    const text = String(body.text);
    return { status: 200, body: { token_count: count(body.model_id, text), char_count: text.length } };
  }
  if (!body.model_id || !Array.isArray(body.texts)) return { status: 400, body: { error: "model_id and texts are required" } };
  if (body.texts.length > COUNT_BATCH_MAX) return { status: 413, body: { error: `Batch exceeds the ${COUNT_BATCH_MAX}-item cap` } };
  if (body.texts.some((t: unknown) => typeof t !== "string")) return { status: 400, body: { error: "texts must contain only strings" } };
  return { status: 200, body: { results: (body.texts as string[]).map((t) => ({ token_count: count(body.model_id, t), char_count: t.length })) } };
}

// ---------------------------------------------------------------- databanks

/** `resolveActiveDatabankIds` (`services/databank/scope-resolver.service.ts:31-99`): the banks enabled for the user that are global, this chat's or a given character's, and the user's `globalDatabanks`, only those that exist and are enabled. */
function activeBanks(rows: Rows, user: string, chatId: string, characters: string[]): string[] {
  const ids = new Set<string>();
  const marks = characters.map(() => "?").join(",");
  const scoped =
    characters.length === 0
      ? rows("SELECT id FROM databanks WHERE user_id = ? AND enabled = 1 AND (scope = 'global' OR (scope = 'chat' AND scope_id = ?))", user, chatId)
      : rows(`SELECT id FROM databanks WHERE user_id = ? AND enabled = 1 AND (scope = 'global' OR (scope = 'chat' AND scope_id = ?) OR (scope = 'character' AND scope_id IN (${marks})))`, user, chatId, ...characters);
  for (const r of scoped) ids.add(String(r.id));
  const global = rows("SELECT value FROM settings WHERE key = 'globalDatabanks' AND user_id = ?", user)[0];
  const listed = global === undefined ? null : parsed(global.value, null);
  if (Array.isArray(listed)) for (const id of listed) if (typeof id === "string" && id) ids.add(id);
  if (ids.size === 0) return [];
  const list = [...ids];
  return rows(`SELECT id FROM databanks WHERE id IN (${list.map(() => "?").join(",")}) AND user_id = ? AND enabled = 1`, ...list, user).map((r) => String(r.id));
}

/** `retrievalTopK`'s default (`services/databank/databank-settings.service.ts:16`). */
const DEFAULT_TOP_K = 4;

/**
 * `POST /api/v1/databanks/search` (`routes/databank.routes.ts:409-426`): `query` a string (400); the banks active for the chat and the character or characters named; the top
 * `limit` chunks (4 where none is asked), `{data: [...]}`. Lumiverse ranks by the vectors of its embeddings; the stand-in has none, and ranks the chunks that share a word with the
 * query, by how many of the query's words each holds, the earlier chunk first.
 */
export function databankAnswer(state: CortexState, rows: Rows, user: string, path: string, raw: string): { status: number; body: unknown } | null {
  if (path !== "/api/v1/databanks/search") return null;
  const body = parsed(raw, undefined) as Record<string, unknown> | undefined;
  if (body === undefined || body === null) return { status: 500, body: "Internal Server Error" };
  if (!body.query || typeof body.query !== "string") return { status: 400, body: { error: "query is required" } };
  const characters = body.characterId ? (Array.isArray(body.characterId) ? body.characterId.map(String) : [String(body.characterId)]) : [];
  const banks = activeBanks(rows, user, typeof body.chatId === "string" ? body.chatId : "", characters);
  const words = [...new Set(body.query.toLowerCase().split(/\W+/).filter(Boolean))];
  const limit = Number(body.limit) || DEFAULT_TOP_K;
  const found = banks.flatMap((bank) =>
    (state.bankChunks.get(bank) ?? []).map((chunk) => {
      const text = chunk.content.toLowerCase();
      const hits = words.filter((w) => text.includes(w)).length;
      return { bank, chunk, score: words.length === 0 ? 0 : hits / words.length };
    }),
  );
  const data = found
    .filter((f) => f.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((f) => ({ chunkId: f.chunk.chunkId, documentId: f.chunk.documentId, databankId: f.bank, documentName: f.chunk.documentName, content: f.chunk.content, score: f.score, metadata: { documentId: f.chunk.documentId, databankId: f.bank, documentName: f.chunk.documentName } }));
  return { status: 200, body: { data } };
}

// ---------------------------------------------------------------- macros

/** `normalizePromptBlockText` (`services/prompt-assembly.service.ts:6999-7001`): trimmed, runs of blank lines gone. */
const normalizedBlock = (text: string): string => text.trim().replace(/\n{3,}/g, "\n\n");

/**
 * `POST /api/v1/macros/resolve` and `/resolve-batch` (`routes/macros.routes.ts:33-145`): an empty template is `{text: "", diagnostics: []}`; a batch of more than 100 is refused
 * (400). Lumiverse's macro language is its own; the stand-in resolves `{{user}}` (the persona's name, else "User"), `{{char}}` (the chat's or the character asked's name) and the
 * macros the caller gives in `dynamic_macros`, and leaves any other macro as it was written, with no diagnostic.
 */
export function macroAnswer(rows: Rows, user: string, path: string, raw: string): { status: number; body: unknown } | null {
  if (path !== "/api/v1/macros/resolve" && path !== "/api/v1/macros/resolve-batch") return null;
  const body = parsed(raw, undefined) as Record<string, unknown> | undefined;
  if (body === undefined || body === null) return { status: 500, body: "Internal Server Error" };
  const personaId = typeof body.persona_id === "string" ? body.persona_id : (() => {
    const active = rows("SELECT value FROM settings WHERE key = 'activePersonaId' AND user_id = ?", user)[0];
    const value = active === undefined ? undefined : parsed(active.value, undefined);
    return typeof value === "string" ? value : undefined;
  })();
  const persona = personaId === undefined ? undefined : rows("SELECT name FROM personas WHERE id = ? AND user_id = ?", personaId, user)[0];
  const chat = typeof body.chat_id === "string" ? rows("SELECT character_id FROM chats WHERE id = ? AND user_id = ?", body.chat_id, user)[0] : undefined;
  const characterId = typeof body.character_id === "string" ? body.character_id : (chat?.character_id as string | undefined);
  const character = characterId === undefined ? undefined : rows("SELECT name FROM characters WHERE id = ? AND user_id = ?", characterId, user)[0];
  const known: Record<string, string> = { user: typeof persona?.name === "string" ? persona.name : "User", char: typeof character?.name === "string" ? character.name : "", ...(body.dynamic_macros !== null && typeof body.dynamic_macros === "object" ? (body.dynamic_macros as Record<string, string>) : {}) };
  const resolve = (template: string): string => template.replace(/\{\{\s*([A-Za-z_][\w]*)\s*\}\}/g, (whole, name: string) => (Object.hasOwn(known, name.toLowerCase()) ? known[name.toLowerCase()]! : Object.hasOwn(known, name) ? known[name]! : whole));
  if (path.endsWith("/resolve")) {
    if (!body.template) return { status: 200, body: { text: "", diagnostics: [] } };
    const text = resolve(String(body.template));
    return { status: 200, body: { text: body.trim ? normalizedBlock(text) : text, diagnostics: [], touched_vars: [], cacheable: true } };
  }
  if (!body.templates || typeof body.templates !== "object") return { status: 200, body: { resolved: {} } };
  const entries = Object.entries(body.templates as Record<string, string>);
  if (entries.length === 0) return { status: 200, body: { resolved: {} } };
  if (entries.length > 100) return { status: 400, body: { error: "Too many templates (max 100)" } };
  if (body.use_message_preset === true) {
    if (typeof body.chat_id !== "string" || typeof body.message_id !== "string") return { status: 400, body: { error: "chat_id and message_id are required for a message preset" } };
    return { status: 404, body: { error: "Message preset context is no longer available" } };
  }
  const resolved: Record<string, string> = {};
  const touched: Record<string, string[]> = {};
  const cacheable: Record<string, boolean> = {};
  for (const [key, template] of entries) {
    resolved[key] = template ? resolve(template) : "";
    touched[key] = [];
    cacheable[key] = true;
  }
  return { status: 200, body: { resolved, touched_vars: touched, cacheable } };
}

/** The tables and the state the stand-in's server holds for these routes, made when it is given a database: one statement at a time, for the database runs the first of a text. */
export function openCortex(db: StandInDb | undefined, tokenizedModels: readonly string[]): CortexState {
  for (const statement of CORTEX_DDL.split(/;\s*\n/)) if (statement.trim() !== "") db?.run(statement);
  return { bankChunks: new Map(), tokenizedModels: new Set(tokenizedModels) };
}
