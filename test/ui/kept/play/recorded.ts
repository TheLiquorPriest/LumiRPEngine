// Recorded answers of the routes the Play page calls, in the shapes they declare. The chat's state is
// made as RPE's state route makes it: the play panels' own bed (test/play/bed.ts) plays a starter world
// with no turn yet, and the route's reply is kept as it comes over a road. A later state is the same
// world an hour and a half on, as after a turn that passed the time; a chat with no world answers
// today's view of a chat that is not a world chat.

import { notWorldView } from "../../../../src/play/state/not-world";
import { STARTER_WORLDS } from "../../../../src/packs/starters";
import { hashJson } from "../../../../src/shared/hash";
import type { ErrorMessage } from "../../../../src/shared/protocol";
import type { StateView } from "../../../../src/shared/state-view";
import { makeBed, USER } from "../../../play/bed";

/** The invented chat the recorded answers are about, and one RPE has no world for. */
export const CHAT = "chat-fernwick";
export const NO_WORLD_CHAT = "chat-tea-room";

/** When the starter world's story begins, and the same day an hour and a half later. */
export const BEGINS = "0412-08-25T07:30";
export const LATER = "0412-08-25T09:00";

/** The chat's state as RPE's route answers it before any turn, for `chat` (the invented one by default): its world at `at`. */
export async function recordedView(options: { chat?: string; at?: string } = {}): Promise<StateView> {
  const chat = options.chat ?? CHAT;
  const starter = STARTER_WORLDS.fantasy_town;
  if (starter === undefined) throw new Error("No starter world fantasy_town");
  const doc = starter("world-fernwick", "Fernwick");
  const world = { ...doc, start: { ...doc.start, at: options.at ?? BEGINS } };
  const revision = hashJson(world);
  const bed = makeBed();
  const s = bed.store.user(USER);
  await bed.writes.run(() => {
    s.putWorld(revision, world);
    s.createChat({ id: chat, world: world.id, revision });
  });
  // As it comes over a road: plain JSON, nothing shared with the builder.
  return JSON.parse(JSON.stringify(await bed.state({}, USER, chat))) as StateView;
}

/** What the route answers for a chat RPE plays with no world: today's view of a chat that is not a world chat. */
export function recordedNoWorld(chat: string = NO_WORLD_CHAT): StateView {
  return JSON.parse(JSON.stringify(notWorldView(chat))) as StateView;
}

/** RPE's answer to what it does not serve: today's `unavailable`, with one sentence of RPE's. */
export function refused(reqId: string, sentence: string): ErrorMessage {
  return { lre: 1, type: "lre.error", reqId, code: "unavailable", message: sentence };
}
