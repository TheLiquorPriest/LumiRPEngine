// The lore in a prompt, checked on receipt (STANDALONE-PLAN §4.2, §9.6; READINGS N-2, R-59). The light extension holds no state: when RPE gave it no answer
// about the secrets in time (or none it could use, or the extension itself failed) it applies today's fail-closed verdict, which knows only what the
// candidate entries say of themselves. The prompt that reaches RPE, which is the one place that holds the chat's state and sends the prompt to a model,
// then has RPE's own verdict applied to the lore in it before any agent is given it: an entry RPE keeps out is taken out, an entry it words otherwise is
// worded so. The verdict is the one RPE answered late with, kept for the generation (`KeptAnswers`), or else asked of the lore's secrecy rules now at the
// same point of the path the question would have been asked at, over the entries the attached books hold now. Where it cannot be worked out here either,
// the turn's record says so with the reason: it is never only a line in the log.
//
// Each entry is found in the prompt by its text as Lumiverse inserted it: the stored text, or the extension's own fail-closed wording of it, with its macros
// resolved by Lumiverse's own route. It may stand as a message of its own or inside a block Lumiverse joined it into. An entry RPE's verdict would turn on
// that Lumiverse did not insert is not added: it cannot be put where Lumiverse would have put it, and the turn's record names it.

import { blind, usersOwn } from "../../secrecy/blind";
import type { WorldInfoCandidate } from "../../shared/host";
import { isRecord } from "../../shared/json";
import { pointOf, type KeptAnswers, type SecrecyRules, type TurnStarts } from "./answer";
import { attachedBooks } from "./books";
import { questionEntryOf } from "./candidate";
import type { MacroCalls } from "./lumiverse-calls";
import type { LaidMessage } from "./overlay";
import type { LumiverseReads } from "./reads";
import { generationOf, pathOf } from "./receipt";
import type { SecrecyVerdict, Tag, TagLore } from "./wire";

/** An entry the check named: its id, its book and its title in Lumiverse's editor. */
export interface LoreEntryNote {
  id: string;
  book: string;
  title: string;
}

/** What the check found, kept on the turn's record (`Cut.lore`). */
export type LoreRecord =
  | {
      checked: true;
      /** Whose verdict it is: the one RPE answered late with, kept for the generation, or the one worked out on receipt. */
      verdict: "late" | "now";
      /** Entries RPE's verdict keeps out that the extension's let through, taken out of the prompt. */
      removed: LoreEntryNote[];
      /** Entries RPE's verdict words otherwise than the extension's did, worded so in the prompt. */
      reworded: LoreEntryNote[];
      /** Entries RPE's verdict would turn on that Lumiverse did not insert: not added. */
      turnedOn: LoreEntryNote[];
      /** Entries Lumiverse activated whose text was not found in the prompt, so what the verdict says of them was not applied. */
      notFound: LoreEntryNote[];
    }
  | {
      checked: false;
      /** Why RPE could not work the secrets out on receipt either. */
      why: string;
    };

export interface LoreCheckDeps {
  user: string;
  reads: LumiverseReads;
  /** The lore lane's secrecy rules, asked as at the question. */
  secrecy: SecrecyRules;
  /** The turn lane: where the coming turn starts on the path. */
  start: TurnStarts;
  /** What RPE answered late with, kept by generation. */
  answers: KeptAnswers;
  macros: MacroCalls;
}

/** The prompt after the check, what the check found (null where the extension applied RPE's own verdict, and nothing is checked), and the activated lore with each entry's text as the prompt carries it where it is found there. */
export interface Checked {
  messages: readonly LaidMessage[];
  record: LoreRecord | null;
  lore: readonly TagLore[];
}

/** `lore`: what Lumiverse activated for the generation. */
export type LoreCheck = (tag: Tag, messages: readonly LaidMessage[], lore: readonly TagLore[], signal: AbortSignal) => Promise<Checked>;

const words = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The entries Lumiverse's candidate list would hold for the generation: every entry of the books the chat reads, as the interceptor's context gives them. */
async function candidatesOf(reads: LumiverseReads, tag: Tag): Promise<WorldInfoCandidate[]> {
  const out: WorldInfoCandidate[] = [];
  for (const book of await attachedBooks(reads, tag.chat, { speaker: tag.speaker.id, persona: tag.persona })) {
    for (const e of await reads.entries(book)) out.push({ id: e.id, bookId: book, disabled: e.disabled, extensions: e.extensions, comment: e.comment, content: e.content });
  }
  return out;
}

