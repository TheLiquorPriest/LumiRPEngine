// The floor test's fixture: an invented card, a persona, a preset and a lore book of its own, all
// consistent with one another, so that "a simple turn" asks nothing the chat cannot answer, and the
// player's twenty lines (`LINES`), which the floor plays in order, one generation after each. The floor
// sends each line through Lumiverse's chat page, by the host's `send` (`scripts/proof/floor/play.ts`),
// naming this preset and persona to it; setup makes neither active. Whether the page sends with them
// without changing the user's own active ones is the host's (PlanScenarios-2 item 7, PlanScenarios-3
// item 9). The book is attached to the card, the first of the four places Lumiverse takes a
// one-character chat's books from (character, persona, chat metadata, the user's global list: Lumiverse
// `src/services/world-info-sources.service.ts:120-129`, `src/services/prompt-assembly.service.ts:2243-2260`).
// Each made thing carries a mark: in the metadata of the preset, the persona and the book, and in the
// extensions of the card, which has no metadata; `findFixture` finds the fixture by it. Setup adopts
// nothing: a marked thing is gone on with only where its id is in the fixture's record (`RecordStore`),
// the id of what setup made itself; a marked thing the record does not list, a user's card that once
// took the mark, is left alone, and setup makes its own. Setup lists each thing it made or goes on
// with by id, `removeFixture` deletes only what that record lists, and `findFixture`, given the record,
// finds only what it lists (PlanGates-4-fix1 item 12, PlanGates-4-fix2 item 7).
//
// The book (`LORE`) is made so the floor's row "Activated lore" (§17.1 l.1765) sees every way an entry
// comes in (plan §4.2 l.216, READINGS N-5) on the floor's own lines, whichever connection plays which
// line: the floor alternates them in one chat, and Lumiverse keeps that chat's sticky counts in its
// metadata (`src/services/world-info-activation.service.ts:15-24`, read at
// `src/services/prompt-assembly.service.ts:2272`), saved after every generation on any connection
// (`src/services/generate.service.ts:2842-2865`):
// - "Skerry Rock", constant: on every line.
// - "The keeper's logbook", by keyword (`logbook`): on lines 9 and 18 (one odd, one even).
// - "The storm", by keyword (`storm`) on lines 1 and 15, then still sticky by its count of 3 on lines 2-4
//   and 16-18, which do not hold its key.
// - "The lamp", by vector search only (it has no keys): made only when Lumiverse has an embedding
//   connection it can search with (`embeddingBlockers`), and searched once Lumiverse has indexed it.
// Lumiverse puts the activated entries just before the chat history, since the floor's preset has no
// world-info block of its own (`src/services/prompt-assembly.service.ts:3731-3743`).
//
// Plain generation thinks at the Author's effort (R-92): `authorEffort` reads the effort the Author's
// definition names, from the file as RPE serves it, and `setupFixture` sets the plain connection's own
// reasoning binding to it (`setPlainThinking`).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Effort } from "rp-harness/contract";
import { isRecord } from "../../src/shared/json";
import type { BookDesign, LoreHow, PlannedEntry } from "../proof/lib/lore";
import { guard, type TestbedEnv } from "./lib/env";
import { HttpError, type Lumiverse } from "./lib/lumiverse";

/** The fixture's mark: in the metadata of the preset, the persona and the book `setupFixture` makes, and in the card's extensions. */
export const MARK = "lumirpengine_floor_test";
/** The floor chats' name. */
export const CHAT_NAME = "Floor test";

export const CARD = {
  name: "Marta Venn",
  description:
    "Marta Venn keeps the light on Skerry Rock, a day's sail from the nearest harbor. She is in her fifties, spare and weathered, slow to speak and exact when she does. She has kept the lamp for nineteen years and knows the water around the rock by sound.",
  personality: "Dry, patient, observant. She answers what is asked and notices what is not.",
  scenario: "A traveller's boat has put in at Skerry Rock ahead of a storm. Marta has let them into the keeper's kitchen at the foot of the tower.",
  first_mes:
    "The kitchen is small and warm, and smells of lamp oil and peat. Marta shuts the door against the wind and nods at the bench by the stove.\n\n\"You'll not be leaving tonight,\" she says. \"Sit. There's tea.\"",
};

/** The player: the traveller the card's scenario names, and nobody else. */
const PERSONA = {
  name: "Traveller",
  title: "Floor test (invented)",
  folder: "Floor test (invented)",
  description: "A traveller whose small boat put in at Skerry Rock ahead of the storm: tired, polite, and curious about the keeper and her light.",
  is_default: false,
  metadata: { [MARK]: true },
};

