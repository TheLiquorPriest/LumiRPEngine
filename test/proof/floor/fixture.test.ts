// The floor fixture's pure parts (PlanGates-4, the floor's lore row and its item 4): the book Lumiverse
// is asked to make activates on the floor's own lines in every way an entry comes in, whichever connection
// plays which line and whatever the model replies; a card keeps its own books; the book is read back
// against its design; no vector entry is made while Lumiverse could not search it; plain generation's
// reasoning binding is set to the Author's effort and nothing else changes; the Author's effort is read
// from its header and never defaulted. Lumiverse cannot run here, so what it does with these bodies is
// modelled below from its own source, each rule with its file and line.

import { describe, expect, test } from "bun:test";
import { isRecord } from "../../../src/shared/json";
import { authorEffort, CARD, cardBooks, designedLines, detachBooks, embeddingBlockers, entriesToMake, entryBody, LINES, LORE, MARK, markedCard, readBook, removeFixture, setupFixture, thinkingMetadata, type EntryBody, type FixtureHost, type FixtureRecord, type RecordStore } from "../../../scripts/testbed/floor-fixture";
import type { TestbedEnv } from "../../../scripts/testbed/lib/env";
import { HttpError } from "../../../scripts/testbed/lib/lumiverse";

type Came = "constant" | "keyword" | "sticky";

/** Lumiverse's default number of recursion passes (`src/services/world-info-activation.service.ts:55`). */
const RECURSION_PASSES = 3;

/**
 * What Lumiverse activates by its keyword rules for each line of a chat played one generation per line,
 * by title, for the fields the floor's entries set (any other field throws: the model does not know it).
 * History is the card's greeting, then each line and the reply to it; the reply a send is generating is
 * not yet in it (`src/services/generate.service.ts:1988-2006`, `src/services/prompt-assembly.service.ts:1900-1904`).
 * - Constants always come in (`src/services/world-info-activation.service.ts:401-418`).
 * - A keyed entry's keys are matched in its last `scan_depth` messages, or all of them when it sets none
 *   and the user's setting is its default (`:739-760`, `:54`), case blind, whole words when it says so
 *   (`src/services/world-info-matcher.service.ts:187-188, 254-256, 324-337`); an entry with no keys never
 *   matches (`:743`, `:827`).
 * - Activated entries' text is scanned again unless they prevent it, for up to the passes (`:800-802`,
 *   `:804-863`); a vectorized entry is never activated by such a pass (`:826`).
 * - A match sets its sticky count (`:844-846`); an entry that did not match keeps coming in, as sticky,
 *   while its count lasts, and goes when it runs out (`:445-470`, `:875-880`).
 */
function activations(bodies: readonly EntryBody[], lines: readonly string[], reply: string): Map<string, Came>[] {
  const modelled: Readonly<Record<string, true>> = { comment: true, content: true, key: true, constant: true, vectorized: true, sticky: true, scan_depth: true, match_whole_words: true, prevent_recursion: true, use_probability: true };
  for (const body of bodies) for (const field of Object.keys(body)) if (!Object.hasOwn(modelled, field)) throw new Error(`the model does not know how Lumiverse reads ${field}`);
  const state = new Map<string, { stickyLeft: number; active: boolean }>();
  const history: string[] = [CARD.first_mes];
  const out: Map<string, Came>[] = [];
  const conditional = bodies.filter((b) => !b.constant);
  for (const line of lines) {
    history.push(line);
    const got = new Map<string, Came>();
    for (const b of bodies) if (b.constant) got.set(b.comment, "constant");
    const window = (b: EntryBody) => (b.scan_depth === undefined || b.scan_depth <= 0 || b.scan_depth >= history.length ? history : history.slice(-b.scan_depth));
    const hit = (b: EntryBody, texts: readonly string[]) =>
      b.key.some((k) => texts.some((t) => (b.match_whole_words ? new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(t) : t.toLowerCase().includes(k.toLowerCase()))));
    const chunks: string[] = [];
    let fresh = bodies.filter((b) => b.constant && b.content !== "" && !b.prevent_recursion && !b.vectorized).map((b) => b.content);
    const matched = new Set<string>();
    for (let pass = 0; pass <= RECURSION_PASSES; pass++) {
      if (pass > 0) {
        if (fresh.length === 0) break;
        chunks.push(...fresh);
        fresh = [];
      }
      let any = false;
      for (const b of conditional) {
        if (got.has(b.comment) || b.key.length === 0 || (pass > 0 && b.vectorized)) continue;
        if (!hit(b, [...window(b), ...chunks])) continue;
        matched.add(b.comment);
        const s = state.get(b.comment) ?? { stickyLeft: 0, active: false };
        s.active = true;
        if (b.sticky > 0) s.stickyLeft = b.sticky;
        state.set(b.comment, s);
        got.set(b.comment, "keyword");
        any = true;
        if (b.content !== "" && !b.prevent_recursion && !b.vectorized) fresh.push(b.content);
      }
      if (!any && (pass > 0 || fresh.length === 0 || pass >= RECURSION_PASSES)) break;
    }
    for (const b of conditional) {
      const s = state.get(b.comment);
      if (got.has(b.comment) || matched.has(b.comment) || s === undefined) continue;
      if (s.active && s.stickyLeft <= 0) s.active = false;
    }
    for (const b of conditional) {
      const s = state.get(b.comment);
      if (got.has(b.comment) || s === undefined || s.stickyLeft <= 0) continue;
      s.stickyLeft--;
      s.active = true;
      got.set(b.comment, "sticky");
    }
    out.push(got);
    history.push(reply);
  }
  return out;
}

