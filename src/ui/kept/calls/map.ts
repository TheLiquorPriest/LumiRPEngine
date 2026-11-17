// The map panel's Walk here read, on RPE's typed route (plan §8.2, §15.4; PlanChatUI-4 item 6): what a step to a
// square of the grid the player's character stands on would take, or why there is no way, judged by RPE on the
// real ground as the step itself will be. The player's choice of Known or Fog is not taken here: the App's map
// hand writes it as the chat's own setting `map.display` (`../maps.ts`).

import type { RequestBody } from "../../../frontend/registry";
import type { CallContext, CallFile, ServedBody } from "../client";
import { Refusal } from "../client";

type MapAsk = Extract<RequestBody, { type: "lre.map" }>;

function isWalk(request: RequestBody): request is MapAsk & { op: "walk"; x: number; y: number } {
  return request.type === "lre.map" && request.op === "walk";
}

export const calls: CallFile = {
  name: "map",
  takes: isWalk,
  async serve(request, ctx: CallContext): Promise<ServedBody> {
    if (!isWalk(request)) throw new Refusal("internal", "The map calls do not take that request.");
    const walk = await ctx.client.call("GET /api/v1/chats/:chat/walk", { chat: request.chatId }, { query: { x: request.x, y: request.y } });
    return { walk };
  },
};
