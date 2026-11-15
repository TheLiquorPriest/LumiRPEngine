// What RPE writes to the stand-in Lumiverse's server and what it asks of it beyond reading rows, held to Lumiverse's own routes and services
// (staging at a70f4ed2; paths are Lumiverse's `src/`): an entry written with its revision, macros, token counts, the databanks a chat has active and
// a chat's memory, the sign-in lockout of an address, and sign-out. Every name is invented.

import { afterEach, describe, expect, test } from "bun:test";
import type { Rows } from "../../standin/db";
import { CHAT, json, OTHER, PASSWORD, USER, weir as weirOf, type Weir } from "./weir";

const closing: (() => void)[] = [];
afterEach(() => {
  for (const close of closing.splice(0)) close();
});

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("an entry written with its revision (`routes/world-books.routes.ts:1027-1047`, `services/world-books.service.ts:1833-1941`)", () => {
  const entry = (id: string, fields: Record<string, string | number | null> = {}): Record<string, string | number | null> => ({
    id,
    world_book_id: "book-weir",
    uid: `uid-${id}`,
    key: json(["eel"]),
    content: "The eel lives under the weir.",
    comment: "The eel",
    extensions: json({ kept: true }),
    created_at: 100,
    updated_at: 100,
    ...fields,
  });
  const rows: Partial<Rows> = {
    world_books: [
      { id: "book-weir", name: "The weir's lore", user_id: USER, created_at: 100, updated_at: 100 },
      { id: "book-pell", name: "Pell's lore", user_id: OTHER, created_at: 100, updated_at: 100 },
    ],
    world_book_entries: [entry("e1"), entry("e2", { world_book_id: "book-pell" })],
  };
  const bed = (): Promise<Weir> => weirOf(closing, rows);
  const events = (w: Weir, name: string): unknown[] => w.host.events.filter((e) => e.event === name).map((e) => e.payload);

  test("a stale revision is refused: 409 with the entry as it stands, and nothing written", async () => {
    const w = await bed();
    const mine = w.as(USER);
    const first = await mine.put("/api/v1/world-books/book-weir/entries/e1", { content: "The eel lives in the weir's deep pool.", expected_revision: 1 });
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ id: "e1", content: "The eel lives in the weir's deep pool.", revision: 2, key: ["eel"], extensions: { kept: true } });
    expect(events(w, "WORLD_BOOK_ENTRY_CHANGED")).toMatchObject([{ id: "e1", worldBookId: "book-weir", entry: { revision: 2 } }]);
    expect(w.db.rows("SELECT updated_at FROM world_books WHERE id = 'book-weir'")[0]!.updated_at).toBeGreaterThan(100);
    // The same revision again: the entry changed since, so it is refused and left as it was.
    const stale = await mine.put("/api/v1/world-books/book-weir/entries/e1", { content: "A stale hand's words.", expected_revision: 1 });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: "world_book_entry_conflict", code: "WORLD_BOOK_ENTRY_CONFLICT", conflicts: [{ id: "e1", current: { revision: 2, content: "The eel lives in the weir's deep pool." } }] });
    expect(w.db.rows("SELECT content, revision FROM world_book_entries WHERE id = 'e1'")[0]).toEqual({ content: "The eel lives in the weir's deep pool.", revision: 2 });
    expect(events(w, "WORLD_BOOK_ENTRY_CHANGED")).toHaveLength(1);
    // The revision it holds now is taken.
    expect((await mine.put("/api/v1/world-books/book-weir/entries/e1", { comment: "The deep eel", expected_revision: 2 })).status).toBe(200);
    expect(w.db.rows("SELECT revision FROM world_book_entries WHERE id = 'e1'")[0]!.revision).toBe(3);
  });

  test("with no revision asked there is no check, and the revision is raised on every write; one that is not a whole number from 1 is 428", async () => {
    const w = await bed();
    const mine = w.as(USER);
    expect((await mine.put("/api/v1/world-books/book-weir/entries/e1", { content: "No check." })).status).toBe(200);
    expect((await mine.put("/api/v1/world-books/book-weir/entries/e1", { disabled: true })).status).toBe(200);
    expect(w.db.rows("SELECT revision, disabled FROM world_book_entries WHERE id = 'e1'")[0]).toEqual({ revision: 3, disabled: 1 });
    for (const bad of [0, -1, 1.5, "2", null]) {
      const refused = await mine.put("/api/v1/world-books/book-weir/entries/e1", { content: "x", expected_revision: bad });
      expect([refused.status, await refused.json()]).toEqual([428, { error: "WORLD_BOOK_ENTRY_REVISION_INVALID", code: "WORLD_BOOK_ENTRY_REVISION_INVALID", field: "expected_revision" }]);
    }
    expect(w.db.rows("SELECT revision FROM world_book_entries WHERE id = 'e1'")[0]!.revision).toBe(3);
  });

  test("a write that changes nothing answers the entry as it is, raises no revision and tells nothing, the revision still checked", async () => {
    const w = await bed();
    const mine = w.as(USER);
    const same = await mine.put("/api/v1/world-books/book-weir/entries/e1", { expected_revision: 1 });
    expect([same.status, ((await same.json()) as { revision: number }).revision]).toEqual([200, 1]);
    expect((await mine.put("/api/v1/world-books/book-weir/entries/e1", { expected_revision: 7 })).status).toBe(409);
    expect(events(w, "WORLD_BOOK_ENTRY_CHANGED")).toEqual([]);
    expect(w.db.rows("SELECT revision FROM world_book_entries WHERE id = 'e1'")[0]!.revision).toBe(1);
  });

  test("the managed keys of an entry move in and out of its extensions; an entry of another book or another user is not found; a field of the wrong kind is refused", async () => {
    const w = await bed();
    const mine = w.as(USER);
    const written = (await (await mine.put("/api/v1/world-books/book-weir/entries/e1", { outlet_name: " weir ", wi_marker: "Main_Prompt", wi_marker_side: "after" })).json()) as { outlet_name: string; wi_marker: string; wi_marker_side: string; extensions: unknown };
    expect(written).toMatchObject({ outlet_name: "weir", wi_marker: "main_prompt", wi_marker_side: "after", extensions: { kept: true } });
    expect(JSON.parse(String(w.db.rows("SELECT extensions FROM world_book_entries WHERE id = 'e1'")[0]!.extensions))).toEqual({ kept: true, outlet_name: "weir", wi_marker: "main_prompt", wi_marker_side: "after" });
    expect((await mine.put("/api/v1/world-books/book-pell/entries/e1", { content: "x" })).status).toBe(404);
    expect((await mine.put("/api/v1/world-books/book-weir/entries/e2", { content: "x" })).status).toBe(404);
    expect((await w.as(OTHER).put("/api/v1/world-books/book-weir/entries/e1", { content: "x" })).status).toBe(404);
    const refused = await mine.put("/api/v1/world-books/book-weir/entries/e1", { tags: "lamp" });
    expect([refused.status, await refused.json()]).toEqual([400, { error: "tags must be an array of strings" }]);
    expect(await (await mine.put("/api/v1/world-books/book-weir/entries/e1", [1])).json()).toEqual({ error: "JSON object required" });
  });

  test("a book and an entry are made, each answered 201 with its own id, an entry with its columns' own defaults; an entry deleted is told", async () => {
    const w = await bed();
    const mine = w.as(USER);
    const noName = await mine.post("/api/v1/world-books", { description: "no name" });
    expect([noName.status, await noName.json()]).toEqual([400, { error: "name is required" }]);
    const made = await mine.post("/api/v1/world-books", { name: "This chat's story", metadata: { source: "projection" } });
    expect(made.status).toBe(201);
    const book = (await made.json()) as { id: string; name: string; folder: string; metadata: unknown };
    expect(book).toMatchObject({ name: "This chat's story", folder: "", metadata: { source: "projection" } });
    expect(events(w, "WORLD_BOOK_CHANGED")).toMatchObject([{ id: book.id }]);
    const created = await mine.post(`/api/v1/world-books/${book.id}/entries`, { key: ["bell"], content: "The bell hangs in the drowned tower.", comment: "The bell" });
    expect(created.status).toBe(201);
    const row = (await created.json()) as { id: string; uid: string; revision: number; depth: number; order_value: number; probability: number; use_probability: boolean; vector_index_status: string };
    expect(row).toMatchObject({ revision: 1, depth: 4, order_value: 100, probability: 100, use_probability: true, vector_index_status: "not_enabled" });
    expect(row.uid).not.toBe(row.id);
    expect((await mine.post("/api/v1/world-books/book-none/entries", { content: "x" })).status).toBe(404);
    expect((await w.as(OTHER).post(`/api/v1/world-books/${book.id}/entries`, { content: "x" })).status).toBe(404);
    expect((await mine.delete(`/api/v1/world-books/${book.id}/entries/${row.id}`)).status).toBe(200);
    expect(events(w, "WORLD_BOOK_ENTRY_DELETED")).toEqual([{ id: row.id, worldBookId: book.id }]);
    expect((await mine.delete(`/api/v1/world-books/${book.id}/entries/${row.id}`)).status).toBe(404);
  });
});

