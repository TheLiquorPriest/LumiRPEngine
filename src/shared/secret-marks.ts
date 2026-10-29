// Secret marks in World Info entries (DESIGN §4.2, §6.1): lines an author writes into an entry's own
// text to say what in it is secret, and from whom. LRE reads them and keeps no secret anywhere else in
// a book; it writes one only when the user presses for it (Build's Make secret, the move of a book's
// old secrecy fields).
//
//   {{// Secret: TEXT}}                                  kept from everyone but its holders
//   {{// Secret (known to NAME, NAME): TEXT}}            known to those, kept from everyone else
//   {{// Secret (kept from NAME, NAME): TEXT}}           kept from those; `everyone` may stand alone
//   {{// Secret (known to NAME; kept from NAME): TEXT}}  both, in either order
//
// `Secret`, `known to` and `kept from` read in any case. A NAME is an entity's id, its name, or a word
// of its name that is no one else's; "you" and "the player character" are the player character, as
// the knowledge step reads its model's names (`resolveMarkNames`). A name of no one, or of more than
// one person, is shown to the author (`markNameIssues`). An entry whose whole text is one mark is a
// whole-entry secret (`wholeEntrySecret`). Pure.
//
// What the host does with a mark (Lumiverse staging `ab7d1966`, `src/macros/MacroLexer.ts` and
// `MacroParser.ts`, checked by running its evaluator on each case):
// - It reads `{{//` as a closing tag. The lexer takes each `/` as a close flag before it reads a name,
//   so `{{// Secret: …}}` is the closing tag of a macro named `Secret`, and the parser drops a closing
//   tag that closes nothing (`pairScopedMacros`); the registered `//` comment macro never runs. So the
//   host strips a mark from every prompt it inserts the entry into, whether or not LRE's interceptor
//   ran: a mark fails closed. An opening `{{secret}}` earlier in the same text pairs with the mark
//   instead; the mark still goes, and that opening tag with it.
// - The host strips it only when it inserts the entry. Activation, recursion and the budget read the
//   text before that, so a mark's words count there unless the interceptor replaces the text for the
//   prompt (`mutated.content`, `backend/wi-interceptor.ts`).
// - Spaces and tabs may stand between `{{` and `//`; a line break there leaves the mark in the prompt,
//   garbled. A line break between `//` and `Secret` makes a closing tag with no name, which goes too.
//   Its text may run over several lines, CRLF ones too.
// - It ends at its first `}}`: what follows a `}}` inside the text reaches the prompt, and a text
//   ending in `}` ends the mark a brace early.
// - A `{{` inside opens a nested macro that the host lexes on its own terms (shorthand variables,
//   operators and `::` can end one early), and a backslash before a brace is an escape. Either can
//   carry the mark on to a later `}}`, or to the end of the entry, hiding the text after it. One
//   inside another macro's arguments is dropped with that macro's other closing tags.
// So a mark LRE reads holds no `{{`, no `}}` and no backslash before a brace, keeps everything before
// its colon on one line, and stands outside any other macro: it then ends at its first `}}`, exactly
// where the host ends it. Every writer refuses anything else (`secretMarkProblem`). Text that starts
// like a mark but can't be read as one (`unreadableMarks`) is never read as a secret, and fails
// closed: wherever LRE gives an entry's text, its readers' (`publicText`) and the narrator's prompt
// (`renderSecretMarks`), it is left out as far as the host's lexing could take it.

import type { EntityId } from "./ids";
import { neutralizeMacros } from "./macros";
import type { LintIssue } from "./protocol";

/**
 * One secret mark in an entry's text: where it stands (from its `{{` to just after its `}}`), as
 * written, its text (trimmed), and the names it gives, unresolved. With no "kept from" it is kept
 * from everyone but its holders: `keptFrom` reads `"everyone"`.
 */
export interface SecretMark {
  start: number;
  end: number;
  raw: string;
  text: string;
  knownTo: string[];
  keptFrom: string[] | "everyone";
}

