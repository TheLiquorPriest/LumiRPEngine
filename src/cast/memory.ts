// A character's memories (plan §7.4): rows of the record, each in the character's own words, written
// only by its own agent through its memory actions. This file holds what code does with them, which
// is arithmetic and matching, never judgment:
//   - which perceptions a character has taken in (a memory of theirs names each);
//   - the three tiers: top of mind (those the character put there, the newest few), short term
//     (formed lately in story time, not yet settled by a dream), long term (everything else);
//   - fading: strength halves over a stretch of story time that grows with the memory's weight and
//     with each recall, counted from its last recall; a memory under the faint mark is shown as the
//     gist its own agent wrote. Nothing is deleted;
//   - matching a cue: by the people and things a memory is tagged with, and by its words.

import type { CastSettings } from "./kit";
import { type CastItem, type CastRecord, nameKey } from "./record";

/** Story minutes in a day. */
const DAY = 24 * 60;

/** The perceptions a character has taken in: each one a memory of theirs names as where it came from. */
export function takenIn(record: CastRecord, character: string): Set<string> {
  const out = new Set<string>();
  for (const m of record.of(character, "memory", true)) {
    const from = m.fields.from;
    if (Array.isArray(from)) for (const id of from) if (typeof id === "string") out.add(id);
  }
  return out;
}

/** A character's perceptions on the path not yet taken into memory, oldest first: whatever their casting was when perceived, so a character recast upward has all it kept. */
export function untakenPerceptions(record: CastRecord, character: string): CastItem[] {
  const taken = takenIn(record, character);
  return record.of(character, "perception").filter((p) => !taken.has(p.id));
}

export type Tier = "top" | "short" | "long";

/** A memory as code reads it at a moment of story time: its tier, its strength from 0 to 1, and whether it has faded to its gist. */
export interface MemoryNow {
  item: CastItem;
  tier: Tier;
  strength: number;
  faint: boolean;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** A memory's weight, within the settings' range; the setting's when it was given none. */
export function weightOf(item: CastItem, s: Pick<CastSettings, "memoryWeight" | "weightMax">): number {
  return Math.min(s.weightMax, Math.max(1, num(item.fields.weight) ?? s.memoryWeight));
}

/**
 * Strength at story time `now` (minutes): 1 when formed or recalled, halving every `fadeDays` story
 * days for a memory of weight 1, a stretch that doubles with each point of weight and grows by one
 * more such stretch with each recall. 1 where the chat keeps no story time.
 */
export function strengthOf(item: CastItem, now: number | null, s: Pick<CastSettings, "fadeDays" | "memoryWeight" | "weightMax">): number {
  if (now === null || item.at === null) return 1;
  const recalls = num(item.fields.recalls) ?? 0;
  const since = Math.max(0, now - (num(item.fields.recalled) ?? item.at));
  const halfLife = s.fadeDays * DAY * 2 ** (weightOf(item, s) - 1) * (1 + recalls);
  return 0.5 ** (since / halfLife);
}

/** The memories a character holds at top of mind: those put there, the most recently put first, as many as the setting holds. */
export function topOfMind(memories: readonly CastItem[], s: Pick<CastSettings, "topOfMind">): Set<string> {
  const put = memories.flatMap((m) => {
    if (m.fields.top !== true) return [];
    const last = m.rows.findLast((r) => r.value.top === true);
    return last === undefined ? [] : [{ id: m.id, row: last.id }];
  });
  return new Set(put.sort((a, b) => b.row - a.row).slice(0, s.topOfMind).map((p) => p.id));
}

/** Each of a character's memories as it stands at story time `now`, in the order they were formed. */
export function memoriesNow(record: CastRecord, character: string, now: number | null, s: CastSettings): MemoryNow[] {
  const memories = record.of(character, "memory");
  const top = topOfMind(memories, s);
  return memories.map((item) => {
    const strength = strengthOf(item, now, s);
    const young = now === null || item.at === null || now - item.at < s.shortTermDays * DAY;
    const tier: Tier = top.has(item.id) ? "top" : item.fields.settled === undefined && young ? "short" : "long";
    return { item, tier, strength, faint: tier !== "top" && strength < s.faintBelow };
  });
}

/** Text as matching reads it: case and everything but letters and digits set aside, padded so that a phrase matches whole words only. */
function words(text: string): string {
  return ` ${text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
}

const texts = (v: unknown): string[] => (typeof v === "string" ? [v] : Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/**
 * Whether a memory touches any of `cues` (people, places, things, topics, feelings, in words): a cue
 * it is tagged with (who or what it is about), or a cue its own words hold, word for word.
 */
export function touches(item: CastItem, cues: readonly string[]): boolean {
  const tags = [...texts(item.fields.who), ...texts(item.fields.about)];
  const keys = new Set(tags.map(nameKey));
  const said = words([...texts(item.fields.text), ...texts(item.fields.gist), ...texts(item.fields.tone), ...tags].join(" "));
  return cues.some((cue) => {
    const phrase = words(cue);
    return keys.has(nameKey(cue)) || (phrase.trim() !== "" && said.includes(phrase));
  });
}

/** Strongest first; of two as strong, the one formed later. */
export function strongestFirst(a: MemoryNow, b: MemoryNow): number {
  return b.strength - a.strength || (b.item.at ?? 0) - (a.item.at ?? 0) || (b.item.rows[0]?.id ?? 0) - (a.item.rows[0]?.id ?? 0);
}
