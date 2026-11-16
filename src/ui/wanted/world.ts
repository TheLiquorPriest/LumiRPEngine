// What the World page reads of RPE that the route table does not hold yet (see ./index.ts).

import type { FactPrecision, FactStanding, TurnId } from "../../shared/api";
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

/** One row of a typed system's view at a level: its label, its value, a note, and how exact and how sure it is. */
export interface SystemRowShown {
  label: string;
  value: string;
  note: string | null;
  precision: FactPrecision | null;
  standing: FactStanding | null;
}

/** One typed system's view at a level, as the system keeps it: its sections of rows (an account's postings and balance, a price, a thing's four facts, a group's ranks). */
export interface SystemShown {
  /** The system: economy, gear, groups, calendar, weather, vehicles, sheets. */
  system: string;
  title: string;
  sections: { title: string; rows: SystemRowShown[] }[];
}

export interface SystemsReply {
  at: string;
  systems: SystemShown[];
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

/** One field of an owner's edit: set a value or a fact at a level, or remove it. */
export interface EditOpAsk {
  op: "set" | "remove";
  at: string;
  key: string;
  as: "value" | "fact";
  value?: string;
  precision?: FactPrecision;
  standing?: FactStanding;
}

export interface EditAsk {
  kind: "edit";
  ops: EditOpAsk[];
  /** Whether the next briefing tells the Author of it (the "Tell the story" choice). */
  tell: boolean;
}

export interface EditReply {
  applied: boolean;
  /** What the world's rules reported of it, listed under unsettled. */
  reports: string[];
  /** The id its Undo takes; null where nothing was recorded. */
  undo: string | null;
  words: string;
}

export interface UndoAsk {
  undo: string;
}

/** The World page's routes. */
export interface WorldRoutes {
  "GET /api/v1/chats/:chat/state/history": WantedRoute<{ chat: string }, { at: string; part: string; turn?: TurnId; limit?: number; cursor?: string }, undefined, ValueHistoryReply>;
  "GET /api/v1/chats/:chat/state/systems": WantedRoute<{ chat: string }, { at: string; turn?: TurnId }, undefined, SystemsReply>;
  "GET /api/v1/chats/:chat/state/not-applied": WantedRoute<{ chat: string }, Record<string, never>, undefined, NotAppliedReply>;
  "POST /api/v1/chats/:chat/taps": WantedRoute<{ chat: string }, Record<string, never>, EditAsk, EditReply>;
  "POST /api/v1/chats/:chat/taps/undo": WantedRoute<{ chat: string }, Record<string, never>, UndoAsk, EditReply>;
}
