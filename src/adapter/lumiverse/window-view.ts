// What the history window is now, for the chat's window marker (`GET /api/v1/chats/:chat/window`, STANDALONE-PLAN §4.2, §8.1; READINGS R-181): whether the window is on for the chat, the first history
// message it keeps on the chat's current path (the step and the hold as the chat's settings set them), how many messages lie above it, and how many of those the story record does not cover yet.
// The turn lane gives the window's facts (`WindowView`: the setting, the first message kept, what the record covers at the chat's head); the counts are made here from the chat's path as Lumiverse's rows
// have it. A hidden message is counted only where the chat's setting lets agents read hidden messages (R-181, D-52), and is not otherwise above the window at all.

import type { WindowStep } from "./answer";
import type { KeepPoint } from "./wire";

export const CHAT_WINDOW_PATH = "/api/v1/chats/:chat/window";

/** The window's facts for a chat's path, from the turn lane: its setting, where it cuts, and what the story record covers. */
export interface WindowView {
  /** The chat's window is on: its setting keeps a number of messages. */
  on: boolean;
  /** The first message the window keeps on the path given, with the step and the hold as set; null where it keeps them all. */
  first: KeepPoint | null;
  /** The ids of the messages on the path the story record covers, read at the chat's head. */
  covered: ReadonlySet<string>;
}

/** The turn lane: the window as it stands for a chat's current path (every message of it, in order, each with its hidden mark). */
export type WindowViewOf = (chat: string, path: readonly WindowStep[]) => Promise<WindowView>;

/** What the marker reads. */
export interface WindowShown {
  on: boolean;
  /** Lumiverse's id of the first history message the window keeps; null where it keeps all, or is off. */
  first: string | null;
  /** The history message just above `first`, the one the marker stands under; null where nothing is above it. */
  before: string | null;
  /** History messages above the window. */
  above: number;
  /** Of those, how many the story does not cover yet. */
  uncovered: number;
}

/** The marker's counts from the window's facts and the path: `readable` is the chat's setting that lets agents read hidden messages. */
export function windowShown(path: readonly { id: string; index: number; hidden: boolean }[], view: WindowView, readable: boolean): WindowShown {
  if (!view.on || view.first === null) return { on: view.on, first: null, before: null, above: 0, uncovered: 0 };
  const edge = view.first.index;
  const above = path.filter((s) => s.index < edge && (readable || !s.hidden));
  return {
    on: true,
    first: view.first.id,
    before: above.at(-1)?.id ?? null,
    above: above.length,
    uncovered: above.filter((s) => !view.covered.has(s.id)).length,
  };
}
