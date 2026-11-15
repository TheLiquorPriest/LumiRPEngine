// Lore activated as the stand-in Lumiverse activates it, held to Lumiverse's own source (staging at a70f4ed2;
// paths are Lumiverse's `src/`): hidden messages scanned, constant, keyword, vector and sticky entries with
// their counts in the chat's row, cooldown, delay, probability, recursion, groups, the budget and what the scan
// refuses; what Lumiverse tells of it in `WORLD_INFO_ACTIVATED` and in the interceptors' context; and other
// extensions' context handlers. The vector search is each test's own, and says which entries it finds and how.
// Every name is invented.

import { afterEach, describe, expect, test } from "bun:test";
import { streamedReply } from "../../../src/adapter/lumiverse/stream";
import type { PromptMessageDTO } from "../../../src/ext/spindle";
import { StandInDb } from "../../standin/db";
import type { ActivatedWorldInfoEntry, Entry, VectorSearch } from "../../standin/lore";
import { StandIn, type ChatMessage, type Outcome } from "../../standin/lumiverse";
import { textOf } from "../../standin/steps";

const USER = "user-fen";
const CHAT = "chat-fen";
const MODEL = "http://127.0.0.1:7890";
const CLOCK = { now: (): number => Date.now(), setTimeout: (run: () => void, ms: number): unknown => setTimeout(run, ms), clearTimeout: (handle: unknown): void => clearTimeout(handle as Timer) };

const closing: (() => void)[] = [];
afterEach(() => {
  for (const close of closing.splice(0)) close();
});

/** The fen's chat: Wynn's greeting, then the lines given. */
function fenLines(...lines: Omit<ChatMessage, "id">[]): ChatMessage[] {
  return [{ id: "m0", role: "assistant", content: "GREET The fen is quiet under the fog." }, ...lines.map((m, k) => ({ ...m, id: `m${k + 1}` }))];
}

/** The books the tests' entries name, by id, with the names Lumiverse's rows give them. */
const BOOK_NAMES: Record<string, string> = { "book-fen": "Fen lore", "book-common": "Common lore", "book-peer": "Visitor's notes" };

/**
 * A stand-in Lumiverse with the fen's chat and its books on a model that answers every request with one line, and the database its rows are
 * written to. Each book the entries name is a book of its own: the fen's is the character's, the common one is the user's global one, and
 * the visitor's is relayed from a multiplayer peer.
 */
function fen(messages: ChatMessage[], books: Entry[]): { lv: StandIn; calls: () => number } {
  const lv = new StandIn();
  const db = new StandInDb();
  closing.push(() => db.close());
  db.write({ user: [{ id: USER, name: "Rowan", email: "rowan@example.invalid", username: "rowan" }], characters: [], chats: [], messages: [], world_books: [], world_book_entries: [], personas: [], presets: [], settings: [], message_breakdowns: [] });
  lv.db = db;
  let calls = 0;
  lv.servers.set(MODEL, async (request) => {
    calls++;
    return streamedReply(async (out) => out.content("NEW-TEXT Wynn nods."), { id: "reply", model: "model", created: 0 }, request.signal, { clock: CLOCK, keepAlive: null });
  });
  lv.connections.set("conn-model", { id: "conn-model", base: `${MODEL}/v1`, key: "model-key", model: "model" });
  lv.presets.set("preset-fen", { id: "preset-fen", name: "Fen", blocks: [{ id: "b-main", name: "Main", role: "system", content: "MAIN You narrate a fen at dusk." }] });
  for (const id of new Set(books.map((e) => e.book))) lv.library.addBook({ id, name: BOOK_NAMES[id] ?? id, user: USER, entries: books.filter((e) => e.book === id) });
  if (books.some((e) => e.book === "book-common")) lv.library.setSetting(USER, "globalWorldBooks", ["book-common"]);
  if (books.some((e) => e.book === "book-peer")) lv.peerBooks.add("book-peer");
  lv.addChat({ id: CHAT, user: USER, character: { id: "char-wynn", name: "Wynn", extensions: { world_book_ids: ["book-fen"] } }, messages });
  return { lv, calls: () => calls };
}

/** The player says this (if anything) and Lumiverse makes a new reply. */
async function play(lv: StandIn, said?: string, dryRun = false): Promise<Outcome> {
  if (said !== undefined) lv.send(CHAT, said);
  const out = await lv.generate({ chat: CHAT, connection: "conn-model", preset: "preset-fen", ...(dryRun ? { dryRun } : {}) });
  expect(out.error).toBeNull();
  return out;
}

