// What the stand-in Lumiverse's World Info chain does with all a handler gives back, and which books a chat reads, held to Lumiverse's own
// source (staging at a70f4ed2; paths are Lumiverse's `src/`): the chain's result applied whole (`spindle/world-info-interceptor.ts`), and
// the books of the speaker, the persona, the chat, the user's global list and a group's members, read from their rows
// (`services/world-info-sources.service.ts`). Every name is invented.

import { afterEach, describe, expect, test } from "bun:test";
import { streamedReply } from "../../../src/adapter/lumiverse/stream";
import { StandInDb } from "../../standin/db";
import type { ActivatedWorldInfoEntry, Entry } from "../../standin/lore";
import { StandIn, type Chat, type ChatMessage, type Outcome } from "../../standin/lumiverse";
import { textOf } from "../../standin/steps";

const USER = "user-sedge";
const CHAT = "chat-sedge";
const MODEL = "http://127.0.0.1:7895";
const CLOCK = { now: (): number => Date.now(), setTimeout: (run: () => void, ms: number): unknown => setTimeout(run, ms), clearTimeout: (handle: unknown): void => clearTimeout(handle as Timer) };

const closing: (() => void)[] = [];
afterEach(() => {
  for (const close of closing.splice(0)) close();
});

/** The chat so far: the greeting, then what the player says last. */
const lines = (said: string): ChatMessage[] => [
  { id: "m0", role: "assistant", content: "GREET The sedge bends in the wind." },
  { id: "m1", role: "user", content: said },
];

/** A stand-in Lumiverse on a model that answers every request with one line; given a database, its rows as Lumiverse writes them. */
function lumiverse(withDb = false): StandIn {
  const lv = new StandIn();
  if (withDb) {
    const db = new StandInDb();
    closing.push(() => db.close());
    db.write({ user: [{ id: USER, name: "Rowan", email: "rowan@example.invalid", username: "rowan" }], characters: [], chats: [], messages: [], world_books: [], world_book_entries: [], personas: [], presets: [], settings: [], message_breakdowns: [] });
    lv.db = db;
  }
  lv.servers.set(MODEL, async (request) => streamedReply(async (out) => out.content("NEW-TEXT the reeds sway."), { id: "reply", model: "model", created: 0 }, request.signal, { clock: CLOCK, turn: false }));
  lv.connections.set("conn-model", { id: "conn-model", base: `${MODEL}/v1`, key: "model-key", model: "model" });
  lv.presets.set("preset-sedge", { id: "preset-sedge", name: "Sedge", blocks: [{ id: "b-main", name: "Main", role: "system", content: "MAIN You narrate a sedge meadow." }, { id: "b-history", name: "Chat History", role: "system", content: "", marker: "chat_history" }] });
  return lv;
}

async function generate(lv: StandIn, extra: { dryRun?: boolean; persona?: string } = {}): Promise<Outcome> {
  const out = await lv.generate({ chat: CHAT, connection: "conn-model", preset: "preset-sedge", ...extra });
  expect(out.error).toBeNull();
  return out;
}

const promptOf = (out: Outcome): string => out.prompt.map((m) => textOf(m)).join("\n");
const told = (lv: StandIn): ActivatedWorldInfoEntry[] => (lv.events.filter((e) => e.event === "WORLD_INFO_ACTIVATED").at(-1)!.payload as { entries: ActivatedWorldInfoEntry[] }).entries;
/** A constant entry of this book that tells its own name. */
const always = (id: string, book: string, extra: Partial<Entry> = {}): Entry => ({ id, book, comment: id, constant: true, content: `${id.toUpperCase()}-LORE a line of ${book}.`, ...extra });

