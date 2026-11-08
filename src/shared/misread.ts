// What a stage's parse didn't keep of a model's answer as the model wrote it (the raw-against-saved
// audit, BOOTSTRAP-TRIAL.md): each field by its path in the answer, with what the answer said there
// and what it was kept as, if anything. The call's answer is kept as written beside its misread
// fields, and only then: a bootstrap job's record and the turn inspector's call keep them, and the
// spot-check cards and GM → Depth → Turn show them.

/** The most of what the answer said in a misread field that is kept with it: enough to see the shape the model wrote. */
export const MISREAD_SAID_CHARS = 200;

/** The most misread fields a call keeps; the rest are counted. */
export const MISREAD_FIELDS = 40;

/** The path of a whole answer that couldn't be read at all (not JSON, or cut off at its room): a misread of every field in it. */
export const WHOLE_ANSWER = "(the answer)";

/** The path of what an answer wrote past the end of the JSON object it holds (a stray `}`, a tool tag, a `</br>`): the object is read without it. */
export const PAST_ANSWER = "(past the answer)";

/** One field of a model's answer that its parse didn't keep as written. */
export interface Misread {
  /** Its path in the answer: `beats[3].quotes`, `links[0].from`; `WHOLE_ANSWER` for the whole of it. */
  field: string;
  /** What the answer held there, as JSON, cut at `MISREAD_SAID_CHARS`. */
  said: string;
  /** What it was kept as (an unknown channel read as "sight"); absent: it was dropped. */
  as?: string;
  /** Why, where its parse says: an answer that couldn't be read at all says whether it was cut off at its room or wasn't JSON. */
  why?: string;
}

/** One call's answer that its parse didn't keep whole: the fields (the first `MISREAD_FIELDS` of `count`) and the answer's text as the model wrote it. */
export interface CallMisread {
  fields: Misread[];
  count: number;
  raw: string;
}

/** Adds `fields` to what a call kept of its misread answer: the first `MISREAD_FIELDS` listed, every one counted. */
export function noteMisread(kept: CallMisread, fields: readonly Misread[]): void {
  for (const f of fields) {
    kept.count += 1;
    if (kept.fields.length < MISREAD_FIELDS) kept.fields.push(f);
  }
}

/** A misread field in words: `beats[3].quotes: dropped ["Gone."]`, `beats[0].exposure[1].channel: read as "sight" ("smell")`, with why where it says. */
export function misreadText(m: Misread): string {
  const how = m.as === undefined ? `${m.field}: dropped ${m.said}` : `${m.field}: read as ${m.as} (${m.said})`;
  return m.why === undefined ? how : `${how}: ${m.why}`;
}
