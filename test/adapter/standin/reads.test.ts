// The reads RPE's HTTP road makes of the stand-in Lumiverse's server, held to Lumiverse's own routes and
// services (staging at a70f4ed2; paths are Lumiverse's `src/`): the stored breakdown of a reply, a dry run of
// the chat's prompt, the message list in its light form and its pages, and every other read of
// `src/adapter/lumiverse/http-reads.ts` (books and their entries, a character, personas, a preset, a
// setting) against what the database file gives. Every name is invented.

import { afterEach, describe, expect, test } from "bun:test";
import { createDbReader, type DbReader } from "../../../src/adapter/lumiverse/db";
import { createHttpReads } from "../../../src/adapter/lumiverse/http-reads";
import type { LumiverseReads } from "../../../src/adapter/lumiverse/reads";
import type { Rows } from "../../standin/db";
import type { ChatMessage, Preset } from "../../standin/lumiverse";
import { CHAT, json, LINES, OTHER, USER, weir as weirOf, weirChat as weirChatOf, type Weir } from "./weir";

const closing: (() => void)[] = [];
afterEach(() => {
  for (const close of closing.splice(0)) close();
});

const weir = (rows: Partial<Rows> = {}): Promise<Weir> => weirOf(closing, rows);
const weirChat = (messages: ChatMessage[], preset: Partial<Preset> = {}): Promise<Weir & { asked(): number }> => weirChatOf(closing, messages, preset);

describe("the stored breakdown (`routes/generate.routes.ts:175-181`, `services/breakdown.service.ts:14-21`)", () => {
  test("serves what was stored with a reply, and 404 where none is: another user's, a deleted reply's, one never made", async () => {
    const bed = await weirChat(LINES);
    const out = await bed.host.generate({ chat: CHAT, connection: "conn-model", preset: "preset-weir" });
    expect(out.error).toBeNull();
    const [id] = [...bed.host.stored.keys()];
    expect(id).toBeDefined();
    const mine = bed.as(USER);
    const served = await mine.get(`/api/v1/generate/breakdown/${id}`);
    expect(served.status).toBe(200);
    expect(await served.json()).toEqual(JSON.parse(json(out.stored)));
    for (const [who, message] of [[OTHER, id!], [USER, "no-such-message"]] as const) {
      const refused = await bed.as(who).get(`/api/v1/generate/breakdown/${message}`);
      expect(refused.status).toBe(404);
      expect(await refused.json()).toEqual({ error: "No breakdown found for this message" });
    }
    bed.host.deleteMessage(CHAT, id!);
    expect((await mine.get(`/api/v1/generate/breakdown/${id}`)).status).toBe(404);
  });
});

