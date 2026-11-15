// The state view of a chat that is no world's chat: nothing to show.

import type { ChatId } from "../../shared/ids";
import type { StateView } from "../../shared/state-view";

export function notWorldView(chatId: ChatId): StateView {
  return { v: 1, chatId, worldId: null, revision: null, status: "not_world", hud: null, scene: null, chips: [], replyClocks: {}, journal: [], keepReport: [], pending: [], panels: {}, palette: null, controls: null, meter: null, packs: {}, currency: null };
}