/** One message with `[start, end)` of its text made `insert`; null where the stretch is not inside one text part of it. Its listed messages' stretches move with the text. */
function splice(m: LaidMessage, start: number, end: number, insert: string): LaidMessage | null {
  let content: LaidMessage["content"];
  if (typeof m.content === "string") content = m.content.slice(0, start) + insert + m.content.slice(end);
  else {
    let at = 0;
    let done = false;
    content = m.content.map((part) => {
      if (!isRecord(part) || part.type !== "text" || typeof part.text !== "string") return part;
      const from = at;
      at += part.text.length;
      if (done || start < from || end > at) return part;
      done = true;
      return { ...part, text: part.text.slice(0, start - from) + insert + part.text.slice(end - from) };
    });
    if (!done) return null;
  }
  const delta = insert.length - (end - start);
  const move = (p: number): number => (p <= start ? p : p >= end ? p + delta : start + Math.min(p - start, insert.length));
  const places = m.places.map((p) => ({ member: p.member, start: move(p.start), end: move(p.end) })).filter((p) => p.end > p.start);
  return { ...m, content, text: m.text.slice(0, start) + insert + m.text.slice(end), places, changed: true };
}

/**
 * The first place the text stands in the prompt, made `insert`: where the text is taken out whole (`insert` empty), the line break beside it goes too. A message
 * left with nothing but blanks goes, as Lumiverse leaves such a message out. Null where the text is not found.
 */
function replaced(messages: readonly LaidMessage[], text: string, insert: string): LaidMessage[] | null {
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    const start = m.text.indexOf(text);
    if (start < 0) continue;
    const end = start + text.length;
    let made: LaidMessage | null = null;
    if (insert === "") {
      if (m.text[end] === "\n") made = splice(m, start, end + 1, "");
      else if (start > 0 && m.text[start - 1] === "\n") made = splice(m, start - 1, end, "");
    }
    made ??= splice(m, start, end, insert);
    if (made === null) continue;
    const out = [...messages];
    if (made.text.trim() === "" && made.media === 0) out.splice(i, 1);
    else out[i] = made;
    return out;
  }
  return null;
}

