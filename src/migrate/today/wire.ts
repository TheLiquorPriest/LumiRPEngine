// Today's wire, as the migration's readers take it (§4.3 l.295: "what they stored is migrated first"):
// the version today's build stamped on its messages, the action a chat holds staged, the push that
// started a prepared generation, and what the Settings page was answered. Carried unchanged from the
// previous extension's protocol (PlanSwap-13), which goes with PlanSwap-10.

import type { ActionId, BoundMode, ChatId } from "../../shared/ids";
import type { JsonObject } from "../../shared/json";
import type { ChangeType, UserSettings } from "../../shared/settings";
import type { GenerateAs } from "../../shared/state-view";

/** The version today's build stamped on every message of its link. */
export const PROTOCOL_VERSION = 1;

interface Envelope<T extends string> {
  lre: typeof PROTOCOL_VERSION;
  type: T;
}

interface Request<T extends string> extends Envelope<T> {
  reqId: string;
}

/**
 * A palette, map, command or chip action. A money or organization action tapped with no words is
 * done at once, off screen (DESIGN §11, `shared/offstage.ts`): no message, turn or clock time,
 * recorded on the head as a ✎ fix is, with its Undo. Any other tap from the palette, a panel or the
 * map with no words is staged for the player's next message, and the same tap again clears it;
 * `now` plays it at once as a turn, as a chip or a command does: the backend appends a user message
 * with `intent` and triggers a generation. Words always play it as a turn.
 */
export interface ActionRequest extends Request<"lre.action"> {
  chatId: ChatId;
  action: ActionId;
  params: JsonObject;
  source: "palette" | "map" | "command" | "chip";
  /** Optional user-visible text for the appended message. */
  text?: string;
  /** Play it at once as a turn rather than stage it or do it off screen (the staged action's Send now). */
  now?: boolean;
  /** Done at once, off screen, for an action of the table that only its surface does so (Gear → Manage's gear actions). */
  offstage?: true;
  /** Whether the next turn's narrator is told of the action done off screen; absent, Settings → Narrator → Out-of-play actions decides by its group. */
  tell?: boolean;
}

/** Each extraction or agent change type's effective mode and where it comes from (DESIGN §11, D4 learning; AGENT-LOOP-PLAN §6). */
export interface ExtractionModeView {
  mode: BoundMode;
  source: "pinned" | "learned" | "default" | "bound";
  /** The connection whose learning applies (the extract step's), when known. */
  connection: { id: string; name: string } | null;
  accepted: number;
  rejected: number;
}

/** Settings plus a derived view: effective modes, the reply's extraction types then the agents' change types. */
export interface SettingsResult {
  settings: UserSettings;
  extraction: Record<ChangeType, ExtractionModeView>;
}

/**
 * The engine prepared the chat's next generation: the frontend open on that chat starts it (DESIGN
 * §5.1). Only the page holding the turn's claim is asked, and it starts each `turn` once.
 */
export interface GeneratePush extends Envelope<"lre.generate"> {
  chatId: ChatId;
  as: GenerateAs;
  turn: string;
  /** A swipe no chip's choice asked anything of, while Settings → Swipes → Ask what should change on each swipe is on: the page asks first (restart.ts), and its claim carries the answer. */
  ask?: true;
}
