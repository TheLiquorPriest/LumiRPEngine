// Which of the chat's messages the story record covers (plan §8.1 "Covered"), told from the records
// alone, never from what they say: a message is covered when a beat recorded lies over it (at its
// message, or over the stretch of the chat's past it was read from), or it lies in a scene that has its
// summary; it is unsummarized when beats lie over it and it lies in no such scene. A
// chapter's summary covers nothing here, as the plan words it. The history window's hold takes the
// covered messages (`src/story/window`), and the story's facts count from both (`./facts`). Code
// decides nothing with them.
//
// Every stretch of the whole path is told too: each run of messages with the same marks, so a page, the
// window's marker and the story so far each name the stretches the record does not cover, by their range.

import type { PathEntry } from "../store";
import type { StoryPoint } from "./brief";
import { storyAt } from "./path";
import { StoryRecord } from "./record";

/** A run of messages with the same marks, both ends kept (the messages' numbers on the path). */
export interface CoverStretch {
  from: number;
  to: number;
  /** Beats or a scene's summary lie over it. */
  covered: boolean;
  /** Beats lie over it. */
  beats: boolean;
  /** It lies in a scene that has its summary. */
  summarized: boolean;
}

export interface StoryCoverage {
  /** The messages on the chat's path the record covers, by id. */
  covered: ReadonlySet<string>;
  /** The messages on the chat's path that have beats and lie in no scene with its summary, by id. */
  unsummarized: ReadonlySet<string>;
  /** Every stretch of the path, in order, each told once. */
  stretches: readonly CoverStretch[];
}

/** What a record covers over the messages of its path. */
export function coverageOf(record: StoryRecord): StoryCoverage {
  const messages = record.at.messages;
  // How many summarized scenes each message lies in: a running sum over where they start and stop.
  const edges = new Array<number>(messages.length + 1).fill(0);
  const spans = record.spans("scene");
  for (const scene of record.of("scene")) {
    const span = spans.get(scene.id);
    if (typeof scene.fields.summary !== "string" || span?.from == null || span.to == null || span.to < span.from) continue;
    edges[span.from] = (edges[span.from] ?? 0) + 1;
    edges[span.to + 1] = (edges[span.to + 1] ?? 0) - 1;
  }
  const beats = new Set<number>();
  for (const beat of record.of("beat")) {
    const { from, to } = record.beatSpan(beat);
    if (from !== null && to !== null) for (let i = from; i <= to; i++) beats.add(i);
  }
  const covered = new Set<string>();
  const unsummarized = new Set<string>();
  const stretches: CoverStretch[] = [];
  let summarized = 0;
  messages.forEach((m, i) => {
    summarized += edges[i] ?? 0;
    const hasBeats = beats.has(i);
    if (hasBeats || summarized > 0) covered.add(m.message);
    if (hasBeats && summarized === 0) unsummarized.add(m.message);
    const mark = { covered: hasBeats || summarized > 0, beats: hasBeats, summarized: summarized > 0 };
    const last = stretches.at(-1);
    if (last !== undefined && last.covered === mark.covered && last.beats === mark.beats && last.summarized === mark.summarized) last.to = i;
    else stretches.push({ from: i, to: i, ...mark });
  });
  return { covered, unsummarized, stretches };
}

/**
 * What the record covers, read at a turn (what it and the turns before it recorded) or at the chat's head, over the messages of the
 * line the caller reads along (`messages`: the generation's path, a swipe's own line), else the chat's path.
 */
export function storyCoverage(point: StoryPoint & { messages?: readonly PathEntry[] }): StoryCoverage {
  return coverageOf(StoryRecord.read(point.store, point.user, storyAt(point.store.user(point.user), point.chat, point.turn, point.messages)));
}