describe("a dry run (`routes/generate.routes.ts:26-43`, `services/generate.service.ts:3080-3274`)", () => {
  const ask = { chat_id: CHAT, connection_id: "conn-model", preset_id: "preset-weir" };

  test("answers as DryRunResult: the display prompt, the breakdown without the chat history, the counts; no preset at its top, no request messages unless asked", async () => {
    const bed = await weirChat(LINES);
    const res = await bed.as(USER).post("/api/v1/generate/dry-run", ask);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown> & { messages: { role: string; content: string; __chatHistorySource?: boolean }[]; breakdown: { type: string; name: string }[]; tokenCount: { total_tokens: number; breakdown: { type: string; tokens: number }[]; tokenizer_name: string } };
    expect(body.messages.map((m) => [m.role, m.content])).toEqual([
      ["system", "MAIN You narrate a night at the weir."],
      ["assistant", "GREET The weir hums in the dark."],
      ["user", "USER-1 I lower the lantern."],
      ["assistant", "REPLY-1 Ilsa points at the water."],
      ["user", "USER-2 I step to the edge."],
    ]);
    expect(body.messages.filter((m) => m.__chatHistorySource === true)).toHaveLength(4);
    // The history is one entry of the breakdown Lumiverse counts, and is left out of what it lists (`:3202-3208`, `:3255`).
    expect(body.breakdown.map((e) => [e.type, e.name])).toEqual([["block", "Main"]]);
    expect(body.tokenCount.breakdown.map((e) => e.type)).toEqual(["block"]);
    expect(body.chatHistoryTokens).toBeGreaterThan(0);
    expect(body.tokenCount.total_tokens).toBe((body.chatHistoryTokens as number) + body.tokenCount.breakdown[0]!.tokens);
    expect(body).toMatchObject({ model: "model", provider: "custom", parameters: {} });
    expect(Object.keys(body)).not.toContain("presetId");
    expect(Object.keys(body)).not.toContain("presetName");
    expect(Object.keys(body)).not.toContain("request_messages");
    const asked = (await (await bed.as(USER).post("/api/v1/generate/dry-run", { ...ask, include_request_messages: true })).json()) as { request_messages: { role: string }[] };
    expect(asked.request_messages.map((m) => m.role)).toEqual(["system", "assistant", "user", "assistant", "user"]);
  });

  test("runs the interceptors with dryRun set, and makes no lock, no call to the provider, no message and no event", async () => {
    const bed = await weirChat(LINES);
    const contexts: Record<string, unknown>[] = [];
    bed.host.install(["interceptor"]).registerInterceptor(async (messages, context) => {
      contexts.push(context as Record<string, unknown>);
      return messages;
    }, {});
    const before = bed.host.events.length;
    expect((await bed.as(USER).post("/api/v1/generate/dry-run", ask)).status).toBe(200);
    expect(contexts).toHaveLength(1);
    expect(contexts[0]).toMatchObject({ dryRun: true, chatId: CHAT });
    expect(bed.asked()).toBe(0);
    expect(bed.host.chats.get(CHAT)!.messages).toHaveLength(4);
    expect(bed.host.events.length).toBe(before);
    expect(bed.db.rows("SELECT id FROM messages WHERE chat_id = ?", CHAT)).toHaveLength(4);
  });

  test("a dry run's prompt ends as its generation's would: the prefill, a continue's target named from the chat (a player's message too) and the move", async () => {
    const preset = { assistantPrefill: "PREFILL-START", continueNudge: "NUDGE-ON" };
    const bed = await weirChat(LINES, preset);
    const dry = async (extra: Record<string, unknown>): Promise<{ role: string; content: string; partial?: boolean }[]> => {
      const res = await bed.as(USER).post("/api/v1/generate/dry-run", { ...ask, ...extra });
      expect(res.status).toBe(200);
      return ((await res.json()) as { messages: { role: string; content: string; partial?: boolean }[] }).messages;
    };
    const newReply = await dry({});
    expect(newReply.at(-1)).toMatchObject({ role: "assistant", content: "PREFILL-START", partial: true });
    expect(((await (await bed.as(USER).post("/api/v1/generate/dry-run", ask)).json()) as { assistantPrefill: string }).assistantPrefill).toBe("PREFILL-START");
    // The same prompt a generation sends.
    const real = await bed.host.generate({ chat: CHAT, connection: "conn-model", preset: "preset-weir" });
    expect(newReply.map((m) => [m.role, m.content])).toEqual(real.prompt.map((m) => [m.role, typeof m.content === "string" ? m.content : ""]));
    // A continue goes on the chat's last reply: it moves to the end, the nudge after it.
    const reply = bed.host.chats.get(CHAT)!.messages.find((m) => m.id === "m2")!;
    const goingOn = await dry({ generation_type: "continue", message_id: reply.id });
    expect(goingOn.slice(-2).map((m) => [m.role, m.content])).toEqual([
      ["assistant", "REPLY-1 Ilsa points at the water."],
      ["system", "NUDGE-ON"],
    ]);
    // And a player's message too: a dry run does not refuse it (`:3150-3155`), and nothing moves, since no assistant message is the target.
    const player = await dry({ generation_type: "continue", message_id: "m1" });
    expect(player.at(-1)).toMatchObject({ role: "system", content: "NUDGE-ON" });
    expect(player.filter((m) => m.content === "REPLY-1 Ilsa points at the water.")).toHaveLength(1);
  });

  test("refuses as Lumiverse refuses: no chat_id, a flag that is not a boolean, no connection, no preset, a preset deleted, a chat that is not the user's", async () => {
    const bed = await weirChat(LINES);
    const mine = bed.as(USER);
    const told = async (body: unknown, who = mine): Promise<[number, unknown]> => {
      const res = await who.post("/api/v1/generate/dry-run", body);
      return [res.status, await res.json()];
    };
    expect(await told({ connection_id: "conn-model" })).toEqual([400, { error: "chat_id is required" }]);
    expect(await told({ ...ask, include_request_messages: "yes" })).toEqual([400, { error: "include_request_messages must be a boolean" }]);
    // With no connection asked for, Lumiverse takes the active profile, else the default, else any the user owns (`resolveActingConnectionId`, `services/connections.service.ts:408-412`): it refuses only where there is none.
    expect((await told({ chat_id: CHAT, preset_id: "preset-weir" }))[0]).toBe(200);
    const bare = await weirChat(LINES);
    bare.host.connections.clear();
    expect(await told({ chat_id: CHAT, preset_id: "preset-weir" }, bare.as(USER))).toEqual([400, { error: "No connection profile found. Configure a default connection or select one for this chat." }]);
    expect(await told({ chat_id: CHAT, connection_id: "conn-model" })).toEqual([400, { error: "No preset selected. Choose a preset before generating." }]);
    expect(await told({ ...ask, preset_id: "preset-gone" })).toEqual([400, { error: "The selected preset was deleted. Pick a different preset before generating." }]);
    expect(await told(ask, bed.as(OTHER))).toEqual([400, { error: "Chat not found" }]);
  });
});