/** Text that starts like a secret mark but can't be read as one: where it stands, as far as the host's lexing could take it, and why. */
export interface UnreadableMark {
  start: number;
  end: number;
  raw: string;
  problem: string;
}

/** A mark's names resolved to entities (`resolveMarkNames`); `unresolved`: the names, as written, that name no one, or more than one. */
export interface ResolvedMarkNames {
  knownTo: EntityId[];
  keptFrom: EntityId[] | "everyone";
  unresolved: string[];
}

/** What a writer is given: the text and the names, as for `writeSecretMark`. */
export interface SecretMarkInput {
  text: string;
  knownTo: readonly string[];
  keptFrom: readonly string[] | "everyone";
}

/**
 * How the narrator is told a mark (`renderMark` "marked"), as a turn resolves it from the prompt
 * registry's Secret marks texts (`narrator.mark.*` and `narrator.secret_marks`, Settings → Agents →
 * Prompts → Final output; `markWording`, `backend/prompts.ts`): `known` for a secret with holders kept
 * from everyone else, `kept` for one kept from some (or, with `everyone` as its names, from everyone
 * but its holders, none named), `both` for holders and some it is kept from. `{{text}}` is the mark's
 * text, `{{known}}` and `{{kept}}` the names, joined by commas.
 */
export interface SecretMarkWording {
  known: string;
  kept: string;
  both: string;
  /** What `{{kept}}` says of a secret kept from everyone but its holders. */
  everyone: string;
  /**
   * The narrator rules' sentence on what a mark means (`narratorRules`): `{{forms}}` is each form a
   * mark takes in this wording (`secretMarkForms`), joined with " or ", and `{{everyone}}` the word
   * for everyone, so an edited wording is still explained.
   */
  rule: string;
}

/** The shipped wording: each of the registry's Secret marks texts as shipped, which the user's own text replaces, with a reset. */
export const SECRET_MARK_WORDING: Readonly<SecretMarkWording> = {
  known: "{{text}} [secret; known to {{known}}]",
  kept: "{{text}} [secret; kept from {{kept}}]",
  both: "{{text}} [secret; known to {{known}}; kept from {{kept}}]",
  everyone: "everyone",
  rule: "A fact marked as a secret, written {{forms}}, is known to the people its mark says it is known to and kept from the people it says it is kept from ({{everyone}}: everyone it isn't known to). Treat it as a marked fact: no one it is kept from says, acts on or is narrated as knowing it, and unless the player's own instructions say otherwise, the narration and the reply don't tell or reveal it; it becomes known only through what the story has already established or what the player character does or finds.",
};

/** A mark a writer was given that the host couldn't strip whole, or that reads otherwise than meant (`secretMarkProblem`). */
export class SecretMarkError extends Error {}

/**
 * What starts a mark, or what an author meant as one: `{{`, `//` and `Secret` as a whole word (as the
 * host lexes a macro's name), any whitespace between them. Only spaces and tabs make a mark: a line
 * break before `//` leaves it in the prompt, and one after it makes a nameless closing tag.
 */
