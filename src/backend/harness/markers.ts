// A harness turn's sections in the writer's request (HARNESS-SLICE3: "The writer's request"). On the
// harness engine the sections are made when the writer is asked, from the state the author's
// commits left, so the prompt Lumiverse assembled can't hold them yet. The guard writes into each
// section's World Info entry the section as the chat's head has it, between a start and an end
// marker; Lumiverse puts the entry where the section's Position or the preset's outlet says; and
// here each marked span is swapped whole for the turn's own section.
//
// So a reply is never written from marker text, whatever fails: a prompt that goes as Lumiverse
// assembled it (LumiAH had no part in the reply, or ran out of time) holds every section as the chat
// stood, with a marker line before and after it that reads as a comment.
//
// A section whose span isn't in the messages (the preset placed its entry nowhere, the host left the
// entry out, or the entries couldn't be written) still goes: with the others like it, in the
// sections' own order, as one system message before the last user message, or at the end when
// there is none.
//
// Pure: the messages in, the messages out. Nothing here reads the chat or the world.

import { hashParts } from "../../shared/hash";
import type { ModelMessage, ModelPart } from "./shapes";

/**
 * A marker's fixed frame: `// lre:<part>:<turn>` before a section and `// lre:<part>:<turn>:end`
 * after it, each naming its part and its turn by eight hex digits. The form is not a setting: no
 * marker is sent where the writer's request is made (every span is swapped or unmarked first), and
 * it has to be text that no preset macro, World Info scan or HTML pass rewrites, so it holds no
 * braces and no angle brackets, and a part's id never appears in it as written. A model that does
 * see one (the prompt as assembled, with nothing replaced) reads a line comment.
 */
const OPEN = "// lre:";
const END = ":end";

/** Every marker the engine ever wrote, whatever turn wrote it: its part, its turn, and whether it ends a span. */
const ANY = /\/\/ lre:([0-9a-f]{8}):([0-9a-f]{8})(:end)?/g;

/** What tells one turn's markers from another's: a prompt assembled with an earlier turn's entries still in the book never takes this turn's sections for them. */
export function markerNonce(generationId: string): string {
  return hashParts("lre.harness.marker", generationId).slice(0, 8);
}

/** A part's name in a marker: a hash of its id, so any id a world gives a section can be marked. */
function partKey(part: string): string {
  return hashParts("lre.harness.part", part).slice(0, 8);
}

/**
 * A part of the prompt as its World Info entry holds it for one turn's prompt: `text`, the part as
 * the chat's head has it (empty when it has none), between the turn's start and end markers for it.
 */
export function markedText(part: string, nonce: string, text: string): string {
  const open = `${OPEN}${partKey(part)}:${nonce}`;
  return text === "" ? `${open}\n${open}${END}` : `${open}\n${text}\n${open}${END}`;
}

/** One part of the prompt as the writer is sent it: its slot, and its text, empty when the turn has none for it. */
export interface PlacedPart {
  part: string;
  text: string;
}

/** One marker found in a text. */
interface Found {
  at: number;
  to: number;
  key: string;
  nonce: string;
  end: boolean;
}

/**
 * `text` with each marked span resolved. A span of this turn (`nonce`) is swapped whole for what
 * `own` gives its part; where `own` gives nothing for it (undefined), the span keeps the text it
 * holds and loses its marker lines. A span of another turn is taken out whole: it is that turn's
 * section, left in the book. A marker with no partner is taken out alone, a start of this turn's
 * after giving its part's text. `found` hears each part placed.
 */
function resolve(text: string, own: (key: string) => string | undefined, nonce: string, found: (key: string) => void): string {
  if (!text.includes(OPEN)) return text;
  const markers: Found[] = [...text.matchAll(ANY)].map((m) => ({ at: m.index, to: m.index + m[0].length, key: m[1] ?? "", nonce: m[2] ?? "", end: m[3] !== undefined }));
  let out = "";
  let from = 0;
  for (let i = 0; i < markers.length; i++) {
    const start = markers[i];
    if (!start || start.at < from) continue;
    out += text.slice(from, start.at);
    from = start.to;
    if (start.end) continue;
    const close = markers.slice(i + 1).find((m) => m.end && m.key === start.key && m.nonce === start.nonce);
    const mine = start.nonce === nonce;
    const fresh = mine ? own(start.key) : undefined;
    if (mine) found(start.key);
    if (!close) {
      out += fresh ?? "";
      continue;
    }
    // What the span holds: the part as the chat's head had it, a line of its own after the start marker and before the end marker.
    const held = text.slice(start.to, close.at).replace(/^\r?\n/, "").replace(/\r?\n$/, "");
    out += mine ? (fresh ?? held) : "";
    from = close.to;
  }
  return out + text.slice(from);
}

