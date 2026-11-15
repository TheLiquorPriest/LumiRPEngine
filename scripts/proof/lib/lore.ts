// The floor's row "Activated lore: every activated entry appears in the lore map" (STANDALONE-PLAN
// §17.1 l.1765; PlanGates-4-fix1 item 10), for the floor's script to call. Pure: what Lumiverse and RPE
// answered for each RPE turn goes in; a verdict, every activated entry missing from its turn's map, a
// count by how each entry came in, and plain words come out. `compareLore` reads one turn; `loreFold`
// reads the run (every RPE turn must pass) and, given the floor's book as `findFixture` found it, says
// which of the book's entries Lumiverse did not activate on a line it was made to activate on ("not
// played", never a pass), and how the vector kind stood ("not played: no embeddings connection",
// "pending"), so a run whose book activated nothing is never taken for a pass of empty lists.
//
// Shapes, and where each was taken from:
// - What Lumiverse activated is its own account: each generation's `WORLD_INFO_ACTIVATED` event
//   (Lumiverse `src/services/generate.service.ts:2868-2879`, entries `ActivatedWorldInfoEntry`,
//   `src/llm/types.ts:416-433`), heard on the socket the play reads, never RPE's record of the tag.
//   It says keyword or vector and nothing else (plan §4.2 l.216). Lumiverse sends the event only when
//   something activated: the prompt's assembly gives `activatedWorldInfo` as undefined for an empty
//   list (`src/services/prompt-assembly.service.ts:4455-4456`) and the send is guarded by it
//   (`src/services/generate.service.ts:2869`), whatever the comment above it says of always emitting.
//   So no event heard for a generation is not "nothing activated": the floor's book holds a constant
//   entry that activates on every line, so a generation with none heard lost the event or the
//   constant did not activate, and that turn is not judged ("the event was not heard"), never judged
//   on an empty list. The floor's own entries stay "not played" where a heard event lacks one made to
//   activate on its line.
// - `TurnDetail.lore.map` (RPE `src/ui/api.ts`): the lore-map ids (`e-112`) the Author's map showed.
// - A turn's activated lore as RPE's lore route serves it: `LoreEntry` (`./read.ts`, the lead's ruling of
//   PlanLore-13's route, 15 Nov), each entry with its lore-map id, Lumiverse's entry and book ids, its
//   title, and how it came in where the tag says.
// - How an entry comes in (plan §4.2 l.216, READINGS N-5): constant, keyword, vector, or still sticky
//   from an earlier turn, in the lore area's own four words (RPE `src/lore/lore.ts:80-81`).
// - The vector kind with no embeddings connection (READINGS N-21): "not played: no embeddings
//   connection", by name, in every report; a vector entry made and not yet indexed: "pending".

import type { LoreEntry } from "./read";

/** How an activated entry came into the prompt, in the lore area's four words. */
export type LoreHow = NonNullable<LoreEntry["how"]>;

/** The four, in the order every count and every line gives them. */
export const HOWS: readonly LoreHow[] = ["constant", "keyword", "vector", "sticky"];

/** One entry Lumiverse says it activated for a generation (its `WORLD_INFO_ACTIVATED` event). */
export interface ActivatedEntry {
  id: string;
  book: string | null;
  title: string;
  source: "keyword" | "vector";
}

/** Activated entries by how they came in: by the route's word, `unsaid` where the route gives none, `unlisted` where the route does not list the entry at all. */
export type HowCount = Record<LoreHow | "unsaid" | "unlisted", number>;

/** One entry Lumiverse activated for the turn: the lore route's first listing of it (null: not listed), and whether its turn's map shows it. */
export interface ActivatedSeen {
  entry: string;
  listed: LoreEntry | null;
  inMap: boolean;
}

/** An activated entry the turn's lore map does not show. */
export interface MissingEntry {
  /** Lumiverse's id of the entry. */
  entry: string;
  /** Its title: the lore route's, else Lumiverse's own. */
  title: string;
  book: string | null;
  /** Its lore-map id; null where it has none. */
  id: string | null;
  /** How it came in: the route's word, else Lumiverse's own (keyword or vector). */
  how: LoreHow | null;
  /** Whether the lore route lists it at all. */
  listed: boolean;
}