/** Plain instructions that name nobody: `{{char}}` and `{{user}}` are the card and the persona. */
const INSTRUCTIONS = [
  "Write {{char}}'s next reply in a roleplay with {{user}}.",
  "Write in the third person and the past tense, as the chat's first message is written: what {{char}} says and does, and what {{user}} can see and hear. Never write {{user}}'s words, actions or thoughts.",
  "Keep to the character and the scenario below. Answer what {{user}} has just said or done; the reply ends when {{char}} has answered.",
  "Write about 120 to 200 words.",
].join("\n\n");

export const block = (name: string, content: string, marker: string | null = null) => ({ name, content, role: "system", enabled: true, position: "pre_history", depth: 0, marker });

export const PRESET = {
  name: "Floor test (invented)",
  provider: "loom",
  engine: "classic",
  // No sampler overrides: both connections play with their own settings, as they would under any preset.
  parameters: {},
  prompt_order: [
    block("Instructions", INSTRUCTIONS),
    block("Character", "<character>\n{{description}}\n\n{{personality}}\n</character>"),
    block("Scenario", "<scenario>\n{{scenario}}\n</scenario>"),
    block("Player", "<player>\n{{user}}: {{persona}}\n</player>"),
    block("Chat History", "", "chat_history"),
  ],
  prompts: {},
  metadata: { [MARK]: true, description: "Made by the floor test's setup (scripts/testbed/floor.ts). Not made active; the floor names it to the chat page when it sends." },
};

/**
 * The player's lines, played in order: short, ordinary turns in one place, none of which needs a ruling
 * or a roll. Lines 1 and 15 hold the storm's key and lines 9 and 18 the logbook's; no other line holds
 * either (the book's design, above).
 */
export const LINES: readonly string[] = [
  "I set my pack down by the door and ask how long the storm is likely to last.",
  "I hang my coat near the stove and look around the room while she answers.",
  "I ask whether the lamp upstairs has ever gone out on her watch.",
  "I take the cup she offers and thank her.",
  "I ask what she does out here when the weather keeps the boats away.",
  "I walk to the window and watch the waves for a moment.",
  "I ask if anyone else has come by this week.",
  "I sit down at the table and stretch my legs.",
  "I ask her what the logbook on the shelf is for.",
  "I tell her the tea is good and ask where she gets it.",
  "I ask whether she ever thinks of leaving the rock.",
  "I pick up the brass spyglass from the sill and turn it over in my hands.",
  "I ask how she came to keep the light.",
  "I offer to carry the oil up the stairs for her.",
  "I ask what the worst storm she remembers here was like.",
  "I move my chair a little closer to the stove.",
  "I ask if the gulls always make that much noise.",
  "I ask whether the shoals on her charts are written up in the logbook.",
  "I ask whether she would like a hand with supper.",
  "I say I should check on my boat once the wind drops, and ask if the path down is safe.",
];

/**
 * Ten more simple lines after the twenty, in the same place and the same voice, so the floor model's
 * reply form is counted over the thirty turns the plan asks (row 0.2, PlanGates-24). None holds a key of
 * the floor's book.
 */
export const MORE_LINES: readonly string[] = [
  "I ask Marta whether the kettle is ever allowed to go cold.",
  "I look at the clock above the stove and ask if it keeps good time.",
  "I ask how far the nearest harbor really is by oar.",
  "I rub my hands together and say it is colder in here than I thought.",
  "I ask whether she sleeps in the kitchen or up in the tower.",
  "I ask what the keepers before her left on the walls.",
  "I thank her again for letting me in out of the weather.",
  "I ask whether the rock has a name for the wind that is coming.",
  "I lean my elbows on the table and ask what she would do if I stayed the week.",
  "I ask whether she would tell me when the light is lit tonight.",
];

/** The thirty lines the reply form is counted over: the floor's twenty, then ten more. */
export const LINES_30: readonly string[] = [...LINES, ...MORE_LINES];

/** One entry of the floor's book as designed: its title, how it is made to come in, its keys, its sticky count, its text. */
export interface LoreDesign {
  /** Lumiverse's `comment`, which RPE shows as a book entry's title (RPE `src/lore/lore.ts:93-96`). */
  title: string;
  kind: LoreHow;
  keys: readonly string[];
  /** How many generations the entry stays after the last line that held its key (Lumiverse's `sticky`); 0 but for the sticky entry. */
  sticky: number;
  content: string;
}

export const BOOK = {
  name: "Floor test lore (invented)",
  description: "Made by the floor test's setup (scripts/testbed/floor.ts) and attached to its card. Its entries activate on the floor's lines: one constant, one by keyword, one that stays by its sticky count, and one by vector search when an embedding connection is set.",
} as const;