describe("the user's characters and embeddings configuration (`routes/characters.routes.ts:525-535`, `routes/embeddings.routes.ts:12-15`)", () => {
  const card = (id: string, user: string, at: number, extra: Record<string, string | number> = {}): Record<string, string | number | null> => ({ id, name: id, user_id: user, updated_at: at, extensions: json({}), ...extra });

  test("the list is the user's own cards, not those being deleted, the most lately changed first, paged, each with its extensions", async () => {
    const bed = await weir({ characters: [card("char-a", USER, 10, { extensions: json({ lumirpengine_floor_test: true }) }), card("char-b", USER, 30), card("char-c", USER, 20, { deleting: 1 }), card("char-d", OTHER, 40), card("char-e", USER, 20)] });
    const mine = bed.as(USER);
    const all = (await (await mine.get("/api/v1/characters")).json()) as { data: { id: string; extensions: Record<string, unknown> }[]; total: number; limit: number; offset: number };
    expect(all.data.map((c) => c.id)).toEqual(["char-b", "char-e", "char-a"]);
    expect([all.total, all.offset]).toEqual([3, 0]);
    // Lumiverse's mapper adds the card's library scope to its extensions (`rowToCharacter`).
    expect(all.data.find((c) => c.id === "char-a")!.extensions).toEqual({ lumirpengine_floor_test: true, _lumiverse_library_scope: "mine" });
    const page = (await (await mine.get("/api/v1/characters?limit=1&offset=1")).json()) as { data: { id: string }[]; total: number; limit: number; offset: number };
    expect([page.data.map((c) => c.id), page.total, page.limit, page.offset]).toEqual([["char-e"], 3, 1, 1]);
    expect(await (await mine.get("/api/v1/characters/char-a")).json()).toMatchObject({ id: "char-a", extensions: { lumirpengine_floor_test: true } });
  });

  test("the embeddings configuration is Lumiverse's defaults where none is stored, the stored one over them, and has a key only where a secret is held", async () => {
    const bed = await weir();
    const mine = bed.as(USER);
    const plain = (await (await mine.get("/api/v1/embeddings/config")).json()) as Record<string, unknown>;
    expect(plain).toMatchObject({ enabled: false, provider: "openai-compatible", dimensions: null, vectorize_world_books: true, vectorize_chat_messages: false, retrieval_top_k: 4, hybrid_weight_mode: "balanced", similarity_threshold: 0, rerank_cutoff: 0, has_api_key: false, fallbackProfileIds: [] });
    expect((plain.connectionProfiles as unknown[]).length).toBe(1);
    bed.host.library.setSetting(USER, "embeddingConfig", { enabled: true, dimensions: 768, vectorize_world_books: false, retrieval_top_k: 7.9, similarity_threshold: 9 });
    const stored = (await (await mine.get("/api/v1/embeddings/config")).json()) as { enabled: boolean; dimensions: number; vectorize_world_books: boolean; retrieval_top_k: number; similarity_threshold: number; has_api_key: boolean; primaryProfileId: string; connectionProfiles: { id: string; dimensions: number }[] };
    expect(stored).toMatchObject({ enabled: true, dimensions: 768, vectorize_world_books: false, retrieval_top_k: 7, similarity_threshold: 2, has_api_key: false });
    expect(stored.connectionProfiles[0]).toMatchObject({ id: stored.primaryProfileId, dimensions: 768 });
    bed.server.profiles!.secrets.set(`${USER}\0embedding-profile/${stored.primaryProfileId}/apiKey`, "embedding-key");
    expect(((await (await mine.get("/api/v1/embeddings/config")).json()) as { has_api_key: boolean }).has_api_key).toBe(true);
    // The oldest account's configuration is served to another user while it is enabled, told as inherited.
    const inherited = (await (await bed.as(OTHER).get("/api/v1/embeddings/config")).json()) as { enabled: boolean; inherited?: boolean; dimensions: number };
    expect(inherited).toMatchObject({ enabled: true, inherited: true, dimensions: 768 });
  });
});

