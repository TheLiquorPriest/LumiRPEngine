// What reached one person of the story (DEPTH2-PLAN §4, `FeedItem`): a character's agent is given
// only this of the story record, so a wrong belief comes from what reached them, never from what
// was true. A beat of their own is theirs whole; a beat that reached them is given as it reached
// them: whole, what someone present could sense of it; part or told, what they got of it. Never a
// beat's `what` unless the beat is their own. A thought reaches no one but its owner, and a struck
// beat no one at all. Pure.

import type { Beat, BeatKind } from "../../shared/ledger";
import type { StoryPath } from "./record";

/** What a person is given of one beat. */
export type FeedItem = { beat: string; at: number; where: string | null } & ({ reach: "whole"; by: string; surface: string; quotes?: string[] } | { reach: "part" | "told"; got: string; from?: string } | { reach: "own"; kind: BeatKind; what: string; quotes?: string[] });

/** A person's feed: the items, oldest first; how many more there are past them; and the beat it read up to, which marks it digested. */
export interface Feed {
  items: FeedItem[];
  more: number;
  /** The last beat the items cover (with those that reached them not): what their digest marks. Null where there was nothing to read. */
  last: string | null;
}

/** The player's character as the story record names them: "player", whatever their entity's id. */
export function storyName(id: string, pov: string): string {
  return id === pov ? "player" : id;
}

/** What `who` is given of `beat`; null where it didn't reach them. */
export function feedItem(beat: Beat, who: string): FeedItem | null {
  if (beat.struck !== undefined) return null;
  const head = { beat: beat.id, at: beat.at, where: beat.where };
  if (beat.by === who) return { ...head, reach: "own", kind: beat.kind, what: beat.what, ...(beat.quotes?.length ? { quotes: beat.quotes } : {}) };
  if (beat.kind === "inner") return null;
  const reached = beat.exposure.find((e) => e.who === who);
  if (!reached) return null;
  if (reached.reach === "whole") return { ...head, reach: "whole", by: beat.by, surface: beat.surface, ...(beat.quotes?.length ? { quotes: beat.quotes } : {}) };
  return { ...head, reach: reached.reach, got: reached.got ?? beat.surface, ...(reached.from !== undefined ? { from: reached.from } : {}) };
}

/**
 * What reached `who` (an entity's id; the player's character by theirs or as "player") of the beats
 * on `path` after `after` (the beat they last digested; from the start where it names none on the
 * path), oldest first, at most `most` of them.
 */
export function feedOf(path: StoryPath, who: string, pov: string, after: string | null, most: number): Feed {
  const self = storyName(who, pov);
  const from = after === null ? 0 : path.beats.findIndex((b) => b.beat.id === after) + 1;
  const items: FeedItem[] = [];
  let more = 0;
  let last: string | null = null;
  for (const { beat } of path.beats.slice(from)) {
    const item = feedItem(beat, self);
    if (item && items.length >= most) {
      more++;
      continue;
    }
    if (item) items.push(item);
    if (more === 0) last = beat.id;
  }
  return { items, more, last };
}