/** A reply that holds every key of the book: what activates must not depend on what the model writes. */
const EVERY_KEY = LORE.flatMap((d) => d.keys).join(", ");

describe("the floor's book on the floor's lines", () => {
  const seen = activations(LORE.map(entryBody), LINES, EVERY_KEY);
  const on = (title: string, came: Came) => seen.flatMap((got, i) => (got.get(title) === came ? [i + 1] : []));

  test("every way of coming in that keywords can show shows on the lines designed for it, whatever the model replies", () => {
    expect(LINES).toHaveLength(20);
    expect(on("Skerry Rock", "constant")).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(on("The keeper's logbook", "keyword")).toEqual([9, 18]);
    expect(on("The storm", "keyword")).toEqual([1, 15]);
    expect(on("The storm", "sticky")).toEqual([2, 3, 4, 16, 17, 18]);
    // Nothing else activates by Lumiverse's keyword rules: the lamp comes in only by vector search.
    expect(seen.map((got) => got.size)).toEqual(LINES.map((_, i) => 1 + (on("The keeper's logbook", "keyword").includes(i + 1) ? 1 : 0) + (on("The storm", "keyword").includes(i + 1) || on("The storm", "sticky").includes(i + 1) ? 1 : 0)));
    expect(seen.some((got) => got.has("The lamp"))).toBe(false);
  });

  test("whichever connection plays the odd lines, each sees the keyword entry by keyword and the storm still sticky", () => {
    for (const parity of [1, 0]) {
      const mine = (n: number) => n % 2 === parity;
      expect(on("The keeper's logbook", "keyword").some(mine)).toBe(true);
      expect(on("The storm", "sticky").some(mine)).toBe(true);
    }
  });

  test("the vector entry can come in by vector search alone: no keys, and vectorized", () => {
    const lamp = entryBody(LORE.find((d) => d.kind === "vector") as (typeof LORE)[number]);
    expect(lamp.key).toEqual([]);
    expect(lamp.vectorized).toBe(true);
  });

  test("the lines each entry is made to activate on, as the lore row holds Lumiverse to them, are the lines Lumiverse's own rules activate it on", () => {
    for (const d of LORE) {
      const modelled = seen.flatMap((got, i) => (got.has(d.title) ? [i + 1] : []));
      expect(designedLines(d)).toEqual(modelled);
    }
  });
});

describe("the vector entry and Lumiverse's embedding connection", () => {
  test("with no embedding connection set, setup is told each reason and makes no vector entry; with one, it makes it", () => {
    const none = embeddingBlockers({ enabled: false, has_api_key: false, dimensions: null, vectorize_world_books: false });
    expect(none).toHaveLength(4);
    expect(none.join("; ")).toContain("embeddings are off");
    expect(entriesToMake(LORE, none).map((d) => d.kind)).toEqual(["constant", "keyword", "sticky"]);
    // Tested but not set to vectorize books: still no vector search (`src/services/prompt-assembly.service.ts:5680-5683`).
    expect(embeddingBlockers({ enabled: true, has_api_key: true, dimensions: 1024, vectorize_world_books: false })).toEqual(["Lumiverse's embedding settings do not vectorize world books"]);
    const ready = embeddingBlockers({ enabled: true, has_api_key: true, dimensions: 1024, vectorize_world_books: true });
    expect(ready).toEqual([]);
    expect(entriesToMake(LORE, ready).map((d) => d.kind)).toEqual(["constant", "keyword", "sticky", "vector"]);
  });
});

