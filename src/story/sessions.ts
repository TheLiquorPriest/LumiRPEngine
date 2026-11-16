// A session is one scene of the story record (plan §11): opening a scene opens a session, closing it
// closes the session, and closing belongs to the turn that did it. The record is the truth of it, tied
// to turns, so a swipe or a delete that takes a scene's opening or closing away takes its session's
// with it. This reads, at a turn, which of the chat's sessions is in force and what a session opened
// now is for. The turn lane makes the calls on the store's sessions and on the harness's (`sessions`
// of the contract's `Harness`): at a turn's start, and after the writes of a turn or of a job.

import type { SessionRow, Store } from "../store";
import { STORY_OPS } from "./fold";
import { storyAt } from "./path";
import { type StoryItem, StoryRecord } from "./record";

export interface SceneSession {
  /**
   * The session in force at the turn: the newest opened on the turn's path for the scene the record
   * holds open there; with no scene open, the newest opened on the path, when it is for no scene.
   * Null when none is: one is opened for `scene`. It is open on this path, so it is given with no
   * `closedBy`, whatever the store's row holds of a close on another path (a turn since swiped).
   */
  session: SessionRow | null;
  /** The scene the record holds open and current at the turn; "" for none. A session opened now is for it. */
  scene: string;
  /** What a session opened now opens with: the summary of the scene before it, where that scene has one. */
  summary: string | null;
}

/** The scene sessions read at `turn`: with what the turn and those before it on its path recorded. */
export function sceneSession(store: Store, user: string, chat: string, turn: string): SceneSession {
  const u = store.user(user);
  const record = StoryRecord.read(store, user, storyAt(u, chat, turn));
  const current = record.current("scene");
  const open = current !== null && current.closedBy === null ? current : null;
  const onPath = u.sessions(chat).filter((s) => record.at.order.has(s.openedBy));
  const newest = open === null ? onPath.at(-1) : onPath.findLast((s) => s.scene === open.id);
  const session = newest !== undefined && newest.scene === (open?.id ?? "") ? { ...newest, closedBy: null } : null;
  const before = open === null ? current : sceneBefore(record, open);
  const summary = before?.fields.summary;
  return { session, scene: open?.id ?? "", summary: typeof summary === "string" ? summary : null };
}

/**
 * He closes the scene the story holds open at the chat's head (plan §6.3 l.632, R-22): `close: true` on it, as his own change, of no
 * turn, applied at once and placed after the newest reply on the chat's own line (so a swipe of that reply keeps it), by `player`,
 * source `player`, inside the caller's queued write. The scene's id and the change; null when no scene is open there. His undo of
 * the change is the store's.
 */
export function closeOpenScene(store: Store, user: string, chat: string): { scene: string; change: number } | null {
  const u = store.user(user);
  if (u.chat(chat) === null) return null;
  const scene = StoryRecord.read(store, user, storyAt(u, chat, null)).current("scene");
  if (scene === null || scene.closedBy !== null) return null;
  const { changes } = u.record(u.writeTarget({ chat }), [{ lane: "story", op: STORY_OPS.write, value: { part: "scene", item: scene.id, value: { close: true } }, by: "player", source: "player" }]);
  return { scene: scene.id, change: changes[0]?.id ?? 0 };
}

/** The scene that starts last before `scene` does (the later made, where two start together); null when none. */
function sceneBefore(record: StoryRecord, scene: StoryItem): StoryItem | null {
  const at = record.startOf(scene);
  let best: { item: StoryItem; from: number } | null = null;
  for (const item of record.of("scene")) {
    if (item === scene) continue;
    const from = record.startOf(item);
    if (from === null || (at !== null && from > at)) continue;
    if (best === null || from >= best.from) best = { item, from };
  }
  return best?.item ?? null;
}