/** The last `WORLD_INFO_ACTIVATED` Lumiverse sent. */
function told(lv: StandIn): { chatId: string; entries: ActivatedWorldInfoEntry[]; stats: Record<string, unknown> } {
  return lv.events.filter((e) => e.event === "WORLD_INFO_ACTIVATED").at(-1)!.payload as { chatId: string; entries: ActivatedWorldInfoEntry[]; stats: Record<string, unknown> };
}

/** The chat's `wi_state`, read from its row. */
function wiStateOf(lv: StandIn): Record<string, unknown> | undefined {
  const row = lv.db!.rows("SELECT metadata FROM chats WHERE id = ?", CHAT)[0]!;
  return (JSON.parse(String(row.metadata)) as { wi_state?: Record<string, unknown> }).wi_state;
}

const uidOf = (lv: StandIn, id: string): string => String(lv.db!.rows("SELECT uid FROM world_book_entries WHERE id = ?", id)[0]!.uid);
const ids = (out: Outcome): string[] => out.worldInfo.activated.map((a) => a.id).sort();

describe("which messages the scan reads (`services/world-info-activation.service.ts:733-762`; `services/prompt-assembly.service.ts:2289-2306`, `:5096-5110`)", () => {
  test("a key in a hidden message activates its entry", async () => {
    // m1 is hidden and names the eel traps; m4, the newest, is hidden too and names the lanterns.
    const lines = fenLines({ role: "user", content: "I ask about the eel traps.", hidden: true }, { role: "assistant", content: "REPLY Wynn shrugs." }, { role: "user", content: "I look at the reeds." }, { role: "user", content: "(a note: lanterns)", hidden: true });
    const book: Entry[] = [
      { id: "e-eel", book: "book-fen", comment: "Eel traps", keys: ["eel"], content: "EEL-LORE The traps are set at the sluice." },
      // Each scanned in the newest message alone: the hidden m4 is that message, so the reeds in m3 are out of its reach.
      { id: "e-lanterns", book: "book-fen", keys: ["lanterns"], scan_depth: 1, content: "LANTERN-LORE Lanterns mark the safe path." },
      { id: "e-reeds", book: "book-fen", keys: ["reeds"], scan_depth: 1, content: "REED-LORE The reeds hide the channel." },
      { id: "e-mere", book: "book-fen", vectorized: true, vector_index_status: "indexed", content: "MERE-LORE The mere is deep." },
    ];
    const { lv } = fen(lines, book);
    const contexts: { messages: { id: string }[] }[] = [];
    lv.install(["generation"]).registerWorldInfoInterceptor(async (ctx) => {
      contexts.push(ctx as { messages: { id: string }[] });
      return { disabled: [], enabled: [], mutated: [] };
    });
    const queries: string[] = [];
    // The search finds nothing; it is here to be asked, so the query it is asked with can be read.
    lv.vectorSearch = (query) => {
      queries.push(query);
      return [];
    };
    const out = await play(lv);
    expect(ids(out)).toEqual(["e-eel", "e-lanterns"]);
    // The World Info interceptors are given the hidden messages too, with no mark of it.
    expect(contexts[0]!.messages.map((m) => m.id)).toEqual(["m0", "m1", "m2", "m3", "m4"]);
    expect(JSON.stringify(contexts[0]!.messages)).not.toContain("hidden");
    // Only the vector query leaves them out.
    expect(queries).toEqual(["[CHARACTER | Wynn]: GREET The fen is quiet under the fog.\n[CHARACTER | Wynn]: REPLY Wynn shrugs.\n[USER | User]: I look at the reeds."]);
  });
});

