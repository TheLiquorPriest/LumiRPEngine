// The lore's registration with the application (plan §4.1): its tables, its settings and its routes. The
// lore itself is made by the turn lane, over the books the door reads; its routes are made once every area
// is mounted, over the store and the turns' tags of the turn lane, which the composition hands it.

import type { DefinitionsApi, JobsApi, Scope } from "rp-harness/contract";
import type { Area } from "../app";
import type { Store } from "../store";
import { EntryNumbers } from "./ids";
import { loreIndexRoutes } from "./index-routes";
import type { LoreIndex } from "./indexing";
import { loreRoutes } from "./routes";
import { LORE_MIGRATIONS } from "./schema";
import { LORE_SETTINGS } from "./settings";
import type { LoreTurns } from "./sources";
import { proposalRoutes } from "./proposal-routes";
import type { LoreProposals } from "./proposals";
import type { LoreProjection } from "./projection";
import { projectionRoutes } from "./projection-routes";
import { type SecrecyDeps, secrecyOnReceipt, secrecyRules } from "./secrets";

/** What the lore's routes take from the turn lane: its store and the tags it keeps of each turn's prompt. */
export interface LoreTakes {
  store: Store;
  turns: LoreTurns;
  /**
   * What the lore index's routes need, from the turn lane and its harness: the index, RPH's jobs and definitions, and the
   * scope RPH asks a chat's in. Left out, the area adds the routes of the activated lore alone.
   */
  indexing?: { index: LoreIndex; jobs: Pick<JobsApi, "start">; definitions: Pick<DefinitionsApi, "list">; scope(user: string, chat: string): Scope };
  /** What the secrecy lane needs besides the store: the secrecy settings of a chat, the lines that word a mark, and the log. Left out, the lane answers that the secrets are not known. */
  secrecy?: Omit<SecrecyDeps, "store">;
  /** The proposals' queue and the record of writes to his lore, which the turn lane made and hands the agents' suggestions to. Left out, the area adds no route of theirs. */
  proposals?: LoreProposals;
  /** The projection book, which the turn lane made and refreshes; its switch's routes are added where it is given. */
  projection?: LoreProjection;
}

/** `takes` is asked once the turn lane is mounted: the routes are made then, and the secrecy lane answers from it; with none the area lists its tables and settings and adds no route. */
export function loreArea(takes?: () => LoreTakes): Area {
  return {
    name: "lore",
    tables: [{ area: "lore", migrations: LORE_MIGRATIONS }],
    settings: LORE_SETTINGS,
    ...(takes === undefined
      ? {}
      : {
          // The door's secrecy lane: today's verdict at the point of the path the question carries, from RPE's own state.
          fills: {
            door: {
              secrecy: async (ask, signal) => {
                const { store, secrecy } = takes();
                if (secrecy === undefined) throw new Error("RPE's secrecy lane is not given its settings and wording.");
                return secrecyRules({ store, ...secrecy })(ask, signal);
              },
              // The check on receipt (R-59): the same verdict, at the point the generation's turn starts from, over the entries RPE read itself.
              receiptSecrecy: async (ask, signal) => {
                const { store, secrecy } = takes();
                if (secrecy === undefined) throw new Error("RPE's secrecy lane is not given its settings and wording.");
                return secrecyOnReceipt({ store, ...secrecy })(ask, signal);
              },
            },
          },
          mounted: (at) => {
            const { store, turns, indexing, proposals, projection } = takes();
            at.routes.add("lore", [
              ...loreRoutes({ store, turns, numbers: new EntryNumbers(at.db, at.writes) }),
              ...(indexing === undefined ? [] : loreIndexRoutes(indexing)),
              ...(proposals === undefined ? [] : proposalRoutes(proposals)),
              ...(projection === undefined ? [] : projectionRoutes(projection)),
            ]);
          },
        }),
  };
}
