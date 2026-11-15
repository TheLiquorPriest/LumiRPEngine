// Where a generation's turn starts (plan §10.1 steps 2-4, §9.6 l.1121-1122): one rule, the same for the
// turn intake begins and for the answer to the extension's question before lore activates, so the
// secrets a prompt is given and the state its turn starts from are worked out at one point of one
// path. The rule reads the path as the chat shows it, the generation's kind and the message it names,
// and gives the point on that path: a new reply after the path's head, a swipe or a regenerate in place
// of the reply it writes again (so from that attempt's parent), a continue after the message its tag names
// (after the head where the tag could not tell), and an impersonation after the head. The store works out the state there
// (`UserStore.turnStart`), along the chain of turns that path shows, from RPE's own store alone.

import type { LvStep } from "../adapter/lumiverse/reads";
import type { ReplyKind } from "../adapter/lumiverse/wire";
import type { SeenMessage, TurnPoint, TurnStart, UserStore } from "../store";

/** A generation as the rule reads it: its kind, and the message it names, as the tag carries them. */
export interface GenerationAt {
  kind: ReplyKind;
  /** The message a new reply is written into, the reply a swipe or a regenerate writes again, the one a continue's tag names (a first word only); none for an impersonation, or a continue the tag could not place. */
  target: { message: string | null };
}

/** Where a generation's turn starts: the store's answer at the point (`TurnStart`), with the point itself and the message a continue goes on. */
export interface GenerationStart extends TurnStart {
  point: TurnPoint;
  /**
   * For a continue, the message its tag named for it to go on, a first word only (R-192 (a)): never guessed, so null where the tag
   * could not tell, and the continue is tied where Lumiverse's end names the message. Null for any other generation.
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
 * writes again; a continue after the message its tag names, or after the newest message where the tag names none; an impersonation, and a swipe that names no reply, after the newest
 * message. Intake begins its turn here, and the answer to the extension's question is worked out here.
 */
export function generationStart(store: UserStore, chat: string, path: readonly SeenMessage[], generation: GenerationAt): GenerationStart {
  const { kind, target } = generation;
  const goesOn = kind !== "continue" ? null : target.message;
  let at: { path: SeenMessage[]; point: TurnPoint };
  if (kind === "new") at = after(path.filter((m) => m.id !== target.message));
  else if ((kind === "swipe" || kind === "regenerate") && target.message !== null) at = { path: upTo(path, target.message), point: { replaces: target.message } };
  else if (kind === "continue") at = after(upTo(path, goesOn));
  else at = after(path);
  return { ...store.turnStart(chat, at.path, at.point), point: at.point, goesOn };
}
