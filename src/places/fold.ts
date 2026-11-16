// The places as an area of the store (plan §6.2, §7.1, §8.2, Appendix B "Places"): what a place's record keeps of its own, its base, is a
// change of the area, `place.<op>`, folded along the path with the engine's, so a swipe or a delete takes a turn's base off with the
// turn, a branch has those of the turns it shares, and one is undone by the area's own reverse. A base is the Author's words for what a
// place is and looks like, kept with the revision of each lore entry it was drawn against, as a character's base is. The rest of the
// record is read from where it already lives: the entries bound to the place, the facts about it, its grid, its ways, the beats of the
// story. Code folds and compares revisions; it never judges what a base says.

import type { JsonObject, JsonValue } from "../shared/json";
import { isRecord } from "../shared/json";
import type { AreaChange, AreaOp, AreaOutcome, AreaPart, Source, StoreArea, StoreState } from "../store";

/** The area's name: its operations are `place.<op>`. */
export const PLACE_AREA_ID = "place";

/** The operations of the area, by their names in the changes. */
export const PLACE_OPS = {
  /** A place's base written whole: `{ place, text, drawn }`, `drawn` the revision of each bound entry it was drawn against, by entry id. */
  base: "place.base",
  /** What undoes one: `{ place, was }` puts the base as it stood back, or, with `was` null, takes the base away. */
  restore: "place.restore",
} as const;

/** One version of a base as the area keeps it: the turn that wrote it (and its number on the path), who, from where, its words, and what it was drawn against. */
export interface BaseVersionDoc {
  turn: string;
  n: number;
  by: string | null;
  source: Source | null;
  text: string;
  /** The revision of each bound entry the words were drawn against, by entry id. */
  drawn: Record<string, string>;
}

/** A place's base as the slice keeps it: its words as they now stand (the last version) and every version on the path, oldest first. */
export interface BaseDoc extends BaseVersionDoc {
  place: string;
  versions: BaseVersionDoc[];
}

/** The area's slice of the folded state. */
export interface PlaceSlice {
  /** The bases written in play, by place id. */
  bases: Record<string, BaseDoc>;
}

export function emptyPlaceSlice(): PlaceSlice {
  return { bases: {} };
}

/** The slice as the area holds it. */
function asSlice(slice: Readonly<JsonObject>): PlaceSlice {
  return slice as unknown as PlaceSlice;
}

function json(slice: PlaceSlice): JsonObject {
  return slice as unknown as JsonObject;
}

/** A base's change as it is sent: `{ place, text, drawn }`. */
export interface BaseValue {
  place: string;
  text: string;
  drawn: Record<string, string>;
}

function readsAsBase(value: JsonValue): string | null {
  if (!isRecord(value)) return "a base is an object";
  if (typeof value.place !== "string" || value.place === "") return "a base names its place by id";
  if (typeof value.text !== "string" || value.text.trim() === "") return "a base holds its words";
  if (!isRecord(value.drawn) || !Object.values(value.drawn).every((v) => typeof v === "string")) return "a base holds the revision of each entry it was drawn against, by entry id";
  return null;
}

const BASE: AreaOp = {
  check: readsAsBase,
  apply(slice, change: AreaChange): AreaOutcome {
    const s = asSlice(slice);
    const v = change.value as unknown as BaseValue;
    const version: BaseVersionDoc = { turn: change.turn, n: change.n, by: change.by, source: change.source, text: v.text, drawn: { ...v.drawn } };
    const before = Object.hasOwn(s.bases, v.place) ? s.bases[v.place] : undefined;
    const doc: BaseDoc = { ...version, place: v.place, versions: [...(before?.versions ?? []), version] };
    return { slice: json({ ...s, bases: { ...s.bases, [v.place]: doc } }) };
  },
  touches(value): readonly AreaPart[] {
    return [{ ref: `place:${(value as unknown as BaseValue).place}`, part: "base" }];
  },
  undo(value, before) {
    const v = value as unknown as BaseValue;
    const was = Object.hasOwn(asSlice(before).bases, v.place) ? asSlice(before).bases[v.place] : null;
    return [{ op: "restore", value: { place: v.place, was: was as unknown as JsonValue } }];
  },
};

const RESTORE: AreaOp = {
  check(value) {
    if (!isRecord(value) || typeof value.place !== "string" || value.place === "") return "a restore names its place by id";
    if (value.was !== null && !isRecord(value.was)) return "a restore holds the base as it stood, or null";
    return null;
  },
  apply(slice, change): AreaOutcome {
    const s = asSlice(slice);
    const v = change.value as unknown as { place: string; was: BaseDoc | null };
    const bases = { ...s.bases };
    if (v.was === null) delete bases[v.place];
    else bases[v.place] = v.was;
    return { slice: json({ ...s, bases }) };
  },
  touches(value): readonly AreaPart[] {
    return [{ ref: `place:${(value as unknown as { place: string }).place}`, part: "base" }];
  },
};

/** A place's base in a slice, or none (the place stands on the world's own words until one is written). */
export function baseOf(slice: Readonly<PlaceSlice>, place: string): BaseDoc | null {
  return Object.hasOwn(slice.bases, place) ? (slice.bases[place] ?? null) : null;
}

/** The slice of a folded state: the area's, or an empty one where the store opened without it. */
export function placeSliceOf(state: Pick<StoreState, "areas">): PlaceSlice {
  const slice = state.areas?.[PLACE_AREA_ID];
  return slice === undefined ? emptyPlaceSlice() : asSlice(slice);
}

const READS: NonNullable<StoreArea["reads"]> = {
  /** A place's base: `{ text, drawn, turn }`, null where none is written. */
  base(slice, args) {
    const doc = typeof args.place === "string" ? baseOf(asSlice(slice), args.place) : null;
    return doc === null ? null : { text: doc.text, drawn: doc.drawn, turn: doc.turn };
  },
};

/** The places' area, as the store opens with it. */
export const PLACE_STORE_AREA: StoreArea = {
  id: PLACE_AREA_ID,
  initial: () => json(emptyPlaceSlice()),
  ops: { base: BASE, restore: RESTORE },
  reads: READS,
};
