// The offer to switch to agents (INC3 3a, D2): the chip a classic chat that has played, and never
// chose, shows while the user's new chats start on agents (Settings → Agents → Pipeline). Its two
// buttons record the chat's own choice through the Engine switch's path (`lre.chat.knowledge`), so it
// never shows again for that chat; nothing switches without the press. Its words are registry texts
// on the Every agent page (group "Switching to agents"), each with its default and a reset. A player
// surface: it names nothing hidden. Pure data.

import { RUNTIME_PROMPT_PAGE } from "./agent-prompts";
import type { PromptDef } from "./prompts";

/** The offer's text ids, so code names them once. */
export const ENGINE_OFFER_TEXT = {
  label: "offer.engine.label",
  detail: "offer.engine.detail",
  switch: "offer.engine.switch",
  keep: "offer.engine.keep",
} as const;

/** The chip's kind, and its id's head (`engine_offer:<the message it shows under>`). */
export const ENGINE_OFFER_KIND = "engine_offer";

/** The offer's buttons: each the engine it records as the chat's own. */
export const ENGINE_OFFER_CHOICES = { switch: "agents", keep: "classic" } as const;

const page = RUNTIME_PROMPT_PAGE.id;
const group = "Switching to agents";

export const ENGINE_OFFER_PROMPTS: readonly PromptDef[] = [
  { id: ENGINE_OFFER_TEXT.label, page, group, label: "The offer", note: "What the chip says on a classic chat that has played and never chose, while Settings → Agents → Pipeline → New chats start on is Agents.", text: "This chat runs on the classic steps. New chats run on agents.", vars: [] },
  {
    id: ENGINE_OFFER_TEXT.detail,
    page,
    group,
    label: "What switching does",
    note: "The line under the offer: what an agents chat does differently, and when a switch applies.",
    text: "On agents, each turn is worked out by the agent roles with their tools, the main agent reviews the narrator's prompt before every reply, and GM → Live shows the turn as it runs. A switch applies from the next turn; earlier turns stay as they were played. Calls that offer tools go with reasoning off until Thinking in agent tool loops is on (Settings → Agents).",
    vars: [],
  },
  { id: ENGINE_OFFER_TEXT.switch, page, group, label: "Switch to agents", note: "The button that switches the chat to agents from its next turn.", text: "Switch to agents", vars: [] },
  { id: ENGINE_OFFER_TEXT.keep, page, group, label: "Keep classic", note: "The button that keeps the chat on the classic steps for good, so the offer doesn't show again.", text: "Keep classic", vars: [] },
];
