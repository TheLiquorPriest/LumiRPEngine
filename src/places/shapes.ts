// What the places routes take and answer (plan §8.2, §14), declared field by field so that the pages' types and the API reference say
// what a page is sent: the list of the chat's places, and one place's record with its nine parts. The record reader (`record.ts`) gives
// these shapes; the lines the world state and `world_query` carry (`lines.ts`) are drawn from the same data.

import { type Infer, shape } from "../app";

const T = shape.text();
const N = shape.number();
const field = shape.field;
const nullable = shape.nullable;

const standing = shape.oneOf("established", "proposed", "assumed");
const precision = shape.oneOf("exact", "approximate", "vague", "unknown");
const source = shape.oneOf("prose", "lore", "author", "gm", "character", "player", "import", "default", "invented");

/** A place's kinds: one of the world's own, or a room, a spot or a venue made inside one. */
export const placeKinds = shape.oneOf("place", "room", "spot", "venue");

export const beatRef = shape.named(
  "PlaceBeatRef",
  "The beat of the story that caused something: its id, its words and the number of the message it lies at (null while that is not on the chat's path).",
  shape.object({ id: T, text: nullable(T), message: nullable(shape.whole({ least: 0 })) }),
);

export const factRow = shape.named(
  "PlaceFactRow",
  "A fact of the place as the record keeps it: its key and words, the turn that wrote it and that turn's number, the story time then (null where the chat shows no date), the beat that caused it, and how exact, how sure and from where.",
  shape.object({
    id: T,
    key: T,
    value: T,
    turn: shape.turnId(),
    n: shape.whole({ least: 0 }),
    time: field(nullable(T), "Story time after that turn; null while the chat's clock shows no date."),
    beat: nullable(beatRef),
    precision: nullable(precision),
    standing: nullable(standing),
    source: nullable(source),
    by: nullable(T),
  }),
);
export type PlaceFactRow = Infer<typeof factRow>;

/** A part's entries, as many as the setting shows, and how many were left out. */
const counted = <S extends Parameters<typeof shape.list>[0]>(item: S, doc: string) => shape.object({ items: field(shape.list(item), doc), more: field(shape.whole({ least: 0 }), "How many entries were left out; the entries it shows are the newest.") });

const square = shape.list(shape.whole({ least: 0 }));

export const sourceRow = shape.named(
  "PlaceSourceRow",
  "A lore entry bound to the place, read live: its id, the aspect it defines, who bound it, its title and revision now (null where Lumiverse no longer holds it), the revision the base was drawn against, and whether the base is older than it.",
  shape.object({ entry: T, aspect: T, by: T, title: nullable(T), revision: nullable(T), drawn: nullable(T), newer: shape.yesNo() }),
);
export type PlaceSourceRow = Infer<typeof sourceRow>;

export const baseShown = shape.named(
  "PlaceBase",
  "What the place is and looks like, in the words that stand: the Author's or the player's own, or, until one is written, the world's. `world` says whose; `older`: an entry bound to the place changed, went or was bound since the base was drawn.",
  shape.object({
    text: nullable(T),
    world: field(shape.yesNo(), "These are the world's own words for the place, at its revision; no base was written."),
    revision: field(nullable(T), "The revision of the world the words are the world's at; null for a written base."),
    by: nullable(T),
    turn: nullable(shape.turnId()),
    older: shape.yesNo(),
  }),
);

export const fixtureRow = shape.object({ name: T, at: field(square, "Its top left square, column then row."), size: field(square, "Its box, columns then rows.") });
export const zoneRow = shape.object({ name: T, squares: shape.whole({ least: 0 }) });
export const doorRow = shape.object({ at: field(square, "Its square, column then row."), state: shape.oneOf("open", "closed", "locked") });
export const entryRow = shape.named(
  "PlaceEntry",
  "Who may enter: the audience the world or play set, and the place that sets it (the place itself, or one above it).",
  shape.object({ audience: T, at: T, name: T, inherited: shape.yesNo() }),
);

export const hereRow = shape.named(
  "PlaceHereRow",
  "Someone or something at the place as the tree places it: its id and name, whether it is a person or a thing, what it is on or in, and where it stands (a square, a zone or words).",
  shape.object({ ref: T, name: T, kind: shape.oneOf("person", "thing"), in: nullable(T), square: nullable(square), zone: nullable(T), words: nullable(T) }),
);