export const LORE: readonly LoreDesign[] = [
  {
    title: "Skerry Rock",
    kind: "constant",
    keys: [],
    sticky: 0,
    content: "Skerry Rock is a bare islet of black stone a day's sail from the nearest harbor. The lighthouse stands on its highest point; the keeper's kitchen is at the foot of the tower, and a path cut into the rock runs down to a small landing on the lee side.",
  },
  {
    title: "The keeper's logbook",
    kind: "keyword",
    keys: ["logbook"],
    sticky: 0,
    content: "The logbook on the kitchen shelf holds nineteen years of Marta's entries: the hour the light was lit and put out each day, the weather at every watch, and each boat that passed or put in at the rock.",
  },
  {
    title: "The storm",
    kind: "sticky",
    keys: ["storm"],
    sticky: 3,
    content: "The storm came up from the south-west in the afternoon. Marta reckons it will blow through the night and ease by morning; until then no boat can leave the landing.",
  },
  {
    title: "The lamp",
    kind: "vector",
    keys: [],
    sticky: 0,
    content: "The lamp at the top of the tower burns paraffin oil behind a ring of glass prisms. Marta climbs the stairs at dusk to light it, trims the wick at midnight, and carries the oil up herself.",
  },
];

/** The body of `POST /api/v1/world-books/:id/entries` (Lumiverse `src/routes/world-books.routes.ts:960-974`) for one designed entry, in the fields Lumiverse takes (`src/types/world-book.ts:260-299`). A type, not an interface, so it passes as the client's plain JSON object. */
export type EntryBody = {
  comment: string;
  content: string;
  key: string[];
  constant: boolean;
  vectorized: boolean;
  sticky: number;
  scan_depth?: number;
  match_whole_words?: boolean;
  prevent_recursion: boolean;
  use_probability: boolean;
};

/**
 * One designed entry as Lumiverse is asked to make it. Each field is stored as given, and a field left
 * out takes its default (`src/services/world-books.service.ts:1786-1821`). Why the fields beyond the
 * design's own:
 * - `scan_depth: 1` on a keyed entry: Lumiverse matches its keys against the newest message only
 *   (`src/services/world-info-activation.service.ts:744-752`), which for a send is the player's line, since
 *   the reply it stages is left out of the scan (`src/services/generate.service.ts:1988-2006`,
 *   `src/services/prompt-assembly.service.ts:1900-1904`). So what the model writes never decides what
 *   activates, and the storm stays by its count, not by its key found again in an older line.
 * - `match_whole_words`: a key is not found inside a longer word (`src/services/world-info-matcher.service.ts:187-188, 254-256`).
 * - `prevent_recursion`: no entry's text is scanned for another's keys (`src/services/world-info-activation.service.ts:800-802, 856-858`).
 * - `use_probability: false`: no entry activates by chance (`src/services/world-info-activation.service.ts:840-842`).
 */
export function entryBody(design: LoreDesign): EntryBody {
  return {
    comment: design.title,
    content: design.content,
    key: [...design.keys],
    constant: design.kind === "constant",
    vectorized: design.kind === "vector",
    sticky: design.sticky,
    ...(design.keys.length > 0 ? { scan_depth: 1, match_whole_words: true } : {}),
    prevent_recursion: true,
    use_probability: false,
  };
}

/** The body of `POST /api/v1/world-books` (Lumiverse `src/routes/world-books.routes.ts:318-323`), which stores the metadata as given (`src/services/world-books.service.ts:1101-1113`) and gives it back on every list row (`:271-283`). */
export function bookBody(): { name: string; description: string; metadata: { [key: string]: unknown } } {
  return { name: BOOK.name, description: BOOK.description, metadata: { [MARK]: true } };
}

/**
 * The floor's lines (from 1) an entry of the design is made to activate on, by the rules its body sets
 * (`entryBody`): a constant on every line; a keyed entry on each line that holds one of its keys as a
 * whole word, case blind (its scan depth is the newest message, the player's line); a sticky one on the
 * lines after such a line that do not hold its key, for its sticky count; a vector entry on none of its
 * own design (Lumiverse's vector search decides). `fixture.test.ts` holds this to its model of
 * Lumiverse's own activation.
 */
