// The floor's row "Activated lore: every activated entry appears in the lore map" (STANDALONE-PLAN
// §17.1 l.1765), for the floor's script to call. Pure: what RPE's routes answered for each RPE turn
// goes in; a verdict, every activated entry missing from its turn's map, a count by how each entry came
// in, and plain words come out. `compareLore` reads one turn; `loreFold` reads the run (every RPE turn
// must pass) and, given the floor's book as `findFixture` found it, says which of the book's entries
// never activated or never came in the way they were made to, so a run whose book activated nothing is
// never taken for a pass of empty lists.
//
// Shapes, and where each was taken from:
// - `TurnDetail.lore` (RPE `src/ui/api.ts:187-188`): `activated` holds Lumiverse's ids of the entries it
//   activated for the turn's prompt; `map` holds the lore-map ids (`e-112`) the Author's map showed.
// - A turn's activated lore as RPE's lore route serves it: `LoreEntry` (`./read.ts`, the lead's ruling of
//   PlanLore-13's route, 15 Nov), each entry with its lore-map id, Lumiverse's entry and book ids, its
//   title, and how it came in where the tag says.
// - How an entry comes in (plan §4.2 l.216, READINGS N-5): constant, keyword, vector, or still sticky
//   from an earlier turn, in the lore area's own four words (RPE `src/lore/lore.ts:80-81`).

import type { LoreEntry } from "./read";

/** How an activated entry came into the prompt, in the lore area's four words. */
export type LoreHow = NonNullable<LoreEntry["how"]>;

/** The four, in the order every count and every line gives them. */
export const HOWS: readonly LoreHow[] = ["constant", "keyword", "vector", "sticky"];

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
  /** As the lore route lists it; null where the route does not list it. */
  title: string | null;
  book: string | null;
  /** Its lore-map id; null where it has none. */
  id: string | null;
  /** How the route says it came in; null where the route does not say or does not list it. */
  how: LoreHow | null;
  /** Whether the lore route lists it at all. */
  listed: boolean;
}

/** One RPE turn's reading. */
export interface LoreVerdict {
  pass: boolean;
  words: string;
  /** Each entry Lumiverse activated, once, in the order of its list. */
  activated: ActivatedSeen[];
  missing: MissingEntry[];
  /** Entries the lore route lists that the turn's activated list does not hold: two accounts of one prompt that disagree, so the turn cannot pass. */
  unmatched: LoreEntry[];
  hows: HowCount;
}

/** An entry the floor's book was made with: Lumiverse's id for it, its title, and how it was made to come in. */
export interface PlannedEntry {
  entry: string;
  title: string;
  kind: LoreHow;
}

/** The floor's book as `findFixture` found it (`Fixture.book`): its id and name, and each entry it holds. */
export interface BookDesign {
  id: string;
  name: string;
  entries: readonly PlannedEntry[];
}

/** One RPE turn as the run gives it to the fold: its reading, or why there is none. */
export interface LoreTurn {
  turn: string;
  verdict: LoreVerdict | null;
  why: string | null;
}

/** The row, in the floor table's terms. */
export interface LoreRow {
  verdict: "pass" | "fail" | "not judged";
  measured: string;
  notes: string[];
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
  if (!m.listed) return `Lumiverse entry ${m.entry}: the lore route does not list it, so it has no lore-map id`;
  const said = `"${m.title}" (book ${m.book}, Lumiverse entry ${m.entry}, came in ${m.how === null ? "in a way the tag does not say" : CAME_IN[m.how]})`;
  return m.id === null ? `${said}: it has no lore-map id` : `${said}: its lore-map id ${m.id} is not in the map`;
}

/**
 * One turn: it passes when every entry Lumiverse activated for it has a lore-map id, given by the lore
 * route, that its lore map shows, and the route lists no entry the turn's activated list lacks. An
 * entry the route lists twice passes when either of its ids is in the map.
 */
export function compareLore(input: { activated: readonly string[]; map: readonly string[]; entries: readonly LoreEntry[] }): LoreVerdict {
  const ids = [...new Set(input.activated)];
  const inMap = new Set(input.map);
  const listed = new Map<string, LoreEntry[]>();
  for (const e of input.entries) listed.set(e.entry, [...(listed.get(e.entry) ?? []), e]);
  const hows = noHows();
  const activated: ActivatedSeen[] = [];
  const missing: MissingEntry[] = [];
  for (const id of ids) {
    const as = listed.get(id) ?? [];
    const first = as[0] ?? null;
    const shown = as.some((e) => e.id !== "" && inMap.has(e.id));
    hows[first === null ? "unlisted" : (first.how ?? "unsaid")]++;
    activated.push({ entry: id, listed: first, inMap: shown });
    if (!shown) missing.push(first === null ? { entry: id, title: null, book: null, id: null, how: null, listed: false } : { entry: id, title: first.title, book: first.book, id: first.id === "" ? null : first.id, how: first.how, listed: true });
  }
  const wanted = new Set(ids);
  const unmatched = input.entries.filter((e) => !wanted.has(e.entry));
  const pass = missing.length === 0 && unmatched.length === 0;
  let words: string;
  if (pass) words = ids.length === 0 ? "Lumiverse activated no entry for this turn's prompt." : `All ${ids.length} activated ${entries(ids.length)} ${ids.length === 1 ? "is" : "are"} in the lore map (${howsText(hows)}).`;
  else {
    const parts: string[] = [];
    if (missing.length > 0) parts.push(`${missing.length} of ${ids.length} activated ${entries(ids.length)} ${missing.length === 1 ? "is" : "are"} not in the lore map: ${missing.map(describeMissing).join("; ")}.`);
    if (unmatched.length > 0) parts.push(`The lore route lists ${unmatched.length} ${entries(unmatched.length)} the turn's activated list does not hold, so the two disagree about what activated: ${unmatched.map((e) => `"${e.title}" (Lumiverse entry ${e.entry}, lore-map id ${e.id === "" ? "none" : e.id})`).join("; ")}.`);
    words = parts.join(" ");
  }
  return { pass, words, activated, missing, unmatched, hows };
}

