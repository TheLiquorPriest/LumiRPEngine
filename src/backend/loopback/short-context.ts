// The narrator's short context (DEPTH-PLAN §3.13, §4.3, §9.2 B2): on a chat on depth, the narrator's
// prompt is the prompt core assembled, as the turn tagger saw it after every other interceptor, with
// the chat's history replaced by LumiRPEngine's context. Raw history reaches it only as the recent
// window (Settings → Depth → window: the latest messages, up to its tokens), for voice and continuity;
// the story itself comes as the beats to render, the prose so far, the player character's staging,
// the notebook's excerpts for the scene (the narrator's part, `scene/narration.ts`, which closes the
// window as a system message, passage by passage) and the turn's state sections (not those its beats
// tell instead, `BEATS_TELL`), each where its entry's mark says core placed it (`compose.ts`). A reply
// no scene plays on a chat on depth (a Continue, a turn made under a pause, a Re-narrate of a reply
// from before depth) is today's narrator's from the same context, under Keep it with every section
// and no part, so raw history beyond the window never reaches it either (`bridge.ts`).
//
// Settings → Depth → Your preset (absorption):
// - **Keep it** (the default): every block outside the history stays where core put it (the system
//   prompt, the card, the persona, World Info, other extensions' injections; after the history, the
//   post-history instructions and a prefill, which follow the narrator's part as they followed the
//   history), and a block core placed at a depth inside the history (an author's note, World Info at
//   depth) keeps its depth, counted from the latest message, within the window; one deeper than the
//   window goes at the window's start, and World Info right after the latest message (at depth 0)
//   at its end.
// - **LRE's only**: the narrator's own template alone: the window, the sections and the part.
// (Picking blocks needs each assembled message's preset block, which Spindle doesn't give; D-12.)
// Sections whose mark the prompt doesn't hold, and every section under LRE's only, go where today's
// book would have put them: at their chat depth within the window, else in one system message at the
// window's start. The way core joined the final body's messages after the interceptors (the user's
// prompt post-processing: same-role messages merged, or one system message) is the way the narrator's
// prompt is joined, so a provider that needs it gets it. Pure.

import { KNOWLEDGE_SLOT, MINDS_SLOT } from "../../shared/minds";
import { tokensOf } from "../book";
import type { PromptMessage, QuietMessage } from "../host";
import { fillMarks, type PlacedSection } from "./compose";

/**
 * Today's sections that tell the narrator what the turn did and how the people in it behave (the
 * Outcome, the Montage, the engine's Outline, Stance, Minds and Who knows what): on a depth turn the
 * beats tell that, decided before the prose, so these stay out of the narrator's prompt; the state
 * sections (the scene, the people here, money, gear, vehicles, quests, the place, property, and a
 * world's own) and the narrator rules are the state it reads.
 */
export const BEATS_TELL: ReadonlySet<string> = new Set(["outcome", "montage", "outline", "stance", MINDS_SLOT, KNOWLEDGE_SLOT]);

export type Absorption = "keep" | "narrator";

export interface ShortContextInput {
  /** The assembled prompt as the turn tagger saw it: after every other interceptor, before core's post-processing. */
  prompt: readonly PromptMessage[];
  /** The final body's messages, as the relay forwarded them: how core joined the prompt after the interceptors. */
  body: readonly QuietMessage[];
  sections: readonly PlacedSection[];
  /** The recent window (Settings → Depth): the latest messages, up to this many tokens. */
  window: { messages: number; tokens: number };
  absorption: Absorption;
}

/** What the narrator reads, for the thinking block: the window's messages and tokens, the history left out, and the blocks kept. */
export interface ShortContextRead {
  messages: number;
  tokens: number;
  left: number;
  blocks: number;
}

/** The narrator's frame for a depth turn, and what it reads. */
export interface ShortContext {
  /** The short context, then the narrator's part as a system message closing the window (none without a part: a reply no scene plays), joined as the final body was. */
  frame: (part?: string) => QuietMessage[];
  read: ShortContextRead;
}

/** How core joined the prompt's messages after the interceptors (`applyPostProcessing`): as they were, same-role neighbours merged, or all in one system message. */
export type Joined = "none" | "merge" | "single";

