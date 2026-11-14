// Laying the tag's message list over the request body Lumiverse sent (STANDALONE-PLAN §4.2). The
// extension's interceptor lists every message as it hands the prompt on; after it Lumiverse may join
// neighbouring messages (`promptPostProcessing`), drop blank ones and collapse the prompt into one user
// message (`generate.service.ts:1249-1256`, `:1414-1429`). Those steps are replayed here on the list's
// shape, as Lumiverse's code makes them, until one way explains the body. Then every stretch of every
// body message is known as one listed message, a separator Lumiverse put between two, or text no
// listed message accounts for; and the body can be made again with some listed messages left out, as
// Lumiverse would have made it had the interceptor left them out (`rebuild`).

import { isRecord } from "../../shared/json";
import { textHash, type Role, type TagMessage } from "./wire";

/** What Lumiverse puts between two texts wherever it joins them (`generate.service.ts:5415`, `:5425`; `prompt-assembly.service.ts:7265`). */
const JOIN_SEPARATOR = "\n\n";

/** What Lumiverse does to the prompt after its interceptors, as its code reads the user's settings. */
export interface Joining {
  /**
   * `promptPostProcessing`: "merge", "semi" and "strict" all join neighbouring messages of one role
   * (`generate.service.ts:5406-5422`; the three are one branch), "single" joins everything into one
   * system message (`:5423-5429`), and any other value does nothing.
   */
  post: "none" | "merge" | "single";
  /** The preset's "Collapse into single user message", applied after blank messages are dropped (`generate.service.ts:1428-1429`). */
  collapse: boolean;
}

/** Every way Lumiverse can join a prompt, the fewest steps first: where two explain a body alike, the one with fewer steps is taken. */
export const JOININGS: readonly Joining[] = [
  { post: "none", collapse: false },
  { post: "merge", collapse: false },
  { post: "single", collapse: false },
  { post: "none", collapse: true },
  { post: "merge", collapse: true },
  { post: "single", collapse: true },
];

/** One message of the request body: its role, its text (its text parts run together, as `getTextContent` reads it) and its other parts. */
export interface BodyMessage {
  role: string;
  /** Its content exactly as sent. */
  content: string | unknown[];
  text: string;
  /** The lengths of its text parts when its content was a list of parts; null for plain text. */
  textParts: number[] | null;
  /** Its parts that are not text, as sent. */
  media: unknown[];
}

/** The body's messages, read (OpenAI's chat format: `openai-compatible.ts:359-435`); null when they are not a list of messages. */
export function readBodyMessages(messages: unknown): BodyMessage[] | null {
  if (!Array.isArray(messages)) return null;
  const out: BodyMessage[] = [];
  for (const m of messages) {
    if (!isRecord(m) || typeof m.role !== "string") return null;
    const content = m.content;
    if (typeof content === "string") out.push({ role: m.role, content, text: content, textParts: null, media: [] });
    else if (Array.isArray(content)) {
      const texts: string[] = [];
      const media: unknown[] = [];
      for (const part of content) {
        if (isRecord(part) && part.type === "text" && typeof part.text === "string") texts.push(part.text);
        else media.push(part);
      }
      out.push({ role: m.role, content, text: texts.join(""), textParts: texts.map((t) => t.length), media });
    } else if (content === null || content === undefined) out.push({ role: m.role, content: "", text: "", textParts: null, media: [] });
    else return null;
  }
  return out;
}

/** A stretch of a listed message's text: all of it (`part` null), or one of its text parts. */
interface Chunk {
  member: number;
  part: number | null;
  length: number;
}

/** A message as Lumiverse's steps make it from the listed messages. */
interface Made {
  role: Role;
  partial: boolean;
  /** "joined": its chunks joined by Lumiverse's separator (one chunk is plain text); "parts": one listed message's own parts, untouched. */
  form: "joined" | "parts";
  chunks: Chunk[];
  /** For "parts": the listed message it is. */
  owner: number | null;
  /** Listed messages whose parts that are not text it carries, in order. */
  media: number[];
}