describe("macros, tokens, databanks and memory (`routes/macros.routes.ts`, `routes/tokenizers.routes.ts`, `routes/databank.routes.ts`, `routes/memory-cortex.routes.ts`)", () => {
  const rows: Partial<Rows> = {
    characters: [{ id: "char-ilsa", name: "Ilsa", user_id: USER }],
    chats: [{ id: CHAT, user_id: USER, character_id: "char-ilsa", name: "The weir", metadata: "{}" }],
    messages: [0, 1, 2, 3].map((i) => ({ id: `m${i}`, chat_id: CHAT, index_in_chat: i + 10, is_user: i % 2, name: "x", content: `line ${i}`, send_date: 1, swipes: json([`line ${i}`]), swipe_dates: json([1]), extra: "{}" })),
    personas: [{ id: "persona-mara", name: "Mara", description: "A ferrywoman.", metadata: "{}", user_id: USER }],
  };

  test("resolve gives the text with the macros the stand-in knows resolved, and says it leaves the rest; an empty template is empty; a batch is capped at 100", async () => {
    const w = await weirOf(closing, rows);
    const mine = w.as(USER);
    const one = await mine.post("/api/v1/macros/resolve", { template: "  {{char}} greets {{user}}, {{mood}} and {{unknown}}.\n\n\n\n", chat_id: CHAT, persona_id: "persona-mara", dynamic_macros: { mood: "calm" }, trim: true });
    expect(await one.json()).toEqual({ text: "Ilsa greets Mara, calm and {{unknown}}.", diagnostics: [], touched_vars: [], cacheable: true });
    expect(await (await mine.post("/api/v1/macros/resolve", { template: "" })).json()).toEqual({ text: "", diagnostics: [] });
    expect(await (await mine.post("/api/v1/macros/resolve", { template: "{{user}}" })).json()).toMatchObject({ text: "User" });
    const batch = await mine.post("/api/v1/macros/resolve-batch", { templates: { a: "{{char}}", b: "", c: "x {{user}}" }, chat_id: CHAT });
    expect(await batch.json()).toEqual({ resolved: { a: "Ilsa", b: "", c: "x User" }, touched_vars: { a: [], b: [], c: [] }, cacheable: { a: true, b: true, c: true } });
    expect(await (await mine.post("/api/v1/macros/resolve-batch", { templates: {} })).json()).toEqual({ resolved: {} });
    const many = await mine.post("/api/v1/macros/resolve-batch", { templates: Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`k${i}`, "x"])) });
    expect([many.status, await many.json()]).toEqual([400, { error: "Too many templates (max 100)" }]);
  });

  test("a token count is null for a model Lumiverse has no tokenizer for and a quarter of the characters for one it has; a batch is capped at 64 and takes only strings", async () => {
    const w = await weirOf(closing, rows, { tokenizedModels: ["model-tok"] });
    const mine = w.as(USER);
    expect(await (await mine.post("/api/v1/tokenizers/count", { model_id: "model-tok", text: "twelve chars" })).json()).toEqual({ token_count: 3, char_count: 12 });
    expect(await (await mine.post("/api/v1/tokenizers/count", { model_id: "model-none", text: "twelve chars" })).json()).toEqual({ token_count: null, char_count: 12 });
    for (const body of [{ model_id: "model-tok" }, { model_id: "model-tok", text: "" }, { text: "x" }]) {
      const refused = await mine.post("/api/v1/tokenizers/count", body);
      expect([refused.status, await refused.json()]).toEqual([400, { error: "model_id and text are required" }]);
    }
    expect(await (await mine.post("/api/v1/tokenizers/count-batch", { model_id: "model-tok", texts: ["abcd", "", "abcdefgh"] })).json()).toEqual({ results: [{ token_count: 1, char_count: 4 }, { token_count: 0, char_count: 0 }, { token_count: 2, char_count: 8 }] });
    const big = await mine.post("/api/v1/tokenizers/count-batch", { model_id: "model-tok", texts: Array.from({ length: 65 }, () => "x") });
    expect([big.status, await big.json()]).toEqual([413, { error: "Batch exceeds the 64-item cap" }]);
    const odd = await mine.post("/api/v1/tokenizers/count-batch", { model_id: "model-tok", texts: ["x", 4] });
    expect([odd.status, await odd.json()]).toEqual([400, { error: "texts must contain only strings" }]);
    const heavy = await mine.post("/api/v1/tokenizers/count", { model_id: "model-tok", text: "x".repeat(300 * 1024) });
    expect([heavy.status, await heavy.json()]).toEqual([413, { error: "Request body too large" }]);
  });

  test("a databank search covers the banks active for the chat and the character, the user's global ones included, and not a disabled bank or another chat's", async () => {
    const w = await weirOf(closing, { ...rows, settings: [{ key: "globalDatabanks", value: json(["bank-set"]), user_id: USER }] });
    const bank = (id: string, scope: string, scopeId: string | null, enabled = 1): void =>
      w.db.run("INSERT INTO databanks (id, user_id, name, scope, scope_id, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, 1)", id, USER, id, scope, scopeId, enabled);
    bank("bank-all", "global", null);
    bank("bank-chat", "chat", CHAT);
    bank("bank-else", "chat", "chat-else");
    bank("bank-ilsa", "character", "char-ilsa");
    bank("bank-off", "global", null, 0);
    bank("bank-set", "chat", "chat-else");
    const chunk = (bankId: string, text: string): void => {
      const list = w.server.cortex.bankChunks.get(bankId) ?? [];
      list.push({ chunkId: `${bankId}-${list.length}`, documentId: `doc-${bankId}`, documentName: `Notes of ${bankId}`, content: text });
      w.server.cortex.bankChunks.set(bankId, list);
    };
    for (const id of ["bank-all", "bank-chat", "bank-else", "bank-ilsa", "bank-off", "bank-set"]) chunk(id, `The eel of ${id} lives under the weir.`);
    chunk("bank-all", "Nothing here about it.");
    const search = async (body: Record<string, unknown>): Promise<{ status: number; ids: string[] }> => {
      const res = await w.as(USER).post("/api/v1/databanks/search", body);
      const data = res.status === 200 ? ((await res.json()) as { data: { databankId: string }[] }).data : [];
      return { status: res.status, ids: data.map((d) => d.databankId).sort() };
    };
    // No character named: the global and the chat's, and the user's `globalDatabanks`.
    expect(await search({ query: "eel weir", chatId: CHAT })).toEqual({ status: 200, ids: ["bank-all", "bank-chat", "bank-set"] });
    expect((await search({ query: "eel weir", chatId: CHAT, characterId: "char-ilsa" })).ids).toEqual(["bank-all", "bank-chat", "bank-ilsa", "bank-set"]);
    expect((await search({ query: "eel weir", chatId: CHAT, limit: 2 })).ids).toHaveLength(2);
    const shown = (await (await w.as(USER).post("/api/v1/databanks/search", { query: "eel weir", chatId: CHAT, limit: 1 })).json()) as { data: Record<string, unknown>[] };
    expect(shown.data[0]).toMatchObject({ documentName: expect.stringContaining("Notes of"), score: 1 });
    expect(Object.keys(shown.data[0]!).sort()).toEqual(["chunkId", "content", "databankId", "documentId", "documentName", "metadata", "score"]);
    const refused = await w.as(USER).post("/api/v1/databanks/search", { chatId: CHAT });
    expect([refused.status, await refused.json()]).toEqual([400, { error: "query is required" }]);
  });

  test("a chat's memory: its entities by mention, each with its latest excerpt and the messages behind it; its consolidations by tier, the arcs by ?tier=2; another's chat is not found; there is no route that searches it", async () => {
    const w = await weirOf(closing, rows);
    const run = (sql: string, ...params: (string | number | null)[]): void => w.db.run(sql, ...params);
    run("INSERT INTO chat_chunks (id, chat_id, start_message_id, end_message_id, message_ids, content, token_count, message_count, created_at, updated_at, message_range_start, message_range_end) VALUES ('c1', ?, 'm0', 'm1', ?, 'chunk', 3, 2, 1, 1, 10, 11)", CHAT, json(["m0", "m1", "gone"]));
    run("INSERT INTO chat_chunks (id, chat_id, start_message_id, end_message_id, message_ids, content, token_count, message_count, created_at, updated_at, message_range_start, message_range_end) VALUES ('c2', ?, 'm2', 'm3', ?, 'chunk', 3, 2, 1, 1, 12, 13)", CHAT, json(["m2", "m3"]));
    run("INSERT INTO memory_entities (id, chat_id, name, entity_type, mention_count, status, aliases, created_at, updated_at) VALUES ('en1', ?, 'The eel', 'creature', 5, 'active', ?, 1, 1)", CHAT, json(["old one"]));
    run("INSERT INTO memory_entities (id, chat_id, name, mention_count, status, created_at, updated_at) VALUES ('en2', ?, 'The bell', 9, 'inactive', 1, 1)", CHAT);
    run("INSERT INTO memory_mentions (id, entity_id, chunk_id, chat_id, excerpt, created_at) VALUES ('mm1', 'en1', 'c1', ?, 'older words', 1)", CHAT);
    run("INSERT INTO memory_mentions (id, entity_id, chunk_id, chat_id, excerpt, created_at) VALUES ('mm2', 'en1', 'c2', ?, 'newest words', 2)", CHAT);
    run("INSERT INTO memory_consolidations (id, chat_id, tier, title, summary, source_chunk_ids, message_range_start, message_range_end, created_at, updated_at) VALUES ('cons1', ?, 1, 'First', 'The eel is seen.', ?, 10, 11, 1, 1)", CHAT, json(["c1"]));
    run("INSERT INTO memory_consolidations (id, chat_id, tier, title, summary, source_chunk_ids, message_range_start, message_range_end, created_at, updated_at) VALUES ('cons2', ?, 1, 'Second', 'The bell tolls.', ?, 12, 13, 1, 1)", CHAT, json(["c2"]));
    run("INSERT INTO memory_consolidations (id, chat_id, tier, title, summary, source_consolidation_ids, message_range_start, message_range_end, created_at, updated_at) VALUES ('arc1', ?, 2, 'Arc', 'The night at the weir.', ?, 10, 13, 1, 1)", CHAT, json(["cons1", "cons2"]));
    const mine = w.as(USER);
    const entities = (await (await mine.get(`/api/v1/memory-cortex/chats/${CHAT}/entities`)).json()) as { data: { id: string; name: string; aliases: string[]; latestExcerpt: string | null; latestMessageReferences: unknown[] }[]; total: number };
    expect(entities.data.map((e) => e.id)).toEqual(["en2", "en1"]);
    expect(entities.total).toBe(2);
    expect(entities.data[1]).toMatchObject({ name: "The eel", aliases: ["old one"], latestExcerpt: "newest words", latestMessageReferences: [{ messageId: "m2", messageNumber: 12 }, { messageId: "m3", messageNumber: 13 }] });
    expect(entities.data[0]).toMatchObject({ latestExcerpt: null, latestMessageReferences: [] });
    expect(((await (await mine.get(`/api/v1/memory-cortex/chats/${CHAT}/entities?status=active`)).json()) as { data: unknown[] }).data).toHaveLength(1);
    expect(await (await mine.get(`/api/v1/memory-cortex/chats/${CHAT}/entities/en2`)).json()).toMatchObject({ id: "en2", name: "The bell", status: "inactive" });
    expect((await mine.get(`/api/v1/memory-cortex/chats/${CHAT}/entities/none`)).status).toBe(404);
    const all = (await (await mine.get(`/api/v1/memory-cortex/chats/${CHAT}/consolidations`)).json()) as { data: { id: string; tier: number; messageReferences: { messageId: string; messageNumber: number | null }[] }[]; total: number };
    expect(all.data.map((c) => [c.tier, c.id])).toEqual([[1, "cons1"], [1, "cons2"], [2, "arc1"]]);
    // An arc stands for the messages beneath the consolidations it sums; a message deleted since is kept, with no number.
    expect(all.data[2]!.messageReferences).toEqual([{ messageId: "m0", messageNumber: 10 }, { messageId: "m1", messageNumber: 11 }, { messageId: "gone", messageNumber: null }, { messageId: "m2", messageNumber: 12 }, { messageId: "m3", messageNumber: 13 }]);
    const arcs = (await (await mine.get(`/api/v1/memory-cortex/chats/${CHAT}/consolidations?tier=2`)).json()) as { data: { id: string }[]; total: number };
    expect([arcs.total, arcs.data.map((c) => c.id)]).toEqual([1, ["arc1"]]);
    const theirs = await w.as(OTHER).get(`/api/v1/memory-cortex/chats/${CHAT}/entities`);
    expect([theirs.status, await theirs.json()]).toEqual([404, { error: "Chat not found" }]);
    expect((await mine.get(`/api/v1/memory-cortex/chats/${CHAT}/search?q=eel`)).status).toBe(404);
  });
});