/** A message row as Lumiverse stores it: the swipes, the shown one, and what is kept beside them. */
function row(id: string, index: number, fields: Record<string, string | number | null> = {}): Record<string, string | number | null> {
  return { id, chat_id: CHAT, index_in_chat: index, is_user: index % 2, name: index % 2 ? "Mara" : "Ilsa", content: `text of ${id}`, send_date: 1_767_600_000 + index, swipe_id: 0, swipes: json([`text of ${id}`]), swipe_dates: json([1_767_600_000 + index]), extra: "{}", ...fields };
}

describe("the message list as Lumiverse serves it (`services/chats.service.ts:512-557`, `:2226-2275`; `routes/chats.routes.ts:792-821`)", () => {
  const swiped = row("m2", 2, {
    content: "second swipe",
    swipe_id: 1,
    swipes: json(["first swipe", "second swipe", "third swipe"]),
    swipe_dates: json([1, 2, 3]),
    extra: json({ reasoningBySwipe: [null, "thinking of the second", null], tokenCountBySwipe: [11, 22, 33], hidden: true, keepMe: { a: 1 } }),
  });
  // A message that holds a single swipe's values under the keys Lumiverse once used: folded into the per-swipe arrays at the swipe shown (`:262-403`).
  const legacy = row("m4", 4, { extra: json({ reasoning: "kept thinking", tokenCount: 7 }) });
  const rows = [row("m0", 0), row("m1", 1), swiped, row("m3", 3), legacy, row("m6", 6), row("m7", 7)];
  const chatRows = { chats: [{ id: CHAT, user_id: USER, name: "The weir", metadata: "{}" }], messages: rows };
  const list = async (query: string): Promise<{ data: Record<string, any>[]; [key: string]: unknown }> => {
    const bed = await weir(chatRows);
    const res = await bed.as(USER).get(`/api/v1/chats/${CHAT}/messages${query}`);
    expect(res.status).toBe(200);
    return (await res.json()) as { data: Record<string, any>[] };
  };

  test("the light list: the swipes not shown are null, the per-swipe arrays are left out, and extra shows the shown swipe's values", async () => {
    const page = await list("");
    const m2 = page.data.find((m) => m.id === "m2")!;
    expect(m2.swipes).toEqual([null, "second swipe", null]);
    expect(m2.swipe_dates).toEqual([1, 2, 3]);
    expect(m2.extra).toEqual({ hidden: true, keepMe: { a: 1 }, reasoning: "thinking of the second", tokenCount: 22 });
    expect(m2.is_user).toBe(false);
    expect(m2.parent_message_id).toBeNull();
    // One swipe: kept as it is.
    expect(page.data[0]!.swipes).toEqual(["text of m0"]);
    expect(page).toMatchObject({ total: 7, limit: 50, offset: 0 });
    expect(page.data.map((m) => m.index_in_chat)).toEqual([0, 1, 2, 3, 4, 6, 7]);
  });

  test("full=true keeps every swipe and the per-swipe arrays, with extra still projected to the shown swipe", async () => {
    const m2 = (await list("?full=true")).data.find((m) => m.id === "m2")!;
    expect(m2.swipes).toEqual(["first swipe", "second swipe", "third swipe"]);
    expect(m2.extra).toEqual({ hidden: true, keepMe: { a: 1 }, reasoning: "thinking of the second", reasoningBySwipe: [null, "thinking of the second", null], tokenCount: 22, tokenCountBySwipe: [11, 22, 33] });
    const folded = (await list("?full=true")).data.find((m) => m.id === "m4")!;
    expect(folded.extra).toEqual({ reasoning: "kept thinking", reasoningBySwipe: ["kept thinking"], tokenCount: 7, tokenCountBySwipe: [7] });
  });

  test("pages by offset, by the newest (tail), and before a boundary, as Lumiverse pages", async () => {
    expect(await list("?limit=3&offset=2")).toMatchObject({ total: 7, limit: 3, offset: 2, data: [{ id: "m2" }, { id: "m3" }, { id: "m4" }] });
    expect(await list("?tail=true&limit=2")).toMatchObject({ total: 7, limit: 2, offset: 5, data: [{ id: "m6" }, { id: "m7" }] });
    // Before the message numbered 6 (the gap after m4 is a delete's): the two before it, oldest first, and there are more.
    const before = await list("?beforeIndex=6&beforeId=m6&limit=2");
    expect(before.data.map((m) => m.id)).toEqual(["m3", "m4"]);
    expect(before).toMatchObject({ has_more: true, limit: 2 });
    expect(Object.keys(before)).not.toContain("total");
    expect((await list("?beforeIndex=3&beforeId=m3&limit=10")).data.map((m) => m.id)).toEqual(["m0", "m1", "m2"]);
    expect(await list("?beforeIndex=3&beforeId=m3&limit=10")).toMatchObject({ has_more: false });
  });

  test("a limit that is not a whole number is 50, one past either end is held to 1 and 1000; a boundary with no id is refused", async () => {
    expect(await list("?limit=lots")).toMatchObject({ limit: 50 });
    expect(await list("?limit=0")).toMatchObject({ limit: 1, data: [{ id: "m0" }] });
    expect(await list("?limit=5000")).toMatchObject({ limit: 1000 });
    expect(await list("?offset=-4&limit=1")).toMatchObject({ offset: 0 });
    const bed = await weir(chatRows);
    for (const query of ["?beforeIndex=3", "?beforeIndex=-1&beforeId=m3", "?beforeIndex=x&beforeId=m3"]) {
      const res = await bed.as(USER).get(`/api/v1/chats/${CHAT}/messages${query}`);
      expect([res.status, await res.json()]).toEqual([400, { error: "beforeIndex and beforeId must identify a message boundary" }]);
    }
    expect((await bed.as(OTHER).get(`/api/v1/chats/${CHAT}/messages`)).status).toBe(404);
  });

  test("the chat itself: with its messages unless messages=false, and the character that draws it where an enabled extension is named for it", async () => {
    const bed = await weir({ ...chatRows, characters: [{ id: "char-ilsa", name: "Ilsa", extensions: json({ "lumi-draw": { display_owner: 1 } }), user_id: USER }] });
    const chat = await bed.as(USER).get(`/api/v1/chats/${CHAT}?messages=false`);
    expect(await chat.json()).toMatchObject({ id: CHAT, name: "The weir", metadata: {}, character_display_owner: null });
    expect(Object.keys((await (await bed.as(USER).get(`/api/v1/chats/${CHAT}?messages=false`)).json()) as object)).not.toContain("messages");
    const whole = (await (await bed.as(USER).get(`/api/v1/chats/${CHAT}`)).json()) as { messages: { id: string; swipes: unknown[] }[] };
    expect(whole.messages.map((m) => m.id)).toEqual(["m0", "m1", "m2", "m3", "m4", "m6", "m7"]);
    expect(whole.messages[2]!.swipes).toEqual(["first swipe", "second swipe", "third swipe"]);
  });
});