describe("the chain's whole result (`spindle/world-info-interceptor.ts:206-407`; `services/prompt-assembly.service.ts:2282-2597`)", () => {
  /** The sedge meadow's book, on the character: what each part of a result acts on. */
  function meadow(): StandIn {
    const lv = lumiverse();
    lv.library.addBook({
      id: "book-sedge",
      name: "Sedge lore",
      user: USER,
      entries: [
        { id: "e-reed", book: "book-sedge", comment: "Reeds", keys: ["reed"], content: "REED-LORE The reeds grow tall." },
        { id: "e-secret", book: "book-sedge", comment: "The secret", constant: true, content: "SECRET-LORE A body lies under the sedge." },
        { id: "e-moth", book: "book-sedge", comment: "The moth", constant: true, disabled: true, content: "MOTH-LORE A pale moth." },
        { id: "e-quiet", book: "book-sedge", comment: "The quiet", keys: ["quiet"], content: "QUIET-LORE A hush falls." },
        { id: "e-fog", book: "book-sedge", comment: "The fog", keys: ["fog"], content: "FOG-LORE The fog hides the FEN." },
        { id: "e-fen", book: "book-sedge", comment: "The fen", keys: ["fen"], content: "FEN-LORE The fen is deep." },
      ],
    });
    lv.addChat({ id: CHAT, user: USER, character: { id: "char-sedge", name: "Sedge", extensions: { world_book_ids: ["book-sedge"] } }, messages: lines("I look at the reed and the fog.") });
    lv.worldInfoSettings = { globalScanDepth: 3, maxRecursionPasses: 2 };
    return lv;
  }

  /** What a handler wrote of the context and entries it was handed, and an entry it adds, whole. */
  const added = { id: "a-1", content: "ADDED-LORE A heron stands guard.", comment: "The heron", key: ["heron"], keysecondary: [], position: 0, depth: 4, role: null, priority: 10, probability: 100, use_probability: true, selective: false, selective_logic: 0, group_name: "", group_override: false, group_weight: 100, match_whole_words: false, case_sensitive: false, use_regex: false, prevent_recursion: false, exclude_recursion: false, delay_until_recursion: false, exclude_greeting: false, scan_depth: null, order_value: 100, sticky: 0, cooldown: 0, delay: 0, disabled: false, constant: true, automation_id: null, extensions: {} };

  test("disabled, enabled, forced, mutated, an added entry, a capture and an end to recursion are all applied; a later handler is handed the result so far", async () => {
    const lv = meadow();
    const first = lv.install(["generation", "interceptor"]);
    const second = lv.install(["generation"]);
    const asked: Record<string, unknown>[] = [];
    first.registerWorldInfoInterceptor(async (ctx) => {
      asked.push(ctx as Record<string, unknown>);
      return { disabled: ["e-secret"], enabled: ["e-moth"], forced: ["e-quiet"], mutated: [{ id: "e-reed", content: "REED-LORE The reeds are rewritten." }], captured: ["e-secret", "e-fog", "not-an-entry"], additionalEntries: [added], activationOverrides: { disableRecursion: true } };
    }, 10);
    second.registerWorldInfoInterceptor(async (ctx) => {
      asked.push(ctx as Record<string, unknown>);
      return undefined;
    }, 20);
    const contexts: Record<string, unknown>[] = [];
    first.registerInterceptor(async (messages, context) => {
      contexts.push(context as Record<string, unknown>);
      return messages;
    }, {});
    const out = await generate(lv);

    // The first handler is handed the user's own settings and every entry as the full DTO; the second the settings the first changed, and its work.
    expect(asked[0]!.activationSettings).toEqual({ globalScanDepth: 3, maxRecursionPasses: 2 });
    expect(asked[1]!.activationSettings).toEqual({ globalScanDepth: 3, maxRecursionPasses: 0 });
    const reed = (asked[0]!.entries as Record<string, unknown>[]).find((e) => e.id === "e-reed")!;
    expect(Object.keys(reed).sort()).toEqual(["automation_id", "book_source", "case_sensitive", "comment", "constant", "content", "cooldown", "delay", "delay_until_recursion", "depth", "disabled", "exclude_greeting", "exclude_recursion", "extensions", "group_name", "group_override", "group_weight", "id", "key", "keysecondary", "match_whole_words", "order_value", "position", "prevent_recursion", "priority", "probability", "role", "scan_depth", "selective", "selective_logic", "sticky", "use_probability", "use_regex", "world_book_id"].sort());
    expect(reed).toMatchObject({ world_book_id: "book-sedge", comment: "Reeds", key: ["reed"], keysecondary: [], position: 0, depth: 4, role: null, priority: 10, probability: 100, use_probability: true, scan_depth: null, order_value: 100, automation_id: null, book_source: "character", content: "REED-LORE The reeds grow tall." });
    const later = asked[1]!.entries as Record<string, unknown>[];
    expect(later.find((e) => e.id === "e-secret")).toMatchObject({ disabled: true });
    expect(later.find((e) => e.id === "e-moth")).toMatchObject({ disabled: false });
    expect(later.find((e) => e.id === "e-quiet")).toMatchObject({ constant: true });
    expect(later.find((e) => e.id === "e-reed")).toMatchObject({ content: "REED-LORE The reeds are rewritten." });
    const local = JSON.stringify(["spindle", first.id, CHAT, "a-1"]);
    expect(later.find((e) => e.id === local)).toMatchObject({ world_book_id: JSON.stringify(["spindle", first.id, CHAT]), content: added.content, book_source: "chat" });

    // What the chain left is what activated: the secret off, the moth on, the quiet entry forced on with no key said, the added entry, the rewritten text;
    // the fog's own words are scanned no more, so the fen it names stays out.
    expect(out.worldInfo.entries.find((e) => e.id === "e-secret")!.disabled).toBe(true);
    const prompt = promptOf(out);
    for (const shown of ["REED-LORE The reeds are rewritten.", "MOTH-LORE", "QUIET-LORE", "FOG-LORE", "ADDED-LORE"]) expect(prompt).toContain(shown);
    for (const hidden of ["SECRET-LORE", "FEN-LORE", "The reeds grow tall"]) expect(prompt).not.toContain(hidden);
    // The added entry is told as the chat's own, in a book of no name.
    expect(told(lv).find((e) => e.id === local)).toMatchObject({ bookId: JSON.stringify(["spindle", first.id, CHAT]), bookSource: "chat", bookName: undefined });

    // The capture: what the entries it asked for would have done had no handler touched them, told to that extension alone. The secret was on
    // (constant) and the fog was found by its key; a name that is no entry is left out.
    expect(contexts[0]!.capturedWorldInfo).toEqual([
      { id: "e-secret", comment: "The secret", keys: [], source: "keyword", bookId: "book-sedge", bookSource: "character" },
      { id: "e-fog", comment: "The fog", keys: ["fog"], source: "keyword", bookId: "book-sedge", bookSource: "character" },
    ]);
    expect(Object.keys(contexts[0]!)).not.toContain("__spindleWorldInfoCaptures");
  });

  test("without an end to recursion the fog names the fen; a capture asked for and no entry it names are told as none", async () => {
    const lv = meadow();
    const ext = lv.install(["generation", "interceptor"]);
    ext.registerWorldInfoInterceptor(async () => ({ captured: ["nothing-here"] }), 10);
    const contexts: Record<string, unknown>[] = [];
    ext.registerInterceptor(async (messages, context) => {
      contexts.push(context as Record<string, unknown>);
      return messages;
    }, {});
    const out = await generate(lv);
    expect(promptOf(out)).toContain("FEN-LORE");
    expect(contexts[0]!.capturedWorldInfo).toEqual([]);
  });

  test("an added entry that is not whole ends the assembly with the field named; a handler that throws, or says nothing, leaves the entries as they were", async () => {
    for (const [mend, field] of [[{ content: 3 }, "content"], [{ key: ["a", 1] }, "key"], [{ priority: "high" }, "priority"], [{ role: "tool" }, "role"], [{ scan_depth: -1 }, "scan_depth"], [{ constant: "yes" }, "constant"], [{ id: "" }, "id"]] as const) {
      const lv = meadow();
      lv.install(["generation"]).registerWorldInfoInterceptor(async () => ({ additionalEntries: [{ ...added, ...mend }] }), 10);
      const out = await lv.generate({ chat: CHAT, connection: "conn-model", preset: "preset-sedge" });
      expect(out.error).toBe(`Invalid prompt-local world info field: ${field}`);
      expect(out.reply).toBeNull();
    }
    // Added with the id of an entry already there, or twice.
    for (const entries of [[{ ...added, id: "e-reed" }], [added, added]]) {
      const lv = meadow();
      lv.install(["generation"]).registerWorldInfoInterceptor(async () => ({ additionalEntries: entries }), 10);
      const out = await lv.generate({ chat: CHAT, connection: "conn-model", preset: "preset-sedge" });
      expect(out.error).toMatch(/^Invalid prompt-local world info field: (ambiguous|duplicate) id$/);
    }
    // A throw, and nothing at all, are no result.
    const lv = meadow();
    lv.install(["generation"]).registerWorldInfoInterceptor(async () => {
      throw new Error("the worker fell over");
    }, 10);
    lv.install(["generation"]).registerWorldInfoInterceptor(async () => undefined, 20);
    const out = await generate(lv);
    expect(out.worldInfo.entries.map((e) => [e.id, e.disabled === true, e.content]).sort()).toEqual(meadow().library.entriesForBooks(USER, ["book-sedge"], new Map()).get("book-sedge")!.map((e) => [e.id, e.disabled === true, e.content]).sort());
  });

  test("selection text is what the budget, the duplicates and the told tokens read; a placed entry goes into the history; insertion order puts an extension's entries by their order", async () => {
    const lv = lumiverse();
    lv.library.addBook({
      id: "book-sedge",
      name: "Sedge lore",
      user: USER,
      entries: [
        // Two keyed entries the budget weighs, the first long, and three constant ones the budget counts first, placed or not.
        { id: "e-long", book: "book-sedge", comment: "e-long", keys: ["reed"], content: `LONG-LORE ${"a long line of lore ".repeat(20)}` },
        { id: "e-same", book: "book-sedge", comment: "e-same", keys: ["reed"], content: "SAME-LORE a line of the same size." },
        always("e-near", "book-sedge", { order_value: 20, content: "NEAR-LORE nearer to the end." }),
        always("e-far", "book-sedge", { order_value: 10, content: "FAR-LORE farther from the end." }),
        always("e-late", "book-sedge", { order_value: 30, content: "LATE-LORE listed last." }),
      ],
    });
    lv.addChat({ id: CHAT, user: USER, character: { id: "char-sedge", name: "Sedge", extensions: { world_book_ids: ["book-sedge"] } }, messages: lines("I look at the reed.") });
    // The budget: forty tokens. The constants take twenty; the long entry's own text is a hundred, its selection text four.
    lv.worldInfoSettings = { maxTokenBudget: 40 };
    lv.install(["generation"]).registerWorldInfoInterceptor(async () => ({
      mutated: [
        { id: "e-long", selectionContent: "LONG-LORE short." },
        { id: "e-near", placement: { type: "chat_depth", role: "user", depth: 1, direction: "from_end" }, outputOrder: "insertion" },
        { id: "e-far", placement: { type: "chat_depth", role: "assistant", depth: 1, direction: "from_end" }, outputOrder: "insertion" },
        { id: "e-late", placement: { type: "nonsense" } },
      ],
    }), 10);
    const out = await generate(lv);
    // The tokens told are those of the selection text, four characters to a token; the entry's own text is what is sent.
    expect(told(lv).find((e) => e.id === "e-long")!.estimatedTokens).toBe(Math.ceil("LONG-LORE short.".length / 4));
    expect(promptOf(out)).toContain("a long line of lore");
    // The long entry stays for the short text selection reads, as the entry that is the same size as its short text does.
    expect(out.worldInfo.activated.map((a) => a.id)).toEqual(expect.arrayContaining(["e-long", "e-same"]));
    // Placed entries: from the end of the history by one, the lower order value first (insertion order), each its own role; the entry with
    // no placement it can read stays at its own position.
    const at = (word: string): number => out.prompt.findIndex((m) => textOf(m).startsWith(word));
    expect(at("FAR-LORE")).toBeLessThan(at("NEAR-LORE"));
    expect(out.prompt[at("FAR-LORE")]).toMatchObject({ role: "assistant" });
    expect(out.prompt[at("NEAR-LORE")]).toMatchObject({ role: "user" });
    expect(at("NEAR-LORE")).toBe(out.prompt.length - 2);
    expect(at("LATE-LORE")).toBeLessThan(at("GREET"));
    const stored = out.stored!.entries.map((e) => e.name);
    expect(stored).toContain("WI Chat Depth from_end 1: e-far");
    expect(stored).toContain("WI Chat Depth from_end 1: e-near");
  });
});

