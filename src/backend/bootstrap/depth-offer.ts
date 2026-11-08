// The depth offer under a world chat's last message (`shared/depth-offer.ts`): built where the chat's
// chips are (`Runtime.viewNow`, through the dispatcher's `depthOffer`), from the chat's own depth
// choice and its bootstrap's estimate. A chat that chose either way (its `depth.json`, or the chat it
// was branched from's) never shows it; neither does one with no player message yet, which has no
// history for the bootstrap to read. A user who can't play depth yet (`loopbackUnready`) sees it too,
// its first button Set up the loopback (Settings → Loopback, with the line that starts the relay).

import type { BootstrapView } from "../../shared/bootstrap";
import { DEPTH_OFFER_CHOICES, DEPTH_OFFER_KIND, DEPTH_OFFER_LOOPBACK, DEPTH_OFFER_TEXT } from "../../shared/depth-offer";
import { countsText } from "../../shared/depth-views";
import type { ChatId, MessageId, UserId } from "../../shared/ids";
import type { Chip } from "../../shared/state-view";
import type { HostPort } from "../host";
import { BootstrapFiles } from "./files";

const isRecordFile = (raw: unknown): raw is object => typeof raw === "object" && raw !== null;

/** Whether the chat, or the chat it was branched from (as `depthOptedIn` follows it), recorded a depth choice either way. */
export async function depthChosen(host: Pick<HostPort, "storage" | "log" | "chats">, chatId: ChatId, userId: UserId, hops = 0): Promise<boolean> {
  if ((await new BootstrapFiles(host, chatId, userId).read("depth.json", isRecordFile)) !== null) return true;
  if (hops > 4) return false;
  let from: unknown;
  try {
    from = (await host.chats.chatMetadata(chatId, userId)).branched_from;
  } catch {
    return false;
  }
  return typeof from === "string" && from !== chatId ? depthChosen(host, from as ChatId, userId, hops + 1) : false;
}

/** The offer, from the chat's bootstrap view: Set up the loopback first where it isn't ready (`unready`, why not); Estimate until it has one, then Turn on depth with the estimate; Keep off either way. */
export function depthOfferChip(view: Pick<BootstrapView, "optedIn" | "remaining">, messageId: MessageId, unready: string | null): Chip | null {
  if (view.optedIn) return null;
  const est = view.remaining;
  const off = { id: DEPTH_OFFER_CHOICES.off, label: DEPTH_OFFER_TEXT.off };
  return {
    id: `${DEPTH_OFFER_KIND}:${messageId}`,
    kind: DEPTH_OFFER_KIND,
    messageId,
    label: DEPTH_OFFER_TEXT.label,
    detail: [DEPTH_OFFER_TEXT.detail, unready, est ? `The bootstrap: ${est.messages.toLocaleString("en-US")} messages in ${est.chunks.toLocaleString("en-US")} chunks, ${est.minds} ${est.minds === 1 ? "mind" : "minds"} · ${countsText(est.total)}.` : "Estimate it first: the survey reads the chat once, with no model call."].filter((line) => line !== null).join("\n"),
    actions: [
      ...(unready !== null ? [{ id: DEPTH_OFFER_LOOPBACK, label: DEPTH_OFFER_TEXT.loopback, style: "primary" as const, input: { type: "settings" as const, label: DEPTH_OFFER_TEXT.loopback, page: "loopback" as const } }] : []),
      ...(est ? [{ id: DEPTH_OFFER_CHOICES.on, label: DEPTH_OFFER_TEXT.on, ...(unready === null ? { style: "primary" as const } : {}) }, { id: DEPTH_OFFER_CHOICES.estimate, label: DEPTH_OFFER_TEXT.estimate }] : [{ id: DEPTH_OFFER_CHOICES.estimate, label: DEPTH_OFFER_TEXT.estimate, ...(unready === null ? { style: "primary" as const } : {}) }]),
      off,
    ],
    expires: "never",
  };
}