describe("activation in Lumiverse's order (`services/world-info-activation.service.ts:370-512`)", () => {
  test("constant, keyword, vector, sticky, budget and groups", async () => {
    const book: Entry[] = [
      { id: "e-gate", book: "book-fen", comment: "The gate", constant: true, content: "GATE-LORE The sluice gate is shut." },
      { id: "e-punt", book: "book-fen", comment: "The punt", keys: ["punt"], scan_depth: 1, sticky: 2, cooldown: 1, content: "PUNT-LORE Wynn's punt leaks." },
      { id: "e-heron", book: "book-fen", comment: "The heron", vectorized: true, vector_index_status: "indexed", content: "HERON-LORE A grey heron hunts." },
      // Two groups: the override wins one, the weights draw the other.
      { id: "e-hare", book: "book-fen", keys: ["tracks"], group_name: "beasts", group_override: true, content: "HARE-LORE A hare's tracks." },
      { id: "e-fox", book: "book-fen", keys: ["tracks"], group_name: "beasts", content: "FOX-LORE A fox's tracks." },
      { id: "e-owl", book: "book-fen", keys: ["dusk"], group_name: "night", group_weight: 30, content: "OWL-LORE An owl calls at dusk." },
      { id: "e-bat", book: "book-fen", keys: ["dusk"], group_name: "night", group_weight: 70, content: "BAT-LORE Bats leave the mill." },
      { id: "e-tale", book: "book-fen", keys: ["tracks"], priority: 5, content: "TALE-LORE An old tale says the tracks lead nowhere at all." },
    ];
    const { lv } = fen(fenLines(), book);
    lv.worldInfoSettings = { maxTokenBudget: 50 };
    // A draw of 0.5 of the night group's weight of 100 passes the owl's 30 and falls in the bat's 70.
    lv.random = () => 0.5;
    // The search finds the heron, and only once the query names a heron.
    lv.vectorSearch = (query, candidates) => (query.includes("heron") ? candidates.filter((c) => c.id === "e-heron").map((c) => ({ id: c.id, distance: 0.2, finalScore: 1.4 })) : []);
    const turn = async (said: string): Promise<{ told: [string, string, number | undefined][]; how: [string, string][]; punt: unknown }> => {
      const out = await play(lv, said);
      const state = wiStateOf(lv)!;
      return { told: told(lv).entries.map((e) => [e.id, e.source, e.score]), how: out.worldInfo.activated.map((a) => [a.id, a.origin]), punt: state[uidOf(lv, "e-punt")] };
    };

    // The punt matched: on, and sticky for two more generations. Every count is keyed by the entry's uid, never its id.
    const first = await turn("I pole the punt toward the tracks at dusk.");
    expect(first.told).toEqual([["e-gate", "keyword", undefined], ["e-punt", "keyword", undefined], ["e-hare", "keyword", undefined], ["e-bat", "keyword", undefined], ["e-tale", "keyword", undefined]]);
    expect(first.how).toEqual([["e-gate", "constant"], ["e-punt", "keyword"], ["e-hare", "keyword"], ["e-bat", "keyword"], ["e-tale", "keyword"]]);
    expect(first.punt).toEqual({ stickyLeft: 2, cooldownLeft: 0, delayCount: 0, active: true });
    expect(Object.keys(wiStateOf(lv)!)).not.toContain("e-punt");

    // The punt is still on as sticky, told as a keyword match; the heron comes by vector, its score raising its priority past the
    // tale's, which the budget of 50 tokens now leaves out.
    const second = await turn("I look for a heron.");
    expect(second.told).toEqual([["e-gate", "keyword", undefined], ["e-heron", "vector", 1.4], ["e-punt", "keyword", undefined], ["e-hare", "keyword", undefined], ["e-bat", "keyword", undefined]]);
    expect(second.how).toContainEqual(["e-punt", "sticky"]);
    expect(second.punt).toEqual({ stickyLeft: 1, cooldownLeft: 0, delayCount: 0, active: true });
    expect(told(lv).stats).toMatchObject({ activatedBeforeBudget: 6, activatedAfterBudget: 5, evictedByBudget: 1, keywordActivated: 4, vectorActivated: 1, totalActivated: 5 });

    // Its last sticky generation, and the cooldown starts.
    const third = await turn("I wait in the shallows.");
    expect(third.how).toContainEqual(["e-punt", "sticky"]);
    expect(third.punt).toEqual({ stickyLeft: 0, cooldownLeft: 1, delayCount: 0, active: true });

    // Named again while it cools down: off.
    const fourth = await turn("I pole the punt again.");
    expect(fourth.told.map(([id]) => id)).not.toContain("e-punt");
    expect(fourth.punt).toEqual({ stickyLeft: 0, cooldownLeft: 0, delayCount: 0, active: false });

    // Named once the cooldown is over: on again, sticky again.
    const fifth = await turn("The punt drifts.");
    expect(fifth.how).toContainEqual(["e-punt", "keyword"]);
    expect(fifth.punt).toEqual({ stickyLeft: 2, cooldownLeft: 0, delayCount: 0, active: true });
  });

  test("probability, delay and recursion, and a dry run that saves no counts", async () => {
    const coin: Entry[] = [
      { id: "e-coin", book: "book-fen", keys: ["coin"], probability: 50, content: "COIN-LORE A coin buys passage." },
      { id: "e-sure", book: "book-fen", keys: ["coin"], probability: 50, use_probability: false, content: "SURE-LORE The ferryman counts every coin." },
    ];
    // A draw at or above the entry's percentage keeps it off (`:840-842`).
    for (const [draw, on] of [[0.6, ["e-sure"]], [0.4, ["e-coin", "e-sure"]]] as const) {
      const { lv } = fen(fenLines(), coin);
      lv.random = () => draw;
      expect(ids(await play(lv, "I hold out a coin."))).toEqual([...on]);
    }

    // A delay of 2: on only at the second generation in a row that names it, and counting again from there (`:834-838`, `:845`).
    const { lv: ghostly } = fen(fenLines(), [{ id: "e-ghost", book: "book-fen", keys: ["ghost"], delay: 2, scan_depth: 1, content: "GHOST-LORE A ghost walks the dyke." }]);
    const ghost: [string[], unknown][] = [];
    for (const said of ["A ghost?", "The ghost again.", "Ghost, a third time."]) {
      const out = await play(ghostly, said);
      ghost.push([ids(out), wiStateOf(ghostly)![uidOf(ghostly, "e-ghost")]]);
    }
    expect(ghost).toEqual([
      [[], { stickyLeft: 0, cooldownLeft: 0, delayCount: 1, active: false }],
      [["e-ghost"], { stickyLeft: 0, cooldownLeft: 0, delayCount: 0, active: true }],
      [[], { stickyLeft: 0, cooldownLeft: 0, delayCount: 1, active: true }],
    ]);
    // A dry run works the counts out and saves none (`services/generate.service.ts:2827-2866` runs only for a generation).
    const before = wiStateOf(ghostly);
    await play(ghostly, "The ghost, once more.", true);
    expect(wiStateOf(ghostly)).toEqual(before);

    // Recursion: each pass scans the text of what the pass before activated, up to the user's number of passes (default 3).
    const chain: Entry[] = [
      { id: "e-old", book: "book-fen", constant: true, content: "OLD-LORE The bridge is old." },
      { id: "e-bridge", book: "book-fen", keys: ["bridge"], content: "BRIDGE-LORE The bridge leads to the mill." },
      { id: "e-mill", book: "book-fen", keys: ["mill"], content: "MILL-LORE The mill grinds at night." },
      { id: "e-grind", book: "book-fen", keys: ["grinds"], content: "GRIND-LORE Its stones were cut in the hills." },
      // Not to be activated by recursion: its key is only ever in lore.
      { id: "e-wheel", book: "book-fen", keys: ["mill"], exclude_recursion: true, content: "WHEEL-LORE The wheel is new." },
    ];
    const { lv: deep } = fen(fenLines(), chain);
    const out = await play(deep, "I cross the fen.");
    expect(out.worldInfo.activated.map((a) => [a.id, a.origin === "keyword" ? a.pass : a.origin])).toEqual([["e-old", "constant"], ["e-bridge", 1], ["e-mill", 2], ["e-grind", 3]]);
    expect(told(deep).stats).toMatchObject({ recursionPassesUsed: 3 });
    const { lv: shallow } = fen(fenLines(), chain);
    shallow.worldInfoSettings = { maxRecursionPasses: 1 };
    expect(ids(await play(shallow, "I cross the fen."))).toEqual(["e-bridge", "e-old"]);
  });

  test("what the scan refuses: secondary keys, whole words, letter case, scan-exclusion markup, a bad pattern, the minimum priority, the cap on entries, and a second entry of one text", async () => {
    const said = "The steel mill wheel turns; <wi-exclude>an otter</wi-exclude> swims. Lanterns glow.";
    // No entry's own text holds a key: recursion scans the text of what activated, secondary keys too (`:801-813`).
    const book: Entry[] = [
      { id: "s-and", book: "book-fen", keys: ["wheel"], selective: true, keysecondary: ["mill", "barge"], selective_logic: 0, content: "AND-LORE both keys at once." },
      { id: "s-not", book: "book-fen", keys: ["wheel"], selective: true, keysecondary: ["mill"], selective_logic: 1, content: "NOT-LORE never with the other." },
      { id: "s-any", book: "book-fen", keys: ["wheel"], selective: true, keysecondary: ["barge", "mill"], selective_logic: 2, content: "ANY-LORE either key will do." },
      { id: "s-whole", book: "book-fen", keys: ["eel"], match_whole_words: true, content: "WHOLE-LORE only the word itself." },
      { id: "s-part", book: "book-fen", keys: ["eel"], content: "PART-LORE inside a word too." },
      { id: "s-case", book: "book-fen", keys: ["Mill"], case_sensitive: true, content: "CASE-LORE only with its capital." },
      { id: "s-otter", book: "book-fen", keys: ["otter"], content: "HIDDEN-LORE kept from the scan." },
      { id: "s-regex", book: "book-fen", keys: ["lan+terns"], use_regex: true, content: "REGEX-LORE found by a pattern." },
      { id: "s-badregex", book: "book-fen", keys: ["(unclosed"], use_regex: true, content: "BAD-LORE a pattern that does not compile." },
      { id: "s-low", book: "book-fen", keys: ["wheel"], priority: 5, content: "LOW-LORE below the minimum priority." },
      { id: "s-lowconst", book: "book-fen", constant: true, priority: 5, content: "LOWCONST-LORE constant, so kept." },
      { id: "s-off", book: "book-fen", keys: ["wheel"], disabled: true, content: "OFF-LORE switched off." },
      // One text in two books: the character's book is nearer than the global one (`services/world-info-dedup.service.ts:35-44`).
      { id: "s-dupe-global", book: "book-common", keys: ["wheel"], content: "DUPE-LORE It was rebuilt in spring." },
      { id: "s-dupe-char", book: "book-fen", keys: ["wheel"], content: "DUPE-LORE It was rebuilt in spring." },
    ];
    const { lv } = fen(fenLines(), book);
    lv.worldInfoSettings = { minPriority: 10 };
    expect(ids(await play(lv, said))).toEqual(["s-any", "s-dupe-char", "s-lowconst", "s-part", "s-regex"]);
    expect(told(lv).stats).toMatchObject({ evictedByMinPriority: 1, deduplicated: 1 });

    // At most two entries: every constant one, then the rest by priority (`:584-598`).
    const { lv: capped } = fen(fenLines(), [
      { id: "c-const", book: "book-fen", constant: true, priority: 1, content: "CONST-LORE always on." },
      { id: "c-high", book: "book-fen", keys: ["wheel"], priority: 20, content: "HIGH-LORE the higher priority." },
      { id: "c-mid", book: "book-fen", keys: ["wheel"], priority: 15, content: "MID-LORE the lower priority." },
    ]);
    capped.worldInfoSettings = { maxActivatedEntries: 2 };
    expect(ids(await play(capped, said))).toEqual(["c-const", "c-high"]);
  });
});