/** One RPE turn's reading. */
export interface LoreVerdict {
  pass: boolean;
  words: string;
  /** Each entry Lumiverse activated, once, in the order of its event. */
  activated: ActivatedSeen[];
  missing: MissingEntry[];
  /** Entries the lore route lists that Lumiverse's event does not hold: two accounts of one prompt that disagree, so the turn cannot pass. */
  unmatched: LoreEntry[];
  hows: HowCount;
}

/** An entry the floor's book was made with: Lumiverse's id for it, its title, how it was made to come in, and the floor's lines it was made to activate on. */
export interface PlannedEntry {
  entry: string;
  title: string;
  kind: LoreHow;
  lines: readonly number[];
  /** Lumiverse's index state of a vector entry (`vector_index_status`); absent for the others. */
  vectorIndex?: string | null;
}

/** The floor's book as `findFixture` found it (`Fixture.book`): its id and name, each entry it holds, and why Lumiverse would not search a vector entry now (empty when it would). */
export interface BookDesign {
  id: string;
  name: string;
  entries: readonly PlannedEntry[];
  vectorBlockers: readonly string[];
}

/** One RPE turn as the run gives it to the fold: the floor's line it played, its reading, or why there is none. */
export interface LoreTurn {
  turn: string;
  line: number;
  verdict: LoreVerdict | null;
  why: string | null;
}

/** The row, in the floor table's terms. */
export interface LoreRow {
  verdict: "pass" | "fail" | "not judged";
  measured: string;
  notes: string[];
  /** Why it is not judged; empty when it is judged. */
  why: string[];
}

function noHows(): HowCount {
  return { constant: 0, keyword: 0, vector: 0, sticky: 0, unsaid: 0, unlisted: 0 };
}

/** How an entry came in, as words that follow "came in". */
const CAME_IN: Readonly<Record<LoreHow, string>> = { constant: "as a constant", keyword: "by keyword", vector: "by vector search", sticky: "still sticky from an earlier turn" };

/** How an entry was made to come in, as words that follow "made to". */
const MADE_TO: Readonly<Record<LoreHow, string>> = { constant: "be constant", keyword: "come in by keyword", vector: "come in by vector search", sticky: "stay by its sticky count" };

const entries = (n: number): string => (n === 1 ? "entry" : "entries");
const turns = (n: number): string => `${n} ${n === 1 ? "turn" : "turns"}`;

/** The counts that are not zero, in a fixed order: "2 constant, 1 sticky, 1 with how not said". */
export function howsText(hows: HowCount): string {
  const parts = HOWS.filter((how) => hows[how] > 0).map((how) => `${hows[how]} ${how}`);
  if (hows.unsaid > 0) parts.push(`${hows.unsaid} with how not said`);
  if (hows.unlisted > 0) parts.push(`${hows.unlisted} not listed by the lore route`);
  return parts.join(", ");
}

function describeMissing(m: MissingEntry): string {
  const said = `"${m.title}" (book ${m.book ?? "not said"}, Lumiverse entry ${m.entry}, came in ${m.how === null ? "in a way neither account says" : CAME_IN[m.how]})`;
  if (!m.listed) return `${said}: the lore route does not list it, so it has no lore-map id`;
  return m.id === null ? `${said}: it has no lore-map id` : `${said}: its lore-map id ${m.id} is not in the map`;
}

/**
 * One turn: it passes when every entry Lumiverse's own event says it activated has a lore-map id, given
 * by the lore route, that the turn's lore map shows, and the route lists no entry the event lacks. An
 * entry the route lists twice passes when either of its ids is in the map.
 */