/** The way the final body shows core joined the tagger's prompt. */
export function joinedAs(prompt: readonly unknown[], body: readonly QuietMessage[]): Joined {
  if (prompt.length > 1 && body.length === 1 && body[0]?.role === "system") return "single";
  return body.length < prompt.length ? "merge" : "none";
}

/** The messages joined as core joined the final body's (`applyPostProcessing`: "\n\n" between the parts). */
export function joined(messages: readonly QuietMessage[], how: Joined): QuietMessage[] {
  if (how === "single") return messages.length > 1 ? [{ role: "system", content: messages.map((m) => m.content).join("\n\n") }] : [...messages];
  if (how === "none") return [...messages];
  const out: QuietMessage[] = [];
  for (const m of messages) {
    const last = out.at(-1);
    if (last && last.role === m.role) out[out.length - 1] = { role: last.role, content: `${last.content}\n\n${m.content}` };
    else out.push({ role: m.role, content: m.content });
  }
  return out;
}

/** A prompt message as a quiet call's: system (and `developer`) as system, the assistant's as the assistant's, anything else as the user's. */
function asQuiet(m: Pick<PromptMessage, "role" | "content">): QuietMessage {
  return { role: m.role === "system" || m.role === "developer" ? "system" : m.role === "assistant" ? "assistant" : "user", content: m.content };
}

/** The latest history messages, oldest first, while there are no more than `window.messages` of them and their tokens fit `window.tokens`. */
function recentOf<M extends { content: string }>(history: readonly M[], window: ShortContextInput["window"]): { kept: M[]; tokens: number } {
  let tokens = 0;
  let k = 0;
  while (k < history.length && k < window.messages) {
    const t = tokensOf(history[history.length - 1 - k]?.content ?? "");
    if (tokens + t > window.tokens) break;
    tokens += t;
    k++;
  }
  return { kept: history.slice(history.length - k), tokens };
}

/** The narrator's frame for a depth turn (see the header). */
export function shortContext(input: ShortContextInput): ShortContext {
  const narratorOnly = input.absorption === "narrator";
  const indexed = input.prompt.map((m, i) => ({ ...m, i }));
  // Under LRE's only no block of the prompt stays, so no mark in one places a section.
  const filled = narratorOnly ? { messages: indexed, found: new Set<string>() } : fillMarks(indexed, input.sections);
  const view = filled.messages;
  const rest = input.sections.filter((s) => !filled.found.has(s.entry));
  const first = view.findIndex((m) => m.history);
  const start = first < 0 ? view.length : first;
  let end = first < 0 ? view.length : view.findLastIndex((m) => m.history) + 1;
  // World Info right after the latest message is World Info at depth 0: it keeps its depth too, so the window's end holds it.
  while (first >= 0 && view[end]?.worldInfo === true) end++;
  const span = view.slice(start, end);
  const history = span.filter((m) => m.history);
  const { kept, tokens } = recentOf(history, input.window);
  const k = kept.length;
  // Each block inside the span, by how many history messages follow it: at that depth within the window, or at its start when deeper.
  const slots: QuietMessage[][] = Array.from({ length: k + 1 }, () => []);
  let after = history.length;
  let blocks = 0;
  for (const m of span) {
    if (m.history) {
      after--;
      continue;
    }
    if (narratorOnly) continue;
    slots[Math.max(0, k - after)]?.push(asQuiet(m));
    blocks++;
  }
  for (const s of rest) if (s.at !== "front") slots[Math.max(0, k - Math.max(0, s.at.depth))]?.push({ role: s.at.role, content: s.text });
  const front = rest.filter((s) => s.at === "front").map((s) => s.text);
  const region: QuietMessage[] = front.length > 0 ? [{ role: "system", content: front.join("\n\n") }] : [];
  for (let j = 0; j <= k; j++) {
    region.push(...(slots[j] ?? []));
    const m = kept[j];
    if (m) region.push(asQuiet(m));
  }
  const before = narratorOnly ? [] : view.slice(0, start).map(asQuiet);
  const behind = narratorOnly ? [] : view.slice(end).map(asQuiet);
  blocks += before.length + behind.length;
  const how = joinedAs(input.prompt, input.body);
  const read: ShortContextRead = { messages: k, tokens, left: history.length - k, blocks };
  return { frame: (part) => joined([...before, ...region, ...(part ? [{ role: "system" as const, content: part }] : []), ...behind], how), read };
}
