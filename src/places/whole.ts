// The rest of a place's record (plan §8.2): who and what is here, as the tree places them and where each stands; its history, the beats of
// the story that happened there, newest first; and who knows of it. Nothing is inferred: a place is where the records put it, a beat
// names its place by the ref it was written with, and a character knows a place where the world's own record says so.

import { isGone, kindIs, placeOfEntity } from "../engine/scope";
import { isThing } from "../engine/things";
import { spotOf, squareOf } from "../packs/space/core/grid-model";
import { whereOf } from "../packs/space/core/grid-play";
import type { Infer } from "../app";
import { storySliceOf } from "../story/fold";
import { storyAt } from "../story/path";
import { StoryRecord } from "../story/record";
import { questSliceOf } from "../quests";
import { type PlaceAt, placeDef } from "./record";
import { type CastKnowledge, knownByCast } from "./known";
import type { PlacesSettings } from "./settings";
import type { hereRow, historyRow, knownRow } from "./shapes";

export type PlaceHere = Infer<typeof hereRow>;
export type PlaceHistoryRow = Infer<typeof historyRow>;
export type PlaceKnown = Infer<typeof knownRow>;

/** Who and what is at a place, as the tree places them (a thing on or in a thing, or carried, is where its holder is), each with where it stands. */
export function hereOf(at: PlaceAt, place: string): PlaceHere[] {
  const { world, registry } = { world: at.ctx.world, registry: at.env.registry };
  const out: PlaceHere[] = [];
  for (const [id, e] of Object.entries(at.world.entities)) {
    if (isGone(at.world, id) || placeOfEntity(at.world, id) !== place) continue;
    const thing = isThing(at.ctx, id);
    if (!thing && !kindIs(registry, world, e.kind, "person")) continue;
    const held = e.relations.find((r) => r.type === "in" || r.type === "on");
    const holder = held === undefined ? undefined : at.world.entities[held.to];
    const spot = spotOf(world, at.world, id);
    const where = whereOf(at.world, id);
    out.push({
      ref: `entity:${id}`,
      name: e.name,
      kind: thing ? "thing" : "person",
      holder: held === undefined ? null : { ref: `entity:${held.to}`, name: holder?.name ?? held.to, how: held.type === "on" ? "on" : "in" },
      square: spot === null ? null : [...squareOf({ x: spot.x, y: spot.y })],
      zone: where?.zone ?? null,
      words: where?.words ?? null,
    });
  }
  return out;
}

/** The beats of the story at a place, newest first: the setting's number of them with a count of the rest. */
export function historyOf(at: PlaceAt, place: string, settings: Pick<PlacesSettings, "history">): { items: PlaceHistoryRow[]; more: number } {
  const story = new StoryRecord(storyAt(at.u, at.chat, at.turn), storySliceOf(at.state), questSliceOf(at.state));
  const ref = `place:${place}`;
  const beats = story.of("beat").filter((b) => b.fields.place_ref === ref);
  const newest = beats.slice().reverse();
  return {
    items: newest.slice(0, settings.history).map((b) => ({ beat: b.id, text: typeof b.fields.text === "string" ? b.fields.text : null, message: story.beatAt(b), turn: b.opened })),
    more: Math.max(0, newest.length - settings.history),
  };
}

/**
 * Who knows of a place: the people the world's own record says do (a `knows` link to it), marked as the world's, and the characters
 * whose knowledge names it (`cast`, where the application gives the cast), each with how it reached them and how well.
 */
export function knownOf(at: PlaceAt, place: string, cast?: CastKnowledge): PlaceKnown[] {
  if (placeDef(at, place) === undefined) return [];
  const world = Object.entries(at.world.entities)
    .filter(([id, e]) => !isGone(at.world, id) && e.relations.some((r) => r.type === "knows" && r.to === place))
    .map(([id, e]): PlaceKnown => ({ who: `entity:${id}`, name: e.name, by: "world", how: null, reach: null, precision: null, standing: null }));
  return [...world, ...(cast === undefined ? [] : knownByCast(cast, place))];
}