export function compareLore(input: { lumiverse: readonly ActivatedEntry[]; map: readonly string[]; entries: readonly LoreEntry[] }): LoreVerdict {
  const said = new Map<string, ActivatedEntry>();
  for (const e of input.lumiverse) if (!said.has(e.id)) said.set(e.id, e);
  const inMap = new Set(input.map);
  const listed = new Map<string, LoreEntry[]>();
  for (const e of input.entries) listed.set(e.entry, [...(listed.get(e.entry) ?? []), e]);
  const hows = noHows();
  const activated: ActivatedSeen[] = [];
  const missing: MissingEntry[] = [];
  for (const [id, event] of said) {
    const as = listed.get(id) ?? [];
    const first = as[0] ?? null;
    const shown = as.some((e) => e.id !== "" && inMap.has(e.id));
    hows[first === null ? "unlisted" : (first.how ?? "unsaid")]++;
    activated.push({ entry: id, listed: first, inMap: shown });
    if (!shown) missing.push({ entry: id, title: first?.title ?? event.title, book: first?.book ?? event.book, id: first === null || first.id === "" ? null : first.id, how: first?.how ?? event.source, listed: first !== null });
  }
  const unmatched = input.entries.filter((e) => !said.has(e.entry));
  const pass = missing.length === 0 && unmatched.length === 0;
  const count = said.size;
  let words: string;
  if (pass) words = count === 0 ? "Lumiverse activated no entry for this turn's prompt." : `All ${count} activated ${entries(count)} ${count === 1 ? "is" : "are"} in the lore map (${howsText(hows)}).`;
  else {
    const parts: string[] = [];
    if (missing.length > 0) parts.push(`${missing.length} of ${count} activated ${entries(count)} ${missing.length === 1 ? "is" : "are"} not in the lore map: ${missing.map(describeMissing).join("; ")}.`);
    if (unmatched.length > 0) parts.push(`The lore route lists ${unmatched.length} ${entries(unmatched.length)} Lumiverse's event does not hold, so the two disagree about what activated: ${unmatched.map((e) => `"${e.title}" (Lumiverse entry ${e.entry}, lore-map id ${e.id === "" ? "none" : e.id})`).join("; ")}.`);
    words = parts.join(" ");
  }
  return { pass, words, activated, missing, unmatched, hows };
}

/** What the run shows of the floor's book: lines for the table, and each entry not played on a line it was made to activate on. */
function bookLines(book: BookDesign, judged: readonly { turn: string; line: number; verdict: LoreVerdict }[]): { lines: string[]; notPlayed: string[]; vector: string } {
  const seen = book.entries.map((p) => {
    const hows = noHows();
    let inTurns = 0;
    for (const { verdict } of judged) {
      const found = verdict.activated.find((a) => a.entry === p.entry);
      if (found === undefined) continue;
      inTurns++;
      hows[found.listed === null ? "unlisted" : (found.listed.how ?? "unsaid")]++;
    }
    return { ...p, inTurns, hows };
  });
  const lines: string[] = [];
  const notPlayed: string[] = [];
  for (const p of book.entries) {
    for (const { line, verdict } of judged) {
      if (p.lines.includes(line) && !verdict.activated.some((a) => a.entry === p.entry)) notPlayed.push(`not played: "${p.title}" (${p.kind}) on line ${line}`);
    }
  }
  const vectorMade = book.entries.find((p) => p.kind === "vector");
  let vector: string;
  if (book.vectorBlockers.length > 0) vector = `vector: not played: no embeddings connection (${book.vectorBlockers.join("; ")})`;
  else if (vectorMade === undefined) vector = "vector: not played: the book holds no vector entry";
  else if (vectorMade.vectorIndex !== "indexed") vector = `vector: pending ("${vectorMade.title}" is ${vectorMade.vectorIndex ?? "not said"} in Lumiverse's index, so its vector search cannot find it yet)`;
  else {
    const turnsIn = seen.find((s) => s.entry === vectorMade.entry)?.inTurns ?? 0;
    vector = turnsIn > 0 ? `vector: "${vectorMade.title}" activated in ${turns(turnsIn)}` : `vector: not played: Lumiverse's vector search activated "${vectorMade.title}" on no RPE line`;
    if (turnsIn === 0) notPlayed.push(`not played: "${vectorMade.title}" (vector) on no RPE line`);
  }
  const notAsMade = seen.filter((s) => s.inTurns > 0 && s.hows[s.kind] === 0);
  for (const s of notAsMade) lines.push(`"${s.title}" of the floor's book was made to ${MADE_TO[s.kind]}; it activated in ${turns(s.inTurns)} and never came in ${CAME_IN[s.kind]} (${howsText(s.hows)}).`);
  if (notPlayed.length === 0 && notAsMade.length === 0 && seen.length > 0) lines.push(`Every entry of the floor's book "${book.name}" activated on the lines it was made for and came in as it was made to: ${seen.map((s) => `"${s.title}" ${CAME_IN[s.kind]} in ${turns(s.hows[s.kind])}`).join(", ")}.`);
  return { lines, notPlayed, vector };
}

