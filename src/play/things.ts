// A chat's things, read at its head (plan §14, §15.4; PlanChatUI-P3): the list of what is in play and who
// has it, a thing's page, a person's things, a search by words, and the catalog of types and vehicle
// classes the player's + Add offers. Each is today's pure read (`engine/thing-view.ts`), asked of the
// played world and the state at the chat's head, as RPE's store holds them: the answers are what the
// previous build's `lre.things` gave, and the page's own call file (`ui/kept/calls/things.ts`) takes them
// by the typed route. A chat of another user, or none RPE holds, is none.

import { RouteError, route, shape } from "../app";
import { findThingIds, personThings, thingPage, thingPicks, thingTypes, thingsList } from "../engine/thing-view";
import { playedWorld } from "../engine/places-in-play";
import { readPass } from "../engine/read-pass";
import type { ReadContext } from "../engine/registry";
import type { JsonValue } from "../shared/json";
import type { Store } from "../store";

/** The context the things are read in for a chat at its head: its played world and its state. */
function contextOf(store: Store, user: string, chat: string): ReadContext {
  const s = store.user(user);
  const row = s.chat(chat);
  if (row === null || row.world === null) throw new RouteError(404, `Chat ${chat} plays no world of yours.`);
  const state = s.headState(chat).state.world;
  const doc = store.env.worlds(state.revision) ?? (row.revision === null ? undefined : store.env.worlds(row.revision));
  if (doc === undefined) throw new RouteError(404, `Chat ${chat}'s world is not kept.`);
  return store.env.registry.context(playedWorld(doc, state), state);
}

const answer = shape.json();

export function thingsRoutes(store: Store) {
  const read = <T>(user: string, chat: string, run: (ctx: ReadContext) => T): JsonValue => readPass(() => run(contextOf(store, user, chat))) as unknown as JsonValue;
  return [
    route({
      method: "GET",
      path: "/api/v1/chats/:chat/things",
      access: "page",
      group: "state",
      does: "The chat's things at its head: each thing in play with who has it, where it stands and why it is theirs, as the things browser lists them.",
      reply: answer,
      handle: ({ user, params }) => read(user, params.chat, (ctx) => thingsList(ctx)),
    }),
    route({
      method: "GET",
      path: "/api/v1/chats/:chat/things/types",
      access: "page",
      group: "state",
      does: "The catalog the player's + Add offers: the types of things and the vehicle classes the chat's world has, and the pickers that go with them.",
      reply: answer,
      handle: ({ user, params }) => read(user, params.chat, (ctx) => ({ types: thingTypes(ctx), pick: thingPicks(ctx) })),
    }),
    route({
      method: "GET",
      path: "/api/v1/chats/:chat/things/find",
      access: "page",
      group: "state",
      does: "The ids of the chat's things that the words name.",
      query: { words: shape.text() },
      reply: answer,
      handle: ({ user, params, query }) => read(user, params.chat, (ctx) => findThingIds(ctx, query.words)),
    }),
    route({
      method: "GET",
      path: "/api/v1/chats/:chat/things/:entity",
      access: "page",
      group: "state",
      does: "A thing's page: what it is, where it stands, who has it and why, what it holds, its rest and its history; none for an id that is no thing.",
      reply: answer,
      handle: ({ user, params }) =>
        read(user, params.chat, (ctx) => {
          const thing = thingPage(ctx, params.entity);
          if (thing === null) throw new RouteError(404, `Chat ${params.chat} has no thing ${params.entity}.`);
          return { thing, pick: thingPicks(ctx) };
        }),
    }),
    route({
      method: "GET",
      path: "/api/v1/chats/:chat/people/:entity/things",
      access: "page",
      group: "state",
      does: "A person's things: what they carry, wear and keep, and where each is; none for an id that is no person.",
      reply: answer,
      handle: ({ user, params }) =>
        read(user, params.chat, (ctx) => {
          const person = personThings(ctx, params.entity);
          if (person === null) throw new RouteError(404, `Chat ${params.chat} has no person ${params.entity}.`);
          return { person, pick: thingPicks(ctx) };
        }),
    }),
  ] as const;
}
