// Where a generation's turn starts (plan §10.1 steps 2-4, §9.6 l.1121-1122): one rule, the same for the
// turn intake begins and for the answer to the extension's question before lore activates, so the
// secrets a prompt is given and the state its turn starts from are worked out at one point of one
// path. The rule reads the path as the chat shows it, the generation's kind and the message it names,
// and gives the point on that path: a new reply after the path's head, a swipe or a regenerate in place
// of the reply it writes again (so from that attempt's parent), a continue on the message it goes on,
// whose turn it extends, and an impersonation after the head. The store works out the state there
// (`UserStore.turnStart`), along the chain of turns that path shows, from RPE's own store alone.

import type { LvStep } from "../adapter/lumiverse/reads";
import type { ReplyKind } from "../adapter/lumiverse/wire";
import type { SeenMessage, TurnPoint, TurnStart, UserStore } from "../store";

/** A generation as the rule reads it: its kind, and the message it names, as the tag carries them. */
export interface GenerationAt {
  kind: ReplyKind;
  /** The message a new reply is written into, the reply a swipe or a regenerate writes again, the one a continue goes on; none for an impersonation. */
  target: { message: string | null };
}

/** Where a generation's turn starts: the store's answer at the point (`TurnStart`), with the point itself and the message a continue goes on. */
export interface GenerationStart extends TurnStart {
  point: TurnPoint;
  /**
   * For a continue, the message it goes on: the one it names, else the path's last reply, as Lumiverse takes it
   * (`generate.service.ts:1809-1812`, `:1962-1966`); null for any other generation, or a continue with no reply to go on.
   */
  goesOn: string | null;
}

/** The chat's path as the rule reads it: each message's id, whether it is the player's, its place, the swipe it shows and that swipe's text's hash. */
export function seenOf(steps: readonly LvStep[]): SeenMessage[] {
  return steps.map((s) => ({ id: s.id, user: s.role !== "assistant", index: s.index, swipe: s.swipe, hash: s.shown.hash }));
}

/** The path up to and with `message`, where it holds that message; else the whole path. */
function upTo(path: readonly SeenMessage[], message: string | null): SeenMessage[] {
  const at = message === null ? -1 : path.findIndex((m) => m.id === message);
  return at < 0 ? [...path] : path.slice(0, at + 1);
}

/** After the newest message of `path`, which then ends there. */
function after(path: readonly SeenMessage[]): { path: SeenMessage[]; point: TurnPoint } {
  return { path: [...path], point: { follows: path.at(-1)?.id ?? null } };
}

/**
 * Where the turn of a generation of `chat` starts on `path`, the chat as it shows now, oldest first. A new reply's own message, made
 * empty for it before the prompt, is not on its way yet and is passed over; a swipe or a regenerate stands in place of the reply it
 * writes again; a continue stands at the message it goes on; an impersonation, and a swipe that names no reply, after the newest
 * message. Intake begins its turn here, and the answer to the extension's question is worked out here.
 */
export function generationStart(store: UserStore, chat: string, path: readonly SeenMessage[], generation: GenerationAt): GenerationStart {
  const { kind, target } = generation;
  const goesOn = kind !== "continue" ? null : (target.message ?? path.findLast((m) => !m.user)?.id ?? null);
  let at: { path: SeenMessage[]; point: TurnPoint };
  if (kind === "new") at = after(path.filter((m) => m.id !== target.message));
  else if ((kind === "swipe" || kind === "regenerate") && target.message !== null) at = { path: upTo(path, target.message), point: { replaces: target.message } };
  else if (kind === "continue") at = after(upTo(path, goesOn));
  else at = after(path);
  return { ...store.turnStart(chat, at.path, at.point), point: at.point, goesOn };
}
