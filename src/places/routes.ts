// The Places page's routes (plan §8.2, §14): the chat's places as it plays them, a page at a time; one place's record in its nine parts,
// at the chat's newest turn or as it stood at one of its turns; and the owner's own base for a place. Every route is a page's: it
// answers only for the user this RPE belongs to. The base the owner writes is a change of his own, placed after the chat's newest reply
// on its own line (so a swipe of that reply keeps it, and a turn that is running goes on from the state it started with), drawn against
// the entries bound to the place as they stand, and he undoes it from the review card. A place's sources are edited through the lore's
// binding route naming the place; the record shows the change at once. The words of every refusal are lines of
// `.prompts/story-answers.md`, as the chat has them.

import { route, RouteError, shape } from "../app";
import type { Writes } from "../iface/kit";
import type { GuidanceFiles } from "../iface/texts";
import { JoinedTurnError, type Store } from "../store";
import { storyLines } from "../story/kit";
import { baseAt } from "./base";
import type { CastKnowledge } from "./known";
import { baseOf, placeSliceOf, sourcesOf } from "./fold";
import { placeAt, type PlaceAt } from "./record";
import { type PlaceReadDeps, placeRow, placeRows, readPlace, sourceRows } from "./read";
import { PLACES_DEFAULTS, type PlacesSettings } from "./settings";
import { baseBody, baseWritten, type PlaceBaseWritten, type PlaceRecordAnswer, placeRecordReply, type PlacesPage, placesReply } from "./shapes";
import { drawnFrom, type PlaceSourcesReader, sourcesNow } from "./sources";
import { writeBase } from "./write";

export const PLACES_PATH = "/api/v1/chats/:chat/places";
export const PLACE_PATH = "/api/v1/chats/:chat/places/:place";
export const PLACE_BASE_PATH = "/api/v1/chats/:chat/places/:place/base";

/** Who a change from the page is by: the player, as the store's sources name them and the play panels record their taps. */
const PLAYER = "player";

export interface PlacesRoutesDeps {
  store: Store;
  /** The application's write queue: every write goes through it. */
  writes: Writes;
  /** The guidance files in force for the chat: the page's words are lines of `.prompts/story-answers.md`. */
  files(user: string, chat: string): GuidanceFiles;
  /** The places' settings for the chat, over `PLACES_DEFAULTS`: the page of the list and what a record shows of each part. */
  settings(user: string, chat: string): Promise<Partial<PlacesSettings>>;
  /** What the record reads of the lore: the entries bound to a place and each as Lumiverse holds it now. Left out, no entry is bound to any place. */
  sources?: PlaceSourcesReader;
  /** The cast at a point of the chat's path (null: its head), for who knows of a place: every character's record and their names. Left out, only the world's own record of who knows. */
  cast?(user: string, chat: string, turn: string | null): CastKnowledge;
}

/** Why a page's request is not done: the line of the story's answers that says so. */
async function refuse(deps: PlacesRoutesDeps, user: string, chat: string, status: number, line: string, fields: Record<string, string | number>): Promise<never> {
  const lines = await storyLines(deps.files(user, chat));
  throw new RouteError(status, lines.line(line, fields) ?? "");
}

/**
 * The chat read at the turn named (none: its head), a chat RPE does not hold as an untouched one; a turn joined to another is answered
 * as the fact it is, for the server to say in its one place.
 */
async function readingAt(deps: PlacesRoutesDeps, user: string, chat: string, turn: string | null): Promise<PlaceAt> {
  const s = deps.store.user(user);
  if (turn !== null) {
    const row = s.turn(turn);
    if (row === null || row.chat !== chat) return refuse(deps, user, chat, 404, "no_turn", { id: turn });
    if (row.joined !== null) throw new JoinedTurnError(turn, row.joined);
  }
  const at = placeAt(deps.store, user, chat, turn);
  if (at === null) return refuse(deps, user, chat, 404, "no_chat", { id: chat });
  return at;
}

