// What waits for his next message from a panel (plan §10.10, "A panel action"), on RPE's typed routes: a
// request the state view shows (`StateView.staged`) sent now, its line put in the chat as his message and a
// reply started through Lumiverse's own routes as him (`POST /api/v1/chats/:chat/plays`), or taken back
// (`DELETE /api/v1/chats/:chat/requests/:request`). The chat's state is read again after each, so the HUD,
// the palette and the map follow at once; RPE's live feed says so too. A refusal is thrown with RPE's words.

import type { NextMessage } from "../../frontend/app";
import type { RpeClient } from "../client";

export function keptNextMessage(client: Pick<RpeClient, "call">, changed: () => void): NextMessage {
  return {
    async sendNow(chat, request) {
      await client.call("POST /api/v1/chats/:chat/plays", { chat }, { body: { request } });
      changed();
    },
    async takeBack(chat, request) {
      await client.call("DELETE /api/v1/chats/:chat/requests/:request", { chat, request });
      changed();
    },
  };
}