export function designedLines(design: LoreDesign, lines: readonly string[] = LINES): number[] {
  if (design.kind === "constant") return lines.map((_, i) => i + 1);
  if (design.keys.length === 0) return [];
  const keyed = design.keys.map((k) => new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"));
  const out: number[] = [];
  let left = 0;
  lines.forEach((line, i) => {
    if (keyed.some((k) => k.test(line))) {
      left = design.sticky;
      out.push(i + 1);
    } else if (left > 0) {
      left--;
      out.push(i + 1);
    }
  });
  return out;
}

/** An entry the book holds as designed, with Lumiverse's id. */
export interface MadeEntry extends PlannedEntry {
  keys: readonly string[];
  sticky: number;
  /** Lumiverse's index state of the vector entry (`vector_index_status`), null for the others: its vector search reads only an "indexed" entry (`src/services/world-book-vector-state.ts:28-30`, `src/services/prompt-assembly.service.ts:5403-5407`). */
  vectorIndex: string | null;
}

/**
 * The book's entries, as Lumiverse lists them (its booleans and arrays already read back:
 * `src/services/world-books.service.ts:343-375`), against the design: each designed entry found by its
 * title and held to every field `entryBody` sets. A changed field, a doubled title or an entry the design
 * does not have is a fault; a designed entry not there is not made.
 */
export function readBook(rows: readonly { id: string; [key: string]: unknown }[], design: readonly LoreDesign[] = LORE): { made: MadeEntry[]; notMade: LoreDesign[]; faults: string[] } {
  const made: MadeEntry[] = [];
  const notMade: LoreDesign[] = [];
  const faults: string[] = [];
  for (const d of design) {
    const found = rows.filter((r) => r.comment === d.title);
    const row = found[0];
    if (row === undefined) {
      notMade.push(d);
      continue;
    }
    if (found.length > 1) faults.push(`it holds ${found.length} entries titled "${d.title}"`);
    for (const [field, want] of Object.entries(entryBody(d))) {
      if (JSON.stringify(row[field]) !== JSON.stringify(want)) faults.push(`"${d.title}" has ${field} ${JSON.stringify(row[field])} where the design has ${JSON.stringify(want)}`);
    }
    made.push({ entry: row.id, title: d.title, kind: d.kind, lines: designedLines(d), keys: d.keys, sticky: d.sticky, vectorIndex: d.kind === "vector" && typeof row.vector_index_status === "string" ? row.vector_index_status : null });
  }
  const titles = new Set(design.map((d) => d.title));
  for (const r of rows) if (typeof r.comment !== "string" || !titles.has(r.comment)) faults.push(`it holds an entry the design does not have ("${String(r.comment)}", ${r.id})`);
  return { made, notMade, faults };
}

/**
 * Why Lumiverse would not search a vector entry now, in plain words; none when it would. These are
 * Lumiverse's own four conditions, read from what `GET /api/v1/embeddings/config` answers
 * (`src/routes/embeddings.routes.ts:12-15`, the same config the prompt's assembly reads:
 * `src/services/prompt-assembly.service.ts:5664-5683`).
 */
export function embeddingBlockers(config: unknown): string[] {
  const c = isRecord(config) ? config : {};
  const out: string[] = [];
  if (!c.enabled) out.push("embeddings are off in Lumiverse's settings");
  if (!c.has_api_key) out.push("no embedding key is set in Lumiverse");
  if (!c.dimensions) out.push("Lumiverse's embedding connection has not been tested, so its dimensions are not known");
  if (!c.vectorize_world_books) out.push("Lumiverse's embedding settings do not vectorize world books");
  return out;
}

/** The design's missing entries setup makes: all of them, but the vector entry only while Lumiverse would search it. */
export function entriesToMake(notMade: readonly LoreDesign[], blockers: readonly string[]): LoreDesign[] {
  return notMade.filter((d) => d.kind !== "vector" || blockers.length === 0);
}

/** A card's books as Lumiverse reads them: `world_book_ids`, or the older single `world_book_id` (`src/utils/character-world-books.ts:6-13`). */
export function cardBooks(extensions: unknown): string[] {
  if (!isRecord(extensions)) return [];
  const ids = extensions.world_book_ids;
  if (Array.isArray(ids)) return ids.filter((id): id is string => typeof id === "string" && id !== "");
  const single = extensions.world_book_id;
  return typeof single === "string" && single !== "" ? [single] : [];
}

/** The card's extensions with `ids` as its books, written as Lumiverse writes them (`src/utils/character-world-books.ts:15-22`). */
export function withBooks(extensions: Record<string, unknown>, ids: readonly string[]): Record<string, unknown> {
  const next: Record<string, unknown> = { ...extensions, world_book_ids: [...ids] };
  delete next.world_book_id;
  return next;
}

/**
 * The card's extensions with the fixture's mark and the book among its books, everything else as it
 * was; null when both are there already. Lumiverse replaces a card's extensions whole on
 * `PUT /api/v1/characters/:id` (`src/db/character-operations.ts:140-143`), so the whole object is sent.
 */
export function markedCard(extensions: unknown, bookId: string): Record<string, unknown> | null {
  const own = isRecord(extensions) ? extensions : {};
  const books = cardBooks(own);
  if (own[MARK] === true && books.includes(bookId)) return null;
  return { ...withBooks(own, books.includes(bookId) ? books : [...books, bookId]), [MARK]: true };
}

/** The card's extensions without the given books, everything else as it was; null when it holds none of them. */
export function detachBooks(extensions: unknown, bookIds: readonly string[]): Record<string, unknown> | null {
  const own = isRecord(extensions) ? extensions : {};
  const books = cardBooks(own);
  const kept = books.filter((id) => !bookIds.includes(id));
  return kept.length === books.length ? null : withBooks(own, kept);
}

/** Every effort an agent definition's `effort:` takes (RPH `src/contract/common.ts:68`, read at `src/files/definitions.ts:11, 41-45`): a record, so the compiler holds it to RPH's own list. */
const EFFORTS: Readonly<Record<Effort, true>> = { off: true, minimal: true, low: true, medium: true, high: true, xhigh: true, max: true };

const isEffort = (word: unknown): word is Effort => typeof word === "string" && Object.hasOwn(EFFORTS, word);

/**
 * The connection's metadata with its reasoning binding set to `effort`, and where the rest of the
 * binding came from. Lumiverse takes a connection's reasoning from `metadata.reasoningBindings.settings`
 * whole when it holds one, and from the user's global `reasoningSettings` when it does not
 * (`src/services/generation/reasoning.ts:211-221`, `src/services/prompt-assembly.service.ts:7673-7693`);
 * the binding is the connection's own (`src/services/connections.service.ts:539-541` drops it from a copy).
 * So the new binding is the old one, or the global setting where there was none, with only reasoning
 * switched on at the effort: every other field of it (prefix, suffix, display, custom body) applies as
 * before, and so does every other key of the metadata and of the binding (its prompt bias:
 * `src/spindle/worker-host.ts:959-971`). Every effort but "off" is a word Lumiverse's setting takes as it is
 * (`src/spindle/worker-host.ts:905-914`) and puts on the request (`src/services/generation/reasoning.ts:255-268`);
 * "off" is reasoning switched off, which Lumiverse sends as the provider's off switch (`:278-280`). An
 * effort no agent definition takes is refused, never put in its place.
 */
export function thinkingMetadata(metadata: unknown, global: unknown, effort: string): { metadata: Record<string, unknown>; from: "connection" | "global" | "none" } {
  if (!isEffort(effort)) throw new Error(`"${effort}" is not an effort an agent definition takes (${Object.keys(EFFORTS).join(", ")}), so plain generation cannot be set to it`);
  const own = isRecord(metadata) ? metadata : {};
  const binding = isRecord(own.reasoningBindings) ? own.reasoningBindings : {};
  const bound = isRecord(binding.settings) ? binding.settings : null;
  const base = bound ?? (isRecord(global) ? global : {});
  const settings = effort === "off" ? { ...base, apiReasoning: false } : { ...base, apiReasoning: true, reasoningEffort: effort };
  return { metadata: { ...own, reasoningBindings: { ...binding, settings } }, from: bound !== null ? "connection" : isRecord(global) ? "global" : "none" };
}

const FENCE = /^---[ \t]*$/;

/**
 * The effort an agent definition's text names in its header, read as RPH reads it: the YAML between two
 * `---` lines at the top, by Bun's own parser, a byte-order mark and Windows line ends set aside (RPH
 * `src/files/header.ts:27-33, 66-84`), and only an effort RPH takes (`src/files/definitions.ts:41-45`).
 * Null when the text names none RPH would use: no header, one that does not parse (RPH then uses no
 * definition at all), no `effort:`, or a word RPH does not take. Never a default.
 */
export function authorEffort(definitionText: string): string | null {
  const lines = (definitionText.startsWith("\uFEFF") ? definitionText.slice(1) : definitionText).replace(/\r\n?/g, "\n").split("\n");
  if (!FENCE.test(lines[0] ?? "")) return null;
  const end = lines.findIndex((line, i) => i > 0 && FENCE.test(line));
  if (end === -1) return null;
  let header: unknown;
  try {
    header = Bun.YAML.parse(lines.slice(1, end).join("\n"));
  } catch {
    // A header that does not parse names no effort RPH would use.
    return null;
  }
  const effort = isRecord(header) ? header.effort : undefined;
  return isEffort(effort) ? effort : null;
}

/** The floor's book as `findFixture` found it: each entry it holds as designed, and why Lumiverse would not search its vector entry now (none when it would). */
export interface FloorBook extends BookDesign {
  entries: MadeEntry[];
  vectorBlockers: string[];
}

/** What the floor names on every generation, the card it plays, and its book. */
export interface Fixture {
  preset: { id: string; name: string };
  persona: { id: string; name: string };
  card: { id: string; name: string };
  book: FloorBook;
}

/** What of Lumiverse's client the fixture uses. */
export type FixtureHost = Pick<Lumiverse, "call" | "bookEntries" | "createEntry" | "createChat" | "deleteChat">;

/** The fixture's record: the id of each thing setup made or went on with, by kind. `removeFixture` deletes only what it lists. */
export interface FixtureRecord {
  presets: string[];
  personas: string[];
  books: string[];
  cards: string[];
  chats: string[];
}

/** Where the fixture's record is kept. */
export interface RecordStore {
  read(): FixtureRecord;
  write(record: FixtureRecord): void;
}

const KINDS = ["presets", "personas", "books", "cards", "chats"] as const;

/** The fixture's record in a file of the scripts' own folder (`LRE_INSTANCE_DIR`), as JSON; empty while there is none. */
export function fileRecord(path: string): RecordStore {
  return {
    read: () => {
      const empty: FixtureRecord = { presets: [], personas: [], books: [], cards: [], chats: [] };
      if (!existsSync(path)) return empty;
      const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
      if (!isRecord(raw)) throw new Error(`${path} is not the floor fixture's record`);
      for (const kind of KINDS) {
        const ids = raw[kind];
        if (ids !== undefined && !(Array.isArray(ids) && ids.every((id) => typeof id === "string"))) throw new Error(`${path} gives its ${kind} as something other than a list of ids`);
        empty[kind] = [...((ids as string[] | undefined) ?? [])];
      }
      return empty;
    },
    write: (record) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
    },
  };
}

