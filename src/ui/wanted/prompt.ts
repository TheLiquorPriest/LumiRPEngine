// What the Prompt page reads and does that the route table does not hold yet (see ./index.ts): the
// preset's prompt map as found in a turn's prompt, the prompt's notices and front report turn by turn,
// and the five edits the owner makes to the map (RPH's `promptMap.show` and `promptMap.edit`).

import type { PromptNotice, TurnId } from "../../shared/api";
import type { WantedRoute } from "./index";

export type SliceKind = "instructions" | "style" | "character" | "persona" | "world" | "note" | "lore" | "history" | "other";
export type SliceBehaviour = "fixed" | "scene" | "turn";

/** One named part of the prompt as the page shows it: what the map says of it, and where it was found in the turn's prompt. */
export interface SliceShown {
  marker: string;
  kind: SliceKind;
  /** One line on what it is. */
  line: string;
  behaviour: SliceBehaviour;
  /** The owner changed it on this page; a new mapping keeps the change. */
  edited: boolean;
  /** Its text in the turn's prompt; null where it was not found in it. */
  text: string | null;
  /** Its length in the turn's prompt, in characters; 0 where it was not found. */
  length: number;
  /** Where it was found: spans of a message's text. */
  found: { message: number; start: number; end: number }[];
  /** How it was found: by a signature of its text, by the chat application's block name, or by its place among its neighbours; null where it was not found. */
  how: "signature" | "block" | "place" | null;
  /** What the chat application's own breakdown said of it; null where it said nothing. */
  breakdown: "confirmed" | "corrected" | null;
}

/** Text no slice claims, with the words it holds. */
export interface UnclaimedShown {
  message: number;
  start: number;
  end: number;
  text: string;
}

/** How much of the prompt's front was the same as the turn before, and the slice that broke it (none: the whole held). */
export interface FrontShown {
  length: number;
  brokenBy: string | null;
}

/** Lumiverse's own clipping cut inside RPE's window: how many of the window's messages it left out, why (its memory's summary, its message limit, the preset's context size), and on which turns. */
export interface ClippedShown {
  left: number;
  reason: "memory" | "message_limit" | "context_size";
  turns: TurnId[];
}

/** A block of the old engines' that the chat's preset still holds: `RPEngine · <step>`, or an `{{outlet::lre_…}}` reference; by name. */
export interface OldBlockShown {
  kind: "block" | "outlet";
  name: string;
  /** The preset block it stands in. */
  in: string;
}

/** The prompt map of the chat's preset as found in one turn's prompt. */
export interface PromptShown {
  preset: { id: string; name?: string; revision?: string } | null;
  /** Whether a map was learned for the preset; false: the slices are the raw layout's, named by the chat application's blocks and by place. */
  mapped: boolean;
  /** False: some text could not be told apart, so slices cannot be found in it. */
  complete: boolean;
  /** The turn the slices were found in; null where none was played. */
  turn: TurnId | null;
  slices: SliceShown[];
  unclaimed: UnclaimedShown[];
  notices: PromptNotice[];
  front: FrontShown;
  clipped: ClippedShown | null;
  old: OldBlockShown[];
}

/** One turn's notices and front report, as the page lists them turn by turn. */
export interface PromptTurnShown {
  turn: TurnId;
  /** Its number on the chat's path. */
  n: number;
  at: number;
  notices: PromptNotice[];
  front: FrontShown;
  clipped: ClippedShown | null;
}

export interface PromptHistoryReply {
  items: PromptTurnShown[];
  next: string | null;
}

/** An edit of the owner's to the map: rename a marker, merge slices, split one at given words, correct a line, change a kind. */
export type PromptEditAsk =
  | { edit: "rename"; marker: string; to: string }
  | { edit: "merge"; markers: string[]; as: string }
  | { edit: "split"; marker: string; at: string; second: string }
  | { edit: "line"; marker: string; line: string }
  | { edit: "kind"; marker: string; to: SliceKind };

export interface PromptRoutes {
  "GET /api/v1/chats/:chat/prompt": WantedRoute<{ chat: string }, { turn?: TurnId }, undefined, PromptShown>;
  "GET /api/v1/chats/:chat/prompt/history": WantedRoute<{ chat: string }, { limit?: number; cursor?: string }, undefined, PromptHistoryReply>;
  "POST /api/v1/chats/:chat/prompt/edit": WantedRoute<{ chat: string }, Record<string, never>, PromptEditAsk, PromptShown>;
}
