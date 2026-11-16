// The story so far (plan §8.1): what the briefing shows for the history the window leaves out of the
// prompt, drawn from the story record. It prints what the Author wrote, in the chat's order, each
// part with the messages it stands for: scene summaries, and the beats themselves wherever no scene
// summary covers them yet. Its size is a share of the Author's window with a floor. The newest
// stretches are given whole; when the rest does not fit, what is furthest back goes by its
// chapter's summary, and where there is none, by a line that counts what was not shown. Code picks
// nothing by meaning and writes no words: the layout and every word around the record's own text
// are the shipped prompt part `.prompts/story-so-far.md`, filled in here.

import type { TemplatePart } from "../../app/guidance";
import type { JsonObject } from "../../shared/json";

/** A summary from the record, with the messages it stands for (places in the chat, both ends kept). `gone`: its messages are not in the chat any more, so it stands where the turn that wrote it does. */
export interface StorySummary {
  from: number;
  to: number;
  text: string;
  gone?: boolean;
}

/** A beat from the record, with the message it came from, and the last message of the stretch it stands for where it stands for more than one. `gone`: as for a summary. */
export interface StoryBeat {
  at: number;
  to?: number;
  text: string;
  gone?: boolean;
}

/** A stretch of the chat, both ends kept. */
export interface StoryStretch {
  from: number;
  to: number;
}

/** What the record hands over: the summaries that have been written, the beats, and the stretches of the chat it covers nowhere. Order does not matter. */
export interface StoryRecordParts {
  chapters: readonly StorySummary[];
  scenes: readonly StorySummary[];
  beats: readonly StoryBeat[];
  uncovered?: readonly StoryStretch[];
}

export interface StorySoFarSettings {
  /** The share of the Author's window it may fill. */
  share: number;
  /** The fewest tokens it may fill, however small the window. */
  floor: number;
}

/** Appendix D.1: one twentieth of the Author's window, and not less than 6,000 tokens. */
export const STORY_SO_FAR_DEFAULTS: StorySoFarSettings = { share: 1 / 20, floor: 6000 };

export interface StorySoFarInput {
  record: StoryRecordParts;
  /** The place in the chat of the first message the window keeps; null when it keeps every message, so there is nothing to show. */
  keptFrom: number | null;
  /** The Author's window in tokens, as the model layer reports it. */
  contextWindow: number;
  settings: StorySoFarSettings;
  /** Counts a text's tokens the way the caller measures the briefing. */
  tokens: (text: string) => number;
  /** The prompt part `story-so-far`, which lays the parts out. */
  layout: Pick<TemplatePart, "render">;
}

/** A stretch the story so far had no room for, and what of the record it holds. (A type, not an interface, so it is a template's JSON field.) */
export type StorySoFarLeftOut = {
  from: number;
  to: number;
  chapters: number;
  scenes: number;
  beats: number;
};

export interface StorySoFar {
  /** The block as laid out; empty when the window leaves nothing out or the record holds nothing for it. */
  text: string;
  tokens: number;
  budget: number;
  leftOut: StorySoFarLeftOut[];
}

/** The fields of `.prompts/story-so-far.md`: each part is one of these, oldest first. */
export type StorySoFarPart =
  | { chapter: { from: number; to: number; text: string; gone?: true } }
  | { scene: { from: number; to: number; text: string; gone?: true } }
  | { beats: { from: number; to: number; lines: { at: number; through?: number; text: string; gone?: true }[] } }
  | { gap: StoryStretch }
  | { left_out: StorySoFarLeftOut };

type Item = { kind: "scene"; summary: StorySummary; from: number; to: number } | { kind: "beat"; beat: StoryBeat; from: number; to: number } | { kind: "gap"; from: number; to: number };

const RANK = { scene: 0, gap: 1, beat: 2 } as const;

/** A stretch that goes into the block, or out of it, as one: a summarized chapter with all it holds, or one item outside any. */
interface Unit {
  chapter: StorySummary | null;
  items: Item[];
  from: number;
  to: number;
}

/** How a unit is shown: whole, by its chapter's summary, or counted in a line of what was left out. */
type Level = 2 | 1 | 0;