describe("the sign-in lockout (`services/auth-lockout.service.ts:24-31`, `app.ts:134-158`, `:280-315`)", () => {
  const OUTSIDE = "192.0.2.17";
  const signIn = (w: Weir, password: string): Promise<Response> => w.server.fetch(`${w.server.base}/api/auth/sign-in/username`, { method: "POST", headers: { "content-type": "application/json" }, body: json({ username: "mara", password }) });
  const wrong = (w: Weir): Promise<Response> => signIn(w, "wrong");
  const right = (w: Weir): Promise<Response> => signIn(w, PASSWORD);
  /** Five wrong sign-ins: the status each was answered with, and the wait the last one was told. */
  const fiveWrong = async (w: Weir): Promise<{ statuses: number[]; wait: number | null }> => {
    const statuses: number[] = [];
    let last: Response | null = null;
    for (let i = 0; i < 5; i++) {
      last = await wrong(w);
      statuses.push(last.status);
    }
    const seconds = last?.headers.get("retry-after");
    return { statuses, wait: seconds === null || seconds === undefined ? null : Number(seconds) * 1000 };
  };

  test("five failed sign-ins from one address answer 429 with a lockout of 15 minutes, which holds every route, then lifts", async () => {
    const w = await weirOf(closing, {}, { clientAddress: OUTSIDE });
    for (let i = 0; i < 4; i++) expect((await wrong(w)).status).toBe(401);
    const locked = await wrong(w);
    expect(locked.status).toBe(429);
    expect(locked.headers.get("retry-after")).toBe("900");
    expect(await locked.json()).toEqual({ error: "Too many failed sign-in attempts. Try again later.", retryAfterSeconds: 900, lockedUntil: new Date(w.clock.now() + 15 * MINUTE).toISOString(), lockoutLevel: 1, reason: "login" });
    // Every route under /api/ is refused, a right password and a held session's read among them.
    const refused = await right(w);
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ error: "Too many authentication failures from this client. Try again later.", lockoutLevel: 1 });
    expect((await w.as(USER).get(`/api/v1/chats/${CHAT}`)).status).toBe(429);
    await w.clock.advance(10 * MINUTE);
    expect((await right(w)).headers.get("retry-after")).toBe("300");
    await w.clock.advance(5 * MINUTE);
    expect((await right(w)).status).toBe(200);
    expect((await w.as(USER).get(`/api/v1/chats/${CHAT}?messages=false`)).status).toBe(404);
  });

  test("the lockout grows each time: 30 minutes, an hour, 6 hours, then doubling to at most 7 days", async () => {
    const w = await weirOf(closing, {}, { clientAddress: OUTSIDE });
    const waits: (number | null)[] = [];
    for (let level = 1; level <= 9; level++) {
      const { statuses, wait } = await fiveWrong(w);
      expect(statuses).toEqual([401, 401, 401, 401, 429]);
      expect(w.server.lockoutState()?.level).toBe(level);
      waits.push(wait);
      await w.clock.advance(wait!);
    }
    expect(waits).toEqual([15 * MINUTE, 30 * MINUTE, HOUR, 6 * HOUR, 12 * HOUR, DAY, 2 * DAY, 4 * DAY, 7 * DAY]);
  });

  test("a success clears the count of failures; a loopback address is never locked, and only the limiter of eight sign-ins in five minutes holds it", async () => {
    const w = await weirOf(closing, {}, { clientAddress: OUTSIDE });
    for (let i = 0; i < 4; i++) expect((await wrong(w)).status).toBe(401);
    expect((await right(w)).status).toBe(200);
    await w.clock.advance(6 * MINUTE);
    for (let i = 0; i < 4; i++) expect((await wrong(w)).status).toBe(401);
    expect(w.server.lockoutState()?.failures).toBe(4);
    // RPE beside Lumiverse is on a loopback address: two sign-ins were made to set the bed up, then six wrong ones pass and the limiter holds the rest.
    const beside = await weirOf(closing);
    const answers: number[] = [];
    for (let i = 0; i < 8; i++) answers.push((await wrong(beside)).status);
    expect(answers).toEqual([401, 401, 401, 401, 401, 401, 429, 429]);
    expect(beside.server.lockoutState()).toBeNull();
  });

  test("a state with no failure and no lockout for a week is forgotten: the next lockout starts again at 15 minutes", async () => {
    const w = await weirOf(closing, {}, { clientAddress: OUTSIDE });
    await fiveWrong(w);
    await w.clock.advance(15 * MINUTE);
    expect(w.server.lockoutState()?.level).toBe(1);
    await w.clock.advance(8 * DAY);
    expect((await right(w)).status).toBe(200);
    expect(w.server.lockoutState()).toBeNull();
    expect((await fiveWrong(w)).wait).toBe(15 * MINUTE);
    expect(w.server.lockoutState()?.level).toBe(1);
  });
});