/** The record's file in an instance's folder. */
export const RECORD_FILE = "floor-fixture.json";

/** The fixture's record the environment points at (`LRE_INSTANCE_DIR`), where that folder holds one; null where it names none or holds none, and the fixture is then found by its mark alone (the rig's stand-in holds none). */
export function recordOfEnv(env: Record<string, string | undefined>): FixtureRecord | null {
  const dir = env.LRE_INSTANCE_DIR?.trim();
  if (!dir) return null;
  const path = join(dir, RECORD_FILE);
  return existsSync(path) ? fileRecord(path).read() : null;
}

export type Row = { id: string; name: string; metadata?: unknown; extensions?: unknown };

/** Every row of a paged list route (`{ data, total }`, or a bare array). */
async function every(host: FixtureHost, path: string): Promise<Row[]> {
  const out: Row[] = [];
  const join = path.includes("?") ? "&" : "?";
  for (let offset = 0; ; offset += 100) {
    const page = await host.call<{ data: Row[]; total: number } | Row[]>("GET", `${path}${join}limit=100&offset=${offset}`);
    if (Array.isArray(page)) return page;
    out.push(...page.data);
    if (page.data.length < 100 || out.length >= page.total) return out;
  }
}

const isMarked = (row: Row, where: "metadata" | "extensions"): boolean => isRecord(row[where]) && (row[where] as Record<string, unknown>)[MARK] === true;

