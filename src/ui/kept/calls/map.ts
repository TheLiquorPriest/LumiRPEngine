// The map panel's reads, on RPE's typed routes (plan §8.2, §15.4; PlanChatUI-4 item 6): Walk here, what a step to a square of the
// grid the player's character stands on would take, or why there is no way, judged by RPE on the real ground as the step itself will
// be; the quickest way's minutes to each place there is a way to, when the list of places opens; and every way to one place, when its
// sheet opens. The ways are no part of the state view: they are read when they are shown. The player's choice of Known or Fog is not
// taken here: the App's map hand writes it as the chat's own setting `map.display` (`../maps.ts`).

import type { RequestBody } from "../../../frontend/registry";
import type { CallContext, CallFile, ServedBody } from "../client";
import { Refusal } from "../client";

type MapAsk = Extract<RequestBody, { type: "lre.map" }>;
type MapRead = Extract<MapAsk, { op: "walk" } | { op: "ways" } | { op: "travel" }>;

function isRead(request: RequestBody): request is MapRead {
  return request.type === "lre.map" && (request.op === "walk" || request.op === "ways" || request.op === "travel");
}

export const calls: CallFile = {
  name: "map",
  takes: isRead,
  async serve(request, ctx: CallContext): Promise<ServedBody> {
    if (!isRead(request)) throw new Refusal("internal", "The map calls do not take that request.");
    switch (request.op) {
      case "walk":
        return { walk: await ctx.client.call("GET /api/v1/chats/:chat/walk", { chat: request.chatId }, { query: { x: request.x, y: request.y } }) };
      case "ways":
        return { ways: (await ctx.client.call("GET /api/v1/chats/:chat/travel", { chat: request.chatId })).ways };
      case "travel":
        return { travel: (await ctx.client.call("GET /api/v1/chats/:chat/travel/:place", { chat: request.chatId, place: request.to })).options };
    }
  },
};
