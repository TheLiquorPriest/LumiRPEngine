// The story so far (plan §8.1): what the briefing shows for the history the window leaves out of the
// prompt, drawn from the story record. It prints what the Author wrote, in the chat's order, each
// part with the messages it stands for: scene summaries, and the beats themselves wherever no scene
// summary covers them yet. Its size is a share of the Author's window with a floor. The newest
// stretches are given whole; when the rest does not fit, what is furthest back goes by its
// chapter's summary, and where there is none, by a line that counts what was not shown. Code picks
// nothing by meaning and writes no words: the layout and every word around the record's own text
// are the shipped prompt part `.prompts/story-so-far.md`, filled in here.

import type { TemplatePart } from "rp-harness";

/** A summary from the record, with the messages it stands for (places in the chat, both ends kept). */
export interface StorySummary {
  from: number;
  to: number;
  text: string;
}

/** A beat from the record, with the message it came from. */
export interface StoryBeat {
  at: number;
  text: string;
}

/** What the record hands over: the summaries that have been written, and the beats. Order does not matter. */
export interface StoryRecordParts {
  chapters: readonly StorySummary[];
  scenes: readonly StorySummary[];
  beats: readonly StoryBeat[];
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
  | { chapter: { from: number; to: number; text: string } }
  | { scene: { from: number; to: number; text: string } }
  | { beats: { from: number; to: number; lines: { at: number; text: string }[] } }
  | { left_out: StorySoFarLeftOut };

type Item = { kind: "scene"; summary: StorySummary; from: number; to: number } | { kind: "beat"; beat: StoryBeat; from: number; to: number };

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
  // A beat inside a scene that has its summary is told by that summary.
  const beats = record.beats.filter((b) => b.at < keptFrom && !scenes.some((s) => b.at >= s.from && b.at <= s.to));
  const items: Item[] = [
    ...scenes.map((summary): Item => ({ kind: "scene", summary, from: summary.from, to: summary.to })),
    ...beats.map((beat): Item => ({ kind: "beat", beat, from: beat.at, to: beat.at })),
  ].sort((a, b) => a.from - b.from || (a.kind === b.kind ? 0 : a.kind === "scene" ? -1 : 1));

  const chapters = record.chapters.filter((c) => c.from < keptFrom).sort((a, b) => a.from - b.from);
  const units: Unit[] = chapters.map((chapter) => ({ chapter, items: [], from: chapter.from, to: chapter.to }));
  for (const item of items) {
    const unit = units.find((u) => u.chapter !== null && item.from >= u.chapter.from && item.from <= u.chapter.to);
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
      const counted = { chapters: unit.chapter === null ? 0 : 1, scenes, beats: unit.items.length - scenes };
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
      parts.push({ chapter: { from: unit.chapter.from, to: unit.chapter.to, text: unit.chapter.text } });
      return;
    }
    for (const item of unit.items) {
      const tail = parts[parts.length - 1];
      if (item.kind === "scene") parts.push({ scene: { from: item.summary.from, to: item.summary.to, text: item.summary.text } });
      else if (tail !== undefined && "beats" in tail) {
        tail.beats.to = item.beat.at;
        tail.beats.lines.push({ at: item.beat.at, text: item.beat.text });
      } else parts.push({ beats: { from: item.beat.at, to: item.beat.at, lines: [{ at: item.beat.at, text: item.beat.text }] } });
    }
  });
  return { parts, leftOut };
}

/**
 * The story so far for the history before `keptFrom`. Units are given a place newest first: each is
 * shown whole if the block still fits, else by its chapter's summary if it has one and that fits,
 * else counted as left out; once one is not whole, nothing older is, and once a chapter's summary
 * has no room, nothing older is shown at all.
 */
export function storySoFar(input: StorySoFarInput): StorySoFar {
  const budget = storySoFarBudget(input.contextWindow, input.settings);
  if (input.keptFrom === null) return { text: "", tokens: 0, budget, leftOut: [] };
  const units = unitsOf(input.record, input.keptFrom);
  if (units.length === 0) return { text: "", tokens: 0, budget, leftOut: [] };

  const levels: Level[] = units.map(() => 0);
  const lay = (): { text: string; tokens: number; leftOut: StorySoFarLeftOut[] } => {
    const { parts, leftOut } = partsOf(units, levels);
    const text = input.layout.render({ parts }).text;
    return { text, tokens: input.tokens(text), leftOut };
  };

  let laid = lay();
  let cap: Level = 2;
  for (let i = units.length - 1; i >= 0 && cap > 0; i--) {
    const unit = units[i];
    if (unit === undefined) continue;
    const tries: Level[] = unit.chapter === null ? [2] : [2, 1];
    let placed: Level = 0;
    for (const level of tries) {
      if (level > cap) continue;
      levels[i] = level;
      const attempt = lay();
      if (attempt.tokens <= budget) {
        laid = attempt;
        placed = level;
        break;
      }
    }
    levels[i] = placed;
    if (placed < 2) cap = unit.chapter === null ? (Math.min(cap, 1) as Level) : placed;
  }
  return { text: laid.text, tokens: laid.tokens, budget, leftOut: laid.leftOut };
}
