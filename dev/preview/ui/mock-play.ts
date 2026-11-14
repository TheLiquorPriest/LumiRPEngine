// The Play page's routes in the preview (`GET /api/v1/chats/:chat/state`, `POST …/actions`,
// `POST …/actions/undo`), answered from recorded answers (test/ui/kept/play/recorded.ts). Every chat
// plays the invented Fernwick world from a starter template, its Gear level raised so Me → Belongings
// lists what the player wears with its verbs; "The orchard war" (`chat-orchard`) plays no world until
// the Play page's picker attaches one through Build's route, and from then on is RPE's own view of that
// world in Build's store (mock-build.ts), its taps not served. Taking
// a thing off or putting it on is applied to the recorded state, kept while the preview runs, and
// answered as today's backend answers `lre.fix`, with its Undo; every other message is answered
// `unavailable` with a sentence of the stand-in's own. After each change the chat's followers are told
// its state changed, as RPE's live hub tells them (`changed`, from mock-rpe.ts).

import type { FrontendToBackend } from "../../../src/shared/protocol";
import type { ItemFix } from "../../../src/shared/things";
import { appliedFix, recordedNoWorld, recordedView, refused, undone } from "../../../test/ui/kept/play/recorded";
import { attachedView } from "./mock-build";

/** The preview's chat that plays no world. */
const NO_WORLD = "chat-orchard";

/** The stand-in's own sentence for what it does not serve; RPE's come from its guidance files. */
const NOT_SERVED = "The preview's stand-in RPE plays only taking a thing off and putting it on.";

/** What each chat's player has taken off, by chat. */
const takenOff = new Map<string, Set<string>>();

/** Each change's Undo, by the id its answer gave: the chat, the thing, and whether it was off before. */
const undos = new Map<string, { chat: string; thing: string; wasOff: boolean }>();
let changes = 0;

const answer = (status: number, body: unknown): Response => Response.json(body, { status, headers: { "cache-control": "no-store" } });

function offIn(chat: string): Set<string> {
  let off = takenOff.get(chat);
  if (off === undefined) {
    off = new Set();
    takenOff.set(chat, off);
  }
  return off;
}

/** The one thing a fix takes off or puts on, or null for any other fix. */
function wearing(message: FrontendToBackend): Extract<ItemFix, { do: "wear" }> | null {
  if (message.type !== "lre.fix" || !("things" in message) || message.things.length !== 1) return null;
  const [fix] = message.things;
  return fix !== undefined && fix.do === "wear" && fix.slot === undefined ? fix : null;
}

/** The Play page's routes for `chat`: `part` is `state`, `actions` or `actions/undo`. */
export async function playAnswer(request: Request, chat: string, part: string, changed: () => void): Promise<Response> {
  if (part === "state") {
    if (request.method !== "GET") return answer(405, { error: "The state takes GET." });
    return answer(200, chat === NO_WORLD ? ((await attachedView(chat)) ?? recordedNoWorld(chat)) : recordedView({ chat, gear: 3, off: [...offIn(chat)] }));
  }
  if (request.method !== "POST") return answer(405, { error: "Actions take POST." });
  const message = (await request.json().catch(() => null)) as FrontendToBackend | null;
  if (message === null || message.lre !== 1 || typeof message.type !== "string" || typeof message.reqId !== "string") return answer(400, { error: "The body is one of today's messages: { lre: 1, type, reqId, … }." });
  const off = offIn(chat);
  if (part === "actions/undo") {
    const undo = message.type === "lre.chip" && message.choice === "undo" ? undos.get(message.chip) : undefined;
    if (undo === undefined || undo.chat !== chat) return answer(200, { lre: 1, type: "lre.error", reqId: message.reqId, code: "not_found", message: "There is nothing to undo by that id." });
    undos.delete(message.type === "lre.chip" ? message.chip : "");
    if (undo.wasOff) off.add(undo.thing);
    else off.delete(undo.thing);
    changed();
    return answer(200, undone(message.reqId));
  }
  const fix = chat === NO_WORLD ? null : wearing(message);
  if (fix === null) return answer(200, refused(message.reqId, NOT_SERVED));
  const wasOff = off.has(fix.item);
  if (fix.off === true) off.add(fix.item);
  else off.delete(fix.item);
  changes += 1;
  const id = `tap:preview:${changes}`;
  undos.set(id, { chat, thing: fix.item, wasOff });
  changed();
  return answer(200, appliedFix(message.reqId, id));
}