describe("the book read back against its design", () => {
  /** An entry as Lumiverse lists it once made from the design: the body's fields as given, some of its own besides. */
  type ListedEntry = EntryBody & { id: string; keysecondary: string[]; position: number; vector_index_status: string };
  const rows = (): ListedEntry[] => LORE.map((d, i) => ({ id: `entry-${i + 1}`, ...entryBody(d), keysecondary: [], position: 0, vector_index_status: d.kind === "vector" ? "pending" : "not_enabled" }));

  test("a book made from the design reads back whole, the vector entry with Lumiverse's index state", () => {
    const read = readBook(rows());
    expect(read.faults).toEqual([]);
    expect(read.notMade).toEqual([]);
    expect(read.made.map((m) => [m.entry, m.title, m.kind, m.vectorIndex])).toEqual([
      ["entry-1", "Skerry Rock", "constant", null],
      ["entry-2", "The keeper's logbook", "keyword", null],
      ["entry-3", "The storm", "sticky", null],
      ["entry-4", "The lamp", "vector", "pending"],
    ]);
  });

  test("a changed field, a doubled title and an entry the design lacks are faults; a vector entry never made is not", () => {
    const changed = rows().map((r) => (r.comment === "The storm" ? { ...r, sticky: 0 } : r));
    expect(readBook(changed).faults).toEqual(['"The storm" has sticky 0 where the design has 3']);
    const doubled: ListedEntry[] = [...rows(), { ...(rows()[1] as ListedEntry), id: "entry-9" }];
    expect(readBook(doubled).faults).toEqual(['it holds 2 entries titled "The keeper\'s logbook"']);
    const extra: ListedEntry[] = [...rows(), { ...(rows()[0] as ListedEntry), id: "entry-7", comment: "The gulls" }];
    expect(readBook(extra).faults).toEqual(['it holds an entry the design does not have ("The gulls", entry-7)']);
    const noLamp = readBook(rows().filter((r) => r.comment !== "The lamp"));
    expect(noLamp.faults).toEqual([]);
    expect(noLamp.notMade.map((d) => d.title)).toEqual(["The lamp"]);
  });
});

describe("the card and its books", () => {
  test("the floor's book is added beside the card's own books and taken off alone, everything else kept", () => {
    const own = { talkativeness: "0.5", world_book_id: "book-own", depth_prompt: { prompt: "", depth: 4 } };
    const attached = markedCard(own, "book-floor");
    expect(attached).not.toBeNull();
    expect(cardBooks(attached)).toEqual(["book-own", "book-floor"]);
    expect(attached).toMatchObject({ talkativeness: "0.5", depth_prompt: { prompt: "", depth: 4 }, [MARK]: true });
    // Written as Lumiverse writes a card's books: the list, and no older single field beside it.
    expect(attached !== null && "world_book_id" in attached).toBe(false);
    expect(markedCard(attached, "book-floor")).toBeNull();
    const detached = detachBooks(attached, ["book-floor"]);
    expect(cardBooks(detached)).toEqual(["book-own"]);
    expect(detached).toMatchObject({ talkativeness: "0.5", [MARK]: true });
    expect(detachBooks(detached, ["book-floor"])).toBeNull();
  });
});

