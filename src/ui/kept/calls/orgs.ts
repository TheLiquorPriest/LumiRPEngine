// Orgs' read of one organization's page, on RPE's typed route (plan §14, §15.4): asked when its page or one of its editors opens
// and again when the state it shows changes. The state view carries only each page's summary (`orgs.summary`); the page itself
// (`orgs.org`) is read here, built from the state the view is and kept with it, so a second open builds nothing.

import type { RequestBody } from "../../../frontend/registry";
import type { CallContext, CallFile, ServedBody } from "../client";
import { Refusal } from "../client";

type OrgPageAsk = Extract<RequestBody, { type: "lre.org" }>;

function isRead(request: RequestBody): request is OrgPageAsk {
  return request.type === "lre.org";
}

export const calls: CallFile = {
  name: "orgs",
  takes: isRead,
  async serve(request, ctx: CallContext): Promise<ServedBody> {
    if (!isRead(request)) throw new Refusal("internal", "The organizations' calls do not take that request.");
    return { page: (await ctx.client.call("GET /api/v1/chats/:chat/state/orgs/:org", { chat: request.chatId, org: request.org })).page };
  },
};