/**
 * The row over a run. A failing turn fails it, each listed with every entry it misses and how that
 * entry came in. Otherwise it is not judged while any turn has no reading (each named with why), when
 * no RPE turn was played, when no entry activated in any turn, or when an entry of the floor's book was
 * not played on a line it was made to activate on; it passes when every turn passed and every entry
 * played. The vector kind is always said: not played for want of an embeddings connection, pending, or
 * how often it came in.
 */
export function loreFold(run: readonly LoreTurn[], design?: BookDesign): LoreRow {
  const judged = run.flatMap((t) => (t.verdict === null ? [] : [{ turn: t.turn, line: t.line, verdict: t.verdict }]));
  const unjudged = run.filter((t) => t.verdict === null);
  const failing = judged.filter((t) => !t.verdict.pass);
  const hows = noHows();
  for (const { verdict } of judged) for (const key of Object.keys(hows) as (keyof HowCount)[]) hows[key] += verdict.hows[key];
  const activated = judged.reduce((sum, t) => sum + t.verdict.activated.length, 0);
  const notes = ["An RPE turn passes when every entry Lumiverse's own WORLD_INFO_ACTIVATED event names for it has a lore-map id, given by RPE's lore route, that the turn's lore map shows; every RPE turn must pass."];
  notes.push(...failing.map((t) => `Turn ${t.turn} failed: ${t.verdict.words}`));
  notes.push(...unjudged.map((t) => `Turn ${t.turn} was not judged: ${t.why ?? "no reason was given"}.`));
  const book = design === undefined ? null : bookLines(design, judged);
  if (book !== null) notes.push(...book.lines, ...book.notPlayed.map((n) => `${n}.`), `${book.vector}.`);
  const why: string[] = [];
  let verdict: LoreRow["verdict"];
  if (failing.length > 0) verdict = "fail";
  else {
    if (run.length === 0) why.push("no RPE turn was played");
    if (unjudged.length > 0) why.push(`${unjudged.length} RPE turn(s) not judged: ${unjudged.map((t) => `turn ${t.turn}: ${t.why ?? "no reason was given"}`).join("; ")}`);
    if (judged.length > 0 && activated === 0) why.push("Lumiverse activated no entry in any turn, so nothing was there to find in a lore map");
    if (book !== null && book.notPlayed.length > 0) why.push(`entries of the floor's book not played: ${book.notPlayed.map((n) => n.replace(/^not played: /, "")).join("; ")}`);
    verdict = why.length > 0 ? "not judged" : "pass";
  }
  const measured =
    run.length === 0
      ? `No RPE turn was played.${book === null ? "" : ` ${book.vector}.`}`
      : `${judged.length - failing.length} of ${turns(run.length)} with every activated entry in the lore map${failing.length > 0 ? `, ${failing.length} failed` : ""}${unjudged.length > 0 ? `, ${unjudged.length} not judged` : ""}; ${activated} activated ${entries(activated)} in the turns judged${activated > 0 ? ` (${howsText(hows)})` : ""}.${book === null ? "" : ` ${book.vector}.`}`;
  return { verdict, measured, notes, why };
}
