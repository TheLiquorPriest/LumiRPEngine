// The things browser's reads and Belongings' + Add's catalog, on RPE's typed routes (plan §14, §15.4;
// PlanChatUI-P3 item 3): a chat's list of things, a thing's page, a person's things, a search and the
// catalog of types and vehicle classes, each asked of the chat at its head. What changes things (Tidy up,
// Leave it, what was made in play, Keep in the world) is not taken here; it goes the road it went. Build's
// own things, of a world's draft, are the worlds' call file's.

import type { RequestBody } from "../../../frontend/registry";
import type { ResultBodies } from "../../../shared/protocol";
import type { CallContext, CallFile, ServedBody } from "../client";
import { Refusal } from "../client";

type Things = Extract<RequestBody, { type: "lre.things" }>;

/** The reads of the chat's things that have routes: `list`, `thing`, `person`, `find` and `types`, in the GM scope and, for the catalog, the play scope. */
function isRead(request: RequestBody): request is Things & { scope: "gm" | "play" } {
  return request.type === "lre.things" && (request.scope === "gm" || request.scope === "play") && ["list", "thing", "person", "find", "types"].includes(request.op);
}

export const calls: CallFile = {
  name: "things",
  takes: isRead,
  async serve(request, ctx: CallContext): Promise<ServedBody> {
    if (!isRead(request)) throw new Refusal("internal", "The things calls do not take that request.");
    const chat = request.chatId;
    const { client } = ctx;
    switch (request.op) {
      case "list":
        return { list: (await client.call("GET /api/v1/chats/:chat/things", { chat })) as unknown as NonNullable<ResultBodies["lre.things"]["list"]> };
      case "types": {
        const catalog = (await client.call("GET /api/v1/chats/:chat/things/types", { chat })) as unknown as { types: NonNullable<ResultBodies["lre.things"]["types"]> };
        return { types: catalog.types };
      }
      case "find":
        return { found: (await client.call("GET /api/v1/chats/:chat/things/find", { chat }, { query: { words: request.words } })) as unknown as NonNullable<ResultBodies["lre.things"]["found"]> };
      case "thing":
        return (await client.call("GET /api/v1/chats/:chat/things/:entity", { chat, entity: request.entity })) as unknown as ResultBodies["lre.things"];
      case "person":
        return (await client.call("GET /api/v1/chats/:chat/people/:entity/things", { chat, entity: request.entity })) as unknown as ResultBodies["lre.things"];
      default:
        throw new Refusal("internal", `The things calls do not take ${request.op}.`);
    }
  },
};
