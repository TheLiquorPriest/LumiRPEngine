// The depth offer (DEPTH-PLAN Round 2, rulings: a depth chip on existing chats): the chip a world
// chat that has played and never chose depth shows under its last message. Turn on depth puts the
// chat on depth and starts the bootstrap under Settings → Depth's cap; Estimate surveys the chat with
// no model call, so the chip then says what the bootstrap would take; Keep off records the chat's own
// choice, so the chip never shows again for it. A player surface: it names nothing hidden. Pure data.

/** The chip's kind, and its id's head (`depth_offer:<the message it shows under>`). */
export const DEPTH_OFFER_KIND = "depth_offer";

/** The offer's buttons the backend answers. */
export const DEPTH_OFFER_CHOICES = { on: "on", estimate: "estimate", off: "off" } as const;
/** The button, first while the user's loopback isn't ready, that opens Settings → Loopback on the page and sends nothing. */
export const DEPTH_OFFER_LOOPBACK = "loopback";
export type DepthOfferChoice = (typeof DEPTH_OFFER_CHOICES)[keyof typeof DEPTH_OFFER_CHOICES];

export function isDepthOfferChoice(choice: string): choice is DepthOfferChoice {
  return choice === DEPTH_OFFER_CHOICES.on || choice === DEPTH_OFFER_CHOICES.estimate || choice === DEPTH_OFFER_CHOICES.off;
}

export const DEPTH_OFFER_TEXT = {
  label: "This chat could run on depth.",
  detail: "An author runs each scene and keeps a notebook, characters play and remember from minds of their own, and a GM keeps the truth. The bootstrap reads this chat's history first, in the background.",
  on: "Turn on depth and bootstrap",
  loopback: "Set up the loopback",
  estimate: "Estimate the bootstrap",
  off: "Keep this chat off depth",
} as const;