/** What the run shows of the floor's book: one line, and whether any of its entries activated at all. */
function bookLines(book: BookDesign, judged: readonly { turn: string; verdict: LoreVerdict }[]): { lines: string[]; anyActivated: boolean } {
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
  if (seen.length === 0) return { lines: [`The floor's book "${book.name}" holds no entries, so none was made to activate.`], anyActivated: false };
  const never = seen.filter((s) => s.inTurns === 0);
  const notAsMade = seen.filter((s) => s.inTurns > 0 && s.hows[s.kind] === 0);
  const lines: string[] = [];
  if (never.length === 0 && notAsMade.length === 0) lines.push(`Every entry of the floor's book "${book.name}" came in as it was made to: ${seen.map((s) => `"${s.title}" ${CAME_IN[s.kind]} in ${turns(s.hows[s.kind])}`).join(", ")}.`);
  if (never.length > 0) lines.push(`Of the floor's book "${book.name}", never activated: ${never.map((s) => `"${s.title}" (made to ${MADE_TO[s.kind]})`).join(", ")}.`);
  for (const s of notAsMade) lines.push(`"${s.title}" of the floor's book was made to ${MADE_TO[s.kind]}; it activated in ${turns(s.inTurns)} and never came in ${CAME_IN[s.kind]} (${howsText(s.hows)}).`);
  return { lines, anyActivated: never.length < seen.length };
}

/**
 * The row over a run. A failing turn fails it, each listed with every entry it misses and how that
 * entry came in. Otherwise it is not judged while any turn has no reading (each named with why), when
 * no RPE turn was played, when no entry activated in any turn, or when the floor's book was given and
 * none of its entries activated; it passes when every turn passed. The book's entries that never
 * activated, or never came in the way they were made to, are in the notes whatever the verdict.
 */
export function loreFold(run: readonly LoreTurn[], design?: BookDesign): LoreRow {
  const judged = run.flatMap((t) => (t.verdict === null ? [] : [{ turn: t.turn, verdict: t.verdict }]));
  const unjudged = run.filter((t) => t.verdict === null);
  const failing = judged.filter((t) => !t.verdict.pass);
  const hows = noHows();
  for (const { verdict } of judged) for (const key of Object.keys(hows) as (keyof HowCount)[]) hows[key] += verdict.hows[key];
  const activated = judged.reduce((sum, t) => sum + t.verdict.activated.length, 0);
  const notes = ["An RPE turn passes when every entry Lumiverse activated for it has a lore-map id, given by RPE's lore route, that the turn's lore map shows; every RPE turn must pass."];
  notes.push(...failing.map((t) => `Turn ${t.turn} failed: ${t.verdict.words}`));
  notes.push(...unjudged.map((t) => `Turn ${t.turn} was not judged: ${t.why ?? "no reason was given"}.`));
  const book = design === undefined ? null : bookLines(design, judged);
  if (book !== null) notes.push(...book.lines);
  let verdict: LoreRow["verdict"];
  if (failing.length > 0) verdict = "fail";
  else if (unjudged.length > 0 || judged.length === 0) verdict = "not judged";
  else if (activated === 0) {
    verdict = "not judged";
    notes.push("Lumiverse activated no entry in any turn, so nothing was there to find in a lore map.");
  } else if (book !== null && !book.anyActivated) {
    verdict = "not judged";
    notes.push("None of the floor's book's entries activated, so the ways an entry comes in were not tried.");
  } else verdict = "pass";
  const measured =
    run.length === 0
      ? "No RPE turn was played."
      : `${judged.length - failing.length} of ${turns(run.length)} with every activated entry in the lore map${failing.length > 0 ? `, ${failing.length} failed` : ""}${unjudged.length > 0 ? `, ${unjudged.length} not judged` : ""}; ${activated} activated ${entries(activated)} in the turns judged${activated > 0 ? ` (${howsText(hows)})` : ""}.`;
  return { verdict, measured, notes };
}