/** The rows of a list route that carry the mark: in their metadata, or for cards (whose list rows hold their extensions: Lumiverse `src/services/characters.service.ts:728-736`) in their extensions. */
export async function marked(host: FixtureHost, path: string, where: "metadata" | "extensions" = "metadata"): Promise<Row[]> {
  return (await every(host, path)).filter((row) => isMarked(row, where));
}

export const CARDS = "/api/v1/characters";
export const BOOKS = "/api/v1/world-books";

/** The marked rows of a list route whose ids the fixture's record lists: a thing that only carries the mark is not the fixture's. */
export async function listed(host: FixtureHost, path: string, ids: readonly string[], where: "metadata" | "extensions" = "metadata"): Promise<Row[]> {
  return (await marked(host, path, where)).filter((row) => ids.includes(row.id));
}

/** The fixture `setupFixture` made, found by the record's ids where one is given, else by its mark; throws when any of it is missing, doubled, or not as designed. */
export async function findFixture(host: FixtureHost, record: FixtureRecord | null): Promise<Fixture> {
  const [presets, personas, cards, books] = await Promise.all(
    record === null ? [marked(host, "/api/v1/presets"), marked(host, "/api/v1/personas"), marked(host, CARDS, "extensions"), marked(host, BOOKS)] : [listed(host, "/api/v1/presets", record.presets), listed(host, "/api/v1/personas", record.personas), listed(host, CARDS, record.cards, "extensions"), listed(host, BOOKS, record.books)],
  );
  const [preset, persona, card, book] = [presets[0], personas[0], cards[0], books[0]];
  if (presets.length !== 1 || personas.length !== 1 || cards.length !== 1 || books.length !== 1 || !preset || !persona || !card || !book) {
    throw new Error(`the floor fixture has ${presets.length} preset(s), ${personas.length} persona(s), ${cards.length} card(s) and ${books.length} book(s), not one of each: run floor.ts setup (or remove, then setup)`);
  }
  if (!cardBooks(card.extensions).includes(book.id)) throw new Error(`the floor's card "${card.name}" does not hold its book "${book.name}": run floor.ts setup`);
  const read = readBook(await host.bookEntries(book.id));
  const missing = read.notMade.filter((d) => d.kind !== "vector").map((d) => `"${d.title}" is not there`);
  if (read.faults.length > 0 || missing.length > 0) throw new Error(`the floor's book "${book.name}" is not as designed: ${[...read.faults, ...missing].join("; ")}. Run floor.ts remove, then setup`);
  const vectorBlockers = embeddingBlockers(await host.call("GET", "/api/v1/embeddings/config"));
  return {
    preset: { id: preset.id, name: preset.name },
    persona: { id: persona.id, name: persona.name },
    card: { id: card.id, name: card.name },
    book: { id: book.id, name: book.name, entries: read.made, vectorBlockers },
  };
}