describe("every read RPE's HTTP road makes (`src/adapter/lumiverse/http-reads.ts`)", () => {
  const book = { id: "book-weir", name: "The weir's lore", description: "Eels and lamps.", metadata: json({ source: "test" }), created_at: 100, updated_at: 200, user_id: USER, folder: "" };
  const entry = (id: string, order: number, fields: Record<string, string | number | null> = {}): Record<string, string | number | null> => ({
    id,
    world_book_id: "book-weir",
    uid: `uid-${id}`,
    key: json([`key ${id}`]),
    keysecondary: json([]),
    content: `Text of ${id}.`,
    comment: `Entry ${id}`,
    position: 0,
    depth: 4,
    order_value: order,
    extensions: json({ outlet_name: "weir", kept: true }),
    updated_at: 150,
    ...fields,
  });
  const rows: Partial<Rows> = {
    characters: [{ id: "char-ilsa", name: "Ilsa", description: "A keeper of the weir.", tags: json(["keeper"]), extensions: json({ world_book_ids: ["book-weir"] }), user_id: USER }],
    chats: [{ id: CHAT, user_id: USER, character_id: "char-ilsa", name: "The weir", metadata: json({ chat_world_book_ids: ["book-weir"] }) }],
    messages: [row("m0", 0), row("m1", 1), row("m2", 2)],
    world_books: [book, { ...book, id: "book-pell", name: "Pell's book", user_id: OTHER }],
    world_book_entries: [entry("e3", 30), entry("e1", 10, { constant: 1, tags: json(["lamp"]), folder: "night" }), entry("e2", 20, { keysecondary: json(["eel"]), content: "An eel under the weir." })],
    personas: [
      { id: "persona-mara", name: "Mara", description: "A ferrywoman.", is_default: 1, metadata: "{}", user_id: USER, updated_at: 5 },
      { id: "persona-other", name: "Otter", description: "A visitor.", metadata: "{}", user_id: USER, updated_at: 9 },
    ],
    presets: [{ id: "preset-weir", name: "Weir", provider: "custom", parameters: json({ temperature: 0.7 }), prompt_order: "[]", prompts: json({ promptBehavior: {} }), metadata: "{}", user_id: USER, cache_revision: 3 }],
    settings: [{ key: "activeLoomPresetId", value: json("preset-weir"), user_id: USER }],
  };

  async function both(): Promise<{ database: DbReader; http: LumiverseReads; get(path: string): Promise<Response> }> {
    const bed = await weir(rows);
    const database = createDbReader({ path: bed.db.path, user: USER, sleep: async () => undefined, log: () => undefined });
    closing.push(() => database.close());
    const mine = bed.as(USER);
    return { database, http: createHttpReads(mine.session), get: (path) => mine.get(path) };
  }

  test("each read gives what the database file gives: the chat and its path, the book and its entries (found one by one: Lumiverse has no route for an entry), a character, personas, a preset, a setting", async () => {
    const { database, http } = await both();
    expect(await http.chat(CHAT)).toEqual(await database.chat(CHAT));
    expect(await http.path(CHAT)).toEqual(await database.path(CHAT));
    expect(await http.messages(CHAT, { from: 1, to: 3 })).toEqual(await database.messages(CHAT, { from: 1, to: 3 }));
    expect(await http.messagesById(CHAT, ["m2", "x"])).toEqual(await database.messagesById(CHAT, ["m2", "x"]));
    expect(await http.book("book-weir")).toEqual(await database.book("book-weir"));
    const entries = await http.entries("book-weir");
    expect(entries.map((e) => e.id)).toEqual(["e1", "e2", "e3"]);
    expect(entries).toEqual(await database.entries("book-weir"));
    expect(await http.entry("e2")).toEqual(await database.entry("e2"));
    expect(await http.entry("e-none")).toBeNull();
    // Lumiverse's own mapper writes its library scope into a character's `extensions` (`db/character-operations.ts:23-25`); its file does not hold it, which RPE does not read.
    const character = await http.character("char-ilsa");
    expect(character).not.toBeNull();
    expect(character!.extensions._lumiverse_library_scope).toBe("mine");
    const { _lumiverse_library_scope: _scope, ...withoutScope } = character!.extensions;
    expect(await database.character("char-ilsa")).toEqual({ ...character!, extensions: withoutScope });
    expect(await http.persona("persona-mara")).toEqual(await database.persona("persona-mara"));
    expect((await http.defaultPersona())?.id).toBe("persona-mara");
    expect(await http.preset("preset-weir")).toEqual(await database.preset("preset-weir"));
    expect(await http.setting("activeLoomPresetId")).toEqual(await database.setting("activeLoomPresetId"));
    // Another user's rows, and rows that are not there, are answered as Lumiverse answers them: not found.
    expect(await http.book("book-pell")).toBeNull();
    expect(await http.character("char-none")).toBeNull();
    expect(await http.persona("persona-none")).toBeNull();
    expect(await http.preset("preset-none")).toBeNull();
    expect(await http.setting("no-such-key")).toBeNull();
  });

  test("the routes answer as Lumiverse's do: a page of the books, a book with its first page of entries, no route for one entry, sorted and filtered entries, and a tag a client may hold", async () => {
    const { get } = await both();
    const books = (await (await get("/api/v1/world-books")).json()) as { data: { id: string }[]; total: number; limit: number; offset: number };
    expect(books).toMatchObject({ total: 1, limit: 50, offset: 0, data: [{ id: "book-weir", name: "The weir's lore", folder: "" }] });
    expect(Object.keys(books.data[0]!)).not.toContain("user_id");
    const one = (await (await get("/api/v1/world-books/book-weir?limit=1&offset=0")).json()) as { id: string; entries: { data: { id: string; outlet_name: string | null; extensions: unknown; key: string[]; constant: boolean }[]; total: number; limit: number } };
    expect(one.id).toBe("book-weir");
    expect(one.entries).toMatchObject({ total: 3, limit: 1, data: [{ id: "e1", outlet_name: "weir", extensions: { kept: true }, key: ["key e1"], constant: true }] });
    expect((await get("/api/v1/world-books/book-weir/entries/e1")).status).toBe(404);
    expect((await get("/api/v1/world-books/book-pell")).status).toBe(404);
    const entries = async (query: string): Promise<string[]> => ((await (await get(`/api/v1/world-books/book-weir/entries${query}`)).json()) as { data: { id: string }[] }).data.map((e) => e.id);
    expect(await entries("")).toEqual(["e1", "e2", "e3"]);
    expect(await entries("?sort_by=order&sort_dir=desc")).toEqual(["e3", "e2", "e1"]);
    expect(await entries("?sort_by=name")).toEqual(["e1", "e2", "e3"]);
    expect(await entries("?type=constant")).toEqual(["e1"]);
    expect(await entries("?folder=night")).toEqual(["e1"]);
    expect(await entries("?folder=")).toEqual(["e2", "e3"]);
    expect(await entries("?tag=lamp")).toEqual(["e1"]);
    expect(await entries("?search=eel")).toEqual(["e2"]);
    const missing = await get("/api/v1/world-books/book-none/entries");
    expect([missing.status, await missing.json()]).toEqual([404, { error: "World book not found" }]);
    // The book's list and its entries are tagged, and a client that holds the tag is told it holds the page.
    const listed = await get("/api/v1/world-books");
    const etag = listed.headers.get("etag")!;
    expect(etag).toMatch(/^"wb-list-1-200-50-0"$/);
    expect(listed.headers.get("cache-control")).toBe("private, no-cache");
  });

  test("a preset is tagged by its cache revision and the user, and a client that holds the tag gets 304; a character, a persona and a setting come as Lumiverse's mappers give them", async () => {
    const bed = await weir(rows);
    const mine = bed.as(USER);
    const preset = await mine.get("/api/v1/presets/preset-weir");
    const etag = preset.headers.get("etag")!;
    expect(etag).toMatch(/^W\/"preset-preset-weir-3-[\w-]+"$/);
    const body = (await preset.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ id: "preset-weir", cache_revision: 3, parameters: { temperature: 0.7 }, prompts: { promptBehavior: {} } });
    expect(Object.keys(body)).not.toContain("user_id");
    const request = await mine.get("/api/v1/presets/preset-weir", { "if-none-match": etag });
    expect(request.status).toBe(304);
    expect(await request.text()).toBe("");
    const character = (await (await mine.get("/api/v1/characters/char-ilsa")).json()) as Record<string, unknown>;
    expect(character).toMatchObject({ id: "char-ilsa", tags: ["keeper"], library_scope: "mine", extensions: { world_book_ids: ["book-weir"], _lumiverse_library_scope: "mine" } });
    expect(Object.keys(character)).not.toContain("deleting");
    expect((await bed.as(OTHER).get("/api/v1/characters/char-ilsa")).status).toBe(404);
    const personas = (await (await mine.get("/api/v1/personas")).json()) as { data: { id: string; is_default: boolean }[]; total: number };
    expect(personas.data.map((p) => [p.id, p.is_default])).toEqual([["persona-other", false], ["persona-mara", true]]);
    expect(personas.total).toBe(2);
    const setting = (await (await mine.get("/api/v1/settings/activeLoomPresetId")).json()) as Record<string, unknown>;
    expect(setting).toMatchObject({ key: "activeLoomPresetId", value: "preset-weir" });
  });
});