const CANDIDATE = /\{\{(\s*)\/\/(\s*)secret(?![A-Za-z0-9_-])/iy;
const CLAUSE = /^(known[ \t]+to|kept[ \t]+from)(?:[ \t]+([^]*))?$/i;
/** What a name can't hold: the marks' own punctuation, braces, a backslash or a line break. */
const NOT_IN_NAME = /[,;():{}\\\r\n]/;

interface Scan {
  marks: SecretMark[];
  unreadable: UnreadableMark[];
}

const NONE: Scan = { marks: [], unreadable: [] };

const isEveryone = (name: string): boolean => name.trim().toLowerCase() === "everyone";
const sameName = (a: string, b: string): boolean => a.trim().replace(/\s+/g, " ").toLowerCase() === b.trim().replace(/\s+/g, " ").toLowerCase();

/** Where a mark starting at `start` ends as the host could lex it: its matching `}}` with nested macros counted and escapes skipped, or the end of the text. */
function extent(content: string, start: number): { end: number; nested: boolean; escaped: boolean; closed: boolean } {
  let depth = 1;
  let nested = false;
  let escaped = false;
  let pos = start + 2;
  while (pos < content.length) {
    const ch = content[pos];
    const next = content[pos + 1];
    if (ch === "\\" && (next === "{" || next === "}")) {
      escaped = true;
      pos += 2;
    } else if (ch === "{" && next === "{") {
      nested = true;
      depth++;
      pos += 2;
    } else if (ch === "}" && next === "}") {
      depth--;
      pos += 2;
      if (depth === 0) return { end: pos, nested, escaped, closed: true };
    } else pos++;
  }
  return { end: content.length, nested, escaped, closed: false };
}

/** The names of one clause, trimmed, each once (case aside), or why they can't be read. */
function namesOf(text: string): string[] | string {
  const out: string[] = [];
  for (const raw of text.split(",")) {
    const name = raw.trim().replace(/\s+/g, " ");
    if (name === "") return "a name is missing in the brackets";
    if (NOT_IN_NAME.test(name)) return `"${name}" can't be a name: a name holds no brackets, braces, colon, semicolon or backslash`;
    if (!out.some((n) => sameName(n, name))) out.push(name);
  }
  return out;
}

/** The names in a mark's brackets, or why they can't be read. */
function clausesOf(text: string): Pick<SecretMark, "knownTo" | "keptFrom"> | string {
  const parts = text.split(";").map((p) => p.trim());
  if (parts.length > 2) return 'the brackets hold at most two parts: "known to …; kept from …"';
  let knownTo: string[] | null = null;
  let keptFrom: string[] | "everyone" | null = null;
  for (const part of parts) {
    const m = CLAUSE.exec(part);
    if (!m) return part === "" ? "a part in the brackets is empty" : `"${part}" must start with "known to" or "kept from"`;
    const names = namesOf(m[2] ?? "");
    if (typeof names === "string") return names;
    if (/^known/i.test(m[1] ?? "")) {
      if (knownTo) return '"known to" is given twice';
      if (names.some(isEveryone)) return "a secret can't be known to everyone";
      knownTo = names;
    } else {
      if (keptFrom) return '"kept from" is given twice';
      if (names.some(isEveryone) && names.length > 1) return '"everyone" stands alone after "kept from"';
      keptFrom = names.some(isEveryone) ? "everyone" : names;
    }
  }
  const known = knownTo ?? [];
  const kept = keptFrom ?? "everyone";
  const both = kept === "everyone" ? undefined : known.find((n) => kept.some((k) => sameName(k, n)));
  if (both !== undefined) return `${both} is named as knowing it and as kept from it`;
  return { knownTo: known, keptFrom: kept };
}

/** A mark that ends at its first `}}` with nothing nested or escaped (`raw`, its start `head` long), read; or why it can't be. */
function markOf(raw: string, head: number): Pick<SecretMark, "text" | "knownTo" | "keptFrom"> | string {
  const body = raw.slice(0, -2);
  const skip = (at: number): number => {
    let pos = at;
    while (body[pos] === " " || body[pos] === "\t") pos++;
    return pos;
  };
  let pos = skip(head);
  let names: Pick<SecretMark, "knownTo" | "keptFrom"> | string = { knownTo: [], keptFrom: "everyone" };
  if (body[pos] === "(") {
    const close = body.indexOf(")", pos + 1);
    const colon = body.indexOf(":", pos + 1);
    if (close < 0 || (colon >= 0 && colon < close)) return "the brackets after Secret aren't closed before the colon";
    names = clausesOf(body.slice(pos + 1, close));
    pos = skip(close + 1);
  }
  if (body[pos] !== ":") return 'Secret needs a colon before its text, with any names in brackets before that: "{{// Secret (known to NAME): TEXT}}"';
  if (/[\r\n]/.test(body.slice(0, pos))) return "everything before the colon must be on one line";
  if (typeof names === "string") return names;
  const text = body.slice(pos + 1).trim();
  if (text === "") return "it has no text after the colon";
  return { text, ...names };
}

/**
 * Every mark in `content` and everything that starts like one but can't be read, in order (see the
 * header). One inside another macro is never read: the host drops it as a stray closing tag, so it
 * reaches nothing whatever LRE does.
 */
function scan(content: string): Scan {
  if (!content.includes("{{") || !/\/\/\s*secret/i.test(content)) return NONE;
  const out: Scan = { marks: [], unreadable: [] };
  let depth = 0;
  let pos = 0;
  while (pos < content.length) {
    const ch = content[pos];
    const next = content[pos + 1];
    if (ch === "\\" && (next === "{" || next === "}")) {
      pos += 2;
      continue;
    }
    if (ch === "}" && next === "}") {
      if (depth > 0) depth--;
      pos += 2;
      continue;
    }
    if (ch !== "{" || next !== "{") {
      pos++;
      continue;
    }
    CANDIDATE.lastIndex = pos;
    const head = CANDIDATE.exec(content);
    if (!head) {
      depth++;
      pos += 2;
      continue;
    }
    const at = extent(content, pos);
    const raw = content.slice(pos, at.end);
    const unreadable = (problem: string): void => {
      out.unreadable.push({ start: pos, end: at.end, raw, problem });
    };
    if (/[\r\n]/.test(head[1] ?? "")) unreadable("a line break between {{ and // leaves it in every prompt: the host doesn't read it as a comment");
    else if (depth > 0) unreadable("it stands inside another macro, which the host drops it from");
    else if (!at.closed) unreadable("it has no closing }}, so the host hides the rest of the entry with it");
    else if (at.nested) unreadable("it holds {{ or }}, which a secret mark can't: the host may end it elsewhere");
    else if (at.escaped) unreadable("it holds a backslash before a brace, which a secret mark can't: the host may end it elsewhere");
    else if (/[\r\n]/.test(head[2] ?? "")) unreadable("everything before the colon must be on one line");
    else {
      const mark = markOf(raw, head[0].length);
      if (typeof mark === "string") unreadable(mark);
      else out.marks.push({ start: pos, end: at.end, raw, ...mark });
    }
    pos = at.end;
  }
  return out;
}

/** The secret marks in an entry's text, in order, names unresolved (see the header). */
export function parseSecretMarks(content: string): SecretMark[] {
  return scan(content).marks;
}

/** What in an entry's text starts like a secret mark but can't be read as one, in order, each with why: Build shows them, and every writer refuses them. */
export function unreadableMarks(content: string): UnreadableMark[] {
  return scan(content).unreadable;
}

/** Whether an entry's text holds a mark LRE reads: its secrecy is then its marks', and LRE's old fields on it no longer count. */
export function hasSecretMarks(content: string): boolean {
  return scan(content).marks.length > 0;
}

/** The mark an entry's whole text is (blank lines around it aside), making the whole entry a secret; else null. */
export function wholeEntrySecret(content: string): SecretMark | null {
  const { marks, unreadable } = scan(content);
  const mark = marks[0];
  if (!mark || marks.length !== 1 || unreadable.length > 0) return null;
  return content.slice(0, mark.start).trim() === "" && content.slice(mark.end).trim() === "" ? mark : null;
}

/**
 * An entry's text with each mark as `render` gives it (`n`: its place among the entry's marks, from
 * 1), and whatever starts like a mark but can't be read left out as far as the host's lexing could
 * take it: an author's broken mark fails closed.
 */
export function renderSecretMarks(content: string, render: (mark: SecretMark, n: number) => string): string {
  const { marks, unreadable } = scan(content);
  if (marks.length === 0 && unreadable.length === 0) return content;
  const spans = [...marks.map((mark, i) => ({ mark, n: i + 1, start: mark.start, end: mark.end })), ...unreadable.map((u) => ({ mark: null, n: 0, start: u.start, end: u.end }))].sort((a, b) => a.start - b.start);
  let out = "";
  let at = 0;
  for (const span of spans) {
    out += content.slice(at, span.start) + (span.mark ? render(span.mark, span.n) : "");
    at = span.end;
  }
  return out + content.slice(at);
}

/** An entry's text with every mark left out, and whatever starts like one (`renderSecretMarks`): what anyone may read of it. */
export function publicText(content: string): string {
  return renderSecretMarks(content, () => "");
}

/** The entities a name may be resolved against: the world's as authored, the chat's state as it stands (a rename or a newcomer). */
export interface MarkNamesSource {
  readonly entities: Readonly<Record<string, { readonly name: string }>>;
  /** The player character (a world's `pov`), whom "you" and "the player character" name. */
  readonly pov?: EntityId;
}

/** The words that name the player character in a mark, case aside, as the knowledge step reads them in its model's answers. */
const POV_WORDS = /^(you|the player character|player character)$/i;

/**
 * Whom a name in a mark may mean, by the rules `resolveMarkNames` gives: the player character for
 * their words; else the one entity of that id, as written or case aside; else everyone of that whole
 * name; else, for a one-word name, everyone whose name holds that word. One is the name's person.
 */
function nameMatcher(world: MarkNamesSource, state: MarkNamesSource | null): (written: string) => EntityId[] {
  const named = new Map<EntityId, string[]>();
  for (const source of [world, state]) {
    if (!source) continue;
    for (const [id, e] of Object.entries(source.entities)) {
      const name = typeof e?.name === "string" ? e.name.trim().replace(/\s+/g, " ").toLowerCase() : "";
      const names = named.get(id) ?? [];
      if (name !== "" && !names.includes(name)) names.push(name);
      named.set(id, names);
    }
  }
  const pov = state?.pov ?? world.pov;
  return (written) => {
    const raw = written.trim();
    if (pov !== undefined && POV_WORDS.test(raw)) return [pov];
    if (named.has(raw)) return [raw];
    const n = raw.replace(/\s+/g, " ").toLowerCase();
    const byId = [...named.keys()].filter((id) => id.toLowerCase() === n);
    if (byId.length === 1) return byId;
    const ids = [...named.entries()];
    const whole = ids.filter(([, names]) => names.includes(n)).map(([id]) => id);
    if (whole.length > 0 || n.includes(" ")) return whole;
    return ids.filter(([, names]) => names.some((name) => name.split(" ").includes(n))).map(([id]) => id);
  };
}

/**
 * A mark's names as entities: by id, by whole name, or by a word of a name that is no one else's,
 * case aside, and "you" or "the player character" as the player character when `world` names one;
 * each id once, in the mark's order. A name of no one, or of more than one, is left in `unresolved`
 * as written. `state` (the chat's) adds what play changed; without it, the world's own.
 */
export function resolveMarkNames(world: MarkNamesSource, state: MarkNamesSource | null, mark: Pick<SecretMark, "knownTo" | "keptFrom">): ResolvedMarkNames {
  const match = nameMatcher(world, state);
  const unresolved: string[] = [];
  const resolve = (names: readonly string[]): EntityId[] => {
    const out: EntityId[] = [];
    for (const name of names) {
      const [id, ...more] = match(name);
      if (id === undefined || more.length > 0) {
        if (!unresolved.includes(name)) unresolved.push(name);
      } else if (!out.includes(id)) out.push(id);
    }
    return out;
  };
  return { knownTo: resolve(mark.knownTo), keptFrom: mark.keptFrom === "everyone" ? "everyone" : resolve(mark.keptFrom), unresolved };
}

/**
 * What Build and the lint warn of in a mark's names, at `path`: each that names no one in the world,
 * or more than one person. Such a name holds nothing, and a mark kept from one is kept from whoever
 * it may be, the player character among them: the narrator is told so, or a view that leaves out
 * what the player character doesn't know leaves the mark out (`backend/wi-interceptor.ts`).
 */
export function markNameIssues(world: MarkNamesSource, state: MarkNamesSource | null, mark: Pick<SecretMark, "knownTo" | "keptFrom">, path: string): LintIssue[] {
  const match = nameMatcher(world, state);
  const nameOf = (id: EntityId): string => (state && Object.hasOwn(state.entities, id) ? state.entities[id]?.name : undefined) ?? (Object.hasOwn(world.entities, id) ? world.entities[id]?.name : undefined) ?? id;
  const issues: LintIssue[] = [];
  const check = (names: readonly string[], kept: boolean): void => {
    for (const name of names) {
      const ids = match(name);
      if (ids.length === 1) continue;
      const who = ids.length === 0 ? "names no one in this world" : `could be any of ${ids.map(nameOf).join(", ")}`;
      const means = kept ? "the narrator is told the secret is kept from the player character too, in case it is them" : "no one holds the secret by it";
      issues.push({ severity: "warning", path, code: ids.length === 0 ? "mark_name_unresolved" : "mark_name_ambiguous", message: `"${name}" ${who}: ${means}. Give a full name, or pick the person.` });
    }
  };
  check(mark.knownTo, false);
  if (mark.keptFrom !== "everyone") check(mark.keptFrom, true);
  return issues;
}

/**
 * A secret's text as the narrator is told it (`wording`, the user's or the shipped): `known`, the
 * names of its holders; `kept`, of those it is kept from, or `"everyone"` (as is an empty list). The
 * placeholders are filled in one pass, so a text holding a placeholder's words is left as it is.
 */
export function secretMarkText(text: string, known: readonly string[], kept: readonly string[] | "everyone", wording: SecretMarkWording = SECRET_MARK_WORDING): string {
  const keptFrom = kept === "everyone" || kept.length === 0 ? null : kept.join(", ");
  const template = known.length === 0 ? wording.kept : keptFrom === null ? wording.known : wording.both;
  const values: Readonly<Record<string, string>> = { text, known: known.join(", "), kept: keptFrom ?? wording.everyone };
  return template.replace(/\{\{(text|known|kept)\}\}/g, (whole, key: string) => values[key] ?? whole);
}

/**
 * Every form a secret's mark takes in a wording, "…" standing for its text and names: each case
 * `secretMarkText` writes for the sections and the interceptor (holders or none, kept from some or
 * from everyone), as a section shows it. The narrator rules' text on secret marks
 * (`narrator.secret_marks`, `narratorRules`) names them all, so an edited wording is still explained.
 */
export function secretMarkForms(wording: SecretMarkWording = SECRET_MARK_WORDING): string[] {
  const cases: [string[], string[] | "everyone"][] = [[["…"], "everyone"], [[], ["…"]], [[], "everyone"], [["…"], ["…"]]];
  return [...new Set(cases.map(([known, kept]) => neutralizeMacros(secretMarkText("…", known, kept, wording))))];
}

/**
 * A mark as one prompt holds it: under `"marked"` its text with whom it is known to and kept from,
 * each resolved name by `nameOf` and each unresolved one as written (`secretMarkText`); under `"omit"`,
 * nothing.
 */
export function renderMark(mark: Pick<SecretMark, "text" | "knownTo" | "keptFrom">, resolved: ResolvedMarkNames, nameOf: (id: EntityId) => string, mode: "marked" | "omit", wording: SecretMarkWording = SECRET_MARK_WORDING): string {
  if (mode === "omit") return "";
  const known = [...resolved.knownTo.map(nameOf), ...mark.knownTo.filter((n) => resolved.unresolved.includes(n))];
  const kept = resolved.keptFrom === "everyone" || mark.keptFrom === "everyone" ? "everyone" : [...resolved.keptFrom.map(nameOf), ...mark.keptFrom.filter((n) => resolved.unresolved.includes(n))];
  return secretMarkText(mark.text, known, kept, wording);
}

/** Whose view a text is handed on in (`applyMarks`): every mark marked, every mark left out, or as one character holds them. */
export type MarkView = "marked" | "omit" | `holder:${EntityId}`;

/** What resolves a text's marks for `applyMarks`: the world, the chat's state when there is one (a rename or a newcomer), and the narrator's wording (absent: the shipped one). */
export interface MarkReader {
  world: MarkNamesSource;
  state: MarkNamesSource | null;
  wording?: SecretMarkWording;
}

/**
 * A user's entry text as one reader may have it, the one way LRE hands an entry's text on to a model:
 * each mark marked (`"marked"`, `renderMark`), left out (`"omit"`), or, for one character
 * (`"holder:<id>"`), marked where they hold it and left out where they don't; what starts like a mark
 * but can't be read is always left out. LRE's own sections neutralize macros, so a mark passed on as
 * written would reach a model as plain text, its secret with it.
 */
export function applyMarks(text: string, reader: MarkReader, view: MarkView): string {
  if (view === "omit") return publicText(text);
  const holder = view === "marked" ? null : view.slice("holder:".length);
  const name = (source: MarkNamesSource | null, id: EntityId): string | undefined => (source && Object.hasOwn(source.entities, id) ? source.entities[id]?.name : undefined);
  const nameOf = (id: EntityId): string => name(reader.state, id) ?? name(reader.world, id) ?? id;
  return renderSecretMarks(text, (mark) => {
    const resolved = resolveMarkNames(reader.world, reader.state, mark);
    return holder !== null && !resolved.knownTo.includes(holder) ? "" : renderMark(mark, resolved, nameOf, "marked", reader.wording);
  });
}

/** Why a mark can't be written from these, or null: what the host couldn't strip whole, or a name that wouldn't read back as given. */
export function secretMarkProblem(input: SecretMarkInput): string | null {
  const text = input.text.trim();
  if (text === "") return "a secret needs its text";
  if (text.includes("{{") || text.includes("}}")) return "a secret's text can't hold {{ or }}: the host would end the mark there, and the rest would reach the prompt";
  if (/\\[{}]/.test(text)) return "a secret's text can't hold a backslash before a brace: the host reads it as an escape and runs the mark on";
  if (text.endsWith("}") || text.endsWith("\\")) return "a secret's text can't end with } or \\: the host would end the mark a character early, or run it on";
  const names = [...input.knownTo, ...(input.keptFrom === "everyone" ? [] : input.keptFrom)];
  for (const raw of names) {
    const name = raw.trim();
    if (name === "") return "a name is empty";
    if (NOT_IN_NAME.test(name)) return `"${name}" can't be a name in a mark: a name holds no commas, semicolons, brackets, braces, colon, backslash or line break`;
  }
  if (input.knownTo.some(isEveryone)) return "a secret can't be known to everyone";
  const kept = input.keptFrom === "everyone" ? [] : input.keptFrom;
  if (kept.some(isEveryone) && kept.length > 1) return '"everyone" stands alone after "kept from"';
  const both = input.knownTo.find((n) => kept.some((k) => sameName(k, n)));
  return both === undefined ? null : `${both.trim()} is named as knowing it and as kept from it`;
}

/**
 * A mark's text from its text and names, as Build and the move of a book's secrecy write it: names
 * as given, each once; no "kept from" when it is kept from everyone but its holders (`"everyone"`, or
 * no names). Throws `SecretMarkError` with `secretMarkProblem`'s reason for what it can't write.
 */
export function writeSecretMark(input: SecretMarkInput): string {
  const problem = secretMarkProblem(input);
  if (problem !== null) throw new SecretMarkError(problem);
  const once = (names: readonly string[]): string[] => {
    const out: string[] = [];
    for (const raw of names) {
      const name = raw.trim().replace(/\s+/g, " ");
      if (!out.some((n) => sameName(n, name))) out.push(name);
    }
    return out;
  };
  const known = once(input.knownTo);
  const kept = input.keptFrom === "everyone" || input.keptFrom.some(isEveryone) ? [] : once(input.keptFrom);
  const clauses = [...(known.length > 0 ? [`known to ${known.join(", ")}`] : []), ...(kept.length > 0 ? [`kept from ${kept.join(", ")}`] : [])];
  return `{{// Secret${clauses.length > 0 ? ` (${clauses.join("; ")})` : ""}: ${input.text.trim()}}}`;
}