describe("the vector hits (`services/prompt-assembly.service.ts:5588-5935`, `:4846-5013`; `services/world-info-vector-ranking.ts:1840-1893`)", () => {
  test("only indexed entries are searched, no more than the top K hits activate, the threshold holds, a keyword match stays one unless the mode is Vector First, and the minimum priority holds for a hit", async () => {
    const book: Entry[] = [
      { id: "v-1", book: "book-fen", vectorized: true, vector_index_status: "indexed", content: "VECTOR-ONE The north pool freezes first." },
      { id: "v-2", book: "book-fen", vectorized: true, vector_index_status: "indexed", content: "VECTOR-TWO Willows lean over the east bank." },
      { id: "v-3", book: "book-fen", vectorized: true, vector_index_status: "indexed", content: "VECTOR-THREE A drowned cart lies by the ford." },
      { id: "v-4", book: "book-fen", vectorized: true, vector_index_status: "indexed", content: "VECTOR-FOUR Frogs sing loudest after rain." },
      { id: "v-5", book: "book-fen", vectorized: true, vector_index_status: "indexed", content: "VECTOR-FIVE The old causeway floods each spring." },
      { id: "v-pending", book: "book-fen", vectorized: true, vector_index_status: "pending", content: "PENDING-LORE not indexed yet." },
      { id: "v-keyword", book: "book-fen", keys: ["kingfisher"], vectorized: true, vector_index_status: "indexed", content: "KINGFISHER-LORE A kingfisher dives." },
    ];
    // The search finds every entry it is offered, each at its own distance and score: v-5 scores best, the kingfisher's entry is the
    // nearest and scores worst.
    const scored: Record<string, [distance: number, finalScore: number]> = { "v-1": [0.1, 1], "v-2": [0.2, 2], "v-3": [0.3, 3], "v-4": [0.4, 4], "v-5": [0.5, 5], "v-keyword": [0.05, 0.9] };
    const offered: string[][] = [];
    const search: VectorSearch = (_query, candidates) => {
      offered.push(candidates.map((c) => c.id));
      return candidates.map((c) => ({ id: c.id, distance: scored[c.id]![0], finalScore: scored[c.id]![1] }));
    };
    const { lv } = fen(fenLines(), book);
    lv.vectorSearch = search;
    await play(lv, "A kingfisher flashes over the water.");
    expect(offered[0]).toEqual(["v-1", "v-2", "v-3", "v-4", "v-5", "v-keyword"]);
    // The top 4 by score; the kingfisher's entry was already on by its key, and stays a keyword match.
    expect(told(lv).entries.map((e) => [e.id, e.source, e.score])).toEqual([["v-keyword", "keyword", undefined], ["v-5", "vector", 5], ["v-4", "vector", 4], ["v-3", "vector", 3], ["v-2", "vector", 2]]);

    // Vector First ranks by distance, so the kingfisher's entry is among the top 4, and the hit takes it from its key.
    const { lv: first } = fen(fenLines(), book);
    first.vectorSearch = search;
    first.embeddingSettings = { ...first.embeddingSettings, hybridWeightMode: "vector_first" };
    await play(first, "A kingfisher flashes over the water.");
    expect(told(first).entries.find((e) => e.id === "v-keyword")).toMatchObject({ source: "vector", score: 0.9 });

    // A threshold of 0.35 keeps the hits no farther than it, ranked by score; with no kingfisher named, its entry comes by vector alone.
    const { lv: near } = fen(fenLines(), book);
    near.vectorSearch = search;
    near.embeddingSettings = { ...near.embeddingSettings, similarityThreshold: 0.35 };
    await play(near, "The water is still.");
    expect(told(near).entries.map((e) => e.id)).toEqual(["v-3", "v-2", "v-1", "v-keyword"]);

    // A minimum priority of 20 leaves out every hit below it, as it does a key's match: nothing activates, and no event is sent.
    const { lv: strict } = fen(fenLines(), book);
    strict.vectorSearch = search;
    strict.worldInfoSettings = { minPriority: 20 };
    await play(strict, "The water is still.");
    expect(strict.events.some((e) => e.event === "WORLD_INFO_ACTIVATED")).toBe(false);
  });
});

