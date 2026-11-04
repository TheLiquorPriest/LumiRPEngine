// The places family's writes (AGENT-LOOP-PLAN §6; INC1-SPEC R3b; ITEMS-SPEC §6.2, §7.3): a move to a
// place, proposed as the GM editor's Move, the one path every move in the story takes; and a place
// made in play, or one renamed, as the place op of the same name (`PlaceOp`), sent as the GM edit
// `{op: "place", change}` the space pack works out (`space.place_op`: found by name under its parent
// first, so a place is never made twice). A place made for someone the reply puts there goes with
// the reply's read instead, as its `place_make` fact (the place and the move one change), noted by
// the Curator's call.

import { PLACE_KINDS, type PlaceKind, type PlaceOp } from "../../../../shared/things";
import { AUDIENCES, type Audience } from "../../../../shared/org";
import type { JsonObject } from "../../../../shared/json";
import { BOOLEAN, boolArg, gmEdit, needId, noteFact, propose, TEXT_LIST, wordsArg } from "../propose";
import type { ToolDefinition } from "../registry";
import { resolveEntity, resolvePlace } from "../resolve";
import { argGiven, badValue, needText, objectSchema, text, textArg } from "../schema";
import { checkOrPropose } from "./items";

export const PLACES_WRITES: readonly ToolDefinition[] = [
  {
    name: "gm_move",
    family: "places",
    tier: "gm",
    parameters: () => objectSchema({ entity: text(), to: text() }, ["entity", "to"]),
    async run(args, env) {
      const view = await env.reader.view();
      const entity = needId(view, "gm_move", args, "entity", resolveEntity);
      if (typeof entity !== "string") return entity;
      const to = needId(view, "gm_move", args, "to", resolvePlace);
      if (typeof to !== "string") return to;
      return propose(view, env.writer, gmEdit({ op: "move", entity, to }));
    },
  },
  {
    name: "place_make",
    family: "places",
    tier: "story",
    parameters: () => objectSchema({ name: text(), parent: text(), as: text([...PLACE_KINDS]), aliases: TEXT_LIST, description: text(), entry: text([...AUDIENCES]), entity: text(), why: text(), dry: BOOLEAN }, ["name", "parent", "as", "why"]),
    async run(args, env) {
      const view = await env.reader.view();
      const name = needText(view, "place_make", args, "name");
      if (typeof name !== "string") return name;
      const parent = needId(view, "place_make", args, "parent", resolvePlace);
      if (typeof parent !== "string") return parent;
      const said = needText(view, "place_make", args, "as");
      if (typeof said !== "string") return said;
      const as = PLACE_KINDS.find((k): k is PlaceKind => k === said.toLowerCase());
      if (as === undefined) return badValue(view, "place_make", "as", said, PLACE_KINDS);
      const why = needText(view, "place_make", args, "why");
      if (typeof why !== "string") return why;
      const entrySaid = textArg(args, "entry");
      const entry = entrySaid === null ? undefined : AUDIENCES.find((a): a is Audience => a === entrySaid.toLowerCase());
      if (entrySaid !== null && entry === undefined) return badValue(view, "place_make", "entry", entrySaid, AUDIENCES);
      const aliases = wordsArg(args, "aliases");
      const description = textArg(args, "description");
      // Someone the reply puts there goes with the place: the reply's read makes it and moves them as one change.
      if (argGiven(args, "entity")) {
        const entity = needId(view, "place_make", args, "entity", resolveEntity);
        if (typeof entity !== "string") return entity;
        return noteFact(view, env, { type: "place_make", place: name, parent, as, entity, why, ...(aliases && aliases.length > 0 ? { aliases } : {}), ...(description !== null ? { description } : {}) });
      }
      const change: PlaceOp = { do: "make", name, parent, as, why, ...(aliases && aliases.length > 0 ? { aliases } : {}), ...(description !== null ? { description } : {}), ...(entry !== undefined ? { entry } : {}) };
      return checkOrPropose(view, env, { place: change as unknown as JsonObject }, boolArg(args, "dry") === true);
    },
  },
  {
    name: "place_label",
    family: "places",
    tier: "story",
    parameters: () => objectSchema({ place: text(), name: text(), aliases: TEXT_LIST, description: text(), dry: BOOLEAN }, ["place"]),
    async run(args, env) {
      const view = await env.reader.view();
      const place = needId(view, "place_label", args, "place", resolvePlace);
      if (typeof place !== "string") return place;
      const name = textArg(args, "name");
      const aliases = wordsArg(args, "aliases");
      const description = typeof args.description === "string" ? args.description : null;
      const change: PlaceOp = { do: "label", place, ...(name !== null ? { name } : {}), ...(aliases !== null ? { aliases } : {}), ...(description !== null ? { description } : {}) };
      return checkOrPropose(view, env, { place: change as unknown as JsonObject }, boolArg(args, "dry") === true);
    },
  },
];
