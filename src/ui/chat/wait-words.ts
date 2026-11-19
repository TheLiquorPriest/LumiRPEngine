// What the HUD's place says while the open chat cannot be drawn yet (plan §14): while RPE gets the chat ready for the build that
// runs (src/store/prepare.ts), that it does, with how far it is, as RPE's waiting answers to the page's reads of it say
// (`client.preparing`); after that, while the chat's first read of its world or of the lines under its replies is still out (past
// `pages.waitWordsMs`, at once after the getting ready), that RPE is working them out. Nothing once they are in: the HUD, the lines and
// the rest draw as their reads are answered, with no reload.

import type { ChatPreparing } from "../../shared/preparing";
import { createStore, type Readable } from "../store";
import { chatPlay } from "./chat-play";
import { repliesOf } from "./replies";
import type { FrameEnv } from "./surface";

/** How far RPE is with getting the chat ready for its build, in words. */
export function preparingWords(preparing: ChatPreparing): string {
  const { ahead, done, of } = preparing;
  if (ahead === 1) return "RPE is getting another chat ready for its new build first; this one is next.";
  if (ahead > 1) return `RPE is getting ${ahead} other chats ready for its new build first; then this one.`;
  if (of === null || of === 0) return "RPE is getting this chat ready for its new build.";
  return `RPE is getting this chat ready for its new build: ${Math.min(100, Math.floor((done * 100) / of))}% done.`;
}

/** What RPE is still working out of the chat, in words: its world (the HUD's values, the notes), the lines under its replies, or both. */
export function workingWords(world: boolean, lines: boolean): string | null {
  if (world && lines) return "RPE is working out this chat's world and the lines under its replies.";
  if (world) return "RPE is working out this chat's world.";
  if (lines) return "RPE is working out the lines under the replies.";
  return null;
}

const made = new WeakMap<FrameEnv, { chat: string | null; words: Readable<string | null>; stop(): void }>();

/** What the HUD's place says of the open chat while it cannot be drawn yet; null while there is nothing to say. Kept while the chat stays open. */
export function waitWords(env: FrameEnv): Readable<string | null> {
  const chat = env.chat.get();
  const held = made.get(env);
  if (held !== undefined && held.chat === chat) return held.words;
  held?.stop();
  const words = createStore<string | null>(null);
  const offs: (() => void)[] = [];
  let alive = true;
  /** The wait has lasted: past `pages.waitWordsMs`, or RPE got the chat ready first. */
  let long = false;
  let timer: unknown = null;
  const play = chat === null ? null : chatPlay(env);
  const replies = chat === null ? null : repliesOf(env);
  const say = (now: string | null): void => {
    if (words.get() !== now) words.set(now);
  };
  const look = (): void => {
    if (!alive || chat === null) return;
    const preparing = env.client.preparing.get().get(chat);
    if (preparing !== undefined) {
      long = true;
      say(preparingWords(preparing));
      return;
    }
    const sync = play?.app.sync.get();
    const world = sync !== undefined && sync.view === null && sync.status === "syncing";
    const lines = replies?.get();
    const reading = lines !== undefined && lines.reading && lines.lines.size === 0;
    if (!world && !reading) {
      long = false;
      env.timers.clearTimeout(timer);
      timer = null;
      say(null);
      return;
    }
    if (!long && timer === null) {
      timer = env.timers.setTimeout(() => {
        timer = null;
        long = true;
        look();
      }, env.settings.values.get().waitWordsMs);
    }
    say(long ? workingWords(world, reading) : null);
  };
  if (chat !== null) {
    offs.push(env.client.preparing.subscribe(look));
    if (play !== null) offs.push(play.app.sync.subscribe(look));
    if (replies !== null) offs.push(replies.subscribe(look));
  }
  const stop = (): void => {
    alive = false;
    env.timers.clearTimeout(timer);
    for (const off of offs) off();
    if (made.get(env)?.words === words) made.delete(env);
  };
  made.set(env, { chat, words, stop });
  look();
  return words;
}

/** Lets go of what the open chat's HUD place says. */
export function releaseWaitWords(env: FrameEnv): void {
  made.get(env)?.stop();
}