describe("the books a chat reads (`services/world-info-sources.service.ts:99-164`; `services/prompt-assembly.service.ts:1923-1937`, `:2243-2271`)", () => {
  /** The books of each place, all of them this user's, and one of another user's that the chat names too. */
  function shelves(chat: Partial<Chat> & { character?: Chat["character"] } = {}, withDb = false): StandIn {
    const lv = lumiverse(withDb);
    if (withDb) lv.db!.run('INSERT INTO "user" (id, name, email, username) VALUES (?, ?, ?, ?)', "user-other", "Other", "other@example.invalid", "other");
    for (const [id, name] of [["b-card", "Card book"], ["b-legacy", "Legacy book"], ["b-persona", "Persona book"], ["b-chat", "Chat book"], ["b-global", "Global book"], ["b-shared", "Shared book"]] as const) lv.library.addBook({ id, name, user: USER, entries: [always(`e-${id.slice(2)}`, id)] });
    lv.library.addBook({ id: "b-foreign", name: "Another user's book", user: "user-other", entries: [always("e-foreign", "b-foreign")] });
    lv.library.addPersona({ id: "persona-rowan", user: USER, name: "Rowan", attached_world_book_id: "b-persona", is_default: true });
    lv.library.setSetting(USER, "globalWorldBooks", ["b-global", "b-shared", "b-foreign"]);
    lv.addChat({ id: CHAT, user: USER, character: { id: "char-sedge", name: "Sedge", extensions: { world_book_ids: ["b-card", "b-shared"] } }, messages: lines("I look about."), metadata: { chat_world_book_ids: ["b-chat", "b-shared", "b-foreign"] }, ...chat });
    return lv;
  }
  const sources = (lv: StandIn): [string, string | undefined, string | undefined][] => told(lv).map((e) => [e.id, e.bookSource, e.bookName]);

  test("the speaker's books, the persona's, the chat's and the user's global list, each book once under the nearest place that names it, and only the user's own", async () => {
    const lv = shelves();
    await generate(lv);
    expect(sources(lv)).toEqual([
      ["e-card", "character", "Card book"],
      ["e-shared", "character", "Shared book"],
      ["e-persona", "persona", "Persona book"],
      ["e-chat", "chat", "Chat book"],
      ["e-global", "global", "Global book"],
    ]);
  });

  test("a character with one `world_book_id` has that book; a persona named for the generation is the one read; a temporary chat has no persona", async () => {
    const legacy = shelves({ character: { id: "char-old", name: "Old", extensions: { world_book_id: "b-legacy" } } });
    await generate(legacy);
    expect(sources(legacy).map(([id]) => id)).toEqual(["e-legacy", "e-persona", "e-chat", "e-shared", "e-global"]);

    const named = shelves();
    named.library.addBook({ id: "b-guest", name: "Guest book", user: USER, entries: [always("e-guest", "b-guest")] });
    named.library.addPersona({ id: "persona-guest", user: USER, name: "Guest", attached_world_book_id: "b-guest" });
    await generate(named, { persona: "persona-guest" });
    expect(sources(named).map(([id]) => id)).toContain("e-guest");
    expect(sources(named).map(([id]) => id)).not.toContain("e-persona");

    const temporary = shelves({ metadata: { temporary: true, chat_world_book_ids: ["b-chat"] } });
    await generate(temporary);
    expect(sources(temporary).map(([id]) => id)).toEqual(["e-card", "e-shared", "e-chat", "e-global"]);
  });

  test("a group's members' books follow its lorebook mode, else its card mode, the muted ones left out of the modes that leave them out, in the order of its members", async () => {
    const group = (metadata: Record<string, unknown>): StandIn => {
      const lv = shelves({ metadata: { group: true, character_ids: ["char-sedge", "char-fen", "char-moor"], muted_character_ids: ["char-fen"], ...metadata } });
      for (const [id, name, book] of [["char-fen", "Fen", "b-legacy"], ["char-moor", "Moor", "b-guest"]] as const) {
        lv.library.addBook({ id: book === "b-legacy" ? "b-legacy-x" : book, name: `${name}'s book`, user: USER, entries: [always(`e-${name.toLowerCase()}`, book === "b-legacy" ? "b-legacy-x" : book)] });
        lv.library.addCharacter(USER, { id, name, extensions: { world_book_ids: [book === "b-legacy" ? "b-legacy-x" : book] } });
      }
      return lv;
    };
    const read = async (metadata: Record<string, unknown>): Promise<string[]> => {
      const lv = group(metadata);
      await generate(lv);
      return sources(lv).filter(([, source]) => source === "character").map(([id]) => id);
    };
    // The speaker's own books alone: the default (a card mode of "swap"), and the lorebook mode that says so.
    expect(await read({})).toEqual(["e-card", "e-shared"]);
    expect(await read({ group_lorebook_mode: "active_character", group_card_mode: "merge" })).toEqual(["e-card", "e-shared"]);
    // Every member that is not muted, in the group's order; every member.
    expect(await read({ group_lorebook_mode: "all_unmuted" })).toEqual(["e-card", "e-shared", "e-moor"]);
    expect(await read({ group_lorebook_mode: "all" })).toEqual(["e-card", "e-shared", "e-fen", "e-moor"]);
    // Following the card mode.
    expect(await read({ group_card_mode: "merge_ignore_muted" })).toEqual(["e-card", "e-shared", "e-moor"]);
    expect(await read({ group_lorebook_mode: "follow_card_mode", group_card_mode: "merge" })).toEqual(["e-card", "e-shared", "e-fen", "e-moor"]);
    // A group chat that lists no member, or none Lumiverse finds, reads the speaker's.
    expect(await read({ group_lorebook_mode: "all", character_ids: [] })).toEqual(["e-card", "e-shared"]);
    expect(await read({ group_lorebook_mode: "all", character_ids: ["char-gone"] })).toEqual(["e-card", "e-shared"]);
  });

  test("the books are rows of the stand-in's database as Lumiverse writes them, and a row changed under the stand-in is read at the next generation", async () => {
    const lv = shelves({}, true);
    const db = lv.db!;
    const entry = db.rows("SELECT * FROM world_book_entries WHERE id = ?", "e-card")[0]!;
    // A uid of its own and never its id, the columns' defaults, the book's owner and its name.
    expect(entry).toMatchObject({ world_book_id: "b-card", key: "[]", keysecondary: "[]", position: 0, depth: 4, role: null, order_value: 100, priority: 10, probability: 100, use_probability: 1, constant: 1, disabled: 0, scan_depth: null, revision: 1, vector_index_status: "not_enabled" });
    expect(entry.uid).not.toBe("e-card");
    expect(String(entry.uid)).toMatch(/^[0-9a-f-]{36}$/);
    expect(db.rows("SELECT name, user_id FROM world_books WHERE id = ?", "b-card")).toEqual([{ name: "Card book", user_id: USER }]);
    expect(db.rows("SELECT attached_world_book_id FROM personas WHERE id = ?", "persona-rowan")).toEqual([{ attached_world_book_id: "b-persona" }]);
    expect(JSON.parse(String(db.rows("SELECT extensions FROM characters WHERE id = ?", "char-sedge")[0]!.extensions))).toEqual({ world_book_ids: ["b-card", "b-shared"] });
    expect(JSON.parse(String(db.rows("SELECT value FROM settings WHERE key = ? AND user_id = ?", "globalWorldBooks", USER)[0]!.value))).toEqual(["b-global", "b-shared", "b-foreign"]);

    const first = await generate(lv);
    expect(promptOf(first)).toContain("E-CARD-LORE a line of b-card.");
    // The row's text changed, a book taken off the character, and the chat's list changed: the next generation reads them as they stand.
    db.run("UPDATE world_book_entries SET content = ? WHERE id = ?", "E-CARD-LORE rewritten in the row.", "e-card");
    db.run("UPDATE characters SET extensions = ? WHERE id = ?", JSON.stringify({ world_book_ids: ["b-card"] }), "char-sedge");
    db.run("UPDATE chats SET metadata = ? WHERE id = ?", JSON.stringify({ chat_world_book_ids: [] }), CHAT);
    const second = await generate(lv);
    expect(promptOf(second)).toContain("E-CARD-LORE rewritten in the row.");
    expect(sources(lv).map(([id]) => id)).toEqual(["e-card", "e-persona", "e-global", "e-shared"]);
  });

  test("an outlet, a pin and the managed keys of an entry are kept in its `extensions` as Lumiverse keeps them, and read out again", () => {
    const lv = lumiverse(true);
    lv.library.addBook({ id: "b-managed", name: "Managed", user: USER, entries: [{ id: "e-managed", book: "b-managed", content: "text", outlet_name: "  Weather ", wi_marker: "Main_Prompt", wi_marker_side: "before", position: 7, extensions: { note: 1 } }] });
    expect(JSON.parse(String(lv.db!.rows("SELECT extensions FROM world_book_entries WHERE id = ?", "e-managed")[0]!.extensions))).toEqual({ note: 1, outlet_name: "Weather", wi_marker: "main_prompt", wi_marker_side: "before" });
    const [read] = lv.library.entriesForBooks(USER, ["b-managed"], new Map()).get("b-managed")!;
    expect(read).toMatchObject({ extensions: { note: 1 }, outlet_name: "Weather", wi_marker: "main_prompt", wi_marker_side: "before", position: 7 });
  });
});
