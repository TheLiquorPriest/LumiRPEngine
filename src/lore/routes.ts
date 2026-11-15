// The lore's routes (plan §9.1, §14), declared in the route form (`src/app/routes.ts`) so that the pages'
// types and the API reference are written from them: the lore Lumiverse activated for a turn's prompt,
// each entry by the id the lore map gives it beside Lumiverse's own. The floor's measure and the Turn page
// read it. It answers only for the user this RPE belongs to, from the one reader of `./activated.ts`.

import type { ActivatedLore } from "rp-harness/contract";
import { type Exactly, type Holds, type Infer, route, shape } from "../app";
import { JoinedTurnError, type Store } from "../store";
import { type ActivatedLoreDeps, type ActivatedLoreEntry, activatedLore } from "./activated";
import { HOWS } from "./lore";

export const TURN_LORE_PATH = "/api/v1/chats/:chat/turns/:turn/lore";

const T = shape.text();
const field = shape.field;

const how = shape.named("LoreActivation", "How Lumiverse activated an entry: always on, by one of its keys, by meaning, or still in force from an earlier turn.", shape.oneOf(...HOWS));
type HowMirrored = Holds<Exactly<Infer<typeof how>, NonNullable<ActivatedLore["how"]>>>;

const activatedRow = shape.named(
  "TurnLoreRow",
  "An entry Lumiverse activated for a turn's prompt: its lore map id, its id and its book's id in Lumiverse, its title, and how it activated where the turn's tag says.",
  shape.object({
    id: field(T, "The id the Author's lore map gives the entry: `e-` and its number."),
    entry: field(T, "Lumiverse's id of the entry."),
    book: field(T, "Lumiverse's id of its book; empty where the tag does not say."),
    title: field(T, "Its title as Lumiverse gave it."),
    how: field(shape.nullable(how), "How it activated; null where the tag does not say."),
  }),
);
type RowMirrored = Holds<Exactly<Infer<typeof activatedRow>, ActivatedLoreEntry>>;

export const turnLoreReply = shape.named(
  "TurnLoreReply",
  "The lore Lumiverse activated for a turn's prompt, in the order the turn's tag lists it; none for a turn RPE holds no tag for.",
  shape.object({ entries: shape.list(activatedRow) }),
);
export type TurnLore = Infer<typeof turnLoreReply>;

/** The checks above hold, and are read by no one. */
export type Mirrors = [HowMirrored, RowMirrored];

export interface LoreRoutesDeps extends ActivatedLoreDeps {
  /** RPE's store: whether a turn was joined to another. */
  store: Store;
}

export function loreRoutes(deps: LoreRoutesDeps) {
  return [
    route({
      method: "GET",
      path: TURN_LORE_PATH,
      access: "page",
      group: "lore",
      does: "The lore Lumiverse activated for a turn's prompt, in the tag's order: each entry's lore map id, its id and book in Lumiverse, its title and how it activated where the tag says; none for a turn RPE holds no tag for, or one of another chat.",
      reply: turnLoreReply,
      joined: true,
      handle: async ({ user, params }): Promise<TurnLore> => {
        // A turn joined to another (a continue's held turn) is answered as a fact, for the server to answer in its one place.
        const row = deps.store.user(user).turn(params.turn);
        if (row !== null && row.chat === params.chat && row.joined !== null) throw new JoinedTurnError(params.turn, row.joined);
        return { entries: await activatedLore(deps, user, params.chat, params.turn) };
      },
    }),
  ] as const;
}
