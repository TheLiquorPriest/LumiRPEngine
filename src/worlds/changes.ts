// What changed between two versions of a world, part by part: for each part of the world (its people, its places, its calendar…)
// how many things were added, changed and removed, and the first few things named. The comparison itself is `shared/world-diff.ts`'s,
// the one every writer of a world's document is read with; this only groups it for a page.

import type { JsonValue } from "../shared/json";
import { getAt, parsePointer } from "../shared/json-patch";
import { type Change, changesBetween, groupOf, nameOf } from "../shared/world-diff";

/** One thing a part changed: its id, its name where it has one, and how it changed. */
export interface ChangedThing {
  id: string;
  name: string | null;
  kind: Change["kind"];
}

/** One part of a world and how many things in it were added, changed and removed. `things` names the first of them (a part with no things of its own, the calendar, names none); `more` counts those left unnamed. */
export interface ChangedPart {
  /** The collection (`entities`, `places`…) or the part (`calendar`, `ruleset`…) of the world's document. */
  part: string;
  added: number;
  changed: number;
  removed: number;
  things: ChangedThing[];
  more: number;
}

export interface Changes {
  /** How many things changed in all. */
  total: number;
  /** Each part with a change, in the order of the document. */
  parts: ChangedPart[];
}

/** What changed from `from` to `to`, at most `listed` things named under each part. */
export function changesOf(from: unknown, to: unknown, listed: number): Changes {
  const found = changesBetween(from, to);
  const parts = new Map<string, ChangedPart>();
  for (const change of found) {
    const part = groupOf(change.key);
    let row = parts.get(part);
    if (row === undefined) {
      row = { part, added: 0, changed: 0, removed: 0, things: [], more: 0 };
      parts.set(part, row);
    }
    row[change.kind]++;
    const tokens = parsePointer(change.key);
    // A part of the document that is no collection (the calendar) has no things of its own to name.
    if (tokens.length < 2) continue;
    if (row.things.length >= listed) {
      row.more++;
      continue;
    }
    const value = getAt((change.kind === "removed" ? from : to) as JsonValue, tokens);
    row.things.push({ id: tokens[tokens.length - 1] ?? "", name: nameOf(value), kind: change.kind });
  }
  return { total: found.length, parts: [...parts.values()] };
}