export function storySoFarBudget(contextWindow: number, settings: StorySoFarSettings): number {
  return Math.max(settings.floor, Math.floor(contextWindow * settings.share));
}

function unitsOf(record: StoryRecordParts, keptFrom: number): Unit[] {
  const scenes = record.scenes.filter((s) => s.from < keptFrom);
  // A beat inside a scene that has its summary is told by that summary. Scenes by where they start, each with the
  // furthest any scene starting no later reaches: a beat is inside one when the last to start at or before it reaches it.
  const byStart = [...scenes].sort((a, b) => a.from - b.from);
  const reach: number[] = [];
  for (const s of byStart) reach.push(Math.max(reach.at(-1) ?? Number.NEGATIVE_INFINITY, s.to));
  const told = (at: number): boolean => {
    let lo = 0;
    let hi = byStart.length - 1;
    let last = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if ((byStart[mid]?.from ?? Number.POSITIVE_INFINITY) <= at) {
        last = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return last >= 0 && (reach[last] ?? Number.NEGATIVE_INFINITY) >= at;
  };
  const beats = record.beats.filter((b) => (b.at < keptFrom || b.gone === true) && !told(b.at));
  // The stretches the record covers nowhere, as far as the window leaves them out.
  const gaps = (record.uncovered ?? []).filter((g) => g.from < keptFrom).map((g): StoryStretch => ({ from: g.from, to: Math.min(g.to, keptFrom - 1) }));
  const items: Item[] = [
    ...scenes.map((summary): Item => ({ kind: "scene", summary, from: summary.from, to: summary.to })),
    ...beats.map((beat): Item => ({ kind: "beat", beat, from: beat.at, to: Math.max(beat.at, beat.to ?? beat.at) })),
    ...gaps.map((g): Item => ({ kind: "gap", from: g.from, to: g.to })),
  ].sort((a, b) => a.from - b.from || RANK[a.kind] - RANK[b.kind]);

  const chapters = record.chapters.filter((c) => c.from < keptFrom || c.gone === true).sort((a, b) => a.from - b.from);
  const units: Unit[] = chapters.map((chapter) => ({ chapter, items: [], from: chapter.from, to: chapter.to }));
  // An item goes to the first chapter, by where chapters start, that holds where it starts. Items come in that order,
  // so a chapter that ends before one item ends before every later one.
  let open = 0;
  for (const item of items) {
    while (open < chapters.length && (chapters[open]?.to ?? Number.POSITIVE_INFINITY) < item.from) open++;
    const unit = (chapters[open]?.from ?? Number.POSITIVE_INFINITY) <= item.from ? units[open] : undefined;
    if (unit !== undefined) unit.items.push(item);
    else units.push({ chapter: null, items: [item], from: item.from, to: item.to });
  }
  return units.sort((a, b) => a.from - b.from || (a.chapter === null ? 1 : 0) - (b.chapter === null ? 1 : 0));
}

function partsOf(units: readonly Unit[], levels: readonly Level[]): { parts: StorySoFarPart[]; leftOut: StorySoFarLeftOut[] } {
  const parts: StorySoFarPart[] = [];
  const leftOut: StorySoFarLeftOut[] = [];
  units.forEach((unit, i) => {
    const level = levels[i] ?? 0;
    const last = parts[parts.length - 1];
    if (level === 0) {
      const scenes = unit.items.filter((it) => it.kind === "scene").length;
      const counted = { chapters: unit.chapter === null ? 0 : 1, scenes, beats: unit.items.filter((it) => it.kind === "beat").length };
      if (last !== undefined && "left_out" in last) {
        const run = last.left_out;
        run.from = Math.min(run.from, unit.from);
        run.to = Math.max(run.to, unit.to);
        run.chapters += counted.chapters;
        run.scenes += counted.scenes;
        run.beats += counted.beats;
      } else {
        const run = { from: unit.from, to: unit.to, ...counted };
        leftOut.push(run);
        parts.push({ left_out: run });
      }
      return;
    }
    if (unit.chapter !== null && (level === 1 || unit.items.length === 0)) {
      parts.push({ chapter: { from: unit.chapter.from, to: unit.chapter.to, text: unit.chapter.text, ...(unit.chapter.gone === true ? { gone: true as const } : {}) } });
      return;
    }
    for (const item of unit.items) {
      const tail = parts[parts.length - 1];
      if (item.kind === "scene") parts.push({ scene: { from: item.summary.from, to: item.summary.to, text: item.summary.text, ...(item.summary.gone === true ? { gone: true as const } : {}) } });
      else if (item.kind === "gap") parts.push({ gap: { from: item.from, to: item.to } });
      else {
        // A line's own end is `through`, a name no part around it holds, so the layout never reads the part's `to` for it.
        const line = { at: item.beat.at, ...(item.to > item.beat.at ? { through: item.to } : {}), text: item.beat.text, ...(item.beat.gone === true ? { gone: true as const } : {}) };
        if (tail !== undefined && "beats" in tail) {
          tail.beats.to = Math.max(tail.beats.to, item.to);
          tail.beats.lines.push(line);
        } else parts.push({ beats: { from: item.beat.at, to: item.to, lines: [line] } });
      }
    }
  });
  return { parts, leftOut };
}

/** The greatest n from `low` to `high` for which `holds(n)`, given that it holds for `low` and, once it fails, fails for every greater n. */
function furthest(low: number, high: number, holds: (n: number) => boolean): number {
  let lo = low;
  let hi = high;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (holds(mid)) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * The story so far for the history before `keptFrom`. Units are given a place newest first: each is
 * shown whole if the block still fits, else by its chapter's summary if it has one and that fits,
 * else counted as left out; once one is not whole, nothing older is, and once a chapter's summary
 * has no room, nothing older is shown at all. Showing more never takes less room, so how many of
 * the newest units go whole, and then how many chapters go by their summary, are each found by
 * halving: the block is laid out and counted a few times however long the chat, never once per unit.
 */
export function storySoFar(input: StorySoFarInput): StorySoFar {
  const budget = storySoFarBudget(input.contextWindow, input.settings);
  if (input.keptFrom === null) return { text: "", tokens: 0, budget, leftOut: [] };
  const units = unitsOf(input.record, input.keptFrom);
  if (units.length === 0) return { text: "", tokens: 0, budget, leftOut: [] };

  const laidOut = new Map<string, { text: string; tokens: number; leftOut: StorySoFarLeftOut[] }>();
  const lay = (levels: readonly Level[]): { text: string; tokens: number; leftOut: StorySoFarLeftOut[] } => {
    const key = levels.join("");
    let laid = laidOut.get(key);
    if (laid === undefined) {
      const { parts, leftOut } = partsOf(units, levels);
      // The parts are JSON by construction: a mark that does not hold is left out of its part, never set to nothing.
      const text = input.layout.render({ parts } as unknown as JsonObject).text;
      laid = { text, tokens: input.tokens(text), leftOut };
      laidOut.set(key, laid);
    }
    return laid;
  };
  const fits = (levels: readonly Level[]): boolean => lay(levels).tokens <= budget;

  // The newest `count` units whole, the rest left out; with none whole, everything is left out, room or not.
  const n = units.length;
  const whole = (count: number): Level[] => units.map((_, i) => (i >= n - count ? 2 : 0));
  // The last unit's step is apart: given whole, it takes the line for what is left out with it.
  let count = furthest(0, n - 1, (c) => fits(whole(c)));
  if (count === n - 1 && fits(whole(n))) count = n;
  let levels = whole(count);
  if (count < n) {
    // The first unit that was not whole, and those older, with a chapter: newest first, by their summaries.
    const chapters: number[] = [];
    for (let i = n - count - 1; i >= 0; i--) if ((units[i]?.chapter ?? null) !== null) chapters.push(i);
    const summed = (m: number): Level[] => {
      const out = whole(count);
      for (const i of chapters.slice(0, m)) out[i] = 1;
      return out;
    };
    levels = summed(furthest(0, chapters.length, (m) => fits(summed(m))));
  }
  const laid = lay(levels);
  return { text: laid.text, tokens: laid.tokens, budget, leftOut: laid.leftOut };
}