/**
 * Sets the plain connection's own reasoning binding to `effort` (`thinkingMetadata`), keeping all else
 * of the connection, and says what it set. Lumiverse replaces a connection's metadata whole on
 * `PUT /api/v1/connections/:id` (`src/services/connections.service.ts:517`), so the whole object is sent;
 * the global setting is read from `GET /api/v1/settings/reasoningSettings`, a 404 when the user has none
 * (`src/routes/settings.routes.ts:20-25`).
 */
export async function setPlainThinking(host: FixtureHost, connectionId: string, effort: string): Promise<string> {
  const connection = await host.call<{ id: string; name: string; metadata?: unknown }>("GET", `/api/v1/connections/${encodeURIComponent(connectionId)}`);
  let global: unknown = null;
  try {
    global = (await host.call<{ value?: unknown }>("GET", "/api/v1/settings/reasoningSettings")).value ?? null;
  } catch (error) {
    if (!(error instanceof HttpError && error.status === 404)) throw error;
  }
  const next = thinkingMetadata(connection.metadata, global, effort);
  await host.call("PUT", `/api/v1/connections/${encodeURIComponent(connectionId)}`, { metadata: next.metadata });
  const rest = next.from === "connection" ? "the rest of its binding as it was" : next.from === "global" ? "the rest copied from the user's global reasoning setting, which applied to it before" : "the user has no global reasoning setting, so nothing else is set";
  return `connection "${connection.name}": ${effort === "off" ? "reasoning off" : `reasoning on at ${effort}`}, on its own reasoning binding (${rest})`;
}

/**
 * Makes what is missing of the fixture and a new floor chat, sets the plain connection to think at
 * `effort` (the Author's, as `authorEffort` read it; setup never chooses one), and gives the fixture as
 * `findFixture` then finds it, with the chat's id and the lines to print. Setup adopts nothing: a thing
 * is gone on with only where the fixture's record lists its id, and a marked thing it does not list (a
 * user's card of the floor's name that took the mark) is left alone, setup making its own beside it.
 * Each thing it made or went on with is listed in the fixture's record.
 */
export async function setupFixture(host: FixtureHost, effort: string, plainConnectionId: string, store: RecordStore): Promise<{ fixture: Fixture; chat: string; lines: string[] }> {
  // Refused before anything is made: an effort no definition takes is never set in its place.
  if (!isEffort(effort)) throw new Error(`"${effort}" is not an effort an agent definition takes (${Object.keys(EFFORTS).join(", ")})`);
  const record = store.read();
  const [presets, personas, cards, books] = await Promise.all([listed(host, "/api/v1/presets", record.presets), listed(host, "/api/v1/personas", record.personas), listed(host, CARDS, record.cards, "extensions"), listed(host, BOOKS, record.books)]);
  if (presets.length > 1 || personas.length > 1 || cards.length > 1 || books.length > 1) throw new Error(`${presets.length} floor presets, ${personas.length} personas, ${cards.length} cards and ${books.length} books the record lists: run floor.ts remove first`);
  const keep = (kind: (typeof KINDS)[number], id: string) => {
    if (!record[kind].includes(id)) record[kind].push(id);
    store.write(record);
  };
  const was = (found: unknown) => (found ? "already there, carrying the floor's mark" : "made");
  const preset = presets[0] ?? (await host.call<Row>("POST", "/api/v1/presets", PRESET));
  keep("presets", preset.id);
  const persona = personas[0] ?? (await host.call<Row>("POST", "/api/v1/personas", PERSONA));
  keep("personas", persona.id);
  const book = books[0] ?? (await host.call<Row>("POST", BOOKS, bookBody()));
  keep("books", book.id);

  const blockers = embeddingBlockers(await host.call("GET", "/api/v1/embeddings/config"));
  const read = readBook(await host.bookEntries(book.id));
  if (read.faults.length > 0) throw new Error(`the floor's book "${book.name}" is not as designed: ${read.faults.join("; ")}. Run floor.ts remove first`);
  const making = entriesToMake(read.notMade, blockers);
  const entryLines: string[] = [];
  for (const d of LORE) {
    const how = d.kind === "constant" ? "constant" : d.kind === "keyword" ? `by keyword: ${d.keys.join(", ")}` : d.kind === "sticky" ? `by keyword: ${d.keys.join(", ")}, then still sticky for ${d.sticky} more generations` : "by vector search only";
    let state: string;
    if (!read.notMade.includes(d)) state = d.kind === "vector" && blockers.length > 0 ? `already there, and Lumiverse would not search it now: ${blockers.join("; ")}` : "already there";
    else if (making.includes(d)) {
      const made = await host.createEntry(book.id, entryBody(d));
      state = d.kind === "vector" ? `made; Lumiverse is indexing it (${String(made.vector_index_status)}), and searches it once it is indexed` : "made";
    } else state = `not made, since Lumiverse has no embedding connection it can search with: ${blockers.join("; ")}. Set one up in Lumiverse, then run floor.ts setup again to add it`;
    entryLines.push(`           "${d.title}" (${how}): ${state}`);
  }

  const card = cards[0] ?? (await host.call<Row>("POST", CARDS, { ...CARD, extensions: markedCard({}, book.id) }));
  keep("cards", card.id);
  const extensions = markedCard(card.extensions, book.id);
  if (extensions !== null) await host.call("PUT", `${CARDS}/${card.id}`, { extensions });

  const chat = await host.createChat(card.id, CHAT_NAME);
  keep("chats", chat.id);
  const plain = await setPlainThinking(host, plainConnectionId, effort);
  const fixture = await findFixture(host, record);
  const lines = [
    `card     ${card.id} "${card.name}" (${was(cards[0])}), holding the book`,
    `persona  ${persona.id} "${persona.name}" (${was(personas[0])}): the traveller of the card's scenario; not made default or active`,
    `preset   ${preset.id} "${preset.name}" (${was(presets[0])}): ${PRESET.prompt_order.map((b) => b.name).join(", ")}; third person, past tense, 120 to 200 words, names nobody; not made active`,
    `book     ${book.id} "${book.name}" (${was(books[0])}), attached to the card:`,
    ...entryLines,
    `plain    ${plain}`,
    `chat     ${chat.id} "${CHAT_NAME}"`,
    "",
    "The floor sends each line through Lumiverse's chat page, by the host's send, naming this preset and persona to the page;",
    "setup made neither active. Each thing above is listed in the fixture's record, and floor.ts remove deletes only what it lists.",
  ];
  return { fixture, chat: chat.id, lines };
}