describe("what Lumiverse tells of it (`services/generate.service.ts:1217-1231`, `:2868-2879`; `spindle/world-info-capture.ts:17-73`)", () => {
  const book: Entry[] = [
    { id: "e-gate", book: "book-fen", comment: "The gate", constant: true, content: "GATE-LORE The sluice gate is shut." },
    { id: "e-visitor", book: "book-peer", comment: "A visitor's punt", keys: ["punt"], content: "VISITOR-LORE A visitor moors a punt." },
    { id: "e-heron", book: "book-fen", comment: "The heron", vectorized: true, vector_index_status: "indexed", content: "HERON-LORE A grey heron hunts." },
  ];

  test("the event and the context carry what Lumiverse puts in them", async () => {
    const { lv } = fen(fenLines(), book);
    lv.vectorSearch = (_query, candidates) => candidates.map((c) => ({ id: c.id, distance: 0.2, finalScore: 1.4 }));
    const seen: { context: Record<string, unknown>; told: number }[] = [];
    lv.install(["interceptor"]).registerInterceptor(async (messages, context) => {
      seen.push({ context: context as Record<string, unknown>, told: lv.events.filter((e) => e.event === "WORLD_INFO_ACTIVATED").length });
      return messages;
    }, {});
    await play(lv, "I pole the punt past a heron.");

    // The event, after the interceptors: every entry with its book's name and where it is attached, a peer's as "peer" and, as Lumiverse names none of a peer's books, with no name, and its tokens.
    expect(seen[0]!.told).toBe(0);
    const event = told(lv);
    expect(event.chatId).toBe(CHAT);
    expect(event.entries).toEqual([
      { id: "e-gate", comment: "The gate", keys: [], source: "keyword", score: undefined, bookId: "book-fen", bookSource: "character", bookName: "Fen lore", estimatedTokens: 9 },
      { id: "e-visitor", comment: "A visitor's punt", keys: ["punt"], source: "keyword", score: undefined, bookId: "book-peer", bookSource: "peer", bookName: undefined, estimatedTokens: 9 },
      { id: "e-heron", comment: "The heron", keys: [], source: "vector", score: 1.4, bookId: "book-fen", bookSource: "character", bookName: "Fen lore", estimatedTokens: 8 },
    ]);
    expect(event.stats).toMatchObject({ totalCandidates: 3, keywordActivated: 2, vectorActivated: 1, totalActivated: 3, deduplicated: 0, estimatedTokens: 26, queryPreview: "[CHARACTER | Wynn]: GREET The fen is quiet under the fog.\n[USER | User]: I pole the punt past a heron.", vectorRetrieval: { eligibleCount: 1, hitsBeforeThreshold: 1, hitsAfterThreshold: 1, topK: 4, blockerMessages: [] } });

    // The context, as an extension is handed it: no book name, no tokens, a peer's book as a persona's, and nothing captured.
    const context = seen[0]!.context;
    expect(context.activatedWorldInfo).toEqual([
      { id: "e-gate", comment: "The gate", keys: [], source: "keyword", bookId: "book-fen", bookSource: "character" },
      { id: "e-visitor", comment: "A visitor's punt", keys: ["punt"], source: "keyword", bookId: "book-peer", bookSource: "persona" },
      { id: "e-heron", comment: "The heron", keys: [], source: "vector", score: 1.4, bookId: "book-fen", bookSource: "character" },
    ]);
    expect(Object.keys(context)).not.toContain("capturedWorldInfo");

    // With no embeddings connection nothing is searched, and the event says why in Lumiverse's words.
    const { lv: plain } = fen(fenLines(), book);
    await play(plain, "I pole the punt past a heron.");
    expect(told(plain).entries.map((e) => e.id)).toEqual(["e-gate", "e-visitor"]);
    expect(told(plain).stats.vectorRetrieval).toMatchObject({ eligibleCount: 1, topK: 4, blockerMessages: ["Embeddings are disabled, so lorebooks will use keyword matching only.", "No embedding API key is configured.", "Embeddings have not been tested yet, so dimensions are still unknown."] });

    // With nothing activated Lumiverse sends no event, and the context keeps the `activatedWorldInfo` a context handler put there, projected
    // as Lumiverse's own would be (`services/prompt-assembly.service.ts:4455-4456`; `services/generate.service.ts:1218-1220`, `:2869`).
    const { lv: bare } = fen(fenLines(), [{ id: "e-otter", book: "book-fen", keys: ["otter"], content: "OTTER-LORE An otter fishes." }]);
    const bareContexts: Record<string, unknown>[] = [];
    bare.install(["interceptor"]).registerInterceptor(async (messages, context) => {
      bareContexts.push(context as Record<string, unknown>);
      return messages;
    }, {});
    bare.install(["context_handler"]).registerContextHandler(async (ctx) => ({ ...(ctx as object), activatedWorldInfo: [{ id: "e-planted", comment: "Planted", keys: ["otter"], source: "keyword", bookName: "Planted notes", estimatedTokens: 3 }] }));
    await play(bare, "I watch the water.");
    expect(bare.events.some((e) => e.event === "WORLD_INFO_ACTIVATED")).toBe(false);
    expect(bareContexts[0]!.activatedWorldInfo).toEqual([{ id: "e-planted", comment: "Planted", keys: ["otter"], source: "keyword" }]);
  });

  test("another extension's context handler: its fields reach the interceptors, by Lumiverse's rules for permission, priority, one per extension, budget, failure and cancel", async () => {
    const { lv, calls } = fen(fenLines(), book);
    const contexts: Record<string, unknown>[] = [];
    lv.install(["interceptor"]).registerInterceptor(async (messages, context) => {
      contexts.push(context as Record<string, unknown>);
      return messages;
    }, {});
    const order: string[] = [];
    // No permission: refused in Lumiverse's words, and never run.
    const unpermitted = lv.install([]);
    unpermitted.registerContextHandler(async (ctx) => ({ ...(ctx as object), unpermitted: true }));
    expect(unpermitted.logs).toEqual(["permission_denied: context_handler (registerContextHandler)"]);
    expect(lv.log).toContain(`[Spindle:${unpermitted.id}] Context handler permission not granted`);
    // A second registration of one extension replaces its first; a lower priority runs first; what each gives back is the context the
    // next is given, the frontend session put back; what it adds reaches the interceptors, but never anything captured.
    const naming = lv.install(["context_handler"]);
    naming.registerContextHandler(async (ctx) => ({ ...(ctx as object), replaced: true }));
    naming.registerContextHandler(async (ctx) => {
      order.push("naming");
      return { ...(ctx as object), generationId: `${String((ctx as { early?: string }).early)}-gen`, frontendSessionId: "page-9", activatedWorldInfo: [{ id: "e-planted", comment: "Planted", keys: [], source: "keyword" }], capturedWorldInfo: [{ id: "e-gate" }], __spindleWorldInfoCaptures: { [naming.id]: [{ id: "e-gate" }] } };
    }, 100);
    lv.install(["context_handler"]).registerContextHandler(async (ctx) => {
      order.push("early");
      return { ...(ctx as object), early: "fen" };
    }, 10);
    // One that throws, not required: passed over, the context as it was, its error in the extension's log.
    const failing = lv.install(["context_handler"]);
    failing.registerContextHandler(async () => {
      throw new Error("the fen map is torn");
    }, 50);
    await play(lv, "I pole the punt.");
    expect(order).toEqual(["early", "naming"]);
    expect(contexts[0]).toMatchObject({ chatId: CHAT, userId: USER, early: "fen", generationId: "fen-gen", frontendSessionId: undefined });
    for (const key of ["unpermitted", "replaced", "capturedWorldInfo", "__spindleWorldInfoCaptures"]) expect(Object.keys(contexts[0]!)).not.toContain(key);
    // Lore that activated takes the place of what a handler put in its name.
    expect((contexts[0]!.activatedWorldInfo as { id: string }[]).map((e) => e.id)).toEqual(["e-gate", "e-visitor"]);
    expect(failing.logs).toEqual(["Context handler error: the fen map is torn"]);

    // Budgets: 10 seconds unless asked, else held between 1 and 120 seconds; one that runs out is passed over.
    const { lv: timed } = fen(fenLines(), book);
    const budgets: number[] = [];
    timed.budgetTimer = (ms, fire) => {
      budgets.push(ms);
      queueMicrotask(fire);
      return () => undefined;
    };
    const hang = (): Promise<unknown> => Promise.withResolvers<unknown>().promise;
    timed.install(["context_handler"]).registerContextHandler(hang, 1, { timeoutMs: 600_000 });
    timed.install(["context_handler"]).registerContextHandler(hang, 2, { timeoutMs: 50 });
    timed.install(["context_handler"]).registerContextHandler(hang, 3);
    await play(timed, "I pole the punt.");
    expect(budgets).toEqual([120_000, 1_000, 10_000]);

    // A required one that fails fails the generation with its error: its empty message removed, nothing sent.
    const { lv: strict, calls: strictCalls } = fen(fenLines(), book);
    strict.install(["context_handler"]).registerContextHandler(async () => {
      throw new Error("the sluice log is locked");
    }, 100, { required: true });
    strict.send(CHAT, "I pole the punt.");
    const failed = await strict.generate({ chat: CHAT, connection: "conn-model", preset: "preset-fen" });
    expect(failed.error).toBe("the sluice log is locked");
    expect(strict.events.findLast((e) => e.event === "GENERATION_ENDED")?.payload).toMatchObject({ error: "the sluice log is locked" });
    expect(strict.chats.get(CHAT)!.messages.map((m) => m.role)).toEqual(["assistant", "user"]);
    expect(strictCalls()).toBe(0);

    // One that cancels stops it as a stop does: nothing sent or saved, and no end.
    const { lv: cancelled, calls: cancelledCalls } = fen(fenLines(), book);
    cancelled.install(["context_handler"]).registerContextHandler(async (ctx) => ({ ...(ctx as object), cancelGeneration: true }));
    cancelled.send(CHAT, "I pole the punt.");
    const stopped = await cancelled.generate({ chat: CHAT, connection: "conn-model", preset: "preset-fen" });
    expect([stopped.error, stopped.stopped]).toEqual([null, true]);
    expect(cancelled.events.findLast((e) => e.event === "GENERATION_STOPPED")?.payload).toMatchObject({ content: "" });
    expect(cancelled.events.some((e) => e.event === "GENERATION_ENDED")).toBe(false);
    expect(cancelled.chats.get(CHAT)!.messages.map((m) => m.role)).toEqual(["assistant", "user"]);
    expect(cancelledCalls()).toBe(0);
    expect(calls()).toBe(1);
  });
});

