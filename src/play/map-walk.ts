// Walk here, as the map panel's dock shows it before the step is sent (plan §8.2, §15.4; PlanChatUI-4 item 6):
// the minutes a step to a square of the grid the POV stands on would take, or why there is no way, judged by
// the engine on the real ground as the step itself will be. A page's grid is cut to what the player is shown, and
// under fog it lacks the walls he has not seen, so it cannot tell the way or its minutes; this read can.

import { route, shape } from "../app";
import { actionOdds } from "../engine/resolve";
import { readPass } from "../engine/read-pass";
import type { Store } from "../store";
import { chatContext } from "./things";

/** The words a square with no way to it is told in, where the engine gives no reason of its own. */
const NO_WAY = "No way there from here.";

export function mapWalkRoutes(store: Store) {
  return [
    route({
      method: "GET",
      path: "/api/v1/chats/:chat/walk",
      access: "page",
      group: "state",
      does: "What a step to a square of the grid the player's character stands on would take: its minutes, or the reason there is no way there.",
      query: { x: shape.whole({ least: 0 }), y: shape.whole({ least: 0 }) },
      reply: shape.object({ minutes: shape.number(), disabled: shape.optional(shape.text(), "Why the square cannot be walked to; left out where it can.") }),
      handle: ({ user, params, query }) =>
        readPass(() => {
          const ctx = chatContext(store, user, params.chat);
          const odds = actionOdds(ctx.registry, ctx.world, ctx.state, { action: "step", params: { x: query.x, y: query.y } });
          if (odds.available) return { minutes: odds.duration };
          return { minutes: 0, disabled: odds.failed !== null && odds.failed.code !== "requirement" ? odds.failed.reason : NO_WAY };
        }),
    }),
  ];
}