export function createLoreCheck(deps: LoreCheckDeps): LoreCheck {
  const check: LoreCheck = async (tag, messages, lore, signal) => {
    const byExtension = tag.secrecy.by === "extension";
    // The answer RPE worked out at the question is taken here for its generation: the verdict RPE answered late with, and the wording of the secrets where RPE's own was applied.
    const kept = deps.answers.take(tag.chat, tag.generation)?.secrecy ?? null;
    if (!byExtension && lore.length === 0) return { messages, record: null, lore };
    let candidates: WorldInfoCandidate[];
    try {
      candidates = await candidatesOf(deps.reads, tag);
    } catch (error) {
      return { messages, record: byExtension ? { checked: false, why: words(error) } : null, lore };
    }
    // Where the extension applied its own verdict, RPE's is the one kept or worked out now; where it could not be, the prompt stands as the extension left it, and the record says why.
    let verdict: SecrecyVerdict | null = kept;
    let from: "late" | "now" = "late";
    let unworked: string | null = null;
    if (byExtension && verdict === null) {
      try {
        const generation = generationOf(tag);
        const path = pathOf(tag);
        const point = pointOf(generation, path);
        const start = deps.start({ user: tag.user, chat: tag.chat, path, point }, signal);
        start.catch(() => undefined);
        verdict = await deps.secrecy({ user: tag.user, chat: tag.chat, purpose: "prompt", generation, path, start, point, entries: candidates.map(questionEntryOf) }, signal);
        from = "now";
      } catch (error) {
        unworked = words(error);
      }
    }
    // What the prompt holds of each of the user's entries, by the extension's own verdict (the engine's own entries stand as stored); and what RPE's verdict says it should hold.
    const own = usersOwn(candidates);
    const ownIds = new Set(own.map((e) => e.id));
    const blinded = blind(own);
    const blindOff = new Set(blinded.disabled);
    const blindWorded = new Map((blinded.mutated ?? []).map((m) => [m.id, m.content]));
    const worded = new Map((verdict?.mutated ?? []).map((m) => [m.id, m.content]));
    /** An entry's text as the prompt holds it before the check, macros unresolved; null where the prompt holds none of it. */
    const hadOf = (e: WorldInfoCandidate): string | null => {
      if (byExtension) return !ownIds.has(e.id) ? e.content : e.disabled || blindOff.has(e.id) ? null : (blindWorded.get(e.id) ?? e.content);
      return worded.get(e.id) ?? e.content;
    };
    const note = (e: WorldInfoCandidate): LoreEntryNote => ({ id: e.id, book: e.bookId, title: e.comment });
    const activated = new Set(lore.map((l) => l.id));
    const record = { checked: true as const, verdict: from, removed: [] as LoreEntryNote[], reworded: [] as LoreEntryNote[], turnedOn: [] as LoreEntryNote[], notFound: [] as LoreEntryNote[] };
    const jobs: { entry: WorldInfoCandidate; had: string; should: string | null }[] = [];
    if (byExtension && verdict !== null) {
      const off = new Set(verdict.disabled);
      const on = new Set(verdict.enabled);
      for (const e of own) {
        const had = hadOf(e);
        const should = off.has(e.id) ? null : (worded.get(e.id) ?? (e.disabled && !on.has(e.id) ? null : e.content));
        if (had === should) continue;
        if (had === null) {
          if (should !== null && (on.has(e.id) || blindOff.has(e.id))) record.turnedOn.push(note(e));
          continue;
        }
        jobs.push({ entry: e, had, should });
      }
    }
    // Lumiverse inserted each entry's text with its macros resolved by its own route, which is asked once for all of them; where it cannot be asked, the texts are taken as stored.
    const templates: Record<string, string> = {};
    for (const j of jobs) {
      templates[`h:${j.entry.id}`] = j.had;
      if (j.should !== null) templates[`s:${j.entry.id}`] = j.should;
    }
    const jobbed = new Set(jobs.map((j) => j.entry.id));
    const byId = new Map(candidates.map((e) => [e.id, e]));
    const plain: string[] = [];
    for (const l of lore) {
      const e = byId.get(l.id);
      const had = e === undefined || jobbed.has(l.id) ? null : hadOf(e);
      if (had === null || had.trim() === "") continue;
      templates[`t:${l.id}`] = had;
      plain.push(l.id);
    }
    const context = { chat: tag.chat, ...(tag.speaker.id !== null ? { character: tag.speaker.id } : {}), ...(tag.persona !== null ? { persona: tag.persona } : {}) };
    const resolved = Object.keys(templates).length === 0 ? templates : await deps.macros.resolveBatch(templates, context).catch(() => templates);
    const texts = new Map<string, string>();
    let current: LaidMessage[] = [...messages];
    for (const j of jobs) {
      const id = j.entry.id;
      const text = (resolved[`h:${id}`] ?? j.had).trim();
      const insert = j.should === null ? "" : (resolved[`s:${id}`] ?? j.should).trim();
      const next = text === "" ? null : replaced(current, text, insert);
      if (next === null) {
        // Not found: where Lumiverse never inserted the entry there is nothing to change; where it activated it, the turn says it stands as it was.
        if (activated.has(id)) record.notFound.push(note(j.entry));
        continue;
      }
      current = next;
      if (j.should === null) record.removed.push(note(j.entry));
      else {
        record.reworded.push(note(j.entry));
        texts.set(id, insert);
      }
    }
    // Each activated entry's text as the prompt now carries it, where it is found in it.
    for (const id of plain) {
      const text = (resolved[`t:${id}`] ?? templates[`t:${id}`] ?? "").trim();
      if (text !== "" && current.some((m) => m.text.includes(text))) texts.set(id, text);
    }
    return { messages: current, record: byExtension ? (verdict === null ? { checked: false, why: unworked ?? "" } : record) : null, lore: lore.map((l) => (texts.has(l.id) ? { ...l, text: texts.get(l.id)! } : l)) };
  };
  // Nothing in the check may refuse a reply: where it fails on its own, the turn's record says it could not work the secrets out, and why.
  return (tag, messages, lore, signal) =>
    check(tag, messages, lore, signal).catch((error: unknown): Checked => ({ messages, record: tag.secrecy.by === "extension" ? { checked: false, why: words(error) } : null, lore }));
}
