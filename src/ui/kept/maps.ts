// The owner's hand on a chat's map, on RPE's typed routes (plan §8.2, §15.4; PlanChatUI-4): the grid of a place
// read in full, someone dragged to a square, squares changed, a grid laid, and the Undo of each. Each write is
// his own change on the chat's line; the page's view of the chat is read again once one is made, so the map
// shows it at once.

import type { MapHand, MapStroke } from "../../frontend/app";
import { replyOf, type RpeClient } from "../client";

export function keptMapHand(client: Pick<RpeClient, "call">, changed: () => void): MapHand {
  const strokes = (list: readonly MapStroke[]): MapStroke[] => list.map((stroke) => ({ ...stroke }));
  return {
    grid: async (chat, place) => replyOf(await client.call("GET /api/v1/chats/:chat/maps/:place", { chat, place })),
    async move(chat, place, who, square) {
      const wrote = await client.call("POST /api/v1/chats/:chat/maps/:place/moves", { chat, place }, { body: { who, square: [...square] } });
      changed();
      return wrote;
    },
    async paint(chat, place, list) {
      const wrote = await client.call("POST /api/v1/chats/:chat/maps/:place/squares", { chat, place }, { body: { strokes: strokes(list) } });
      changed();
      return wrote;
    },
    async lay(chat, place, laying) {
      const wrote = await client.call("POST /api/v1/chats/:chat/maps", { chat }, { body: { place, width: laying.width, height: laying.height, feet: laying.feet, ...(laying.title === undefined ? {} : { title: laying.title }) } });
      changed();
      return wrote;
    },
    async undo(chat, edit) {
      await client.call("POST /api/v1/chats/:chat/edits/:edit/undo", { chat, edit });
      changed();
    },
  };
}