describe("plain generation's thinking at the Author's effort", () => {
  /** The reasoning settings Lumiverse uses for a connection: its own binding whole, else the user's global setting (`src/services/generation/reasoning.ts:211-221`). */
  const effective = (metadata: unknown, global: unknown): unknown => {
    const bound = isRecord(metadata) && isRecord(metadata.reasoningBindings) ? metadata.reasoningBindings.settings : undefined;
    return bound && typeof bound === "object" ? bound : (global ?? null);
  };

  test("a connection's own binding takes the effort with reasoning on, and nothing else of it or the connection changes", () => {
    const settings = { prefix: "<think>", suffix: "</think>", autoParse: true, apiReasoning: false, reasoningEffort: "low", keepInHistory: 1, thinkingDisplay: "summarized" };
    const metadata = { folder: "Plain", color: "#336699", reasoningBindings: { settings, promptBias: "Think briefly." } };
    const global = { prefix: "[[", apiReasoning: true, reasoningEffort: "max" };
    const next = thinkingMetadata(metadata, global, "high");
    expect(next.from).toBe("connection");
    expect(effective(next.metadata, global)).toEqual({ ...settings, apiReasoning: true, reasoningEffort: "high" });
    expect(next.metadata).toMatchObject({ folder: "Plain", color: "#336699", reasoningBindings: { promptBias: "Think briefly." } });
  });

  test("a connection with no binding of its own keeps what the global setting gave it, with only the effort and reasoning on changed", () => {
    const global = { prefix: "[[", suffix: "]]", autoParse: false, apiReasoning: false, reasoningEffort: "auto", thinkingDisplay: "omitted", customBody: { enabled: false, rawJson: "" } };
    const before = effective({ folder: "Plain" }, global);
    const next = thinkingMetadata({ folder: "Plain" }, global, "high");
    expect(next.from).toBe("global");
    expect(effective(next.metadata, global)).toEqual({ ...(before as object), apiReasoning: true, reasoningEffort: "high" });
    expect(thinkingMetadata(null, null, "medium")).toEqual({ metadata: { reasoningBindings: { settings: { apiReasoning: true, reasoningEffort: "medium" } } }, from: "none" });
  });

  test("an Author that thinks at off is matched by reasoning off; an effort no definition takes is refused, never replaced", () => {
    const off = thinkingMetadata({ reasoningBindings: { settings: { apiReasoning: true, reasoningEffort: "high", prefix: "<t>" } } }, null, "off");
    expect(effective(off.metadata, null)).toEqual({ apiReasoning: false, reasoningEffort: "high", prefix: "<t>" });
    expect(() => thinkingMetadata({}, null, "turbo")).toThrow('"turbo" is not an effort an agent definition takes');
    expect(() => thinkingMetadata({}, null, "auto")).toThrow('"auto" is not an effort');
  });
});

describe("the Author's effort, read from its definition", () => {
  const definition = (header: string) => `---\nname: author\ndescription: The lead, in an invented story.\nmodel: default\n${header}tools: [prompt, roll]\n---\nYou are the Author.\n`;

  test("a header with effort: low gives low", () => {
    expect(authorEffort(definition("effort: low\n"))).toBe("low");
    // Read as RPH reads a header: a byte-order mark, Windows line ends and quotes change nothing.
    expect(authorEffort(`\uFEFF${definition('effort: "low"\n').replace(/\n/g, "\r\n")}`)).toBe("low");
  });

  test("a header that names no effort gives none, never a default; so does a word RPH does not take, or no header", () => {
    expect(authorEffort(definition(""))).toBeNull();
    expect(authorEffort(definition("effort: turbo\n"))).toBeNull();
    expect(authorEffort("You are the Author.\neffort: high\n")).toBeNull();
    expect(authorEffort("---\neffort: high\nYou are the Author, and the header never closes.\n")).toBeNull();
  });
});

/** A stand-in for Lumiverse's routes the fixture calls, holding rows in memory: a missing row is a 404, as Lumiverse answers. */
class Stand {
  rows: Record<"presets" | "personas" | "characters" | "world-books" | "chats" | "connections", { id: string; [key: string]: unknown }[]> = { presets: [], personas: [], characters: [], "world-books": [], chats: [], connections: [{ id: "conn-plain", name: "Plain", metadata: {} }] };
  entries = new Map<string, { id: string; [key: string]: unknown }[]>();
  private next = 0;
  private id(kind: string): string {
    return `${kind}-${++this.next}`;
  }
  private kind(segment: string | undefined): keyof Stand["rows"] {
    if (segment === undefined || !(segment in this.rows)) throw new Error(`the stand-in has no route ${segment}`);
    return segment as keyof Stand["rows"];
  }
  readonly host: FixtureHost = {
    call: async <T>(method: string, path: string, body?: unknown): Promise<T> => {
      const [route, query] = path.split("?");
      const [, , , segment, id] = (route ?? "").split("/");
      if (segment === "embeddings") return { enabled: false, has_api_key: false, dimensions: null, vectorize_world_books: false } as T;
      if (segment === "settings") throw new HttpError(404, "not found", `${method} ${path}`);
      const kind = this.kind(segment);
      const list = this.rows[kind];
      if (id === undefined && method === "GET") {
        const character = new URLSearchParams(query).get("characterId");
        const data = character === null ? list : list.filter((r) => r.character_id === character);
        return { data, total: data.length } as T;
      }
      if (id === undefined && method === "POST") {
        const row = { id: this.id(kind), ...(body as object) };
        list.push(row);
        return row as T;
      }
      const row = list.find((r) => r.id === id);
      if (row === undefined) throw new HttpError(404, "not found", `${method} ${path}`);
      if (method === "PUT") Object.assign(row, body);
      if (method === "DELETE") list.splice(list.indexOf(row), 1);
      return row as T;
    },
    bookEntries: async (book) => this.entries.get(book) ?? [],
    createEntry: async (book, entry) => {
      const row = { id: this.id("entry"), ...entry, vector_index_status: "not_enabled" };
      this.entries.set(book, [...(this.entries.get(book) ?? []), row]);
      return row;
    },
    createChat: async (character, name) => {
      const row = { id: this.id("chat"), name, character_id: character };
      this.rows.chats.push(row);
      return row;
    },
    deleteChat: async (chat) => {
      this.rows.chats = this.rows.chats.filter((c) => c.id !== chat);
    },
  };
}