function own(tag: readonly TagMessage[], m: number): Made {
  const t = tag[m]!;
  const media = (t.media ?? 0) > 0 ? [m] : [];
  if (t.parts !== undefined) return { role: t.role, partial: t.partial === true, form: "parts", chunks: t.parts.map((length, part) => ({ member: m, part, length })), owner: m, media };
  return { role: t.role, partial: t.partial === true, form: "joined", chunks: [{ member: m, part: null, length: t.length }], owner: null, media };
}

/** A message's text as one piece each listed message gives (`getTextContent`): what a join takes of it. */
function whole(x: Made, tag: readonly TagMessage[]): Chunk[] {
  if (x.form === "joined") return x.chunks;
  const owner = x.owner!;
  return [{ member: owner, part: null, length: tag[owner]!.length }];
}

function textLength(x: Made): number {
  const sum = x.chunks.reduce((a, c) => a + c.length, 0);
  return x.form === "joined" ? sum + JOIN_SEPARATOR.length * Math.max(0, x.chunks.length - 1) : sum;
}

/** `applyPostProcessing`'s merge (`generate.service.ts:5407-5422`): a message of the previous one's role joins it; the joined one keeps the first's other fields and loses its parts that are not text. */
function merged(list: readonly Made[], tag: readonly TagMessage[]): Made[] {
  const out = [...list];
  let i = 1;
  while (i < out.length) {
    const prev = out[i - 1]!;
    const cur = out[i]!;
    if (cur.role === prev.role) {
      out[i - 1] = { role: prev.role, partial: prev.partial, form: "joined", chunks: [...whole(prev, tag), ...whole(cur, tag)], owner: null, media: [] };
      out.splice(i, 1);
    } else i++;
  }
  return out;
}

/** The blank-message filter (`generate.service.ts:1416-1423`): plain text that is only whitespace goes, unless it is a trailing assistant prefill; a list of parts stays unless it is empty. */
function kept(x: Made, tag: readonly TagMessage[]): boolean {
  if (x.form === "parts") {
    const t = tag[x.owner!]!;
    return (t.parts?.length ?? 0) + (t.media ?? 0) > 0;
  }
  const blank = x.chunks.every((c) => tag[c.member]!.blank === true);
  return !blank || (x.role === "assistant" && x.partial);
}

/** `collapseToSingleUserMessage` (`prompt-assembly.service.ts:7244-7279`): every non-empty text, each text part on its own, joined into one user message, the other parts after it. */
function collapsed(list: readonly Made[]): Made {
  const chunks: Chunk[] = [];
  const media: number[] = [];
  for (const x of list) {
    if (x.form === "joined") {
      if (textLength(x) > 0) chunks.push(...x.chunks);
    } else for (const c of x.chunks) if (c.length > 0) chunks.push(c);
    media.push(...x.media);
  }
  return { role: "user", partial: false, form: "joined", chunks, owner: null, media };
}

/** The messages Lumiverse makes from the listed `members`, in order, by `joining`. */
function replay(joining: Joining, tag: readonly TagMessage[], members: readonly number[]): Made[] {
  let list = members.map((m) => own(tag, m));
  if (joining.post === "merge") list = merged(list, tag);
  else if (joining.post === "single" && list.length > 1) list = [{ role: "system", partial: false, form: "joined", chunks: list.flatMap((x) => whole(x, tag)), owner: null, media: [] }];
  list = list.filter((x) => kept(x, tag));
  if (joining.collapse && list.length > 1) list = [collapsed(list)];
  return list;
}

/** A prompt message as RPE passes it on, and what each stretch of it is. */
export interface LaidMessage {
  role: string;
  /** Its content as Lumiverse sent it, or as made again after RPE's own cut. */
  content: string | unknown[];
  text: string;
  /** Its parts that are not text. */
  media: number;
  /** Each listed message's stretch of `text` (UTF-16 offsets), in order; empty when no listed message accounts for this message. */
  places: { member: number; start: number; end: number }[];
}

/** Where each chunk of `x` stands in a text made the way `x` is, its chunks having these lengths. */
function offsets(x: Made): { chunk: Chunk; start: number }[] {
  const out: { chunk: Chunk; start: number }[] = [];
  let at = 0;
  x.chunks.forEach((chunk, k) => {
    if (x.form === "joined" && k > 0) at += JOIN_SEPARATOR.length;
    out.push({ chunk, start: at });
    at += chunk.length;
  });
  return out;
}