/** Whether a row is still there: a 404 says it is gone. */
async function stillThere<T>(host: FixtureHost, path: string): Promise<T | null> {
  try {
    return await host.call<T>("GET", path);
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return null;
    throw error;
  }
}

/**
 * Deletes only what the fixture's record lists: its chats; its card when no other chat uses it (else
 * takes the floor's book off it and keeps it listed); its preset, persona and book. Gives the lines to
 * print, one for each thing deleted or kept, and names any marked thing the record does not list, which
 * it leaves.
 */
export async function removeFixture(host: FixtureHost, env: TestbedEnv, store: RecordStore): Promise<string[]> {
  const record = store.read();
  const lines: string[] = [];
  const left: FixtureRecord = { presets: [], personas: [], books: [], cards: [], chats: [] };
  for (const id of record.chats) {
    if ((await stillThere(host, `/api/v1/chats/${encodeURIComponent(id)}`)) === null) continue;
    await host.deleteChat(guard(env, id));
    lines.push(`deleted chat ${id}`);
  }
  for (const id of record.cards) {
    const card = await stillThere<Row>(host, `${CARDS}/${encodeURIComponent(id)}`);
    if (card === null) continue;
    const chats = await every(host, `/api/v1/chats?characterId=${encodeURIComponent(id)}`);
    if (chats.length > 0) {
      const extensions = detachBooks(card.extensions, record.books);
      if (extensions !== null) await host.call("PUT", `${CARDS}/${id}`, { extensions });
      left.cards.push(id);
      lines.push(`kept card ${id} "${card.name}": ${chats.length} chat(s) the record does not list use it${extensions !== null ? "; the floor's book is taken off it" : ""}`);
    } else {
      await host.call("DELETE", `${CARDS}/${id}`);
      lines.push(`deleted card ${id} "${card.name}"`);
    }
  }
  for (const [kind, path] of [
    ["presets", "/api/v1/presets"],
    ["personas", "/api/v1/personas"],
    ["books", BOOKS],
  ] as const) {
    for (const id of record[kind]) {
      const row = await stillThere<Row>(host, `${path}/${encodeURIComponent(id)}`);
      if (row === null) continue;
      await host.call("DELETE", `${path}/${id}`);
      lines.push(`deleted ${kind.slice(0, -1)} ${id} "${row.name}"`);
    }
  }
  store.write(left);
  const listed = new Set(KINDS.flatMap((kind) => record[kind]));
  const [presets, personas, cards, books] = await Promise.all([marked(host, "/api/v1/presets"), marked(host, "/api/v1/personas"), marked(host, CARDS, "extensions"), marked(host, BOOKS)]);
  for (const row of [...presets, ...personas, ...cards, ...books]) if (!listed.has(row.id)) lines.push(`left ${row.id} "${row.name}": it carries the floor's mark, and the fixture's record does not list it`);
  return lines;
}