// The prompt itself is the assembly's (`assembly.ts`); one look that the lore placed there is the lore activated, a dry run too.
test("the prompt carries the entries activated, in the order Lumiverse gives them", async () => {
  const { lv } = fen(fenLines(), [
    { id: "e-reed", book: "book-fen", keys: ["reed"], content: "REED-LORE The reeds whisper." },
    { id: "e-gate", book: "book-fen", constant: true, content: "GATE-LORE The sluice gate is shut." },
  ]);
  const dry = await play(lv, "A reed snaps.", true);
  const lore = (out: Outcome): string[] => out.prompt.filter((m) => m.__worldInfoSource === true).map((m) => textOf(m).split(" ")[0]!);
  // Constant entries come first (`services/world-info-activation.service.ts:410`).
  expect(lore(dry)).toEqual(["GATE-LORE", "REED-LORE"]);
  const contexts: PromptMessageDTO[][] = [];
  lv.install(["interceptor"]).registerInterceptor(async (messages) => {
    contexts.push(messages);
    return messages;
  }, {});
  expect(lore(await play(lv))).toEqual(["GATE-LORE", "REED-LORE"]);
  expect(contexts[0]!.filter((m) => m.__isWorldInfoEntry === true).map((m) => textOf({ role: "system", content: m.content as string }))).toEqual(["GATE-LORE The sluice gate is shut.", "REED-LORE The reeds whisper."]);
});
