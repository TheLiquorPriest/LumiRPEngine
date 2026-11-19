// The Journal's read of its notes, on RPE's typed route (plan §14, §15.4): asked when the Journal opens and again when the state it
// shows changes. The state view carries none of them, so no view waits while each turn's notes are worked out after RPE starts; each
// turn's notes are kept while its state stands, so a read after a turn works out only the new turn's.

import type { RequestBody } from "../../../frontend/registry";
import type { CallContext, CallFile, ServedBody } from "../client";
import { Refusal } from "../client";

type JournalAsk = Extract<RequestBody, { type: "lre.journal" }>;

function isRead(request: RequestBody): request is JournalAsk {
  return request.type === "lre.journal";
}

export const calls: CallFile = {
  name: "journal",
  takes: isRead,
  async serve(request, ctx: CallContext): Promise<ServedBody> {
    if (!isRead(request)) throw new Refusal("internal", "The Journal's calls do not take that request.");
    return { notes: (await ctx.client.call("GET /api/v1/chats/:chat/state/journal", { chat: request.chatId })).notes };
  },
};