export const wayRow = shape.named(
  "PlaceWayRow",
  "A way that joins the place to another: the place it leads to, each way of travel with its minutes and distance, whether it goes both ways, and for a way the chat laid or changed the turn that did it.",
  shape.object({
    route: T,
    to: shape.object({ id: T, name: T }),
    modes: shape.list(shape.object({ mode: T, minutes: N, km: nullable(N) })),
    both: shape.yesNo(),
    turn: nullable(shape.turnId()),
  }),
);

export const adjoiningRow = shape.object({ id: T, name: T, how: field(shape.oneOf("beside", "way"), "Beside it, in the same place; or joined by a way.") });

export const historyRow = shape.object({ beat: T, text: nullable(T), message: nullable(shape.whole({ least: 0 })), turn: shape.turnId() });

export const knownRow = shape.named(
  "PlaceKnownRow",
  "Someone who knows of the place: who, whether the world's own record says so or a character's knowledge names it, how it was learned and how well it is known.",
  shape.object({ who: T, name: T, by: shape.oneOf("world", "knowledge"), how: nullable(T), reach: nullable(T), precision: nullable(precision), standing: nullable(standing) }),
);

export const placeRecordReply = shape.named(
  "PlaceRecord",
  "A place's record, at the chat's newest turn or as it stood at one of its turns, in its nine parts: its sources, its base, what the story changed there since, its features, who and what is here, its ways, its access and state, its history and who knows of it.",
  shape.object({
    place: T,
    ref: T,
    name: T,
    parent: nullable(shape.object({ id: T, name: T })),
    kind: placeKinds,
    grid: field(shape.yesNo(), "The place draws a grid of its own."),
    made: field(shape.yesNo(), "Play made it; the world does not have it."),
    turn: field(nullable(shape.turnId()), "The turn read at; null: the chat's newest."),
    sources: shape.list(sourceRow),
    base: baseShown,
    since: counted(factRow, "What the story changed at the place, oldest first among the newest."),
    features: shape.object({
      facts: counted(factRow, "Its facts of part feature, oldest first among the newest."),
      fixtures: field(shape.list(fixtureRow), "What its grid draws as a fixture."),
      zones: field(shape.list(zoneRow), "The zones its grid names."),
    }),
    here: shape.list(hereRow),
    ways: shape.object({ ways: shape.list(wayRow), adjoining: shape.list(adjoiningRow) }),
    access: shape.object({
      entry: field(nullable(entryRow), "Who may enter; null where neither the world nor play set an entry."),
      facts: counted(factRow, "Its facts of part access, oldest first among the newest."),
      doors: field(shape.list(doorRow), "The state of each door on its grid."),
    }),
    history: shape.object({ items: shape.list(historyRow), more: shape.whole({ least: 0 }) }),
    known: shape.list(knownRow),
  }),
);
export type PlaceRecordAnswer = Infer<typeof placeRecordReply>;

export const placeRow = shape.named(
  "PlaceRow",
  "A place of the chat as it is played: its id and name, the place it is in, what kind it is, and whether it draws a grid.",
  shape.object({ place: T, name: T, parent: nullable(shape.object({ id: T, name: T })), kind: placeKinds, grid: shape.yesNo(), made: shape.yesNo() }),
);
export type PlaceRowShown = Infer<typeof placeRow>;

export const placesReply = shape.named("Places", "A page of the chat's places as it plays them, the world's own and those made in play, the places inside a place after it, in the order the world lists them.", shape.page(placeRow));
export type PlacesPage = Infer<typeof placesReply>;

export const baseBody = shape.object({ text: field(T, "The place's base: what it is and looks like, in the owner's words.") });
export type PlaceBaseBody = Infer<typeof baseBody>;

export const baseWritten = shape.named(
  "PlaceBaseWritten",
  "A base the owner wrote: the change that holds it (a player's own change, which he can undo from the review card), the base as it now reads and the entries it was drawn against.",
  shape.object({ change: T, base: baseShown, sources: shape.list(sourceRow) }),
);
export type PlaceBaseWritten = Infer<typeof baseWritten>;

