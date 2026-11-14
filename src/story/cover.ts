// Which of the chat's messages the story record covers (plan §8.1 "Covered"), told from the records
// alone, never from what they say: a message is covered when a beat recorded lies over it (at its
// message, or over the stretch of the chat's past it was read from), or it lies in a scene that has its
// summary; it is unsummarized when beats lie over it and it lies in no such scene. A
// chapter's summary covers nothing here, as the plan words it. The history window's hold takes the
// covered messages (`src/story/window`), and the story's facts count from both (`./facts`). Code
// decides nothing with them.

import type { StoryPoint } from "./brief";
import { storyAt } from "./path";
import { StoryRecord } from "./record";

export interface StoryCoverage {
  /** The messages on the chat's path the record covers, by id. */
  covered: ReadonlySet<string>;
  /** The messages on the chat's path that have beats and lie in no scene with its summary, by id. */
  unsummarized: ReadonlySet<string>;
}

/** What the record covers, read at a turn (what it and the turns before it recorded) or at the chat's head. */
export function storyCoverage(point: StoryPoint): StoryCoverage {
  const record = StoryRecord.read(point.store.db, point.user, storyAt(point.store.user(point.user), point.chat, point.turn));
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
  let summarized = 0;
  messages.forEach((m, i) => {
    summarized += edges[i] ?? 0;
    if (beats.has(i) || summarized > 0) covered.add(m.message);
    if (beats.has(i) && summarized === 0) unsummarized.add(m.message);
  });
  return { covered, unsummarized };
}