/** A message with nothing left to say: its span's section was empty, and it held nothing else. */
function blank(message: ModelMessage): boolean {
  if (message.parts && message.parts.some((p) => p.type !== "text" || p.text.trim() !== "")) return false;
  return message.content.trim() === "";
}

/**
 * The writer's messages with the turn's parts in place (`parts`, in the order the unplaced go): each
 * span of this turn swapped whole for its part's text, a part with no text leaving nothing where its
 * span stood, and a message left empty by that taken out. The parts no span placed go together as
 * one system message before the last user message (at the end without one), each part apart from
 * the next by a blank line. `placed` names the parts a span placed.
 *
 * `parts` null: no turn made any (none is open for the prompt). Each span of this turn then keeps
 * the section it holds, as the chat's head had it, and loses its marker lines.
 */
export function placeParts(messages: readonly ModelMessage[], parts: readonly PlacedPart[] | null, nonce: string): { messages: ModelMessage[]; placed: string[] } {
  const texts = new Map((parts ?? []).map((p) => [partKey(p.part), p.text]));
  const names = new Map((parts ?? []).map((p) => [partKey(p.part), p.part]));
  const placed = new Set<string>();
  const found = (key: string): void => {
    const part = names.get(key);
    if (part !== undefined) placed.add(part);
  };
  // A part of this turn's that the turn made nothing for is empty now, whatever the head had: only with no turn at all does a span keep what it holds.
  const own = (key: string): string | undefined => (parts === null ? undefined : (texts.get(key) ?? ""));
  const out: ModelMessage[] = [];
  for (const message of messages) {
    const held = message.content.includes(OPEN) || (message.parts ?? []).some((p) => p.type === "text" && p.text.includes(OPEN));
    if (!held) {
      out.push(message);
      continue;
    }
    const swapped: ModelMessage = { ...message, content: resolve(message.content, own, nonce, found) };
    if (message.parts) swapped.parts = message.parts.map((p): ModelPart => (p.type === "text" ? { ...p, text: resolve(p.text, own, nonce, found) } : p));
    if (!blank(swapped)) out.push(swapped);
  }
  const loose = (parts ?? []).filter((p) => !placed.has(p.part) && p.text.trim() !== "");
  if (loose.length > 0) {
    const at = out.findLastIndex((m) => m.role === "user");
    out.splice(at < 0 ? out.length : at, 0, { role: "system", content: loose.map((p) => p.text).join("\n\n") });
  }
  return { messages: out, placed: [...placed] };
}

/**
 * The author's brief as the Outline section's lines: each line of it one line of the outline, a
 * list marker at its start taken off, blank lines left out. None for no brief.
 */
export function briefLines(brief: string | null): string[] {
  if (brief === null) return [];
  return brief
    .split("\n")
    .map((line) => line.trim().replace(/^(?:[-*•]|\d+[.)])\s+/, ""))
    .filter((line) => line !== "");
}

/**
 * The writer's messages without the brief message the core put in, once the Outline section carries
 * the brief: only when exactly one message holds the brief word for word and it is a system message,
 * since the core's own framing of it (its `writer.brief` text) is the user's to change and nothing
 * else names that message; a brief the user's settings put inside the player's own message stays
 * there. Otherwise the messages as they are, and the brief reaches the writer twice rather than not
 * at all.
 */
export function withoutBrief(messages: readonly ModelMessage[], brief: string | null): ModelMessage[] {
  const text = brief?.trim() ?? "";
  if (text === "") return [...messages];
  const holding = messages.filter((m) => m.content.includes(text));
  const [only] = holding;
  if (holding.length !== 1 || only?.role !== "system") return [...messages];
  return messages.filter((m) => m !== only);
}