export function placesRoutes(deps: PlacesRoutesDeps) {
  const settingsOf = async (user: string, chat: string): Promise<PlacesSettings> => ({ ...PLACES_DEFAULTS, ...(await deps.settings(user, chat)) });
  const sizes = async ({ params, user }: { params: Readonly<Record<string, string>>; user: string | null }): Promise<{ default: number; most: number }> => {
    const size = user === null ? PLACES_DEFAULTS.page : (await settingsOf(user, params.chat ?? "")).page;
    return { default: size, most: size * 10 };
  };
  const readDeps = (settings: PlacesSettings, user: string, chat: string, turn: string | null): PlaceReadDeps => ({ settings, ...(deps.sources !== undefined ? { sources: deps.sources } : {}), ...(deps.cast !== undefined ? { cast: deps.cast(user, chat, turn) } : {}) });

  return [
    route({
      method: "GET",
      path: PLACES_PATH,
      access: "page",
      group: "places",
      does: "The chat's places as it plays them, the world's own and those made in play, a page at a time, at the chat's newest turn or as it stood at one of its turns: each with the place it is in, what kind of place it is and whether it draws a grid of its own.",
      query: { turn: shape.optional(shape.turnId(), "A turn's id: the places as they stood at that turn; left out, at the chat's newest.") },
      reply: placesReply,
      paged: { sizes },
      joined: true,
      handle: async ({ user, params, query }): Promise<PlacesPage> => {
        const at = await readingAt(deps, user, params.chat, query.turn ?? null);
        const rows = placeRows(at);
        const start = query.after === undefined ? 0 : rows.findIndex((r) => r.place === query.after) + 1;
        if (start === 0 && query.after !== undefined) return refuse(deps, user, params.chat, 409, "place_gone", { id: query.after });
        const page = rows.slice(start, start + query.limit);
        const last = page.at(-1);
        return { items: page, next: last !== undefined && start + page.length < rows.length ? last.place : null };
      },
    }),
    route({
      method: "GET",
      path: PLACE_PATH,
      access: "page",
      group: "places",
      does: "One place of the chat in full, by its id or its name, at the chat's newest turn or as it stood at one of its turns, in its nine parts: its sources read live and its base, what the story changed there, its features, who and what is here, its ways, its access and state, its history and who knows of it.",
      query: { turn: shape.optional(shape.turnId(), "A turn's id: the place as it stood at that turn; left out, at the chat's newest.") },
      reply: placeRecordReply,
      joined: true,
      handle: async ({ user, params, query }): Promise<PlaceRecordAnswer> => {
        const at = await readingAt(deps, user, params.chat, query.turn ?? null);
        const settings = await settingsOf(user, params.chat);
        const found = placeRow(at, params.place) !== null ? params.place : placeRows(at).find((r) => r.name.toLowerCase() === params.place.toLowerCase())?.place;
        const record = found === undefined ? null : await readPlace(at, found, readDeps(settings, user, params.chat, query.turn ?? null));
        return record ?? refuse(deps, user, params.chat, 404, "no_place", { id: params.place });
      },
    }),
    route({
      method: "PUT",
      path: PLACE_BASE_PATH,
      access: "page",
      group: "places",
      does: "Writes the owner's own words as a place's base, a change of his own with source player, placed after the chat's newest reply on its own line: swiping that reply keeps it and a turn that is running goes on from the state it started with. It is drawn against the entries bound to the place as they stand, so the base is no longer marked older than its sources; he undoes it from the review card.",
      body: baseBody,
      reply: baseWritten,
      handle: async ({ user, params, body }): Promise<PlaceBaseWritten> => {
        const read = await readingAt(deps, user, params.chat, null);
        if (placeRow(read, params.place) === null) return refuse(deps, user, params.chat, 404, "no_place", { id: params.place });
        // The entries bound to the place are read as Lumiverse holds them now, before the queued write: what the base is drawn against.
        const held = sourcesOf(placeSliceOf(read.state), params.place);
        const before = deps.sources === undefined ? { sources: [], older: false } : await sourcesNow(deps.sources, { user, chat: params.chat }, params.place, null, held);
        const change = await deps.writes.run(() => writeBase(deps.store, { user, chat: params.chat, turn: null, by: PLAYER }, params.place, body.text.trim(), drawnFrom(before.sources)), "writing a place's base from a page");
        const after = await readingAt(deps, user, params.chat, null);
        const sources = deps.sources === undefined ? { sources: [], older: false } : await sourcesNow(deps.sources, { user, chat: params.chat }, params.place, baseOf(placeSliceOf(after.state), params.place), sourcesOf(placeSliceOf(after.state), params.place));
        return { change: String(change), base: baseAt(after, params.place, sources), sources: sourceRows(sources.sources) };
      },
    }),
  ] as const;
}
