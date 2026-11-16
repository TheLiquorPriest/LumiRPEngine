// What the World page reads of RPE that the route table does not hold yet (see ./index.ts).

import type { TurnId } from "../../shared/api";
import type { ChangeShown, WantedRoute } from "./index";

/** One change that wrote a value (a field, a relation, a balance, a fact's key, an area item's part), newest first on its page. */
export interface ValueChangeShown extends ChangeShown {
  /** The value it left; null where it removed it. */
  value: string | null;
  /** Whether it wrote a typed value or a fact beside one. */
  kind: "value" | "fact";
  /** A fact stands beside a typed value; the turn of the later exact record that settled it, or null while it stands. */
  settledBy: TurnId | null;
}

export interface ValueHistoryReply {
  at: string;
  part: string;
  items: ValueChangeShown[];
  next: string | null;
}

/** A change that no longer applies on the swipe now showing, and why. */
export interface NotAppliedShown {
  change: string;
  turn: TurnId;
  n: number;
  op: string;
  words: string;
  reason: string;
}

export interface NotAppliedReply {
  /** The earlier reply that shows another swipe than its later turns were made on; null where none does. */
  reply: { turn: TurnId; n: number } | null;
  items: NotAppliedShown[];
}

/** The World page's routes. */
export interface WorldRoutes {
  "GET /api/v1/chats/:chat/state/history": WantedRoute<{ chat: string }, { at: string; part: string; turn?: TurnId; limit?: number; cursor?: string }, undefined, ValueHistoryReply>;
  "GET /api/v1/chats/:chat/state/not-applied": WantedRoute<{ chat: string }, Record<string, never>, undefined, NotAppliedReply>;
}