/** The fixture's record, in memory. */
function memoryRecord(): RecordStore & { held: FixtureRecord } {
  const store = {
    held: { presets: [], personas: [], books: [], cards: [], chats: [] } as FixtureRecord,
    read: () => structuredClone(store.held),
    write: (record: FixtureRecord) => {
      store.held = structuredClone(record);
    },
  };
  return store;
}

describe("the fixture removes only what it made, and says only what it does", () => {
  // `guard` reads only the never-touch list of the bed's settings.
  const env = { neverTouch: [] } as unknown as TestbedEnv;

  test("with an unmarked card named Marta Venn already there, setup makes its own and remove leaves the other", async () => {
    const stand = new Stand();
    stand.rows.characters.push({ id: "card-users-own", name: CARD.name, extensions: { talkativeness: "0.5" } });
    stand.rows.chats.push({ id: "chat-users-own", name: "My own chat", character_id: "card-users-own" });
    const record = memoryRecord();
    const made = await setupFixture(stand.host, "low", "conn-plain", record);
    expect(made.fixture.card.id).not.toBe("card-users-own");
    expect(record.held.cards).toEqual([made.fixture.card.id]);
    expect(record.held.chats).toEqual([made.chat]);
    expect(stand.rows.characters.find((c) => c.id === "card-users-own")?.extensions).toEqual({ talkativeness: "0.5" });
    // Setup's lines say how the floor sends, and name no forced preset.
    const said = made.lines.join("\n");
    expect(said).toContain("The floor sends each line through Lumiverse's chat page, by the host's send");
    expect(said).not.toMatch(/forc/i);

    const removed = await removeFixture(stand.host, env, record);
    expect(stand.rows.characters.map((c) => c.id)).toEqual(["card-users-own"]);
    expect(stand.rows.chats.map((c) => c.id)).toEqual(["chat-users-own"]);
    expect([stand.rows.presets, stand.rows.personas, stand.rows["world-books"]].map((l) => l.length)).toEqual([0, 0, 0]);
    expect(removed).toContain(`deleted card ${made.fixture.card.id} "${CARD.name}"`);
    expect(record.held).toEqual({ presets: [], personas: [], books: [], cards: [], chats: [] });
  });

  test("a marked card the record does not list is left and named, never deleted; a listed card another chat uses is kept, its book taken off", async () => {
    const stand = new Stand();
    const record = memoryRecord();
    const made = await setupFixture(stand.host, "low", "conn-plain", record);
    stand.rows.chats.push({ id: "chat-later", name: "A chat of the user's on the floor's card", character_id: made.fixture.card.id });
    stand.rows.characters.push({ id: "card-marked-elsewhere", name: "Another card", extensions: { [MARK]: true } });
    const removed = await removeFixture(stand.host, env, record);
    expect(stand.rows.characters.map((c) => c.id).sort()).toEqual(["card-marked-elsewhere", made.fixture.card.id].sort());
    expect(cardBooks(stand.rows.characters.find((c) => c.id === made.fixture.card.id)?.extensions)).toEqual([]);
    expect(removed).toContain(`left card-marked-elsewhere "Another card": it carries the floor's mark, and the fixture's record does not list it`);
    expect(record.held.cards).toEqual([made.fixture.card.id]);
  });
});