describe("signing out (`POST /api/auth/sign-out`, Better Auth: `app.ts:356-357`)", () => {
  test("ends the session the request holds: it answers {success: true}, and the token is dead for every read after", async () => {
    const w = await weirOf(closing);
    const mine = w.as(USER);
    expect((await mine.get("/api/v1/chats/none")).status).toBe(404);
    expect(w.server.sessionCount(USER)).toBe(1);
    const out = await mine.post("/api/auth/sign-out");
    expect([out.status, await out.json()]).toEqual([200, { success: true }]);
    const after = await mine.get("/api/v1/chats/none");
    expect([after.status, await after.json()]).toEqual([401, { error: "Unauthorized", code: "SESSION_EXPIRED" }]);
    expect(w.server.sessionCount(USER)).toBe(0);
    // With no session to end it answers the same.
    const none = await w.server.fetch(`${w.server.base}/api/auth/sign-out`, { method: "POST" });
    expect([none.status, await none.json()]).toEqual([200, { success: true }]);
  });
});


describe("what refuses a request with a 403 (`auth/middleware.ts:92-103`, `app.ts:233-240`, Better Auth's get-session)", () => {
  const accounts = [
    { id: USER, username: "mara", password: PASSWORD },
    { id: OTHER, username: "pell", password: PASSWORD, role: "admin" as const },
  ];
  const session = (w: Weir, user: string): Promise<Response> => w.as(user).get("/api/auth/get-session");

  test("a session names its user's role: \"user\" unless the account has another", async () => {
    const w = await weirOf(closing, {}, { accounts });
    expect(((await (await session(w, USER)).json()) as { user: unknown }).user).toEqual({ id: USER, role: "user" });
    expect(((await (await session(w, OTHER)).json()) as { user: unknown }).user).toEqual({ id: OTHER, role: "admin" });
  });

  test("an owner-gated route tells a user 403 {error: Forbidden}, and an admin or the owner its list; no session is a 401 before the gate", async () => {
    const w = await weirOf(closing, {}, { accounts });
    const denied = await w.as(USER).get("/api/v1/users");
    expect([denied.status, await denied.json()]).toEqual([403, { error: "Forbidden" }]);
    const listed = await w.as(OTHER).get("/api/v1/users");
    expect(listed.status).toBe(200);
    expect(((await listed.json()) as { username: string; role: string }[]).map((u) => `${u.username}:${u.role}`)).toEqual(["mara:user", "pell:admin"]);
    const none = await w.server.fetch(`${w.server.base}/api/v1/users`, { method: "GET" });
    expect([none.status, await none.json()]).toEqual([401, { error: "Unauthorized", code: "SESSION_EXPIRED" }]);
  });

  test("an untrusted host is told 403 {error: Forbidden} on every route under /api/, the sign-in and get-session among them, until it is trusted", async () => {
    const w = await weirOf(closing, {}, { accounts });
    w.server.untrustedHost = true;
    for (const [method, path] of [["POST", "/api/auth/sign-in/username"], ["GET", "/api/auth/get-session"], ["GET", "/api/v1/chats/none"]] as const) {
      const res = await w.server.fetch(`${w.server.base}${path}`, { method });
      expect([path, res.status, await res.json()]).toEqual([path, 403, { error: "Forbidden" }]);
    }
    w.server.untrustedHost = false;
    expect((await session(w, USER)).status).toBe(200);
  });
});