/** The listed messages' stretches of `body` when `x` is what it holds, each checked against its hash; null when it is not. */
function placesIn(x: Made, body: BodyMessage, tag: readonly TagMessage[]): LaidMessage["places"] | null {
  if (body.role !== x.role || body.text.length !== textLength(x)) return null;
  if (x.form === "parts" && body.textParts === null) return null;
  const spans = new Map<number, [number, number][]>();
  for (const [k, { chunk, start }] of offsets(x).entries()) {
    if (x.form === "joined" && k > 0 && body.text.slice(start - JOIN_SEPARATOR.length, start) !== JOIN_SEPARATOR) return null;
    const list = spans.get(chunk.member) ?? [];
    list.push([start, start + chunk.length]);
    spans.set(chunk.member, list);
  }
  const places: LaidMessage["places"] = [];
  for (const [member, list] of spans) {
    // A listed message's text is its text parts run together, whatever stood between them here.
    if (textHash(list.map(([a, b]) => body.text.slice(a, b)).join("")) !== tag[member]!.hash) return null;
    places.push({ member, start: list[0]![0], end: list[list.length - 1]![1] });
  }
  return places;
}

/** How the tag's list lies over the body. */
export interface Overlay {
  joining: Joining;
  /** Each body message, in order, with what each stretch of it is. */
  messages: LaidMessage[];
  /** Listed messages Lumiverse left out of the body: each blank, as its steps drop blank ones. */
  absent: number[];
  /** Listed messages not found where the replay put them: the body is not fully told apart. */
  missing: number[];
  /** Every stretch of every body message is told apart, and every listed message is found or left out as Lumiverse leaves it out. */
  complete: boolean;
  /** The messages each body message is (null: none of the list's), for `rebuild`. */
  made: (Made | null)[];
}

function membersOf(x: Made): number[] {
  const out = new Set<number>();
  for (const c of x.chunks) out.add(c.member);
  if (x.owner !== null) out.add(x.owner);
  for (const m of x.media) out.add(m);
  return [...out];
}

function lay(joining: Joining, tag: readonly TagMessage[], body: readonly BodyMessage[]): Overlay {
  const all = tag.map((_, i) => i);
  const made = replay(joining, tag, all);
  const shown = new Set(made.flatMap(membersOf));
  const absent = all.filter((m) => !shown.has(m));
  const messages: LaidMessage[] = [];
  const which: (Made | null)[] = [];
  let k = 0;
  for (const b of body) {
    const x = made[k];
    const places = x === undefined ? null : placesIn(x, b, tag);
    messages.push({ role: b.role, content: b.content, text: b.text, media: b.media.length, places: places ?? [] });
    which.push(places ? x! : null);
    if (places) k++;
  }
  const missing = made.slice(k).flatMap(membersOf);
  const complete = missing.length === 0 && which.every((x) => x !== null);
  return { joining, messages, absent, missing, complete, made: which };
}

/**
 * The tag's list laid over the body by the first way of joining that explains all of it, its pictures
 * included where one does: a join drops a message's pictures (`getTextContent`), and collapse keeps
 * them, so two ways that give the same text can differ in them. Else the way that explains the most.
 */
export function overlay(tag: readonly TagMessage[], body: readonly BodyMessage[]): Overlay {
  let complete: Overlay | null = null;
  let best: Overlay | null = null;
  let bestScore = -1;
  for (const joining of JOININGS) {
    const laid = lay(joining, tag, body);
    if (laid.complete) {
      if (laid.messages.every((m, i) => m.media === laid.made[i]!.media.reduce((n, member) => n + (tag[member]!.media ?? 0), 0))) return laid;
      complete ??= laid;
      continue;
    }
    const score = laid.messages.reduce((n, m) => n + m.places.reduce((a, p) => a + (p.end - p.start) + 1, 0), 0);
    if (score > bestScore) {
      best = laid;
      bestScore = score;
    }
  }
  return complete ?? best!;
}

