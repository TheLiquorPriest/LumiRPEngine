// A chat the harness plays, for the preview (`?engine=harness`): its chips as the engine makes them
// there, the review card of a turn whose changes ask first (the world's document among them), and
// LumiAH's backend as far as the drawer's Harness tab needs one. The lines are worded as the engine
// words them, so the pages are judged on what a player would read.

import type { UiState } from "lumi-ah/shared";
import type { ReviewCardView } from "../../src/shared/protocol";
import type { Chip } from "../../src/shared/state-view";

/** Why the harness can't be chosen (`?harness=blocked`), as the engine says it of a permission LumiAH lacks. */
export const HARNESS_BLOCKED = 'The permission "interceptor" isn\'t granted: LumiRPEngine needs it to see a reply\'s prompt before it is sent: without it no reply is worked on. Grant it in Lumiverse (Extensions → LumiRPEngine → Permissions).';

/** The chips only the other engines make: a read of the reply, its gate and its learning, and a swipe's choice. */
const NOT_HARNESS: Partial<Record<Chip["kind"], true>> = { retry: true, swipe_option: true, reread: true, retry_read: true, not_action: true, intent_gate: true, mode_change: true, confirm: true, timelapse_offer: true };

/** The reply whose changes ask first, and its swipe. */
const REVIEW_AT = { messageId: "m4", swipeId: 0 };

/** Why no turn was played for the flagged reply (`?unplayed=`), each as the engine says it. */
export const UNPLAYED_WHY = {
  failed: "the harness's run failed: the connection answered 429 (too many requests)",
  stopped: "the reply was stopped",
  restarted: "the engine restarted while this reply was being written",
} as const;

/** A reply's flag that no turn was played for it, as the engine words it (`derivedChips`). */
export function unplayedChip(messageId: string, why: string): Chip {
  return { id: `unplayed:${messageId}:0`, kind: "degraded", messageId, label: "No turn was played", detail: `This reply was written without the harness's agents: ${why}. Nothing was rolled for it, no time passed, and nothing it tells was recorded. The author of the next harness turn is told, and records what still matters.`, actions: [], expires: "never" };
}

/** The preview chat's chips on the harness: none of a read's, the first reply flagged, and the last one's review card. */
export function harnessChips(chips: readonly Chip[], why: string): Chip[] {
  return [
    unplayedChip("m1", why),
    ...chips.filter((chip) => NOT_HARNESS[chip.kind] !== true),
    { id: `review:${REVIEW_AT.messageId}:${String(REVIEW_AT.swipeId)}`, kind: "review", ...REVIEW_AT, label: "", actions: [{ id: "apply", label: "Apply all", style: "primary" }, { id: "reject", label: "No" }], expires: "next_send" },
  ];
}

/** That turn's card: what the author asked of the world's document (`world_commit`, `world_upgrade`, `world_restore`), a person it would add, and a change the turn's own tools staged. */
export function harnessReview(): ReviewCardView[] {
  return [
    {
      turn: `${REVIEW_AT.messageId}:${String(REVIEW_AT.swipeId)}`,
      ...REVIEW_AT,
      placement: "chips",
      items: [
        { key: "d41c9a07", source: "agent", role: "director", changeType: "world_document", lines: ["Commit the world's draft as the world's next revision (Mara's bakery opens on Harbor Street): every new chat of this world starts from it."], status: "open" },
        { key: "7be2f310", source: "agent", role: "director", changeType: "world_document", lines: ["Bring this chat to the head of its world, as it is when this is made (an Upgrade)."], status: "open" },
        { key: "a09d55c2", source: "agent", role: "curator", changeType: "world_document", lines: ["Make the world's draft a copy of revision a1b2c3d4: what the draft holds now is replaced."], status: "open" },
        { key: "3f6a81be", source: "agent", role: "director", changeType: "gm_spawn", lines: ["Add Joss, a courier, at Rosie's Diner."], status: "open" },
        { key: "c2507e94", source: "read", role: "read", changeType: "time_advance", lines: ["20 minutes pass."], status: "open" },
      ],
    },
  ];
}

/** The cards after an answer: the picked changes (all, with none named) applied, or every waiting one turned down. */
export function answerReview(cards: readonly ReviewCardView[], turn: string, answer: { apply: readonly string[] | null } | "reject"): ReviewCardView[] {
  return cards.map((card) =>
    card.turn !== turn
      ? card
      : { ...card, items: card.items.map((item) => (item.status !== "open" ? item : answer === "reject" ? { ...item, status: "rejected" as const } : answer.apply === null || answer.apply.includes(item.key) ? { ...item, status: "applied" as const } : item)) },
  );
}

/** What LumiAH's pages hold after a first hello: built in, this chat switched on, nothing played yet. */
function harnessState(chatId: string): UiState {
  return {
    rev: 1,
    runtime: { build: "preview", link: 1, model: "", relays: [], start: { service: null, foreground: null, missing: [] }, issues: [], ready: false },
    setup: { steps: [{ id: "permissions", done: true }, { id: "chat", done: true }, { id: "reply", done: false }] },
    key: { set: false, print: null, at: null },
    chats: [{ chatId, name: "Maple · Maple Falls", on: true, since: Date.now() - 3_600_000, place: "builtin", connection: { id: "conn-main", name: "DeepSeek", loopback: false } }],
    running: [],
    connections: [{ id: "conn-main", name: "DeepSeek", provider: "deepseek", model: "deepseek-chat", loopback: false }],
    settings: { values: {}, defaults: {}, schema: { type: "object", properties: {} } },
    texts: { defs: [], own: {} },
    approvals: [],
    jobs: { active: [], off: false, paused: false, changed: 0 },
    notices: [],
    defs: 0,
    permissions: [],
  };
}

/**
 * LumiAH's backend for the Harness tab: the answer to one of its pages' requests, or undefined for a
 * message that isn't one. The preview has no harness behind the tab, so it answers what the tab's
 * first page reads (the hello, the chat, a live view with no turn yet) and says of the rest that
 * the preview has none of it.
 */
export function harnessAnswer(payload: unknown, chatId: string): unknown {
  if (typeof payload !== "object" || payload === null || !("lah" in payload) || !("type" in payload) || !("reqId" in payload)) return undefined;
  const { type, reqId } = payload as { type: string; reqId: string };
  const result = (body: unknown) => ({ lah: 1, type: "lah.result", reqId, request: type, body });
  const state = harnessState(chatId);
  switch (type) {
    case "lah.hello":
      return result(state);
    case "lah.chat.get":
      return result({ chat: state.chats[0] });
    case "lah.live.open":
      return result({ live: null, next: null });
    case "lah.live.close":
      return result({ closed: true });
    default:
      return { lah: 1, type: "lah.error", reqId, code: "unavailable", message: "The preview has no harness behind these pages, so this one has nothing to show." };
  }
}