/** Each listed message's text as the body holds it: its stretches run together; a blank one Lumiverse left out stands as spaces of its length. */
function textsOf(laid: Overlay, tag: readonly TagMessage[]): Map<number, string> {
  const texts = new Map<number, string>();
  laid.messages.forEach((message, i) => {
    const x = laid.made[i];
    if (!x) return;
    const spans = new Map<number, string[]>();
    for (const { chunk, start } of offsets(x)) {
      const list = spans.get(chunk.member) ?? [];
      list.push(message.text.slice(start, start + chunk.length));
      spans.set(chunk.member, list);
    }
    for (const [member, list] of spans) texts.set(member, list.join(""));
  });
  // Its whitespace is not in the body; were it joined to a neighbour now, its length is all that is known of it.
  for (const m of laid.absent) if (!texts.has(m)) texts.set(m, " ".repeat(tag[m]!.length));
  return texts;
}

/** A text part of a listed message: its text cut by the lengths of its parts. */
function partText(text: string, tag: TagMessage, part: number): string {
  const lengths = tag.parts ?? [text.length];
  const start = lengths.slice(0, part).reduce((a, b) => a + b, 0);
  return text.slice(start, start + (lengths[part] ?? 0));
}

function sameMade(a: Made, b: Made): boolean {
  return a.role === b.role && a.form === b.form && a.owner === b.owner && a.chunks.length === b.chunks.length && a.chunks.every((c, i) => c.member === b.chunks[i]!.member && c.part === b.chunks[i]!.part) && a.media.length === b.media.length && a.media.every((m, i) => m === b.media[i]);
}

/**
 * The body as Lumiverse would have sent it had the interceptor left the listed messages `removed`
 * out: the same steps replayed without them. A body message that holds the same as before is kept
 * exactly as sent; one that changed is made again from the texts the body holds. Parts that are not
 * text go with the listed message they came with where the body says which; where it can't, all are
 * kept. Needs a complete overlay.
 */
export function rebuild(laid: Overlay, tag: readonly TagMessage[], removed: ReadonlySet<number>): LaidMessage[] {
  if (!laid.complete) throw new Error("the prompt's parts were not all told apart");
  const texts = textsOf(laid, tag);
  const before = laid.made.map((x, i) => ({ x: x!, message: laid.messages[i]! }));
  const mediaOf = new Map<number, unknown[]>();
  for (const { x, message } of before) {
    if (x.media.length === 0 || !Array.isArray(message.content)) continue;
    const parts = message.content.filter((p) => !(isRecord(p) && p.type === "text" && typeof p.text === "string"));
    const counts = x.media.map((m) => tag[m]!.media ?? 0);
    if (counts.reduce((a, b) => a + b, 0) !== parts.length) {
      // Which part came with which message is not known: they stay together with the first that stays.
      const stays = x.media.find((m) => !removed.has(m));
      if (stays !== undefined) mediaOf.set(stays, [...(mediaOf.get(stays) ?? []), ...parts]);
      continue;
    }
    let at = 0;
    x.media.forEach((m, i) => {
      mediaOf.set(m, parts.slice(at, at + counts[i]!));
      at += counts[i]!;
    });
  }
  const kept = tag.map((_, i) => i).filter((m) => !removed.has(m));
  const out: LaidMessage[] = [];
  for (const x of replay(laid.joining, tag, kept)) {
    const same = before.find((b) => sameMade(b.x, x));
    if (same) {
      out.push(same.message);
      continue;
    }
    const pieces = offsets(x).map(({ chunk }) => {
      const text = texts.get(chunk.member) ?? "";
      return chunk.part === null ? text : partText(text, tag[chunk.member]!, chunk.part);
    });
    const text = x.form === "joined" ? pieces.join(JOIN_SEPARATOR) : pieces.join("");
    const media = x.media.flatMap((m) => mediaOf.get(m) ?? []);
    const content: string | unknown[] =
      x.form === "parts" ? [...pieces.map((t) => ({ type: "text", text: t })), ...media] : media.length > 0 ? [{ type: "text", text }, ...media] : text;
    const places = new Map<number, { start: number; end: number }>();
    for (const { chunk, start } of offsets(x)) {
      const place = places.get(chunk.member);
      places.set(chunk.member, { start: place?.start ?? start, end: start + chunk.length });
    }
    out.push({ role: x.role, content, text, media: media.length, places: [...places].map(([member, p]) => ({ member, ...p })) });
  }
  return out;
}
